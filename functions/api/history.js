import { buildHistory, json } from "../_shared.js";

export async function onRequestGet({ env, request }) {
  try {
    const url = new URL(request.url);
    return json(await buildHistory(env, {
      symbol: url.searchParams.get("symbol") || "QQQM",
      market: url.searchParams.get("market") || "US",
      range: url.searchParams.get("range") || "6mo",
    }));
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
