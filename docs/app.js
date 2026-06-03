const state = {
  portfolio: null,
  snapshot: null,
  briefing: "",
  discover: { category: "us", items: [], selected: null, loading: false, usd_krw_rate: 0 },
  capturedHoldings: [],
  aiMessages: [],
};

const $ = (selector) => document.querySelector(selector);

function fxRate() {
  return Number(state.snapshot?.usd_krw_rate || state.discover.usd_krw_rate || 0);
}

function money(value, currency, options = {}) {
  if (value === null || value === undefined) return "-";
  if (currency === "KRW") return `${Math.round(value).toLocaleString("ko-KR")}원`;
  const usd = `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (options.dual === false || !fxRate()) return usd;
  return `${usd} · 약 ${Math.round(Number(value) * fxRate()).toLocaleString("ko-KR")}원`;
}

function shortMoney(value, currency) {
  const amount = Number(value || 0);
  if (currency === "KRW") return `${Math.round(amount).toLocaleString("ko-KR")}원`;
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function krwApprox(value, currency) {
  const amount = Number(value || 0);
  if (!amount) return "";
  const krw = currency === "KRW" ? amount : amount * (fxRate() || 0);
  return krw ? `약 ${Math.round(krw).toLocaleString("ko-KR")}원` : "";
}

function friendlyWarning(message = "") {
  const lowered = String(message).toLowerCase();
  if (/quota|billing|insufficient|limit|usage|plan/.test(lowered)) {
    return "AI 이미지 분석 한도 또는 결제 설정 문제입니다. 코드 고장이라기보다 OpenAI/Gemini 계정에서 사용량 한도가 막힌 상태예요.";
  }
  if (/api key|invalid|unauthorized/.test(lowered)) {
    return "AI API 키가 없거나 잘못되었습니다. Cloudflare Pages 환경 변수의 키를 확인해야 합니다.";
  }
  if (/timeout|timed out/.test(lowered)) {
    return "AI 응답 시간이 길어져 중단되었습니다. 이미지를 조금 더 작게 다시 올려보세요.";
  }
  return String(message || "캡처 분석을 완료하지 못했습니다.");
}

function number(value) {
  return Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 6 });
}

function changeLabel(item) {
  if (item.change === null || item.change === undefined) return "-";
  const sign = item.change > 0 ? "+" : "";
  return `${sign}${money(Math.abs(item.change), item.currency)} / ${sign}${item.change_pct}%`;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 3000);
}

function aiSettings() {
  return { provider: "server", apiKey: "", model: "" };
}

function defaultAiModel(provider) {
  if (provider === "auto") return "";
  return provider === "openai" ? "gpt-4o-mini" : "gemini-2.5-flash-lite";
}

function aiRequestPayload() {
  // 핵심 수정: 브라우저에 저장된 오래된/잘못된 API 키를 절대 서버로 보내지 않는다.
  return {};
}

function loadAiSettingsForm() {
  renderAiKeyStatus();
}

function saveAiSettingsForm() {
  localStorage.removeItem("briefolioAiProvider");
  localStorage.removeItem("briefolioAiApiKey");
  localStorage.removeItem("briefolioAiModel");
  renderAiKeyStatus();
}

function renderAiKeyStatus() {
  // AI 키는 Cloudflare Pages 환경변수에서만 관리한다.
}

async function requestJson(url, options) {
  const requestOptions = options ? { ...options } : {};
  const timeoutMs = requestOptions.timeoutMs;
  delete requestOptions.timeoutMs;
  requestOptions.headers = {
    ...(requestOptions.headers || {}),
    ...(localStorage.getItem("briefolioPin") ? { "X-App-Pin": localStorage.getItem("briefolioPin") } : {}),
  };
  let timer = null;
  if (timeoutMs) {
    const controller = new AbortController();
    requestOptions.signal = controller.signal;
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    let response = await fetch(url, requestOptions);
    if (response.status === 401) {
      const pin = window.prompt("Briefolio PIN을 입력하세요.");
      if (pin) {
        localStorage.setItem("briefolioPin", pin);
        requestOptions.headers["X-App-Pin"] = pin;
        response = await fetch(url, requestOptions);
      }
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || response.statusText);
    }
    return response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("AI 응답 시간이 길어 내장 계산 모드로 전환합니다.");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function setAiDock(open) {
  const panel = $("#aiDockPanel");
  const button = $("#aiDockToggle");
  if (!panel || !button) return;
  panel.hidden = !open;
  panel.classList.toggle("is-open", Boolean(open));
  button.setAttribute("aria-expanded", String(open));
  if (open) {
    renderAiKeyStatus();
    window.setTimeout(() => $("#aiDockQuestion")?.focus(), 80);
  } else {
    panel.classList.remove("tools-open");
    $("#aiDockMenu")?.setAttribute("aria-expanded", "false");
  }
}

function formatAiText(text = "") {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function focusLatestUserMessage() {
  const body = $("#aiChatBody");
  if (!body) return;
  window.requestAnimationFrame(() => {
    const messages = body.querySelectorAll(".ai-message.user");
    const last = messages[messages.length - 1];
    if (!last) {
      body.scrollTop = 0;
      return;
    }
    body.scrollTop = Math.max(0, last.offsetTop - body.offsetTop - 12);
  });
}

function renderAiChat({ keepScroll = true } = {}) {
  const answer = $("#aiDockAnswer");
  const panel = $("#aiDockPanel");
  const body = $("#aiChatBody");
  if (!answer) return;
  const previousScroll = body?.scrollTop || 0;
  panel?.classList.toggle("has-messages", state.aiMessages.length > 0);
  answer.innerHTML = state.aiMessages.map((message) => `
    <article class="ai-message ${message.role === "user" ? "user" : "assistant"}">
      ${formatAiText(message.text)}
    </article>
  `).join("");
  if (body && keepScroll) {
    window.requestAnimationFrame(() => {
      body.scrollTop = previousScroll;
    });
  }
}

function addAiMessage(role, text, options = {}) {
  state.aiMessages.push({ role, text });
  renderAiChat({ keepScroll: !options.focus });
  if (options.focus) focusLatestUserMessage();
}

function updateLastAssistantMessage(text) {
  const last = state.aiMessages[state.aiMessages.length - 1];
  if (last && last.role === "assistant") {
    last.text = text;
  } else {
    state.aiMessages.push({ role: "assistant", text });
  }
  renderAiChat();
}

function toggleAiTools() {
  const panel = $("#aiDockPanel");
  const button = $("#aiDockMenu");
  if (!panel || !button) return;
  const open = !panel.classList.contains("tools-open");
  panel.classList.toggle("tools-open", open);
  button.setAttribute("aria-expanded", String(open));
}

function clearDockAi() {
  state.aiMessages = [];
  state.capturedHoldings = [];
  $("#capturePreview").innerHTML = "";
  $("#applyCaptureBtn").disabled = true;
  $("#aiDockQuestion").value = "";
  renderAiChat();
}

function fileToImagePayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
      image.onload = () => {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(mimeType, 0.88);
        resolve({ image: dataUrl.split(",")[1], mimeType });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function captureDiff(item) {
  const current = state.portfolio?.holdings?.find((holding) => holding.symbol === item.symbol && holding.market === item.market);
  if (!current) return "새 종목";
  const currentQty = Number(current.quantity || 0);
  const nextQty = Number(item.quantity || 0);
  const qtyDiff = nextQty - currentQty;
  if (Math.abs(qtyDiff) < 0.000001) return "수량 같음";
  return `${qtyDiff > 0 ? "+" : ""}${qtyDiff.toLocaleString("ko-KR", { maximumFractionDigits: 8 })}주 보정`;
}

function renderCapturePreview(result) {
  state.capturedHoldings = result.holdings || [];
  const preview = $("#capturePreview");
  const applyButton = $("#applyCaptureBtn");
  // 핵심 수정: provider의 실제 HTTP/status/error를 한도 문제로 뭉개지 않고 그대로 보여준다.
  const warnings = (result.warnings || []).map((warning) => String(warning));
  const attempts = Array.isArray(result.attempts) && result.attempts.length
    ? [`시도한 경로: ${result.attempts.join(" → ")}`]
    : [];
  const success = result.provider ? [`성공 경로: ${result.provider} ${result.model || ""}`.trim()] : [];
  updateLastAssistantMessage([
    result.summary || "캡처 분석이 끝났습니다.",
    ...success,
    ...attempts,
    ...warnings.map((warning) => `주의: ${warning}`),
  ].join("\n"));
  if (!preview) return;
  preview.innerHTML = state.capturedHoldings.length ? state.capturedHoldings.map((item) => `
    <article>
      <strong>${escapeHtml(item.name || item.symbol)} <span class="muted">${escapeHtml(item.symbol)} · ${escapeHtml(item.market)}</span></strong>
      <span>${Number(item.quantity || 0).toLocaleString("ko-KR", { maximumFractionDigits: 8 })}주</span>
      <small>${captureDiff(item)}</small>
    </article>
  `).join("") : `<p class='muted'>${warnings.length ? "AI 한도/키 문제로 캡처를 읽지 못했습니다. 계정 설정을 고치면 같은 화면에서 다시 시도할 수 있습니다." : "읽어낸 종목이 없습니다. 더 선명한 보유 화면 캡처를 올려주세요."}</p>`;
  if (applyButton) applyButton.disabled = !state.capturedHoldings.length;
  if (state.capturedHoldings.length) $("#aiDockPanel")?.classList.add("tools-open");
}

async function analyzeBrokerCapture(file) {
  if (!file) return;
  setAiDock(true);
  addAiMessage("assistant", "서버 AI 설정으로 캡처를 분석 중입니다...");
  $("#applyCaptureBtn").disabled = true;
  const payload = await fileToImagePayload(file);
  const result = await requestJson("/api/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, ...aiRequestPayload() }),
  });
  renderCapturePreview(result);
}

async function applyCapturedHoldings() {
  if (!state.portfolio || !state.capturedHoldings.length) return;
  for (const captured of state.capturedHoldings) {
    let item = state.portfolio.holdings.find((holding) => holding.symbol === captured.symbol && holding.market === captured.market);
    if (!item) {
      item = {
        id: `${captured.market.toLowerCase()}-${captured.symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: captured.name || captured.symbol,
        symbol: captured.symbol,
        market: captured.market,
        quantity: 0,
        average_price: 0,
        average_price_currency: captured.market === "KR" ? "KRW" : "USD",
        plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 10000, currency: "KRW", memo: "" },
        transactions: [],
      };
      state.portfolio.holdings.push(item);
    }
    item.name = captured.name || item.name;
    item.quantity = Number(Number(captured.quantity || 0).toFixed(8));
    if (Number(captured.average_price || 0) > 0) {
      item.average_price = Number(captured.average_price || 0);
      item.average_price_currency = captured.average_price_currency || (captured.market === "KR" ? "KRW" : "USD");
    }
  }
  await requestJson("/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state.portfolio),
  });
  await loadAll();
  addAiMessage("assistant", "캡처 기준으로 보유 종목을 반영했습니다.");
  toast("캡처 기준으로 보이는 종목을 맞췄습니다.");
}

