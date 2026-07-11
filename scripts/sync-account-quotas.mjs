import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const USAGE_ROOT = process.env.USAGE_LOG_ROOT || join(ROOT, "usage-logs");
const SETTINGS_PATH = process.env.FORECAST_SETTINGS_PATH || join(USAGE_ROOT, "forecast-settings.json");
const QUOTA_ROOT = process.env.QUOTA_SNAPSHOT_DIR || join(USAGE_ROOT, "quota-snapshots");
const OBSERVATION_ROOT = process.env.QUOTA_OBSERVATION_DIR || join(USAGE_ROOT, "quota-observations");
const SOURCES = ["codex", "claude", "cursor"];

function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function readSettings() {
  if (!existsSync(SETTINGS_PATH)) return { agents: {} };
  try {
    return readJson(SETTINGS_PATH);
  } catch (_) {
    return { agents: {} };
  }
}

function accountSyncEnabled(settings, source) {
  return settings?.agents?.[source]?.accountSyncEnabled !== false;
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, number));
}

function toIsoFromUnixSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number * 1000).toISOString() : null;
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeError(error) {
  return String(error?.message || error || "Unknown error")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/WorkosCursorSessionToken=[^;\s]+/gi, "WorkosCursorSessionToken=[redacted]")
    .slice(0, 220);
}

function codexWindow(name, value) {
  if (!value || typeof value !== "object") return null;
  const usedPercent = clampPercent(value.usedPercent);
  if (usedPercent === null) return null;
  const duration = Number(value.windowDurationMins);
  return {
    name,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMins: Number.isFinite(duration) ? duration : null,
    resetsAt: toIsoFromUnixSeconds(value.resetsAt),
  };
}

function fetchCodexQuota() {
  return new Promise((resolvePromise, rejectPromise) => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "powershell.exe" : "sh";
    const args = isWindows
      ? ["-NoProfile", "-Command", "codex app-server --stdio"]
      : ["-lc", "codex app-server --stdio"];
    const child = spawn(command, args, { cwd: ROOT, windowsHide: true });
    let buffer = "";
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.stdin.end();
      setTimeout(() => {
        if (child.exitCode === null) child.kill();
      }, 250).unref();
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const timeout = setTimeout(() => finish(new Error("Codex account quota request timed out")), 15000);

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let boundary;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch (_) {
          continue;
        }
        if (message.id === 1 && message.result) {
          send({ method: "initialized" });
          send({ method: "account/rateLimits/read", id: 2 });
        }
        if (message.id === 2) {
          if (message.error) {
            finish(new Error("Codex account quota request was rejected"));
            return;
          }
          const limits = message.result?.rateLimits;
          if (!limits) {
            finish(new Error("Codex did not return account quota data"));
            return;
          }
          finish(null, {
            source: "codex",
            fetchedAt: new Date().toISOString(),
            provider: "codex-app-server",
            planType: typeof limits.planType === "string" ? limits.planType : null,
            windows: [codexWindow("primary", limits.primary), codexWindow("secondary", limits.secondary)].filter(Boolean),
            individualLimitAvailable: limits.individualLimit !== null && limits.individualLimit !== undefined,
          });
        }
      }
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!finished) finish(new Error(`Codex account quota process exited (${code ?? "unknown"})`));
    });
    send({
      method: "initialize",
      id: 1,
      params: { clientInfo: { name: "ai_token_ledger", title: "AI Token Ledger", version: "0.1.0" } },
    });
  });
}

function claudeWindow(name, value, durationMins) {
  if (!value || typeof value !== "object") return null;
  const rawUtilization = Number(value.utilization ?? value.used_percent ?? value.usedPercent);
  if (!Number.isFinite(rawUtilization)) return null;
  const usedPercent = clampPercent(rawUtilization <= 1 ? rawUtilization * 100 : rawUtilization);
  if (usedPercent === null) return null;
  return {
    name,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMins: durationMins,
    resetsAt: toIso(value.resets_at ?? value.resetsAt ?? value.reset_at ?? value.resetAt),
  };
}

