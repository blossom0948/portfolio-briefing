import { buildDiscovery, json } from "../_shared.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    return json(await buildDiscovery(env, {
      category: url.searchParams.get("category") || "us",
      query: url.searchParams.get("q") || "",
      limit: Number(url.searchParams.get("limit") || 12),
    }));
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
