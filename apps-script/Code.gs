const PROPERTY_KEY = "PORTFOLIO_JSON";

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
        plan: {
          enabled: false,
          frequency: "weekly",
          weekday: "MO",
          amount: 10,
          currency: "USD",
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
        plan: {
          enabled: false,
          frequency: "weekly",
          weekday: "MO",
          amount: 10,
          currency: "USD",
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
  const stored = PropertiesService.getScriptProperties().getProperty(PROPERTY_KEY);
  return jsonOutput(stored ? JSON.parse(stored) : defaultPortfolio());
}

function doPost(e) {
  const body = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
  const portfolio = JSON.parse(body);
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
