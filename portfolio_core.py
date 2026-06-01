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
NY = ZoneInfo("America/New_York")
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
                "average_price_currency": "KRW",
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
                "average_price_currency": "USD",
                "plan": {**default_plan("KRW"), "amount": 10000},
                "transactions": [],
            },
            {
                "id": "voo",
                "name": "VOO",
                "symbol": "VOO",
                "market": "US",
                "quantity": 0,
                "average_price": 0,
                "average_price_currency": "USD",
                "plan": {**default_plan("KRW"), "amount": 10000},
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


def sanitize_currency(value: Any, fallback: str = "KRW") -> str:
    currency = str(value or fallback).strip().upper()
    return currency if currency in {"KRW", "USD"} else fallback


def normalize_holding(raw: dict[str, Any]) -> dict[str, Any]:
    symbol = str(raw.get("symbol", "")).strip().upper()
    market = str(raw.get("market", "")).strip().upper() or ("KR" if symbol.isdigit() else "US")
    name = str(raw.get("name", "")).strip() or symbol
    item_id = raw.get("id") or f"{market.lower()}-{symbol.lower().replace('.', '-')}"
    currency = "KRW" if market == "KR" else "USD"
    plan = {**default_plan(currency), **(raw.get("plan") or {})}
    plan["enabled"] = bool(plan.get("enabled"))
    plan["amount"] = float(plan.get("amount") or 0)
    plan["currency"] = "KRW" if market == "KR" else sanitize_currency(plan.get("currency"), currency)
    average_price_currency = "KRW" if market == "KR" else sanitize_currency(raw.get("average_price_currency"), currency)
    return {
        "id": item_id,
        "name": name,
        "symbol": symbol,
        "market": market,
        "quantity": float(raw.get("quantity") or 0),
        "average_price": float(raw.get("average_price") or 0),
        "average_price_currency": average_price_currency,
        "plan": plan,
        "transactions": list(raw.get("transactions") or []),
    }


def get_usd_krw_rate() -> float:
    fallback = float(os.environ.get("USD_KRW_FALLBACK", "1350") or 1350)
    try:
        hist = yf.Ticker("KRW=X").history(period="5d", interval="1d", auto_adjust=False)
        hist = hist.dropna(subset=["Close"])
        if hist.empty:
            return fallback
        return round(float(hist.iloc[-1]["Close"]), 2)
    except Exception:
        return fallback


def to_quote_amount(amount: float, from_currency: str, quote_currency: str, usd_krw_rate: float) -> float:
    source = sanitize_currency(from_currency, quote_currency)
    target = sanitize_currency(quote_currency, source)
    if source == target:
        return float(amount or 0)
    if source == "KRW" and target == "USD":
        return float(amount or 0) / usd_krw_rate if usd_krw_rate else 0
    if source == "USD" and target == "KRW":
        return float(amount or 0) * usd_krw_rate
    return float(amount or 0)


def to_krw_amount(amount: float, currency: str, usd_krw_rate: float) -> float:
    return to_quote_amount(amount, currency, "KRW", usd_krw_rate)


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


DISCOVERY_PRESETS: dict[str, list[dict[str, str]]] = {
    "us": [
        {"symbol": "NVDA", "name": "NVIDIA", "market": "US", "category": "해외주식"},
        {"symbol": "AAPL", "name": "Apple", "market": "US", "category": "해외주식"},
        {"symbol": "MSFT", "name": "Microsoft", "market": "US", "category": "해외주식"},
        {"symbol": "AMZN", "name": "Amazon", "market": "US", "category": "해외주식"},
        {"symbol": "GOOGL", "name": "Alphabet", "market": "US", "category": "해외주식"},
        {"symbol": "META", "name": "Meta Platforms", "market": "US", "category": "해외주식"},
        {"symbol": "TSLA", "name": "Tesla", "market": "US", "category": "해외주식"},
        {"symbol": "AVGO", "name": "Broadcom", "market": "US", "category": "해외주식"},
        {"symbol": "NFLX", "name": "Netflix", "market": "US", "category": "해외주식"},
        {"symbol": "PLTR", "name": "Palantir", "market": "US", "category": "해외주식"},
        {"symbol": "SOFI", "name": "SoFi Technologies", "market": "US", "category": "해외주식"},
        {"symbol": "RKLB", "name": "Rocket Lab", "market": "US", "category": "해외주식"},
    ],
    "kr": [
        {"symbol": "005930", "name": "삼성전자", "market": "KR", "category": "국내주식"},
        {"symbol": "000660", "name": "SK하이닉스", "market": "KR", "category": "국내주식"},
        {"symbol": "373220", "name": "LG에너지솔루션", "market": "KR", "category": "국내주식"},
        {"symbol": "207940", "name": "삼성바이오로직스", "market": "KR", "category": "국내주식"},
        {"symbol": "005380", "name": "현대차", "market": "KR", "category": "국내주식"},
        {"symbol": "000270", "name": "기아", "market": "KR", "category": "국내주식"},
        {"symbol": "035420", "name": "NAVER", "market": "KR", "category": "국내주식"},
        {"symbol": "035720", "name": "카카오", "market": "KR", "category": "국내주식"},
        {"symbol": "068270", "name": "셀트리온", "market": "KR", "category": "국내주식"},
        {"symbol": "005490", "name": "POSCO홀딩스", "market": "KR", "category": "국내주식"},
        {"symbol": "105560", "name": "KB금융", "market": "KR", "category": "국내주식"},
        {"symbol": "055550", "name": "신한지주", "market": "KR", "category": "국내주식"},
    ],
    "etf": [
        {"symbol": "VOO", "name": "Vanguard S&P 500 ETF", "market": "US", "category": "ETF"},
        {"symbol": "QQQM", "name": "Invesco NASDAQ 100 ETF", "market": "US", "category": "ETF"},
        {"symbol": "SPY", "name": "SPDR S&P 500 ETF", "market": "US", "category": "ETF"},
        {"symbol": "QQQ", "name": "Invesco QQQ Trust", "market": "US", "category": "ETF"},
        {"symbol": "VTI", "name": "Vanguard Total Stock Market ETF", "market": "US", "category": "ETF"},
        {"symbol": "SCHD", "name": "Schwab U.S. Dividend Equity ETF", "market": "US", "category": "ETF"},
        {"symbol": "SOXX", "name": "iShares Semiconductor ETF", "market": "US", "category": "ETF"},
        {"symbol": "SOXL", "name": "Direxion Daily Semiconductor Bull 3X", "market": "US", "category": "ETF"},
        {"symbol": "069500", "name": "KODEX 200", "market": "KR", "category": "ETF"},
        {"symbol": "360750", "name": "TIGER 미국S&P500", "market": "KR", "category": "ETF"},
        {"symbol": "133690", "name": "TIGER 미국나스닥100", "market": "KR", "category": "ETF"},
    ],
    "bond": [
        {"symbol": "TLT", "name": "iShares 20+ Year Treasury Bond ETF", "market": "US", "category": "채권"},
        {"symbol": "IEF", "name": "iShares 7-10 Year Treasury Bond ETF", "market": "US", "category": "채권"},
        {"symbol": "SHY", "name": "iShares 1-3 Year Treasury Bond ETF", "market": "US", "category": "채권"},
        {"symbol": "BND", "name": "Vanguard Total Bond Market ETF", "market": "US", "category": "채권"},
        {"symbol": "AGG", "name": "iShares Core U.S. Aggregate Bond ETF", "market": "US", "category": "채권"},
        {"symbol": "TMF", "name": "Direxion Daily 20+ Year Treasury Bull 3X", "market": "US", "category": "채권"},
        {"symbol": "148070", "name": "KOSEF 국고채10년", "market": "KR", "category": "채권"},
        {"symbol": "305080", "name": "TIGER 미국채10년선물", "market": "KR", "category": "채권"},
    ],
}


def yahoo_symbol_for(symbol: str, market: str) -> str:
    return f"{symbol}.KS" if market == "KR" and symbol.isdigit() else symbol


def _quote_asset(asset: dict[str, str], usd_krw_rate: float) -> dict[str, Any]:
    market = asset.get("market", "US")
    symbol = asset["symbol"]
    try:
        price = _latest_kr_price(symbol, asset["name"]) if market == "KR" else _latest_us_price(symbol, asset["name"])
        return {
            **asset,
            "currency": price.currency,
            "close": price.close,
            "date": price.date,
            "change": price.change,
            "change_pct": price.change_pct,
            "krw_close": round(to_krw_amount(price.close, price.currency, usd_krw_rate), 2),
        }
    except Exception as exc:
        return {**asset, "currency": "KRW" if market == "KR" else "USD", "error": str(exc)}


def search_yahoo_assets(query: str, limit: int = 10) -> list[dict[str, str]]:
    if not query.strip():
        return []
    try:
        response = requests.get(
            "https://query2.finance.yahoo.com/v1/finance/search",
            params={"q": query, "quotesCount": limit, "newsCount": 0, "enableFuzzyQuery": True},
            headers=REQUEST_HEADERS,
            timeout=12,
        )
        response.raise_for_status()
        data = response.json()
    except Exception:
        return []

    rows = []
    for quote in data.get("quotes", []):
        symbol = str(quote.get("symbol") or "").upper()
        quote_type = str(quote.get("quoteType") or "").upper()
        exchange = str(quote.get("exchange") or "").upper()
        if not symbol or quote_type not in {"EQUITY", "ETF", "MUTUALFUND"}:
            continue
        market = "KR" if symbol.endswith(".KS") or symbol.endswith(".KQ") or exchange in {"KSC", "KOE"} else "US"
        clean_symbol = symbol.replace(".KS", "").replace(".KQ", "")
        rows.append(
            {
                "symbol": clean_symbol,
                "name": quote.get("shortname") or quote.get("longname") or clean_symbol,
                "market": market,
                "category": "ETF" if quote_type == "ETF" else ("국내주식" if market == "KR" else "해외주식"),
            }
        )
    return rows


def discover_assets(category: str = "us", query: str = "", limit: int = 12) -> dict[str, Any]:
    category = category if category in DISCOVERY_PRESETS else "us"
    query = query.strip()
    base = search_yahoo_assets(query, limit * 2) if query else DISCOVERY_PRESETS[category]
    if query:
        preset_matches = [
            item
            for group in DISCOVERY_PRESETS.values()
            for item in group
            if query.lower() in item["name"].lower() or query.lower() in item["symbol"].lower()
        ]
        base = preset_matches + base

    seen: set[tuple[str, str]] = set()
    unique = []
    for item in base:
        key = (item["market"], item["symbol"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
        if len(unique) >= limit:
            break

    rate = get_usd_krw_rate()
    return {
        "category": category,
        "query": query,
        "usd_krw_rate": rate,
        "items": [_quote_asset(item, rate) for item in unique],
    }


def get_price(holding: dict[str, Any], usd_krw_rate: float | None = None) -> dict[str, Any]:
    item = normalize_holding(holding)
    usd_krw_rate = usd_krw_rate or get_usd_krw_rate()
    price = _latest_kr_price(item["symbol"], item["name"]) if item["market"] == "KR" else _latest_us_price(item["symbol"], item["name"])
    quantity = float(item.get("quantity") or 0)
    average_price = float(item.get("average_price") or 0)
    average_price_currency = item.get("average_price_currency") or price.currency
    average_price_quote = to_quote_amount(average_price, average_price_currency, price.currency, usd_krw_rate)
    value = price.close * quantity if quantity else 0
    cost = average_price_quote * quantity if quantity and average_price_quote else 0
    profit = value - cost if cost else 0
    profit_pct = round((value / cost - 1) * 100, 2) if cost else None
    plan = item.get("plan") or default_plan(price.currency)
    plan_quote_amount = to_quote_amount(float(plan.get("amount") or 0), plan.get("currency") or price.currency, price.currency, usd_krw_rate)
    estimated_shares = round((plan_quote_amount / price.close), 6) if price.close and plan_quote_amount else 0
    return {
        **item,
        "date": price.date,
        "close": price.close,
        "currency": price.currency,
        "usd_krw_rate": usd_krw_rate,
        "change": price.change,
        "change_pct": price.change_pct,
        "value": round(value, 2),
        "cost": round(cost, 2),
        "profit": round(profit, 2),
        "profit_pct": profit_pct,
        "average_price_quote": round(average_price_quote, 4),
        "plan_quote_amount": round(plan_quote_amount, 4),
        "plan_estimated_shares": estimated_shares,
        "krw_close": round(to_krw_amount(price.close, price.currency, usd_krw_rate), 2),
        "krw_change": round(to_krw_amount(price.change or 0, price.currency, usd_krw_rate), 2) if price.change is not None else None,
        "krw_value": round(to_krw_amount(value, price.currency, usd_krw_rate), 2),
        "krw_cost": round(to_krw_amount(cost, price.currency, usd_krw_rate), 2),
        "krw_profit": round(to_krw_amount(profit, price.currency, usd_krw_rate), 2),
    }


def get_price_history(symbol: str, market: str = "US", period: str = "6mo") -> dict[str, Any]:
    yahoo_symbol = f"{symbol}.KS" if market == "KR" and symbol.isdigit() else symbol
    hist = yf.Ticker(yahoo_symbol).history(period=period, interval="1d", auto_adjust=False)
    hist = hist.dropna(subset=["Close"])
    if hist.empty:
        raise RuntimeError(f"{symbol} 차트 데이터를 찾지 못했습니다.")
    points = [
        {"date": index.strftime("%Y-%m-%d"), "close": round(float(row["Close"]), 4)}
        for index, row in hist.iterrows()
    ]
    first = points[0]["close"]
    last = points[-1]["close"]
    return {
        "symbol": symbol,
        "market": market,
        "yahoo_symbol": yahoo_symbol,
        "currency": "KRW" if market == "KR" else "USD",
        "period": period,
        "points": points,
        "start": first,
        "end": last,
        "change_pct": round((last / first - 1) * 100, 2) if first else None,
    }


def get_portfolio_snapshot() -> dict[str, Any]:
    portfolio = load_portfolio()
    rows = []
    errors = []
    usd_krw_rate = get_usd_krw_rate()
    for holding in portfolio.get("holdings", []):
        try:
            rows.append(get_price(holding, usd_krw_rate))
        except Exception as exc:
            errors.append({"symbol": holding["symbol"], "message": str(exc)})
            rows.append({**holding, "error": str(exc)})
    total_value_krw = sum(item.get("value", 0) for item in rows if item.get("currency") == "KRW")
    total_value_usd = sum(item.get("value", 0) for item in rows if item.get("currency") == "USD")
    total_value_krw_converted = sum(item.get("krw_value", 0) for item in rows if not item.get("error"))
    active_plans = [item for item in rows if (item.get("plan") or {}).get("enabled")]
    return {
        "settings": portfolio.get("settings", {}),
        "holdings": rows,
        "errors": errors,
        "usd_krw_rate": usd_krw_rate,
        "totals": {
            "KRW": round(total_value_krw, 2),
            "USD": round(total_value_usd, 2),
            "KRW_CONVERTED": round(total_value_krw_converted, 2),
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
        quote_currency = "KRW" if item["market"] == "KR" else "USD"
        price_currency = "KRW" if item["market"] == "KR" else sanitize_currency(payload.get("price_currency"), quote_currency)
        usd_krw_rate = get_usd_krw_rate()
        price_quote = to_quote_amount(price, price_currency, quote_currency, usd_krw_rate)
        current_qty = float(item["quantity"])
        current_avg = to_quote_amount(
            float(item["average_price"]),
            item.get("average_price_currency", quote_currency),
            quote_currency,
            usd_krw_rate,
        )
        if side == "sell":
            new_qty = max(0, current_qty - quantity)
            new_avg = current_avg if new_qty else 0
        else:
            new_qty = current_qty + quantity
            new_avg = ((current_qty * current_avg) + (quantity * price_quote)) / new_qty
        transaction = {
            "date": str(payload.get("date") or now_kst().strftime("%Y-%m-%d")),
            "side": side,
            "quantity": quantity,
            "price": price,
            "price_currency": price_currency,
            "memo": str(payload.get("memo") or ""),
        }
        item["quantity"] = round(new_qty, 8)
        item["average_price"] = round(new_avg, 4)
        item["average_price_currency"] = quote_currency
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
        if "currency" in payload:
            plan["currency"] = sanitize_currency(payload["currency"], plan.get("currency") or ("KRW" if item["market"] == "KR" else "USD"))
        plan["currency"] = "KRW" if item["market"] == "KR" else sanitize_currency(plan.get("currency"), "USD")
        item["plan"] = plan
        holdings[index] = item
        save_portfolio(portfolio)
        return item
    raise KeyError("holding not found")


def _weekday_code(day: datetime) -> str:
    return ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][day.weekday()]


def _is_first_weekday_of_month(day: datetime) -> bool:
    return day.day <= 7


def plan_is_due(plan: dict[str, Any], run_at: datetime | None = None) -> bool:
    run_at = run_at or now_kst()
    if not plan.get("enabled") or float(plan.get("amount") or 0) <= 0:
        return False
    if str(plan.get("weekday") or "MO").upper() != _weekday_code(run_at):
        return False
    if plan.get("last_executed_date") == run_at.strftime("%Y-%m-%d"):
        return False
    frequency = str(plan.get("frequency") or "weekly").lower()
    if frequency == "monthly":
        return _is_first_weekday_of_month(run_at)
    return True


def us_market_opened_for_plan(run_at: datetime | None = None) -> bool:
    run_at = run_at or now_kst()
    ny_time = run_at.astimezone(NY)
    if ny_time.weekday() >= 5:
        return False
    market_open = ny_time.replace(hour=9, minute=30, second=0, microsecond=0)
    return ny_time >= market_open


def apply_due_plan_purchases(run_at: datetime | None = None) -> dict[str, Any]:
    run_at = run_at or now_kst()
    today = run_at.strftime("%Y-%m-%d")
    portfolio = load_portfolio()
    holdings = portfolio.setdefault("holdings", [])
    usd_krw_rate = get_usd_krw_rate()
    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for index, raw_holding in enumerate(holdings):
        item = normalize_holding(raw_holding)
        plan = item.get("plan") or default_plan("KRW" if item["market"] == "KR" else "USD")
        if not plan_is_due(plan, run_at):
            continue
        if item["market"] == "US" and not us_market_opened_for_plan(run_at):
            skipped.append({"symbol": item["symbol"], "reason": "US market has not opened yet"})
            continue
        try:
            priced = get_price(item, usd_krw_rate)
            close = float(priced.get("close") or 0)
            quote_currency = priced.get("currency") or ("KRW" if item["market"] == "KR" else "USD")
            plan_currency = "KRW" if item["market"] == "KR" else sanitize_currency(plan.get("currency"), "KRW")
            quote_amount = to_quote_amount(float(plan.get("amount") or 0), plan_currency, quote_currency, usd_krw_rate)
            quantity = quote_amount / close if close and quote_amount else 0
            if not quantity:
                skipped.append({"symbol": item["symbol"], "reason": "price or amount missing"})
                continue
            current_qty = float(item.get("quantity") or 0)
            current_avg = to_quote_amount(
                float(item.get("average_price") or 0),
                item.get("average_price_currency") or quote_currency,
                quote_currency,
                usd_krw_rate,
            )
            next_qty = current_qty + quantity
            item["quantity"] = round(next_qty, 8)
            item["average_price"] = round(((current_qty * current_avg) + (quantity * close)) / next_qty, 4)
            item["average_price_currency"] = quote_currency
            item.setdefault("transactions", []).insert(
                0,
                {
                    "date": today,
                    "side": "buy",
                    "quantity": round(quantity, 8),
                    "price": close,
                    "price_currency": quote_currency,
                    "memo": f"자동 주식 모으기 반영 · 가격일 {priced.get('date') or today}",
                },
            )
            item["transactions"] = item["transactions"][:20]
            plan["last_executed_date"] = today
            plan["last_executed_at"] = run_at.isoformat()
            plan["last_executed_quantity"] = round(quantity, 8)
            plan["last_executed_price"] = close
            plan["last_executed_price_date"] = priced.get("date") or today
            plan["last_executed_mode"] = "auto"
            item["plan"] = plan
            holdings[index] = item
            applied.append(
                {
                    "name": item["name"],
                    "symbol": item["symbol"],
                    "market": item["market"],
                    "quantity": round(quantity, 8),
                    "price": close,
                    "currency": quote_currency,
                    "amount": float(plan.get("amount") or 0),
                    "amount_currency": plan_currency,
                }
            )
        except Exception as exc:
            skipped.append({"symbol": item.get("symbol"), "reason": str(exc)})

    if applied:
        save_portfolio(portfolio)
    return {"date": today, "applied": applied, "skipped": skipped}


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
    sentences = pick_key_sentences(translated_body, title, 4)
    if sentences:
        easy_sentences = [make_easy_sentence(sentence) for sentence in sentences]
        detail = " ".join(easy_sentences[1:3]) if len(easy_sentences) > 1 else easy_sentences[0]
        summary = [
            f"무슨 일: {easy_sentences[0]}",
            f"왜 중요: {detail}",
            f"쉽게 말하면: {simple_news_context(item, sentences).replace('쉽게 말하면, ', '')}",
            f"내 포트폴리오 영향: {portfolio_connection(item)}",
        ]
    else:
        summary = [
            f"무슨 일: '{title}'에 관한 뉴스입니다.",
            f"왜 중요: 원문 본문을 충분히 읽지 못했지만 제목상 내 보유 종목과 관련된 시장 흐름입니다.",
            f"쉽게 말하면: {simple_news_context(item, []).replace('쉽게 말하면, ', '')}",
            f"내 포트폴리오 영향: {portfolio_connection(item)}",
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


def format_money(value: float, currency: str, usd_krw_rate: float | None = None, dual: bool = False) -> str:
    if currency == "KRW":
        return f"{value:,.0f}원"
    text = f"${value:,.2f}"
    if dual and usd_krw_rate:
        text += f" (약 {to_krw_amount(value, currency, usd_krw_rate):,.0f}원)"
    return text


def format_change(item: dict[str, Any]) -> str:
    if item.get("change") is None:
        return "등락 정보 없음"
    sign = "+" if item["change"] > 0 else "-" if item["change"] < 0 else ""
    if item["currency"] == "KRW":
        change = f"{sign}{abs(float(item['change'])):,.0f}원"
    else:
        krw_change = item.get("krw_change")
        change = f"{sign}${abs(float(item['change'])):,.2f}"
        if krw_change is not None:
            change += f" / {sign}{abs(float(krw_change)):,.0f}원"
    pct = f"{sign}{abs(float(item['change_pct']))}%"
    return f"{format_money(item['close'], item['currency'], item.get('usd_krw_rate'), dual=True)} ({change}, {pct})"


def news_tone(news_items: list[dict[str, str]]) -> tuple[int, int]:
    combined = " ".join(f"{item.get('title_ko', '')} {item.get('summary', '')}" for item in news_items).lower()
    positive_terms = ["상승", "강세", "개선", "호실적", "성장", "수혜", "기대", "반등", "돌파", "완화"]
    caution_terms = ["하락", "약세", "부진", "우려", "위험", "리스크", "둔화", "관세", "규제", "경고"]
    positive = sum(1 for term in positive_terms if term in combined)
    caution = sum(1 for term in caution_terms if term in combined)
    return positive, caution


def action_notes(snapshot: dict[str, Any], news_items: list[dict[str, str]] | None = None) -> list[str]:
    notes = []
    news_items = news_items or []
    positive_news, caution_news = news_tone(news_items)
    holdings = [item for item in snapshot["holdings"] if not item.get("error")]
    samsung = next((h for h in snapshot["holdings"] if h.get("symbol") == "005930"), None)
    qqqm = next((h for h in snapshot["holdings"] if h.get("symbol") == "QQQM"), None)
    voo = next((h for h in snapshot["holdings"] if h.get("symbol") == "VOO"), None)
    biggest_move = max(
        (item for item in holdings if item.get("change_pct") is not None),
        key=lambda item: abs(float(item.get("change_pct") or 0)),
        default=None,
    )

    if biggest_move and abs(float(biggest_move.get("change_pct") or 0)) >= 3:
        direction = "올랐습니다" if biggest_move["change_pct"] > 0 else "내렸습니다"
        notes.append(f"{biggest_move['name']}가 오늘 {biggest_move['change_pct']}% {direction}. 새 매수보다 왜 움직였는지 뉴스와 거래량을 먼저 확인하세요.")
    elif holdings:
        notes.append("오늘 가격 변동은 아주 크지 않습니다. 성급하게 바꾸기보다 기존 적립 계획을 유지해도 되는 날입니다.")

    if samsung and samsung.get("change_pct") is not None and samsung["change_pct"] > 3:
        notes.append("삼성전자는 급등 뒤 구간입니다. 추격매수보다 HBM, 반도체 수요, 외국인 수급을 확인하세요.")
    elif samsung and samsung.get("change_pct") is not None and samsung["change_pct"] < -3:
        notes.append("삼성전자는 하락폭이 커졌습니다. 손절 판단보다 실적 이슈인지 시장 전체 하락인지 먼저 나눠 보세요.")
    else:
        notes.append("삼성전자는 보유 관점으로 보되, 외국인 수급과 반도체 뉴스가 같은 방향인지 확인하세요.")

    if qqqm and qqqm.get("value", 0) > snapshot["totals"].get("USD", 0) * 0.6:
        notes.append("QQQM 비중이 높습니다. 기술주 쏠림을 줄이고 싶다면 VOO 비중을 함께 점검하세요.")
    elif qqqm and voo:
        notes.append("QQQM은 성장주, VOO는 미국 전체 시장에 가깝습니다. 오늘 미국 뉴스가 기술주 중심이면 QQQM 변동을 더 크게 보세요.")

    if caution_news > positive_news:
        notes.append("오늘 뉴스에는 주의 신호가 더 많습니다. 추가매수는 금액을 줄이거나 내일 가격을 한 번 더 보고 결정하세요.")
    elif positive_news > caution_news:
        notes.append("오늘 뉴스 톤은 비교적 긍정적입니다. 그래도 한 번에 사기보다 정해둔 적립 금액 안에서만 움직이세요.")
    else:
        notes.append("뉴스 톤은 한쪽으로 강하게 기울지 않았습니다. 가격보다 계획과 비중을 우선 기준으로 삼으세요.")

    if snapshot.get("active_plans"):
        notes.append(f"주식 모으기 {snapshot['active_plans']}개가 켜져 있습니다. 이번 주 예정 금액과 현금 여력을 확인하세요.")
    else:
        notes.append("켜진 주식 모으기가 없습니다. 매번 고민을 줄이려면 종목별 자동 적립 금액을 먼저 정하세요.")
    return notes


def build_briefing_text() -> str:
    snapshot = get_portfolio_snapshot()
    news = get_news(3)
    domestic_news = [summarize_news_item(item) for item in news["domestic"]]
    overseas_news = [summarize_news_item(item) for item in news["overseas"]]
    lines = [
        f"[포트폴리오 브리핑] {now_kst().strftime('%Y-%m-%d')}",
        f"환율: 1달러 ≈ {snapshot.get('usd_krw_rate', 0):,.2f}원",
        "",
        "가격 요약",
    ]
    total_converted = snapshot.get("totals", {}).get("KRW_CONVERTED", 0)
    if total_converted:
        lines.append(f"- 총 평가액(원화 환산): {format_money(total_converted, 'KRW')}")
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
    lines.extend(f"- {note}" for note in action_notes(snapshot, today_news))
    return "\n".join(lines)


def build_briefing_html(text: str | None = None) -> str:
    text = text or build_briefing_text()
    escaped = html.escape(text).replace("\n", "<br>")
    return f"<div style=\"font-family:Arial,sans-serif;line-height:1.55\">{escaped}</div>"


def ask_ai(question: str) -> str:
    load_env()
    question = question.strip()
    if not question:
        return "질문을 입력하세요."
    snapshot = get_portfolio_snapshot()
    context = {
        "snapshot": snapshot,
        "today_actions": action_notes(snapshot),
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
        if not is_ai_provider_error(answer):
            return answer
        return local_projection_answer(question, snapshot, answer)
    if os.environ.get("GEMINI_API_KEY"):
        answer = ask_gemini(prompt)
        if not is_ai_provider_error(answer):
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
    if not is_ai_provider_error(reason) and not any(word in question for word in ["1년", "일년", "12개월", "모으면", "매주", "매월", "얼마", "리스크", "위험", "해야"]):
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
        "외부 AI 호출이 막혀서 Briefolio 내장 분석 모드로 답합니다.",
        f"원인: {friendly_ai_error(reason)}",
        "",
        "1년 적립 시뮬레이션",
    ]
    for item in candidates:
        plan = item.get("plan") or {}
        amount = float(plan.get("amount") or 0)
        plan_currency = sanitize_currency(plan.get("currency"), item.get("currency", "KRW"))
        rate = float(snapshot.get("usd_krw_rate") or item.get("usd_krw_rate") or get_usd_krw_rate())
        if "만원" in question:
            amount = 10000
            plan_currency = "KRW"
        if "10만원" in question:
            amount = 100000
            plan_currency = "KRW"
        if not amount:
            continue
        periods = 52 if plan.get("frequency", "weekly") == "weekly" or "매주" in question else 12
        total = amount * periods
        total_quote = to_quote_amount(total, plan_currency, item.get("currency", "KRW"), rate)
        close = float(item.get("close") or 0)
        shares = total_quote / close if close else 0
        down = total_quote * 0.8
        flat = total_quote
        up = total_quote * 1.2
        lines.extend(
            [
                f"- {item['name']}: {format_money(amount, plan_currency, rate, dual=True)}씩 {periods}회",
                f"  총 투입금: {format_money(total, plan_currency, rate, dual=True)}",
                f"  현재가 기준 예상 매수 수량: {shares:,.6f}주",
                f"  단순 시나리오: -20% {format_money(down, item['currency'], rate, dual=True)} / 0% {format_money(flat, item['currency'], rate, dual=True)} / +20% {format_money(up, item['currency'], rate, dual=True)}",
            ]
        )
    if len(lines) == 4:
        lines.append("계산할 적립 금액이 없습니다. 주식 모으기 금액을 먼저 설정해 주세요.")
    lines.extend(["", *[f"오늘 체크: {note}" for note in action_notes(snapshot)[:3]]])
    lines.append("정확한 수익은 실제 매수 시점별 가격, 환율, 세금, 수수료에 따라 달라집니다.")
    return "\n".join(lines)


def is_ai_provider_error(message: str) -> bool:
    lowered = (message or "").lower()
    markers = [
        "quota",
        "billing",
        "insufficient",
        "rate limit",
        "api key",
        "invalid",
        "timeout",
        "timed out",
        "할당량",
        "결제",
        "호출 실패",
    ]
    return any(marker in lowered or marker in message for marker in markers)


def friendly_ai_error(message: str) -> str:
    lowered = (message or "").lower()
    if "quota" in lowered or "billing" in lowered or "insufficient" in lowered:
        return "OpenAI 계정의 사용량 한도 또는 결제 설정 문제입니다. 코드 문제가 아니라 계정에서 크레딧/결제를 켜야 외부 AI가 동작합니다."
    if "api key" in lowered or "invalid" in lowered:
        return "AI API 키가 없거나 잘못되었습니다. Cloudflare Pages와 로컬 .env에 같은 키가 들어가야 합니다."
    if "timeout" in lowered or "timed out" in lowered:
        return "AI 응답이 너무 오래 걸렸습니다. 앱은 자동으로 내장 분석 답변으로 전환했습니다."
    return "외부 AI 제공자가 일시적으로 응답하지 않았습니다."


def parse_json_block(text: str) -> dict[str, Any] | None:
    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    match = re.search(r"\{[\s\S]*\}", cleaned)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def normalize_capture_result(data: dict[str, Any] | None) -> dict[str, Any]:
    data = data or {}
    holdings = []
    for raw in data.get("holdings") or []:
        symbol = str(raw.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        market = str(raw.get("market") or ("KR" if symbol.isdigit() else "US")).strip().upper()
        market = "KR" if market == "KR" else "US"
        currency = "KRW" if market == "KR" else sanitize_currency(raw.get("average_price_currency"), "USD")
        holdings.append(
            {
                "name": str(raw.get("name") or symbol).strip(),
                "symbol": symbol,
                "market": market,
                "quantity": float(raw.get("quantity") or 0),
                "average_price": float(raw.get("average_price") or 0),
                "average_price_currency": currency,
            }
        )
    return {
        "summary": str(data.get("summary") or "캡처에서 읽은 보유 종목을 확인했습니다."),
        "warnings": [str(item) for item in data.get("warnings") or []],
        "holdings": holdings,
    }


def analyze_capture_image(image_base64: str, mime_type: str = "image/png") -> dict[str, Any]:
    prompt = (
        "토스증권 보유 주식 캡처를 읽어 JSON만 반환해. "
        "필드: summary, warnings, holdings. holdings 각 항목은 "
        "name, symbol, market(US 또는 KR), quantity, average_price, average_price_currency(KRW 또는 USD). "
        "화면에 안 보이는 값은 0으로 두고 추측은 warnings에 적어."
    )
    if os.environ.get("OPENAI_API_KEY"):
        try:
            response = requests.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": os.environ.get("OPENAI_VISION_MODEL") or os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                    "input": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "input_text", "text": prompt},
                                {"type": "input_image", "image_url": f"data:{mime_type};base64,{image_base64}"},
                            ],
                        }
                    ],
                    "max_output_tokens": 1200,
                },
                timeout=30,
            )
            data = response.json()
            if response.status_code >= 400:
                return {"summary": "AI 이미지 분석에 실패했습니다.", "holdings": [], "warnings": [data.get("error", {}).get("message") or response.text]}
            text = data.get("output_text") or ""
            if not text:
                chunks = []
                for item in data.get("output", []):
                    for content in item.get("content", []):
                        if content.get("text"):
                            chunks.append(content["text"])
                text = "\n".join(chunks)
            return normalize_capture_result(parse_json_block(text))
        except Exception as exc:
            return {"summary": "AI 이미지 분석에 실패했습니다.", "holdings": [], "warnings": [str(exc)]}
    return {
        "summary": "AI 이미지 분석 키가 없어 캡처를 읽지 못했습니다.",
        "holdings": [],
        "warnings": ["OPENAI_API_KEY를 환경 변수에 넣으면 토스 캡처를 읽을 수 있습니다."],
    }


def ask_openai(prompt: str) -> str:
    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    try:
        response = requests.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "input": prompt,
                "max_output_tokens": 900,
            },
            timeout=20,
        )
        data = response.json()
        if response.status_code >= 400:
            message = data.get("error", {}).get("message") or response.text
            return f"OpenAI 호출 실패: {message}"
    except requests.RequestException as exc:
        return f"OpenAI 호출 실패: {exc}"
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
    try:
        response = requests.post(
            url,
            params={"key": os.environ["GEMINI_API_KEY"]},
            json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.4, "maxOutputTokens": 1200},
            },
            timeout=20,
        )
        data = response.json()
        if response.status_code >= 400:
            message = data.get("error", {}).get("message") or response.text
            return f"Gemini 호출 실패: {message}"
    except requests.RequestException as exc:
        return f"Gemini 호출 실패: {exc}"
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
    msg.add_alternative(build_briefing_html(body), subtype="html")

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
        server.login(os.environ["GMAIL_USER"], os.environ["GMAIL_APP_PASSWORD"].replace(" ", ""))
        server.send_message(msg)
    config_url = os.environ.get("PORTFOLIO_CONFIG_URL")
    if config_url:
        try:
            response = requests.post(
                config_url,
                json={
                    "action": "saveLastBriefing",
                    "text": body,
                    "updatedAt": now_kst().isoformat(),
                },
                timeout=20,
            )
            response.raise_for_status()
        except Exception:
            print("[briefing] warning: failed to save last briefing to PORTFOLIO_CONFIG_URL")
