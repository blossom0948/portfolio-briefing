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
        plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 10, currency: "USD", memo: "" },
        transactions: [],
      },
      {
        id: "voo",
        name: "VOO",
        symbol: "VOO",
        market: "US",
        quantity: 0,
        average_price: 0,
        plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 10, currency: "USD", memo: "" },
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
  if (!response.ok) return { text: "아직 저장된 브리핑이 없습니다.", updatedAt: "" };
  return response.json();
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
  for (const holding of portfolio.holdings || []) {
    const yahooSymbol = holding.market === "KR" && /^\d+$/.test(holding.symbol) ? `${holding.symbol}.KS` : holding.symbol;
    try {
      const price = await yahooPrice(yahooSymbol);
      const close = Number(price.close || 0);
      const previous = Number(price.previous || close);
      const quantity = Number(holding.quantity || 0);
      const averagePrice = Number(holding.average_price || 0);
      const currency = holding.market === "KR" ? "KRW" : "USD";
      const value = close * quantity;
      const cost = averagePrice * quantity;
      const plan = holding.plan || {};
      holdings.push({
        ...holding,
        currency,
        close,
        date: price.date,
        change: close - previous,
        change_pct: previous ? ((close / previous - 1) * 100) : null,
        value,
        cost,
        profit: cost ? value - cost : 0,
        profit_pct: cost ? ((value / cost - 1) * 100) : null,
        plan_estimated_shares: plan.amount && close ? Number(plan.amount) / close : 0,
      });
    } catch (error) {
      holdings.push({ ...holding, error: error.message });
    }
  }
  return {
    settings: portfolio.settings || {},
    holdings,
    totals: {
      KRW: holdings.filter((item) => item.currency === "KRW").reduce((sum, item) => sum + (item.value || 0), 0),
      USD: holdings.filter((item) => item.currency === "USD").reduce((sum, item) => sum + (item.value || 0), 0),
    },
    active_plans: holdings.filter((item) => item.plan?.enabled).length,
    updated_at: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
  };
}

export function formatMoney(value, currency) {
  const amount = Number(value || 0);
  return currency === "KRW"
    ? `${Math.round(amount).toLocaleString("ko-KR")}원`
    : `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
    if (question.includes("만원") && item.currency === "KRW") amount = 10000;
    if (question.includes("10만원") && item.currency === "KRW") amount = 100000;
    if (!amount) continue;
    const periods = question.includes("매월") || item.plan?.frequency === "monthly" ? 12 : 52;
    const total = amount * periods;
    const shares = item.close ? total / item.close : 0;
    lines.push(
      `- ${item.name}: ${formatMoney(amount, item.currency)}씩 ${periods}회`,
      `  총 투입금: ${formatMoney(total, item.currency)}`,
      `  현재가 기준 예상 수량: ${shares.toFixed(6)}주`,
      `  시나리오: -20% ${formatMoney(total * 0.8, item.currency)} / 0% ${formatMoney(total, item.currency)} / +20% ${formatMoney(total * 1.2, item.currency)}`
    );
  }
  if (lines.length <= (prefix ? 4 : 3)) {
    lines.push("계산할 적립 금액이 없습니다. 주식 모으기 금액을 먼저 설정해 주세요.");
  }
  lines.push("", "실제 결과는 매수 시점별 가격, 환율, 세금, 수수료에 따라 달라집니다.");
  return lines.join("\n");
}
