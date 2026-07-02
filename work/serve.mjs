import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || ".");
const port = Number(process.env.PORT || process.argv[3] || 4173);
const host = process.env.HOST || process.argv[4] || "0.0.0.0";
const bundledPython = "C:\\Users\\16774\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const pythonExe = process.env.PYTHON_EXE || process.env.PYTHON || (existsSync(bundledPython) ? bundledPython : "python");
const dataScript = path.join(__dirname, "data_fetcher.py");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const cache = {
  loadedAt: Date.now(),
  loading: null,
  payload: null,
  lastError: null,
};

const FALLBACK_PAYLOAD = {
  summary: {
    updatedAt: "本地备用数据",
    total: 3,
    upCount: 2,
    downCount: 1,
    flatCount: 0,
    avgChange: 0.63,
    mood: "震荡",
    indices: [
      { code: "sh000001", name: "上证指数", point: 3150.12, changePct: 0.42, changeAbs: 13.21, open: 3142.3, high: 3156.8, low: 3138.9, amount: 0 },
      { code: "sz399001", name: "深证成指", point: 9888.76, changePct: 0.66, changeAbs: 64.4, open: 9832.11, high: 9899.1, low: 9811.4, amount: 0 },
      { code: "sz399006", name: "创业板指", point: 2011.08, changePct: 1.12, changeAbs: 22.3, open: 1995.7, high: 2015.4, low: 1991.8, amount: 0 },
    ],
    hotSectors: [
      { sector: "AI", count: 4, avgChange: 1.0, amountSum: 0, hotScore: 9.9 },
      { sector: "机器人", count: 3, avgChange: 0.9, amountSum: 0, hotScore: 9.3 },
      { sector: "新能源", count: 2, avgChange: 0.6, amountSum: 0, hotScore: 8.3 },
    ],
    sectorOptions: ["AI", "机器人", "新能源", "金融", "消费"],
    topCount: 3,
  },
  stocks: [
    {
      code: "300750",
      name: "宁德时代",
      board: "创业板",
      market: "创业板",
      sector: "新能源",
      province: "福建",
      city: "宁德",
      company: "宁德时代新能源科技股份有限公司",
      listDate: "2018-06-11",
      floatShares: 0,
      totalShares: 0,
      source: "本地备用",
      symbol: "sz300750",
      price: 210.5,
      prevClose: 205.1,
      changePct: 2.63,
      changeAbs: 5.4,
      open: 206.0,
      high: 212.2,
      low: 204.8,
      amplitude: 3.61,
      volume: 180000,
      amount: 3789000000,
      turnover: 0.91,
      marketCap: 0,
      score: 93,
      rank: "重点关注",
      risk: "高",
      strategy: "强势趋势",
      buyZone: [205.7, 208.2],
      trigger: "等待放量确认后再考虑",
      confidence: "高",
      positionPct: 18,
      support: 205.7,
      resistance: 208.2,
      logic: ["新能源方向仍有资金关注。", "创业板波动较大，更适合等趋势确认后再看。"],
      riskNotes: ["创业板波动可能更大，仓位不要太重。"],
      sectorRank: 0,
      hotLabel: "高",
      themes: ["新能源"],
      intro: "宁德时代主要从事动力电池、储能电池及新能源相关业务，是新能源车产业链里的核心公司之一。",
    },
  ],
};

cache.payload = FALLBACK_PAYLOAD;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.end(JSON.stringify(payload));
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}

function runPythonUniverse() {
  const output = execFileSync(pythonExe, [dataScript, "universe"], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    maxBuffer: 30 * 1024 * 1024,
    windowsHide: true,
  });
  return JSON.parse(output);
}

async function loadUniverse() {
  const ttl = 5 * 60 * 1000;
  if (cache.payload && Date.now() - cache.loadedAt > ttl) {
    refreshUniverseInBackground();
  }
  return cache.payload || FALLBACK_PAYLOAD;
}

