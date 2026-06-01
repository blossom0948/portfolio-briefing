(() => {
  const fallbackHoldings = [
    { id: "samsung-electronics", name: "삼성전자", symbol: "005930", market: "KR" },
    { id: "qqqm", name: "QQQM", symbol: "QQQM", market: "US" },
    { id: "voo", name: "VOO", symbol: "VOO", market: "US" },
  ];

  const canvas = document.querySelector("#chartLightningCanvas");
  const ctx = canvas?.getContext("2d");
  const stockButtons = document.querySelector("#landingStockButtons");
  const stockName = document.querySelector("#landingStockName");
  const stockChange = document.querySelector("#landingStockChange");
  const appShell = document.querySelector("#appShell");
  const landingPage = document.querySelector("#landingPage");
  const state = {
    points: [],
    dates: [],
    active: fallbackHoldings[0],
    changePct: null,
    hue: 210,
    startedAt: performance.now(),
  };

  function money(value, currency) {
    const amount = Number(value || 0);
    return currency === "KRW"
      ? `${Math.round(amount).toLocaleString("ko-KR")}원`
      : `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  async function safeJson(url) {
    const headers = { accept: "application/json" };
    const pin = localStorage.getItem("briefolioPin");
    if (pin) headers["X-App-Pin"] = pin;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(response.statusText);
    return response.json();
  }

  async function loadPortfolio() {
    try {
      return await safeJson("/api/config");
    } catch {
      try {
        return await safeJson("/api/portfolio");
      } catch {
        return { holdings: fallbackHoldings };
      }
    }
  }

  function fallbackPoints() {
    return Array.from({ length: 96 }, (_, index) => {
      const wave = Math.sin(index * 0.18) * 7 + Math.cos(index * 0.07) * 10;
      const trend = index * 0.18;
      return 100 + wave + trend;
    });
  }

  function fallbackDates(length = 96) {
    const now = new Date();
    return Array.from({ length }, (_, index) => {
      const day = new Date(now);
      day.setDate(now.getDate() - (length - index - 1));
      return day.toISOString().slice(0, 10);
    });
  }

  function setChartMeta(data, item) {
    const points = data?.points?.map((point) => Number(point.close)).filter(Number.isFinite) || [];
    state.points = points.length > 3 ? points : fallbackPoints();
    state.dates = data?.points?.map((point) => point.date).filter(Boolean) || fallbackDates(state.points.length);
    state.active = item;
    state.changePct = typeof data?.change_pct === "number" ? data.change_pct : null;
    const positive = (state.changePct || 0) >= 0;
    state.hue = item.market === "KR" ? 178 : positive ? 140 : 8;
    stockName.textContent = `${item.name || item.symbol} · ${item.symbol}`;
    stockChange.textContent = state.changePct === null
      ? "차트 기준"
      : `${positive ? "+" : ""}${state.changePct.toFixed(2)}%`;
    stockChange.classList.toggle("down", !positive);
    stockChange.classList.toggle("up", positive);
    const last = state.points.at(-1);
    if (last) {
      const firstDate = state.dates[0] || "시작";
      const lastDate = state.dates.at(-1) || "최근";
      document.querySelector("#landingStockRange").textContent = `${firstDate} → ${lastDate} · ${money(last, data?.currency || (item.market === "KR" ? "KRW" : "USD"))}`;
    }
  }

  async function loadChart(item) {
    stockButtons?.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.symbol === item.symbol);
    });
    stockName.textContent = `${item.name || item.symbol} 불러오는 중`;
    try {
      const data = await safeJson(`/api/history?symbol=${encodeURIComponent(item.symbol)}&market=${encodeURIComponent(item.market || "US")}&range=6mo&period=6mo`);
      setChartMeta(data, item);
    } catch {
      setChartMeta({ points: fallbackPoints().map((close, index) => ({ date: String(index), close })) }, item);
    }
  }

  function renderStockButtons(holdings) {
    const list = (holdings || fallbackHoldings).filter((item) => item.symbol).slice(0, 5);
    stockButtons.innerHTML = list.map((item) => `
      <button type="button" data-symbol="${item.symbol}" data-market="${item.market || "US"}">
        <span>${item.name || item.symbol}</span>
        <small>${item.symbol} · ${item.market || "US"}</small>
      </button>
    `).join("");
    stockButtons.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        const item = list.find((holding) => holding.symbol === button.dataset.symbol) || fallbackHoldings[0];
        loadChart(item);
      });
    });
    loadChart(list[0] || fallbackHoldings[0]);
  }

  function resizeCanvas() {
    if (!canvas || !ctx) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function formatDateLabel(dateText) {
    if (!dateText) return "";
    const date = new Date(dateText);
    if (Number.isNaN(date.getTime())) return dateText;
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function chartCoords(width, height, time) {
    const values = state.points.length ? state.points : fallbackPoints();
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const padX = Math.max(28, width * 0.05);
    const padY = Math.max(92, height * 0.16);
    return values.map((value, index) => {
      const progress = values.length === 1 ? 0 : index / (values.length - 1);
      const x = padX + progress * (width - padX * 2);
      const normalized = (value - min) / range;
      const y = height - padY - normalized * (height - padY * 1.75);
      const pulse = Math.sin(time * 1.8 + index * 0.34) * 6;
      return [x, y + pulse, value, state.dates[index]];
    });
  }

  function strokePath(points, color, width, alpha = 1, offsetY = 0) {
    if (!points.length) return;
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      const nextY = y + offsetY;
      if (index === 0) ctx.moveTo(x, nextY);
      else ctx.lineTo(x, nextY);
    });
    ctx.strokeStyle = color.replace("ALPHA", alpha);
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function drawChartLabels(points, width, height) {
    if (!points.length) return;
    const labelIndexes = [0, Math.floor(points.length / 2), points.length - 1];
    ctx.save();
    ctx.font = "700 12px Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = 10;
    labelIndexes.forEach((index) => {
      const point = points[index];
      if (!point) return;
      const [x, y, value, date] = point;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${state.hue}, 100%, 66%, 0.95)`;
      ctx.arc(x, y, index === points.length - 1 ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.textAlign = index === 0 ? "left" : index === points.length - 1 ? "right" : "center";
      ctx.fillText(formatDateLabel(date), x, Math.min(height - 34, y + 32));
      if (index === points.length - 1) {
        const currency = state.active.market === "KR" ? "KRW" : "USD";
        const price = money(value, currency);
        const pillWidth = Math.min(152, ctx.measureText(price).width + 24);
        const pillX = Math.min(width - pillWidth - 18, Math.max(18, x - pillWidth + 10));
        const pillY = Math.max(72, y - 42);
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.strokeStyle = "rgba(255,255,255,0.42)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillWidth, 28, 14);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText(price, pillX + pillWidth / 2, pillY + 14);
      }
    });
    ctx.restore();
  }

  function draw(timestamp) {
    if (!canvas || !ctx) return;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const time = (timestamp - state.startedAt) / 1000;
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#05070a");
    gradient.addColorStop(0.56, "#0b1018");
    gradient.addColorStop(1, "#141312");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i += 1) {
      const y = (height / 8) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y + Math.sin(time + i) * 10);
      ctx.stroke();
    }

    const points = chartCoords(width, height, time);
    const color = `hsla(${state.hue}, 95%, 66%, ALPHA)`;
    ctx.shadowColor = `hsla(${state.hue}, 100%, 66%, 1)`;
    ctx.shadowBlur = 34;
    strokePath(points, color, 18, 0.12, 42);
    strokePath(points, color, 12, 0.22, 22);
    strokePath(points, color, 6, 0.94, 0);
    ctx.shadowBlur = 0;
    strokePath(points, "rgba(255,255,255,ALPHA)", 2, 0.96, 0);
    drawChartLabels(points, width, height);

    const count = 11;
    for (let i = 0; i < count; i += 1) {
      const target = points[Math.floor(((time * 12 + i * 17) % points.length))];
      if (!target) continue;
      const radius = 2 + Math.sin(time * 3 + i) * 1.2;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${state.hue}, 100%, 70%, 0.72)`;
      ctx.arc(target[0], target[1], Math.max(1.5, radius), 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  function showApp(view = "dashboard") {
    appShell.hidden = false;
    appShell.classList.remove("app-shell-enter");
    void appShell.offsetWidth;
    appShell.classList.add("app-shell-enter");
    landingPage.classList.add("landing-exit");
    window.setTimeout(() => {
      landingPage.hidden = true;
      landingPage.classList.remove("landing-exit");
    }, 260);
    if (typeof window.showView === "function") {
      window.showView(view);
    } else {
      document.querySelector(`.nav-item[data-view="${view}"]`)?.click();
    }
    history.replaceState(null, "", `#${view}`);
  }

  function showLanding() {
    landingPage.hidden = false;
    landingPage.classList.remove("landing-exit");
    landingPage.classList.add("landing-return");
    appShell.classList.add("app-shell-exit");
    window.setTimeout(() => {
      appShell.hidden = true;
      appShell.classList.remove("app-shell-exit", "app-shell-enter");
      landingPage.classList.remove("landing-return");
    }, 260);
    history.replaceState(null, "", location.pathname);
  }

  document.querySelectorAll("[data-open-view]").forEach((button) => {
    button.addEventListener("click", () => showApp(button.dataset.openView || "dashboard"));
  });
  document.querySelector("#enterDashboardBtn")?.addEventListener("click", () => showApp("dashboard"));
  document.querySelector("#landingBriefBtn")?.addEventListener("click", () => showApp("briefing"));
  document.querySelectorAll("[data-return-landing]").forEach((button) => {
    button.addEventListener("click", showLanding);
  });

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  requestAnimationFrame(draw);

  loadPortfolio().then((portfolio) => renderStockButtons(portfolio.holdings)).catch(() => renderStockButtons(fallbackHoldings));

  const initialView = location.hash.replace("#", "");
  if (["dashboard", "manage", "briefing", "settings"].includes(initialView)) {
    showApp(initialView);
  }
})();
