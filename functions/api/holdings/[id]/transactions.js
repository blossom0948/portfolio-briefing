import { fetchPortfolio, json, savePortfolio } from "../../../_shared.js";

function sanitizeCurrency(value, fallback = "KRW") {
  const currency = String(value || fallback).trim().toUpperCase();
  return ["KRW", "USD"].includes(currency) ? currency : fallback;
}

function normalizeSide(value) {
  return String(value || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";
}

function todayKst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function onRequestPost({ request, env, params }) {
  try {
    const payload = await request.json();
    const portfolio = await fetchPortfolio(env);
    const holdings = Array.isArray(portfolio.holdings) ? portfolio.holdings : [];
    const index = holdings.findIndex((item) => item.id === params.id);
    if (index < 0) return json({ error: "holding not found" }, { status: 404 });

    const item = { ...holdings[index] };
    const market = String(item.market || "").toUpperCase();
    const quoteCurrency = market === "KR" ? "KRW" : "USD";
    const side = normalizeSide(payload.side);
    const quantity = Number(payload.quantity || 0);
    const price = Number(payload.price || 0);
    if (quantity <= 0 || price <= 0) {
      return json({ error: "quantity and price must be greater than 0" }, { status: 400 });
    }

    // Saved transaction prices are assumed to already be entered in the selected currency.
    // The holding average is kept in the market quote currency: KRW for Korean stocks, USD for US stocks.
    const priceCurrency = market === "KR" ? "KRW" : sanitizeCurrency(payload.price_currency, quoteCurrency);
    const priceQuote = priceCurrency === quoteCurrency ? price : price;
    const currentQty = Number(item.quantity || 0);
    const currentAvg = Number(item.average_price || 0);
    const nextQty = side === "sell" ? Math.max(0, currentQty - quantity) : currentQty + quantity;
    const nextAvg = side === "sell"
      ? (nextQty ? currentAvg : 0)
      : ((currentQty * currentAvg) + (quantity * priceQuote)) / nextQty;

    const transaction = {
      date: String(payload.date || todayKst()),
      side,
      quantity,
      price,
      price_currency: priceCurrency,
      memo: String(payload.memo || ""),
    };

    item.quantity = Number(nextQty.toFixed(8));
    item.average_price = Number(nextAvg.toFixed(4));
    item.average_price_currency = quoteCurrency;
    item.transactions = [transaction, ...(Array.isArray(item.transactions) ? item.transactions : [])].slice(0, 20);
    holdings[index] = item;
    portfolio.holdings = holdings;

    await savePortfolio(env, portfolio);
    return json(item);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
