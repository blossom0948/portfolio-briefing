from __future__ import annotations

import html
import json
import os
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus
from xml.etree import ElementTree

import requests
import yfinance as yf
from deep_translator import GoogleTranslator
from pykrx import stock


ROOT = Path(__file__).resolve().parent
DATA_PATH = Path(os.environ.get("PORTFOLIO_DATA_PATH", ROOT / "data" / "portfolio.json"))
ENV_PATH = ROOT / ".env"


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
    today = datetime.now()
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
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
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
            "date": str(payload.get("date") or datetime.now().strftime("%Y-%m-%d")),
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


def google_news(query: str, limit: int = 4) -> list[dict[str, str]]:
    url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=ko&gl=KR&ceid=KR:ko"
    response = requests.get(url, timeout=20)
    response.raise_for_status()
    root = ElementTree.fromstring(response.content)
    items = []
    for item in root.findall("./channel/item")[:limit]:
        title = item.findtext("title") or ""
        link = item.findtext("link") or ""
        source = item.findtext("source") or ""
        items.append({"title": title, "title_ko": title, "link": link, "source": source, "kind": "국내"})
    return items


def translate_title(title: str) -> str:
    if not title:
        return title
    if any("가" <= char <= "힣" for char in title):
        return title
    try:
        return GoogleTranslator(source="auto", target="ko").translate(title)
    except Exception:
        return title


def yf_news(symbol: str, limit: int = 3) -> list[dict[str, str]]:
    items = []
    for item in yf.Ticker(symbol).news[:limit]:
        content = item.get("content", {})
        title = item.get("title") or content.get("title") or ""
        link = item.get("link") or content.get("canonicalUrl", {}).get("url") or ""
        source = item.get("publisher") or content.get("provider", {}).get("displayName") or ""
        if title and link:
            items.append(
                {
                    "title": title,
                    "title_ko": translate_title(title),
                    "link": link,
                    "source": source,
                    "kind": "해외",
                    "symbol": symbol,
                }
            )
    return items


def get_news(limit_each: int = 3) -> dict[str, list[dict[str, str]]]:
    portfolio = load_portfolio()
    holdings = [normalize_holding(item) for item in portfolio.get("holdings", [])]
    domestic_query = " OR ".join(item["name"] for item in holdings if item["market"] == "KR") or "삼성전자"
    domestic = google_news(f"{domestic_query} 주가 HBM 자사주", limit_each)
    overseas = []
    for holding in holdings:
        if holding["market"] == "US":
            overseas.extend(yf_news(holding["symbol"], 2))
        elif holding["market"] == "KR":
            overseas.extend(yf_news(f"{holding['symbol']}.KS", 1))
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
    lines = [
        f"[포트폴리오 브리핑] {datetime.now().strftime('%Y-%m-%d')}",
        "",
        "가격 요약",
    ]
    for item in snapshot["holdings"]:
        if item.get("error"):
            lines.append(f"- {item['name']}: 조회 실패 ({item['error']})")
        else:
            lines.append(f"- {item['name']}: {format_change(item)}")
    lines.extend(["", "오늘의 주요 뉴스들"])
    for item in news["domestic"] + news["overseas"]:
        lines.append(f"- {item['title_ko']} ({item['source']})")
        lines.append(f"  {item['link']}")
    lines.extend(["", "그래서 오늘 해야 할 것"])
    lines.extend(f"- {note}" for note in action_notes(snapshot))
    return "\n".join(lines)


def build_briefing_html() -> str:
    text = build_briefing_text()
    escaped = html.escape(text).replace("\n", "<br>")
    return f"<div style=\"font-family:Arial,sans-serif;line-height:1.55\">{escaped}</div>"


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
    msg["Subject"] = f"[포트폴리오 브리핑] {datetime.now().strftime('%Y-%m-%d')}"
    msg.set_content(body)
    msg.add_alternative(build_briefing_html(), subtype="html")

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
        server.login(os.environ["GMAIL_USER"], os.environ["GMAIL_APP_PASSWORD"].replace(" ", ""))
        server.send_message(msg)
