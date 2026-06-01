export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

export function defaultPortfolio() {
  return {
    settings: { recipient: "blossom0948@gmail.com", send_time: "07:00", timezone: "Asia/Seoul" },
    holdings: [
      {
        id: "samsung-electronics",
        name: "삼성전자",
        symbol: "005930",
        market: "KR",
        quantity: 0,
        average_price: 0,
        average_price_currency: "KRW",
        plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 10000, currency: "KRW", memo: "매주 월요일 1만원 모으기" },
        transactions: [],
      },
      {
        id: "qqqm",
        name: "QQQM",
        symbol: "QQQM",
        market: "US",
        quantity: 0,
        average_price: 0,
        average_price_currency: "USD",
        plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 10000, currency: "KRW", memo: "" },
        transactions: [],
      },
      {
        id: "voo",
        name: "VOO",
        symbol: "VOO",
        market: "US",
        quantity: 0,
        average_price: 0,
        average_price_currency: "USD",
        plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 10000, currency: "KRW", memo: "" },
        transactions: [],
      },
    ],
  };
}

function configUrl(env) {
  if (!env.PORTFOLIO_CONFIG_URL) {
    throw new Error("Cloudflare 환경 변수 PORTFOLIO_CONFIG_URL이 없습니다.");
  }
  return env.PORTFOLIO_CONFIG_URL;
}

export async function fetchPortfolio(env) {
  const response = await fetch(configUrl(env), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`설정 불러오기 실패: ${response.status}`);
  const data = await response.json();
  return { ...defaultPortfolio(), ...data, holdings: data.holdings || defaultPortfolio().holdings };
}

export async function savePortfolio(env, portfolio) {
  const response = await fetch(configUrl(env), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(portfolio),
  });
  if (!response.ok) throw new Error(`설정 저장 실패: ${response.status}`);
  return { ok: true };
}

export async function fetchLastBriefing(env) {
  const url = configUrl(env) + (configUrl(env).includes("?") ? "&" : "?") + "brief=1";
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) return buildLiveBriefing(env, "저장된 브리핑을 읽지 못해 현재 데이터로 즉시 생성했습니다.");
  const data = await response.json();
  const text = String(data.text || "");
  if (!text || text.includes("아직 저장된 브리핑이 없습니다")) {
    return buildLiveBriefing(env, "저장된 브리핑이 없어 현재 데이터로 즉시 생성했습니다.");
  }
  return data;
}

function normalizeCurrency(value, fallback = "KRW") {
  const currency = String(value || fallback).toUpperCase();
  return ["KRW", "USD"].includes(currency) ? currency : fallback;
}

async function usdKrwRate(env = {}) {
  const fallback = Number(env.USD_KRW_FALLBACK || 1350);
  try {
    const price = await yahooPrice("KRW=X");
    return Number(price.close || fallback);
  } catch {
    return fallback;
  }
}

function toQuoteAmount(amount, fromCurrency, quoteCurrency, rate) {
  const source = normalizeCurrency(fromCurrency, quoteCurrency);
  const target = normalizeCurrency(quoteCurrency, source);
  const value = Number(amount || 0);
  if (source === target) return value;
  if (source === "KRW" && target === "USD") return rate ? value / rate : 0;
  if (source === "USD" && target === "KRW") return value * rate;
  return value;
}

function toKrwAmount(amount, currency, rate) {
  return toQuoteAmount(amount, currency, "KRW", rate);
}

