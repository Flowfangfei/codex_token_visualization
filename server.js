const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  PROVIDERS,
  ALL_SOURCES,
  AUTO_EXPORT_SOURCES,
  publicProvider,
} = require("./providers/registry.js");
const { readDisplaySettings, writeDisplaySettings } = require("./lib/display-settings.js");
const { checkForUpdate } = require("./lib/update-check.js");

const ROOT = __dirname;
const WEB_ROOT = path.join(ROOT, "web");
const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH || path.join(os.homedir(), ".codex", "auth.json");
const DEFAULT_PORT = 8787;
const USAGE_LOG_ROOT = process.env.USAGE_LOG_ROOT || path.join(ROOT, "usage-logs");
const FORECAST_SETTINGS_PATH = process.env.FORECAST_SETTINGS_PATH || path.join(USAGE_LOG_ROOT, "forecast-settings.json");
const DISPLAY_SETTINGS_PATH = process.env.DISPLAY_SETTINGS_PATH || path.join(USAGE_LOG_ROOT, "display-settings.json");
const QUOTA_SNAPSHOT_ROOT = process.env.QUOTA_SNAPSHOT_DIR || path.join(USAGE_LOG_ROOT, "quota-snapshots");
const QUOTA_OBSERVATION_ROOT = process.env.QUOTA_OBSERVATION_DIR || path.join(USAGE_LOG_ROOT, "quota-observations");
const FORECAST_AGENTS = PROVIDERS.filter((entry) => entry.forecast && entry.quota).map((entry) => entry.id);
const SOURCE_CONFIGS = Object.fromEntries(
  ALL_SOURCES.map((entry) => [entry.id, {
    label: entry.label,
    filePrefix: entry.usage.filePrefix,
    command: entry.usage.ccusageArgs || null,
    adapter: entry.usage.adapter,
    logRoot: entry.usage.logRoot,
    legacyRoots: entry.usage.legacyRoots || [],
    detectPaths: entry.detectPaths || [],
    sourceDescription: entry.sourceDescription,
    manualOnly: false,
  }])
);
const EXPORT_SEQUENCE = AUTO_EXPORT_SOURCES.map((entry) => entry.id);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const exportInFlight = new Map();

function asNonNegativeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function defaultForecastAgent(agent) {
  const provider = PROVIDERS.find((entry) => entry.id === agent);
  return {
    subscriptionPlan: provider?.planLabel || provider?.label || agent,
    accountSyncEnabled: true,
    budgetTokens: null,
    periodEndsOn: null,
    cycleDays: 7,
    fallbackUsedTokens: null,
    fallbackDailyTokens: null,
  };
}

function normalizeForecastAgent(value, agent) {
  const defaultPlan = defaultForecastAgent(agent).subscriptionPlan;
  return {
    subscriptionPlan:
      typeof value?.subscriptionPlan === "string" && value.subscriptionPlan.length <= 64
        ? value.subscriptionPlan
        : defaultPlan,
    accountSyncEnabled: value?.accountSyncEnabled !== false,
    budgetTokens: asNonNegativeNumber(value?.budgetTokens),
    periodEndsOn: validDate(value?.periodEndsOn),
    cycleDays: Math.min(90, Math.max(1, Math.round(asNonNegativeNumber(value?.cycleDays, 7)))),
    fallbackUsedTokens: asNonNegativeNumber(value?.fallbackUsedTokens),
    fallbackDailyTokens: asNonNegativeNumber(value?.fallbackDailyTokens),
  };
}

function defaultForecastSettings() {
  return {
    version: 1,
    agents: Object.fromEntries(FORECAST_AGENTS.map((agent) => [agent, defaultForecastAgent(agent)])),
  };
}

function readForecastSettings() {
  const defaults = defaultForecastSettings();
  if (!fs.existsSync(FORECAST_SETTINGS_PATH)) return defaults;

  try {
    const parsed = JSON.parse(fs.readFileSync(FORECAST_SETTINGS_PATH, "utf8").replace(/^\uFEFF/, ""));
    return {
      version: 1,
      agents: Object.fromEntries(
        FORECAST_AGENTS.map((agent) => [agent, normalizeForecastAgent(parsed?.agents?.[agent], agent)])
      ),
    };
  } catch (_) {
    return defaults;
  }
}

