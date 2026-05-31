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
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.answer || response.statusText);
  return data;
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelector(`#view-${name}`).classList.add("active");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
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
      body: JSON.stringify({ question }),
    });
    $("#aiAnswer").textContent = result.answer;
  } catch (error) {
    $("#aiAnswer").textContent = `AI 답변 실패: ${error.message}`;
  }
});

loadAll().catch((error) => {
  $("#syncState").textContent = "연결 필요";
  toast(`초기 연결 실패: ${error.message}`);
  renderForms();
  renderBriefing();
});
