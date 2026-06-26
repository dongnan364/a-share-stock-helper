const state = {
  market: "全部",
  sector: "全部",
  risk: "全部",
  search: "",
  favOnly: false,
  selected: null,
  summary: null,
  marketOptions: ["全部", "主板", "创业板"],
  sectorOptions: ["全部", "AI", "机器人"],
  riskOptions: ["全部", "低", "中", "高"],
  stocks: [],
  loadingSummary: true,
  loadingStocks: true,
  refreshing: false,
  total: 0,
  updatedAt: "",
};

const storageKey = "a-stock-helper-favs";
const el = (id) => document.getElementById(id);
const favs = loadFavs();
let loadSeq = 0;
let searchTimer = null;
let refreshTimer = null;

function loadFavs() {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"));
  } catch {
    return new Set();
  }
}

function saveFavs() {
  localStorage.setItem(storageKey, JSON.stringify([...favs]));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmt(value, digits = 2) {
  const n = num(value);
  return n ? n.toFixed(digits) : "-";
}

function toMoney(value) {
  const n = num(value);
  if (n <= 0) return "-";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}万亿元`;
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿元`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(2)}万元`;
  return n.toFixed(2);
}

function toPct(value) {
  const n = num(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatDateTime(text) {
  if (!text) {
    return new Date().toLocaleString("zh-CN", { hour12: false });
  }
  return text;
}

function friendlyRank(rank) {
  return {
    "重点关注": "优先看",
    "可观察": "可以看",
    "观察中": "先看看",
    "暂不介入": "先不看",
  }[rank] || "先看";
}

function friendlyStrategy(strategy) {
  return {
    "强势趋势": "强势上涨",
    "回踩观察": "回调后看",
    "低吸观察": "回调后看",
    "等待确认": "先观察",
    "观望": "先不动",
  }[strategy] || "先观察";
}

function friendlyRisk(risk) {
  return {
    高: "波动大",
    中: "一般",
    低: "较稳",
  }[risk] || "一般";
}

function friendlyConfidence(confidence) {
  return {
    高: "高",
    较高: "较高",
    一般: "一般",
    偏低: "不太确定",
  }[confidence] || "一般";
}

function friendlyTheme(theme) {
  return {
    AI: "AI相关",
    机器人: "机器人相关",
  }[theme] || theme || "其他";
}

function friendlySector(sector) {
  if (!sector) return "-";
  if (sector === "AI" || sector === "机器人") return friendlyTheme(sector);
  const map = {
    "信息技术": "信息技术",
    "软件和信息技术服务业": "软件信息",
    "文化传播": "文化传媒",
    "卫生": "医疗健康",
    "居民服务": "居民服务",
    "批发零售": "批零",
    "商务服务": "商务服务",
    "科研服务": "科研服务",
    "水利": "环保公用",
  };
  return map[sector] || sector;
}

function companyIntro(item) {
  if (item?.intro) return item.intro;
  const name = item?.company || item?.name || "这家公司";
  const sector = friendlySector(item?.sector);
  const themes = Array.isArray(item?.themes) && item.themes.length
    ? `，也和${item.themes.map(friendlyTheme).join("、")}有关`
    : "";
  return `${name}主要做${sector}相关业务${themes}。`;
}

async function api(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  url.searchParams.set("_ts", String(Date.now()));
  const response = await fetch(url.toString(), { cache: "no-store" });
  const json = await response.json();
  if (!response.ok || json.ok === false) {
    throw new Error(json.message || `Request failed: ${response.status}`);
  }
  return json;
}

function currentVisibleStocks() {
  const rows = state.favOnly ? state.stocks.filter((item) => favs.has(item.code)) : state.stocks;
  return rows;
}

function selectedStock() {
  const rows = currentVisibleStocks();
  if (!rows.length) return null;
  return rows.find((item) => item.code === state.selected) || rows[0];
}

function setLoadingUI() {
  el("stockList").innerHTML = '<div class="loading">正在连接最新行情...</div>';
  el("detailView").innerHTML = '<div class="loading">等待最新数据...</div>';
  el("currentRank").textContent = "加载中";
  el("statCount").textContent = "-";
  el("statUp").textContent = "-";
  el("statTop").textContent = "-";
}

function renderSummary() {
  const summary = state.summary;
  if (!summary) {
    el("updateTime").textContent = "加载中...";
    el("refreshState").textContent = "暂时还没有拿到实时数据";
    el("marketChips").innerHTML = '<span class="chip">热点方向加载中...</span>';
    el("indexRow").innerHTML = '<span class="label">大盘信息加载中...</span>';
    return;
  }

  el("updateTime").textContent = formatDateTime(summary.updatedAt);
  el("refreshState").textContent = state.refreshing ? "正在刷新最新数据..." : "数据已就绪";

  const chips = summary.hotSectors?.length
    ? summary.hotSectors.slice(0, 6).map((item) => {
        const active = state.sector === item.sector ? " active" : "";
        return `<button class="chip${active}" data-sector="${item.sector}">${friendlySector(item.sector)}</button>`;
      }).join("")
    : '<span class="chip">暂无热点方向</span>';
  el("marketChips").innerHTML = chips;

  const moodText = `市场感觉：${summary.mood} · 涨 ${summary.upCount} · 跌 ${summary.downCount}`;
  const indexRow = [moodText, ...(summary.indices || []).map((item) => `${item.name} ${fmt(item.point)}`)];
  el("indexRow").innerHTML = indexRow.map((text) => `<span class="label">${text}</span>`).join("");

  el("marketChips").querySelectorAll("button[data-sector]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sector = button.dataset.sector || "全部";
      loadStocks();
      render();
    });
  });
}

function renderFilters() {
  const filterArea = el("filterTags");
  const groups = [
    { options: state.marketOptions, key: "market" },
    { options: state.sectorOptions, key: "sector" },
    { options: state.riskOptions, key: "risk" },
  ];

  filterArea.innerHTML = groups.map((group) => {
    const buttons = group.options.map((item) => {
      const label = group.key === "sector" ? friendlySector(item) : item;
      const active = state[group.key] === item ? " active" : "";
      return `<button class="tag${active}" data-key="${group.key}" data-value="${item}">${label}</button>`;
    }).join("");
    return `<div class="tags">${buttons}</div>`;
  }).join("");

  filterArea.querySelectorAll("button[data-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state[button.dataset.key] = button.dataset.value;
      loadStocks();
      render();
    });
  });
}

function renderList() {
  const list = el("stockList");
  const rows = currentVisibleStocks();
  const visibleRows = rows.slice(0, 24);

  el("statCount").textContent = String(state.favOnly ? rows.length : (state.total || rows.length));
  el("statUp").textContent = state.summary ? String(state.summary.upCount) : "-";
  el("statTop").textContent = state.summary ? String(state.summary.topCount) : String(rows.filter((item) => item.score >= 80).length);

  if (state.loadingStocks) {
    list.innerHTML = '<div class="loading">正在加载最新数据...</div>';
    return;
  }

  if (!rows.length) {
    list.innerHTML = `
      <div class="empty">
        <strong>没有找到符合条件的股票</strong>
        <div style="margin-top:8px;">可以试试放宽市场、方向或者风险条件。</div>
      </div>
    `;
    return;
  }

  list.innerHTML = visibleRows.map((item) => {
    const riskClass = item.risk === "高" ? "danger" : item.risk === "低" ? "good" : "warn";
    return `
      <article class="stock-item${state.selected === item.code ? " active" : ""}" data-code="${item.code}">
        <div>
          <div class="stock-title">
            <strong>${item.name}</strong>
            <span class="label">${item.market}</span>
            ${Array.isArray(item.themes) ? item.themes.map((theme) => `<span class="label">${friendlyTheme(theme)}</span>`).join("") : ""}
            <span class="label">${friendlyStrategy(item.strategy)}</span>
            <span class="label ${riskClass}">风险：${friendlyRisk(item.risk)}</span>
            <span class="label">把握：${friendlyConfidence(item.confidence)}</span>
            ${favs.has(item.code) ? '<span class="label good">已收藏</span>' : ""}
          </div>
          <div class="meta">${item.code} · ${friendlySector(item.sector)} · ${item.province} · 最新价 ${fmt(item.price)} · 涨跌 ${toPct(item.changePct)}</div>
          <div class="muted" style="margin-top:8px;">公司简介：${companyIntro(item)}</div>
          <div class="line">
            <span class="muted">参考区间 ${fmt(item.buyZone?.[0])} - ${fmt(item.buyZone?.[1])}</span>
            <span class="muted">关注时机：${item.trigger || "等待确认"}</span>
            <span class="muted">建议仓位 ${item.positionPct || 0}%</span>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:28px;font-weight:800;color:#16345f;">${item.score}</div>
          <div class="muted">推荐分</div>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll(".stock-item").forEach((node) => {
    node.addEventListener("click", () => {
      state.selected = node.dataset.code || null;
      renderDetail();
      highlightSelected();
    });
  });
}

