import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

function usageFiles(root, prefix) {
  if (!existsSync(root)) return [];
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(?:-\\d{4}-\\d{2}-\\d{2})?\\.json$`, "i");
  return readdirSync(root)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const filePath = join(root, name);
      return { filePath, mtimeMs: statSync(filePath).mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
}

function recomputeTotals(daily, snapshots, current) {
  const keys = new Set(
    [...snapshots, current]
      .filter(Boolean)
      .flatMap((snapshot) => Object.keys(snapshot?.totals || {})),
  );
  const totals = {};
  for (const key of keys) {
    const values = daily
      .map((day) => day?.[key])
      .filter((value) => typeof value === "number" && Number.isFinite(value));
    if (values.length) {
      totals[key] = values.reduce((sum, value) => sum + value, 0);
      continue;
    }
    const fallback = current?.totals?.[key]
      ?? [...snapshots].reverse().find((snapshot) => snapshot?.totals?.[key] !== undefined)?.totals?.[key];
    if (fallback !== undefined) totals[key] = fallback;
  }
  return totals;
}

function normalizeUsageDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function mergeUsageSnapshotHistory(snapshots, current) {
  const priorSnapshots = Array.isArray(snapshots) ? snapshots.filter(Boolean) : [];
  const byDate = new Map();
  for (const snapshot of [...priorSnapshots, current].filter(Boolean)) {
    for (const day of Array.isArray(snapshot?.daily) ? snapshot.daily : []) {
      const dateField = day?.date ? "date" : day?.period ? "period" : null;
      const dateKey = normalizeUsageDate(dateField ? day[dateField] : null);
      if (!dateField || !dateKey) continue;
      byDate.set(dateKey, { ...day, [dateField]: dateKey });
    }
  }
  const daily = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, day]) => day);
  const merged = {
    ...(current || priorSnapshots.at(-1) || {}),
    daily,
    totals: recomputeTotals(daily, priorSnapshots, current),
  };
  if (Object.hasOwn(merged, "rangeDays")) merged.rangeDays = daily.length;
  return merged;
}

function removeDatedSnapshots(roots, prefix) {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-\\d{4}-\\d{2}-\\d{2}\\.json$`, "i");
  for (const root of new Set(roots)) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (pattern.test(name)) unlinkSync(join(root, name));
    }
  }
}

export function writeConsolidatedUsageSnapshot({ output, prefix, roots, incoming }) {
  const normalizedRoots = [...new Set((roots || []).filter(Boolean).map((root) => resolve(root)))];
  const outputPath = resolve(output);
  const priorFiles = normalizedRoots
    .flatMap((root) => usageFiles(root, prefix))
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .map((entry) => entry.filePath)
    .filter((filePath, index, files) => files.indexOf(filePath) === index && resolve(filePath) !== outputPath);
  if (existsSync(outputPath)) priorFiles.push(outputPath);
  const snapshots = priorFiles.map((filePath) => readJson(filePath));
  const current = typeof incoming === "string" ? readJson(incoming) : incoming;
  const merged = mergeUsageSnapshotHistory(snapshots, current);
  writeJsonAtomic(outputPath, merged);
  removeDatedSnapshots(normalizedRoots, prefix);
  return merged;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function argumentValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function main() {
  const output = argumentValue("--output");
  const prefix = argumentValue("--prefix");
  const incoming = argumentValue("--incoming");
  const roots = argumentValues("--root");
  if (!output || !prefix || !incoming || !roots.length) {
    throw new Error("Usage: usage-storage.mjs --output FILE --prefix PREFIX --incoming FILE --root DIR [--root DIR]");
  }
  const merged = writeConsolidatedUsageSnapshot({ output, prefix, incoming, roots });
  process.stdout.write(`${JSON.stringify({ ok: true, output: resolve(output), dailyCount: merged.daily.length })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
