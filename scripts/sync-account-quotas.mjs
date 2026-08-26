import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { arch, homedir, hostname, release, type } from "node:os";
import { delimiter, dirname, join, resolve, win32 as pathWin32 } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import providerRegistry from "../providers/registry.js";
import { writeConsolidatedUsageSnapshot } from "./usage-storage.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const USAGE_ROOT = process.env.USAGE_LOG_ROOT || join(ROOT, "usage-logs");
const SETTINGS_PATH = process.env.FORECAST_SETTINGS_PATH || join(USAGE_ROOT, "forecast-settings.json");
const QUOTA_ROOT = process.env.QUOTA_SNAPSHOT_DIR || join(USAGE_ROOT, "quota-snapshots");
const OBSERVATION_ROOT = process.env.QUOTA_OBSERVATION_DIR || join(USAGE_ROOT, "quota-observations");
const PROVIDERS = providerRegistry.PROVIDERS;
const PROVIDER_BY_ID = new Map(PROVIDERS.map((entry) => [entry.id, entry]));
const MANAGED_USAGE_ADAPTER_IDS = new Set(["opencode-sqlite", "deepseek-harness-zstd", "grok-local-jsonl"]);
const SOURCES = PROVIDERS
  .filter((entry) => entry.quota || MANAGED_USAGE_ADAPTER_IDS.has(entry.usage?.adapter))
  .map((entry) => entry.id);
const STORAGE_RETENTION_DAYS = 120;
const MAX_DAILY_QUOTA_SNAPSHOTS = 180;
const MAX_QUOTA_OBSERVATIONS = STORAGE_RETENTION_DAYS * 96;

function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeLegacyDatedFiles(logDir, prefix, { exclude = null } = {}) {
  if (!existsSync(logDir)) return;
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-\\d{4}-\\d{2}-\\d{2}\\.json$`, "i");
  for (const name of readdirSync(logDir)) {
    const filePath = join(logDir, name);
    if (filePath !== exclude && pattern.test(name)) unlinkSync(filePath);
  }
}

function openCodeDatabasePath() {
  return process.env.OPENCODE_DB_PATH || join(homedir(), ".local", "share", "opencode", "opencode.db");
}

function openCodeDateKey(value) {
  const timestamp = Number(value);
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

function openCodeUsageRecord(row) {
  let data;
  try {
    data = typeof row?.data === "string" ? JSON.parse(row.data) : row?.data;
  } catch (_) {
    return null;
  }
  if (data?.role !== "assistant" || !data?.tokens) return null;

  const inputTokens = Math.max(0, numberOrZero(data.tokens.input));
  const outputTokens = Math.max(0, numberOrZero(data.tokens.output));
  const reasoningOutputTokens = Math.max(0, numberOrZero(data.tokens.reasoning));
  const cacheReadTokens = Math.max(0, numberOrZero(data.tokens.cache?.read));
  const cacheCreationTokens = Math.max(0, numberOrZero(data.tokens.cache?.write));
  const calculatedTotal = inputTokens + outputTokens + reasoningOutputTokens + cacheReadTokens + cacheCreationTokens;
  const totalTokens = Math.max(calculatedTotal, numberOrZero(data.tokens.total));
  const date = openCodeDateKey(data.time?.created ?? row.time_created);
  if (!date) return null;

  const modelID = String(data.modelID || "unknown");
  const providerID = String(data.providerID || "opencode");
  return {
    date,
    modelName: `${providerID}/${modelID}`,
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens,
    totalCost: Math.max(0, numberOrZero(data.cost)),
  };
}

function openCodeSessionRecord(row) {
  const date = openCodeDateKey(row?.time_created);
  if (!date) return null;
  let model = row?.model;
  try {
    model = typeof model === "string" ? JSON.parse(model) : model;
  } catch (_) {
    model = null;
  }
  const inputTokens = Math.max(0, numberOrZero(row?.tokens_input));
  const outputTokens = Math.max(0, numberOrZero(row?.tokens_output));
  const reasoningOutputTokens = Math.max(0, numberOrZero(row?.tokens_reasoning));
  const cacheReadTokens = Math.max(0, numberOrZero(row?.tokens_cache_read));
  const cacheCreationTokens = Math.max(0, numberOrZero(row?.tokens_cache_write));
  return {
    date,
    modelName: `${model?.providerID || "opencode"}/${model?.id || "unknown"}`,
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + reasoningOutputTokens + cacheReadTokens + cacheCreationTokens,
    totalCost: Math.max(0, numberOrZero(row?.cost)),
  };
}

export function aggregateOpenCodeUsageRecords(records, generatedAt = new Date().toISOString()) {
  const fields = [
    "inputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "cacheReadTokens",
    "cacheCreationTokens",
    "totalTokens",
    "totalCost",
  ];
  const byDay = new Map();

  for (const record of records || []) {
    if (!record?.date) continue;
    const day = byDay.get(record.date) || {
      date: record.date,
      inputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      models: new Map(),
    };
    for (const field of fields) day[field] += numberOrZero(record[field]);
    const model = day.models.get(record.modelName) || Object.fromEntries(fields.map((field) => [field, 0]));
    for (const field of fields) model[field] += numberOrZero(record[field]);
    day.models.set(record.modelName, model);
    byDay.set(record.date, day);
  }

  const daily = [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({
      ...Object.fromEntries(fields.map((field) => [field, day[field]])),
      date: day.date,
      modelsUsed: [...day.models.keys()],
      modelBreakdowns: [...day.models.entries()]
        .map(([modelName, usage]) => ({ modelName, ...usage }))
        .sort((a, b) => b.totalTokens - a.totalTokens),
    }));
  const totals = Object.fromEntries(fields.map((field) => [field, daily.reduce((sum, day) => sum + numberOrZero(day[field]), 0)]));

  return {
    source: "opencode",
    generatedAt,
    provider: "opencode-sqlite",
    recordCount: records?.length || 0,
    daily,
    totals,
  };
}

export function readOpenCodeUsage(databasePath = openCodeDatabasePath()) {
  if (!existsSync(databasePath)) throw new Error("OpenCode database was not found");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tableNames = new Set(database.prepare("select name from sqlite_master where type = 'table'").all().map((row) => row.name));
    let records = [];
    let recordSource = "message";
    if (tableNames.has("message")) {
      records = database.prepare("select time_created, data from message order by time_created")
        .all()
        .map(openCodeUsageRecord)
        .filter(Boolean);
    }
    if (!records.length && tableNames.has("session")) {
      recordSource = "session-fallback";
      records = database.prepare(`
        select model, cost, tokens_input, tokens_output, tokens_reasoning,
               tokens_cache_read, tokens_cache_write, time_created
        from session order by time_created
      `).all().map(openCodeSessionRecord).filter(Boolean);
    }
    return { ...aggregateOpenCodeUsageRecords(records), recordSource };
  } finally {
    database.close();
  }
}

const GROK_USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
  "totalTokens",
  "totalCost",
];

function grokDateKey(value) {
  const numeric = Number(value);
  const normalized = Number.isFinite(numeric) && numeric > 0 && numeric < 1e12 ? numeric * 1000 : value;
  const date = Number.isFinite(Number(normalized)) ? new Date(Number(normalized)) : new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

export function normalizeGrokPromptUsage(value) {
  if (!value || typeof value !== "object") return null;
  const fullInputTokens = Math.max(0, numberOrZero(value.inputTokens));
  const cacheReadTokens = Math.min(fullInputTokens, Math.max(0, numberOrZero(
    value.cachedReadTokens ?? value.cacheReadInputTokens ?? value.cacheReadTokens,
  )));
  const cacheCreationTokens = Math.min(
    Math.max(0, fullInputTokens - cacheReadTokens),
    Math.max(0, numberOrZero(value.cacheCreationTokens ?? value.cacheCreationInputTokens)),
  );
  const fullOutputTokens = Math.max(0, numberOrZero(value.outputTokens));
  const reasoningOutputTokens = Math.min(fullOutputTokens, Math.max(0, numberOrZero(value.reasoningTokens)));
  const inputTokens = Math.max(0, fullInputTokens - cacheReadTokens - cacheCreationTokens);
  const outputTokens = Math.max(0, fullOutputTokens - reasoningOutputTokens);
  const calculatedTotal = fullInputTokens + fullOutputTokens;

  return {
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: Math.max(calculatedTotal, numberOrZero(value.totalTokens)),
    totalCost: 0,
  };
}

export function grokTurnUsageRecord(payload, fallbackModel = "unknown-model") {
  const update = payload?.params?.update;
  if (update?.sessionUpdate !== "turn_completed" || !update?.usage) return null;
  const date = grokDateKey(payload?.params?._meta?.agentTimestampMs ?? payload?.timestamp);
  const usage = normalizeGrokPromptUsage(update.usage);
  if (!date || !usage) return null;

  const modelEntries = Object.entries(update.usage.modelUsage || {})
    .map(([modelName, modelUsage]) => ({ modelName, ...normalizeGrokPromptUsage(modelUsage) }))
    .filter((entry) => entry.totalTokens > 0);
  const models = modelEntries.length === 1
    ? [{ modelName: modelEntries[0].modelName, ...usage }]
    : modelEntries.length
      ? modelEntries
      : [{ modelName: fallbackModel, ...usage }];
  const promptId = update.prompt_id || payload?.params?._meta?.promptId || null;
  const eventId = payload?.params?._meta?.eventId || null;

  return {
    date,
    ...usage,
    models,
    dedupeKey: promptId ? `prompt:${promptId}` : eventId ? `event:${eventId}` : null,
  };
}

export function aggregateGrokUsageRecords(records, generatedAt = new Date().toISOString(), sourceStats = {}) {
  const byDay = new Map();
  for (const record of records || []) {
    if (!record?.date) continue;
    const day = byDay.get(record.date) || {
      date: record.date,
      ...Object.fromEntries(GROK_USAGE_FIELDS.map((field) => [field, 0])),
      models: new Map(),
    };
    for (const field of GROK_USAGE_FIELDS) day[field] += numberOrZero(record[field]);
    for (const modelRecord of record.models || []) {
      const modelName = String(modelRecord?.modelName || "unknown-model");
      const model = day.models.get(modelName) || Object.fromEntries(GROK_USAGE_FIELDS.map((field) => [field, 0]));
      for (const field of GROK_USAGE_FIELDS) model[field] += numberOrZero(modelRecord[field]);
      day.models.set(modelName, model);
    }
    byDay.set(record.date, day);
  }

  const daily = [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({
      ...Object.fromEntries(GROK_USAGE_FIELDS.map((field) => [field, day[field]])),
      date: day.date,
      modelsUsed: [...day.models.keys()],
      modelBreakdowns: [...day.models.entries()]
        .map(([modelName, usage]) => ({ modelName, ...usage }))
        .sort((a, b) => b.totalTokens - a.totalTokens),
    }));
  const totals = Object.fromEntries(GROK_USAGE_FIELDS.map((field) => [
    field,
    daily.reduce((sum, day) => sum + numberOrZero(day[field]), 0),
  ]));

  return {
    source: "grok",
    generatedAt,
    provider: "grok-local-primary-session-jsonl",
    recordCount: records?.length || 0,
    daily,
    totals,
    ...sourceStats,
  };
}

function grokSessionFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && entry.name === "updates.jsonl") files.push(entryPath);
    }
  }
  return files.sort();
}

function grokSessionRelationship(sessionDirectory) {
  const eventsPath = join(sessionDirectory, "events.jsonl");
  if (!existsSync(eventsPath)) return null;
  for (const line of readFileSync(eventsPath, "utf8").split(/\r?\n/).slice(0, 8)) {
    if (!line.trim()) continue;
    try {
      const relationship = JSON.parse(line)?.session_relationship;
      if (typeof relationship === "string" && relationship.trim()) return relationship.trim().toLowerCase();
    } catch (_) {
      // A partially written event line does not make the session unreadable.
    }
  }
  return null;
}

export function readGrokUsage(provider) {
  const sessionRoot = provider?.usage?.sessionRoot
    || process.env.GROK_SESSION_ROOT
    || join(process.env.GROK_HOME || join(homedir(), ".grok"), "sessions");
  if (!existsSync(sessionRoot)) throw new Error("Grok session directory was not found");

  const files = grokSessionFiles(sessionRoot);
  if (!files.length) throw new Error("Grok has no local session logs");
  const records = [];
  const seen = new Set();
  const sourceStats = {
    scannedFiles: files.length,
    includedFiles: 0,
    skippedNonPrimaryFiles: 0,
    invalidLines: 0,
    duplicateRecords: 0,
  };

  for (const filePath of files) {
    const relationship = grokSessionRelationship(dirname(filePath));
    if (relationship && relationship !== "primary") {
      sourceStats.skippedNonPrimaryFiles += 1;
      continue;
    }
    sourceStats.includedFiles += 1;
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.includes('"turn_completed"')) continue;
      let payload;
      try {
        payload = JSON.parse(line);
      } catch (_) {
        sourceStats.invalidLines += 1;
        continue;
      }
      const record = grokTurnUsageRecord(payload);
      if (!record) continue;
      const dedupeKey = record.dedupeKey || `file:${filePath}:${index}`;
      if (seen.has(dedupeKey)) {
        sourceStats.duplicateRecords += 1;
        continue;
      }
      seen.add(dedupeKey);
      delete record.dedupeKey;
      records.push(record);
    }
  }

  return aggregateGrokUsageRecords(records, new Date().toISOString(), sourceStats);
}

const ZSTD_MAGIC = 0xFD2FB528;

export function scanZstdFrameRanges(buffer) {
  const frames = [];
  let offset = 0;

  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`Invalid Zstandard frame magic at byte ${offset}`);
    }
    offset += 4;

    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`Invalid Zstandard frame descriptor at byte ${offset - 1}`);
    }

    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;

    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) throw new Error(`Invalid Zstandard block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }

    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }

  return { frames };
}