async function askDockAi() {
  const input = $("#aiDockQuestion");
  const question = input?.value.trim();
  if (!question) {
    addAiMessage("assistant", "질문을 입력하거나 증권사 캡처를 올려주세요.");
    return;
  }
  input.value = "";
  addAiMessage("user", question, { focus: true });
  const tradeCommand = parseTradeCommand(question);
  if (tradeCommand) {
    addAiMessage("assistant", "매수 문장으로 인식했습니다. 현재가 기준 수량을 계산해서 보유 종목에 반영하는 중입니다...");
    try {
      const result = await applyTradeCommand(tradeCommand);
      updateLastAssistantMessage([
        `${result.holding.name} 매수를 반영했습니다.`,
        `- 입력 금액: ${money(result.amount, result.amountCurrency)}`,
        `- 적용 가격: ${money(result.price, result.quoteCurrency)}`,
        `- 추가 수량: ${result.quantity.toLocaleString("ko-KR", { maximumFractionDigits: 8 })}주`,
      ].join("\n"));
    } catch (error) {
      updateLastAssistantMessage(`매수 자동 반영에 실패했습니다.\n원인: ${error.message}`);
    }
    return;
  }
  addAiMessage("assistant", "포트폴리오 데이터를 읽고 답변을 준비하는 중입니다...");
  try {
    const result = await requestJson("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, ...aiRequestPayload() }),
      timeoutMs: 18000,
    });
    updateLastAssistantMessage(result.answer);
  } catch (error) {
    updateLastAssistantMessage(`외부 AI 대신 앱 내 계산으로 답합니다.\n\n${buildLocalAdvice(question)}`);
  }
}

function planText(item) {
  const plan = item.plan || {};
  if (!plan.enabled) return "꺼짐";
  const weekday = { MO: "월", TU: "화", WE: "수", TH: "목", FR: "금", SA: "토", SU: "일" }[plan.weekday] || "월";
  const freq = plan.frequency === "monthly" ? "매월" : "매주";
  return `${freq} ${weekday}요일 ${money(plan.amount, plan.currency)} 모으기`;
}

function currencyOptions(selected, market = "US") {
  if (market === "KR") return `<option value="KRW" selected>원화 KRW</option>`;
  return ["KRW", "USD"].map((currency) => (
    `<option value="${currency}" ${selected === currency ? "selected" : ""}>${currency === "KRW" ? "원화 KRW" : "달러 USD"}</option>`
  )).join("");
}

function convertAmount(amount, fromCurrency, toCurrency) {
  const value = Number(amount || 0);
  if (fromCurrency === toCurrency) return value;
  const rate = fxRate() || 1350;
  if (fromCurrency === "KRW" && toCurrency === "USD") return value / rate;
  if (fromCurrency === "USD" && toCurrency === "KRW") return value * rate;
  return value;
}

function todayKst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function marketLabel(asset) {
  return asset.market === "KR" ? "국내" : "해외";
}

function findSnapshotItem(item) {
  return (state.snapshot?.holdings || []).find((row) => row.id === item.id || (row.symbol === item.symbol && row.market === item.market));
}

const TRADE_ASSET_ALIASES = [
  { keys: ["애플", "apple", "aapl"], name: "Apple", symbol: "AAPL", market: "US" },
  { keys: ["엔비디아", "nvidia", "nvda"], name: "NVIDIA", symbol: "NVDA", market: "US" },
  { keys: ["삼성전자", "삼전", "005930"], name: "삼성전자", symbol: "005930", market: "KR" },
  { keys: ["네이버", "naver", "035420"], name: "NAVER", symbol: "035420", market: "KR" },
  { keys: ["qqqm"], name: "QQQM", symbol: "QQQM", market: "US" },
  { keys: ["voo"], name: "VOO", symbol: "VOO", market: "US" },
];

function compactKoreanText(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, "");
}

function parseMoneyCommand(text = "") {
  const normalized = String(text).replace(/,/g, "");
  let match = normalized.match(/\$\s*(\d+(?:\.\d+)?)/i)
    || normalized.match(/(\d+(?:\.\d+)?)\s*(달러|불|usd)/i);
  if (match) return { amount: Number(match[1]), currency: "USD" };

  match = normalized.match(/(\d+(?:\.\d+)?)\s*(억|천만|만|천)?\s*원/);
  if (!match) return null;

  const multiplier = { 억: 100000000, 천만: 10000000, 만: 10000, 천: 1000 }[match[2]] || 1;
  return { amount: Number(match[1]) * multiplier, currency: "KRW" };
}

function resolveTradeAsset(question = "") {
  const compact = compactKoreanText(question);
  const holdings = state.portfolio?.holdings || [];
  const existing = holdings.find((item) => {
    const symbol = compactKoreanText(item.symbol);
    const name = compactKoreanText(item.name);
    return (symbol && compact.includes(symbol)) || (name && compact.includes(name));
  });
  if (existing) return existing;

  return TRADE_ASSET_ALIASES.find((asset) => asset.keys.some((key) => compact.includes(compactKoreanText(key)))) || null;
}

function parseTradeCommand(question = "") {
  const compact = compactKoreanText(question);
  if (!/(샀|삿|매수|구매|추가|담았|담앗)/.test(compact)) return null;
  const moneyCommand = parseMoneyCommand(question);
  if (!moneyCommand || !moneyCommand.amount) return null;
  const asset = resolveTradeAsset(question);
  if (!asset) return null;
  return { asset, ...moneyCommand };
}