function refreshUniverseInBackground() {
  if (cache.loading) {
    return cache.loading;
  }
  cache.loading = Promise.resolve()
    .then(() => runPythonUniverse())
    .then((payload) => {
      cache.payload = payload;
      cache.loadedAt = Date.now();
      cache.lastError = null;
      cache.loading = null;
      return payload;
    })
    .catch((error) => {
      cache.loading = null;
      cache.lastError = error;
      if (!cache.payload) {
        cache.payload = FALLBACK_PAYLOAD;
        cache.loadedAt = Date.now();
      }
      return cache.payload;
    });
  return cache.loading;
}

setInterval(() => {
  refreshUniverseInBackground();
}, 5 * 60 * 1000).unref?.();

refreshUniverseInBackground();

function isAllFilter(value) {
  return !value || value === "All" || value === "全部";
}

function marketMatches(filter, itemMarket) {
  if (isAllFilter(filter)) return true;
  const mainBoard = ["主板", "Main Board", "沪深主板"];
  const chiNext = ["创业板", "ChiNext"];
  if (mainBoard.includes(filter)) return mainBoard.includes(itemMarket);
  if (chiNext.includes(filter)) return chiNext.includes(itemMarket);
  return itemMarket === filter;
}

function riskMatches(filter, itemRisk) {
  if (isAllFilter(filter)) return true;
  const riskMap = {
    低: "low",
    中: "medium",
    高: "high",
    low: "low",
    medium: "medium",
    high: "high",
  };
  return (riskMap[filter] || filter) === (riskMap[itemRisk] || itemRisk);
}

function sectorMatches(filter, item) {
  if (isAllFilter(filter)) return true;
  const themes = Array.isArray(item.themes) ? item.themes : [];
  if ((filter === "AI相关" || filter === "AI") && (item.sector === "AI" || themes.includes("AI"))) return true;
  if ((filter === "机器人相关" || filter === "机器人" || filter === "robotics") && (item.sector === "机器人" || item.sector === "robotics" || themes.includes("机器人"))) return true;
  return item.sector === filter || themes.includes(filter);
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
    ...(Array.isArray(item.themes) ? item.themes : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("request body too large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid json body"));
      }
    });
    req.on("error", reject);
  });
}

function aiConfig() {
  const baseUrl = (process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "https://grsai.dakka.com.cn/v1").replace(/\/$/, "");
  const endpoint = baseUrl.endsWith("/v1/chat/completions")
    ? baseUrl
    : baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : baseUrl.endsWith("/v1")
        ? baseUrl + "/chat/completions"
        : baseUrl + "/v1/chat/completions";
  return {
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
    endpoint,
    model: process.env.AI_MODEL || "gpt-5.5",
  };
}

function parseAiJson(content) {
  const raw = String(content || "").trim();
  if (!raw) return { summary: "AI\u6ca1\u6709\u8fd4\u56de\u5185\u5bb9\u3002", roles: [], finalWarning: "" };
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // Fall through to text fallback below.
      }
    }
    return { summary: "AI\u8fd4\u56de\u4e86\u975eJSON\u5185\u5bb9\u3002", roles: [], finalWarning: raw.slice(0, 1200) };
  }
}

function extractAiContent(payload) {
  const choice = payload?.choices?.[0] || {};
  const message = choice.message || {};
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const joined = content.map((part) => {
      if (typeof part === "string") return part;
      return part?.text || part?.content || part?.value || "";
    }).join(" ").trim();
    if (joined) return joined;
  }
  const candidates = [
    message.reasoning_content,
    message.output_text,
    choice.text,
    payload?.output_text,
    payload?.result,
    payload?.data?.content,
    payload?.data?.text,
    payload?.data?.result,
  ];
  return candidates.find((item) => typeof item === "string" && item.trim()) || "";
}

