import { fetchPortfolio, json, savePortfolio } from "../_shared.js";

function sanitizeCurrency(value, fallback = "KRW") {
  const currency = String(value || fallback).trim().toUpperCase();
  return ["KRW", "USD"].includes(currency) ? currency : fallback;
}

function defaultPlan(currency) {
  return {
    enabled: false,
    frequency: "weekly",
    weekday: "MO",
    amount: 0,
    currency,
    memo: "",
  };
}

function normalizeHolding(raw = {}) {
  const symbol = String(raw.symbol || "").trim().toUpperCase();
  const market = String(raw.market || "").trim().toUpperCase() || (/^\d+$/.test(symbol) ? "KR" : "US");
  const quoteCurrency = market === "KR" ? "KRW" : "USD";
  const plan = { ...defaultPlan(quoteCurrency), ...(raw.plan || {}) };

  plan.enabled = Boolean(plan.enabled);
  plan.amount = Number(plan.amount || 0);
  plan.currency = market === "KR" ? "KRW" : sanitizeCurrency(plan.currency, quoteCurrency);

  return {
    id: raw.id || crypto.randomUUID(),
    name: String(raw.name || symbol).trim(),
    symbol,
    market,
    quantity: Number(raw.quantity || 0),
    average_price: Number(raw.average_price || 0),
    average_price_currency: market === "KR" ? "KRW" : sanitizeCurrency(raw.average_price_currency, quoteCurrency),
    plan,
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
  };
}

export async function onRequestPost({ request, env }) {
  try {
    const payload = await request.json();
    const item = normalizeHolding(payload || {});
    if (!item.symbol) return json({ error: "symbol is required" }, { status: 400 });

    const portfolio = await fetchPortfolio(env);
    portfolio.holdings = Array.isArray(portfolio.holdings) ? portfolio.holdings : [];
    portfolio.holdings.push(item);
    await savePortfolio(env, portfolio);
    return json(item, { status: 201 });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