async function discoverTradePrice(asset) {
  const category = asset.market === "KR" ? "kr" : "us";
  const data = await requestJson(`/api/discover?category=${category}&q=${encodeURIComponent(asset.symbol)}&limit=3`);
  const found = (data.items || []).find((item) => item.symbol === asset.symbol && item.market === asset.market) || data.items?.[0];
  if (!found || !Number(found.close || 0)) throw new Error(`${asset.name || asset.symbol} 현재가를 찾지 못했습니다.`);
  state.discover.usd_krw_rate = Number(data.usd_krw_rate || state.discover.usd_krw_rate || 0);
  return { close: Number(found.close), currency: found.currency || (asset.market === "KR" ? "KRW" : "USD") };
}

async function ensureTradeHolding(asset) {
  if (!state.portfolio) state.portfolio = await requestJson("/api/portfolio");
  const holdings = state.portfolio?.holdings || [];
  const existing = holdings.find((item) => item.symbol === asset.symbol && item.market === asset.market);
  if (existing) return existing;

  const created = await requestJson("/api/holdings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: asset.name || asset.symbol,
      symbol: asset.symbol,
      market: asset.market,
      quantity: 0,
      average_price: 0,
      average_price_currency: asset.market === "KR" ? "KRW" : "USD",
      plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 0, currency: "KRW", memo: "" },
      transactions: [],
    }),
  });
  state.portfolio.holdings = [...holdings, created];
  return created;
}

async function applyTradeCommand(command) {
  const holding = await ensureTradeHolding(command.asset);
  const quoteCurrency = holding.market === "KR" ? "KRW" : "USD";
  const snapshotItem = findSnapshotItem(holding);
  const priceData = Number(snapshotItem?.close || 0)
    ? { close: Number(snapshotItem.close), currency: snapshotItem.currency || quoteCurrency }
    : await discoverTradePrice(holding);
  const priceQuote = convertAmount(priceData.close, priceData.currency, quoteCurrency);
  const amountQuote = convertAmount(command.amount, command.currency, quoteCurrency);
  const quantity = priceQuote ? amountQuote / priceQuote : 0;
  if (!quantity) throw new Error("현재가 기준 수량을 계산하지 못했습니다.");

  const updated = await requestJson(`/api/holdings/${holding.id}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      side: "buy",
      quantity: Number(quantity.toFixed(8)),
      price: Number(priceQuote.toFixed(4)),
      price_currency: quoteCurrency,
      date: todayKst(),
      memo: "AI 대화 자동 반영",
    }),
  });
  await loadAll();
  return { holding: updated, quantity, price: priceQuote, quoteCurrency, amount: command.amount, amountCurrency: command.currency };
}

function planExecutionPreview(item) {
  const plan = item.plan || {};
  const snap = findSnapshotItem(item);
  const quoteCurrency = item.market === "KR" ? "KRW" : "USD";
  const close = Number(snap?.close || 0);
  const planAmount = Number(plan.amount || 0);
  const planCurrency = item.market === "KR" ? "KRW" : (plan.currency || "KRW");
  const quoteAmount = convertAmount(planAmount, planCurrency, quoteCurrency);
  const quantity = close ? quoteAmount / close : 0;
  return { close, quantity, quoteAmount, quoteCurrency, planAmount, planCurrency, snap };
}

function planExecutionLabel(item) {
  const plan = item.plan || {};
  if (!plan.enabled || !Number(plan.amount || 0)) return "모으기 금액을 켜면 실행할 수 있습니다.";
  const preview = planExecutionPreview(item);
  if (!preview.close) return "현재가를 불러온 뒤 실행할 수 있습니다.";
  return `현재가 기준 예상 ${preview.quantity.toFixed(6)}주 · ${money(preview.planAmount, preview.planCurrency)}`;
}

function planExecutedToday(item) {
  return (item.plan || {}).last_executed_date === todayKst();
}

function planCanExecute(item) {
  const preview = planExecutionPreview(item);
  return Boolean(item.plan?.enabled && Number(item.plan?.amount || 0) && preview.close && preview.quantity && !planExecutedToday(item));
}

async function executePlan(itemId) {
  const item = state.portfolio?.holdings.find((holding) => holding.id === itemId);
  if (!item) return;
  if (planExecutedToday(item)) {
    toast("오늘은 이미 이 모으기를 반영했습니다.");
    return;
  }
  const preview = planExecutionPreview(item);
  if (!item.plan?.enabled || !preview.planAmount || !preview.close || !preview.quantity) {
    toast("모으기 금액과 현재가를 먼저 확인해주세요.");
    return;
  }
  const currentQty = Number(item.quantity || 0);
  const currentAvgQuote = convertAmount(Number(item.average_price || 0), item.average_price_currency || preview.quoteCurrency, preview.quoteCurrency);
  const nextQty = currentQty + preview.quantity;
  item.quantity = Number(nextQty.toFixed(8));
  item.average_price = Number((((currentQty * currentAvgQuote) + (preview.quantity * preview.close)) / nextQty).toFixed(4));
  item.average_price_currency = preview.quoteCurrency;
  item.transactions = item.transactions || [];
  item.transactions.unshift({
    date: todayKst(),
    side: "buy",
    quantity: Number(preview.quantity.toFixed(8)),
    price: preview.close,
    price_currency: preview.quoteCurrency,
    memo: "주식 모으기 실행",
  });
  item.transactions = item.transactions.slice(0, 20);
  item.plan.last_executed_date = todayKst();
  item.plan.last_executed_at = new Date().toISOString();
  item.plan.last_executed_quantity = Number(preview.quantity.toFixed(8));
  item.plan.last_executed_price = preview.close;
  await requestJson("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.portfolio),
  });
  await loadAll();
  toast(`${item.name} 모으기를 ${preview.quantity.toFixed(6)}주 반영했습니다.`);
}

function renderDiscoverResults() {
  const el = $("#discoverResults");
  if (!el) return;
  const items = state.discover.items || [];
  if (!items.length) {
    el.innerHTML = "<p class='muted'>표시할 종목이 없습니다. 종목명이나 티커로 검색해보세요.</p>";
    return;
  }
  el.innerHTML = items.map((asset, index) => {
    const direction = Number(asset.change || 0) >= 0 ? "positive" : "negative";
    const change = asset.change_pct === null || asset.change_pct === undefined ? "-" : `${Number(asset.change_pct) >= 0 ? "+" : ""}${Number(asset.change_pct).toFixed(2)}%`;
    const price = asset.error ? "조회 실패" : money(asset.close, asset.currency);
    return `
      <article class="discover-item">
        <div class="discover-rank">${index + 1}</div>
        <div class="discover-logo">${escapeHtml(asset.symbol.slice(0, 2))}</div>
        <div class="discover-copy">
          <strong>${escapeHtml(asset.name)}</strong>
          <span>${escapeHtml(asset.symbol)} · ${marketLabel(asset)} · ${escapeHtml(asset.category || "")}</span>
        </div>
        <div class="discover-price">
          <b>${price}</b>
          <span class="${direction}">${asset.error || change}</span>
        </div>
        <button data-discover-index="${index}" type="button">구매하기</button>
      </article>
    `;
  }).join("");
}

async function loadDiscovery(category = state.discover.category) {
  state.discover.category = category;
  state.discover.loading = true;
  document.querySelectorAll(".discover-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.discoverCategory === category);
  });
  const query = $("#discoverSearch")?.value.trim() || "";
  if ($("#discoverResults")) $("#discoverResults").innerHTML = "<p class='muted'>종목을 불러오는 중입니다...</p>";
  try {
    const data = await requestJson(`/api/discover?category=${encodeURIComponent(category)}&q=${encodeURIComponent(query)}&limit=12`);
    state.discover.items = data.items || [];
    state.discover.usd_krw_rate = Number(data.usd_krw_rate || state.discover.usd_krw_rate || 0);
    renderDiscoverResults();
  } finally {
    state.discover.loading = false;
  }
}

function maybeLoadDiscovery() {
  if (!$("#discoverResults") || state.discover.items.length || state.discover.loading) return;
  loadDiscovery().catch(() => {
    if ($("#discoverResults")) $("#discoverResults").innerHTML = "<p class='muted'>종목 발견 데이터를 불러오지 못했습니다.</p>";
  });
}

function updateDiscoverFractionPreview() {
  const asset = state.discover.selected;
  const preview = $("#discoverFractionPreview");
  if (!asset || !preview) return;
  const quoteCurrency = asset.market === "KR" ? "KRW" : "USD";
  const price = Number($("#discoverPrice")?.value || 0);
  const priceCurrency = $("#discoverPriceCurrency")?.value || quoteCurrency;
  const amount = Number($("#discoverBuyAmount")?.value || 0);
  const amountCurrency = $("#discoverBuyCurrency")?.value || (asset.market === "KR" ? "KRW" : "KRW");
  const priceQuote = convertAmount(price, priceCurrency, quoteCurrency);
  const amountQuote = convertAmount(amount, amountCurrency, quoteCurrency);
  if (!priceQuote || !amountQuote) {
    preview.textContent = "금액을 넣으면 예상 소수점 수량을 계산합니다.";
    return;
  }
  const estimatedQuantity = amountQuote / priceQuote;
  preview.textContent = `예상 ${estimatedQuantity.toLocaleString("ko-KR", { maximumFractionDigits: 8 })}주가 반영됩니다.`;
}

function openDiscoverAction(asset) {
  state.discover.selected = asset;
  const quoteCurrency = asset.market === "KR" ? "KRW" : "USD";
  const price = asset.close ? Number(asset.close).toFixed(quoteCurrency === "KRW" ? 0 : 2) : "";
  const el = $("#discoverAction");
  el.hidden = false;
  el.innerHTML = `
    <article class="discover-sheet">
      <div class="section-head">
        <div>
          <p class="eyebrow">${escapeHtml(asset.category || "Stock")}</p>
          <h2>${escapeHtml(asset.name)}</h2>
          <p>${escapeHtml(asset.symbol)} · ${marketLabel(asset)} · ${asset.error ? "가격 조회 실패" : money(asset.close, asset.currency)}</p>
        </div>
        <button id="discoverCloseBtn" type="button">닫기</button>
      </div>
      <div class="discover-form">
        <label>구매 수량<input id="discoverQty" type="number" step="0.000001" min="0" value="0"></label>
        <label>1주 가격
          <div class="inline-control">
            <input id="discoverPrice" type="number" step="0.01" value="${price}">
            <select id="discoverPriceCurrency">${currencyOptions(quoteCurrency, asset.market)}</select>
          </div>
        </label>
        <label class="wide-row">소수점 구매 금액
          <div class="inline-control">
            <input id="discoverBuyAmount" type="number" step="0.01" min="0" placeholder="예: 10000">
            <select id="discoverBuyCurrency">${currencyOptions("KRW", asset.market)}</select>
          </div>
          <span id="discoverFractionPreview" class="fraction-preview">금액을 넣으면 예상 소수점 수량을 계산합니다.</span>
        </label>
        <label class="toggle"><input id="discoverPlanEnabled" type="checkbox"><span>주식 모으기 켜기</span></label>
        <label>모으기 금액
          <div class="inline-control">
            <input id="discoverPlanAmount" type="number" step="0.01" value="10000">
            <select id="discoverPlanCurrency">${currencyOptions("KRW", asset.market)}</select>
          </div>
        </label>
        <label>주기<select id="discoverPlanFrequency"><option value="weekly">매주</option><option value="monthly">매월</option></select></label>
        <label>요일<select id="discoverPlanWeekday">${["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((day) => `<option value="${day}" ${day === "MO" ? "selected" : ""}>${{ MO: "월", TU: "화", WE: "수", TH: "목", FR: "금", SA: "토", SU: "일" }[day]}</option>`).join("")}</select></label>
      </div>
      <div class="discover-actions">
        <button id="discoverSaveBtn" class="primary" type="button">내 주식에 반영</button>
      </div>
    </article>
  `;
  updateDiscoverFractionPreview();
}

async function saveDiscoverSelection() {
  const asset = state.discover.selected;
  if (!asset || !state.portfolio) return;
  const quoteCurrency = asset.market === "KR" ? "KRW" : "USD";
  let quantity = Number($("#discoverQty")?.value || 0);
  const price = Number($("#discoverPrice")?.value || 0);
  const priceCurrency = $("#discoverPriceCurrency")?.value || quoteCurrency;
  const buyAmount = Number($("#discoverBuyAmount")?.value || 0);
  const buyCurrency = $("#discoverBuyCurrency")?.value || (asset.market === "KR" ? "KRW" : "KRW");
  const planEnabled = Boolean($("#discoverPlanEnabled")?.checked);
  const planAmount = Number($("#discoverPlanAmount")?.value || 0);
  const planCurrency = $("#discoverPlanCurrency")?.value || "KRW";
  const priceQuote = convertAmount(price, priceCurrency, quoteCurrency);
  if ((!quantity || quantity <= 0) && buyAmount > 0 && priceQuote > 0) {
    quantity = convertAmount(buyAmount, buyCurrency, quoteCurrency) / priceQuote;
  }
  let item = state.portfolio.holdings.find((holding) => holding.symbol === asset.symbol && holding.market === asset.market);
  if (!item) {
    item = {
      id: `${asset.market.toLowerCase()}-${asset.symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: asset.name,
      symbol: asset.symbol,
      market: asset.market,
      quantity: 0,
      average_price: 0,
      average_price_currency: quoteCurrency,
      plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 0, currency: asset.market === "KR" ? "KRW" : "KRW", memo: "" },
      transactions: [],
    };
    state.portfolio.holdings.push(item);
  }
  if (quantity > 0 && price > 0) {
    const currentQty = Number(item.quantity || 0);
    const currentAvgQuote = convertAmount(Number(item.average_price || 0), item.average_price_currency || quoteCurrency, quoteCurrency);
    const nextQty = currentQty + quantity;
    item.quantity = Number(nextQty.toFixed(8));
    item.average_price = Number((((currentQty * currentAvgQuote) + (quantity * priceQuote)) / nextQty).toFixed(4));
    item.average_price_currency = quoteCurrency;
    item.transactions = item.transactions || [];
    item.transactions.unshift({ date: new Date().toISOString().slice(0, 10), side: "buy", quantity, price, price_currency: priceCurrency, memo: "발견 화면에서 추가" });
    item.transactions = item.transactions.slice(0, 20);
  }
  if (planEnabled || planAmount > 0) {
    item.plan = {
      ...(item.plan || {}),
      enabled: planEnabled,
      frequency: $("#discoverPlanFrequency")?.value || "weekly",
      weekday: $("#discoverPlanWeekday")?.value || "MO",
      amount: planAmount,
      currency: asset.market === "KR" ? "KRW" : planCurrency,
      memo: item.plan?.memo || "",
    };
  }
  await requestJson("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.portfolio),
  });
  $("#discoverAction").hidden = true;
  await loadAll();
  toast(`${asset.name}을 내 주식에 반영했습니다.`);
}