function highlightSelected() {
  document.querySelectorAll(".stock-item").forEach((node) => {
    node.classList.toggle("active", node.dataset.code === state.selected);
  });
}

function renderDetail() {
  const stock = selectedStock();
  const detail = el("detailView");

  if (!stock) {
    detail.innerHTML = '<div class="empty">当前条件下没有可展示的股票详情。</div>';
    el("currentRank").textContent = "无结果";
    return;
  }

  el("currentRank").textContent = `${friendlyRank(stock.rank)} / ${friendlyStrategy(stock.strategy)}`;
  detail.innerHTML = `
    <div class="detail-card">
      <h3>${stock.name} · ${stock.code}</h3>
      <div class="meta">${stock.market} · ${friendlySector(stock.sector)} · ${stock.province} · 最新价 ${fmt(stock.price)} · ${toPct(stock.changePct)}</div>
      <div class="muted" style="margin-top:8px;">公司简介：${companyIntro(stock)}</div>
    </div>

    <div class="detail-card">
      <h3>怎么看</h3>
      <ul>
        <li>现在怎么看：${friendlyStrategy(stock.strategy)}</li>
        <li>把握程度：${friendlyConfidence(stock.confidence)}</li>
        <li>建议仓位：${stock.positionPct}%</li>
        <li>推荐分：${stock.score}</li>
        <li>相关方向：${Array.isArray(stock.themes) && stock.themes.length ? stock.themes.map(friendlyTheme).join(" / ") : "无"}</li>
      </ul>
    </div>

    <div class="detail-card">
      <h3>参考买点</h3>
      <div class="buy-zone">
        <div class="buy-box">
          <span>参考买入区间</span>
          <strong>${fmt(stock.buyZone?.[0])} - ${fmt(stock.buyZone?.[1])}</strong>
        </div>
        <div class="buy-box">
          <span>关注时机</span>
          <strong>${stock.trigger || "等待确认"}</strong>
        </div>
        <div class="buy-box">
          <span>如果走弱怎么办</span>
          <strong>${fmt(stock.price * 0.94)} 以下谨慎</strong>
        </div>
      </div>
    </div>

    <div class="detail-card">
      <h3>基础数据</h3>
      <ul>
        <li>成交额：${toMoney(stock.amount)}</li>
        <li>成交量：${toMoney(stock.volume)}</li>
        <li>换手率：${fmt(stock.turnover)}%</li>
        <li>总市值：${toMoney(stock.marketCap)}</li>
        <li>下方参考：${fmt(stock.support)}</li>
        <li>上方参考：${fmt(stock.resistance)}</li>
      </ul>
    </div>

    <div class="detail-card">
      <h3>为什么看它</h3>
      <ul>${(stock.logic || []).map((item) => `<li>${item}</li>`).join("")}</ul>
    </div>

    <div class="detail-card">
      <h3>注意点</h3>
      <ul>${(stock.riskNotes || []).map((item) => `<li>${item}</li>`).join("")}</ul>
    </div>

    <div class="detail-card">
      <h3>操作</h3>
      <div class="line">
        <button class="btn" id="favBtn">${favs.has(stock.code) ? "取消收藏" : "加入收藏"}</button>
        <button class="btn secondary" id="alertBtn">提醒占位</button>
      </div>
    </div>
  `;

  el("favBtn").addEventListener("click", () => {
    if (favs.has(stock.code)) {
      favs.delete(stock.code);
    } else {
      favs.add(stock.code);
    }
    saveFavs();
    renderList();
    renderDetail();
  });

  el("alertBtn").addEventListener("click", () => {
    alert("提醒功能先做占位，后面可以接短信或微信通知。");
  });
}

