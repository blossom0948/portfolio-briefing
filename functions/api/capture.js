import { json } from "../_shared.js";

const CAPTURE_PROMPT = [
  "토스증권 보유 주식 화면 캡처를 읽어 JSON만 반환해.",
  "반환 형식은 반드시 {\"summary\":\"...\",\"warnings\":[],\"holdings\":[]} 이어야 한다.",
  "holdings 각 항목은 name, symbol, market, quantity, average_price, average_price_currency 필드를 가져야 한다.",
  "market은 한국 주식이면 KR, 미국 주식이면 US로 써라.",
  "average_price_currency는 KRW 또는 USD만 써라.",
  "화면에 보이는 보유 수량과 평단만 사용하고, 보이지 않는 값은 0으로 둬라.",
  "추측한 값이 있으면 warnings에 짧게 적어라.",
].join("\n");

function sanitizeError(message = "") {
  return String(message)
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/AIza[A-Za-z0-9_-]+/g, "AIza***")
    .slice(0, 800);
}

function friendlyProviderError(provider, message = "") {
  const text = sanitizeError(message);
  const lowered = text.toLowerCase();
  if (provider === "gemini" && lowered.includes("free_tier") && lowered.includes("limit: 0")) {
    return "Gemini API 무료 할당량이 현재 0으로 막혀 있습니다. Cloudflare 환경변수에 OPENAI_API_KEY를 추가하거나, Google AI Studio/Cloud에서 Gemini 결제/쿼터를 활성화해야 합니다.";
  }
  if (lowered.includes("quota") || lowered.includes("rate-limit") || lowered.includes("rate limit")) {
    return `${provider} 사용량 한도에 걸렸습니다. 다른 provider 서버키를 Cloudflare 환경변수에 추가하거나 해당 provider의 결제/쿼터 설정을 확인해야 합니다.`;
  }
  if (lowered.includes("incorrect api key") || lowered.includes("invalid api key") || lowered.includes("unauthorized")) {
    return `${provider} API 키가 잘못되었습니다. Cloudflare Pages 환경변수에 들어간 키를 다시 확인해야 합니다.`;
  }
  return text;
}

function parseJsonText(text = "") {
  const cleaned = String(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`AI 응답이 JSON이 아닙니다: ${cleaned.slice(0, 240)}`);
  return JSON.parse(match[0]);
}

function normalizeMarket(symbol, market) {
  const rawMarket = String(market || "").trim().toUpperCase();
  if (rawMarket === "KR" || rawMarket === "US") return rawMarket;
  return /^\d+$/.test(String(symbol || "")) ? "KR" : "US";
}

function normalizeCurrency(currency, market) {
  const rawCurrency = String(currency || "").trim().toUpperCase();
  if (rawCurrency === "KRW" || rawCurrency === "USD") return rawCurrency;
  return market === "KR" ? "KRW" : "USD";
}

function normalizeCapture(data) {
  const holdings = Array.isArray(data?.holdings) ? data.holdings : [];
  return {
    summary: String(data?.summary || "캡처에서 읽은 보유 종목을 확인했습니다."),
    warnings: Array.isArray(data?.warnings) ? data.warnings.map((item) => String(item)) : [],
    holdings: holdings.map((item) => {
      const symbol = String(item.symbol || "").trim().toUpperCase();
      const market = normalizeMarket(symbol, item.market);
      return {
        name: String(item.name || symbol).trim(),
        symbol,
        market,
        quantity: Number(item.quantity || 0),
        average_price: Number(item.average_price || 0),
        average_price_currency: normalizeCurrency(item.average_price_currency, market),
      };
    }).filter((item) => item.symbol && Number.isFinite(item.quantity) && item.quantity >= 0),
  };
}

function providerFromKey(selectedProvider = "", apiKey = "") {
  const selected = String(selectedProvider || "").trim().toLowerCase();
  const key = String(apiKey || "").trim();
  // 핵심 수정: 사용자가 provider를 잘못 골라도 키 prefix로 실제 provider를 우선 판단한다.
  if (key.startsWith("sk-")) return "openai";
  if (key.startsWith("AIza")) return "gemini";
  if (selected === "openai" || selected === "gemini") return selected;
  return "";
}

function errorMessageFromResponse(data, fallback) {
  return data?.error?.message || data?.error?.status || data?.message || fallback;
}

async function askOpenAIVision({ apiKey, model, image, mimeType }) {
  // 핵심 수정: 이미지 입력은 Responses API 대신 vision에서 안정적인 Chat Completions 형식으로 보낸다.
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: CAPTURE_PROMPT },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${image}`, detail: "high" } },
        ],
      }],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${errorMessageFromResponse(data, "OpenAI vision failed")}`);
  const text = data.choices?.[0]?.message?.content || "";
  return normalizeCapture(parseJsonText(text));
}

async function askGeminiVision({ apiKey, model, image, mimeType }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: CAPTURE_PROMPT },
          { inline_data: { mime_type: mimeType, data: image } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${errorMessageFromResponse(data, "Gemini vision failed")}`);
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  return normalizeCapture(parseJsonText(text));
}

function configuredProviders(env, body) {
  const providers = [];
  // 핵심 수정: 브라우저에서 넘어온 API 키는 사용하지 않는다.
  // 키는 Cloudflare Pages 환경변수에만 보관해야 휴대폰/PC가 같은 설정을 쓴다.

  if (env.OPENAI_API_KEY) {
    providers.push({
      source: "server",
      provider: "openai",
      model: env.OPENAI_VISION_MODEL || "gpt-4o-mini",
      apiKey: env.OPENAI_API_KEY,
    });
  }

  if (env.GEMINI_API_KEY) {
    providers.push({
      source: "server",
      provider: "gemini",
      model: env.GEMINI_MODEL || "gemini-2.0-flash",
      apiKey: env.GEMINI_API_KEY,
    });
  }

  return providers;
}

async function callProvider(config, image, mimeType) {
  const input = { apiKey: config.apiKey, model: config.model, image, mimeType };
  if (config.provider === "openai") return askOpenAIVision(input);
  if (config.provider === "gemini") return askGeminiVision(input);
  throw new Error(`지원하지 않는 provider입니다: ${config.provider}`);
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const image = String(body.image || "");
    const mimeType = String(body.mimeType || "image/png");
    if (!image) return json({ error: "image is required" }, { status: 400 });

    const providers = configuredProviders(env, body);
    if (!providers.length) {
      return json({
        summary: "AI 이미지 분석 키가 없어 캡처를 읽지 못했습니다.",
        holdings: [],
        warnings: ["브라우저 AI 키 또는 Cloudflare Pages 환경변수 키가 필요합니다."],
        attempts: [],
      });
    }

    const attempts = [];
    const warnings = [];
    for (const config of providers) {
      const label = `${config.source} ${config.provider} ${config.model}`;
      attempts.push(label);
      try {
        const result = await callProvider(config, image, mimeType);
        return json({
          ...result,
          provider: config.provider,
          source: config.source,
          model: config.model,
          attempts,
        });
      } catch (error) {
        // 핵심 수정: quota로 뭉개지 않고 실제 provider/status/error를 그대로 보여준다.
        warnings.push(`${label}: ${friendlyProviderError(config.provider, error.message)}`);
      }
    }

    return json({
      summary: "설정된 AI provider가 모두 캡처를 읽지 못했습니다.",
      holdings: [],
      warnings,
      attempts,
    });
  } catch (error) {
    return json({ error: sanitizeError(error.message) }, { status: 500 });
  }
}