function renderSnapshot(snapshot) {
  state.snapshot = snapshot;
  $("#totalKrw").textContent = money(snapshot.totals.KRW_CONVERTED || snapshot.totals.KRW, "KRW");
  $("#totalUsd").textContent = money(snapshot.totals.USD, "USD");
  $("#activePlans").textContent = `${snapshot.active_plans}개`;
  $("#updatedAt").textContent = snapshot.usd_krw_rate ? `환율 ${Math.round(snapshot.usd_krw_rate).toLocaleString("ko-KR")}원` : snapshot.updated_at;
  $("#holdingCards").innerHTML = snapshot.holdings.map((item) => {
    if (item.error) {
      return `<article class="holding-card warning"><strong>${item.name}</strong><span>${item.error}</span></article>`;
    }
    const direction = item.change >= 0 ? "positive" : "negative";
    const profitClass = item.profit >= 0 ? "positive" : "negative";
    const profit = item.cost ? `<span class="${profitClass}">${item.profit_pct}%</span>` : "<span>-</span>";
    const valueText = item.value ? `${krwApprox(item.value, item.currency) || shortMoney(item.value, item.currency)}` : "-";
    const avgText = item.average_price ? shortMoney(item.average_price, item.average_price_currency || item.currency) : "-";
    const priceMeta = krwApprox(item.close, item.currency);
    return `
      <article class="holding-card">
        <div class="holding-main">
          <div>
            <strong>${item.name}</strong>
            <span>${item.symbol} · ${item.market}</span>
          </div>
          <span class="pill">${item.date}</span>
        </div>
        <div class="price-line">
          <div class="price-stack"><b>${shortMoney(item.close, item.currency)}</b>${priceMeta ? `<small>${priceMeta}</small>` : ""}</div>
          <span class="${direction}">${item.change_pct === null || item.change_pct === undefined ? "-" : `${item.change >= 0 ? "+" : ""}${item.change_pct}%`}</span>
        </div>
        <dl>
          <div><dt>수량</dt><dd>${number(item.quantity)}</dd></div>
          <div><dt>평단</dt><dd>${avgText}</dd></div>
          <div><dt>평가액</dt><dd>${valueText}</dd></div>
          <div><dt>손익</dt><dd>${profit}</dd></div>
        </dl>
        <p class="plan-chip">${planText(item)}${item.plan?.enabled ? ` · 예상 ${number(item.plan_estimated_shares)}주` : ""}</p>
      </article>
    `;
  }).join("");
}