function render() {
  renderSummary();
  renderFilters();
  renderList();
  renderDetail();
  el("toggleFavBtn").textContent = state.favOnly ? "查看全部" : "只看自选";
  el("refreshBtn").textContent = state.refreshing ? "刷新中..." : "刷新数据";
}

async function loadBootstrap() {
  state.loadingSummary = true;
  try {
    const [boot, opts] = await Promise.all([api("/api/bootstrap"), api("/api/options")]);
    state.summary = boot.summary;
    state.updatedAt = boot.updatedAt || boot.summary?.updatedAt || "";
    state.marketOptions = opts.marketOptions || state.marketOptions;
    state.sectorOptions = Array.from(new Set(["全部", "AI", "机器人", ...(opts.sectorOptions || []).filter((item) => item !== "全部") ]));
    state.riskOptions = opts.riskOptions || state.riskOptions;
  } finally {
    state.loadingSummary = false;
  }
}

async function loadStocks() {
  const seq = ++loadSeq;
  state.loadingStocks = true;
  render();
  try {
    const payload = await api("/api/stocks", {
      market: state.market,
      sector: state.sector,
      risk: state.risk,
      search: state.search,
      limit: 24,
    });
    if (seq !== loadSeq) return;
    state.stocks = payload.stocks || [];
    state.total = payload.total || 0;
    state.updatedAt = payload.updatedAt || state.updatedAt;
    if (!state.stocks.find((item) => item.code === state.selected)) {
      state.selected = state.stocks[0]?.code || null;
    }
  } catch (error) {
    if (seq !== loadSeq) return;
    state.stocks = [];
    state.total = 0;
    el("stockList").innerHTML = `<div class="empty">数据加载失败：${error.message}</div>`;
    el("detailView").innerHTML = '<div class="empty">暂时没有可展示的数据。</div>';
  } finally {
    if (seq === loadSeq) {
      state.loadingStocks = false;
      render();
    }
  }
}

