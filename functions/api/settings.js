import { fetchPortfolio, json, savePortfolio } from "../_shared.js";

function normalizeSettings(current = {}, payload = {}) {
  const next = { ...current };
  for (const key of ["recipient", "send_time", "timezone"]) {
    if (key in payload) next[key] = String(payload[key] || "").trim();
  }
  return next;
}

async function updateSettings(request, env) {
  try {
    const payload = await request.json();
    const portfolio = await fetchPortfolio(env);
    portfolio.settings = normalizeSettings(portfolio.settings || {}, payload || {});
    await savePortfolio(env, portfolio);
    return json(portfolio.settings);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

export const onRequestPut = updateSettings;
export const onRequestPost = updateSettings;