function renderSelectors(portfolio) {
  const options = portfolio.holdings.map((item) => `<option value="${item.id}">${item.name} (${item.symbol})</option>`).join("");
  $("#tradeHolding").innerHTML = options;
}

function renderPlanList(portfolio) {
  $("#planList").innerHTML = portfolio.holdings.map((item) => {
    const plan = item.plan || {};
    return `
      <form class="plan-row" data-id="${item.id}">
        <div>
          <strong>${item.name}</strong>
          <span>${item.symbol} · ${item.market}</span>
        </div>
        <label class="toggle">
          <input name="enabled" type="checkbox" ${plan.enabled ? "checked" : ""}>
          <span>켜기</span>
        </label>
        <label>주기
          <select name="frequency">
            <option value="weekly" ${plan.frequency === "weekly" ? "selected" : ""}>매주</option>
            <option value="monthly" ${plan.frequency === "monthly" ? "selected" : ""}>매월</option>
          </select>
        </label>
        <label>요일
          <select name="weekday">
            ${["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((day) => `<option value="${day}" ${plan.weekday === day ? "selected" : ""}>${{ MO: "월", TU: "화", WE: "수", TH: "목", FR: "금", SA: "토", SU: "일" }[day]}</option>`).join("")}
          </select>
        </label>
        <label>금액
          <div class="inline-control">
            <input name="amount" type="number" step="0.01" value="${plan.amount || 0}">
            <select name="currency">${currencyOptions(plan.currency || (item.market === "KR" ? "KRW" : "KRW"), item.market)}</select>
          </div>
        </label>
        <label>메모
          <input name="memo" value="${plan.memo || ""}" placeholder="예: 월요일 1만원">
        </label>
        <button type="submit">저장</button>
        <div class="plan-execute-row">
          <span>${escapeHtml(planExecutionLabel(item))}${plan.last_executed_date ? ` · 마지막 반영 ${escapeHtml(plan.last_executed_date)}` : ""}</span>
          <button data-execute-plan="${escapeHtml(item.id)}" class="primary" type="button" ${planCanExecute(item) ? "" : "disabled"}>${planExecutedToday(item) ? "오늘 반영됨" : "오늘 모으기 반영"}</button>
        </div>
      </form>
    `;
  }).join("");
}

function renderNews(news) {
  const render = (items) => items.map((item) => `
    <article class="news-item">
      <a href="${item.link}" target="_blank" rel="noreferrer">${item.title_ko || item.title}</a>
      <small>${item.source || "뉴스"}${item.symbol ? ` · ${item.symbol}` : ""}</small>
    </article>
  `).join("") || "<p class=\"muted\">표시할 뉴스가 없습니다.</p>";
  $("#domesticNews").innerHTML = render(news.domestic);
  $("#overseasNews").innerHTML = render(news.overseas);
}

function renderBriefHighlights(snapshot) {
  const first = snapshot.holdings.find((item) => !item.error);
  const strongest = snapshot.holdings
    .filter((item) => item.change_pct !== null && item.change_pct !== undefined)
    .sort((a, b) => b.change_pct - a.change_pct)[0];
  $("#briefHighlights").innerHTML = `
    <div><span>대표 종목</span><strong>${first ? first.name : "-"}</strong></div>
    <div><span>오늘 강한 종목</span><strong>${strongest ? `${strongest.name} ${strongest.change_pct}%` : "-"}</strong></div>
    <div><span>모으기</span><strong>${snapshot.active_plans}개 진행</strong></div>
  `;
}

function fillSettings(portfolio) {
  const settings = portfolio.settings || {};
  const form = $("#settingsForm");
  form.recipient.value = settings.recipient || "blossom0948@gmail.com";
  form.send_time.value = settings.send_time || "07:00";
  form.timezone.value = settings.timezone || "Asia/Seoul";
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  const nextView = document.querySelector(`#view-${name}`);
  if (!nextView) return;
  nextView.classList.add("active");
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === name);
  });
  if (name === "pro") renderPro();
  if (name === "manage") maybeLoadDiscovery();
}