function writeForecastSettings(payload) {
  const settings = {
    version: 1,
    agents: Object.fromEntries(
      FORECAST_AGENTS.map((agent) => [agent, normalizeForecastAgent(payload?.agents?.[agent], agent)])
    ),
  };
  fs.mkdirSync(path.dirname(FORECAST_SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(FORECAST_SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxBytes) {
        tooLarge = true;
        reject(Object.assign(new Error("Request body is too large"), { statusCode: 413 }));
      }
    });
    req.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_) {
        reject(Object.assign(new Error("Invalid JSON request body"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function parseArgs() {
  const index = process.argv.findIndex((arg) => arg === "--port" || arg === "-p");
  if (index !== -1 && process.argv[index + 1]) {
    const port = Number(process.argv[index + 1]);
    if (Number.isInteger(port) && port > 0) return port;
  }
  return Number(process.env.PORT) || DEFAULT_PORT;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function localDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const offsetMins = String(absOffset % 60).padStart(2, "0");
  const pad = (number) => String(number).padStart(2, "0");

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    `GMT${sign}${offsetHours}:${offsetMins}`,
  ].join(" ");
}

function readCodexAccessToken() {
  const raw = fs.readFileSync(CODEX_AUTH_PATH, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw);
  const token = parsed?.tokens?.access_token;
  if (!token || typeof token !== "string") {
    throw new Error("tokens.access_token not found in Codex auth file");
  }
  return token;
}

function normalizeCreditsPayload(payload) {
  const credits = Array.isArray(payload?.credits)
    ? payload.credits
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  return {
    ok: true,
    fetched_at: localDateTime(new Date().toISOString()),
    available_count: Number(payload?.available_count) || 0,
    credits: credits.map((credit) => {
      const expiresAt = credit?.expires_at ? new Date(credit.expires_at) : null;
      const expiresAtMs = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.getTime() : null;

      return {
        status: credit?.status ?? null,
        title: credit?.title ?? null,
        granted_at: localDateTime(credit?.granted_at),
        expires_at: localDateTime(credit?.expires_at),
        expires_at_ms: expiresAtMs,
      };
    }),
  };
}

async function fetchResetCredits() {
  let accessToken;
  try {
    accessToken = readCodexAccessToken();
    const response = await fetch("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits", {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 401) {
      return {
        ok: false,
        status: 401,
        message: "凭证失效或 Authorization header 未正确携带。",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: `ChatGPT reset credits endpoint returned HTTP ${response.status}`,
      };
    }

    return normalizeCreditsPayload(await response.json());
  } finally {
    accessToken = null;
  }
}

function normalizeSource(value, fallback = "codex") {
  const source = String(value || fallback).toLowerCase();
  if (source === "overview" || source === "combined") return "all";
  if (SOURCE_CONFIGS[source]) return source;
  return null;
}

function sourceFromUrl(req, fallback = "codex") {
  const url = new URL(req.url, "http://localhost");
  return normalizeSource(url.searchParams.get("source"), fallback);
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        path: fullPath,
        modifiedAt: stat.mtime.toISOString(),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function quotaSnapshots(source) {
  if (!FORECAST_AGENTS.includes(source)) {
    throw new Error(`Unknown quota source: ${source}`);
  }

  const logDir = path.join(QUOTA_SNAPSHOT_ROOT, source);
  const observationLogDir = path.join(QUOTA_OBSERVATION_ROOT, source);
  const files = listJsonFiles(logDir);
  const daily = files
    .flatMap((file) => {
      try {
        const payload = JSON.parse(fs.readFileSync(file.path, "utf8").replace(/^\uFEFF/, ""));
        const snapshots = Array.isArray(payload?.history)
          ? payload.history
          : payload?.latest && typeof payload.latest === "object"
            ? [payload.latest]
            : [payload];
        return snapshots.map((snapshot) => ({
          ...snapshot,
          file: { name: file.name, modifiedAt: file.modifiedAt, size: file.size },
        }));
      } catch (_) {
        return [];
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.fetchedAt || a.file.modifiedAt) - new Date(b.fetchedAt || b.file.modifiedAt));
  const observationFiles = listJsonFiles(observationLogDir);
  const observationMap = new Map();
  observationFiles
    .flatMap((file) => {
      try {
        const payload = JSON.parse(fs.readFileSync(file.path, "utf8").replace(/^\uFEFF/, ""));
        return Array.isArray(payload?.observations) ? payload.observations : [];
      } catch (_) {
        return [];
      }
    })
    .forEach((observation) => {
      const key = [
        observation?.windowName || "quota-window",
        observation?.fetchedAt || "",
        observation?.segment ?? "",
        observation?.usedPercent ?? "",
        observation?.totalTokens ?? "",
        observation?.resetAt || "",
      ].join("|");
      observationMap.set(key, observation);
    });
  const observations = [...observationMap.values()]
    .sort((a, b) => new Date(a.fetchedAt || 0) - new Date(b.fetchedAt || 0));

  return {
    source,
    logDir,
    observationLogDir,
    fileCount: files.length,
    observationFileCount: observationFiles.length,
    latest: daily.at(-1) || null,
    daily,
    observations,
  };
}

function refreshAccountSnapshots() {
  const script = path.join(ROOT, "scripts", "sync-account-quotas.mjs");
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ["--no-warnings", script, "--json"], {
      cwd: ROOT,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolvePromise({ ok: false, partial: false, error: error.message });
    });
    child.on("close", (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch (_) {
        parsed = null;
      }
      resolvePromise(
        parsed || {
          ok: false,
          partial: false,
          error: stderr || `Account quota sync failed with exit code ${code}`,
        }
      );
    });
  });
}

function latestUsageSnapshot(source = "codex") {
  const normalizedSource = normalizeSource(source);
  if (!normalizedSource) {
    throw new Error(`Unknown source: ${source}`);
  }

  const config = SOURCE_CONFIGS[normalizedSource];
  fs.mkdirSync(config.logRoot, { recursive: true });

  const candidateRoots = [config.logRoot, ...(config.legacyRoots || [])];
  let activeRoot = config.logRoot;
  let files = [];

  for (const root of candidateRoots) {
    files = listJsonFiles(root);
    if (files.length) {
      activeRoot = root;
      break;
    }
  }

  const base = {
    generatedAt: new Date().toISOString(),
    source: normalizedSource,
    label: config.label,
    logDir: activeRoot,
    primaryLogDir: config.logRoot,
    latestFile: null,
    files: [],
    daily: [],
    totals: {},
  };

  if (files.length === 0) return base;

  const latest = files[0];
  const raw = fs.readFileSync(latest.path, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw);

  return {
    ...base,
    latestFile: {
      name: latest.name,
      path: latest.path,
      modifiedAt: latest.modifiedAt,
      size: latest.size,
    },
    files: files.map(({ mtimeMs, ...file }) => file),
    daily: Array.isArray(parsed.daily) ? parsed.daily : [],
    totals: parsed.totals || {},
  };
}

function exportUsageSnapshot(source = "codex") {
  const normalizedSource = normalizeSource(source);
  if (!normalizedSource) {
    return Promise.reject(new Error(`Unknown source: ${source}`));
  }

  if (!SOURCE_CONFIGS[normalizedSource].command) {
    return Promise.reject(new Error(`${SOURCE_CONFIGS[normalizedSource].label} 暂无可用的本地自动导出器`));
  }

  if (exportInFlight.has(normalizedSource)) return exportInFlight.get(normalizedSource);

  const script = path.join(ROOT, "scripts", "export-daily.ps1");
  const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";

  const promise = new Promise((resolve, reject) => {
    const child = spawn(
      shell,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Source", normalizedSource],
      { cwd: ROOT, windowsHide: true }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const error = new Error(stderr || stdout || `ccusage export failed with exit code ${code}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({
        source: normalizedSource,
        code,
        stdout,
        stderr,
        snapshot: latestUsageSnapshot(normalizedSource),
      });
    });
  }).finally(() => {
    exportInFlight.delete(normalizedSource);
  });

  exportInFlight.set(normalizedSource, promise);
  return promise;
}

async function exportEverything() {
  const entries = await Promise.all(EXPORT_SEQUENCE.map(async (source) => {
    try {
      const result = await exportUsageSnapshot(source);
      return {
        source,
        result: { source, ok: true, stdout: result.stdout, stderr: result.stderr },
        snapshot: result.snapshot,
      };
    } catch (error) {
      let snapshot = null;
      try {
        snapshot = latestUsageSnapshot(source);
      } catch (_) {
        snapshot = null;
      }
      return {
        source,
        result: {
          source,
          ok: false,
          code: error.code,
          error: error.message,
          stdout: error.stdout || "",
          stderr: error.stderr || "",
        },
        snapshot,
      };
    }
  }));

  const results = entries.map((entry) => entry.result);
  const snapshots = {};
  for (const entry of entries) {
    snapshots[entry.source] = entry.snapshot;
  }

  const failures = results.filter((result) => !result.ok);
  return {
    ok: failures.length === 0,
    partial: failures.length > 0 && failures.length < results.length,
    results,
    snapshots,
    snapshot: snapshots.codex || snapshots.claude || null,
  };
}

function runExport(req, res) {
  const url = new URL(req.url, "http://localhost");
  const requestedSource = String(url.searchParams.get("source") || "codex").toLowerCase();

  if (requestedSource === "everything") {
    exportEverything()
      .then(async (result) => {
        const quotaSync = await refreshAccountSnapshots();
        const quotaResults = (quotaSync.results || []).map((item) => ({
          ...item,
          source: `${item.kind === "usage" ? "usage" : "quota"}:${item.source}`,
        }));
        const combinedResults = [...result.results, ...quotaResults];
        const succeeded = combinedResults.filter((item) => item.ok).length;
        const ok = combinedResults.length > 0 && succeeded === combinedResults.length;
        const partial = succeeded > 0 && succeeded < combinedResults.length;
        sendJson(res, succeeded === 0 ? 500 : 200, {
          ...result,
          ok,
          partial,
          results: combinedResults,
          quotaSync,
        });
      })
      .catch((error) => {
        sendJson(res, 500, { ok: false, error: error.message });
      });
    return;
  }

  const source = normalizeSource(requestedSource);
  if (!source) {
    sendJson(res, 400, { ok: false, error: `Unknown source: ${requestedSource}` });
    return;
  }

  exportUsageSnapshot(source)
    .then((result) => {
      sendJson(res, 200, {
        ok: true,
        ...result,
      });
    })
    .catch((error) => {
      sendJson(res, 500, {
        ok: false,
        source,
        code: error.code,
        error: error.message,
        stdout: error.stdout || "",
        stderr: error.stderr || "",
      });
    });
}

function sourceStatus() {
  return Object.entries(SOURCE_CONFIGS).map(([source, config]) => {
    const snapshot = latestUsageSnapshot(source);
    const quota = FORECAST_AGENTS.includes(source) ? quotaSnapshots(source) : null;
    const detected = config.detectPaths.length === 0 || config.detectPaths.some((detectPath) => fs.existsSync(detectPath));

    return {
      source,
      label: config.label,
      command: config.sourceDescription,
      logDir: snapshot.logDir,
      primaryLogDir: snapshot.primaryLogDir,
      fileCount: snapshot.files.length,
      latestFile: snapshot.latestFile,
      dailyCount: snapshot.daily.length,
      quotaLatest: quota?.latest || null,
      quotaFileCount: quota?.fileCount || 0,
      quotaSnapshotCount: quota?.daily.length || 0,
      quotaObservationFileCount: quota?.observationFileCount || 0,
      quotaObservationCount: quota?.observations.length || 0,
      detected,
      manualOnly: Boolean(config.manualOnly),
    };
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const target = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.resolve(WEB_ROOT, `.${target}`);
  const safeRoot = WEB_ROOT.endsWith(path.sep) ? WEB_ROOT : `${WEB_ROOT}${path.sep}`;

  if (fullPath !== WEB_ROOT && !fullPath.startsWith(safeRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(fullPath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "content-type": MIME[path.extname(fullPath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  try {
    if (req.method === "GET" && req.url.startsWith("/api/providers")) {
      sendJson(res, 200, { ok: true, providers: PROVIDERS.map(publicProvider) });
      return;
    }

    if (req.url === "/api/display-settings") {
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, settings: readDisplaySettings(DISPLAY_SETTINGS_PATH, PROVIDERS) });
        return;
      }

      if (req.method === "PUT") {
        readJsonBody(req)
          .then((payload) => sendJson(res, 200, {
            ok: true,
            settings: writeDisplaySettings(DISPLAY_SETTINGS_PATH, payload, PROVIDERS),
          }))
          .catch((error) => {
            sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
          });
        return;
      }

      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/update-status")) {
      checkForUpdate(ROOT).then((payload) => sendJson(res, 200, { ok: true, ...payload }));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/usage")) {
      const source = sourceFromUrl(req, "codex");
      if (!source) {
        sendJson(res, 400, { ok: false, error: "Unknown source" });
        return;
      }
      sendJson(res, 200, latestUsageSnapshot(source));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/quota")) {
      const source = sourceFromUrl(req, "codex");
      if (!source || !FORECAST_AGENTS.includes(source)) {
        sendJson(res, 400, { ok: false, error: "Unknown quota source" });
        return;
      }
      sendJson(res, 200, { ok: true, ...quotaSnapshots(source) });
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/account-sync")) {
      refreshAccountSnapshots().then((result) => {
        sendJson(res, result.ok || result.partial ? 200 : 500, result);
      });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/sources")) {
      sendJson(res, 200, { ok: true, sources: sourceStatus() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/reset-credits")) {
      fetchResetCredits()
        .then((payload) => sendJson(res, payload.ok ? 200 : payload.status || 500, payload))
        .catch((error) => {
          sendJson(res, 500, {
            ok: false,
            message: error.message,
          });
        });
      return;
    }

    if (req.url === "/api/forecast-settings") {
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, settings: readForecastSettings() });
        return;
      }

      if (req.method === "PUT") {
        readJsonBody(req)
          .then((payload) => sendJson(res, 200, { ok: true, settings: writeForecastSettings(payload) }))
          .catch((error) => {
            sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
          });
        return;
      }

      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/export")) {
      runExport(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

const port = parseArgs();
server.listen(port, () => {
  console.log(`AI token dashboard: http://localhost:${port}`);
  for (const source of ALL_SOURCES) {
    console.log(`${source.label} logs: ${SOURCE_CONFIGS[source.id].logRoot}`);
  }
});
