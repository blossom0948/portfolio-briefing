from __future__ import annotations

import html
import json
import os
import re
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

import requests
import trafilatura
import yfinance as yf
from deep_translator import GoogleTranslator
from bs4 import BeautifulSoup
from googlenewsdecoder import gnewsdecoder
from pykrx import stock


ROOT = Path(__file__).resolve().parent
DATA_PATH = Path(os.environ.get("PORTFOLIO_DATA_PATH", ROOT / "data" / "portfolio.json"))
ENV_PATH = ROOT / ".env"
KST = ZoneInfo("Asia/Seoul")
REQUEST_HEADERS = {
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "User-Agent": "Mozilla/5.0 PortfolioBriefing/1.0",
}


@dataclass
class Price:
    symbol: str
    name: str
    market: str
    date: str
    close: float
    currency: str
    change: float | None
    change_pct: float | None


def now_kst() -> datetime:
    return datetime.now(KST)


def parse_news_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc).astimezone(KST)
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None
    if text.isdigit():
        return datetime.fromtimestamp(int(text), tz=timezone.utc).astimezone(KST)

    try:
        parsed = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(KST)


def is_today_kst(value: Any, today: Any | None = None) -> tuple[bool, datetime | None]:
    published_at = parse_news_datetime(value)
    if published_at is None:
        return False, None
    target = today or now_kst().date()
    return published_at.date() == target, published_at


def news_date_query(query: str) -> str:
    today = now_kst().date()
    tomorrow = today + timedelta(days=1)
    return f"{query} when:1d after:{today.isoformat()} before:{tomorrow.isoformat()}"


def news_fingerprint(item: dict[str, str]) -> str:
    title = re.sub(r"\s+", " ", item.get("title", "").lower()).strip()
    title = re.sub(r"\s+-\s+[^-]+$", "", title)
    return title or item.get("link", "")


def contains_korean(text: str) -> bool:
    return any("가" <= char <= "힣" for char in text)