function emptyAiAnalysis(payload) {
  const choice = payload?.choices?.[0] || {};
  return {
    summary: "AI\u63a5\u53e3\u5df2\u8c03\u7528\u6210\u529f\uff0c\u4f46\u6a21\u578b\u8fd4\u56de\u5185\u5bb9\u4e3a\u7a7a\u3002\u53ef\u80fd\u662f\u5f53\u524d\u6a21\u578b\u4e0d\u8fd4\u56dechat\u5185\u5bb9\uff0c\u6216\u8005\u5e73\u53f0\u8fd4\u56de\u683c\u5f0f\u4e0eOpenAI\u4e0d\u4e00\u81f4\u3002",
    roles: [],
    finalWarning: "model=" + (payload?.model || "-") + "; finish_reason=" + (choice.finish_reason || "-") + "; id=" + (payload?.id || "-"),
  };
}

function compactStockForAi(input) {
  const stock = input || {};
  return {
    code: stock.code,
    name: stock.name,
    market: stock.market,
    sector: stock.sector,
    themes: stock.themes,
    intro: stock.intro,
    price: stock.price,
    changePct: stock.changePct,
    high: stock.high,
    low: stock.low,
    amplitude: stock.amplitude,
    turnover: stock.turnover,
    amount: stock.amount,
    score: stock.score,
    confidence: stock.confidence,
    risk: stock.risk,
    strategy: stock.strategy,
    buyZone: stock.buyZone,
    support: stock.support,
    resistance: stock.resistance,
    trigger: stock.trigger,
    logic: stock.logic,
    riskNotes: stock.riskNotes,
  };
}

function aiPromptForStock(stock, context) {
  return [
    "You are a cautious A-share stock behavior analysis assistant. This is not financial advice. You only provide scenario analysis and risk reminders.",
    "Return ONLY one valid JSON object. Do not use markdown. Do not wrap in code fences. All user-facing text must be Simplified Chinese.",
    "Analyze the stock based on current price, change percent, intraday high/low, volatility, turnover, amount, buy zone, stop-loss/take-profit lines, sector and intraday shape.",
    "Do not write generic template text. Every section must refer to this stock's current position, today's movement, buy zone and risk-control lines.",
    "JSON schema: {summary:string, conclusion:{view:string, confidence:string, position:string, scoreReason:string}, buyPoint:{range:string, timing:string, weakLine:string, reason:string}, recentMove:{title:string, sourceType:string, reasons:string[], notice:string}, riskControl:{chaseRisk:string, stopLoss:string, takeProfit1:string, takeProfit2:string, trailingStop:string, reason:string}, roles:[{role:string, action:string, why:string, risk:string, betterMove:string}], finalWarning:string}.",
    "The roles must be exactly these four Chinese labels: \u666e\u901a\u6563\u6237, \u5238\u5546/\u673a\u6784, \u6e38\u8d44/\u77ed\u7ebf\u8d44\u91d1, \u4ef7\u503c\u6295\u8d44\u8005.",
    "For recentMove, distinguish policy, industry news, company event, capital sentiment, brokerage research, domestic/international situation when possible. If there is no reliable news, say it is inferred from market/sector/price clues and do not fabricate news.",
    "All price numbers in buyPoint and riskControl must keep three decimals.",
    "Stock data: " + JSON.stringify(stock),
    "Existing risk-control/context data: " + JSON.stringify(context || {}),
  ].join("\n");
}