const DISCOVERY_PRESETS = {
  us: [
    ["NVDA", "NVIDIA"], ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["AMZN", "Amazon"],
    ["GOOGL", "Alphabet"], ["META", "Meta Platforms"], ["TSLA", "Tesla"], ["AVGO", "Broadcom"],
    ["NFLX", "Netflix"], ["PLTR", "Palantir"], ["SOFI", "SoFi Technologies"], ["RKLB", "Rocket Lab"],
  ].map(([symbol, name]) => ({ symbol, name, market: "US", category: "해외주식" })),
  kr: [
    ["005930", "삼성전자"], ["000660", "SK하이닉스"], ["373220", "LG에너지솔루션"], ["207940", "삼성바이오로직스"],
    ["005380", "현대차"], ["000270", "기아"], ["035420", "NAVER"], ["035720", "카카오"],
    ["068270", "셀트리온"], ["005490", "POSCO홀딩스"], ["105560", "KB금융"], ["055550", "신한지주"],
  ].map(([symbol, name]) => ({ symbol, name, market: "KR", category: "국내주식" })),
  etf: [
    ["VOO", "Vanguard S&P 500 ETF", "US"], ["QQQM", "Invesco NASDAQ 100 ETF", "US"], ["SPY", "SPDR S&P 500 ETF", "US"],
    ["QQQ", "Invesco QQQ Trust", "US"], ["VTI", "Vanguard Total Stock Market ETF", "US"], ["SCHD", "Schwab U.S. Dividend Equity ETF", "US"],
    ["SOXX", "iShares Semiconductor ETF", "US"], ["SOXL", "Direxion Daily Semiconductor Bull 3X", "US"],
    ["069500", "KODEX 200", "KR"], ["360750", "TIGER 미국S&P500", "KR"], ["133690", "TIGER 미국나스닥100", "KR"],
  ].map(([symbol, name, market]) => ({ symbol, name, market, category: "ETF" })),
  bond: [
    ["TLT", "iShares 20+ Year Treasury Bond ETF", "US"], ["IEF", "iShares 7-10 Year Treasury Bond ETF", "US"],
    ["SHY", "iShares 1-3 Year Treasury Bond ETF", "US"], ["BND", "Vanguard Total Bond Market ETF", "US"],
    ["AGG", "iShares Core U.S. Aggregate Bond ETF", "US"], ["TMF", "Direxion Daily 20+ Year Treasury Bull 3X", "US"],
    ["148070", "KOSEF 국고채10년", "KR"], ["305080", "TIGER 미국채10년선물", "KR"],
  ].map(([symbol, name, market]) => ({ symbol, name, market, category: "채권" })),
};

async function yahooSearchAssets(query, limit = 10) {
  if (!String(query || "").trim()) return [];
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=${limit}&newsCount=0&enableFuzzyQuery=true`;
    const response = await fetch(url, { headers: { "user-agent": "Briefolio/1.0" } });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.quotes || [])
      .filter((quote) => ["EQUITY", "ETF", "MUTUALFUND"].includes(String(quote.quoteType || "").toUpperCase()))
      .map((quote) => {
        const rawSymbol = String(quote.symbol || "").toUpperCase();
        const market = rawSymbol.endsWith(".KS") || rawSymbol.endsWith(".KQ") || ["KSC", "KOE"].includes(String(quote.exchange || "").toUpperCase()) ? "KR" : "US";
        const symbol = rawSymbol.replace(".KS", "").replace(".KQ", "");
        return {
          symbol,
          name: quote.shortname || quote.longname || symbol,
          market,
          category: String(quote.quoteType || "").toUpperCase() === "ETF" ? "ETF" : (market === "KR" ? "국내주식" : "해외주식"),
        };
      });
  } catch {
    return [];
  }
}

async function quoteDiscoveryAsset(asset, rate) {
  const yahooSymbol = asset.market === "KR" && /^\d+$/.test(asset.symbol) ? `${asset.symbol}.KS` : asset.symbol;
  try {
    const price = await yahooPrice(yahooSymbol);
    const close = Number(price.close || 0);
    const previous = Number(price.previous || close);
    const currency = asset.market === "KR" ? "KRW" : "USD";
    return {
      ...asset,
      currency,
      close,
      date: price.date,
      change: close - previous,
      change_pct: previous ? ((close / previous - 1) * 100) : null,
      krw_close: toKrwAmount(close, currency, rate),
    };
  } catch (error) {
    return { ...asset, currency: asset.market === "KR" ? "KRW" : "USD", error: error.message };
  }
}

export async function buildDiscovery(env, { category = "us", query = "", limit = 12 } = {}) {
  const activeCategory = DISCOVERY_PRESETS[category] ? category : "us";
  const searchText = String(query || "").trim();
  let base = searchText ? await yahooSearchAssets(searchText, limit * 2) : DISCOVERY_PRESETS[activeCategory];
  if (searchText) {
    const lower = searchText.toLowerCase();
    const presetMatches = Object.values(DISCOVERY_PRESETS).flat().filter((item) => (
      item.symbol.toLowerCase().includes(lower) || item.name.toLowerCase().includes(lower)
    ));
    base = [...presetMatches, ...base];
  }
  const seen = new Set();
  const unique = [];
  for (const item of base) {
    const key = `${item.market}:${item.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  const rate = await usdKrwRate(env);
  const items = await Promise.all(unique.map((item) => quoteDiscoveryAsset(item, rate)));
  return { category: activeCategory, query: searchText, usd_krw_rate: rate, items };
}

async function yahooPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10d&interval=1d`;
  const response = await fetch(url, { headers: { "user-agent": "Briefolio/1.0" } });
  if (!response.ok) throw new Error(`${symbol} 가격 조회 실패`);
  const data = await response.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`${symbol} 가격 데이터 없음`);
  const quote = result.indicators?.quote?.[0] || {};
  const closes = (quote.close || []).filter((value) => typeof value === "number");
  const timestamps = result.timestamp || [];
  const close = result.meta?.regularMarketPrice || closes.at(-1);
  const previous = closes.length > 1 ? closes.at(-2) : result.meta?.chartPreviousClose;
  const date = timestamps.length ? new Date(timestamps.at(-1) * 1000).toISOString().slice(0, 10) : "";
  return {
    close,
    previous,
    date,
  };
}

export async function yahooHistory(symbol, range = "6mo") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=1d`;
  const response = await fetch(url, { headers: { "user-agent": "Briefolio/1.0" } });
  if (!response.ok) throw new Error(`${symbol} 차트 조회 실패`);
  const data = await response.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`${symbol} 차트 데이터 없음`);
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const timestamps = result.timestamp || [];
  const points = timestamps
    .map((timestamp, index) => ({ date: new Date(timestamp * 1000).toISOString().slice(0, 10), close: closes[index] }))
    .filter((point) => typeof point.close === "number");
  if (!points.length) throw new Error(`${symbol} 차트 데이터 없음`);
  const start = points[0].close;
  const end = points.at(-1).close;
  return {
    symbol,
    range,
    points,
    start,
    end,
    change_pct: start ? ((end / start - 1) * 100) : null,
  };
}

