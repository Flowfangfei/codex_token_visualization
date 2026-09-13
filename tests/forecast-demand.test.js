const test = require("node:test");
const assert = require("node:assert/strict");
const { estimate, restrictionEvidence } = require("../web/forecast-demand.js");
process.env.TZ = "Asia/Shanghai";
const HOUR = 3600000;
const at = (day, hour = 0) => new Date(2026, 8, day, hour).getTime();
const iso = (time) => new Date(time).toISOString();
const usage = (day, tokens) => ({ date: `2026-09-${String(day).padStart(2, "0")}`, totalTokens: tokens });
const point = (day, hour, used = 100, total = 10e6, extra = {}) => ({
  fetchedAt: iso(at(day, hour)), usageFetchedAt: iso(at(day, hour)), windowName: "weekly",
  usedPercent: used, totalTokens: total, resetAt: iso(at(13)), segment: 1, ...extra,
});
const run = (days, observations, day, hour, extra = {}) => estimate({ days, observations,
  windowName: "weekly", now: at(day, hour), usageFetchedAt: iso(at(day, hour)),
  currentUsage: { fetchedAt: iso(at(day, hour)), totalTokens: days.reduce((sum, row) => sum + row.totalTokens, 0) },
  ...extra });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("quota exhaustion does not lower demand as a zero-usage afternoon gets longer", () => {
  const days = [usage(4, 12e6), usage(5, 12e6), usage(6, 10e6)];
  const noon = run(days, [point(6, 12, 100, 34e6)], 6, 12);
  const evening = run(days, [point(6, 12, 100, 34e6), point(6, 18, 100, 34e6)], 6, 18);
  const night = run(days, [point(6, 12, 100, 34e6), point(6, 18, 100, 34e6), point(6, 23, 100, 34e6)], 6, 23);
  near(noon.weightedRate, evening.weightedRate);
  near(noon.weightedRate, night.weightedRate);
  assert.ok(night.observedWeightedRate < noon.observedWeightedRate);
  assert.equal(night.demand.removedHours, 11);
  assert.equal(night.todayUsage, 10e6);
});

test("normal idle days and nights remain real zero-demand observations", () => {
  const days = [usage(4, 24e6), usage(5, 0), usage(6, 0)];
  const result = run(days, [point(5, 0, 40, 24e6), point(6, 18, 40, 24e6)], 6, 18);
  assert.equal(result.demand.adjusted, false);
  near(result.weightedRate, 24e6 * 24 / 66);
  assert.deepEqual(result.stressHistory, [24e6, 0]);
  const morning = run([usage(6, 10e6)], [], 6, 12);
  const night = run([usage(6, 10e6)], [], 6, 23);
  assert.ok(night.weightedRate < morning.weightedRate);
});

test("rates freeze at the exported snapshot rather than decay as an idle browser redraws", () => {
  const data = [usage(6, 10e6)];
  const noon = run(data, [], 6, 12);
  const later = run(data, [], 6, 23, { usageFetchedAt: iso(at(6, 12)) });
  near(noon.weightedRate, later.weightedRate);
  assert.equal(later.asOf, at(6, 12));
});

test("multiple same-day resets exclude ambiguous recovery time AND its token increment", () => {
  const observations = [point(6, 10), point(6, 12),
    point(6, 13, 10, 15e6, { segment: 2 }), point(6, 15, 100, 25e6, { segment: 2 }),
    point(6, 18, 100, 25e6, { segment: 2 }), point(6, 19, 10, 30e6, { segment: 3 })];
  const days = [usage(6, 30e6)];
  const result = run(days, observations, 6, 20);
  near(result.weightedRate, 20e6 * 24 / 13);
  assert.equal(result.demand.recoveryHours, 2);
  assert.equal(result.todayUsage, 30e6);
  assert.equal(days[0].totalTokens, 30e6);
  const equivalent = run([usage(6, 90e6)], observations.map((p) => ({ ...p, demandTokens: p.totalTokens * 3 })), 6, 20,
    { currentUsage: { fetchedAt: iso(at(6, 20)), totalTokens: 30e6 } });
  near(equivalent.weightedRate, result.weightedRate * 3);
});

test("cross-midnight exhaustion is split by local day without turning missing demand into zero", () => {
  const observations = [point(5, 22), point(6, 2), point(6, 6)];
  const result = run([usage(5, 10e6), usage(6, 0)], observations, 6, 6);
  near(result.weightedRate, 10e6 * 24 / 22);
  assert.equal(result.demand.removedHours, 8);
  assert.deepEqual(result.stressHistory, [null]);
});

test("unknown cross-date recovery and long observation gaps do not fabricate continuous blockage", () => {
  for (const [days, observations] of [[[usage(5, 10e6), usage(6, 5e6)], [point(5, 22), point(6, 2, 10, 15e6, { segment: 2 })]],
    [[usage(5, 10e6), usage(6, 0)], [point(5, 12), point(6, 12)]]]) {
    const result = run(days, observations, 6, 12);
    assert.equal(result.demand.ready, false);
    assert.equal(result.demand.unknownDays, 2);
    assert.equal(result.weightedRate, null);
    assert.equal(result.demand.removedHours, 0);
  }
});

