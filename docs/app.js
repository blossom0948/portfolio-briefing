const defaults = {
  settings: { recipient: "blossom0948@gmail.com", send_time: "07:00", timezone: "Asia/Seoul" },
  holdings: [
    { id: "samsung-electronics", name: "삼성전자", symbol: "005930", market: "KR", quantity: 0, average_price: 0, plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 10000, currency: "KRW", memo: "매주 월요일 1만원 모으기" }, transactions: [] },
    { id: "qqqm", name: "QQQM", symbol: "QQQM", market: "US", quantity: 0, average_price: 0, plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 10, currency: "USD", memo: "" }, transactions: [] },
    { id: "voo", name: "VOO", symbol: "VOO", market: "US", quantity: 0, average_price: 0, plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 10, currency: "USD", memo: "" }, transactions: [] }
  ]
};

let portfolio = structuredClone(defaults);
let lastBriefing = { text: "" };
const $ = (selector) => document.querySelector(selector);
const days = { MO: "월", TU: "화", WE: "수", TH: "목", FR: "금", SA: "토", SU: "일" };

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

function endpoint() {
  return localStorage.getItem("briefolioEndpoint") || $("#endpoint").value.trim();
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelector(`#view-${name}`).classList.add("active");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
}

document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => showView(item.dataset.view)));

function money(value, currency) {
  const amount = Number(value || 0);
  return currency === "KRW" ? `${Math.round(amount).toLocaleString("ko-KR")}원` : `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
}

function render() {
  const activePlans = portfolio.holdings.filter((item) => item.plan?.enabled).length;
  $("#activePlans").textContent = `${activePlans}개`;
  $("#holdingCards").innerHTML = portfolio.holdings.map((item) => `
    <article class="holding-card">
      <div class="holding-main">
        <div><strong>${item.name || item.symbol}</strong><span>${item.symbol} · ${item.market}</span></div>
        <span class="pill">${item.quantity || 0}주</span>
      </div>
      <dl>
        <div><dt>평단</dt><dd>${item.average_price ? money(item.average_price, item.market === "KR" ? "KRW" : "USD") : "-"}</dd></div>
        <div><dt>모으기</dt><dd>${item.plan?.enabled ? "켬" : "꺼짐"}</dd></div>
      </dl>
      <p class="plan-chip">${item.plan?.enabled ? `${item.plan.frequency === "monthly" ? "매월" : "매주"} ${days[item.plan.weekday] || "월"}요일 ${money(item.plan.amount, item.plan.currency)} 모으기` : "주식 모으기 꺼짐"}</p>
    </article>
  `).join("");

  $("#holdingForms").innerHTML = portfolio.holdings.map((item, index) => `
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
  $("#briefingText").textContent = lastBriefing.text || "아직 저장된 브리핑이 없습니다.";
  $("#briefingText2").textContent = lastBriefing.text || "아직 저장된 브리핑이 없습니다.";
}

async function loadAll() {
  const url = endpoint();
  if (!url) {
    toast("Apps Script URL을 먼저 입력하세요.");
    return;
  }
  $("#syncState").textContent = "불러오는 중";
  const data = await fetch(url).then((res) => res.json());
  portfolio = { ...structuredClone(defaults), ...data, holdings: data.holdings || defaults.holdings };
  try {
    const briefUrl = url + (url.includes("?") ? "&" : "?") + "brief=1";
    lastBriefing = await fetch(briefUrl).then((res) => res.json());
  } catch {
    lastBriefing = { text: "" };
  }
  $("#syncState").textContent = "연결됨";
  render();
  toast("설정을 불러왔습니다.");
}

async function saveAll() {
  const url = endpoint();
  if (!url) {
    toast("Apps Script URL을 먼저 입력하세요.");
    return;
  }
  syncFromForms();
  await fetch(url, { method: "POST", mode: "no-cors", body: JSON.stringify(portfolio) });
  $("#syncState").textContent = "저장 요청";
  render();
  toast("저장 요청을 보냈습니다. 불러오기로 확인하세요.");
}

$("#endpoint").value = localStorage.getItem("briefolioEndpoint") || "";
$("#saveEndpointBtn").addEventListener("click", () => {
  localStorage.setItem("briefolioEndpoint", $("#endpoint").value.trim());
  toast("URL을 저장했습니다.");
});
$("#loadBtn").addEventListener("click", loadAll);
$("#saveBtn").addEventListener("click", saveAll);
$("#addHoldingBtn").addEventListener("click", () => {
  syncFromForms();
  portfolio.holdings.push({ id: crypto.randomUUID(), name: "", symbol: "", market: "US", quantity: 0, average_price: 0, plan: { enabled: false, frequency: "weekly", weekday: "MO", amount: 0, currency: "USD", memo: "" }, transactions: [] });
  render();
});
$("#holdingForms").addEventListener("input", syncFromForms);
$("#holdingForms").addEventListener("change", syncFromForms);
$("#holdingForms").addEventListener("click", (event) => {
  if (event.target.dataset.remove === undefined) return;
  syncFromForms();
  portfolio.holdings.splice(Number(event.target.dataset.remove), 1);
  render();
});

render();
if ($("#endpoint").value) loadAll().catch((error) => toast(`불러오기 실패: ${error.message}`));