def clean_text(text: str) -> str:
    text = html.unescape(text or "")
    text = re.sub(r"이미지\s*확대보기", " ", text)
    text = re.sub(r"(사진|자료|그래픽|출처)=[^\s]+", " ", text)
    text = re.sub(r"\S+@\S+", " ", text)
    text = re.sub(r"입력\s*[:：]?\s*\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}[^ ]*", " ", text)
    text = re.sub(r"수정\s*[:：]?\s*\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}[^ ]*", " ", text)
    text = re.sub(r"(프린트|이메일|카카오톡|페이스북|트위터)", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def load_env() -> None:
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def default_portfolio() -> dict[str, Any]:
    return {
        "settings": {
            "recipient": "blossom0948@gmail.com",
            "send_time": "07:00",
            "timezone": "Asia/Seoul",
        },
        "holdings": [
            {
                "id": "samsung-electronics",
                "name": "삼성전자",
                "symbol": "005930",
                "market": "KR",
                "quantity": 0,
                "average_price": 0,
                "plan": default_plan("KRW"),
                "transactions": [],
            },
            {
                "id": "qqqm",
                "name": "QQQM",
                "symbol": "QQQM",
                "market": "US",
                "quantity": 0,
                "average_price": 0,
                "plan": default_plan("USD"),
                "transactions": [],
            },
            {
                "id": "voo",
                "name": "VOO",
                "symbol": "VOO",
                "market": "US",
                "quantity": 0,
                "average_price": 0,
                "plan": default_plan("USD"),
                "transactions": [],
            },
        ],
    }


def load_portfolio() -> dict[str, Any]:
    config_url = os.environ.get("PORTFOLIO_CONFIG_URL")
    if config_url:
        response = requests.get(config_url, timeout=20)
        response.raise_for_status()
        portfolio = response.json()
        portfolio.setdefault("settings", default_portfolio()["settings"])
        portfolio.setdefault("holdings", [])
        portfolio["holdings"] = [normalize_holding(item) for item in portfolio["holdings"]]
        return portfolio
    if not DATA_PATH.exists():
        portfolio = default_portfolio()
        save_portfolio(portfolio)
        return portfolio
    portfolio = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    portfolio.setdefault("settings", default_portfolio()["settings"])
    portfolio.setdefault("holdings", [])
    portfolio["holdings"] = [normalize_holding(item) for item in portfolio["holdings"]]
    return portfolio


def save_portfolio(portfolio: dict[str, Any]) -> None:
    DATA_PATH.parent.mkdir(exist_ok=True)
    DATA_PATH.write_text(json.dumps(portfolio, ensure_ascii=False, indent=2), encoding="utf-8")
    sync_url = os.environ.get("PORTFOLIO_CONFIG_URL")
    if sync_url:
        try:
            requests.post(sync_url, json=portfolio, timeout=20)
        except Exception:
            pass


def default_plan(currency: str) -> dict[str, Any]:
    return {
        "enabled": False,
        "frequency": "weekly",
        "weekday": "MO",
        "amount": 0,
        "currency": currency,
        "memo": "",
    }


def normalize_holding(raw: dict[str, Any]) -> dict[str, Any]:
    symbol = str(raw.get("symbol", "")).strip().upper()
    market = str(raw.get("market", "")).strip().upper() or ("KR" if symbol.isdigit() else "US")
    name = str(raw.get("name", "")).strip() or symbol
    item_id = raw.get("id") or f"{market.lower()}-{symbol.lower().replace('.', '-')}"
    currency = "KRW" if market == "KR" else "USD"
    plan = {**default_plan(currency), **(raw.get("plan") or {})}
    plan["enabled"] = bool(plan.get("enabled"))
    plan["amount"] = float(plan.get("amount") or 0)
    return {
        "id": item_id,
        "name": name,
        "symbol": symbol,
        "market": market,
        "quantity": float(raw.get("quantity") or 0),
        "average_price": float(raw.get("average_price") or 0),
        "plan": plan,
        "transactions": list(raw.get("transactions") or []),
    }


def update_settings(payload: dict[str, Any]) -> dict[str, Any]:
    portfolio = load_portfolio()
    settings = portfolio.setdefault("settings", {})
    for key in ["recipient", "send_time", "timezone"]:
        if key in payload:
            settings[key] = str(payload[key]).strip()
    save_portfolio(portfolio)
    return settings


def _latest_kr_price(symbol: str, name: str) -> Price:
    today = now_kst()
    found: tuple[Any, Any] | None = None
    previous: Any | None = None
    for offset in range(30):
        day = today - timedelta(days=offset)
        ds = day.strftime("%Y%m%d")
        df = stock.get_market_ohlcv_by_date(ds, ds, symbol)
        if df is not None and not df.empty:
            if found is None:
                found = (df.index[-1], df.iloc[-1])
            else:
                previous = df.iloc[-1]
                break
    if found is None:
        raise RuntimeError(f"{name} 가격 데이터를 찾지 못했습니다.")
    date, row = found
    close = float(row.iloc[3])
    prev_close = float(previous.iloc[3]) if previous is not None else None
    return Price(
        symbol=symbol,
        name=name,
        market="KR",
        date=date.strftime("%Y-%m-%d"),
        close=close,
        currency="KRW",
        change=close - prev_close if prev_close else None,
        change_pct=round((close / prev_close - 1) * 100, 2) if prev_close else None,
    )


def _latest_us_price(symbol: str, name: str) -> Price:
    hist = yf.Ticker(symbol).history(period="10d", interval="1d", auto_adjust=False)
    hist = hist.dropna(subset=["Close"])
    if hist.empty:
        raise RuntimeError(f"{symbol} 가격 데이터를 찾지 못했습니다.")
    row = hist.iloc[-1]
    previous = hist.iloc[-2] if len(hist) > 1 else None
    close = float(row["Close"])
    prev_close = float(previous["Close"]) if previous is not None else None
    return Price(
        symbol=symbol,
        name=name,
        market="US",
        date=row.name.strftime("%Y-%m-%d"),
        close=round(close, 2),
        currency="USD",
        change=round(close - prev_close, 2) if prev_close else None,
        change_pct=round((close / prev_close - 1) * 100, 2) if prev_close else None,
    )


def get_price(holding: dict[str, Any]) -> dict[str, Any]:
    item = normalize_holding(holding)
    price = _latest_kr_price(item["symbol"], item["name"]) if item["market"] == "KR" else _latest_us_price(item["symbol"], item["name"])
    quantity = float(item.get("quantity") or 0)
    average_price = float(item.get("average_price") or 0)
    value = price.close * quantity if quantity else 0
    cost = average_price * quantity if quantity and average_price else 0
    profit = value - cost if cost else 0
    profit_pct = round((value / cost - 1) * 100, 2) if cost else None
    plan = item.get("plan") or default_plan(price.currency)
    estimated_shares = round((float(plan.get("amount") or 0) / price.close), 6) if price.close and plan.get("amount") else 0
    return {
        **item,
        "date": price.date,
        "close": price.close,
        "currency": price.currency,
        "change": price.change,
        "change_pct": price.change_pct,
        "value": round(value, 2),
        "cost": round(cost, 2),
        "profit": round(profit, 2),
        "profit_pct": profit_pct,
        "plan_estimated_shares": estimated_shares,
    }


def get_portfolio_snapshot() -> dict[str, Any]:
    portfolio = load_portfolio()
    rows = []
    errors = []
    for holding in portfolio.get("holdings", []):
        try:
            rows.append(get_price(holding))
        except Exception as exc:
            errors.append({"symbol": holding["symbol"], "message": str(exc)})
            rows.append({**holding, "error": str(exc)})
    total_value_krw = sum(item.get("value", 0) for item in rows if item.get("currency") == "KRW")
    total_value_usd = sum(item.get("value", 0) for item in rows if item.get("currency") == "USD")
    active_plans = [item for item in rows if (item.get("plan") or {}).get("enabled")]
    return {
        "settings": portfolio.get("settings", {}),
        "holdings": rows,
        "errors": errors,
        "totals": {
            "KRW": round(total_value_krw, 2),
            "USD": round(total_value_usd, 2),
        },
        "active_plans": len(active_plans),
        "updated_at": now_kst().strftime("%Y-%m-%d %H:%M"),
    }


def apply_transaction(item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    portfolio = load_portfolio()
    holdings = portfolio.setdefault("holdings", [])
    for index, holding in enumerate(holdings):
        if holding.get("id") != item_id:
            continue
        item = normalize_holding(holding)
        side = str(payload.get("side") or "buy")
        quantity = float(payload.get("quantity") or 0)
        price = float(payload.get("price") or 0)
        if quantity <= 0 or price <= 0:
            raise ValueError("수량과 가격은 0보다 커야 합니다.")
        current_qty = float(item["quantity"])
        current_avg = float(item["average_price"])
        if side == "sell":
            new_qty = max(0, current_qty - quantity)
            new_avg = current_avg if new_qty else 0
        else:
            new_qty = current_qty + quantity
            new_avg = ((current_qty * current_avg) + (quantity * price)) / new_qty
        transaction = {
            "date": str(payload.get("date") or now_kst().strftime("%Y-%m-%d")),
            "side": side,
            "quantity": quantity,
            "price": price,
            "memo": str(payload.get("memo") or ""),
        }
        item["quantity"] = round(new_qty, 8)
        item["average_price"] = round(new_avg, 4)
        item.setdefault("transactions", []).insert(0, transaction)
        item["transactions"] = item["transactions"][:20]
        holdings[index] = item
        save_portfolio(portfolio)
        return item
    raise KeyError("holding not found")


def update_plan(item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    portfolio = load_portfolio()
    holdings = portfolio.setdefault("holdings", [])
    for index, holding in enumerate(holdings):
        if holding.get("id") != item_id:
            continue
        item = normalize_holding(holding)
        plan = {**item.get("plan", default_plan("KRW" if item["market"] == "KR" else "USD"))}
        for key in ["frequency", "weekday", "memo"]:
            if key in payload:
                plan[key] = str(payload[key]).strip()
        if "enabled" in payload:
            plan["enabled"] = bool(payload["enabled"])
        if "amount" in payload:
            plan["amount"] = float(payload["amount"] or 0)
        plan["currency"] = "KRW" if item["market"] == "KR" else "USD"
        item["plan"] = plan
        holdings[index] = item
        save_portfolio(portfolio)
        return item
    raise KeyError("holding not found")


def google_news(
    query: str,
    limit: int = 4,
    *,
    kind: str = "국내",
    hl: str = "ko",
    gl: str = "KR",
    ceid: str = "KR:ko",
    translate: bool = False,
) -> list[dict[str, str]]:
    today = now_kst().date()
    rss_query = news_date_query(query)
    url = f"https://news.google.com/rss/search?q={quote_plus(rss_query)}&hl={hl}&gl={gl}&ceid={ceid}&scoring=n"
    response = requests.get(
        url,
        headers={
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": "Mozilla/5.0 PortfolioBriefing/1.0",
        },
        timeout=20,
    )
    response.raise_for_status()
    root = ElementTree.fromstring(response.content)
    items = []
    for item in root.findall("./channel/item"):
        is_today, published_at = is_today_kst(item.findtext("pubDate"), today)
        if not is_today or published_at is None:
            continue
        title = item.findtext("title") or ""
        link = item.findtext("link") or ""
        source = item.findtext("source") or ""
        items.append(
            {
                "title": title,
                "title_ko": translate_title(title) if translate else title,
                "link": link,
                "source": source,
                "kind": kind,
                "published_at": published_at.strftime("%Y-%m-%d %H:%M"),
                "query": rss_query,
            }
        )
        if len(items) >= limit:
            break
    return items


def translate_title(title: str) -> str:
    if not title:
        return title
    if contains_korean(title):
        return title
    try:
        return GoogleTranslator(source="auto", target="ko").translate(title)
    except Exception:
        return title


def translate_text(text: str) -> str:
    text = clean_text(text)
    if not text or contains_korean(text):
        return text
    try:
        chunks = []
        start = 0
        while start < len(text):
            chunk = text[start : start + 3500]
            chunks.append(GoogleTranslator(source="auto", target="ko").translate(chunk))
            start += 3500
        return clean_text(" ".join(chunks))
    except Exception:
        return text


def is_relevant_overseas_news(item: dict[str, str]) -> bool:
    title = f"{item.get('title', '')} {item.get('title_ko', '')}".lower()
    terms = ["qqqm", "voo", "vanguard", "invesco", "nasdaq", "s&p 500", "sp 500", "s&p"]
    return any(term in title for term in terms)


def yf_news(symbol: str, limit: int = 3) -> list[dict[str, str]]:
    today = now_kst().date()
    items = []
    for item in yf.Ticker(symbol).news[: max(limit * 8, 20)]:
        content = item.get("content") or {}
        publish_candidates = [
            item.get("providerPublishTime"),
            item.get("pubDate"),
            item.get("published_at"),
            content.get("providerPublishTime"),
            content.get("pubDate"),
            content.get("displayTime"),
        ]
        published_at = None
        for candidate in publish_candidates:
            is_today, parsed = is_today_kst(candidate, today)
            if parsed is not None:
                published_at = parsed
            if is_today:
                break
        else:
            continue
        if published_at is None:
            continue
        title = item.get("title") or content.get("title") or ""
        canonical_url = content.get("canonicalUrl") or {}
        click_url = content.get("clickThroughUrl") or {}
        provider = content.get("provider") or {}
        link = item.get("link") or canonical_url.get("url") or click_url.get("url") or ""
        source = item.get("publisher") or provider.get("displayName") or ""
        if title and link:
            items.append(
                {
                    "title": title,
                    "title_ko": translate_title(title),
                    "link": link,
                    "source": source,
                    "kind": "해외",
                    "symbol": symbol,
                    "published_at": published_at.strftime("%Y-%m-%d %H:%M"),
                }
            )
        if len(items) >= limit:
            break
    return items


def resolve_news_link(link: str) -> str:
    if not link or "news.google.com" not in link:
        return link
    try:
        decoded = gnewsdecoder(link)
        if decoded.get("status") and decoded.get("decoded_url"):
            return str(decoded["decoded_url"])
    except Exception:
        return link
    return link


def extract_article_text(link: str) -> tuple[str, str]:
    resolved = resolve_news_link(link)
    if not resolved:
        return "", link
    try:
        response = requests.get(resolved, headers=REQUEST_HEADERS, timeout=20, allow_redirects=True)
        response.raise_for_status()
    except Exception:
        return "", resolved

    extracted = trafilatura.extract(
        response.text,
        include_comments=False,
        include_tables=False,
        favor_precision=True,
    )
    extracted = clean_text(extracted or "")
    if len(extracted) >= 250:
        return extracted[:4500], resolved

    soup = BeautifulSoup(response.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "form", "header", "footer", "nav", "aside"]):
        tag.decompose()

    selectors = [
        '[itemprop="articleBody"]',
        "article",
        "main",
        "#articleBody",
        ".articleBody",
        ".article-body",
        ".article_view",
        ".article-content",
        ".news_content",
        ".view_con",
        ".content",
        "body",
    ]
    noise = [
        "무단전재",
        "재배포 금지",
        "copyright",
        "all rights reserved",
        "구독",
        "로그인",
        "기사제보",
        "광고",
        "관련기사",
        "기자",
    ]
    best = ""
    for selector in selectors:
        parts = []
        for container in soup.select(selector):
            if selector != "body":
                direct = clean_text(container.get_text(" ", strip=True))
                if 120 <= len(direct) <= 6000:
                    parts.append(direct)
            for paragraph in container.find_all(["p", "div"], recursive=True):
                text = clean_text(paragraph.get_text(" ", strip=True))
                lower = text.lower()
                if len(text) < 45 or len(text) > 1200:
                    continue
                if any(marker in lower for marker in noise):
                    continue
                parts.append(text)
        candidate = clean_text(" ".join(dict.fromkeys(parts)))
        if len(candidate) > len(best):
            best = candidate
        if selector != "body" and len(candidate) >= 350:
            break
    return best[:4500], resolved


def split_sentences(text: str) -> list[str]:
    text = clean_text(text)
    if not text:
        return []
    chunks = re.split(r"(?<=[.!?。])\s+|(?<=다\.)\s+|(?<=요\.)\s+", text)
    sentences = []
    for chunk in chunks:
        sentence = clean_text(chunk)
        if 35 <= len(sentence) <= 260:
            sentences.append(sentence)
    return sentences


def keyword_terms(title: str) -> set[str]:
    terms = {
        "삼성전자",
        "주가",
        "반도체",
        "HBM",
        "자사주",
        "실적",
        "ETF",
        "QQQM",
        "VOO",
        "나스닥",
        "S&P",
        "S&P 500",
        "미국",
        "금리",
        "AI",
    }
    for word in re.findall(r"[A-Za-z0-9&.]+|[가-힣]{2,}", title):
        if len(word) >= 2:
            terms.add(word)
    return {term.lower() for term in terms}


def pick_key_sentences(text: str, title: str, count: int = 3) -> list[str]:
    sentences = split_sentences(text)
    if not sentences:
        return []
    terms = keyword_terms(title)
    title_terms = {
        word.lower()
        for word in re.findall(r"[A-Za-z0-9&.]+|[가-힣]{2,}", title)
        if len(word) >= 2
    }
    noise_terms = [
        "많이 본 기사",
        "오늘의 주요뉴스",
        "관련기사",
        "헤드라인 뉴스",
        "무단전재",
        "재배포",
        "기자",
    ]
    scored = []
    for index, sentence in enumerate(sentences[:24]):
        lowered = sentence.lower()
        if any(term in sentence for term in noise_terms):
            continue
        if title_terms and not any(term in lowered for term in title_terms) and index > 2:
            continue
        score = sum(1 for term in terms if term and term in lowered)
        score += max(0, 5 - index) * 0.25
        scored.append((score, index, sentence))
    if not scored:
        scored = [(max(0, 5 - index) * 0.25, index, sentence) for index, sentence in enumerate(sentences[:5])]
    selected = sorted(sorted(scored, reverse=True)[:count], key=lambda row: row[1])
    return [sentence for _, _, sentence in selected]


def simple_news_context(item: dict[str, str], sentences: list[str]) -> str:
    combined = f"{item.get('title_ko', '')} {' '.join(sentences)}"
    lowered = combined.lower()
    if item.get("kind") == "국내":
        if "hbm" in lowered or "반도체" in lowered:
            return "쉽게 말하면, 삼성전자가 돈을 더 잘 벌 수 있을지 사람들이 반도체와 HBM 흐름을 보고 있다는 뜻입니다."
        if "자사주" in lowered:
            return "쉽게 말하면, 회사가 자기 주식을 사거나 없애면 남은 주식의 가치가 올라갈 수 있어서 투자자들이 관심을 갖습니다."
        if "주가" in lowered or "강세" in lowered or "상승" in lowered:
            return "쉽게 말하면, 오늘 시장에서 삼성전자에 돈이 많이 몰렸고 주가 움직임이 커졌다는 뜻입니다."
        return "쉽게 말하면, 삼성전자 주변에 새 소식이 나왔고 이것이 주가와 투자심리에 영향을 줄 수 있습니다."
    if "s&p" in lowered or "voo" in lowered:
        return "쉽게 말하면, VOO는 미국 큰 회사들을 묶어 산 것이라 미국 전체 시장 분위기가 중요합니다."
    if "nasdaq" in lowered or "qqqm" in lowered or "technology" in lowered or "기술" in lowered:
        return "쉽게 말하면, QQQM은 기술주 비중이 커서 AI, 반도체, 큰 기술회사 뉴스에 민감하게 움직입니다."
    return "쉽게 말하면, 미국 ETF는 한 회사보다 미국 시장 전체 분위기와 금리, 큰 기업 실적에 영향을 많이 받습니다."


def portfolio_connection(item: dict[str, str]) -> str:
    if item.get("kind") == "국내":
        return "내 포트폴리오에서는 삼성전자 보유 판단과 추가매수 타이밍을 볼 때 참고할 뉴스입니다."
    title = f"{item.get('title', '')} {item.get('title_ko', '')}".lower()
    if "voo" in title or "s&p" in title:
        return "내 포트폴리오에서는 VOO가 미국 대표 기업 전체에 투자하는 상품이라 시장 방향을 볼 때 중요합니다."
    if "qqqm" in title or "nasdaq" in title or "invesco" in title:
        return "내 포트폴리오에서는 QQQM이 기술주 중심이라 성장주 분위기를 볼 때 중요합니다."
    return "내 포트폴리오에서는 QQQM과 VOO의 단기 분위기를 확인하는 참고 뉴스입니다."


def make_easy_sentence(sentence: str) -> str:
    sentence = clean_text(sentence)
    replacements = {
        "시가총액": "시총(회사 전체 값)",
        "영업이익": "영업이익(장사해서 남긴 돈)",
        "고대역폭 메모리(HBM)": "AI용 빠른 메모리(HBM)",
        "고대역폭 메모리": "AI용 빠른 메모리",
        "채권수익률": "미국 국채 금리",
        "거시 데이터": "경제 전체를 보여주는 숫자",
        "투자심리": "투자자들의 분위기",
    }
    for old, new in replacements.items():
        sentence = sentence.replace(old, new)
    sentence = re.sub(r"\(NYSE[^)]*\)", "", sentence)
    sentence = re.sub(r"\([^)]{35,}\)", "", sentence)
    if len(sentence) > 190:
        sentence = sentence[:190].rsplit(" ", 1)[0].rstrip(" ,") + "..."
    return sentence


def summarize_news_item(item: dict[str, str]) -> dict[str, str]:
    body, resolved_link = extract_article_text(item.get("link", ""))
    translated_body = translate_text(body)
    title = item.get("title_ko") or translate_title(item.get("title", ""))
    sentences = pick_key_sentences(translated_body, title, 3)
    if sentences:
        easy_sentences = [make_easy_sentence(sentence) for sentence in sentences]
        summary = [
            f"핵심 내용: {easy_sentences[0]}",
            *[f"조금 더 보면: {sentence}" for sentence in easy_sentences[1:]],
            simple_news_context(item, sentences),
            portfolio_connection(item),
        ]
    else:
        summary = [
            f"원문 본문을 자동으로 충분히 읽지는 못했지만, 제목 기준으로는 '{title}'에 관한 뉴스입니다.",
            simple_news_context(item, []),
            portfolio_connection(item),
        ]
    return {
        **item,
        "title_ko": title,
        "summary": "\n".join(f"- {line}" for line in summary),
        "resolved_link": resolved_link or item.get("link", ""),
    }


def get_news(limit_each: int = 3) -> dict[str, list[dict[str, str]]]:
    portfolio = load_portfolio()
    holdings = [normalize_holding(item) for item in portfolio.get("holdings", [])]
    domestic_query = " OR ".join(item["name"] for item in holdings if item["market"] == "KR") or "삼성전자"
    domestic = []
    domestic_seen = set()
    domestic_queries = [
        f"{domestic_query} 주가",
        f"{domestic_query} 반도체 HBM",
        f"{domestic_query} 자사주",
        f"{domestic_query} 실적",
    ]
    for query in domestic_queries:
        if len(domestic) >= limit_each:
            break
        for item in google_news(query, limit_each * 2, kind="국내"):
            key = news_fingerprint(item)
            if key in domestic_seen:
                continue
            domestic_seen.add(key)
            domestic.append(item)
            if len(domestic) >= limit_each:
                break
    overseas = []
    seen = set()
    us_symbols = [item["symbol"] for item in holdings if item["market"] == "US"] or ["QQQM", "VOO"]
    fallback_queries = [
        *(f"{symbol} ETF" for symbol in us_symbols),
        "Invesco NASDAQ 100 ETF",
        "Vanguard S&P 500 ETF",
        "Nasdaq 100 ETF market",
        "S&P 500 ETF market",
    ]
    for query in fallback_queries:
        if len(overseas) >= limit_each:
            break
        for item in google_news(
            query,
            limit_each,
            kind="해외",
            hl="en-US",
            gl="US",
            ceid="US:en",
            translate=True,
        ):
            if not is_relevant_overseas_news(item):
                continue
            key = news_fingerprint(item)
            if key in seen:
                continue
            seen.add(key)
            overseas.append(item)
            if len(overseas) >= limit_each:
                break
    return {"domestic": domestic[:limit_each], "overseas": overseas[:limit_each]}


def format_money(value: float, currency: str) -> str:
    if currency == "KRW":
        return f"{value:,.0f}원"
    return f"${value:,.2f}"


def format_change(item: dict[str, Any]) -> str:
    if item.get("change") is None:
        return "등락 정보 없음"
    sign = "+" if item["change"] > 0 else ""
    if item["currency"] == "KRW":
        change = f"{sign}{item['change']:,.0f}원"
    else:
        change = f"{sign}${item['change']:,.2f}"
    pct = f"{sign}{item['change_pct']}%"
    return f"{format_money(item['close'], item['currency'])} ({change}, {pct})"


def action_notes(snapshot: dict[str, Any]) -> list[str]:
    notes = []
    samsung = next((h for h in snapshot["holdings"] if h.get("symbol") == "005930"), None)
    qqqm = next((h for h in snapshot["holdings"] if h.get("symbol") == "QQQM"), None)
    if samsung and samsung.get("change_pct") is not None and samsung["change_pct"] > 3:
        notes.append("삼성전자는 급등 뒤 구간입니다. 오늘은 추격매수보다 수급과 HBM 뉴스를 확인하세요.")
    else:
        notes.append("삼성전자는 보유 관점으로 보되, 외국인 수급 변화를 우선 확인하세요.")
    if qqqm and qqqm.get("value", 0) > snapshot["totals"].get("USD", 0) * 0.6:
        notes.append("QQQM 비중이 높습니다. 기술주 쏠림을 줄이고 싶다면 VOO 비중을 함께 점검하세요.")
    else:
        notes.append("QQQM과 VOO는 둘 다 미국 대형주 노출입니다. 신규 매수 전 기술주 과열 여부를 확인하세요.")
    if snapshot.get("active_plans"):
        notes.append(f"주식 모으기 {snapshot['active_plans']}개가 켜져 있습니다. 이번 주 예정 금액과 현금 여력을 확인하세요.")
    notes.append("오늘 결론은 보유 우선, 추가매수는 분할로 접근입니다.")
    return notes


def build_briefing_text() -> str:
    snapshot = get_portfolio_snapshot()
    news = get_news(3)
    domestic_news = [summarize_news_item(item) for item in news["domestic"]]
    overseas_news = [summarize_news_item(item) for item in news["overseas"]]
    lines = [
        f"[포트폴리오 브리핑] {now_kst().strftime('%Y-%m-%d')}",
        "",
        "가격 요약",
    ]
    for item in snapshot["holdings"]:
        if item.get("error"):
            lines.append(f"- {item['name']}: 조회 실패 ({item['error']})")
        else:
            lines.append(f"- {item['name']}: {format_change(item)}")
    lines.extend(["", "오늘의 주요 뉴스들"])
    today_news = domestic_news + overseas_news
    if today_news:
        lines.append("")
        lines.append("국내 뉴스")
        if domestic_news:
            for index, item in enumerate(domestic_news, 1):
                published = f", {item['published_at']} KST" if item.get("published_at") else ""
                lines.append(f"{index}. {item['title_ko']} ({item['source']}{published})")
                lines.append(item["summary"])
                lines.append(f"링크: {item.get('resolved_link') or item['link']}")
                lines.append("")
        else:
            lines.append("- 오늘자 국내 관련 뉴스가 없습니다.")
        lines.append("해외 뉴스")
        if overseas_news:
            for index, item in enumerate(overseas_news, 1):
                published = f", {item['published_at']} KST" if item.get("published_at") else ""
                lines.append(f"{index}. {item['title_ko']} ({item['source']}{published})")
                lines.append(item["summary"])
                lines.append(f"링크: {item.get('resolved_link') or item['link']}")
                lines.append("")
        else:
            lines.append("- 오늘자 해외 관련 뉴스가 없습니다.")
    else:
        lines.append("- 오늘자(KST 기준)로 확인된 관련 뉴스가 없습니다. 오래된 기사는 제외했습니다.")
    lines.extend(["", "그래서 오늘 해야 할 것"])
    lines.extend(f"- {note}" for note in action_notes(snapshot))
    return "\n".join(lines)


def build_briefing_html() -> str:
    text = build_briefing_text()
    escaped = html.escape(text).replace("\n", "<br>")
    return f"<div style=\"font-family:Arial,sans-serif;line-height:1.55\">{escaped}</div>"


def ask_ai(question: str) -> str:
    load_env()
    question = question.strip()
    if not question:
        return "질문을 입력하세요."
    snapshot = get_portfolio_snapshot()
    briefing = build_briefing_text()
    context = {
        "snapshot": snapshot,
        "briefing": briefing,
    }
    prompt = (
        "너는 개인 포트폴리오 분석 도우미다. 한국어로 답하고, 투자 판단을 단정하지 말고 "
        "계산 가정, 시나리오, 체크포인트 중심으로 설명해라. 사용자의 보유 종목은 삼성전자, "
        "QQQM, VOO를 포함할 수 있다. 숫자 계산이 필요한 질문은 식과 결과를 간결히 보여줘라.\n\n"
        f"현재 포트폴리오 데이터:\n{json.dumps(context, ensure_ascii=False)}\n\n"
        f"사용자 질문:\n{question}"
    )

    if os.environ.get("OPENAI_API_KEY"):
        answer = ask_openai(prompt)
        if "quota" not in answer.lower() and "billing" not in answer.lower():
            return answer
        return local_projection_answer(question, snapshot, answer)
    if os.environ.get("GEMINI_API_KEY"):
        answer = ask_gemini(prompt)
        if "quota" not in answer.lower() and "할당량" not in answer:
            return answer
        return local_projection_answer(question, snapshot, answer)
    return local_projection_answer(
        question,
        snapshot,
        "AI API 키가 아직 설정되지 않았습니다.\n\n"
        "로컬 .env 파일에 OPENAI_API_KEY를 추가하면 이 대시보드에서 바로 질문할 수 있습니다. "
        "Gemini를 쓰려면 GEMINI_API_KEY도 가능하지만, 지금 보신 quota 오류가 있으면 OpenAI 쪽이 더 안정적입니다."
    )


def local_projection_answer(question: str, snapshot: dict[str, Any], reason: str) -> str:
    lowered = question.lower()
    is_quota_fallback = "quota" in reason.lower() or "billing" in reason.lower() or "할당량" in reason
    if not is_quota_fallback and not any(word in question for word in ["1년", "일년", "12개월", "모으면", "매주", "매월", "얼마"]):
        return reason

    candidates = []
    for item in snapshot.get("holdings", []):
        if item.get("error"):
            continue
        name = item.get("name", "")
        symbol = item.get("symbol", "")
        if name in question or symbol.lower() in lowered:
            candidates = [item]
            break
    if not candidates:
        candidates = [item for item in snapshot.get("holdings", []) if not item.get("error")]

    lines = [
        "AI quota가 막혀 있어서 내장 계산 모드로 답합니다.",
        "",
        "1년 적립 시뮬레이션",
    ]
    for item in candidates:
        plan = item.get("plan") or {}
        amount = float(plan.get("amount") or 0)
        if "만원" in question and item.get("currency") == "KRW":
            amount = 10000
        if "10만원" in question and item.get("currency") == "KRW":
            amount = 100000
        if not amount:
            continue
        periods = 52 if plan.get("frequency", "weekly") == "weekly" or "매주" in question else 12
        total = amount * periods
        close = float(item.get("close") or 0)
        shares = total / close if close else 0
        down = total * 0.8
        flat = total
        up = total * 1.2
        lines.extend(
            [
                f"- {item['name']}: {format_money(amount, item['currency'])}씩 {periods}회",
                f"  총 투입금: {format_money(total, item['currency'])}",
                f"  현재가 기준 예상 매수 수량: {shares:,.6f}주",
                f"  단순 시나리오: -20% {format_money(down, item['currency'])} / 0% {format_money(flat, item['currency'])} / +20% {format_money(up, item['currency'])}",
            ]
        )
    if len(lines) == 3:
        lines.append("계산할 적립 금액이 없습니다. 주식 모으기 금액을 먼저 설정해 주세요.")
    lines.extend(["", "정확한 수익은 실제 매수 시점별 가격, 환율, 세금, 수수료에 따라 달라집니다."])
    return "\n".join(lines)


def ask_openai(prompt: str) -> str:
    model = os.environ.get("OPENAI_MODEL", "gpt-5.2")
    response = requests.post(
        "https://api.openai.com/v1/responses",
        headers={
            "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "input": prompt,
        },
        timeout=60,
    )
    data = response.json()
    if response.status_code >= 400:
        message = data.get("error", {}).get("message") or response.text
        return f"OpenAI 호출 실패: {message}"
    if data.get("output_text"):
        return data["output_text"]
    chunks = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(content["text"])
    return "\n".join(chunks).strip() or "AI 응답을 읽지 못했습니다."


def ask_gemini(prompt: str) -> str:
    model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    response = requests.post(
        url,
        params={"key": os.environ["GEMINI_API_KEY"]},
        json={
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.4, "maxOutputTokens": 1200},
        },
        timeout=60,
    )
    data = response.json()
    if response.status_code >= 400:
        message = data.get("error", {}).get("message") or response.text
        return f"Gemini 호출 실패: {message}"
    candidates = data.get("candidates") or []
    parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
    return "".join(part.get("text", "") for part in parts).strip() or "AI 응답을 읽지 못했습니다."


def send_briefing_email() -> None:
    load_env()
    portfolio = load_portfolio()
    recipient = portfolio.get("settings", {}).get("recipient") or os.environ.get("BRIEFING_RECIPIENT")
    required = ["GMAIL_USER", "GMAIL_APP_PASSWORD"]
    missing = [key for key in required if not os.environ.get(key)]
    if not recipient:
        missing.append("BRIEFING_RECIPIENT")
    if missing:
        raise RuntimeError(f"Missing required environment values: {', '.join(missing)}")

    body = build_briefing_text()
    msg = EmailMessage()
    msg["From"] = os.environ["GMAIL_USER"]
    msg["To"] = recipient
    msg["Subject"] = f"[포트폴리오 브리핑] {now_kst().strftime('%Y-%m-%d')}"
    msg.set_content(body)
    msg.add_alternative(build_briefing_html(), subtype="html")

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
        server.login(os.environ["GMAIL_USER"], os.environ["GMAIL_APP_PASSWORD"].replace(" ", ""))
        server.send_message(msg)
    config_url = os.environ.get("PORTFOLIO_CONFIG_URL")
    if config_url:
        try:
            requests.post(
                config_url,
                json={
                    "action": "saveLastBriefing",
                    "text": body,
                    "updatedAt": now_kst().isoformat(),
                },
                timeout=20,
            )
        except Exception:
            pass
