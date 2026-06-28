const state = {
  market: "全部",
  sector: "全部",
  risk: "全部",
  volatility: "全部",
  search: "",
  favOnly: false,
  chartMode: "day",
  selected: null,
  summary: null,
  marketOptions: ["全部", "主板", "创业板"],
  sectorOptions: ["全部", "AI", "机器人"],
  riskOptions: ["全部", "低", "中", "高"],
  volatilityOptions: ["全部", "低波动", "中波动", "高波动"],
  stocks: [],
  loadingSummary: true,
  loadingStocks: true,
  refreshing: false,
  total: 0,
  updatedAt: "",
  searchMode: false,
  searchKeyword: "",
  externalReady: false,
  externalLoading: false,
  externalError: "",
  dataSource: "本地缓存",
};

const storageKey = "a-stock-helper-favs";
const el = (id) => document.getElementById(id);
const favs = loadFavs();
let loadSeq = 0;
let searchTimer = null;
let refreshTimer = null;
const historyCache = new Map();
const chartCache = new Map();
const API_BASE = "https://a-share-stock-helper.onrender.com";
const chartModes = [
  { key: "time", label: "分时" },
  { key: "day", label: "日线" },
  { key: "week", label: "周线" },
  { key: "month", label: "月线" },
  { key: "year", label: "年线" },
];
const externalMarket = {
  stocks: [],
  summary: null,
  loading: null,
  loadedAt: 0,
  lastError: "",
  source: "东方财富实时行情",
};
window.__stockAppState = state;
window.__externalMarket = externalMarket;

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function quoteClass(value) {
  const n = num(value);
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}

function volatilityClass(value) {
  const n = num(value);
  if (n >= 10) return "hot";
  if (n >= 6) return "mid";
  return "calm";
}

