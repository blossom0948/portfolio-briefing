const PROPERTY_KEY = "PORTFOLIO_JSON";
const LAST_BRIEFING_KEY = "LAST_BRIEFING_JSON";

function defaultPortfolio() {
  return {
    settings: {
      recipient: "blossom0948@gmail.com",
      send_time: "07:00",
      timezone: "Asia/Seoul"
    },
    holdings: [
      {
        id: "samsung-electronics",
        name: "삼성전자",
        symbol: "005930",
        market: "KR",
        quantity: 0,
        average_price: 0,
        average_price_currency: "KRW",
        plan: {
          enabled: false,
          frequency: "weekly",
          weekday: "MO",
          amount: 10000,
          currency: "KRW",
          memo: "매주 월요일 1만원 모으기"
        },
        transactions: []
      },
      {
        id: "qqqm",
        name: "QQQM",
        symbol: "QQQM",
        market: "US",
        quantity: 0,
        average_price: 0,
        average_price_currency: "USD",
        plan: {
          enabled: false,
          frequency: "weekly",
          weekday: "MO",
          amount: 10000,
          currency: "KRW",
          memo: ""
        },
        transactions: []
      },
      {
        id: "voo",
        name: "VOO",
        symbol: "VOO",
        market: "US",
        quantity: 0,
        average_price: 0,
        average_price_currency: "USD",
        plan: {
          enabled: false,
          frequency: "weekly",
          weekday: "MO",
          amount: 10000,
          currency: "KRW",
          memo: ""
        },
        transactions: []
      }
    ]
  };
}

function jsonOutput(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.app === "1") {
    return HtmlService
      .createHtmlOutputFromFile("Index")
      .setTitle("Briefolio")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (e && e.parameter && e.parameter.brief === "1") {
    return jsonOutput(getLastBriefing());
  }
  const stored = PropertiesService.getScriptProperties().getProperty(PROPERTY_KEY);
  return jsonOutput(stored ? JSON.parse(stored) : defaultPortfolio());
}

function doPost(e) {
  const body = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
  const payload = JSON.parse(body);
  if (payload.action === "saveLastBriefing") {
    PropertiesService.getScriptProperties().setProperty(LAST_BRIEFING_KEY, JSON.stringify({
      text: payload.text || "",
      updatedAt: payload.updatedAt || new Date().toISOString()
    }));
    return jsonOutput({ ok: true });
  }
  const portfolio = payload;
  PropertiesService.getScriptProperties().setProperty(PROPERTY_KEY, JSON.stringify(portfolio));
  return jsonOutput({ ok: true, savedAt: new Date().toISOString() });
}

function getPortfolio() {
  const stored = PropertiesService.getScriptProperties().getProperty(PROPERTY_KEY);
  return stored ? JSON.parse(stored) : defaultPortfolio();
}

function savePortfolio(portfolio) {
  PropertiesService.getScriptProperties().setProperty(PROPERTY_KEY, JSON.stringify(portfolio));
  return { ok: true, savedAt: new Date().toISOString() };
}

function getLastBriefing() {
  const stored = PropertiesService.getScriptProperties().getProperty(LAST_BRIEFING_KEY);
  return stored ? JSON.parse(stored) : { text: "아직 저장된 브리핑이 없습니다. GitHub Actions를 한 번 실행하면 여기에 표시됩니다.", updatedAt: "" };
}

function askAi(question) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty("GEMINI_API_KEY");
  const configuredModel = props.getProperty("GEMINI_MODEL") || "gemini-2.5-flash-lite";
  const model = configuredModel === "gemini-2.0-flash" ? "gemini-2.5-flash-lite" : configuredModel;
  if (!apiKey) {
    return "GEMINI_API_KEY가 아직 설정되지 않았습니다. Apps Script의 프로젝트 설정 > 스크립트 속성에 GEMINI_API_KEY를 추가하세요.";
  }

  const portfolio = getPortfolio();
  const lastBriefing = getLastBriefing();
  const prompt = [
    "너는 개인 포트폴리오 브리핑 도우미다.",
    "답변은 한국어로, 초보 투자자가 이해하기 쉽게, 숫자는 가정을 분명히 밝히고 계산해라.",
    "투자 조언을 단정하지 말고, 시나리오와 체크포인트 중심으로 답해라.",
    "",
    "현재 포트폴리오 JSON:",
    JSON.stringify(portfolio),
    "",
    "최근 브리핑:",
    lastBriefing.text || "",
    "",
    "사용자 질문:",
    question
  ].join("\n");

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(apiKey);
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1200
      }
    })
  });
  const code = response.getResponseCode();
  const data = JSON.parse(response.getContentText());
  if (code >= 400) {
    return "AI 호출 실패: " + (data.error && data.error.message ? data.error.message : response.getContentText());
  }
  return data.candidates && data.candidates[0] && data.candidates[0].content
    ? data.candidates[0].content.parts.map(part => part.text || "").join("")
    : "AI 응답을 읽지 못했습니다.";
}
