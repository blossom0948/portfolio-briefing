import { fetchPortfolio, json, savePortfolio } from "../../../_shared.js";

function sanitizeCurrency(value, fallback = "KRW") {
  const currency = String(value || fallback).trim().toUpperCase();
  return ["KRW", "USD"].includes(currency) ? currency : fallback;
}

export async function onRequestPut({ request, env, params }) {
  try {
    const payload = await request.json();
    const portfolio = await fetchPortfolio(env);
    const holdings = Array.isArray(portfolio.holdings) ? portfolio.holdings : [];
    const index = holdings.findIndex((item) => item.id === params.id);
    if (index < 0) return json({ error: "holding not found" }, { status: 404 });

    const item = { ...holdings[index] };
    const market = String(item.market || "").toUpperCase();
    const quoteCurrency = market === "KR" ? "KRW" : "USD";
    const current = item.plan || {};
    const plan = { ...current };

    for (const key of ["frequency", "weekday", "memo"]) {
      if (key in payload) plan[key] = String(payload[key] || "").trim();
    }
    if ("enabled" in payload) plan.enabled = Boolean(payload.enabled);
    if ("amount" in payload) plan.amount = Number(payload.amount || 0);
    if ("currency" in payload) plan.currency = sanitizeCurrency(payload.currency, quoteCurrency);
    plan.currency = market === "KR" ? "KRW" : sanitizeCurrency(plan.currency, quoteCurrency);

    item.plan = {
      enabled: Boolean(plan.enabled),
      frequency: plan.frequency || "weekly",
      weekday: plan.weekday || "MO",
      amount: Number(plan.amount || 0),
      currency: plan.currency,
      memo: plan.memo || "",
    };
    holdings[index] = item;
    portfolio.holdings = holdings;

    await savePortfolio(env, portfolio);
    return json(item);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

export const onRequestPost = onRequestPut;
