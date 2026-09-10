const { solve } = require("../web/reset-optimizer.js");
const { optimizeBeamSchedule } = require("../web/reset-planner.js");
const DAY = 86400000;
const now = Date.parse("2026-09-05T00:00:00Z");
let seed = 20260905;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
let improvements = 0;
let regressions = 0;
let best = null;
const started = performance.now();
for (let trial = 0; trial < 100; trial += 1) {
  const end = now + (12 + Math.floor(random() * 22)) * DAY;
  const expiries = Array.from({ length: 2 + Math.floor(random() * 3) }, () =>
    now + (1 + Math.floor(random() * 11)) * DAY + Math.floor(random() * 24) * DAY / 24).sort((a, b) => a - b);
  const input = { now, end, remaining: Math.floor(random() * 101),
    resetAt: now + (1 + Math.floor(random() * 150)) * DAY / 24, period: 7 * DAY,
    percentPerDay: 10 + Math.floor(random() * 100), cycleMode: trial % 2 ? "fixed" : "restart",
    credits: expiries.map((expiresAt, index) => ({ ordinal: index + 1, expiresAt })),
    maxTransitions: Number.MAX_SAFE_INTEGER };
  const beam = optimizeBeamSchedule(input);
  const exact = solve(input);
  const delta = exact.servedPercent - beam.servedPercent;
  if (delta > 1e-6) improvements += 1;
  if (delta < -1e-6) regressions += 1;
  if (!best || delta > best.deltaPercent) best = { trial, input, deltaPercent: delta,
    oldServedPercent: beam.servedPercent, newServedPercent: exact.servedPercent,
    oldActions: beam.actions, newActions: exact.actions, certificate: exact.certificate };
}
console.log(JSON.stringify({ cases: 100, improvements, regressions,
  elapsedMs: Math.round(performance.now() - started), best }, null, 2));
if (regressions) process.exitCode = 1;