const proState = {
  benchmarkKey: "",
  health: { score: 0, label: "대기" },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function pct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function currentHoldings() {
  return (state.snapshot?.holdings || []).filter((item) => !item.error);
}

function planHoldings() {
  return (state.portfolio?.holdings || []).filter((item) => item.plan?.enabled);
}

function analyzeNewsImpact() {
  const text = `${state.briefing || ""}`.toLowerCase();
  const positives = ["상승", "강세", "호실적", "성장", "개선", "수혜", "기대", "완화", "돌파", "반등", "ai", "실적"];
  const negatives = ["하락", "약세", "부진", "감소", "우려", "리스크", "규제", "관세", "소송", "침체", "경고", "악화"];
  const positiveCount = positives.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  const negativeCount = negatives.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  const score = clamp(50 + positiveCount * 6 - negativeCount * 8, 0, 100);
  const label = score >= 65 ? "긍정" : score <= 38 ? "주의" : "중립";
  return { score, label, positiveCount, negativeCount };
}

function analyzeHealth() {
  const holdings = currentHoldings();
  const reasons = [];
  let score = 100;

  if (!holdings.length) {
    return { score: 35, label: "설정 필요", reasons: ["가격을 읽을 수 있는 보유 종목이 필요합니다."] };
  }

  const valued = holdings.filter((item) => Number(item.value || 0) > 0);
  if (!valued.length) {
    score -= 22;
    reasons.push("보유 수량이 0이라 실제 비중 계산이 어렵습니다.");
  }

  const totalKrw = valued.reduce((sum, item) => sum + Number(item.krw_value || item.value || 0), 0);
  if (totalKrw) {
    const top = valued.reduce((best, item) => Number(item.krw_value || item.value || 0) > Number(best.krw_value || best.value || 0) ? item : best, valued[0]);
    const weight = Number(top.krw_value || top.value || 0) / totalKrw;
    if (weight > 0.7 && valued.length > 1) {
      score -= 16;
      reasons.push(`${top.name}의 전체 원화 환산 비중이 ${pct(weight)}로 높습니다.`);
    } else if (weight > 0.55 && valued.length > 1) {
      score -= 8;
      reasons.push(`${top.name} 비중을 조금만 점검하세요. 원화 환산 기준입니다.`);
    }
  }

  const missingCost = holdings.filter((item) => Number(item.quantity || 0) > 0 && !Number(item.average_price || 0));
  if (missingCost.length) {
    score -= 8;
    reasons.push("평단이 없는 종목은 수익률 판단이 흐려집니다.");
  }

  const activePlans = planHoldings().length;
  if (!activePlans) {
    score -= 8;
    reasons.push("켜진 주식 모으기 계획이 없습니다.");
  }

  const deepLoss = holdings.find((item) => Number(item.profit_pct || 0) < -15);
  if (deepLoss) {
    score -= 10;
    reasons.push(`${deepLoss.name} 손익률이 -15% 아래라 매수 이유를 다시 확인하세요.`);
  }

  const bigMove = holdings.find((item) => Math.abs(Number(item.change_pct || 0)) >= 5);
  if (bigMove) {
    score -= 5;
    reasons.push(`${bigMove.name}의 하루 변동이 커서 뉴스와 함께 확인하세요.`);
  }

  const impact = analyzeNewsImpact();
  if (impact.score < 38) {
    score -= 8;
    reasons.push("오늘 뉴스 톤이 주의 쪽에 가깝습니다.");
  }

  score = clamp(Math.round(score), 0, 100);
  const label = score >= 82 ? "좋음" : score >= 64 ? "보통" : "점검";
  if (!reasons.length) reasons.push("집중도, 적립 계획, 뉴스 톤이 무난합니다.");
  return { score, label, reasons };
}

function renderHealth() {
  const health = analyzeHealth();
  proState.health = health;
  $("#healthRing")?.style.setProperty("--score", health.score);
  if ($("#healthScore")) $("#healthScore").textContent = `${health.score}`;
  if ($("#healthSummary")) {
    $("#healthSummary").textContent = `${health.label} 상태입니다. 점수는 분산도, 평단 입력, 적립 계획, 가격 변동, 뉴스 톤을 합쳐 계산했습니다.`;
  }
  if ($("#healthReasons")) {
    $("#healthReasons").innerHTML = health.reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join("");
  }
}

function renderRebalance() {
  const holdings = currentHoldings().filter((item) => Number(item.value || 0) > 0);
  const actions = [];
  const total = holdings.reduce((sum, item) => sum + Number(item.krw_value || item.value || 0), 0);
  if (holdings.length === 1) {
    actions.push({ title: "원화 통합 비중", body: `${holdings[0].name}만 있으니 리밸런싱보다 보유 이유와 추가 매수 기준을 정하세요.` });
  } else if (total) {
    const target = 1 / holdings.length;
    holdings.forEach((item) => {
      const weight = Number(item.krw_value || item.value || 0) / total;
      const gap = weight - target;
      if (Math.abs(gap) < 0.1) {
        actions.push({ title: item.name, body: `원화 환산 비중 ${pct(weight)}로 균등 목표 ${pct(target)}와 큰 차이가 없습니다.` });
      } else if (gap > 0) {
        actions.push({ title: item.name, body: `원화 환산 비중 ${pct(weight)}입니다. 새 적립금은 다른 종목에 먼저 배정하는 편이 균형에 좋습니다.` });
      } else {
        actions.push({ title: item.name, body: `원화 환산 비중 ${pct(weight)}입니다. 다음 적립 때 우선순위를 높이면 균형이 좋아집니다.` });
      }
    });
  }

  $("#rebalanceList").innerHTML = (actions.length ? actions : [{ title: "대기", body: "보유 수량과 평단을 입력하면 추천이 더 정확해집니다." }])
    .map((item) => `<article><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body)}</span></article>`).join("");
}

function renderNewsImpact() {
  const impact = analyzeNewsImpact();
  $("#newsImpact").innerHTML = `
    <div class="impact-score" style="--impact: ${impact.score}">
      <strong>${impact.score}</strong>
      <span>${impact.label}</span>
    </div>
    <p>긍정 키워드 ${impact.positiveCount}개, 주의 키워드 ${impact.negativeCount}개를 감지했습니다. 숫자가 낮으면 오늘은 매수보다 확인이 먼저입니다.</p>
  `;
}

function renderRiskRadar() {
  const holdings = currentHoldings();
  const impact = analyzeNewsImpact();
  const totalKrw = holdings.reduce((sum, item) => sum + Number(item.krw_value || item.value || 0), 0);
  const top = totalKrw
    ? holdings.reduce((best, item) => Number(item.krw_value || item.value || 0) > Number(best.krw_value || best.value || 0) ? item : best, holdings[0])
    : null;
  const concentration = top && totalKrw ? Number(top.krw_value || top.value || 0) / totalKrw : 0;
  const biggestMove = holdings
    .filter((item) => Number.isFinite(Number(item.change_pct)))
    .sort((a, b) => Math.abs(Number(b.change_pct || 0)) - Math.abs(Number(a.change_pct || 0)))[0];
  const risks = [
    { label: "비중 집중", score: clamp(Math.round(concentration * 100), 0, 100), body: top ? `${top.name} ${pct(concentration)} · 원화 환산 기준` : "보유 금액 입력 필요" },
    { label: "가격 변동", score: clamp(Math.round(Math.abs(Number(biggestMove?.change_pct || 0)) * 12), 0, 100), body: biggestMove ? `${biggestMove.name} ${Number(biggestMove.change_pct || 0).toFixed(2)}%` : "변동 데이터 없음" },
    { label: "뉴스 톤", score: 100 - impact.score, body: `${impact.label} · 주의 키워드 ${impact.negativeCount}개` },
  ];
  $("#riskRadar").innerHTML = risks.map((risk) => `
    <article>
      <div class="risk-gauge" style="--risk:${risk.score}"><strong>${risk.score}</strong></div>
      <div><b>${escapeHtml(risk.label)}</b><span>${escapeHtml(risk.body)}</span></div>
    </article>
  `).join("");
}

function formatBenchmarkChange(change) {
  const value = Number(change);
  if (!Number.isFinite(value)) return "데이터 없음";
  if (Math.abs(value) > 80) return "데이터 점검 필요";
  return `최근 6개월 ${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

async function renderBenchmark() {
  const el = $("#benchmarkList");
  if (!el) return;
  const holdings = currentHoldings();
  const key = holdings.map((item) => `${item.symbol}:${item.close}`).join("|");
  if (proState.benchmarkKey === key && el.dataset.ready === "true") return;
  proState.benchmarkKey = key;
  el.dataset.ready = "false";
  el.innerHTML = "<article><strong>비교 중</strong><span>최근 6개월 벤치마크를 불러오고 있습니다.</span></article>";

  const totalKrw = holdings.reduce((sum, item) => sum + Number(item.krw_value || item.value || 0), 0);
  let weightedToday = 0;
  holdings.forEach((item) => {
    const value = Number(item.krw_value || item.value || 0);
    const weight = totalKrw ? value / totalKrw : 0;
    weightedToday += weight * Number(item.change_pct || 0);
  });

  const benchmarks = [
    { name: "S&P 500", symbol: "^GSPC", market: "US" },
    { name: "Nasdaq", symbol: "^IXIC", market: "US" },
    { name: "KOSPI", symbol: "^KS11", market: "KR" },
  ];

  const results = await Promise.allSettled(benchmarks.map(async (bench) => {
    const data = await requestJson(`/api/history?symbol=${encodeURIComponent(bench.symbol)}&market=${bench.market}&range=6mo&period=6mo`);
    return { ...bench, change: data.change_pct };
  }));

  const rows = [
    { title: "내 포트폴리오 오늘", body: `${weightedToday >= 0 ? "+" : ""}${weightedToday.toFixed(2)}% · 원화 환산 비중` },
    ...results.map((result) => result.status === "fulfilled"
      ? { title: result.value.name, body: formatBenchmarkChange(result.value.change) }
      : { title: "벤치마크", body: "일시적으로 불러오지 못했습니다." }),
  ];

  el.dataset.ready = "true";
  el.innerHTML = rows.map((item) => `<article><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body)}</span></article>`).join("");
}

function nextWeekdayLabel(code) {
  const names = { MO: "월", TU: "화", WE: "수", TH: "목", FR: "금", SA: "토", SU: "일" };
  return names[code] || "월";
}

function renderEventsAndAlerts() {
  const portfolio = state.portfolio || { holdings: [], settings: {} };
  const activePlans = planHoldings();
  const events = [
    { tag: "매일", title: "아침 브리핑 메일", body: `${portfolio.settings?.send_time || "07:00"} · ${portfolio.settings?.recipient || "받을 메일 미설정"}` },
    ...activePlans.map((item) => ({ tag: item.plan.frequency === "monthly" ? "매월" : "매주", title: `${item.name} 주식 모으기`, body: `${nextWeekdayLabel(item.plan.weekday)}요일 · ${money(item.plan.amount, item.plan.currency)}` })),
    { tag: "매월", title: "미국 CPI·고용 지표", body: "QQQM과 VOO는 금리 기대에 민감해서 발표 주간에는 변동성을 더 크게 봅니다." },
    { tag: "FOMC", title: "미국 금리 결정 주간", body: "금리 인하/동결 기대가 바뀌면 달러 자산과 성장주가 같이 흔들릴 수 있습니다." },
    { tag: "분기", title: "미국 ETF 분배금 점검", body: "3·6·9·12월에는 QQQM/VOO 분배금 재투자 여부를 확인하세요." },
    { tag: "분기", title: "삼성전자 실적·배당 공시", body: "실적 발표 전후로 뉴스 영향 점수와 가격 변동을 같이 보세요." },
  ];

  $("#eventList").innerHTML = events.map((event) => `
    <article>
      <span>${escapeHtml(event.tag)}</span>
      <div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.body)}</small></div>
    </article>
  `).join("");

  const impact = analyzeNewsImpact();
  const alerts = [
    { title: "가격 급변", body: "하루 등락률이 ±5%를 넘으면 메일 브리핑에서 상단 경고로 올리기" },
    { title: "뉴스 영향", body: `뉴스 영향 점수가 40점 아래면 당일 매수 전 확인하기. 현재 ${impact.score}점입니다.` },
    { title: "적립 체크", body: activePlans.length ? `${activePlans.length}개 주식 모으기 계획을 메일에 반영 중입니다.` : "주식 모으기 계획이 꺼져 있습니다." },
    { title: "평단 관리", body: "평단과 현재가 차이가 커질 때 일지에 매수 이유를 남기기" },
  ];

  $("#alertList").innerHTML = alerts.map((item) => `<article><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body)}</span></article>`).join("");
}

function renderSimulatorOptions() {
  const select = $("#simHolding");
  if (!select) return;
  const holdings = currentHoldings();
  select.innerHTML = holdings.map((item, index) => `<option value="${index}">${escapeHtml(item.name)} (${escapeHtml(item.symbol)})</option>`).join("");
  if (!holdings.length) select.innerHTML = "<option value=''>종목 없음</option>";
}

function runWhatIf() {
  const holdings = currentHoldings();
  const item = holdings[Number($("#simHolding")?.value || 0)];
  const amount = Number($("#simAmount")?.value || 0);
  const inputCurrency = $("#simCurrency")?.value || "KRW";
  const months = clamp(Number($("#simMonths")?.value || 12), 1, 120);
  const frequency = $("#simFrequency")?.value || "weekly";
  const annualReturn = Number($("#simReturn")?.value || 0) / 100;
  const periods = frequency === "weekly" ? Math.round((months / 12) * 52) : months;
  const invested = amount * periods;
  const currency = item?.currency || (item?.market === "KR" ? "KRW" : "USD");
  const rate = fxRate() || 1350;
  const investedQuote = currency === inputCurrency ? invested : (inputCurrency === "KRW" ? invested / rate : invested * rate);
  const expected = investedQuote * (1 + annualReturn * (months / 12));
  const shares = item?.close ? investedQuote / Number(item.close) : 0;
  const scenarios = [
    { title: "보수적", value: investedQuote * 0.8, body: "가격이 20% 낮아지는 경우" },
    { title: "기준", value: investedQuote, body: "가격이 그대로인 경우" },
    { title: "기대", value: expected, body: `연 ${Math.round(annualReturn * 1000) / 10}% 가정` },
  ];
  $("#whatIfResult").innerHTML = `
    <article><span>총 투자금</span><strong>${money(invested, inputCurrency)}</strong><small>${periods}회 매수 · 현재가 기준 예상 ${shares.toFixed(6)}주</small></article>
    ${scenarios.map((scenario) => `<article><span>${scenario.title}</span><strong>${money(scenario.value, currency)}</strong><small>${scenario.body}</small></article>`).join("")}
  `;
}

function readJournal() {
  try {
    return JSON.parse(localStorage.getItem("briefolioJournal") || "[]");
  } catch {
    return [];
  }
}

function renderJournal() {
  const entries = readJournal();
  $("#journalList").innerHTML = entries.length
    ? entries.map((entry) => `<article><strong>${escapeHtml(entry.date)} · 점수 ${entry.score}</strong><p>${escapeHtml(entry.note)}</p></article>`).join("")
    : "<p class='muted'>아직 저장한 투자 일지가 없습니다.</p>";
}

function saveJournal() {
  const note = $("#journalNote")?.value.trim();
  if (!note) {
    toast("일지 내용을 먼저 적어주세요.");
    return;
  }
  const entries = readJournal();
  entries.unshift({
    id: crypto.randomUUID(),
    date: new Date().toLocaleString("ko-KR"),
    score: proState.health.score,
    note,
  });
  localStorage.setItem("briefolioJournal", JSON.stringify(entries.slice(0, 30)));
  $("#journalNote").value = "";
  renderJournal();
  toast("투자 일지를 저장했습니다.");
}

function buildLocalAdvice(question = "") {
  const health = analyzeHealth();
  const impact = analyzeNewsImpact();
  const activePlans = planHoldings();
  const holdings = currentHoldings();
  const topMove = holdings
    .filter((item) => Number.isFinite(Number(item.change_pct)))
    .sort((a, b) => Math.abs(Number(b.change_pct || 0)) - Math.abs(Number(a.change_pct || 0)))[0];
  return [
    `내장 분석 답변입니다. 현재 건강 점수는 ${health.score}점(${health.label})이고 뉴스 영향은 ${impact.score}점(${impact.label})입니다.`,
    activePlans.length ? `켜진 적립 계획은 ${activePlans.length}개라서 자동 브리핑에 반영됩니다.` : "켜진 적립 계획이 없어 먼저 주식 모으기 기준을 정하는 편이 좋습니다.",
    topMove ? `오늘 가장 크게 움직인 종목은 ${topMove.name}(${Number(topMove.change_pct || 0).toFixed(2)}%)입니다.` : "오늘 가격 변동 데이터는 아직 충분하지 않습니다.",
    question.includes("1년") ? "1년 계획은 프로 분석의 '계획' 탭에서 금액, 주기, 기대수익률을 바꿔 계산해보면 더 정확합니다." : "오늘 행동은 무리한 매수보다 브리핑, 뉴스 영향, 비중을 순서대로 확인하는 쪽이 좋습니다.",
  ].join("\n\n");
}

async function askProAi() {
  const question = $("#proAiQuestion")?.value.trim();
  if (!question) {
    $("#proAiAnswer").textContent = "질문을 입력해주세요.";
    return;
  }
  $("#proAiAnswer").textContent = "포트폴리오 데이터를 읽고 답변을 준비하는 중입니다...";
  const context = currentHoldings().map((item) => `${item.name} ${item.symbol}: 현재가 ${money(item.close, item.currency)}, 오늘 ${item.change_pct ?? "-"}%, 수량 ${item.quantity || 0}`).join("\n");
  try {
    const result = await requestJson("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      timeoutMs: 9000,
      body: JSON.stringify({ question: `${question}\n\n[포트폴리오]\n${context}\n\n[브리핑]\n${state.briefing || ""}`, ...aiRequestPayload() }),
    });
    $("#proAiAnswer").textContent = result.answer;
  } catch (error) {
    $("#proAiAnswer").textContent = `외부 AI 대신 앱 내 계산으로 답합니다.\n\n${buildLocalAdvice(question)}`;
  }
}

function switchProPanel(name) {
  document.querySelectorAll(".pro-tab").forEach((button) => button.classList.toggle("active", button.dataset.proPanel === name));
  document.querySelectorAll(".pro-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.proPanelView === name));
  if (name === "plan") runWhatIf();
}

function renderPro() {
  if (!$("#view-pro")) return;
  renderHealth();
  renderRiskRadar();
  renderRebalance();
  renderNewsImpact();
  renderEventsAndAlerts();
  renderSimulatorOptions();
  runWhatIf();
  renderJournal();
  renderBenchmark().catch(() => {
    const el = $("#benchmarkList");
    if (el) el.innerHTML = "<article><strong>벤치마크</strong><span>지금은 비교 데이터를 불러오지 못했습니다.</span></article>";
  });
}

async function loadSecondaryContent() {
  const newsTask = requestJson("/api/news").then((news) => {
    renderNews(news);
  }).catch(() => {
    $("#domesticNews").innerHTML = "<p class=\"muted\">뉴스를 불러오지 못했습니다.</p>";
    $("#overseasNews").innerHTML = "<p class=\"muted\">뉴스를 불러오지 못했습니다.</p>";
  });
  const briefingTask = requestJson("/api/briefing").then((briefing) => {
    state.briefing = briefing.text;
    $("#briefingText").textContent = briefing.text;
  }).catch(() => {
    $("#briefingText").textContent = "저장된 브리핑을 불러오지 못했습니다. 메일 발송은 기존 스케줄대로 유지됩니다.";
  });
  await Promise.allSettled([newsTask, briefingTask]);
}

function fallbackSnapshot(portfolio, reason = "") {
  const holdings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
  const rows = holdings.map((item) => {
    const currency = item.market === "KR" ? "KRW" : "USD";
    const close = Number(item.average_price || 0);
    const quantity = Number(item.quantity || 0);
    const value = close * quantity;
    return {
      ...item,
      date: "-",
      close,
      currency,
      change: null,
      change_pct: null,
      value,
      cost: value,
      profit: 0,
      profit_pct: 0,
      plan_estimated_shares: 0,
    };
  });
  return {
    holdings: rows,
    totals: {
      KRW: rows.filter((item) => item.currency === "KRW").reduce((sum, item) => sum + Number(item.value || 0), 0),
      USD: rows.filter((item) => item.currency === "USD").reduce((sum, item) => sum + Number(item.value || 0), 0),
      KRW_CONVERTED: rows.filter((item) => item.currency === "KRW").reduce((sum, item) => sum + Number(item.value || 0), 0),
    },
    active_plans: rows.filter((item) => item.plan?.enabled).length,
    usd_krw_rate: 0,
    updated_at: reason ? "가격 조회 실패, 저장된 설정 기준" : "저장된 설정 기준",
  };
}

async function loadAll() {
  $("#briefingText").textContent = "불러오는 중...";
  let portfolio;
  try {
    portfolio = await requestJson("/api/portfolio");
  } catch {
    portfolio = await requestJson("/api/config");
  }

  let snapshot;
  try {
    snapshot = await requestJson("/api/snapshot");
  } catch (error) {
    snapshot = fallbackSnapshot(portfolio, error.message);
    toast("가격 조회는 실패했지만 저장된 보유 설정을 표시합니다.");
  }
  state.portfolio = portfolio;
  renderSnapshot(snapshot);
  renderSelectors(portfolio);
  renderPlanList(portfolio);
  $("#domesticNews").innerHTML = "<p class=\"muted\">뉴스를 불러오는 중입니다...</p>";
  $("#overseasNews").innerHTML = "<p class=\"muted\">뉴스를 불러오는 중입니다...</p>";
  renderBriefHighlights(snapshot);
  fillSettings(portfolio);
  loadSecondaryContent();
  if ($("#view-pro")?.classList.contains("active")) renderPro();
  if ($("#view-manage")?.classList.contains("active")) maybeLoadDiscovery();
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => showView(item.dataset.view));
});

$("#refreshBtn").addEventListener("click", async () => {
  try {
    await loadAll();
    toast("최신 데이터로 갱신했습니다.");
  } catch (error) {
    toast(`갱신 실패: ${error.message}`);
  }
});

$("#sendBtn").addEventListener("click", sendTest);

async function sendTest() {
  try {
    await requestJson("/api/send-test", { method: "POST" });
    toast("브리핑 메일을 보냈습니다.");
  } catch (error) {
    toast(`메일 발송 실패: ${error.message}`);
  }
}

$("#copyBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.briefing);
  toast("브리핑을 복사했습니다.");
});

$("#holdingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    await requestJson("/api/holdings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    event.currentTarget.reset();
    await loadAll();
    toast("종목을 추가했습니다.");
  } catch (error) {
    toast(`추가 실패: ${error.message}`);
  }
});

$("#tradeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const id = payload.holding_id;
  delete payload.holding_id;
  try {
    await requestJson(`/api/holdings/${id}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    form.reset();
    await loadAll();
    toast("매수/매도 내역을 반영했습니다.");
  } catch (error) {
    toast(`반영 실패: ${error.message}`);
  }
});