async function refreshAll() {
  state.refreshing = true;
  render();
  try {
    await api("/api/refresh");
    await Promise.all([loadBootstrap(), loadStocks()]);
  } finally {
    state.refreshing = false;
    render();
  }
}

function wireEvents() {
  el("search").addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadStocks(), 250);
  });

  el("resetBtn").addEventListener("click", () => {
    state.market = "全部";
    state.sector = "全部";
    state.risk = "全部";
    state.search = "";
    state.favOnly = false;
    state.selected = null;
    el("search").value = "";
    loadStocks();
    render();
  });

  el("toggleFavBtn").addEventListener("click", () => {
    state.favOnly = !state.favOnly;
    render();
  });

  el("refreshBtn").addEventListener("click", () => {
    refreshAll();
  });
}

async function init() {
  setLoadingUI();
  wireEvents();
  try {
    await loadBootstrap();
    render();
    await loadStocks();
    refreshTimer = setInterval(() => {
      refreshAll().catch(() => {});
    }, 15 * 1000);
  } catch (error) {
    state.loadingSummary = false;
    state.loadingStocks = false;
    el("stockList").innerHTML = `<div class="empty">初始化失败：${error.message}</div>`;
    el("detailView").innerHTML = '<div class="empty">请稍后重试。</div>';
  }
}

init();