test("missing, stale or regressing usage counters never certify idle time as quota-blocked", () => {
  for (const change of [{ usageFetchedAt: null }, { usageFetchedAt: iso(at(5, 1)) }, { totalTokens: null }]) {
    const result = run([usage(6, 10e6)], [point(6, 10, 100, 10e6, change), point(6, 12)], 6, 12);
    assert.equal(result.demand.ready, false);
    assert.equal(result.demand.removedHours, 0);
  }
  const regressed = run([usage(6, 5e6)], [point(6, 10), point(6, 12, 100, 5e6)], 6, 12);
  assert.equal(regressed.demand.ready, false);
});

test("full-looking quotas that continue serving tokens are not treated as binding limits", () => {
  const result = run([usage(6, 12e6)], [point(6, 10), point(6, 11), point(6, 12, 100, 12e6)], 6, 12);
  assert.equal(result.demand.adjusted, false);
  assert.equal(result.demand.nonBindingCycles, 1);
  near(result.weightedRate, result.observedWeightedRate);
});

test("only the selected window is used and pending tails end at natural recovery", () => {
  const observations = [point(6, 10, 100, 10e6, { resetAt: iso(at(6, 12)) }),
    point(6, 11, 100, 10e6, { windowName: "other" })];
  const result = run([usage(6, 10e6)], observations, 6, 14);
  assert.equal(result.demand.provisionalHours, 2);
  assert.equal(result.demand.removedHours, 2);
  assert.equal(restrictionEvidence(observations, "absent", at(6, 14), {}).intervals.length, 0);
});

test("usage after a natural recovery cannot invalidate earlier confirmed exhaustion", () => {
  const observations = [point(5, 12, 100, 10e6, { resetAt: iso(at(6)) }),
    point(5, 18, 100, 10e6, { resetAt: iso(at(6)) })];
  const result = run([usage(5, 10e6), usage(6, 5e6)], observations, 6, 12);
  assert.equal(result.demand.nonBindingCycles, 0);
  assert.deepEqual(result.stressHistory, [null]);
});

test("unknown equivalent-token deltas do not silently fall back to raw tokens", () => {
  const result = run([usage(6, 30e6)], [point(6, 10, 100, 10e6, { demandTokens: null }),
    point(6, 12, 10, 15e6, { segment: 2, demandTokens: 30e6 })], 6, 12);
  assert.equal(result.demand.ready, false);
});

test("local calendar exposure respects daylight-saving boundaries", () => {
  const priorZone = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const now = new Date(2026, 10, 2).getTime();
    const result = estimate({ days: [{ date: "2026-10-31", totalTokens: 24e6 },
      { date: "2026-11-01", totalTokens: 25e6 }], now });
    near(result.weightedRate, 24e6);
    assert.equal(result.demand.availableHours[1], 49);
  } finally { process.env.TZ = priorZone; }
});

test("weeks of observed exhaustion can reuse earlier normal days without inventing usage", () => {
  const days = [usage(1, 24e6), usage(2, 24e6), usage(3, 24e6), usage(4, 0)];
  const observations = [];
  for (let time = at(4); time <= at(12); time += 6 * HOUR) observations.push({
    ...point(4, 0, 100, 72e6), fetchedAt: iso(time), usageFetchedAt: iso(time), resetAt: iso(at(20)) });
  const result = run(days, observations, 12, 0);
  assert.equal(result.demand.ready, true);
  assert.equal(result.demand.referenceDays, 3);
  near(result.weightedRate, 24e6);
  assert.equal(result.todayUsage, 0);
  assert.equal(result.stressHistory.filter((value) => value === null).length, 8);
});

test("confirmed exhaustion is sampled without growing files or adding false fit intervals", async () => {
  const { shouldRecordQuotaObservation, compactObservations } = await import("../scripts/sync-account-quotas.mjs");
  const prior = point(6, 10);
  assert.equal(shouldRecordQuotaObservation(prior, prior, iso(at(6, 10) + 14 * 60000)), false);
  assert.equal(shouldRecordQuotaObservation(prior, prior, iso(at(6, 10) + 15 * 60000)), true);
  assert.equal(shouldRecordQuotaObservation({ ...prior, usedPercent: 99.99 }, prior, iso(at(6, 10) + 60000)), true);
  assert.equal(shouldRecordQuotaObservation({ ...prior, usedPercent: 40 }, { ...prior, usedPercent: 40 }, iso(at(6, 12))), false);
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: i, windowName: "weekly", segment: 1,
    usedPercent: i < 40 ? 60 : 100 }));
  const kept = new Set(compactObservations(rows, 12).map((p) => p.id));
  for (const index of [0, 39, 40, 119]) assert.ok(kept.has(index));
  const ForecastModel = require("../web/forecast-model.js");
  assert.equal(ForecastModel.buildSegmentIntervals([[point(6, 10), point(6, 12)]]).length, 0);
});