function volatilityText(item, rank) {
  const value = fmt(item.amplitude || 0);
  if (rank && (rank <= 5 || num(item.amplitude) >= 10)) return `波动第${rank} · ${value}%`;
  return `波动 ${value}%`;
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
    high: "波动大",
    medium: "一般",
    low: "较稳",
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

function friendlyMarket(market) {
  return {
    "Main Board": "主板",
    "沪深主板": "主板",
    ChiNext: "创业板",
    "创业板": "创业板",
    "主板": "主板",
    "指数基金": "指数基金",
  }[market] || market || "-";
}

function friendlyTheme(theme) {
  return {
    AI: "AI相关",
    机器人: "机器人相关",
    robotics: "机器人相关",
    "指数基金": "指数基金",
  }[theme] || theme || "其他";
}

function friendlySector(sector) {
  if (!sector) return "-";
  if (sector === "All" || sector === "全部") return "全部";
  if (sector === "robotics") return "机器人相关";
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

function normalizeMarket(value) {
  return {
    All: "全部",
    "Main Board": "主板",
    ChiNext: "创业板",
    "沪深主板": "主板",
    "指数基金": "指数基金",
  }[value] || value || "全部";
}

function normalizeRisk(value) {
  return {
    All: "全部",
    high: "高",
    medium: "中",
    low: "低",
  }[value] || value || "全部";
}

function normalizeVolatility(value) {
  return {
    All: "全部",
    all: "全部",
    calm: "低波动",
    low: "低波动",
    mid: "中波动",
    medium: "中波动",
    hot: "高波动",
    high: "高波动",
    低: "低波动",
    中: "中波动",
    高: "高波动",
  }[value] || value || "全部";
}

function friendlyVolatility(value) {
  const normalized = normalizeVolatility(value);
  return {
    全部: "全部波动",
    低波动: "低波动",
    中波动: "中波动",
    高波动: "高波动",
  }[normalized] || normalized;
}

function normalizeSector(value) {
  return {
    All: "全部",
    "指数基金": "指数基金",
    robotics: "机器人",
    "机器人相关": "机器人",
    "AI相关": "AI",
  }[value] || value || "全部";
}

function uniqueOptions(items) {
  return [...new Set(items.filter(Boolean))];
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

function isAllFilter(value) {
  return !value || value === "All" || value === "全部";
}

function marketMatches(filter, itemMarket) {
  if (isAllFilter(filter)) return true;
  const normalizedFilter = normalizeMarket(filter);
  const normalizedMarket = normalizeMarket(itemMarket);
  return normalizedFilter === normalizedMarket;
}

function riskMatches(filter, itemRisk) {
  if (isAllFilter(filter)) return true;
  return normalizeRisk(filter) === normalizeRisk(itemRisk);
}

function volatilityMatches(filter, amplitude) {
  const normalized = normalizeVolatility(filter);
  if (isAllFilter(normalized)) return true;
  const level = volatilityClass(amplitude);
  if (normalized === "低波动") return level === "calm";
  if (normalized === "中波动") return level === "mid";
  if (normalized === "高波动") return level === "hot";
  return true;
}

function sectorMatches(filter, item) {
  if (isAllFilter(filter)) return true;
  const normalized = normalizeSector(filter);
  const themes = Array.isArray(item.themes) ? item.themes.map(normalizeSector) : [];
  if (normalized === "AI" && (normalizeSector(item.sector) === "AI" || themes.includes("AI"))) return true;
  if (normalized === "机器人" && (normalizeSector(item.sector) === "机器人" || themes.includes("机器人"))) return true;
  if (normalized === "新能源" && (normalizeSector(item.sector) === "新能源" || themes.includes("新能源"))) return true;
  return normalizeSector(item.sector) === normalized || themes.includes(normalized);
}

function stockSearchText(item) {
  return [
    item.code,
    item.symbol,
    item.name,
    item.company,
    item.market,
    item.sector,
    item.province,
    item.city,
    item.intro,
    item.concepts,
    ...(Array.isArray(item.themes) ? item.themes : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function searchRank(item, keyword) {
  const code = String(item.code || "").toLowerCase();
  const symbol = String(item.symbol || "").toLowerCase();
  const name = String(item.name || "").toLowerCase();
  const company = String(item.company || "").toLowerCase();
  if (code === keyword || symbol === keyword || name === keyword) return 1000;
  if (code.startsWith(keyword) || symbol.startsWith(keyword) || name.startsWith(keyword)) return 900;
  if (name.includes(keyword) || code.includes(keyword) || symbol.includes(keyword)) return 850;
  if (company.includes(keyword)) return 820;
  return 0;
}
function jsonp(url, callbackParam = "cb", timeoutMs = 18000) {
  return new Promise((resolve, reject) => {
    const callbackName = `__ashare_jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const separator = url.includes("?") ? "&" : "?";
    const script = document.createElement("script");
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("外部行情接口暂时连不上"));
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error("外部行情接口响应超时"));
    }, timeoutMs);

    script.src = `${url}${separator}${callbackParam}=${callbackName}&_=${Date.now()}`;
    document.head.appendChild(script);
  });
}

function eastmoneyListUrl(page = 1, pageSize = 100, fsValue = "m:1+t:2,m:0+t:6,m:0+t:80") {
  const params = new URLSearchParams({
    pn: String(page),
    pz: String(pageSize),
    po: "1",
    np: "1",
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: "2",
    invt: "2",
    fid: "f3",
    fs: fsValue,
    fields: "f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f15,f16,f17,f18,f20,f21,f23,f100,f102,f103",
  });
  return `https://push2.eastmoney.com/api/qt/clist/get?${params.toString()}`;
}

function eastmoneyFundListUrl(page = 1, pageSize = 100) {
  return eastmoneyListUrl(page, pageSize, "b:MK0021,b:MK0022,b:MK0023,b:MK0024");
}

async function fetchEastmoneyRowsByUrl(urlBuilder, pageLimit = 70) {
  const pageSize = 100;
  const firstPayload = await jsonp(urlBuilder(1, pageSize));
  const firstRows = Object.values(firstPayload?.data?.diff || {});
  const total = Number(firstPayload?.data?.total || firstRows.length || 0);
  const pageCount = Math.min(Math.ceil(total / pageSize), pageLimit);
  const rows = [...firstRows];

  const pages = [];
  for (let page = 2; page <= pageCount; page += 1) pages.push(page);

  for (let index = 0; index < pages.length; index += 8) {
    const group = pages.slice(index, index + 8);
    const payloads = await Promise.all(
      group.map((page) => jsonp(urlBuilder(page, pageSize)).catch(() => null))
    );
    payloads.forEach((payload) => {
      rows.push(...Object.values(payload?.data?.diff || {}));
    });
  }

  return rows;
}

async function fetchEastmoneyStockRows() {
  return fetchEastmoneyRowsByUrl(eastmoneyListUrl, 70);
}

function isIndexFundName(name) {
  return /ETF|指数|沪深|中证|上证|创业板|深证|A500|红利|50|100|300|500|1000|恒生|纳指|标普|科创/i.test(String(name || ""));
}

async function fetchEastmoneyFundRows() {
  const rows = await fetchEastmoneyRowsByUrl(eastmoneyFundListUrl, 30);
  return rows
    .filter((row) => isIndexFundName(row.f14))
    .map((row) => ({ ...row, __assetType: "fund" }));
}
function eastmoneyIndexUrl() {
  const params = new URLSearchParams({
    fltt: "2",
    secids: "1.000001,0.399001,0.399006",
    fields: "f12,f14,f2,f3,f4,f6,f15,f16,f17,f18",
  });
  return `https://push2.eastmoney.com/api/qt/ulist.np/get?${params.toString()}`;
}

function emNumber(value) {
  if (value === "-" || value === null || value === undefined) return 0;
  return num(value);
}

function boardFromCode(code, assetType = "stock") {
  if (assetType === "fund") return "指数基金";
  return String(code || "").startsWith("30") ? "创业板" : "主板";
}

function fundSectorFromName(name) {
  const text = String(name || "");
  if (/沪深300|300/.test(text)) return "沪深300指数基金";
  if (/中证500|500/.test(text)) return "中证500指数基金";
  if (/中证1000|1000/.test(text)) return "中证1000指数基金";
  if (/创业板/.test(text)) return "创业板指数基金";
  if (/上证50|50ETF|50/.test(text)) return "上证50指数基金";
  if (/红利/.test(text)) return "红利指数基金";
  if (/科创/.test(text)) return "科创指数基金";
  if (/恒生|纳指|标普/.test(text)) return "跨境指数基金";
  return "指数基金";
}

function deriveExternalThemes(item) {
  if (item.market === "指数基金") return ["指数基金"];
  const text = `${item.name || ""} ${item.sector || ""} ${item.concepts || ""}`.toLowerCase();
  const themes = [];
  if (/ai|人工智能|算力|数据|软件|信息|通信|电子|芯片|半导体|智能|云|算法/.test(text)) themes.push("AI");
  if (/机器人|自动化|机床|机械|装备|伺服|传感器|工业母机/.test(text)) themes.push("机器人");
  if (/新能源|电池|光伏|储能|锂|风电|充电/.test(text)) themes.push("新能源");
  return [...new Set(themes)];
}

function externalRisk(record) {
  if (record.market === "指数基金") {
    if (Math.abs(record.changePct) >= 3.5 || record.amplitude >= 5) return "中";
    return "低";
  }
  if (record.changePct >= 10 || record.amplitude >= 10 || record.amount < 150000000) return "高";
  if (record.amplitude >= 5 || record.changePct >= 3 || record.market === "创业板") return "中";
  return "低";
}

function externalScore(record) {
  const amountScore = record.amount >= 2000000000 ? 14 : record.amount >= 800000000 ? 10 : record.amount >= 200000000 ? 6 : 0;
  const turnoverScore = record.turnover >= 1 && record.turnover <= 12 ? 8 : record.turnover > 12 ? 4 : 2;
  const themeScore = record.themes.length ? 4 : 0;
  const baseScore = record.market === "指数基金" ? 62 : 58;
  const trendScore = clamp(record.changePct * (record.market === "指数基金" ? 3 : 5), -18, 28);
  const amplitudePenalty = record.amplitude > 12 ? 8 : record.amplitude > 8 ? 4 : 0;
  const rawScore = Math.round(clamp(baseScore + trendScore + amountScore + turnoverScore + themeScore - amplitudePenalty, 0, 100));
  if (record.changePct > 20) return Math.min(rawScore, 65);
  if (record.changePct >= 9.8) return Math.min(rawScore, 72);
  return rawScore;
}

function externalStrategy(record, score) {
  if (record.market === "指数基金") {
    if (score >= 82 && record.changePct >= 0) return "回踩观察";
    if (score >= 72) return "等待确认";
    return "观望";
  }
  if (record.changePct > 20) return "观望";
  if (score >= 88 && record.changePct > 2) return "强势趋势";
  if (score >= 80 && record.changePct >= 0) return "回踩观察";
  if (score >= 72) return "等待确认";
  return "观望";
}

function externalIntro(record) {
  if (record.market === "指数基金") {
    return record.name + "是场内指数基金，主要跟踪" + (record.sector || "对应指数") + "。它比单只股票更分散，但也会跟着指数涨跌。";
  }
  const sector = record.sector || "相关行业";
  const themes = record.themes.length ? `，同时带有${record.themes.map(friendlyTheme).join("、")}方向` : "";
  return `${record.name}属于${sector}板块${themes}。这段简介先用行情行业数据生成，后面可以继续接更详细的公司资料。`;
}

function mapEastmoneyStock(row) {
  const assetType = row.__assetType || "stock";
  const code = String(row.f12 || "").padStart(6, "0");
  const price = emNumber(row.f2);
  const prevClose = emNumber(row.f18);
  const name = String(row.f14 || "").trim();
  const record = {
    code,
    name,
    board: boardFromCode(code, assetType),
    market: boardFromCode(code, assetType),
    sector: assetType === "fund" ? fundSectorFromName(name) : String(row.f100 || "未分类").trim(),
    province: assetType === "fund" ? "场内基金" : (String(row.f102 || "").trim() || "未知"),
    city: "",
    company: name,
    source: assetType === "fund" ? "东方财富基金行情" : "东方财富",
    symbol: `${code.startsWith("6") ? "sh" : "sz"}${code}`,
    price,
    prevClose,
    changePct: emNumber(row.f3),
    changeAbs: emNumber(row.f4),
    open: emNumber(row.f17),
    high: emNumber(row.f15),
    low: emNumber(row.f16),
    amplitude: emNumber(row.f7),
    volume: emNumber(row.f5),
    amount: emNumber(row.f6),
    turnover: emNumber(row.f8),
    marketCap: emNumber(row.f20),
    concepts: String(row.f103 || ""),
  };
  record.themes = deriveExternalThemes(record);
  record.risk = externalRisk(record);
  record.score = externalScore(record);
  record.rank = record.score >= 88 ? "重点关注" : record.score >= 80 ? "可观察" : record.score >= 72 ? "观察中" : "暂不介入";
  record.strategy = externalStrategy(record, record.score);
  const low = price > 0 ? price * (record.strategy === "强势趋势" ? 0.975 : record.strategy === "回踩观察" ? 0.955 : 0.93) : 0;
  const high = price > 0 ? price * (record.strategy === "强势趋势" ? 0.992 : record.strategy === "回踩观察" ? 0.98 : 0.965) : 0;
  record.buyZone = [Number(low.toFixed(2)), Number(high.toFixed(2))];
  record.buyReason = buildBuyReason(record);
  record.trigger = record.changePct > 20 ? "新股或极端波动，先不碰" : record.changePct >= 9.8 ? "涨停或接近涨停，等回落后再看" : record.strategy === "强势趋势" ? "放量站稳后再考虑" : record.strategy === "回踩观察" ? "回踩不破支撑再看" : "等趋势重新确认";
  record.confidence = record.score >= 88 ? "高" : record.score >= 80 ? "较高" : record.score >= 72 ? "一般" : "偏低";
  record.positionPct = record.strategy === "观望" ? 0 : record.risk === "高" ? 8 : record.risk === "中" ? 12 : 18;
  record.support = record.buyZone[0];
  record.resistance = record.buyZone[1];
  record.logic = [
    `${record.sector}板块当前涨跌幅为${toPct(record.changePct)}，先看资金是否持续。`,
    `成交额约${toMoney(record.amount)}，流动性${record.amount >= 800000000 ? "相对较好" : "一般"}。`,
    `当前策略更偏向：${friendlyStrategy(record.strategy)}。`,
  ];
  record.riskNotes = [record.risk === "高" ? "波动偏大，别一次买太多。" : "建议分批观察，不要追得太急。"];
  record.hotLabel = record.score >= 82 ? "高" : record.score >= 72 ? "中" : "低";
  record.intro = externalIntro(record);
  return record;
}

function buildBuyReason(record) {
  if (record.market === "指数基金") {
    return "指数基金波动通常比单只股票小，所以区间主要按当前价下方约2%-4%的回落来估算；意思是别追高，等指数回踩更舒服的位置再看。";
  }
  if (record.changePct >= 9.8) {
    return "它已经接近涨停或涨幅太大，当前区间只是回落观察位，不是追进去的位置。";
  }
  if (record.strategy === "强势趋势") {
    return "它现在偏强，但不建议追当天高点，所以按现价下方约1%-2.5%给一个回踩区间，等放量站稳再看。";
  }
  if (record.strategy === "回踩观察") {
    return "它还可以观察，但更适合等回调，区间按现价下方约2%-4.5%估算，靠近短线支撑时再看。";
  }
  return "它目前还没确认走强，所以区间给得更低，主要是提醒你等明显回落或趋势重新确认，不要急着买。";
}

function makeExternalSummary(stocks, indexRows) {
  const upCount = stocks.filter((item) => item.changePct > 0).length;
  const downCount = stocks.filter((item) => item.changePct < 0).length;
  const flatCount = stocks.length - upCount - downCount;
  const avgChange = stocks.length ? stocks.reduce((sum, item) => sum + item.changePct, 0) / stocks.length : 0;
  const sectorMap = new Map();
  stocks.forEach((item) => {
    const key = item.sector || "未分类";
    const row = sectorMap.get(key) || { sector: key, count: 0, gainSum: 0, amountSum: 0 };
    row.count += 1;
    row.gainSum += item.changePct;
    row.amountSum += item.amount;
    sectorMap.set(key, row);
  });
  const hotSectors = [...sectorMap.values()].map((item) => ({
    sector: item.sector,
    count: item.count,
    avgChange: item.gainSum / Math.max(1, item.count),
    amountSum: item.amountSum,
    hotScore: item.gainSum / Math.max(1, item.count) * 4 + Math.log10(item.amountSum / 100000000 + 1) + Math.log2(item.count + 1),
  })).sort((a, b) => b.hotScore - a.hotScore);
  return {
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    total: stocks.length,
    upCount,
    downCount,
    flatCount,
    avgChange: Number(avgChange.toFixed(2)),
    mood: avgChange >= 1 ? "偏强" : avgChange >= 0 ? "震荡偏强" : avgChange >= -1 ? "震荡" : "偏弱",
    indices: indexRows,
    hotSectors: hotSectors.slice(0, 8),
    sectorOptions: [...new Set([...hotSectors.slice(0, 16).map((item) => item.sector), "AI", "机器人", "新能源"])],
    topCount: stocks.filter((item) => item.score >= 80).length,
  };
}

function mapEastmoneyIndex(row) {
  const code = String(row.f12 || "");
  return {
    code,
    name: String(row.f14 || ""),
    point: emNumber(row.f2),
    changePct: emNumber(row.f3),
    changeAbs: emNumber(row.f4),
    open: emNumber(row.f17),
    high: emNumber(row.f15),
    low: emNumber(row.f16),
    amount: emNumber(row.f6),
  };
}

async function fetchExternalMarket(force = false) {
  const freshEnough = Date.now() - externalMarket.loadedAt < 45 * 1000;
  if (!force && externalMarket.stocks.length && freshEnough) return externalMarket;
  if (externalMarket.loading) return externalMarket.loading;

  state.externalLoading = true;
  state.externalError = "";
  render();

  externalMarket.loading = Promise.all([
    fetchEastmoneyStockRows(),
    fetchEastmoneyFundRows().catch(() => []),
    jsonp(eastmoneyIndexUrl()).catch(() => null),
  ]).then(([stockPayload, fundPayload, indexPayload]) => {
    const rows = [...stockPayload, ...fundPayload];
    const stocks = rows.map(mapEastmoneyStock).filter((item) => item.code && item.name && item.price > 0);
    const indexRows = Object.values(indexPayload?.data?.diff || {}).map(mapEastmoneyIndex);
    if (!stocks.length) throw new Error("外部行情暂时没有返回股票数据");
    externalMarket.stocks = stocks.sort((a, b) => b.score - a.score);
    externalMarket.summary = makeExternalSummary(externalMarket.stocks, indexRows);
    externalMarket.loadedAt = Date.now();
    externalMarket.lastError = "";
    state.externalReady = true;
    state.externalError = "";
    state.dataSource = externalMarket.source;
    state.summary = externalMarket.summary;
    state.marketOptions = ["全部", "主板", "创业板", "指数基金"];
    state.sectorOptions = uniqueOptions(["全部", "AI", "机器人", "新能源", ...(externalMarket.summary.sectorOptions || [])]);
    state.riskOptions = ["全部", "低", "中", "高"];
    state.volatilityOptions = ["全部", "低波动", "中波动", "高波动"];
    return externalMarket;
  }).catch((error) => {
    externalMarket.lastError = error.message || String(error);
    state.externalError = externalMarket.lastError;
    throw error;
  }).finally(() => {
    externalMarket.loading = null;
    state.externalLoading = false;
    render();
  });

  return externalMarket.loading;
}

function getExternalRows() {
  const search = state.search.trim().toLowerCase();
  let rows = externalMarket.stocks.filter((item) => {
    if (search) return stockSearchText(item).includes(search);
    return marketMatches(state.market, item.market)
      && sectorMatches(state.sector, item)
      && riskMatches(state.risk, item.risk)
      && volatilityMatches(state.volatility, item.amplitude);
  });
  rows = rows.sort((a, b) => {
    if (search) return searchRank(b, search) - searchRank(a, search) || b.score - a.score;
    return b.score - a.score;
  });
  return rows;
}

function applyExternalRows() {
  const rows = getExternalRows();
  state.stocks = rows.slice(0, 60);
  state.total = rows.length;
  state.searchMode = Boolean(state.search);
  state.searchKeyword = state.search;
  state.updatedAt = externalMarket.summary?.updatedAt || state.updatedAt;
  if (!state.stocks.find((item) => item.code === state.selected)) {
    state.selected = state.stocks[0]?.code || null;
  }
}
async function api(path, params = {}) {
  const url = new URL(path, API_BASE);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  url.searchParams.set("_ts", String(Date.now()));
  const response = await fetch(url.toString(), { cache: "no-store" });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("后端没有返回数据，请确认 Render 服务已经启动");
  }
  if (!response.ok || json.ok === false) {
    throw new Error(json.message || `Request failed: ${response.status}`);
  }
  return json;
}

function currentVisibleStocks() {
  const rows = state.search ? state.stocks : (state.favOnly ? state.stocks.filter((item) => favs.has(item.code)) : state.stocks);
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
  el("refreshState").textContent = state.externalLoading ? "正在接入外部实时行情..." : state.externalReady ? `已接入${state.dataSource}` : state.externalError ? `外部行情暂时未接入：${state.externalError}` : (state.refreshing ? "正在刷新最新数据..." : "数据已就绪");

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
    { title: "市场", options: state.marketOptions, key: "market" },
    { title: "方向", options: state.sectorOptions, key: "sector" },
    { title: "风险", options: state.riskOptions, key: "risk" },
    { title: "波动率", options: state.volatilityOptions, key: "volatility" },
  ];

  const filterSummary = document.getElementById("filterSummary");
  if (filterSummary) {
    filterSummary.textContent = [
      friendlyMarket(state.market),
      friendlySector(state.sector),
      isAllFilter(state.risk) ? "全部风险" : friendlyRisk(state.risk),
      isAllFilter(state.volatility) ? "全部波动" : friendlyVolatility(state.volatility),
    ].join(" / ");
  }

  filterArea.innerHTML = groups.map((group) => {
    const buttons = group.options.map((item) => {
      const label = group.key === "sector"
        ? friendlySector(item)
        : group.key === "market"
          ? friendlyMarket(item)
          : group.key === "volatility"
            ? (isAllFilter(item) ? "全部" : friendlyVolatility(item))
            : (isAllFilter(item) ? "全部" : friendlyRisk(item));
      const active = state[group.key] === item ? " active" : "";
      return `<button class="tag${active}" data-key="${group.key}" data-value="${item}">${label}</button>`;
    }).join("");
    return `<div class="filter-group"><div class="filter-title">${group.title}</div><div class="filter-tags">${buttons}</div></div>`;
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
  const visibleRows = rows.slice(0, state.search ? 24 : 12);
  const searchActive = Boolean(state.search);
  const volatilityRanks = new Map(rows
    .filter((item) => num(item.amplitude) > 0)
    .slice()
    .sort((a, b) => num(b.amplitude) - num(a.amplitude))
    .map((item, index) => [item.code, index + 1]));
  const resultCount = document.getElementById("resultCount");
  const totalResults = state.favOnly ? rows.length : (state.total || rows.length);
  if (resultCount) {
    resultCount.textContent = searchActive
      ? `搜索结果 ${totalResults} 个`
      : state.favOnly
        ? `自选 ${rows.length} 个`
        : `筛选结果 ${totalResults} 个`;
  }

  el("statCount").textContent = String(state.favOnly ? rows.length : (state.total || rows.length));
  el("statUp").textContent = state.summary ? String(state.summary.upCount) : "-";
  el("statTop").textContent = state.summary ? String(state.summary.topCount) : String(rows.filter((item) => item.score >= 80).length);

  if (state.loadingStocks) {
    list.innerHTML = '<div class="loading">正在加载最新数据...</div>';
    return;
  }

  if (!rows.length) {
    list.innerHTML = searchActive
      ? `<div class="empty"><strong>没有找到这只股票</strong><div style="margin-top:8px;">试试输入 6 位股票代码，或者只输入简称里的两个字。</div></div>`
      : `<div class="empty"><strong>没有找到符合条件的股票</strong><div style="margin-top:8px;">可以试试放宽市场、方向或者风险条件。</div></div>`;
    return;
  }

  const searchTip = searchActive
    ? `<div class="search-tip">正在全市场搜索「${state.searchKeyword || state.search}」：下面是匹配到的股票，点开就能看它适不适合。</div>`
    : "";

  list.innerHTML = searchTip + visibleRows.map((item) => {
    const riskClass = item.risk === "高" ? "danger" : item.risk === "低" ? "good" : "warn";
    const topTheme = Array.isArray(item.themes) && item.themes.length ? friendlyTheme(item.themes[0]) : friendlySector(item.sector);
    const volRank = volatilityRanks.get(item.code);
    const volClass = volatilityClass(item.amplitude);
    return `
      <article class="stock-item compact${state.selected === item.code ? " active" : ""}" data-code="${item.code}">
        <div class="stock-main">
          <div class="stock-title compact-title">
            <strong>${item.name}</strong>
            <span class="code">${item.code}</span>
            <span class="label">${friendlyMarket(item.market)}</span>
            <span class="label">${topTheme}</span>
            <span class="label ${riskClass}">${friendlyRisk(item.risk)}</span>
          </div>
          <div class="quick-row">
            <span class="quote-chip ${quoteClass(item.changePct)}"><b>现价</b> <strong>${fmt(item.price)}</strong> <em>${toPct(item.changePct)}</em></span>
            <span class="vol-chip ${volClass}"><b>波动率</b> ${volatilityText(item, volRank)}</span>
            <span><b>参考</b> ${fmt(item.buyZone?.[0])} - ${fmt(item.buyZone?.[1])}</span>
            <span><b>时机</b> ${item.trigger || "等待确认"}</span>
          </div>
        </div>
        <div class="score-pill">
          <strong>${item.score}</strong>
          <span>推荐分</span>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll(".stock-item").forEach((node) => {
    node.querySelectorAll("details, summary, button, a").forEach((child) => {
      child.addEventListener("click", (event) => event.stopPropagation());
    });
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


function chaseRiskPlan(stock) {
  const price = num(stock?.price);
  const change = num(stock?.changePct);
  const amplitude = num(stock?.amplitude);
  const high = num(stock?.high) || price;
  const isFund = stock?.market === "指数基金";
  const highRisk = stock?.risk === "高" || amplitude >= 10 || change >= 7;
  const stopPct = isFund ? 0.04 : highRisk ? 0.085 : stock?.risk === "中" ? 0.065 : 0.05;
  const takePct1 = isFund ? 0.045 : highRisk ? 0.08 : 0.06;
  const takePct2 = isFund ? 0.08 : highRisk ? 0.14 : 0.10;
  const trailPct = isFund ? 0.03 : amplitude >= 10 ? 0.055 : amplitude >= 6 ? 0.045 : 0.035;
  const stopLoss = price ? price * (1 - stopPct) : 0;
  const takeProfit1 = price ? price * (1 + takePct1) : 0;
  const takeProfit2 = price ? price * (1 + takePct2) : 0;
  const trailingStop = high ? high * (1 - trailPct) : 0;
  const chaseLevel = change >= 9 || amplitude >= 12
    ? "追涨风险很高"
    : change >= 5 || amplitude >= 8
      ? "追涨风险偏高"
      : change >= 2 || amplitude >= 5
        ? "有追涨风险"
        : "追涨风险较低";
  const warning = change >= 9
    ? "已经接近涨停或大涨，最怕第二天高开低走。"
    : amplitude >= 10
      ? "当天上下振幅很大，说明分歧也大。"
      : change > 0
        ? "已经上涨，适合等回踩确认，不适合无脑追高。"
        : "涨幅不大，但仍要按止损线控制风险。";
  return {
    chaseLevel,
    warning,
    stopLoss,
    takeProfit1,
    takeProfit2,
    trailingStop,
    stopPct: Math.round(stopPct * 1000) / 10,
    takePct1: Math.round(takePct1 * 1000) / 10,
    takePct2: Math.round(takePct2 * 1000) / 10,
    trailPct: Math.round(trailPct * 1000) / 10,
    reason: "止损线按当前价格下方约" + (Math.round(stopPct * 1000) / 10) + "%估算；波动越大，止损空间会略放宽，但仓位应该更小。第一止盈线适合先减一部分，第二止盈线适合明显冲高时继续落袋。移动止盈线按当日高点回落约" + (Math.round(trailPct * 1000) / 10) + "%估算，用来防止盈利变亏损。"
  };
}

function participantBehaviorRows(stock) {
  const plan = chaseRiskPlan(stock);
  return [
    {
      role: "普通散户",
      action: "容易看到涨幅和热度就追进去，涨了想再等等，跌了又舍不得止损。",
      discipline: "更适合小仓位、等回踩，不要满仓追；跌破止损线就先退出观察。"
    },
    {
      role: "券商/机构",
      action: "通常更看成交额、流动性、基本面和仓位约束，不一定会追日内最高点。",
      discipline: "更偏向分批、调仓、看风控线；如果波动太大，可能降低仓位或只做观察。"
    },
    {
      role: "游资/短线资金",
      action: "更看情绪、封板强度、题材接力和次日溢价，可能快进快出。",
      discipline: "他们通常纪律很快，错了会撤；普通人最怕学了追涨，却没有他们的卖出速度。"
    },
    {
      role: "价值投资者",
      action: "一般不会因为今天涨得猛就买，更关心公司质量、估值和长期现金流。",
      discipline: "通常等估值舒服、安全边际足够，或者回到历史低估区间再慢慢看。"
    }
  ].map((item) => ({ ...item, line: plan.stopLoss }));
}

function buyReasonFallback(stock) {
  if (stock && stock.market === "指数基金") return "指数基金更适合等指数回踩，不追高，所以区间会比当前价略低。";
  return "这个区间主要根据当前价、涨跌幅、波动大小和当前策略估算，目的是尽量避开追高。";
}

function exchangePrefix(code) {
  const text = String(code || "");
  return text.startsWith("5") || text.startsWith("6") || text.startsWith("9") ? "1" : "0";
}

function eastmoneyHistoryUrl(item) {
  const params = new URLSearchParams({
    secid: exchangePrefix(item.code) + "." + item.code,
    ut: "fa5fd1943c7b386f172d6893dbfba10b",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    klt: "101",
    fqt: "0",
    beg: "0",
    end: "20500101",
    lmt: "10000",
  });
  return "https://push2his.eastmoney.com/api/qt/stock/kline/get?" + params.toString();
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  const index = clamp((sortedValues.length - 1) * ratio, 0, sortedValues.length - 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sortedValues[low];
  return sortedValues[low] + (sortedValues[high] - sortedValues[low]) * (index - low);
}

function historyPercentile(sortedValues, currentPrice) {
  if (!sortedValues.length || !currentPrice) return 0;
  const lowerCount = sortedValues.filter((value) => value <= currentPrice).length;
  return Math.round((lowerCount / sortedValues.length) * 100);
}

function parseHistoryPayload(payload) {
  const klines = (payload && payload.data && payload.data.klines) || [];
  return klines.map((line) => {
    const parts = String(line).split(",");
    return {
      date: parts[0],
      open: emNumber(parts[1]),
      close: emNumber(parts[2]),
      high: emNumber(parts[3]),
      low: emNumber(parts[4]),
      changePct: emNumber(parts[8]),
    };
  }).filter((item) => item.close > 0);
}

function chartModeLabel(mode) {
  return (chartModes.find((item) => item.key === mode) || chartModes[1]).label;
}

function chartTabsHtml() {
  return chartModes.map((item) => {
    const active = state.chartMode === item.key ? " active" : "";
    return '<button class="chart-tab' + active + '" data-chart-mode="' + item.key + '">' + item.label + '</button>';
  }).join("");
}

function eastmoneyChartKlineUrl(item, mode) {
  const klt = mode === "week" ? "102" : mode === "month" ? "103" : "101";
  const params = new URLSearchParams({
    secid: exchangePrefix(item.code) + "." + item.code,
    ut: "fa5fd1943c7b386f172d6893dbfba10b",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    klt,
    fqt: "0",
    beg: mode === "year" ? "0" : "19900101",
    end: "20500101",
    lmt: mode === "year" ? "10000" : "360",
  });
  return "https://push2his.eastmoney.com/api/qt/stock/kline/get?" + params.toString();
}

function eastmoneyTrendUrl(item) {
  const params = new URLSearchParams({
    secid: exchangePrefix(item.code) + "." + item.code,
    fields1: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58",
    iscr: "0",
    ndays: "1",
  });
  return "https://push2his.eastmoney.com/api/qt/stock/trends2/get?" + params.toString();
}

function parseTrendPayload(payload) {
  const trends = (payload && payload.data && payload.data.trends) || [];
  return trends.map((line) => {
    const parts = String(line).split(",");
    return {
      time: parts[0],
      price: emNumber(parts[1]),
      avg: emNumber(parts[2]),
      volume: emNumber(parts[3]),
    };
  }).filter((item) => item.price > 0);
}

function aggregateYearlyRows(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const year = String(row.date || "").slice(0, 4);
    if (!year) return;
    const current = grouped.get(year) || { date: year, open: row.open, close: row.close, high: row.high, low: row.low, volume: 0 };
    current.close = row.close;
    current.high = Math.max(current.high || 0, row.high || 0);
    current.low = current.low ? Math.min(current.low, row.low || current.low) : row.low;
    current.volume += row.volume || 0;
    grouped.set(year, current);
  });
  return [...grouped.values()].filter((item) => item.open > 0 && item.close > 0);
}

async function fetchChartRows(stock, mode) {
  const cacheKey = stock.code + ":" + mode;
  const cached = chartCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < 3 * 60 * 1000) return cached.rows;
  const payload = mode === "time"
    ? await jsonp(eastmoneyTrendUrl(stock), "cb", 18000)
    : await jsonp(eastmoneyChartKlineUrl(stock, mode), "cb", 18000);
  let rows = mode === "time" ? parseTrendPayload(payload) : parseHistoryPayload(payload);
  if (mode === "year") rows = aggregateYearlyRows(rows);
  chartCache.set(cacheKey, { rows, loadedAt: Date.now() });
  return rows;
}

function chartRangeText(rows, mode) {
  if (!rows.length) return "暂无走势数据";
  if (mode === "time") return "今日分时 · " + rows.length + " 个点";
  const first = rows[0].date || "";
  const last = rows[rows.length - 1].date || "";
  return chartModeLabel(mode) + " · " + first + " 至 " + last;
}

function drawGrid(ctx, width, height, pad) {
  ctx.strokeStyle = "#edf0f4";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + ((height - pad.top - pad.bottom) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width || 640);
  const height = Math.max(220, rect.height || 260);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function drawLineChart(canvas, rows) {
  const { ctx, width, height } = setupCanvas(canvas);
  const pad = { left: 42, right: 18, top: 18, bottom: 30 };
  const visible = rows.slice(-260);
  const prices = visible.flatMap((item) => [item.price, item.avg]).filter((value) => value > 0);
  if (!prices.length) return;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(0.01, max - min);
  const xAt = (index) => pad.left + (visible.length <= 1 ? 0 : (index / (visible.length - 1)) * (width - pad.left - pad.right));
  const yAt = (value) => pad.top + (max - value) / span * (height - pad.top - pad.bottom);
  drawGrid(ctx, width, height, pad);
  const drawPath = (key, color, lineWidth) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    visible.forEach((item, index) => {
      const value = item[key];
      if (!value) return;
      const x = xAt(index);
      const y = yAt(value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  const first = visible[0].price;
  const last = visible[visible.length - 1].price;
  drawPath("avg", "#a6a6ad", 1.2);
  drawPath("price", last >= first ? "#d70015" : "#16833a", 2.2);
  ctx.fillStyle = "#6e6e73";
  ctx.font = "12px system-ui";
  ctx.fillText(max.toFixed(2), 4, pad.top + 4);
  ctx.fillText(min.toFixed(2), 4, height - pad.bottom);
  ctx.fillText(visible[0].time.slice(-5), pad.left, height - 8);
  ctx.fillText(visible[visible.length - 1].time.slice(-5), width - 62, height - 8);
}

function drawCandleChart(canvas, rows, mode) {
  const { ctx, width, height } = setupCanvas(canvas);
  const pad = { left: 42, right: 18, top: 18, bottom: 30 };
  const limit = mode === "year" ? 36 : 90;
  const visible = rows.slice(-limit);
  if (!visible.length) return;
  const highs = visible.map((item) => item.high).filter(Boolean);
  const lows = visible.map((item) => item.low).filter(Boolean);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(0.01, max - min);
  const plotW = width - pad.left - pad.right;
  const step = plotW / Math.max(1, visible.length);
  const candleW = Math.max(3, Math.min(12, step * 0.56));
  const xAt = (index) => pad.left + step * index + step / 2;
  const yAt = (value) => pad.top + (max - value) / span * (height - pad.top - pad.bottom);
  drawGrid(ctx, width, height, pad);
  visible.forEach((item, index) => {
    const up = item.close >= item.open;
    const color = up ? "#d70015" : "#16833a";
    const x = xAt(index);
    const highY = yAt(item.high);
    const lowY = yAt(item.low);
    const openY = yAt(item.open);
    const closeY = yAt(item.close);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    ctx.fillStyle = up ? "rgba(215,0,21,0.12)" : "rgba(22,131,58,0.12)";
    ctx.strokeStyle = color;
    const top = Math.min(openY, closeY);
    const bodyH = Math.max(2, Math.abs(closeY - openY));
    ctx.fillRect(x - candleW / 2, top, candleW, bodyH);
    ctx.strokeRect(x - candleW / 2, top, candleW, bodyH);
  });
  ctx.fillStyle = "#6e6e73";
  ctx.font = "12px system-ui";
  ctx.fillText(max.toFixed(2), 4, pad.top + 4);
  ctx.fillText(min.toFixed(2), 4, height - pad.bottom);
  ctx.fillText(String(visible[0].date || ""), pad.left, height - 8);
  ctx.fillText(String(visible[visible.length - 1].date || ""), width - 96, height - 8);
}

function drawChart(canvas, rows, mode) {
  if (mode === "time") drawLineChart(canvas, rows);
  else drawCandleChart(canvas, rows, mode);
}

async function loadChartForSelected(stock, mode = state.chartMode) {
  const chartView = document.getElementById("chartView");
  if (!stock || !chartView) return;
  const selectedCode = stock.code;
  chartView.innerHTML = '<div class="loading">正在读取' + chartModeLabel(mode) + '走势...</div>';
  try {
    const rows = await fetchChartRows(stock, mode);
    const current = selectedStock();
    if (!current || current.code !== selectedCode || state.chartMode !== mode || !document.getElementById("chartView")) return;
    if (!rows.length) {
      chartView.innerHTML = '<div class="empty">暂时没有拿到' + chartModeLabel(mode) + '数据。</div>';
      return;
    }
    chartView.innerHTML = '<canvas class="price-chart" id="priceChart" aria-label="走势K线图"></canvas><div class="chart-meta">' + chartRangeText(rows, mode) + '</div>';
    drawChart(document.getElementById("priceChart"), rows, mode);
  } catch (error) {
    if (selectedStock() && selectedStock().code === selectedCode && document.getElementById("chartView")) {
      chartView.innerHTML = '<div class="empty">走势图暂时读取失败，稍后再试。</div>';
    }
  }
}

function buildHistoryValuation(item, rows) {
  const closes = rows.map((row) => row.close).filter(Boolean).sort((a, b) => a - b);
  const highs = closes;
  const lows = closes;
  const current = item.price || closes[closes.length - 1] || 0;
  const currentRank = historyPercentile(closes, current);
  const assetText = item.market === "指数基金" ? "这个指数基金" : "这只股票";
  const cheapText = item.market === "指数基金" ? "指数回踩后相对便宜的位置" : "成立/上市以来相对便宜的位置";
  const expensiveText = item.market === "指数基金" ? "指数涨到历史偏高位置" : "成立/上市以来相对偏贵的位置";
  return {
    days: closes.length,
    currentRank,
    lowRange: [percentile(closes, 0.10), percentile(closes, 0.25)],
    highRange: [percentile(closes, 0.75), percentile(closes, 0.90)],
    yearlyLow: lows.length ? Math.min(...lows) : 0,
    yearlyHigh: highs.length ? Math.max(...highs) : 0,
    reason: assetText + "成立/上市以来共读取" + closes.length + "个交易日，约有" + currentRank + "%的收盘价低于当前价。低估区间取成立以来第10%-25%分位，代表" + cheapText + "；高估区间取第75%-90%分位，代表" + expensiveText + "。",
  };
}

function valuationTone(rank) {
  if (rank <= 25) return "偏低估";
  if (rank >= 75) return "偏高估";
  return "中间位置";
}

function historyValuationHtml(valuation) {
  if (!valuation || valuation.days < 30) {
    return '<div class="empty">历史数据太少，暂时不计算高估/低估区间。</div>';
  }
  return [
    '<div class="valuation-grid">',
    '<div class="valuation-box good"><span>低估区间</span><strong>' + fmt(valuation.lowRange[0]) + ' - ' + fmt(valuation.lowRange[1]) + '</strong></div>',
    '<div class="valuation-box danger"><span>高估区间</span><strong>' + fmt(valuation.highRange[0]) + ' - ' + fmt(valuation.highRange[1]) + '</strong></div>',
    '<div class="valuation-box"><span>当前位置</span><strong>' + valuationTone(valuation.currentRank) + ' · ' + valuation.currentRank + '%</strong></div>',
    '</div>',
    '<details class="reason-toggle"><summary>为什么这么算？点开看原因</summary><div class="history-reason"><strong>原因：</strong>' + valuation.reason + '<br>成立/上市以来最低 ' + fmt(valuation.yearlyLow) + '，最高 ' + fmt(valuation.yearlyHigh) + '。跨度越长，早期价格影响越大，这不是绝对估值，只是按历史价格位置做参考。</div></details>',
  ].join('');
}

async function loadHistoryForSelected(stock) {
  const card = document.getElementById("historyValuationCard");
  if (!stock || !card) return;
  const selectedCode = stock.code;
  const cached = historyCache.get(selectedCode);
  if (cached && cached.valuation) {
    card.innerHTML = '<h3>历史高估 / 低估区间</h3>' + historyValuationHtml(cached.valuation);
    return;
  }
  card.innerHTML = '<h3>历史高估 / 低估区间</h3><div class="loading">正在读取成立/上市以来历史价格...</div>';
  try {
    const payload = await jsonp(eastmoneyHistoryUrl(stock), "cb", 18000);
    const rows = parseHistoryPayload(payload);
    const valuation = buildHistoryValuation(stock, rows);
    historyCache.set(selectedCode, { valuation, loadedAt: Date.now() });
    if (selectedStock() && selectedStock().code === selectedCode && document.getElementById("historyValuationCard")) {
      document.getElementById("historyValuationCard").innerHTML = '<h3>历史高估 / 低估区间</h3>' + historyValuationHtml(valuation);
    }
  } catch (error) {
    historyCache.set(selectedCode, { error: error.message || String(error), loadedAt: Date.now() });
    if (selectedStock() && selectedStock().code === selectedCode && document.getElementById("historyValuationCard")) {
      document.getElementById("historyValuationCard").innerHTML = '<h3>历史高估 / 低估区间</h3><div class="empty">历史价格暂时读取失败，稍后刷新再试。</div>';
    }
  }
}

function renderDetail() {
  const stock = selectedStock();
  const detail = el("detailView");

  if (!stock) {
    detail.innerHTML = '<div class="empty">当前条件下没有可展示的股票详情。</div>';
    el("currentRank").textContent = "无结果";
    return;
  }

  const riskPlan = chaseRiskPlan(stock);
  const behaviorRows = participantBehaviorRows(stock);
  el("currentRank").textContent = `${friendlyRank(stock.rank)} / ${friendlyStrategy(stock.strategy)}`;
  detail.innerHTML = `
    <div class="detail-card summary-card">
      <div>
        <h3>${stock.name} · ${stock.code}</h3>
        <div class="meta">${friendlyMarket(stock.market)} · ${friendlySector(stock.sector)} · ${stock.province}</div>
      </div>
      <div class="summary-price ${quoteClass(stock.changePct)}">
        <span>最新价</span>
        <strong>${fmt(stock.price)}</strong>
        <em>${toPct(stock.changePct)}</em>
      </div>
    </div>

    <div class="detail-card">
      <h3>先看结论</h3>
      <div class="conclusion-grid">
        <div><span>现在怎么看</span><strong>${friendlyStrategy(stock.strategy)}</strong></div>
        <div><span>把握程度</span><strong>${friendlyConfidence(stock.confidence)}</strong></div>
        <div><span>建议仓位</span><strong>${stock.positionPct}%</strong></div>
        <div><span>推荐分</span><strong>${stock.score}</strong></div>
        <div><span>波动率</span><strong class="vol-text ${volatilityClass(stock.amplitude)}">${fmt(stock.amplitude)}%</strong></div>
      </div>
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
      <details class="reason-toggle">
        <summary>为什么是这个区间？点开看</summary>
        <div class="buy-reason">${stock.buyReason || buyReasonFallback(stock)}</div>
      </details>
    </div>

    <div class="detail-card chart-card">
      <div class="chart-head">
        <h3>走势K线</h3>
        <div class="chart-tabs">${chartTabsHtml()}</div>
      </div>
      <div class="chart-view" id="chartView">
        <div class="loading">正在读取走势...</div>
      </div>
    </div>
    <div class="detail-card">
      <h3>追涨风险 / 止盈止损</h3>
      <div class="conclusion-grid">
        <div><span>追涨风险</span><strong class="vol-text ${volatilityClass(stock.amplitude)}">${riskPlan.chaseLevel}</strong></div>
        <div><span>止损线</span><strong>${fmt(riskPlan.stopLoss)}</strong></div>
        <div><span>第一止盈</span><strong>${fmt(riskPlan.takeProfit1)}</strong></div>
        <div><span>第二止盈</span><strong>${fmt(riskPlan.takeProfit2)}</strong></div>
        <div><span>移动止盈</span><strong>${fmt(riskPlan.trailingStop)}</strong></div>
      </div>
      <details class="reason-toggle">
        <summary>为什么这么设？点开看</summary>
        <div class="buy-reason"><strong>提醒：</strong>${riskPlan.warning}<br>${riskPlan.reason}<br>这些线只是纪律参考，不是投资建议；如果大盘、行业或公司消息变坏，要比机械价格线更优先。</div>
      </details>
    </div>

    <details class="detail-card fold-card">
      <summary>不同人通常怎么操作</summary>
      <ul>${behaviorRows.map((item) => '<li><strong>' + item.role + '：</strong>' + item.action + '<br>' + item.discipline + '</li>').join("")}</ul>
    </details>
    <div class="detail-card" id="historyValuationCard">
      <h3>历史高估 / 低估区间</h3>
      <div class="loading">正在读取成立/上市以来历史价格...</div>
    </div>

    <details class="detail-card fold-card">
      <summary>公司简介</summary>
      <div class="fold-body">${companyIntro(stock)}</div>
    </details>

    <details class="detail-card fold-card">
      <summary>基础数据</summary>
      <ul>
        <li>成交额：${toMoney(stock.amount)}</li>
        <li>成交量：${toMoney(stock.volume)}</li>
        <li>换手率：${fmt(stock.turnover)}%</li>
        <li>波动率：${fmt(stock.amplitude)}%（当天最高价到最低价的振幅）</li>
        <li>总市值：${toMoney(stock.marketCap)}</li>
        <li>下方参考：${fmt(stock.support)}</li>
        <li>上方参考：${fmt(stock.resistance)}</li>
      </ul>
    </details>

    <details class="detail-card fold-card">
      <summary>为什么看它</summary>
      <ul>${(stock.logic || []).map((item) => `<li>${item}</li>`).join("")}</ul>
    </details>

    <details class="detail-card fold-card">
      <summary>注意点</summary>
      <ul>${(stock.riskNotes || []).map((item) => `<li>${item}</li>`).join("")}</ul>
    </details>

    <div class="detail-card action-card">
      <button class="btn" id="favBtn">${favs.has(stock.code) ? "取消收藏" : "加入收藏"}</button>
      <button class="btn secondary" id="alertBtn">提醒占位</button>
    </div>
  `;

  detail.querySelectorAll(".chart-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.chartMode = button.dataset.chartMode || "day";
      detail.querySelectorAll(".chart-tab").forEach((node) => node.classList.toggle("active", node === button));
      loadChartForSelected(stock, state.chartMode);
    });
  });

  loadChartForSelected(stock, state.chartMode);
  loadHistoryForSelected(stock);

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
  el("toggleFavBtn").textContent = state.favOnly ? "全部" : "自选";
  el("refreshBtn").textContent = state.refreshing ? "刷新中" : "刷新";
}

async function loadBootstrap() {
  state.loadingSummary = true;
  try {
    const [boot, opts] = await Promise.all([api("/api/bootstrap"), api("/api/options")]);
    state.summary = boot.summary;
    state.updatedAt = boot.updatedAt || boot.summary?.updatedAt || "";
    state.marketOptions = uniqueOptions(["全部", "指数基金", ...(opts.marketOptions || []).map(normalizeMarket)]);
    state.sectorOptions = uniqueOptions(["全部", "AI", "机器人", ...(opts.sectorOptions || []).map(normalizeSector).filter((item) => item !== "全部")]);
    state.riskOptions = uniqueOptions(["全部", ...(opts.riskOptions || []).map(normalizeRisk)]);
    state.volatilityOptions = ["全部", "低波动", "中波动", "高波动"];
  } finally {
    state.loadingSummary = false;
  }
}

async function loadStocks() {
  const seq = ++loadSeq;
  state.loadingStocks = true;
  render();
  if (externalMarket.stocks.length) {
    applyExternalRows();
    state.loadingStocks = false;
    render();
    return;
  }
  try {
    const payload = await api("/api/stocks", {
      market: state.market,
      sector: state.sector,
      risk: state.risk,
      volatility: state.volatility,
      search: state.search,
      limit: 24,
    });
    if (seq !== loadSeq) return;
    state.stocks = payload.stocks || [];
    state.total = payload.total || 0;
    state.updatedAt = payload.updatedAt || state.updatedAt;
    state.searchMode = Boolean(payload.searchMode);
    state.searchKeyword = payload.keyword || state.search;
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

async function refreshVisibleData() {
  await loadBootstrap();
  await fetchExternalMarket(false).catch(() => {});
  await loadStocks();
}

async function refreshAll() {
  state.refreshing = true;
  render();
  try {
    await api("/api/refresh").catch(() => {});
    await fetchExternalMarket(true).catch(() => {});
    await loadStocks();
  } finally {
    state.refreshing = false;
    render();
  }
}

function wireEvents() {
  const runSearch = () => {
    state.search = el("search").value.trim();
    clearTimeout(searchTimer);
    loadStocks();
    render();
  };

  el("search").addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadStocks(), 250);
  });

  el("search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  const searchBtn = document.getElementById("searchBtn");
  if (searchBtn) searchBtn.addEventListener("click", runSearch);

  el("resetBtn").addEventListener("click", () => {
    state.market = "全部";
    state.sector = "全部";
    state.risk = "全部";
    state.volatility = "全部";
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
    fetchExternalMarket(false).then(() => loadStocks()).catch(() => render());
    refreshTimer = setInterval(() => {
      refreshVisibleData().catch(() => {});
    }, 60 * 1000);
  } catch (error) {
    state.loadingSummary = false;
    state.loadingStocks = false;
    el("stockList").innerHTML = `<div class="empty">初始化失败：${error.message}</div>`;
    el("detailView").innerHTML = '<div class="empty">请稍后重试。</div>';
  }
}

init();