function deepSeekHarnessRoute(value) {
  const provider = typeof value?.provider === "string" ? value.provider.trim() : "";
  const model = typeof value?.model === "string" ? value.model.trim() : "";
  return provider && model ? { provider, model } : null;
}

function deepSeekHarnessUsage(value) {
  if (!value || typeof value !== "object") return null;
  const inputTokens = Math.max(0, numberOrZero(value.inputTokens));
  const outputTokens = Math.max(0, numberOrZero(value.outputTokens));
  const reasoningOutputTokens = Math.max(0, numberOrZero(value.reasoningTokens));
  const cacheReadTokens = Math.max(0, numberOrZero(value.cacheReadTokens));
  const cacheCreationTokens = Math.max(0, numberOrZero(value.cacheWriteTokens));
  return {
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    totalCost: 0,
  };
}

function deepSeekHarnessDate(value, fallback) {
  const candidate = value ?? fallback;
  if (candidate === null || candidate === undefined || candidate === "") return null;
  const timestamp = Number(candidate);
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

function deepSeekHarnessStepKey(data) {
  const turn = Number(data?.turn);
  const step = Number(data?.step);
  return Number.isInteger(turn) && Number.isInteger(step) ? `${turn}:${step}` : null;
}

function sanitizedDeepSeekHarnessEvent(record) {
  if (!record || typeof record !== "object") return null;
  if (record.type === "session") {
    return { type: "session", createdAt: record.createdAt };
  }
  if (record.type === "request/header") {
    const route = deepSeekHarnessRoute(record.data?.header?.config);
    return route ? { type: record.type, time: record.time, route } : null;
  }
  if (record.type === "request/context") {
    const route = deepSeekHarnessRoute(record.data);
    return route ? { type: record.type, time: record.time, route } : null;
  }
  if (record.type === "assistant/chunk" && record.data?.chunk?.type === "usage") {
    const key = deepSeekHarnessStepKey(record.data);
    const usage = deepSeekHarnessUsage(record.data.chunk.usage);
    return key && usage ? { type: record.type, time: record.time, key, usage } : null;
  }
  if (record.type === "assistant/message") {
    const key = deepSeekHarnessStepKey(record.data);
    if (!key) return null;
    return {
      type: record.type,
      time: record.time,
      key,
      route: deepSeekHarnessRoute(record.data?.message?.source),
      usage: deepSeekHarnessUsage(record.data?.usage),
    };
  }
  return null;
}

function parseDeepSeekHarnessJsonl(text, events, stats) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = sanitizedDeepSeekHarnessEvent(JSON.parse(line));
      if (event) events.push(event);
    } catch (_) {
      stats.invalidLines += 1;
    }
  }
}