$("#planList").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.enabled = form.querySelector('[name="enabled"]').checked;
  try {
    await requestJson(`/api/holdings/${form.dataset.id}/plan`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await loadAll();
    toast("주식 모으기 설정을 저장했습니다.");
  } catch (error) {
    toast(`저장 실패: ${error.message}`);
  }
});
$("#planList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-execute-plan]");
  if (!button) return;
  executePlan(button.dataset.executePlan).catch((error) => toast(`모으기 반영 실패: ${error.message}`));
});

document.querySelectorAll(".discover-tab").forEach((button) => {
  button.addEventListener("click", () => loadDiscovery(button.dataset.discoverCategory).catch((error) => toast(`종목 불러오기 실패: ${error.message}`)));
});
$("#discoverSearchBtn")?.addEventListener("click", () => loadDiscovery().catch((error) => toast(`검색 실패: ${error.message}`)));
$("#discoverSearch")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadDiscovery().catch((error) => toast(`검색 실패: ${error.message}`));
  }
});
$("#discoverResults")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-discover-index]");
  if (!button) return;
  openDiscoverAction(state.discover.items[Number(button.dataset.discoverIndex)]);
});
$("#discoverAction")?.addEventListener("click", (event) => {
  if (event.target.id === "discoverCloseBtn") {
    $("#discoverAction").hidden = true;
    return;
  }
  if (event.target.id === "discoverSaveBtn") {
    saveDiscoverSelection().catch((error) => toast(`반영 실패: ${error.message}`));
  }
});
$("#discoverAction")?.addEventListener("input", updateDiscoverFractionPreview);
$("#discoverAction")?.addEventListener("change", updateDiscoverFractionPreview);

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    await requestJson("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await loadAll();
    toast("알림 설정을 저장했습니다.");
  } catch (error) {
    toast(`설정 저장 실패: ${error.message}`);
  }
});