export async function buildHistory(env, { symbol = "QQQM", market = "US", range = "6mo" } = {}) {
  const portfolio = await fetchPortfolio(env).catch(() => defaultPortfolio());
  const holding = (portfolio.holdings || []).find((item) => item.symbol === symbol || item.id === symbol) || {};
  const rawSymbol = holding.symbol || symbol;
  const rawMarket = holding.market || market;
  const yahooSymbol = rawMarket === "KR" && /^\d+$/.test(rawSymbol) ? `${rawSymbol}.KS` : rawSymbol;
  const history = await yahooHistory(yahooSymbol, range);
  return {
    ...history,
    symbol: rawSymbol,
    market: rawMarket,
    yahoo_symbol: yahooSymbol,
    name: holding.name || rawSymbol,
    currency: rawMarket === "KR" ? "KRW" : "USD",
  };
}

export async function buildSnapshot(env) {
  const portfolio = await fetchPortfolio(env);
  const holdings = [];
  const rate = await usdKrwRate(env);
  for (const holding of portfolio.holdings || []) {
    const yahooSymbol = holding.market === "KR" && /^\d+$/.test(holding.symbol) ? `${holding.symbol}.KS` : holding.symbol;
    try {
      const price = await yahooPrice(yahooSymbol);
      const close = Number(price.close || 0);
      const previous = Number(price.previous || close);
      const quantity = Number(holding.quantity || 0);
      const currency = holding.market === "KR" ? "KRW" : "USD";
      const averagePriceCurrency = holding.market === "KR" ? "KRW" : normalizeCurrency(holding.average_price_currency, currency);
      const averagePrice = toQuoteAmount(Number(holding.average_price || 0), averagePriceCurrency, currency, rate);
      const value = close * quantity;
      const cost = averagePrice * quantity;
      const plan = {
        ...(holding.plan || {}),
        currency: holding.market === "KR" ? "KRW" : normalizeCurrency(holding.plan?.currency, currency),
      };
      const planQuoteAmount = toQuoteAmount(Number(plan.amount || 0), plan.currency, currency, rate);
      holdings.push({
        ...holding,
        plan,
        currency,
        usd_krw_rate: rate,
        close,
        date: price.date,
        change: close - previous,
        change_pct: previous ? ((close / previous - 1) * 100) : null,
        value,
        cost,
        profit: cost ? value - cost : 0,
        profit_pct: cost ? ((value / cost - 1) * 100) : null,
        average_price_currency: averagePriceCurrency,
        average_price_quote: averagePrice,
        plan_quote_amount: planQuoteAmount,
        plan_estimated_shares: planQuoteAmount && close ? planQuoteAmount / close : 0,
        krw_close: toKrwAmount(close, currency, rate),
        krw_change: toKrwAmount(close - previous, currency, rate),
        krw_value: toKrwAmount(value, currency, rate),
        krw_cost: toKrwAmount(cost, currency, rate),
        krw_profit: toKrwAmount(cost ? value - cost : 0, currency, rate),
      });
    } catch (error) {
      holdings.push({ ...holding, error: error.message });
    }
  }
  const totalKrwConverted = holdings.reduce((sum, item) => sum + Number(item.krw_value || 0), 0);
  return {
    settings: portfolio.settings || {},
    holdings,
    usd_krw_rate: rate,
    totals: {
      KRW: holdings.filter((item) => item.currency === "KRW").reduce((sum, item) => sum + (item.value || 0), 0),
      USD: holdings.filter((item) => item.currency === "USD").reduce((sum, item) => sum + (item.value || 0), 0),
      KRW_CONVERTED: totalKrwConverted,
    },
    active_plans: holdings.filter((item) => item.plan?.enabled).length,
    updated_at: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
  };
}