export function decodeDeepSeekHarnessSessionBuffer(buffer, { compressed = true } = {}) {
  const events = [];
  const stats = { frames: 0, tornFrame: false, invalidLines: 0 };
  if (!compressed) {
    parseDeepSeekHarnessJsonl(buffer.toString("utf8"), events, stats);
    return { events, ...stats };
  }

  const scan = scanZstdFrameRanges(buffer);
  stats.frames = scan.frames.length;
  stats.tornFrame = scan.tornStart !== undefined;
  let pending = "";
  for (const frame of scan.frames) {
    const text = pending + zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString("utf8");
    const lines = text.split(/\r?\n/);
    pending = lines.pop() || "";
    parseDeepSeekHarnessJsonl(lines.join("\n"), events, stats);
  }
  if (pending.trim()) parseDeepSeekHarnessJsonl(pending, events, stats);
  return { events, ...stats };
}

function deepSeekHarnessSessionFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && (entry.name === "session.jsonl.zstd" || entry.name === "session.jsonl")) {
        files.push(entryPath);
      }
    }
  }
  return files.sort();
}

export function aggregateDeepSeekHarnessEvents(
  sessions,
  generatedAt = new Date().toISOString(),
  { providerIds = ["deepseek", "deepseek-official"], sourceStats = {} } = {},
) {
  const allowedProviders = new Set(providerIds.map((value) => String(value).trim().toLowerCase()).filter(Boolean));
  const records = [];

  for (const events of sessions || []) {
    const steps = new Map();
    let route = null;
    let sessionTime = null;
    for (const event of events || []) {
      if (event.type === "session") {
        sessionTime = event.createdAt;
        continue;
      }
      if (event.type === "request/header" || event.type === "request/context") {
        route = event.route;
        continue;
      }
      if (event.type === "assistant/chunk") {
        steps.set(event.key, {
          route,
          date: deepSeekHarnessDate(event.time, sessionTime),
          usage: event.usage,
        });
        continue;
      }
      if (event.type === "assistant/message") {
        const previous = steps.get(event.key);
        if (!previous && !event.usage) continue;
        steps.set(event.key, {
          route: event.route || previous?.route || route,
          date: deepSeekHarnessDate(event.time, sessionTime) || previous?.date || null,
          usage: event.usage || previous?.usage,
        });
      }
    }

    for (const step of steps.values()) {
      const providerId = String(step.route?.provider || "").toLowerCase();
      if (!step.date || !step.usage || !allowedProviders.has(providerId)) continue;
      records.push({
        date: step.date,
        modelName: `${step.route.provider}/${step.route.model}`,
        ...step.usage,
      });
    }
  }

  const snapshot = aggregateOpenCodeUsageRecords(records, generatedAt);
  return {
    ...snapshot,
    source: "deepseek-harness",
    provider: "deepseek-harness-session-zstd",
    recordCount: records.length,
    providerFilter: [...allowedProviders],
    ...sourceStats,
  };
}

