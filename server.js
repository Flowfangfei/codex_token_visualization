const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = __dirname;
const WEB_ROOT = path.join(ROOT, "web");
const LOG_ROOT = process.env.CODEX_USAGE_LOG_DIR || path.join(ROOT, "codex-usage-logs", "daily");
const DEFAULT_PORT = 8787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

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

function runExport(res) {
  const script = path.join(ROOT, "scripts", "export-daily.ps1");
  const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
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
    sendJson(res, 500, { ok: false, error: error.message });
  });

  child.on("close", (code) => {
    if (code !== 0) {
      sendJson(res, 500, { ok: false, code, stdout, stderr });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      code,
      stdout,
      stderr,
      snapshot: latestUsageSnapshot(),
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
