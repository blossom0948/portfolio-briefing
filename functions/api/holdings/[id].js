import { fetchPortfolio, json, savePortfolio } from "../../_shared.js";

function sanitizeCurrency(value, fallback = "KRW") {
  const currency = String(value || fallback).trim().toUpperCase();
  return ["KRW", "USD"].includes(currency) ? currency : fallback;
}

function normalizeHolding(raw = {}) {
  const symbol = String(raw.symbol || "").trim().toUpperCase();
  const market = String(raw.market || "").trim().toUpperCase() || (/^\d+$/.test(symbol) ? "KR" : "US");
  const quoteCurrency = market === "KR" ? "KRW" : "USD";
  return {
    ...raw,
    id: raw.id,
    name: String(raw.name || symbol).trim(),
    symbol,
    market,
    quantity: Number(raw.quantity || 0),
    average_price: Number(raw.average_price || 0),
    average_price_currency: market === "KR" ? "KRW" : sanitizeCurrency(raw.average_price_currency, quoteCurrency),
    plan: raw.plan || { enabled: false, frequency: "weekly", weekday: "MO", amount: 0, currency: quoteCurrency, memo: "" },
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
  };
}

export async function onRequestPut({ request, env, params }) {
  try {
    const payload = await request.json();
    const portfolio = await fetchPortfolio(env);
    const holdings = Array.isArray(portfolio.holdings) ? portfolio.holdings : [];
    const index = holdings.findIndex((item) => item.id === params.id);
    if (index < 0) return json({ error: "holding not found" }, { status: 404 });

    holdings[index] = normalizeHolding({ ...holdings[index], ...(payload || {}), id: params.id });
    portfolio.holdings = holdings;
    await savePortfolio(env, portfolio);
    return json(holdings[index]);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const portfolio = await fetchPortfolio(env);
    portfolio.holdings = (Array.isArray(portfolio.holdings) ? portfolio.holdings : [])
      .filter((item) => item.id !== params.id);
    await savePortfolio(env, portfolio);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