export function readDeepSeekHarnessUsage(provider) {
  const sessionRoot = provider?.usage?.sessionRoot
    || process.env.DEEPSEEK_HARNESS_SESSION_ROOT
    || join(process.env.DEEPSEEK_HARNESS_HOME || "D:\\deepseek-harness\\.dsh-home", "sessions");
  if (!existsSync(sessionRoot)) throw new Error("DeepSeek Harness session directory was not found");

  const files = deepSeekHarnessSessionFiles(sessionRoot);
  if (!files.length) throw new Error("DeepSeek Harness has no session logs");
  const sessions = [];
  const sourceStats = {
    scannedFiles: files.length,
    decodedFiles: 0,
    unreadableFiles: 0,
    decodedFrames: 0,
    tornFiles: 0,
    invalidLines: 0,
  };
  for (const filePath of files) {
    try {
      const decoded = decodeDeepSeekHarnessSessionBuffer(readFileSync(filePath), {
        compressed: filePath.endsWith(".zstd"),
      });
      if (!decoded.events.length) throw new Error("DeepSeek Harness session log has no decodable events");
      sessions.push(decoded.events);
      sourceStats.decodedFiles += 1;
      sourceStats.decodedFrames += decoded.frames;
      sourceStats.tornFiles += decoded.tornFrame ? 1 : 0;
      sourceStats.invalidLines += decoded.invalidLines;
    } catch (_) {
      sourceStats.unreadableFiles += 1;
    }
  }
  if (!sourceStats.decodedFiles) throw new Error("DeepSeek Harness session logs could not be decoded");
  return aggregateDeepSeekHarnessEvents(sessions, new Date().toISOString(), {
    providerIds: provider?.usage?.providerIds,
    sourceStats,
  });
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

function roundPercent(value) {
  const percent = clampPercent(value);
  return percent === null ? null : Math.round(percent * 10000) / 10000;
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
    .replace(/(["']?(?:(?:access|refresh|id)[_-]?token|cookie)["']?\s*[=:]\s*)["']?[^"',;\s}]+/gi, "$1[redacted]")
    .slice(0, 220);
}

export function resolveCodexCliPath({ platform = process.platform, env = process.env, pathExists = existsSync } = {}) {
  const configuredPath = String(env.CODEX_CLI_PATH || "").trim();
  if (configuredPath && pathExists(configuredPath)) return configuredPath;
  if (platform !== "win32") return "codex";

  const candidates = [];
  if (env.APPDATA) candidates.push(pathWin32.join(env.APPDATA, "npm", "codex.cmd"));
  for (const directory of String(env.PATH || "").split(platform === "win32" ? ";" : delimiter).filter(Boolean)) {
    candidates.push(pathWin32.join(directory.replace(/^"|"$/g, ""), "codex.cmd"));
  }
  return candidates.find((candidate) => pathExists(candidate)) || "codex";
}

export function codexAppServerInvocation(options = {}) {
  const platform = options.platform || process.platform;
  const cliPath = resolveCodexCliPath({ ...options, platform });
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(cliPath)) {
    const escapedPath = cliPath.replace(/'/g, "''");
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", `& '${escapedPath}' app-server --stdio`],
    };
  }
  return { command: cliPath, args: ["app-server", "--stdio"] };
}

function codexWindow(name, value) {
  if (!value || typeof value !== "object") return null;
  const usedPercent = clampPercent(value.usedPercent);
  if (usedPercent === null) return null;
  const duration = Number(value.windowDurationMins);
  return {
    name,
    label: typeof (value.label ?? value.display_name ?? value.displayName ?? value.title) === "string"
      ? String(value.label ?? value.display_name ?? value.displayName ?? value.title)
      : null,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMins: Number.isFinite(duration) ? duration : null,
    resetsAt: toIsoFromUnixSeconds(value.resetsAt),
  };
}

function terminateChildProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && Number.isInteger(child.pid)) {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.unref();
    return;
  }
  child.kill("SIGKILL");
}

function fetchCodexQuota() {
  return new Promise((resolvePromise, rejectPromise) => {
    const { command, args } = codexAppServerInvocation();
    const child = spawn(command, args, { cwd: ROOT, windowsHide: true });
    let buffer = "";
    let stderr = "";
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.stdin.end();
      setTimeout(() => {
        terminateChildProcessTree(child);
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
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4096);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!finished) {
        const detail = safeError(stderr.trim());
        const suffix = detail ? `: ${detail}` : "";
        finish(new Error(`Codex account quota process exited (${code ?? "unknown"})${suffix}`));
      }
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
  const usedPercent = roundPercent(rawUtilization <= 1 ? rawUtilization * 100 : rawUtilization);
  if (usedPercent === null) return null;
  return {
    name,
    label: typeof (value.label ?? value.display_name ?? value.displayName ?? value.title) === "string"
      ? String(value.label ?? value.display_name ?? value.displayName ?? value.title)
      : null,
    usedPercent,
    remainingPercent: roundPercent(100 - usedPercent),
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

function inferredClaudeWindowMinutes(name) {
  if (/five[_-]?hour/i.test(name)) return 300;
  if (/seven[_-]?day/i.test(name)) return 10080;
  if (/month/i.test(name)) return 43200;
  return null;
}

export function normalizeClaudeUsagePayload(payload, quotaConfig = {}) {
  const definitions = Array.isArray(quotaConfig?.windows) ? quotaConfig.windows : [];
  const definitionNames = definitions.map((definition) => definition.name).filter(Boolean);
  const discoveredNames = quotaConfig?.discoverWindows === false
    ? []
    : Object.entries(payload || {})
        .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
        .map(([name]) => name);
  return [...new Set([...definitionNames, ...discoveredNames])]
    .map((name) => {
      const definition = definitions.find((entry) => entry.name === name);
      const durationMins = Number(definition?.windowDurationMins) || inferredClaudeWindowMinutes(name);
      const window = claudeWindow(name, payload?.[name], durationMins);
      return window && (definition || window.resetsAt) ? window : null;
    })
    .filter(Boolean);
}

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_TOKEN_URLS = [
  "https://platform.claude.com/v1/oauth/token",
  "https://console.anthropic.com/v1/oauth/token",
];

function claudeCredentialPath() {
  return process.env.CLAUDE_CREDENTIAL_PATH || join(homedir(), ".claude", ".credentials.json");
}

function claudeOauthFrom(credentials) {
  const oauth = credentials?.claudeAiOauth;
  if (!oauth || typeof oauth !== "object") throw new Error("Claude OAuth credentials were not found; run claude auth login");
  return oauth;
}

function claudeTokenExpiresSoon(oauth, now = Date.now()) {
  const rawExpiry = Number(oauth?.expiresAt);
  if (!Number.isFinite(rawExpiry) || rawExpiry <= 0) return false;
  const expiresAt = rawExpiry > 1e12 ? rawExpiry : rawExpiry * 1000;
  return expiresAt <= now + 5 * 60 * 1000;
}

function claudeRequestHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
    "anthropic-beta": "oauth-2025-04-20",
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
    "x-app": "cli",
  };
}

async function fetchClaudeUsage(accessToken, fetchImpl = fetch) {
  return fetchImpl(CLAUDE_USAGE_URL, {
    headers: claudeRequestHeaders(accessToken),
    signal: AbortSignal.timeout(12000),
  });
}

function readClaudeCredentials(credentialPath = claudeCredentialPath()) {
  if (!existsSync(credentialPath)) throw new Error("Claude OAuth credentials were not found; run claude auth login");
  return readJson(credentialPath);
}

function rotatedClaudeCredentials(credentialPath, expectedOauth) {
  try {
    const latest = readClaudeCredentials(credentialPath);
    const latestOauth = claudeOauthFrom(latest);
    const accessChanged = latestOauth.accessToken && latestOauth.accessToken !== expectedOauth.accessToken;
    const refreshChanged = latestOauth.refreshToken && latestOauth.refreshToken !== expectedOauth.refreshToken;
    return accessChanged || refreshChanged ? latest : null;
  } catch (_) {
    return null;
  }
}

async function waitForRotatedClaudeCredentials(credentialPath, expectedOauth) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rotated = rotatedClaudeCredentials(credentialPath, expectedOauth);
    if (rotated) return rotated;
    if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  return null;
}

export async function refreshClaudeCredential(credentials, options = {}) {
  const credentialPath = options.credentialPath || claudeCredentialPath();
  const fetchImpl = options.fetchImpl || fetch;
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const oauth = claudeOauthFrom(credentials);
  const refreshToken = oauth.refreshToken;
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new Error("Claude OAuth token expired and no refresh token is available; run claude auth login");
  }

  const body = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLAUDE_OAUTH_CLIENT_ID,
  };
  if (Array.isArray(oauth.scopes) && oauth.scopes.length) body.scope = oauth.scopes.join(" ");

  let response = null;
  for (let index = 0; index < CLAUDE_TOKEN_URLS.length; index += 1) {
    const tokenUrl = CLAUDE_TOKEN_URLS[index];
    try {
      response = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "x-app": "cli" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      });
    } catch (error) {
      if (index + 1 < CLAUDE_TOKEN_URLS.length) continue;
      throw error;
    }
    if (response.ok) break;
    if ((response.status === 404 || response.status === 405) && index + 1 < CLAUDE_TOKEN_URLS.length) continue;

    const rotated = await waitForRotatedClaudeCredentials(credentialPath, oauth);
    if (rotated) return rotated;
    const loginHint = response.status === 400 || response.status === 401 ? "; run claude auth login" : "";
    throw new Error(`Claude OAuth refresh returned HTTP ${response.status}${loginHint}`);
  }

  if (!response?.ok) throw new Error("Claude OAuth refresh failed; run claude auth login");
  const payload = await response.json();
  if (typeof payload?.access_token !== "string" || !payload.access_token) {
    throw new Error("Claude OAuth refresh did not return an access token");
  }

  const latest = readClaudeCredentials(credentialPath);
  const latestOauth = claudeOauthFrom(latest);
  if (
    (latestOauth.accessToken && latestOauth.accessToken !== oauth.accessToken)
    || (latestOauth.refreshToken && latestOauth.refreshToken !== refreshToken)
  ) {
    return latest;
  }

  const expiresIn = Number(payload.expires_in);
  const refreshedOauth = {
    ...latestOauth,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || refreshToken,
    expiresAt: Number.isFinite(expiresIn) ? now + expiresIn * 1000 : now + 8 * 60 * 60 * 1000,
  };
  if (typeof payload.scope === "string" && payload.scope.trim()) {
    refreshedOauth.scopes = payload.scope.trim().split(/\s+/);
  }
  const refreshed = { ...latest, claudeAiOauth: refreshedOauth };
  writeJsonAtomically(credentialPath, refreshed);
  return refreshed;
}

async function fetchClaudeQuota(provider) {
  const credentialPath = claudeCredentialPath();
  let credentials = readClaudeCredentials(credentialPath);
  let oauth = claudeOauthFrom(credentials);

  try {
    if (claudeTokenExpiresSoon(oauth) || typeof oauth.accessToken !== "string" || !oauth.accessToken) {
      credentials = await refreshClaudeCredential(credentials, { credentialPath });
      oauth = claudeOauthFrom(credentials);
    }

    let response = await fetchClaudeUsage(oauth.accessToken);
    if (response.status === 401) {
      const rotated = rotatedClaudeCredentials(credentialPath, oauth);
      credentials = rotated || await refreshClaudeCredential(credentials, { credentialPath });
      oauth = claudeOauthFrom(credentials);
      response = await fetchClaudeUsage(oauth.accessToken);
    }
    if (!response.ok) throw new Error(`Claude usage endpoint returned HTTP ${response.status}`);
    const payload = await response.json();
    const windows = normalizeClaudeUsagePayload(payload, provider?.quota);
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
    if (credentials?.claudeAiOauth) {
      credentials.claudeAiOauth.accessToken = null;
      credentials.claudeAiOauth.refreshToken = null;
    }
  }
}

