const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = __dirname;
const WEB_ROOT = path.join(ROOT, "web");
const LOG_ROOT = process.env.CODEX_USAGE_LOG_DIR || path.join(ROOT, "codex-usage-logs", "daily");
const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH || path.join(os.homedir(), ".codex", "auth.json");
const DEFAULT_PORT = 8787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

let exportInFlight = null;

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
  const pad = (value) => String(value).padStart(2, "0");

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

function latestUsageSnapshot() {
  fs.mkdirSync(LOG_ROOT, { recursive: true });

  const files = fs
    .readdirSync(LOG_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => {
      const fullPath = path.join(LOG_ROOT, entry.name);
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

  if (files.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      logDir: LOG_ROOT,
      latestFile: null,
      files: [],
      daily: [],
      totals: {},
    };
  }

  const latest = files[0];
  const raw = fs.readFileSync(latest.path, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw);

  return {
    generatedAt: new Date().toISOString(),
    logDir: LOG_ROOT,
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

function exportUsageSnapshot() {
  if (exportInFlight) return exportInFlight;

  const script = path.join(ROOT, "scripts", "export-daily.ps1");
  const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";

  exportInFlight = new Promise((resolve, reject) => {
    const child = spawn(
      shell,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
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
        code,
        stdout,
        stderr,
        snapshot: latestUsageSnapshot(),
      });
    });
  }).finally(() => {
    exportInFlight = null;
  });

  return exportInFlight;
}

function runExport(res) {
  exportUsageSnapshot()
    .then((result) => {
      sendJson(res, 200, {
        ok: true,
        ...result,
      });
    })
    .catch((error) => {
      sendJson(res, 500, {
        ok: false,
        code: error.code,
        error: error.message,
        stdout: error.stdout || "",
        stderr: error.stderr || "",
      });
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
    if (req.method === "GET" && req.url.startsWith("/api/usage")) {
      sendJson(res, 200, latestUsageSnapshot());
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

    if (req.method === "POST" && req.url.startsWith("/api/export")) {
      runExport(res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

const port = parseArgs();
server.listen(port, () => {
  console.log(`Codex usage dashboard: http://localhost:${port}`);
  console.log(`Reading JSON logs from: ${LOG_ROOT}`);
});