export function formatMoney(value, currency, rate = 0, dual = false) {
  const amount = Number(value || 0);
  if (currency === "KRW") return `${Math.round(amount).toLocaleString("ko-KR")}원`;
  const usd = `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return dual && rate ? `${usd} (약 ${Math.round(amount * rate).toLocaleString("ko-KR")}원)` : usd;
}

export async function buildLiveBriefing(env, reason = "현재 데이터로 즉시 생성했습니다.") {
  const snapshot = await buildSnapshot(env);
  const lines = [
    `[포트폴리오 브리핑] ${new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}`,
    reason,
    "",
    "가격 요약",
  ];
  for (const item of snapshot.holdings || []) {
    if (item.error) {
      lines.push(`- ${item.name || item.symbol}: 조회 실패 (${item.error})`);
      continue;
    }
    const sign = Number(item.change || 0) > 0 ? "+" : Number(item.change || 0) < 0 ? "-" : "";
    const change = item.change_pct === null || item.change_pct === undefined ? "등락 정보 없음" : `${sign}${Math.abs(Number(item.change_pct)).toFixed(2)}%`;
    lines.push(`- ${item.name}: ${formatMoney(item.close, item.currency, snapshot.usd_krw_rate, true)} (${change})`);
  }
  lines.push("");
  lines.push("그래서 오늘 해야 할 것");
  lines.push("- 웹에 저장된 메일 브리핑이 아직 없어서 실시간 가격 중심으로 보여드립니다.");
  lines.push("- GitHub Actions가 다음에 실행되면 메일 본문도 이 화면에 저장되어 표시됩니다.");
  lines.push("- 주식 모으기 설정을 바꾸면 다음 브리핑부터 반영됩니다.");
  return { text: lines.join("\n"), updatedAt: new Date().toISOString(), generated: true };
}

export function localProjection(question, snapshot, prefix = "") {
  const candidates = snapshot.holdings.filter((item) => !item.error);
  const target = candidates.find((item) => question.includes(item.name) || question.toLowerCase().includes(String(item.symbol).toLowerCase()));
  const list = target ? [target] : candidates;
  const lines = [];
  if (prefix) lines.push("외부 AI 호출이 막혀서 Briefolio 내장 분석 모드로 답합니다.", `원인: ${prefix}`, "");
  else lines.push("Briefolio 내장 분석 모드로 답합니다.", "");
  lines.push("1년 적립 시뮬레이션");
  for (const item of list) {
    let amount = Number(item.plan?.amount || 0);
    let planCurrency = normalizeCurrency(item.plan?.currency, item.currency || "KRW");
    const rate = Number(snapshot.usd_krw_rate || item.usd_krw_rate || 1350);
    if (question.includes("만원")) {
      amount = 10000;
      planCurrency = "KRW";
    }
    if (question.includes("10만원")) {
      amount = 100000;
      planCurrency = "KRW";
    }
    if (!amount) continue;
    const periods = question.includes("매월") || item.plan?.frequency === "monthly" ? 12 : 52;
    const total = amount * periods;
    const totalQuote = toQuoteAmount(total, planCurrency, item.currency || "KRW", rate);
    const shares = item.close ? totalQuote / item.close : 0;
    lines.push(
      `- ${item.name}: ${formatMoney(amount, planCurrency, rate, true)}씩 ${periods}회`,
      `  총 투입금: ${formatMoney(total, planCurrency, rate, true)}`,
      `  현재가 기준 예상 수량: ${shares.toFixed(6)}주`,
      `  시나리오: -20% ${formatMoney(totalQuote * 0.8, item.currency, rate, true)} / 0% ${formatMoney(totalQuote, item.currency, rate, true)} / +20% ${formatMoney(totalQuote * 1.2, item.currency, rate, true)}`
    );
  }
  if (lines.length <= (prefix ? 4 : 3)) {
    lines.push("계산할 적립 금액이 없습니다. 주식 모으기 금액을 먼저 설정해 주세요.");
  }
  lines.push("", "실제 결과는 매수 시점별 가격, 환율, 세금, 수수료에 따라 달라집니다.");
  return lines.join("\n");
}