function humanizeQuotaWindowName(name) {
  return String(name || "额度窗口")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function applyQuotaWindowTemplate(provider, snapshot) {
  if (!snapshot || !Array.isArray(snapshot.windows)) return snapshot;
  const minimumForecastWindowMins = Number(provider?.quota?.minimumForecastWindowMins) || 0;
  const definitions = new Map(
    (Array.isArray(provider?.quota?.windows) ? provider.quota.windows : [])
      .filter((definition) => definition?.name)
      .map((definition) => [definition.name, definition]),
  );
  snapshot.windows = snapshot.windows.map((window) => {
    const definition = definitions.get(window.name);
    const normalized = {
      ...window,
      label: window.label || definition?.label || humanizeQuotaWindowName(window.name),
      windowDurationMins: Number(window.windowDurationMins) || Number(definition?.windowDurationMins) || null,
      windowKind: window.windowKind || definition?.windowKind || null,
    };
    if (definition?.selectable === false) {
      normalized.selectable = false;
    } else if (
      definition?.selectable !== true &&
      minimumForecastWindowMins > 0 &&
      Number.isFinite(Number(normalized.windowDurationMins)) &&
      Number(normalized.windowDurationMins) < minimumForecastWindowMins
    ) {
      normalized.selectable = false;
    }
    if (Array.isArray(definition?.modelPatterns) && definition.modelPatterns.length) {
      Object.defineProperty(normalized, "modelPatterns", {
        value: definition.modelPatterns.map(String),
        enumerable: false,
      });
    }
    return normalized;
  });
  return snapshot;
}

export function quotaWindowUsageAggregate(window, usageAggregate) {
  const totalTokens = Number.isFinite(Number(usageAggregate?.totalTokens)) ? Number(usageAggregate.totalTokens) : null;
  const models = usageAggregate?.models && typeof usageAggregate.models === "object" ? usageAggregate.models : {};
  const patterns = (Array.isArray(window?.modelPatterns) ? window.modelPatterns : [])
    .map((pattern) => String(pattern).trim().toLowerCase())
    .filter(Boolean);
  if (!patterns.length) return { totalTokens, models };

  const matchingModels = Object.fromEntries(
    Object.entries(models).filter(([model]) => {
      const normalized = model.toLowerCase();
      return patterns.some((pattern) => normalized.includes(pattern));
    }),
  );
  return {
    totalTokens: Object.values(matchingModels).reduce((sum, value) => sum + (Number(value) || 0), 0),
    models: matchingModels,
  };
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
    quotaBreakdown: [
      { label: "Auto + Composer", usedPercent: clampPercent(plan.autoPercentUsed) },
      { label: "API", usedPercent: clampPercent(plan.apiPercentUsed) },
    ],
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

function kimiCodeHome() {
  return process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
}

function kimiDesktopCodeHome() {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return process.env.KIMI_DESKTOP_CODE_HOME
    || join(appData, "kimi-desktop", "daimon-share", "daimon", "runtime", "kimi-code", "home");
}

function kimiDesktopTokenStorePath() {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return process.env.KIMI_DESKTOP_TOKEN_STORE
    || join(appData, "kimi-desktop", "bridge-store", "token-store.json");
}

function kimiCredentialPath() {
  return process.env.KIMI_CODE_CREDENTIAL_PATH || join(kimiCodeHome(), "credentials", "kimi-code.json");
}

function kimiDeviceHeaders() {
  const deviceName = encodeURIComponent(hostname());
  const deviceId = createHash("sha256").update(`${hostname()}\0${type()}\0${arch()}`).digest("hex").slice(0, 32);
  return {
    "X-Msh-Platform": "kimi_code_cli",
    "X-Msh-Version": process.env.KIMI_CODE_VERSION || "0.27.0",
    "X-Msh-Device-Name": deviceName,
    "X-Msh-Device-Model": arch(),
    "X-Msh-Os-Version": release(),
    "X-Msh-Device-Id": process.env.KIMI_CODE_DEVICE_ID || deviceId,
  };
}

function writeJsonAtomically(filePath, payload) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, filePath);
}

async function refreshKimiCredential(credentials) {
  if (typeof credentials?.refresh_token !== "string" || !credentials.refresh_token) {
    throw new Error("Kimi Code refresh token was not found; run kimi login again");
  }
  const response = await fetch("https://auth.kimi.com/api/oauth/token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      ...kimiDeviceHeaders(),
    },
    body: new URLSearchParams({
      client_id: "17e5f671-d194-4dfb-9706-5516cb48c098",
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Kimi OAuth refresh returned HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload?.access_token !== "string" || !payload.access_token) {
    throw new Error("Kimi OAuth refresh did not return an access token");
  }
  const expiresIn = Number(payload.expires_in);
  const refreshed = {
    ...credentials,
    ...payload,
    refresh_token: payload.refresh_token || credentials.refresh_token,
    expires_at: Number.isFinite(expiresIn) ? Math.floor(Date.now() / 1000) + expiresIn : credentials.expires_at,
  };
  writeJsonAtomically(kimiCredentialPath(), refreshed);
  return refreshed;
}

async function kimiCredential(forceRefresh = false) {
  const credentialPath = kimiCredentialPath();
  if (!existsSync(credentialPath)) throw new Error("Kimi Code credentials were not found; run kimi login first");
  const credentials = readJson(credentialPath);
  const expiresAt = Number(credentials?.expires_at);
  const expiresSoon = Number.isFinite(expiresAt) && expiresAt * 1000 <= Date.now() + 5 * 60 * 1000;
  if (forceRefresh || expiresSoon || typeof credentials?.access_token !== "string" || !credentials.access_token) {
    return refreshKimiCredential(credentials);
  }
  return credentials;
}

function kimiResetAt(row) {
  const absolute = row?.reset_at ?? row?.resetAt ?? row?.reset_time ?? row?.resetTime;
  if (absolute) {
    const numeric = Number(absolute);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric > 1e12 ? numeric : numeric * 1000).toISOString();
    }
    return toIso(absolute);
  }
  const relative = Number(row?.reset_in ?? row?.resetIn ?? row?.ttl ?? (typeof row?.window === "number" ? row.window : null));
  return Number.isFinite(relative) && relative >= 0 ? new Date(Date.now() + relative * 1000).toISOString() : null;
}

function kimiWindowMinutes(row) {
  const window = row?.window;
  if (window && typeof window === "object") {
    const duration = Number(window.duration ?? window.value ?? window.length);
    const unit = String(window.unit ?? window.time_unit ?? window.timeUnit ?? "minute").toLowerCase();
    if (Number.isFinite(duration) && duration > 0) {
      if (unit.startsWith("day")) return duration * 1440;
      if (unit.startsWith("hour")) return duration * 60;
      if (unit.startsWith("week")) return duration * 10080;
      if (unit.startsWith("second")) return duration / 60;
      return duration;
    }
  }
  const direct = Number(row?.window_duration_mins ?? row?.windowDurationMins);
  return Number.isFinite(direct) && direct > 0 ? direct : null;
}

function kimiUsageRow(raw, fallbackName, fallbackLabel) {
  if (!raw || typeof raw !== "object") return null;
  const row = raw.detail && typeof raw.detail === "object" ? { ...raw, ...raw.detail } : raw;
  const limit = Number(row.limit ?? row.total ?? row.quota);
  let used = Number(row.used ?? row.consumed);
  const remaining = Number(row.remaining ?? row.left);
  if (!Number.isFinite(used) && Number.isFinite(limit) && Number.isFinite(remaining)) used = limit - remaining;
  const explicitPercent = Number(row.used_percent ?? row.usedPercent ?? row.percent ?? row.percentage);
  const usedPercent = roundPercent(Number.isFinite(explicitPercent)
    ? explicitPercent
    : Number.isFinite(limit) && limit > 0 && Number.isFinite(used)
      ? (used / limit) * 100
      : null);
  if (usedPercent === null) return null;
  const label = String(row.title ?? row.label ?? row.name ?? fallbackLabel);
  const name = String(row.scope ?? row.name ?? fallbackName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallbackName;
  return {
    name,
    label,
    usedPercent,
    remainingPercent: roundPercent(100 - usedPercent),
    windowDurationMins: kimiWindowMinutes(row),
    resetsAt: kimiResetAt(row),
    limit: Number.isFinite(limit) ? limit : null,
    used: Number.isFinite(used) ? used : null,
    remaining: Number.isFinite(remaining) ? remaining : Number.isFinite(limit) && Number.isFinite(used) ? Math.max(0, limit - used) : null,
  };
}

export function normalizeKimiUsagePayload(payload, fetchedAt = new Date().toISOString()) {
  const rows = [];
  const summary = kimiUsageRow(payload?.usage, "weekly_limit", "Kimi Code 周额度");
  if (summary) rows.push({ ...summary, windowDurationMins: summary.windowDurationMins || 10080 });
  const limits = Array.isArray(payload?.limits) ? payload.limits : [];
  limits.forEach((entry, index) => {
    const duration = kimiWindowMinutes(entry);
    const fallbackLabel = duration === 300 ? "Kimi Code 5 小时额度" : `Kimi Code 额度 ${index + 1}`;
    const row = kimiUsageRow(entry, `limit_${index + 1}`, fallbackLabel);
    if (row) rows.push(row);
  });
  const deduplicated = [...new Map(rows.map((row) => [`${row.name}:${row.resetsAt || ""}:${row.windowDurationMins || ""}`, row])).values()];
  if (!deduplicated.length) throw new Error("Kimi managed usage response did not include usage windows");
  return {
    source: "kimi",
    fetchedAt,
    provider: "kimi-code-managed-usage",
    planType: typeof payload?.plan === "string" ? payload.plan : null,
    windows: deduplicated,
    quotaBreakdown: deduplicated.map((row) => ({ label: row.label, usedPercent: row.usedPercent })),
  };
}

function kimiPercentRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return roundPercent(number >= 0 && number <= 1 ? number * 100 : number);
}