function cursorWindow(name, label, usedPercent, durationMins, resetsAt) {
  const used = clampPercent(usedPercent);
  if (used === null) return null;
  return {
    name,
    label,
    usedPercent: used,
    remainingPercent: 100 - used,
    windowDurationMins: durationMins,
    resetsAt,
  };
}

async function fetchClaudeQuota() {
  const credentialPath = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(credentialPath)) throw new Error("Claude OAuth credentials were not found");
  const credentials = readJson(credentialPath);
  const oauth = credentials?.claudeAiOauth;
  const accessToken = oauth?.accessToken;
  if (typeof accessToken !== "string" || !accessToken) throw new Error("Claude OAuth access token was not found");

  try {
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Claude usage endpoint returned HTTP ${response.status}`);
    const payload = await response.json();
    const windows = [
      claudeWindow("five_hour", payload?.five_hour, 300),
      claudeWindow("seven_day", payload?.seven_day, 10080),
    ].filter(Boolean);
    if (!windows.length) throw new Error("Claude usage response did not include usage windows");
    return {
      source: "claude",
      fetchedAt: new Date().toISOString(),
      provider: "claude-ai-oauth-usage",
      planType: typeof oauth?.subscriptionType === "string" ? oauth.subscriptionType : null,
      rateLimitTier: typeof oauth?.rateLimitTier === "string" ? oauth.rateLimitTier : null,
      windows,
    };
  } finally {
    // Do not let an OAuth credential remain reachable after the account request.
    credentials.claudeAiOauth.accessToken = null;
  }
}

function cursorDatabasePath() {
  const configured = process.env.CURSOR_DATA_DIR;
  if (configured) return configured.toLowerCase().endsWith(".vscdb") ? configured : join(configured, "state.vscdb");
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
}

function cursorValue(database, key) {
  const row = database.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key);
  if (!row || row.value === null || row.value === undefined) return null;
  return Buffer.isBuffer(row.value) ? row.value.toString("utf8") : String(row.value);
}

function cursorCredentials() {
  const databasePath = cursorDatabasePath();
  if (!existsSync(databasePath)) throw new Error("Cursor local account database was not found");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  let credentials = null;
  try {
    const accessToken = cursorValue(database, "cursorAuth/accessToken");
    const bootstrap = cursorValue(database, "workbench.experiments.statsigBootstrap");
    const userId = bootstrap ? JSON.parse(bootstrap)?.user?.userID ?? null : null;
    if (!accessToken || !userId) throw new Error("Cursor account credentials were incomplete");
    credentials = { accessToken, userId };
  } finally {
    database.close();
  }
  return credentials;
}

function cursorHeaders(credentials) {
  return {
    accept: "application/json",
    // Cursor's own desktop client uses this locally held session token format.
    cookie: `WorkosCursorSessionToken=${credentials.userId}::${credentials.accessToken}`,
    origin: "https://cursor.com",
    "user-agent": "AI Token Ledger (local usage dashboard)",
  };
}

async function fetchCursorQuota(credentials) {
  const response = await fetch("https://cursor.com/api/usage-summary", {
    headers: cursorHeaders(credentials),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Cursor usage endpoint returned HTTP ${response.status}`);
  const payload = await response.json();
  const plan = payload?.individualUsage?.plan;
  if (!plan || !Number.isFinite(Number(plan.used)) || !Number.isFinite(Number(plan.limit))) {
    throw new Error("Cursor usage response did not include plan usage");
  }
  const used = Number(plan.used);
  const limit = Number(plan.limit);
  const billingCycleStart = toIso(payload?.billingCycleStart);
  const billingCycleEnd = toIso(payload?.billingCycleEnd);
  const cycleMinutes = billingCycleStart && billingCycleEnd
    ? Math.max(1, Math.round((new Date(billingCycleEnd).getTime() - new Date(billingCycleStart).getTime()) / 60000))
    : null;
  const windows = [
    cursorWindow("included_pro_total", "Included in Pro", plan.totalPercentUsed, cycleMinutes, billingCycleEnd),
    cursorWindow("auto_composer", "Auto + Composer", plan.autoPercentUsed, cycleMinutes, billingCycleEnd),
    cursorWindow("api", "API", plan.apiPercentUsed, cycleMinutes, billingCycleEnd),
  ].filter(Boolean);
  return {
    source: "cursor",
    fetchedAt: new Date().toISOString(),
    provider: "cursor-usage-summary",
    planType: typeof payload?.membershipType === "string" ? payload.membershipType : null,
    billingCycleStart,
    billingCycleEnd,
    windows,
    quota: {
      used,
      limit,
      remaining: Number.isFinite(Number(plan.remaining)) ? Number(plan.remaining) : Math.max(limit - used, 0),
      unit: "cursor-plan-usage",
      isUnlimited: Boolean(payload?.isUnlimited),
    },
    cursorUsageBreakdown: {
      autoPercentUsed: clampPercent(plan.autoPercentUsed),
      apiPercentUsed: clampPercent(plan.apiPercentUsed),
      totalPercentUsed: clampPercent(plan.totalPercentUsed),
    },
  };
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function cursorEventDate(value) {
  const numeric = Number(value);
  let date;
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric >= 1e15 ? numeric / 1000 : numeric >= 1e12 ? numeric : numeric * 1000;
    date = new Date(milliseconds);
  } else {
    date = new Date(value);
  }
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

