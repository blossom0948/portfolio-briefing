const state = {
  portfolio: null,
  snapshot: null,
  briefing: "",
};

const $ = (selector) => document.querySelector(selector);

function money(value, currency) {
  if (value === null || value === undefined) return "-";
  if (currency === "KRW") return `${Math.round(value).toLocaleString("ko-KR")}원`;
  return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

function planText(item) {
  const plan = item.plan || {};
  if (!plan.enabled) return "꺼짐";
  const weekday = { MO: "월", TU: "화", WE: "수", TH: "목", FR: "금", SA: "토", SU: "일" }[plan.weekday] || "월";
  const freq = plan.frequency === "monthly" ? "매월" : "매주";
  return `${freq} ${weekday}요일 ${money(plan.amount, plan.currency)} 모으기`;
}

function renderSnapshot(snapshot) {
  state.snapshot = snapshot;
  $("#totalKrw").textContent = money(snapshot.totals.KRW, "KRW");
  $("#totalUsd").textContent = money(snapshot.totals.USD, "USD");
  $("#activePlans").textContent = `${snapshot.active_plans}개`;
  $("#updatedAt").textContent = snapshot.updated_at;
  $("#holdingCards").innerHTML = snapshot.holdings.map((item) => {
    if (item.error) {
      return `<article class="holding-card warning"><strong>${item.name}</strong><span>${item.error}</span></article>`;
    }
    const direction = item.change >= 0 ? "positive" : "negative";
    const profitClass = item.profit >= 0 ? "positive" : "negative";
    const profit = item.cost ? `<span class="${profitClass}">${money(item.profit, item.currency)} / ${item.profit_pct}%</span>` : "<span>-</span>";
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
          <b>${money(item.close, item.currency)}</b>
          <span class="${direction}">${changeLabel(item)}</span>
        </div>
        <dl>
          <div><dt>수량</dt><dd>${number(item.quantity)}</dd></div>
          <div><dt>평단</dt><dd>${item.average_price ? money(item.average_price, item.currency) : "-"}</dd></div>
          <div><dt>평가액</dt><dd>${item.value ? money(item.value, item.currency) : "-"}</dd></div>
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
          <input name="amount" type="number" step="0.01" value="${plan.amount || 0}">
        </label>
        <label>메모
          <input name="memo" value="${plan.memo || ""}" placeholder="예: 월요일 1만원">
        </label>
        <button type="submit">저장</button>
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
  document.querySelector(`#view-${name}`).classList.add("active");
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === name);
  });
}

async function loadAll() {
  $("#briefingText").textContent = "불러오는 중...";
  const [portfolio, snapshot, news, briefing] = await Promise.all([
    requestJson("/api/portfolio"),
    requestJson("/api/snapshot"),
    requestJson("/api/news"),
    requestJson("/api/briefing"),
  ]);
  state.portfolio = portfolio;
  state.briefing = briefing.text;
  renderSnapshot(snapshot);
  renderSelectors(portfolio);
  renderPlanList(portfolio);
  renderNews(news);
  renderBriefHighlights(snapshot);
  fillSettings(portfolio);
  $("#briefingText").textContent = briefing.text;
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
  $("#aiAnswer").textContent = "AI가 포트폴리오와 브리핑을 읽고 계산하는 중입니다...";
  try {
    const result = await requestJson("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    $("#aiAnswer").textContent = result.answer;
  } catch (error) {
    $("#aiAnswer").textContent = `AI 답변 실패: ${error.message}`;
  }
});

$("#tradeForm").date.valueAsDate = new Date();
loadAll().catch((error) => {
  $("#briefingText").textContent = `초기 로딩 실패: ${error.message}`;
  toast("초기 로딩에 실패했습니다.");
});
