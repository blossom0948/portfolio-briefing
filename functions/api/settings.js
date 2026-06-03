import { fetchPortfolio, json, savePortfolio } from "../_shared.js";

async function readJsonBody(request) {
  if (request && typeof request.json === "function") return request.json();
  if (request && typeof request.text === "function") {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  }
  if (request && typeof request.body === "string") return JSON.parse(request.body || "{}");
  return {};
}

function normalizeSettings(current = {}, payload = {}) {
  const next = { ...current };
  for (const key of ["recipient", "send_time", "timezone"]) {
    if (key in payload) next[key] = String(payload[key] || "").trim();
  }
  return next;
}

async function updateSettings({ request, env }) {
  try {
    const payload = await readJsonBody(request);
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
