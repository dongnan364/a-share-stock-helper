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

const cache = {
  loadedAt: Date.now(),
  loading: null,
  payload: null,
  lastError: null,
};

const FALLBACK_PAYLOAD = {
  summary: {
    updatedAt: "offline fallback",
    total: 3,
    upCount: 2,
    downCount: 1,
    flatCount: 0,
    avgChange: 0.63,
    mood: "mixed",
    indices: [
      { code: "sh000001", name: "Shanghai Index", point: 3150.12, changePct: 0.42, changeAbs: 13.21, open: 3142.3, high: 3156.8, low: 3138.9, amount: 0 },
      { code: "sz399001", name: "Shenzhen Component", point: 9888.76, changePct: 0.66, changeAbs: 64.4, open: 9832.11, high: 9899.1, low: 9811.4, amount: 0 },
      { code: "sz399006", name: "ChiNext Index", point: 2011.08, changePct: 1.12, changeAbs: 22.3, open: 1995.7, high: 2015.4, low: 1991.8, amount: 0 },
    ],
    hotSectors: [
      { sector: "AI", count: 4, avgChange: 1.0, amountSum: 0, hotScore: 9.9 },
      { sector: "robotics", count: 3, avgChange: 0.9, amountSum: 0, hotScore: 9.3 },
      { sector: "new energy", count: 2, avgChange: 0.6, amountSum: 0, hotScore: 8.3 },
    ],
    sectorOptions: ["AI", "robotics", "new energy", "finance", "consumer"],
    topCount: 3,
  },
  stocks: [
    {
      code: "300750",
      name: "CATL",
      board: "ChiNext",
      market: "ChiNext",
      sector: "new energy",
      province: "Fujian",
      city: "Ningde",
      company: "Contemporary Amperex Technology Co., Limited",
      listDate: "2018-06-11",
      floatShares: 0,
      totalShares: 0,
      source: "fallback",
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
      rank: "top",
      risk: "high",
      strategy: "trend",
      buyZone: [205.7, 208.2],
      trigger: "wait for volume confirmation",
      confidence: "high",
      positionPct: 18,
      support: 205.7,
      resistance: 208.2,
      logic: ["New energy remains active.", "ChiNext is better after trend confirmation."],
      riskNotes: ["ChiNext can swing harder; keep position small."],
      sectorRank: 0,
      hotLabel: "high",
      themes: ["new energy"],
      intro: "CATL mainly does new energy related business.",
    },
  ],
};

cache.payload = FALLBACK_PAYLOAD;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, {
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
  if (cache.loading) {
    return cache.loading;
  }
  const ttl = 30 * 1000;
  if (cache.payload && Date.now() - cache.loadedAt < ttl) {
    return cache.payload;
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
}, 60 * 1000).unref?.();

refreshUniverseInBackground();

async function handleApi(url, res) {
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
      marketOptions: ["All", "Main Board", "ChiNext"],
      sectorOptions: ["All", ...new Set(["AI", "robotics", ...(universe.summary?.sectorOptions || [])])],
      riskOptions: ["All", "low", "medium", "high"],
    });
    return true;
  }

  if (url.pathname === "/api/stocks") {
    const params = url.searchParams;
    const market = params.get("market") || "All";
    const sector = params.get("sector") || "All";
    const risk = params.get("risk") || "All";
    const search = (params.get("search") || "").trim().toLowerCase();
    const limit = clamp(Number(params.get("limit") || 24), 1, 60);
    const page = clamp(Number(params.get("page") || 1), 1, 1000);

    let items = (universe.stocks || []).filter((item) => {
      const marketHit = market === "All" || item.market === market;
      const sectorHit =
        sector === "All" ||
        item.sector === sector ||
        (Array.isArray(item.themes) && item.themes.includes(sector));
      const riskHit = risk === "All" || item.risk === risk;
      const searchHit =
        !search ||
        `${item.code} ${item.name} ${item.sector} ${item.province}`.toLowerCase().includes(search);
      return marketHit && sectorHit && riskHit && searchHit;
    });

    items = items.sort((a, b) => b.score - a.score);
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
    });
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
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      const handled = await handleApi(requestUrl, res);
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




