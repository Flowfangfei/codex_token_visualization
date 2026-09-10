const test = require("node:test");
const assert = require("node:assert/strict");
const { inventory, optimizeSchedule, planResets } = require("../web/reset-planner.js");
const HOUR = 3600000;
const DAY = 24 * HOUR;
const now = Date.parse("2026-09-05T00:00:00Z");
const iso = (value) => new Date(value).toISOString();
const credit = (days, extra = {}) => ({ status: "available", title: "Full reset",
  expires_at_ms: now + days * DAY, ...extra });
const input = (changes = {}) => ({
  now, policy: { cycleMode: "restart", creditTitles: ["Full reset"] },
  credits: { ok: true, available_count: 2, credits: [credit(3), credit(10)] },
  remainingPercent: 20, resetAt: iso(now + 4 * DAY), windowDurationMins: 10080,
  fetchedAt: iso(now), dailyTokens: 30_000_000, percentPerDay: 60,
  intervalCount: 8, rSquared: 0.95, ...changes,
});

test("reset benefits and schedules use quota points, not raw or equivalent token scale", () => {
  const a = planResets(input({ equivalentDailyTokens: 60_000_000 }));
  const b = planResets(input({ dailyTokens: 3_000_000, equivalentDailyTokens: 180_000_000 }));
  assert.equal(a.benefitUnit, "quota-percentage-points");
  assert.equal(a.plan.gainPercent, b.plan.gainPercent);
  assert.deepEqual(a.plan.actions, b.plan.actions);
  assert.deepEqual(a.urgentPlans, b.urgentPlans.map((entry, index) => ({ ...entry,
    extraTodayTokens: a.urgentPlans[index].extraTodayTokens,
    versusRegularTodayTokens: a.urgentPlans[index].versusRegularTodayTokens,
    horizonTradeoffTokens: a.urgentPlans[index].horizonTradeoffTokens,
  })));
  assert.equal(a.plan.gainEquivalentTokens, a.plan.gainPercent * 1_000_000);
  assert.equal(a.plan.gainTokens, a.plan.gainPercent * 500_000);
  assert.equal(b.plan.gainEquivalentTokens, a.plan.gainEquivalentTokens * 3);
  assert.ok(Math.abs(b.plan.gainTokens * 10 - a.plan.gainTokens) < 1e-6);
  assert.equal(planResets(input()).plan.gainEquivalentTokens, null);
});

test("same token count with faster measured quota consumption schedules the first reset earlier", () => {
  const a = planResets(input());
  const b = planResets(input({ percentPerDay: 150, equivalentDailyTokens: 75_000_000 }));
  assert.ok(b.plan.actions[0].at < a.plan.actions[0].at);
});

test("model calibration failures suppress numeric planning without discarding reset inventory", () => {
  for (const reason of ["model-calibrating", "model-mix-changed"]) {
    const result = planResets(input({ calibration: { ready: false, reason } }));
    assert.equal(result.status, "sampling");
    assert.equal(result.reason, reason);
    assert.equal(result.availableCount, 2);
    assert.equal(result.plan, undefined);
  }
});

