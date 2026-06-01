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

  function setChartMeta(data, item) {
    const points = data?.points?.map((point) => Number(point.close)).filter(Number.isFinite) || [];
    state.points = points.length > 3 ? points : fallbackPoints();
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
      document.querySelector("#landingStockRange").textContent = `최근 6개월 · ${money(last, data?.currency || (item.market === "KR" ? "KRW" : "USD"))}`;
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
      return [x, y + pulse];
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

    ctx.strokeStyle = "rgba(255,255,255,0.055)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i += 1) {
      const y = (height / 8) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y + Math.sin(time + i) * 10);
      ctx.stroke();
    }

    const points = chartCoords(width, height, time);
    const color = `hsla(${state.hue}, 92%, 62%, ALPHA)`;
    ctx.shadowColor = `hsla(${state.hue}, 100%, 62%, 0.85)`;
    ctx.shadowBlur = 22;
    strokePath(points, color, 9, 0.13, 30);
    strokePath(points, color, 5, 0.22, 14);
    strokePath(points, color, 3, 0.9, 0);
    ctx.shadowBlur = 0;
    strokePath(points, "rgba(255,255,255,ALPHA)", 1.2, 0.95, 0);

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
    landingPage.hidden = true;
    appShell.hidden = false;
    if (typeof window.showView === "function") {
      window.showView(view);
    } else {
      document.querySelector(`.nav-item[data-view="${view}"]`)?.click();
    }
    history.replaceState(null, "", `#${view}`);
  }

  document.querySelectorAll("[data-open-view]").forEach((button) => {
    button.addEventListener("click", () => showApp(button.dataset.openView || "dashboard"));
  });
  document.querySelector("#enterDashboardBtn")?.addEventListener("click", () => showApp("dashboard"));
  document.querySelector("#landingBriefBtn")?.addEventListener("click", () => showApp("briefing"));

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  requestAnimationFrame(draw);

  loadPortfolio().then((portfolio) => renderStockButtons(portfolio.holdings)).catch(() => renderStockButtons(fallbackHoldings));

  const initialView = location.hash.replace("#", "");
  if (["dashboard", "manage", "briefing", "settings"].includes(initialView)) {
    showApp(initialView);
  }
})();
