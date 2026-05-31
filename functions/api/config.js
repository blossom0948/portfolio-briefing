import { fetchPortfolio, json, savePortfolio } from "../_shared.js";

export async function onRequestGet({ env }) {
  try {
    return json(await fetchPortfolio(env));
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const portfolio = await request.json();
    return json(await savePortfolio(env, portfolio));
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