export function normalizeKimiMembershipStats(payload, fetchedAt = new Date().toISOString()) {
  const balance = payload?.subscriptionBalance ?? payload?.subscription_balance;
  if (!balance || typeof balance !== "object") {
    throw new Error("Kimi membership response did not include a subscription balance");
  }
  const usedPercent = kimiPercentRatio(balance.amountUsedRatio ?? balance.amount_used_ratio);
  const codeUsedPercent = kimiPercentRatio(balance.kimiCodeUsedRatio ?? balance.kimi_code_used_ratio) ?? 0;
  const resetsAt = toIso(balance.expireTime ?? balance.expire_time);
  if (usedPercent === null || !resetsAt) {
    throw new Error("Kimi membership response did not include monthly usage or reset time");
  }
  const kimiUsedPercent = roundPercent(usedPercent - codeUsedPercent);
  const remainingPercent = roundPercent(100 - usedPercent);
  return {
    source: "kimi",
    fetchedAt,
    provider: "kimi-membership-stats",
    planType: null,
    windows: [{
      name: "monthly_membership",
      label: "月度总额",
      windowKind: "monthly",
      usedPercent,
      remainingPercent,
      // The subscription anniversary is a calendar-month cycle; 30 days is a ranking hint only.
      windowDurationMins: 43200,
      resetsAt,
      limit: 100,
      used: usedPercent,
      remaining: remainingPercent,
    }],
    quotaBreakdown: [
      { label: "月度 Kimi", usedPercent: kimiUsedPercent },
      { label: "月度 Code", usedPercent: codeUsedPercent },
    ],
  };
}

export function mergeKimiQuotaSnapshots(codeSnapshot, membershipSnapshot) {
  const snapshots = [membershipSnapshot, codeSnapshot].filter(Boolean);
  if (!snapshots.length) return null;
  if (snapshots.length === 1) return snapshots[0];
  return {
    source: "kimi",
    fetchedAt: snapshots.map((snapshot) => snapshot.fetchedAt).filter(Boolean).sort().at(-1) || new Date().toISOString(),
    provider: "kimi-membership-and-code-usage",
    planType: codeSnapshot?.planType || membershipSnapshot?.planType || null,
    windows: snapshots.flatMap((snapshot) => snapshot.windows || []),
    quotaBreakdown: membershipSnapshot?.quotaBreakdown || [],
    quotaSources: snapshots.map((snapshot) => snapshot.provider).filter(Boolean),
  };
}

async function fetchKimiMembershipQuota() {
  const tokenStorePath = kimiDesktopTokenStorePath();
  if (!existsSync(tokenStorePath)) throw new Error("Kimi desktop membership credentials were not found");
  const tokenStore = readJson(tokenStorePath);
  const accessToken = tokenStore?.tokens?.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Kimi desktop membership access token was not found");
  }
  try {
    const response = await fetch(
      "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "connect-protocol-version": "1",
          "content-type": "application/json",
          "x-language": "zh-CN",
          "x-msh-platform": "web",
        },
        body: JSON.stringify({ domain: "DOMAIN_KIMI" }),
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok) throw new Error(`Kimi membership stats endpoint returned HTTP ${response.status}`);
    return normalizeKimiMembershipStats(await response.json());
  } finally {
    tokenStore.tokens.access_token = null;
    tokenStore.tokens.refresh_token = null;
  }
}

