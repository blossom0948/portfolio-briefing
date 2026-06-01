const defaults = {
  settings: { recipient: "blossom0948@gmail.com", send_time: "07:00", timezone: "Asia/Seoul" },
  holdings: [],
};

let portfolio = structuredClone(defaults);
let snapshot = null;
let lastBriefing = { text: "" };
const $ = (selector) => document.querySelector(selector);
const days = { MO: "월", TU: "화", WE: "수", TH: "목", FR: "금", SA: "토", SU: "일" };

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

async function requestJson(url, options) {
  const requestOptions = options ? { ...options } : {};
  const timeoutMs = requestOptions.timeoutMs;
  delete requestOptions.timeoutMs;
  let timer = null;
  if (timeoutMs) {
    const controller = new AbortController();
    requestOptions.signal = controller.signal;
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const response = await fetch(url, requestOptions);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.answer || response.statusText);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("AI 응답 시간이 길어 내장 계산 모드로 전환합니다.");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  const nextView = document.querySelector(`#view-${name}`);
  if (!nextView) return;
  nextView.classList.add("active");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  if (name === "pro") renderPro();
}

document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => showView(item.dataset.view)));

function money(value, currency) {
  const amount = Number(value || 0);
  return currency === "KRW"
    ? `${Math.round(amount).toLocaleString("ko-KR")}원`
    : `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function planText(item) {
  const plan = item.plan || {};
  if (!plan.enabled) return "주식 모으기 꺼짐";
  const freq = plan.frequency === "monthly" ? "매월" : "매주";
  return `${freq} ${days[plan.weekday] || "월"}요일 ${money(plan.amount, plan.currency)} 모으기`;
}

function syncFromForms() {
  document.querySelectorAll(".holding-form-card").forEach((card) => {
    const item = portfolio.holdings[Number(card.dataset.index)];
    card.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.dataset.field;
      item[field] = ["quantity", "average_price"].includes(field) ? Number(input.value || 0) : input.value;
    });
    item.plan = item.plan || {};
    card.querySelectorAll("[data-plan]").forEach((input) => {
      const field = input.dataset.plan;
      item.plan[field] = field === "enabled" ? input.checked : (field === "amount" ? Number(input.value || 0) : input.value);
    });
    item.plan.currency = item.market === "KR" ? "KRW" : "USD";
    item.id = item.id || `${item.market.toLowerCase()}-${item.symbol.toLowerCase()}`;
    item.transactions = item.transactions || [];
  });
  portfolio.settings = {
    recipient: $("#recipient").value || "blossom0948@gmail.com",
    send_time: $("#sendTime").value || "07:00",
    timezone: $("#timezone").value || "Asia/Seoul",
  };
}

function renderDashboard() {
  if (!snapshot) return;
  $("#totalKrw").textContent = money(snapshot.totals.KRW, "KRW");
  $("#totalUsd").textContent = money(snapshot.totals.USD, "USD");
  $("#activePlans").textContent = `${snapshot.active_plans}개`;
  $("#syncState").textContent = "연결됨";
  $("#holdingCards").innerHTML = snapshot.holdings.map((item) => {
    const change = item.change_pct === null || item.change_pct === undefined ? "-" : `${item.change >= 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`;
    const profit = item.cost ? `${money(item.profit, item.currency)} / ${item.profit_pct.toFixed(2)}%` : "-";
    return `
      <article class="holding-card">
        <div class="holding-main">
          <div><strong>${item.name}</strong><span>${item.symbol} · ${item.market}</span></div>
          <span class="pill">${item.date || "가격 조회"}</span>
        </div>
        <div class="price-line">
          <b>${item.error ? "조회 실패" : money(item.close, item.currency)}</b>
          <span class="${item.change >= 0 ? "positive" : "negative"}">${item.error || change}</span>
        </div>
        <dl>
          <div><dt>수량</dt><dd>${Number(item.quantity || 0).toLocaleString("ko-KR", { maximumFractionDigits: 6 })}</dd></div>
          <div><dt>평단</dt><dd>${item.average_price ? money(item.average_price, item.currency) : "-"}</dd></div>
          <div><dt>평가액</dt><dd>${item.value ? money(item.value, item.currency) : "-"}</dd></div>
          <div><dt>손익</dt><dd>${profit}</dd></div>
        </dl>
        <p class="plan-chip">${planText(item)}${item.plan?.enabled && item.plan_estimated_shares ? ` · 예상 ${item.plan_estimated_shares.toFixed(6)}주` : ""}</p>
      </article>
    `;
  }).join("");
}

function renderForms() {
  const settings = portfolio.settings || defaults.settings;
  $("#recipient").value = settings.recipient || "blossom0948@gmail.com";
  $("#sendTime").value = settings.send_time || "07:00";
  $("#timezone").value = settings.timezone || "Asia/Seoul";
  $("#holdingForms").innerHTML = (portfolio.holdings || []).map((item, index) => `
    <article class="holding-form-card" data-index="${index}">
      <label>종목명<input data-field="name" value="${item.name || ""}"></label>
      <label>티커<input data-field="symbol" value="${item.symbol || ""}"></label>
      <label>시장<select data-field="market"><option value="KR" ${item.market === "KR" ? "selected" : ""}>한국</option><option value="US" ${item.market === "US" ? "selected" : ""}>미국</option></select></label>
      <label>수량<input data-field="quantity" type="number" step="0.000001" value="${item.quantity || 0}"></label>
      <label>평단<input data-field="average_price" type="number" step="0.01" value="${item.average_price || 0}"></label>
      <div class="wide-row">
        <label class="toggle"><input data-plan="enabled" type="checkbox" ${item.plan?.enabled ? "checked" : ""}><span>모으기</span></label>
        <label>주기<select data-plan="frequency"><option value="weekly" ${item.plan?.frequency !== "monthly" ? "selected" : ""}>매주</option><option value="monthly" ${item.plan?.frequency === "monthly" ? "selected" : ""}>매월</option></select></label>
        <label>요일<select data-plan="weekday">${Object.entries(days).map(([k, v]) => `<option value="${k}" ${item.plan?.weekday === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>금액<input data-plan="amount" type="number" step="0.01" value="${item.plan?.amount || 0}"></label>
        <label>메모<input data-plan="memo" value="${item.plan?.memo || ""}"></label>
        <button data-remove="${index}">삭제</button>
      </div>
    </article>
  `).join("");
}

function renderBriefing() {
  const text = lastBriefing.text || "아직 저장된 브리핑이 없습니다. GitHub Actions를 한 번 실행하면 여기에 표시됩니다.";
  $("#briefingText").textContent = text;
  $("#briefingText2").textContent = text;
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
  return (snapshot?.holdings || []).filter((item) => !item.error);
}

function planHoldings() {
  return (portfolio.holdings || []).filter((item) => item.plan?.enabled);
}

function analyzeNewsImpact() {
  const text = `${lastBriefing?.text || ""}`.toLowerCase();
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

  const buckets = {};
  valued.forEach((item) => {
    const key = item.currency || item.market || "기타";
    buckets[key] = buckets[key] || [];
    buckets[key].push(item);
  });

  Object.entries(buckets).forEach(([currency, items]) => {
    const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
    const top = items.reduce((best, item) => Number(item.value || 0) > Number(best.value || 0) ? item : best, items[0]);
    const weight = total ? Number(top.value || 0) / total : 0;
    if (weight > 0.7 && items.length > 1) {
      score -= 16;
      reasons.push(`${top.name}의 ${currency} 내 비중이 ${pct(weight)}로 높습니다.`);
    } else if (weight > 0.55 && items.length > 1) {
      score -= 8;
      reasons.push(`${currency} 자산 안에서 ${top.name} 비중을 조금만 점검하세요.`);
    }
  });

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
  const buckets = {};
  holdings.forEach((item) => {
    const key = item.currency || "기타";
    buckets[key] = buckets[key] || [];
    buckets[key].push(item);
  });

  const actions = [];
  Object.entries(buckets).forEach(([currency, items]) => {
    const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
    if (items.length === 1) {
      actions.push({ title: `${currency} 자산`, body: `${items[0].name}만 있으니 리밸런싱보다 보유 이유와 추가 매수 기준을 정하세요.` });
      return;
    }
    const target = 1 / items.length;
    items.forEach((item) => {
      const weight = Number(item.value || 0) / total;
      const gap = weight - target;
      if (Math.abs(gap) < 0.1) {
        actions.push({ title: item.name, body: `현재 비중 ${pct(weight)}로 목표 ${pct(target)}와 큰 차이가 없습니다.` });
      } else if (gap > 0) {
        actions.push({ title: item.name, body: `현재 비중 ${pct(weight)}입니다. 새 적립금은 다른 종목에 먼저 배정하는 편이 균형에 좋습니다.` });
      } else {
        actions.push({ title: item.name, body: `현재 비중 ${pct(weight)}입니다. 다음 적립 때 우선순위를 높이면 균형이 좋아집니다.` });
      }
    });
  });

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

  const totalByCurrency = {};
  const weightedToday = {};
  holdings.forEach((item) => {
    const currency = item.currency || "기타";
    const value = Number(item.value || 0);
    totalByCurrency[currency] = (totalByCurrency[currency] || 0) + value;
  });
  holdings.forEach((item) => {
    const currency = item.currency || "기타";
    const value = Number(item.value || 0);
    const weight = totalByCurrency[currency] ? value / totalByCurrency[currency] : 0;
    weightedToday[currency] = (weightedToday[currency] || 0) + weight * Number(item.change_pct || 0);
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
    ...Object.entries(weightedToday).map(([currency, change]) => ({ title: `내 ${currency} 오늘`, body: `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` })),
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
  const activePlans = planHoldings();
  const events = [
    { tag: "매일", title: "아침 브리핑 메일", body: `${portfolio.settings?.send_time || "07:00"} · ${portfolio.settings?.recipient || "받을 메일 미설정"}` },
    ...activePlans.map((item) => ({ tag: item.plan.frequency === "monthly" ? "매월" : "매주", title: `${item.name} 주식 모으기`, body: `${nextWeekdayLabel(item.plan.weekday)}요일 · ${money(item.plan.amount, item.plan.currency)}` })),
    { tag: "분기", title: "미국 ETF 분배금 점검", body: "3·6·9·12월에는 QQQM/VOO 분배금 재투자 여부를 확인하세요." },
    { tag: "분기", title: "삼성전자 실적·배당 공시", body: "실적 발표 전후로 뉴스 영향 점수와 가격 변동을 같이 보세요." },
  ];

  $("#eventList").innerHTML = events.map((event) => `
    <article>
      <span>${escapeHtml(event.tag)}</span>
      <div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.body)}</small></div>
    </article>
  `).join("");

  const holdings = currentHoldings();
  const impact = analyzeNewsImpact();
  const alerts = [
    { title: "가격 급변", body: "하루 등락률이 ±5%를 넘으면 메일 브리핑에서 상단 경고로 올리기" },
    { title: "뉴스 영향", body: `뉴스 영향 점수가 40점 아래면 당일 매수 전 확인하기. 현재 ${impact.score}점입니다.` },
    { title: "적립 체크", body: activePlans.length ? `${activePlans.length}개 주식 모으기 계획을 메일에 반영 중입니다.` : "주식 모으기 계획이 꺼져 있습니다." },
  ];
  const bigHolding = holdings.find((item) => Number(item.value || 0) > 0 && Number(item.quantity || 0) > 0);
  if (bigHolding) alerts.push({ title: "평단 관리", body: "평단과 현재가 차이가 커질 때 일지에 매수 이유를 남기기" });

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
  const months = clamp(Number($("#simMonths")?.value || 12), 1, 120);
  const frequency = $("#simFrequency")?.value || "weekly";
  const annualReturn = Number($("#simReturn")?.value || 0) / 100;
  const periods = frequency === "weekly" ? Math.round((months / 12) * 52) : months;
  const invested = amount * periods;
  const expected = invested * (1 + annualReturn * (months / 12));
  const shares = item?.close ? invested / Number(item.close) : 0;
  const currency = item?.currency || (item?.market === "KR" ? "KRW" : "USD");
  const scenarios = [
    { title: "보수적", value: invested * 0.8, body: "가격이 20% 낮아지는 경우" },
    { title: "기준", value: invested, body: "가격이 그대로인 경우" },
    { title: "기대", value: expected, body: `연 ${Math.round(annualReturn * 1000) / 10}% 가정` },
  ];
  $("#whatIfResult").innerHTML = `
    <article><span>총 투자금</span><strong>${money(invested, currency)}</strong><small>${periods}회 매수 · 예상 ${shares.toFixed(6)}주</small></article>
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
  $("#proAiAnswer").textContent = "AI가 포트폴리오와 브리핑을 읽는 중입니다...";
  const context = currentHoldings().map((item) => `${item.name} ${item.symbol}: 현재가 ${money(item.close, item.currency)}, 오늘 ${item.change_pct ?? "-"}%, 수량 ${item.quantity || 0}`).join("\n");
  try {
    const result = await requestJson("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: 9000,
      body: JSON.stringify({ question: `${question}\n\n[포트폴리오]\n${context}\n\n[브리핑]\n${lastBriefing.text || ""}` }),
    });
    $("#proAiAnswer").textContent = result.answer;
  } catch (error) {
    $("#proAiAnswer").textContent = `AI 호출은 실패했습니다. 대신 앱 내 계산으로 답합니다.\n\n${buildLocalAdvice(question)}`;
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

async function loadAll() {
  $("#syncState").textContent = "불러오는 중";
  const [config, snap, briefing] = await Promise.all([
    requestJson("/api/config"),
    requestJson("/api/snapshot"),
    requestJson("/api/briefing"),
  ]);
  portfolio = config;
  snapshot = snap;
  lastBriefing = briefing;
  renderDashboard();
  renderForms();
  renderBriefing();
  renderPro();
  toast("최신 설정을 불러왔습니다.");
}

async function saveAll() {
  syncFromForms();
  $("#syncState").textContent = "저장 중";
  await requestJson("/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(portfolio),
  });
  await loadAll();
  toast("저장했습니다. 다음 메일에 반영됩니다.");
}

$("#loadBtn").addEventListener("click", () => loadAll().catch((error) => toast(`불러오기 실패: ${error.message}`)));
$("#saveBtn").addEventListener("click", () => saveAll().catch((error) => toast(`저장 실패: ${error.message}`)));
$("#saveSettingsBtn").addEventListener("click", () => saveAll().catch((error) => toast(`저장 실패: ${error.message}`)));
$("#addHoldingBtn").addEventListener("click", () => {
  syncFromForms();
  portfolio.holdings.push({ id: crypto.randomUUID(), name: "", symbol: "", market: "US", quantity: 0, average_price: 0, plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 0, currency: "USD", memo: "" }, transactions: [] });
  renderForms();
});
$("#holdingForms").addEventListener("input", syncFromForms);
$("#holdingForms").addEventListener("change", syncFromForms);
$("#holdingForms").addEventListener("click", (event) => {
  if (event.target.dataset.remove === undefined) return;
  syncFromForms();
  portfolio.holdings.splice(Number(event.target.dataset.remove), 1);
  renderForms();
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
  $("#aiAnswer").textContent = "AI가 계산 중입니다...";
  try {
    const result = await requestJson("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: 9000,
      body: JSON.stringify({ question }),
    });
    $("#aiAnswer").textContent = result.answer;
  } catch (error) {
    $("#aiAnswer").textContent = `AI 호출은 실패했습니다. 대신 앱 내 계산으로 답합니다.\n\n${buildLocalAdvice(question)}`;
  }
});

document.querySelectorAll(".pro-tab").forEach((button) => {
  button.addEventListener("click", () => switchProPanel(button.dataset.proPanel));
});

$("#runWhatIfBtn")?.addEventListener("click", runWhatIf);
["#simHolding", "#simAmount", "#simFrequency", "#simMonths", "#simReturn"].forEach((selector) => {
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

loadAll().catch((error) => {
  $("#syncState").textContent = "연결 필요";
  toast(`초기 연결 실패: ${error.message}`);
  renderForms();
  renderBriefing();
  renderPro();
});
