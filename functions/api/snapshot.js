import { buildSnapshot, json } from "../_shared.js";

export async function onRequestGet({ env }) {
  try {
    return json(await buildSnapshot(env));
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