async function callAiParticipantAnalysis(stock, context) {
  const config = aiConfig();
  if (!config.apiKey) {
    const error = new Error("后端还没有配置 AI_API_KEY，所以暂时不能调用真正的AI分析。");
    error.code = "NO_AI_KEY";
    throw error;
  }
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + config.apiKey,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.35,
      stream: false,
      max_tokens: 2500,
      messages: [
        { role: "system", content: "You are a cautious, concrete A-share analysis assistant. Never promise profit." },
        { role: "user", content: aiPromptForStock(stock, context) },
      ],
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || "AI服务调用失败");
  }
  const content = extractAiContent(payload);
  if (!content) return emptyAiAnalysis(payload);
  return parseAiJson(content);
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
async function handleApi(url, res, req) {
  const universe = await loadUniverse();

  if (url.pathname === "/api/refresh") {
    refreshUniverseInBackground();
    sendJson(res, {
      ok: true,
      refreshing: Boolean(cache.loading),
      updatedAt: cache.payload?.summary?.updatedAt || null,
      lastError: cache.lastError ? String(cache.lastError.message || cache.lastError) : null,
    });
    return true;
  }

  if (url.pathname === "/api/bootstrap") {
    sendJson(res, { ok: true, summary: universe.summary, updatedAt: universe.summary?.updatedAt || null });
    return true;
  }

  if (url.pathname === "/api/options") {
    sendJson(res, {
      ok: true,
      marketOptions: ["全部", "主板", "创业板"],
      sectorOptions: ["全部", ...new Set(["AI", "机器人", ...(universe.summary?.sectorOptions || [])])],
      riskOptions: ["全部", "低", "中", "高"],
    });
    return true;
  }

  if (url.pathname === "/api/stocks") {
    const params = url.searchParams;
    const market = params.get("market") || "全部";
    const sector = params.get("sector") || "全部";
    const risk = params.get("risk") || "全部";
    const search = (params.get("search") || "").trim().toLowerCase();
    const limit = clamp(Number(params.get("limit") || 24), 1, 60);
    const page = clamp(Number(params.get("page") || 1), 1, 1000);

    let items = (universe.stocks || []).filter((item) => {
      if (search) {
        return stockSearchText(item).includes(search);
      }

      const marketHit = marketMatches(market, item.market);
      const sectorHit = sectorMatches(sector, item);
      const riskHit = riskMatches(risk, item.risk);
      return marketHit && sectorHit && riskHit;
    });

    items = items.sort((a, b) => {
      if (search) {
        return searchRank(b, search) - searchRank(a, search) || b.score - a.score;
      }
      return b.score - a.score;
    });
    const total = items.length;
    const start = (page - 1) * limit;
    const sliced = items.slice(start, start + limit);

    sendJson(res, {
      ok: true,
      total,
      page,
      limit,
      stocks: sliced,
      updatedAt: universe.summary?.updatedAt || null,
      searchMode: Boolean(search),
      keyword: params.get("search") || "",
    });
    return true;
  }

  if (url.pathname === "/api/ai/status") {
    const config = aiConfig();
    sendJson(res, {
      ok: true,
      ai: {
        configured: Boolean(config.apiKey),
        model: config.model,
        endpoint: config.endpoint.replace("/chat/completions", ""),
      },
    });
    return true;
  }

  if (url.pathname === "/api/ai/participant-behavior") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, message: "method not allowed" }, 405);
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const stock = compactStockForAi(body.stock || {});
      const context = body.context || {};
      if (!stock.code || !stock.name) {
        sendJson(res, { ok: false, message: "缺少股票数据" }, 400);
        return true;
      }
      const analysis = await callAiParticipantAnalysis(stock, context);
      sendJson(res, { ok: true, source: "ai", analysis });
    } catch (error) {
      sendJson(res, { ok: false, message: error.message || "AI分析失败", code: error.code || "AI_ERROR" }, error.code === "NO_AI_KEY" ? 501 : 500);
    }
    return true;
  }

  if (url.pathname === "/api/stock") {
    const code = url.searchParams.get("code") || "";
    const stock = (universe.stocks || []).find((item) => item.code === code);
    if (!stock) {
      sendJson(res, { ok: false, message: "not found" }, 404);
      return true;
    }
    sendJson(res, { ok: true, stock });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      const handled = await handleApi(requestUrl, res, req);
      if (!handled) {
        sendJson(res, { ok: false, message: "not found" }, 404);
      }
      return;
    }

    let filePath = path.join(root, decodeURIComponent(requestUrl.pathname));
    if (requestUrl.pathname === "/") {
      filePath = path.join(root, "index.html");
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      serveFile(filePath, res);
      return;
    }

    const fallback = path.join(root, "index.html");
    if (existsSync(fallback)) {
      serveFile(fallback, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  } catch (error) {
    sendJson(res, { ok: false, message: error.message || "server error" }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}`);
});