$("#exampleQuestionBtn").addEventListener("click", () => {
  $("#aiQuestion").value = "삼성전자를 매주 1만원씩 1년 모으면 총 얼마를 쓰고, 주가가 -20%, 0%, +20%일 때 결과가 어떻게 돼?";
});

$("#askAiBtn").addEventListener("click", async () => {
  const question = $("#aiQuestion").value.trim();
  if (!question) {
    $("#aiAnswer").textContent = "질문을 입력하세요.";
    return;
  }
  $("#aiAnswer").textContent = "포트폴리오 데이터를 읽고 답변을 준비하는 중입니다...";
  try {
    const result = await requestJson("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      timeoutMs: 9000,
      body: JSON.stringify({ question, ...aiRequestPayload() }),
    });
    $("#aiAnswer").textContent = result.answer;
  } catch (error) {
    $("#aiAnswer").textContent = `외부 AI 대신 앱 내 계산으로 답합니다.\n\n${buildLocalAdvice(question)}`;
  }
});

document.querySelectorAll(".pro-tab").forEach((button) => {
  button.addEventListener("click", () => switchProPanel(button.dataset.proPanel));
});

$("#runWhatIfBtn")?.addEventListener("click", runWhatIf);
["#simHolding", "#simAmount", "#simCurrency", "#simFrequency", "#simMonths", "#simReturn"].forEach((selector) => {
  $(selector)?.addEventListener("input", runWhatIf);
  $(selector)?.addEventListener("change", runWhatIf);
});
$("#saveJournalBtn")?.addEventListener("click", saveJournal);
$("#proAiAskBtn")?.addEventListener("click", askProAi);
document.querySelectorAll(".quick-prompts button").forEach((button) => {
  button.addEventListener("click", () => {
    $("#proAiQuestion").value = button.dataset.prompt;
    switchProPanel("ai");
  });
});
$("#aiDockToggle")?.addEventListener("click", () => setAiDock($("#aiDockPanel")?.hidden));
$("#aiDockClose")?.addEventListener("click", () => setAiDock(false));
$("#aiDockMenu")?.addEventListener("click", () => toggleAiTools());
$("#aiDockClear")?.addEventListener("click", () => clearDockAi());
$("#aiDockAsk")?.addEventListener("click", () => askDockAi());
$("#aiDockQuestion")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    askDockAi();
  }
});
$("#tossCaptureInput")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  analyzeBrokerCapture(file).catch((error) => {
    updateLastAssistantMessage(`캡처 분석 실패: ${error.message}`);
  });
});
$("#applyCaptureBtn")?.addEventListener("click", () => {
  applyCapturedHoldings().catch((error) => toast(`캡처 반영 실패: ${error.message}`));
});

$("#tradeForm").date.valueAsDate = new Date();
loadAiSettingsForm();
renderAiKeyStatus();
loadAll().catch((error) => {
  $("#briefingText").textContent = `초기 로딩 실패: ${error.message}`;
  toast("초기 로딩에 실패했습니다.");
  if ($("#view-pro")?.classList.contains("active")) renderPro();
});