function eventTokenUsage(event) {
  const raw = event?.tokenUsage;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return {};
}

async function fetchCursorUsageEvents(credentials) {
  const pageSize = 100;
  const daysToFetch = 90;
  const endDate = Date.now();
  const startDate = endDate - daysToFetch * 24 * 60 * 60 * 1000;
  const events = [];

  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch("https://cursor.com/api/dashboard/get-filtered-usage-events", {
      method: "POST",
      headers: { ...cursorHeaders(credentials), "content-type": "application/json" },
      body: JSON.stringify({ teamId: 0, startDate, endDate, page, pageSize }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Cursor usage events endpoint returned HTTP ${response.status}`);
    const payload = await response.json();
    const pageEvents = Array.isArray(payload?.usageEventsDisplay)
      ? payload.usageEventsDisplay
      : Array.isArray(payload?.events)
        ? payload.events
        : [];
    events.push(...pageEvents);
    if (pageEvents.length < pageSize || payload?.hasMore === false) break;
  }

  const byDay = new Map();
  for (const event of events) {
    const usage = eventTokenUsage(event);
    const date = cursorEventDate(event?.timestamp ?? usage?.timestamp ?? event?.createdAt);
    if (!date) continue;
    const inputTokens = numberOrZero(usage.inputTokens);
    const outputTokens = numberOrZero(usage.outputTokens);
    const cacheCreationTokens = numberOrZero(usage.cacheWriteTokens ?? usage.cacheCreationTokens);
    const cacheReadTokens = numberOrZero(usage.cacheReadTokens);
    const totalTokens = numberOrZero(usage.totalTokens) || inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
    const totalCost = numberOrZero(usage.totalCents ?? usage.costCents) / 100;
    if (!totalTokens && !totalCost) continue;

    const modelName = String(event?.model ?? usage?.model ?? event?.kind ?? "cursor-unknown");
    const day = byDay.get(date) || {
      date,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      models: new Map(),
    };
    day.inputTokens += inputTokens;
    day.outputTokens += outputTokens;
    day.cacheCreationTokens += cacheCreationTokens;
    day.cacheReadTokens += cacheReadTokens;
    day.totalTokens += totalTokens;
    day.totalCost += totalCost;

    const model = day.models.get(modelName) || {
      modelName,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      cost: 0,
    };
    model.inputTokens += inputTokens;
    model.outputTokens += outputTokens;
    model.cacheCreationTokens += cacheCreationTokens;
    model.cacheReadTokens += cacheReadTokens;
    model.totalTokens += totalTokens;
    model.cost += totalCost;
    day.models.set(modelName, model);
    byDay.set(date, day);
  }

  const daily = [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({
      date: day.date,
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      cacheCreationTokens: day.cacheCreationTokens,
      cacheReadTokens: day.cacheReadTokens,
      totalTokens: day.totalTokens,
      totalCost: day.totalCost,
      modelsUsed: [...day.models.keys()],
      modelBreakdowns: [...day.models.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    }));
  const totals = daily.reduce(
    (sum, day) => {
      sum.inputTokens += day.inputTokens;
      sum.outputTokens += day.outputTokens;
      sum.cacheCreationTokens += day.cacheCreationTokens;
      sum.cacheReadTokens += day.cacheReadTokens;
      sum.totalTokens += day.totalTokens;
      sum.totalCost += day.totalCost;
      return sum;
    },
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, totalCost: 0 }
  );
  return {
    source: "cursor",
    generatedAt: new Date().toISOString(),
    provider: "cursor-usage-events",
    rangeDays: daysToFetch,
    daily,
    totals,
  };
}

function writeCursorUsageSnapshot(snapshot) {
  const logDir = join(USAGE_ROOT, "cursor", "daily");
  const filePath = join(logDir, `cursor-usage-${localDateKey()}.json`);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return filePath;
}

function usageSnapshotPath(source) {
  const prefixes = { codex: "codex-usage", claude: "claude-usage", cursor: "cursor-usage" };
  const logDir = join(USAGE_ROOT, source, "daily");
  if (!existsSync(logDir)) return null;
  const files = readdirSync(logDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort()
    .reverse();
  const today = `${prefixes[source]}-${localDateKey()}.json`;
  return join(logDir, files.includes(today) ? today : files[0] || "");
}

function usageTotal(usage) {
  return numberOrZero(usage?.totalTokens) ||
    numberOrZero(usage?.inputTokens) +
    numberOrZero(usage?.outputTokens) +
    numberOrZero(usage?.cacheReadTokens ?? usage?.cachedInputTokens) +
    numberOrZero(usage?.cacheCreationTokens);
}

function aggregateUsage(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.daily)) return null;
  const models = {};
  let totalTokens = 0;
  for (const day of snapshot.daily) {
    const dayTotal = numberOrZero(day?.totalTokens);
    totalTokens += dayTotal;
    let modeledTotal = 0;
    if (day?.models && typeof day.models === "object" && !Array.isArray(day.models)) {
      for (const [name, usage] of Object.entries(day.models)) {
        const tokens = usageTotal(usage);
        models[name] = (models[name] || 0) + tokens;
        modeledTotal += tokens;
      }
    } else if (Array.isArray(day?.modelBreakdowns)) {
      for (const usage of day.modelBreakdowns) {
        const name = String(usage?.modelName ?? usage?.name ?? "unknown-model");
        const tokens = usageTotal(usage);
        models[name] = (models[name] || 0) + tokens;
        modeledTotal += tokens;
      }
    }
    if (dayTotal > modeledTotal) models["unattributed"] = (models["unattributed"] || 0) + dayTotal - modeledTotal;
  }
  return { totalTokens, models };
}

function currentUsageAggregate(source, inMemoryUsage) {
  if (inMemoryUsage) return aggregateUsage(inMemoryUsage);
  const filePath = usageSnapshotPath(source);
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return aggregateUsage(readJson(filePath));
  } catch (_) {
    return null;
  }
}

function observationFiles(source) {
  const logDir = join(OBSERVATION_ROOT, source);
  if (!existsSync(logDir)) return [];
  return readdirSync(logDir)
    .filter((name) => /^quota-observations-\d{4}-\d{2}-\d{2}\.json$/i.test(name))
    .sort()
    .map((name) => join(logDir, name));
}

function allObservations(source) {
  return observationFiles(source).flatMap((filePath) => {
    try {
      const payload = readJson(filePath);
      return Array.isArray(payload?.observations) ? payload.observations : [];
    } catch (_) {
      return [];
    }
  });
}

function cleanupObservations(source, retentionDays = 120) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffKey = localDateKey(cutoff);
  for (const filePath of observationFiles(source)) {
    const match = filePath.match(/(\d{4}-\d{2}-\d{2})\.json$/);
    if (match && match[1] < cutoffKey) unlinkSync(filePath);
  }
}

function observationWindow(snapshot) {
  return [...(snapshot?.windows || [])]
    .filter((window) => Number.isFinite(Number(window?.usedPercent)))
    .sort((a, b) => (Number(b?.windowDurationMins) || 0) - (Number(a?.windowDurationMins) || 0))[0] || null;
}

export function detectObservationSegment(prior, current) {
  if (!prior) return { newSegment: true, resetDetected: false, reason: "first-observation" };
  const priorReset = prior.resetAt ? new Date(prior.resetAt).getTime() : null;
  const currentReset = current.resetAt ? new Date(current.resetAt).getTime() : null;
  const resetMissingChanged = (priorReset === null) !== (currentReset === null);
  const resetTimeChanged =
    priorReset !== null &&
    currentReset !== null &&
    (Number.isNaN(priorReset) || Number.isNaN(currentReset)
      ? String(prior.resetAt) !== String(current.resetAt)
      : Math.abs(priorReset - currentReset) > 5 * 60 * 1000);
  if (resetMissingChanged || resetTimeChanged) {
    return { newSegment: true, resetDetected: true, reason: "reset-time-changed" };
  }
  if (Number(current.usedPercent) + 0.5 < Number(prior.usedPercent)) {
    return { newSegment: true, resetDetected: true, reason: "quota-percent-dropped" };
  }
  if (
    current.totalTokens !== null &&
    prior.totalTokens !== null &&
    Number(current.totalTokens) < Number(prior.totalTokens)
  ) {
    return { newSegment: true, resetDetected: true, reason: "usage-counter-dropped" };
  }
  return { newSegment: false, resetDetected: false, reason: null };
}

export function compactObservations(observations, maxEntries = 96) {
  const entries = Array.isArray(observations) ? observations : [];
  const limit = Math.max(1, Math.floor(Number(maxEntries) || 96));
  if (entries.length <= limit) return entries;

  const protectedIndexes = new Set([0, entries.length - 1]);
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    const previousSegment = previous?.segment === null || previous?.segment === undefined
      ? null
      : String(previous.segment);
    const currentSegment = current?.segment === null || current?.segment === undefined
      ? null
      : String(current.segment);
    const segmentChanged = previousSegment !== null && currentSegment !== null && previousSegment !== currentSegment;
    if (current?.resetDetected || segmentChanged) {
      protectedIndexes.add(index - 1);
      protectedIndexes.add(index);
    }
  }

  const selected = [...protectedIndexes].sort((a, b) => a - b);
  if (selected.length > limit) {
    return selected.slice(-limit).map((index) => entries[index]);
  }
  for (let index = entries.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    if (!protectedIndexes.has(index)) selected.push(index);
  }
  return selected
    .sort((a, b) => a - b)
    .map((index) => entries[index]);
}

function writeQuotaObservation(snapshot, usageAggregate) {
  const source = snapshot.source;
  cleanupObservations(source);
  const window = observationWindow(snapshot);
  if (!window) return { recorded: false, file: null, reason: "quota window unavailable" };

  const prior = allObservations(source).at(-1) || null;
  const fetchedAt = snapshot.fetchedAt || new Date().toISOString();
  const usedPercent = Number(window.usedPercent);
  const totalTokens = Number.isFinite(Number(usageAggregate?.totalTokens)) ? Number(usageAggregate.totalTokens) : null;
  const segmentDecision = detectObservationSegment(prior, {
    resetAt: window.resetsAt || null,
    usedPercent,
    totalTokens,
  });
  const newSegment = segmentDecision.newSegment;
  const segment = newSegment ? Number(prior?.segment || 0) + 1 : Number(prior.segment || 1);
  const elapsedMinutes = prior ? (new Date(fetchedAt).getTime() - new Date(prior.fetchedAt).getTime()) / 60000 : Infinity;
  const quotaMoved = !prior || Math.abs(usedPercent - Number(prior.usedPercent)) >= 0.1;
  const usageMoved = !prior || totalTokens === null || prior.totalTokens === null || Math.abs(totalTokens - Number(prior.totalTokens)) >= 50_000;
  if (!newSegment && !quotaMoved && !(elapsedMinutes >= 15 && usageMoved)) {
    return { recorded: false, file: null, reason: "unchanged observation" };
  }

  const observation = {
    fetchedAt,
    segment,
    segmentStartedAt: newSegment ? fetchedAt : prior.segmentStartedAt || prior.fetchedAt,
    windowName: window.name || "quota-window",
    windowLabel: window.label || null,
    usedPercent,
    resetAt: window.resetsAt || null,
    windowDurationMins: Number(window.windowDurationMins) || null,
    totalTokens,
    models: usageAggregate?.models || {},
    resetDetected: segmentDecision.resetDetected,
    resetReason: segmentDecision.reason,
  };
  const logDir = join(OBSERVATION_ROOT, source);
  const filePath = join(logDir, `quota-observations-${localDateKey()}.json`);
  mkdirSync(logDir, { recursive: true });
  let observations = [];
  if (existsSync(filePath)) {
    try {
      const current = readJson(filePath);
      observations = Array.isArray(current?.observations) ? current.observations : [];
    } catch (_) {
      observations = [];
    }
  }
  observations.push(observation);
  observations = compactObservations(observations, 96);
  writeFileSync(filePath, `${JSON.stringify({ source, date: localDateKey(), observations }, null, 2)}\n`, "utf8");
  return { recorded: true, file: filePath, segment, resetDetected: observation.resetDetected };
}

function snapshotFile(source) {
  return join(QUOTA_ROOT, source, `quota-${source}-${localDateKey()}.json`);
}

function writeSnapshot(snapshot) {
  const filePath = snapshotFile(snapshot.source);
  mkdirSync(join(QUOTA_ROOT, snapshot.source), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return filePath;
}

function selectedSources() {
  const index = process.argv.indexOf("--source");
  const requested = index >= 0 ? process.argv[index + 1] : "all";
  if (!requested || requested === "all" || requested === "everything") return SOURCES;
  if (!SOURCES.includes(requested)) throw new Error(`Unknown quota source: ${requested}`);
  return [requested];
}

async function loadQuota(source) {
  if (source === "codex") return fetchCodexQuota();
  if (source === "claude") return fetchClaudeQuota();
  const credentials = cursorCredentials();
  try {
    const [quota, usage] = await Promise.all([fetchCursorQuota(credentials), fetchCursorUsageEvents(credentials)]);
    return { snapshot: quota, usage };
  } finally {
    credentials.accessToken = null;
    credentials.userId = null;
  }
}

async function main() {
  const settings = readSettings();
  const results = [];

  for (const source of selectedSources()) {
    if (!accountSyncEnabled(settings, source)) {
      results.push({ source, ok: true, skipped: true, reason: "account sync disabled" });
      continue;
    }
    try {
      const loaded = await loadQuota(source);
      const snapshot = loaded?.snapshot || loaded;
      const filePath = writeSnapshot(snapshot);
      const usageFile = loaded?.usage ? writeCursorUsageSnapshot(loaded.usage) : null;
      const observation = writeQuotaObservation(snapshot, currentUsageAggregate(source, loaded?.usage));
      results.push({ source, ok: true, skipped: false, file: filePath, usageFile, observation, snapshot });
    } catch (error) {
      results.push({ source, ok: false, skipped: false, error: safeError(error) });
    }
  }

  const failures = results.filter((item) => !item.ok);
  process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, partial: failures.length > 0, results })}\n`);
  process.exitCode = failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, partial: false, results: [], error: safeError(error) })}\n`);
    process.exitCode = 1;
  });
}
