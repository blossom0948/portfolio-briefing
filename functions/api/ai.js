import { buildSnapshot, fetchLastBriefing, json, localProjection } from "../_shared.js";

function providerProblem(message = "") {
  return /quota|billing|insufficient|rate limit|api key|invalid|timeout|timed out|할당량|결제|호출 실패/i.test(message);
}

async function withTimeout(promiseFactory, ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promiseFactory(controller.signal);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("AI 응답 시간이 너무 길어 내장 분석 모드로 전환합니다.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function askOpenAI(env, prompt, override = {}) {
  const apiKey = override.apiKey || env.OPENAI_API_KEY;
  const model = override.model || env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await withTimeout((signal) => fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 900,
    }),
    signal,
  }));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OpenAI 호출 실패");
  return data.output_text || data.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("") || "AI 응답을 읽지 못했습니다.";
}

async function askGemini(env, prompt, override = {}) {
  const apiKey = override.apiKey || env.GEMINI_API_KEY;
  const model = override.model || env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await withTimeout((signal) => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
    }),
    signal,
  }));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Gemini 호출 실패");
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "AI 응답을 읽지 못했습니다.";
}

function providerFromKey(selectedProvider = "", apiKey = "") {
  const selected = String(selectedProvider || "").trim().toLowerCase();
  const key = String(apiKey || "").trim();
  if (key.startsWith("sk-")) return "openai";
  if (key.startsWith("AIza")) return "gemini";
  if (selected === "openai" || selected === "gemini") return selected;
  return "";
}

export async function onRequestPost({ request, env }) {
  try {
    const { question = "", aiProvider = "", aiApiKey = "", aiModel = "" } = await request.json();
    const snapshot = await buildSnapshot(env);
    const briefing = await fetchLastBriefing(env);
    const prompt = [
      "너는 개인 포트폴리오 분석 도우미다.",
      "한국어로 답하고, 계산 가정과 시나리오를 분명히 보여줘라.",
      "투자 판단을 단정하지 말고 체크포인트 중심으로 답해라.",
      "",
      "포트폴리오:",
      JSON.stringify(snapshot),
      "",
      "최근 브리핑:",
      briefing.text || "",
      "",
      "질문:",
      question,
    ].join("\n");
    const warnings = [];
    // 핵심 수정: 브라우저 API 키는 무시하고 Cloudflare 환경변수만 사용한다.

    if (env.OPENAI_API_KEY) {
      try {
        return json({ answer: await askOpenAI(env, prompt) });
      } catch (error) {
        if (!providerProblem(error.message)) throw error;
        warnings.push(`OpenAI: ${error.message}`);
      }
    }
    if (env.GEMINI_API_KEY) {
      try {
        return json({ answer: await askGemini(env, prompt) });
      } catch (error) {
        if (!providerProblem(error.message)) throw error;
        warnings.push(`Gemini: ${error.message}`);
      }
    }
    return json({ answer: localProjection(question, snapshot, warnings.length ? `외부 AI 문제: ${warnings.join(" / ")}` : "AI 키가 없어 내장 계산 모드로 답합니다.") });
  } catch (error) {
    const snapshot = await buildSnapshot(env).catch(() => ({ holdings: [], totals: {}, active_plans: 0 }));
    return json({ answer: localProjection("", snapshot, `AI 서버 처리 문제: ${error.message}`) });
  }
}
