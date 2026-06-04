import { json } from "../_shared.js";

function readSupabaseConfig(env = {}) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey =
    env.SUPABASE_ANON_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "";

  return {
    enabled: Boolean(url && anonKey),
    url,
    anonKey,
  };
}

export async function onRequestGet({ env }) {
  return json(readSupabaseConfig(env), {
    headers: { "cache-control": "no-store" },
  });
}