test("reset inventory filters redeemed, unknown-scope and expired credits without retaining ids", () => {
  const result = inventory({ available_count: 4, credits: [
    credit(4, { id: "private" }), credit(2), credit(3, { title: "Partial reset" }), credit(-1),
    credit(1, { status: "redeemed" }),
  ] }, { creditTitles: ["Full reset"] }, now);
  assert.equal(result.countMismatch, false);
  assert.deepEqual(result.credits.map((entry) => entry.expiresAt), [now + 2 * DAY, now + 4 * DAY]);
  assert.equal(result.excludedCount, 2);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("reset planning refuses mismatched inventory, stale data, missing or weak calibration", () => {
  assert.equal(planResets(input({ credits: { ok: false } })).reason, "credits-unavailable");
  assert.equal(planResets(input({ credits: { ok: true, available_count: 3, credits: [credit(1)] } })).reason, "credit-count-mismatch");
  assert.equal(planResets(input({ fetchedAt: iso(now - 7 * HOUR) })).reason, "stale-quota");
  assert.equal(planResets(input({ usageFetchedAt: iso(now - 2 * HOUR) })).reason, "stale-usage");
  assert.equal(planResets(input({ percentPerDay: null })).reason, "insufficient-fit");
  assert.equal(planResets(input({ intervalCount: 1 })).reason, "insufficient-fit");
  assert.equal(planResets(input({ rSquared: -0.2 })).reason, "weak-fit");
  assert.equal(planResets(input({ resetAt: iso(now - 1) })).reason, "quota-unavailable");
  assert.equal(planResets(input({ credits: { ok: true, available_count: 0, credits: [] } })).status, "empty");
});

test("natural resets replace unused balance and low demand never consumes a needless reset", () => {
  const result = planResets(input({ dailyTokens: 1_000_000, percentPerDay: 2, remainingPercent: 100 }));
  assert.equal(result.status, "ready");
  assert.equal(result.plan.actions.length, 0);
  assert.equal(result.plan.gainTokens, 0);
  assert.ok(Math.abs(result.plan.servedTokens - result.dailyTokens * (result.end - now) / DAY) < 1);
});

test("multiple full resets can be scheduled within one day and consume earliest expiry first", () => {
  const result = optimizeSchedule({ now, end: now + DAY, remaining: 0, resetAt: now + 5 * DAY,
    period: 7 * DAY, percentPerDay: 400, cycleMode: "restart",
    credits: [1, 2, 3].map((ordinal) => ({ ordinal, expiresAt: now + DAY, title: "Full reset" })),
  });
  assert.deepEqual(result.actions.map((action) => action.ordinal), [1, 2, 3]);
  assert.ok(result.actions.every((action) => action.at < now + DAY));
  assert.ok(Math.abs(result.servedPercent - 300) < 1e-6);
  assert.ok(result.actions.every((action) => action.nextResetAt === action.at + 7 * DAY));
});

test("expiring credit can restore quota that remains usable after its expiry", () => {
  const result = optimizeSchedule({ now, end: now + 3 * DAY, remaining: 50, resetAt: now + 5 * DAY,
    period: 7 * DAY, percentPerDay: 40, cycleMode: "restart",
    credits: [{ ordinal: 1, expiresAt: now + DAY, title: "Full reset" }],
  });
  assert.equal(result.actions.length, 1);
  assert.ok(result.actions[0].at <= now + DAY - HOUR);
  assert.ok(result.actions[0].discardedPercent > 0);
  assert.ok(result.servedPercent > result.baselinePercent);
});

test("unknown cycle policy exposes both schedules, never silently assumes additive quota", () => {
  const result = planResets(input({ policy: { cycleMode: "unknown" } }));
  assert.equal(result.policyUncertain, true);
  assert.deepEqual(result.plan.alternatives.map((entry) => entry.cycleMode), ["restart", "fixed"]);
  for (const scenario of result.scenarios) for (const alternative of scenario.alternatives) {
    assert.ok(alternative.servedTokens >= alternative.baselineTokens);
    assert.ok(alternative.servedPercent <= alternative.demandPercent + 1e-6);
    assert.ok(alternative.actions.every((action) => Math.abs(action.restoredPercent + action.discardedPercent - 100) < 1e-6));
  }
});

test("a reset right before a natural refill does not count that refill twice", () => {
  const common = { now, end: now + 9 * DAY, remaining: 0, resetAt: now + HOUR,
    period: 7 * DAY, percentPerDay: 200, credits: [{ ordinal: 1, expiresAt: now + 2 * HOUR }] };
  const fixed = optimizeSchedule({ ...common, cycleMode: "fixed" });
  const restarted = optimizeSchedule({ ...common, cycleMode: "restart" });
  assert.ok(fixed.gainPercent <= 200 / 24 + 1e-6);
  assert.ok(restarted.servedPercent >= restarted.baselinePercent);
  assert.ok(restarted.gainPercent < 1);
});

test("bounded search always beats or matches the no-reset baseline over varied rates", () => {
  for (const remaining of [0, 30, 100]) for (const percentPerDay of [5, 40, 200]) {
    const result = optimizeSchedule({ now, end: now + 10 * DAY, remaining,
      resetAt: now + 2 * DAY, period: 7 * DAY, percentPerDay, cycleMode: "restart",
      credits: [{ ordinal: 1, expiresAt: now + 3 * DAY }, { ordinal: 2, expiresAt: now + 5 * DAY }],
    });
    assert.ok(result.servedPercent >= result.baselinePercent - 1e-6);
    assert.ok(result.servedPercent <= result.demandPercent + 1e-6);
    assert.ok(result.actions.every((action) => action.at < action.expiresAt));
  }
});

test("extra-work target uses the inventory with low waste and compares the same increased workload", () => {
  const result = planResets(input({
    credits: { ok: true, available_count: 2, credits: [credit(10), credit(20)] },
    remainingPercent: 60, resetAt: iso(now + 3 * DAY), dailyTokens: 10e6, percentPerDay: 10,
  }));
  assert.equal(result.plan.actions.length, 0);
  assert.ok(result.target.factor > 1 && result.target.factor <= 8);
  assert.equal(result.target.dailyTokens, result.dailyTokens * result.target.factor);
  const target = result.target.alternatives[0];
  assert.equal(target.actions.length, 2);
  assert.ok(target.actions.every((action) => action.discardedPercent <= 5));
  assert.ok(Math.abs(target.gainTokens - (target.servedPercent - target.baselinePercent) * result.tokensPerPercent) < 1);
});

test("full-stock workload remains feasible when expiry dates cluster and the measured pace changes slightly", () => {
  const start = Date.parse("2026-09-05T11:00:00Z");
  const credits = ["2026-09-21T00:24:51Z", "2026-10-04T05:37:16Z", "2026-10-05T04:22:54Z"]
    .map((expires_at) => ({ status: "available", title: "Full reset", expires_at }));
  for (const offset of [0, HOUR / 2]) {
    const result = planResets(input({
      now: start + offset, fetchedAt: iso(start + offset),
      credits: { ok: true, available_count: 3, credits }, remainingPercent: 52,
      resetAt: "2026-09-07T14:20:07Z", dailyTokens: 84e6, percentPerDay: 5.483 + offset / DAY,
    }));
    assert.equal(result.plan.actions.length, 0);
    assert.ok(result.target, "A feasible full-stock schedule must not be replaced by a two-reset plan");
    for (const plan of result.target.alternatives) {
      assert.equal(plan.feasible, true);
      assert.equal(plan.actions.length, 3);
      assert.ok(plan.actions.every((action) => action.discardedPercent <= 5 && action.at < action.expiresAt));
    }
  }
});

test("full-stock constraint reports infeasible rather than dropping a credit or discarding extra balance", () => {
  const result = optimizeSchedule({ now, end: now + 2 * DAY, remaining: 100,
    resetAt: now + DAY, period: 7 * DAY, percentPerDay: 2, cycleMode: "restart",
    credits: [{ ordinal: 1, expiresAt: now + DAY }], maxDiscardPercent: 5, requireAllCredits: true,
  });
  assert.equal(result.feasible, false);
  assert.equal(result.actions.length, 0);
});

test("planner passes available credits and complete-day history into causal stress analysis", () => {
  const result = planResets(input({ remainingPercent: 0,
    recentDailyTokens: Array.from({ length: 28 }, (_, i) => (i % 4 + 1) * 10e6) }));
  assert.equal(result.status, "ready");
  assert.equal(result.stress.ready, true);
  assert.equal(result.stress.cases.length, 8);
  assert.ok(result.urgentPlans[0].extraTodayTokens > 0);
  assert.ok(Number.isFinite(result.stress.meanReactiveAdvantagePercent));
});