async function fetchKimiQuota() {
  let credentials = await kimiCredential(false);
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch("https://api.kimi.com/coding/v1/usages", {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credentials.access_token}`,
          ...kimiDeviceHeaders(),
        },
        signal: AbortSignal.timeout(12000),
      });
      if (response.status === 401 && attempt === 0) {
        credentials.access_token = null;
        credentials = await kimiCredential(true);
        continue;
      }
      if (!response.ok) throw new Error(`Kimi managed usage endpoint returned HTTP ${response.status}`);
      return normalizeKimiUsagePayload(await response.json());
    }
    throw new Error("Kimi managed usage credentials were rejected");
  } finally {
    if (credentials) {
      credentials.access_token = null;
      credentials.refresh_token = null;
    }
  }
}

function kimiWireFiles(root = join(kimiCodeHome(), "sessions")) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase() === "wire.jsonl") files.push(fullPath);
    }
  };
  visit(root);
  return files;
}

function kimiUsageSources() {
  const candidates = [
    { id: "kimi-code-cli", root: join(kimiCodeHome(), "sessions") },
    { id: "kimi-desktop", root: join(kimiDesktopCodeHome(), "sessions") },
  ];
  const seen = new Set();
  return candidates.filter((source) => {
    const key = resolve(source.root).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return existsSync(source.root);
  });
}

function kimiUsageRecordKey(record) {
  return createHash("sha256").update(JSON.stringify({
    time: record?.time ?? null,
    model: record?.model ?? null,
    usageScope: record?.usageScope ?? null,
    usage: record?.usage ?? null,
  })).digest("hex");
}

export function aggregateKimiUsageRecords(records, generatedAt = new Date().toISOString()) {
  const byDay = new Map();
  for (const record of records || []) {
    if (record?.type !== "usage.record" || record?.usageScope !== "turn") continue;
    const numericTime = Number(record.time);
    const timestamp = Number.isFinite(numericTime)
      ? new Date(numericTime >= 1e12 ? numericTime : numericTime * 1000)
      : new Date(record.time);
    if (Number.isNaN(timestamp.getTime())) continue;
    const usage = record.usage || {};
    const inputTokens = numberOrZero(usage.inputOther ?? usage.input_tokens);
    const outputTokens = numberOrZero(usage.output ?? usage.output_tokens);
    const cacheReadTokens = numberOrZero(usage.inputCacheRead ?? usage.cache_read_tokens);
    const cacheCreationTokens = numberOrZero(usage.inputCacheCreation ?? usage.cache_creation_tokens);
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
    if (!totalTokens) continue;
    const date = localDateKey(timestamp);
    const modelName = String(record.model || "kimi-unknown");
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
    const model = day.models.get(modelName) || {
      modelName,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      cost: 0,
    };
    for (const target of [day, model]) {
      target.inputTokens += inputTokens;
      target.outputTokens += outputTokens;
      target.cacheCreationTokens += cacheCreationTokens;
      target.cacheReadTokens += cacheReadTokens;
      target.totalTokens += totalTokens;
    }
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
      totalCost: 0,
      modelsUsed: [...day.models.keys()],
      modelBreakdowns: [...day.models.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    }));
  const totals = daily.reduce((sum, day) => {
    sum.inputTokens += day.inputTokens;
    sum.outputTokens += day.outputTokens;
    sum.cacheCreationTokens += day.cacheCreationTokens;
    sum.cacheReadTokens += day.cacheReadTokens;
    sum.totalTokens += day.totalTokens;
    return sum;
  }, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, totalCost: 0 });
  return { source: "kimi", generatedAt, provider: "kimi-code-wire", daily, totals };
}

export function mergeKimiUsageSourceRecords(sources, generatedAt = new Date().toISOString()) {
  const merged = [];
  const priorCounts = new Map();
  const usageSources = [];
  let deduplicatedRecords = 0;

  for (const source of sources || []) {
    const sourceCounts = new Map();
    let acceptedRecords = 0;
    let usageRecords = 0;
    for (const record of source?.records || []) {
      if (record?.type !== "usage.record" || record?.usageScope !== "turn") continue;
      usageRecords += 1;
      const key = kimiUsageRecordKey(record);
      const occurrence = (sourceCounts.get(key) || 0) + 1;
      sourceCounts.set(key, occurrence);
      if (occurrence <= (priorCounts.get(key) || 0)) {
        deduplicatedRecords += 1;
        continue;
      }
      merged.push(record);
      acceptedRecords += 1;
    }
    for (const [key, count] of sourceCounts) {
      priorCounts.set(key, Math.max(priorCounts.get(key) || 0, count));
    }
    usageSources.push({
      id: String(source?.id || "kimi-local"),
      wireFiles: numberOrZero(source?.wireFiles),
      usageRecords,
      acceptedRecords,
    });
  }

  return {
    ...aggregateKimiUsageRecords(merged, generatedAt),
    provider: "kimi-local-wire",
    usageSources,
    deduplicatedRecords,
  };
}

function readKimiUsage() {
  const sources = [];
  for (const source of kimiUsageSources()) {
    const files = kimiWireFiles(source.root);
    const records = [];
    for (const filePath of files) {
      const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (record?.type === "usage.record") records.push(record);
        } catch (_) {
          // A partially written final line is ignored until the next refresh.
        }
      }
    }
    sources.push({ id: source.id, wireFiles: files.length, records });
  }
  return mergeKimiUsageSourceRecords(sources);
}

function writeManagedUsageSnapshot(source, snapshot) {
  const provider = PROVIDER_BY_ID.get(source);
  if (!provider) throw new Error(`Unknown usage source: ${source}`);
  const logDir = provider.usage.logRoot;
  const filePath = join(logDir, `${provider.usage.filePrefix}.json`);
  writeConsolidatedUsageSnapshot({
    output: filePath,
    prefix: provider.usage.filePrefix,
    roots: [logDir, ...(provider.usage.legacyRoots || [])],
    incoming: snapshot,
  });
  return filePath;
}

function usageSnapshotPath(source) {
  const provider = PROVIDER_BY_ID.get(source);
  if (!provider) return null;
  const logDir = provider.usage.logRoot;
  if (!existsSync(logDir)) return null;
  const rollingFile = join(logDir, `${provider.usage.filePrefix}.json`);
  if (existsSync(rollingFile)) return rollingFile;
  const files = readdirSync(logDir)
    .filter((name) => new RegExp(`^${escapeRegExp(provider.usage.filePrefix)}-\\d{4}-\\d{2}-\\d{2}\\.json$`, "i").test(name))
    .sort()
    .reverse();
  return files.length ? join(logDir, files[0]) : null;
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

function observationFile(source) {
  return join(OBSERVATION_ROOT, source, `quota-observations-${source}.json`);
}

function observationFiles(source) {
  const logDir = join(OBSERVATION_ROOT, source);
  if (!existsSync(logDir)) return [];
  const rollingName = `quota-observations-${source}.json`;
  return readdirSync(logDir)
    .filter((name) => name === rollingName || /^quota-observations-\d{4}-\d{2}-\d{2}\.json$/i.test(name))
    .sort()
    .map((name) => join(logDir, name));
}

function observationKey(observation) {
  return [
    observation?.windowName || "quota-window",
    observation?.fetchedAt || "",
    observation?.segment ?? "",
    observation?.usedPercent ?? "",
    observation?.totalTokens ?? "",
    observation?.resetAt || "",
  ].join("|");
}

export function mergeObservationHistory(
  observations,
  additions = [],
  {
    now = new Date(),
    retentionDays = STORAGE_RETENTION_DAYS,
    maxEntries = MAX_QUOTA_OBSERVATIONS,
  } = {},
) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffMs = cutoff.getTime();
  const byKey = new Map();
  for (const observation of [...(observations || []), ...(additions || [])]) {
    const timestamp = new Date(observation?.fetchedAt || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp < cutoffMs) continue;
    byKey.set(observationKey(observation), observation);
  }
  const merged = [...byKey.values()].sort(
    (a, b) => new Date(a.fetchedAt || 0).getTime() - new Date(b.fetchedAt || 0).getTime(),
  );
  return compactObservations(merged, maxEntries);
}

function allObservations(source) {
  const observations = observationFiles(source).flatMap((filePath) => {
    try {
      const payload = readJson(filePath);
      return Array.isArray(payload?.observations) ? payload.observations : [];
    } catch (_) {
      return [];
    }
  });
  return mergeObservationHistory(observations);
}

function persistObservations(source, observations) {
  const filePath = observationFile(source);
  writeJsonAtomic(filePath, {
    source,
    updatedAt: new Date().toISOString(),
    retentionDays: STORAGE_RETENTION_DAYS,
    observations,
  });
  removeLegacyDatedFiles(join(OBSERVATION_ROOT, source), "quota-observations", { exclude: filePath });
  return filePath;
}

function observationWindows(snapshot) {
  return [...(snapshot?.windows || [])]
    .filter((window) => window?.selectable !== false && Number.isFinite(Number(window?.usedPercent)))
    .sort((a, b) => (Number(b?.windowDurationMins) || 0) - (Number(a?.windowDurationMins) || 0));
}

export function detectObservationSegment(prior, current) {
  if (!prior) return { newSegment: true, resetDetected: false, reason: "first-observation" };
  if (prior.windowName && current.windowName && prior.windowName !== current.windowName) {
    return { newSegment: true, resetDetected: false, reason: "quota-window-changed" };
  }
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

  const protectedIndexes = new Set();
  const latestIndexByWindow = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    const windowName = current?.windowName || "quota-window";
    const previousIndex = latestIndexByWindow.get(windowName);
    if (previousIndex === undefined) protectedIndexes.add(index);
    const previous = previousIndex === undefined ? null : entries[previousIndex];
    const previousSegment = previous?.segment === null || previous?.segment === undefined
      ? null
      : String(previous.segment);
    const currentSegment = current?.segment === null || current?.segment === undefined
      ? null
      : String(current.segment);
    const segmentChanged = previousSegment !== null && currentSegment !== null && previousSegment !== currentSegment;
    if (previous && (current?.resetDetected || segmentChanged)) {
      protectedIndexes.add(previousIndex);
      protectedIndexes.add(index);
    }
    latestIndexByWindow.set(windowName, index);
  }
  latestIndexByWindow.forEach((index) => protectedIndexes.add(index));

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
  const history = allObservations(source);
  const filesBeforeWrite = observationFiles(source);
  const rollingFile = observationFile(source);
  const migrationRequired = filesBeforeWrite.some((filePath) => filePath !== rollingFile);
  const windows = observationWindows(snapshot);
  if (!windows.length) {
    const filePath = history.length && (migrationRequired || !existsSync(rollingFile))
      ? persistObservations(source, history)
      : existsSync(rollingFile) ? rollingFile : null;
    return { recorded: false, file: filePath, reason: "quota window unavailable" };
  }

  const fetchedAt = snapshot.fetchedAt || new Date().toISOString();
  const additions = [];
  for (const window of windows) {
    const windowName = window.name || "quota-window";
    const prior = [...history, ...additions].filter((entry) => entry.windowName === windowName).at(-1) || null;
    const usedPercent = Number(window.usedPercent);
    const windowUsage = quotaWindowUsageAggregate(window, usageAggregate);
    const totalTokens = windowUsage.totalTokens;
    const segmentDecision = detectObservationSegment(prior, {
      windowName,
      resetAt: window.resetsAt || null,
      usedPercent,
      totalTokens,
    });
    const newSegment = segmentDecision.newSegment;
    const segment = newSegment ? Number(prior?.segment || 0) + 1 : Number(prior.segment || 1);
    const elapsedMinutes = prior ? (new Date(fetchedAt).getTime() - new Date(prior.fetchedAt).getTime()) / 60000 : Infinity;
    const quotaMoved = !prior || Math.abs(usedPercent - Number(prior.usedPercent)) >= 0.1;
    const usageMoved = !prior || totalTokens === null || prior.totalTokens === null || Math.abs(totalTokens - Number(prior.totalTokens)) >= 50_000;
    if (!newSegment && !quotaMoved && !(elapsedMinutes >= 15 && usageMoved)) continue;

    additions.push({
      fetchedAt,
      segment,
      segmentStartedAt: newSegment ? fetchedAt : prior.segmentStartedAt || prior.fetchedAt,
      windowName,
      windowLabel: window.label || null,
      windowKind: window.windowKind || null,
      usedPercent,
      resetAt: window.resetsAt || null,
      windowDurationMins: Number(window.windowDurationMins) || null,
      totalTokens,
      models: windowUsage.models,
      resetDetected: segmentDecision.resetDetected,
      resetReason: segmentDecision.reason,
    });
  }
  if (!additions.length && !migrationRequired && existsSync(rollingFile)) {
    return { recorded: false, file: rollingFile, reason: "unchanged observations" };
  }

  const observations = mergeObservationHistory(history, additions);
  const filePath = persistObservations(source, observations);
  if (!additions.length) {
    return { recorded: false, file: filePath, reason: "unchanged observations" };
  }
  return {
    recorded: true,
    file: filePath,
    windowCount: additions.length,
    windows: additions.map((observation) => ({
      name: observation.windowName,
      segment: observation.segment,
      resetDetected: observation.resetDetected,
    })),
  };
}

function snapshotFile(source) {
  return join(QUOTA_ROOT, source, `quota-${source}.json`);
}

function quotaSnapshotFiles(source) {
  const logDir = join(QUOTA_ROOT, source);
  if (!existsSync(logDir)) return [];
  const rollingName = `quota-${source}.json`;
  const datedPattern = new RegExp(`^quota-${escapeRegExp(source)}-\\d{4}-\\d{2}-\\d{2}\\.json$`, "i");
  return readdirSync(logDir)
    .filter((name) => name === rollingName || datedPattern.test(name))
    .sort()
    .map((name) => join(logDir, name));
}

function snapshotDateKey(snapshot) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(snapshot?.date || "")) return snapshot.date;
  const date = new Date(snapshot?.fetchedAt || snapshot?.generatedAt || 0);
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

function snapshotTimestamp(snapshot) {
  const value = new Date(snapshot?.fetchedAt || snapshot?.generatedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function mergeQuotaSnapshotHistory(
  snapshots,
  current = null,
  {
    now = new Date(),
    retentionDays = STORAGE_RETENTION_DAYS,
    maxEntries = MAX_DAILY_QUOTA_SNAPSHOTS,
  } = {},
) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffKey = localDateKey(cutoff);
  const byDate = new Map();
  for (const snapshot of [...(snapshots || []), ...(current ? [current] : [])]) {
    const dateKey = snapshotDateKey(snapshot);
    if (!dateKey || dateKey < cutoffKey) continue;
    const prior = byDate.get(dateKey);
    if (!prior || snapshotTimestamp(snapshot) >= snapshotTimestamp(prior)) byDate.set(dateKey, snapshot);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-Math.max(1, Math.floor(Number(maxEntries) || MAX_DAILY_QUOTA_SNAPSHOTS)))
    .map(([, snapshot]) => snapshot);
}

function readQuotaSnapshotHistory(source) {
  return quotaSnapshotFiles(source).flatMap((filePath) => {
    try {
      const payload = readJson(filePath);
      if (Array.isArray(payload?.history)) return payload.history;
      if (payload?.latest && typeof payload.latest === "object") return [payload.latest];
      return payload && typeof payload === "object" ? [payload] : [];
    } catch (_) {
      return [];
    }
  });
}

function writeSnapshot(snapshot) {
  const source = snapshot.source;
  const filePath = snapshotFile(source);
  const history = mergeQuotaSnapshotHistory(readQuotaSnapshotHistory(source), snapshot);
  writeJsonAtomic(filePath, {
    source,
    updatedAt: new Date().toISOString(),
    retentionDays: STORAGE_RETENTION_DAYS,
    latest: history.at(-1) || snapshot,
    history,
  });
  removeLegacyDatedFiles(join(QUOTA_ROOT, source), `quota-${source}`, { exclude: filePath });
  return filePath;
}

function selectedSources() {
  const index = process.argv.indexOf("--source");
  const requested = index >= 0 ? process.argv[index + 1] : "all";
  if (!requested || requested === "all" || requested === "everything") return SOURCES;
  if (!SOURCES.includes(requested)) throw new Error(`Unknown quota source: ${requested}`);
  return [requested];
}

const QUOTA_ADAPTERS = {
  "codex-app-server": fetchCodexQuota,
  "claude-oauth": fetchClaudeQuota,
  "cursor-account": async () => {
    const credentials = cursorCredentials();
    try {
      const [quota, usage] = await Promise.all([fetchCursorQuota(credentials), fetchCursorUsageEvents(credentials)]);
      return { snapshot: quota, usage };
    } finally {
      credentials.accessToken = null;
      credentials.userId = null;
    }
  },
  "kimi-managed-usage": async () => {
    const usage = readKimiUsage();
    const [codeResult, membershipResult] = await Promise.allSettled([
      fetchKimiQuota(),
      fetchKimiMembershipQuota(),
    ]);
    const snapshot = mergeKimiQuotaSnapshots(
      codeResult.status === "fulfilled" ? codeResult.value : null,
      membershipResult.status === "fulfilled" ? membershipResult.value : null,
    );
    const warnings = [codeResult, membershipResult]
      .filter((result) => result.status === "rejected")
      .map((result) => safeError(result.reason));
    return {
      snapshot,
      usage,
      snapshotError: snapshot ? null : warnings.join("; "),
      snapshotWarnings: warnings,
    };
  },
};

const MANAGED_USAGE_ADAPTERS = {
  "opencode-sqlite": () => readOpenCodeUsage(),
  "deepseek-harness-zstd": (provider) => readDeepSeekHarnessUsage(provider),
  "grok-local-jsonl": (provider) => readGrokUsage(provider),
};

async function loadQuota(source) {
  const provider = PROVIDER_BY_ID.get(source);
  if (!provider?.quota) {
    const usageAdapter = MANAGED_USAGE_ADAPTERS[provider?.usage?.adapter];
    if (!usageAdapter) throw new Error(`No managed usage adapter is registered for ${source}`);
    return { snapshot: null, usage: await usageAdapter(provider), quotaExpected: false };
  }
  const adapter = QUOTA_ADAPTERS[provider?.quota?.adapter];
  if (!adapter) throw new Error(`No quota adapter is registered for ${source}`);
  const loaded = await adapter(provider);
  if (loaded?.snapshot) {
    loaded.snapshot.source = provider.id;
    applyQuotaWindowTemplate(provider, loaded.snapshot);
  } else if (loaded && !loaded.usage) {
    loaded.source = provider.id;
    applyQuotaWindowTemplate(provider, loaded);
  }
  if (loaded?.usage) loaded.usage.source = provider.id;
  return loaded;
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
      const provider = PROVIDER_BY_ID.get(source);
      const snapshot = loaded?.snapshot || loaded;
      const usageFile = loaded?.usage ? writeManagedUsageSnapshot(source, loaded.usage) : null;
      if (!snapshot || loaded?.snapshot === null) {
        results.push({
          source,
          kind: provider?.quota ? "quota" : "usage",
          ok: true,
          partial: Boolean(provider?.quota),
          skipped: false,
          file: null,
          usageFile,
          warning: provider?.quota
            ? loaded?.snapshotError || "Account quota was unavailable; local usage was still exported"
            : null,
          observation: { recorded: false, file: null, reason: "quota window unavailable" },
        });
        continue;
      }
      const filePath = writeSnapshot(snapshot);
      const observation = writeQuotaObservation(snapshot, currentUsageAggregate(source, loaded?.usage));
      results.push({
        source,
        kind: "quota",
        ok: true,
        partial: Boolean(loaded?.snapshotWarnings?.length),
        skipped: false,
        file: filePath,
        usageFile,
        warnings: loaded?.snapshotWarnings || [],
        observation,
        snapshot,
      });
    } catch (error) {
      results.push({ source, ok: false, skipped: false, error: safeError(error) });
    }
  }

  const failures = results.filter((item) => !item.ok);
  const partial = failures.length > 0 || results.some((item) => item.partial);
  process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, partial, results })}\n`);
  process.exitCode = failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, partial: false, results: [], error: safeError(error) })}\n`);
    process.exitCode = 1;
  });
}
