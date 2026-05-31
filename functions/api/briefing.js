import { fetchLastBriefing, json } from "../_shared.js";

export async function onRequestGet({ env }) {
  try {
    return json(await fetchLastBriefing(env));
  } catch (error) {
    return json({ text: `브리핑 불러오기 실패: ${error.message}`, updatedAt: "" });
  }
}
