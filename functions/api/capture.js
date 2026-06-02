import { json } from "../_shared.js";

function providerProblem(message = "") {
  return /quota|billing|insufficient|rate limit|api key|invalid|timeout|timed out/i.test(message);
}

function friendlyProviderMessage(message = "") {
  const lowered = String(message).toLowerCase();
  if (/quota|billing|insufficient|limit|usage|plan/.test(lowered)) {
    return "AI 이미지 분석 한도 또는 결제 설정 문제입니다. 코드 고장이라기보다 AI 계정에서 현재 사용량이 막힌 상태입니다.";
  }
  if (/api key|invalid|unauthorized/.test(lowered)) {
    return "AI API 키가 없거나 잘못되었습니다. Cloudflare Pages 환경 변수에서 키를 확인해야 합니다.";
  }
  if (/timeout|timed out/.test(lowered)) {
    return "AI 응답 시간이 길어져 중단되었습니다. 캡처 이미지를 조금 더 작게 다시 올려보세요.";
  }
  return "AI 이미지 분석에 실패했습니다. 잠시 뒤 다시 시도하거나 더 선명한 캡처를 올려주세요.";
}

function providerWarning(provider, model, message) {
  return `${provider}(${model}): ${friendlyProviderMessage(message)}`;
}

function parseJsonText(text = "") {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

function normalizeCapture(data) {
  const holdings = Array.isArray(data?.holdings) ? data.holdings : [];
  return {
    summary: data?.summary || "캡처에서 읽은 보유 종목을 확인했습니다.",
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
    holdings: holdings.map((item) => ({
      name: String(item.name || item.symbol || "").trim(),
      symbol: String(item.symbol || "").trim().toUpperCase(),
      market: String(item.market || (String(item.symbol || "").match(/^\d+$/) ? "KR" : "US")).trim().toUpperCase(),
      quantity: Number(item.quantity || 0),
      average_price: Number(item.average_price || 0),
      average_price_currency: String(item.average_price_currency || (String(item.market || "").toUpperCase() === "KR" ? "KRW" : "USD")).trim().toUpperCase(),
    })).filter((item) => item.symbol && item.quantity >= 0),
  };
}

async function askOpenAIVision(env, image, mimeType, override = {}) {
  const apiKey = override.apiKey || env.OPENAI_API_KEY;
  const model = override.model || env.OPENAI_VISION_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "토스증권 보유 주식 캡처를 읽어 JSON만 반환해.",
              "필드: summary, warnings, holdings.",
              "holdings 각 항목: name, symbol, market(US 또는 KR), quantity, average_price, average_price_currency(KRW 또는 USD).",
              "화면에 안 보이는 값은 0으로 두고, 추측은 warnings에 적어.",
            ].join("\n"),
          },
          { type: "input_image", image_url: `data:${mimeType};base64,${image}` },
        ],
      }],
      max_output_tokens: 1200,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OpenAI vision failed");
  const text = data.output_text || data.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("") || "";
  return { ...normalizeCapture(parseJsonText(text) || { summary: text, holdings: [], warnings: ["JSON 형식으로 읽지 못했습니다."] }), provider: "openai", model };
}

async function askGeminiVision(env, image, mimeType, override = {}) {
  const apiKey = override.apiKey || env.GEMINI_API_KEY;
  const model = override.model || env.GEMINI_MODEL || "gemini-2.0-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: "토스증권 보유 주식 캡처를 읽어 JSON만 반환해. holdings에는 name, symbol, market, quantity, average_price, average_price_currency를 넣어." },
          { inline_data: { mime_type: mimeType, data: image } },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1200 },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Gemini vision failed");
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  return { ...normalizeCapture(parseJsonText(text) || { summary: text, holdings: [], warnings: ["JSON 형식으로 읽지 못했습니다."] }), provider: "gemini", model };
}

export async function onRequestPost({ request, env }) {
  try {
    const { image = "", mimeType = "image/png", aiProvider = "", aiApiKey = "", aiModel = "" } = await request.json();
    if (!image) return json({ error: "image is required" }, { status: 400 });
    const warnings = [];
    const clientProvider = String(aiProvider || "").toLowerCase();
    const clientKey = String(aiApiKey || "").trim();

    if (clientKey && clientProvider === "openai") {
      const model = aiModel || "gpt-4o-mini";
      try {
        return json(await askOpenAIVision(env, image, mimeType, { apiKey: clientKey, model }));
      } catch (error) {
        if (!providerProblem(error.message)) throw error;
        warnings.push(providerWarning("OpenAI", model, error.message));
      }
    }

    if (clientKey && clientProvider === "gemini") {
      const model = aiModel || "gemini-2.0-flash";
      try {
        return json(await askGeminiVision(env, image, mimeType, { apiKey: clientKey, model }));
      } catch (error) {
        if (!providerProblem(error.message)) throw error;
        warnings.push(providerWarning("Gemini", model, error.message));
      }
    }

    if (env.OPENAI_API_KEY) {
      const model = env.OPENAI_VISION_MODEL || "gpt-4o-mini";
      try {
        return json(await askOpenAIVision(env, image, mimeType));
      } catch (error) {
        if (!providerProblem(error.message)) throw error;
        warnings.push(providerWarning("OpenAI", model, error.message));
      }
    }
    if (env.GEMINI_API_KEY) {
      const model = env.GEMINI_MODEL || "gemini-2.0-flash";
      try {
        return json(await askGeminiVision(env, image, mimeType));
      } catch (error) {
        if (!providerProblem(error.message)) throw error;
        warnings.push(providerWarning("Gemini", model, error.message));
      }
    }
    if (warnings.length) {
      return json({ summary: "설정된 AI provider가 모두 캡처를 읽지 못했습니다.", holdings: [], warnings });
    }
    return json({ summary: "AI 이미지 분석 키가 없어 캡처를 읽지 못했습니다.", holdings: [], warnings: ["OPENAI_API_KEY 또는 GEMINI_API_KEY를 Cloudflare Pages 환경 변수에 넣어야 합니다."] });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
