const test = require("node:test");
const assert = require("node:assert/strict");
const { solve, planningGrid, simulate, simulateReactive, stressTest } = require("../web/reset-optimizer.js");
const { optimizeBeamSchedule } = require("../web/reset-planner.js");
const HOUR = 3600000;
const DAY = 24 * HOUR;
const now = Date.parse("2026-09-05T00:00:00Z");
const common = { now, end: now + 3 * DAY, remaining: 20, resetAt: now + 12 * HOUR,
  period: 36 * HOUR, percentPerDay: 80, cycleMode: "restart", stepMs: 6 * HOUR,
  credits: [1, 2, 3].map((ordinal) => ({ ordinal, expiresAt: now + ordinal * DAY })) };

// Independent event-by-event oracle, not the optimizer's segment-reward formula.
function replay(input, actions) {
  let time = input.now;
  let balance = input.remaining;
  let natural = input.resetAt;
  let actionIndex = 0;
  let served = 0;
  let urgent = 0;
  let discarded = 0;
  const cutoff = Math.min(input.end, input.now + DAY);
  while (time < input.end) {
    if (natural === time) { balance = 100; natural += input.period; }
    if (actions[actionIndex]?.at === time) {
      if (balance >= 100 - 1e-7 || balance > (input.maxDiscardPercent ?? 100) + 1e-7) return null;
      discarded += balance;
      balance = 100;
      if (input.cycleMode === "restart") natural = time + input.period;
      actionIndex += 1;
    }
    const part = input.demandProfile?.find((part) => part.until > time);
    const next = Math.min(input.end, natural, actions[actionIndex]?.at ?? Infinity,
      part?.until ?? Infinity, time < cutoff ? cutoff : Infinity);
    const demand = (next - time) * (part?.percentPerDay ?? input.percentPerDay) / DAY;
    const accepted = Math.min(balance, demand);
    served += accepted;
    if (time < cutoff) urgent += accepted;
    balance -= accepted;
    time = next;
  }
  return { served, urgent, discarded, used: actions.length };
}

function bruteForce(input) {
  const times = planningGrid(input).times.filter((time) => time < input.end);
  let best = null;
  const better = (a, b) => !b || (input.objective === "urgent-24h" && Math.abs(a.urgent - b.urgent) > 1e-7
    ? a.urgent > b.urgent : Math.abs(a.served - b.served) > 1e-7 ? a.served > b.served
      : a.used !== b.used ? a.used < b.used : a.discarded < b.discarded - 1e-7);
  function walk(i, actions) {
    if (i === input.credits.length) {
      const candidate = replay(input, actions);
      if (candidate && better(candidate, best)) best = candidate;
      return;
    }
    if (!input.requireAllCredits) walk(i + 1, actions);
    const credit = input.credits[i];
    for (const at of times) {
      if (at <= (actions.at(-1)?.at ?? -Infinity) || at >= credit.expiresAt
        || at > Math.max(input.now, credit.expiresAt - HOUR)) continue;
      walk(i + 1, [...actions, { ...credit, at }]);
    }
  }
  walk(0, []);
  return best;
}

test("exact DP matches exhaustive schedules for fixed/restarted clocks, burst demand and urgent objectives", () => {
  for (const cycleMode of ["fixed", "restart"]) for (const objective of ["total", "urgent-24h"]) {
    for (const remaining of [0, 25, 100]) for (const burst of [false, true]) {
      const input = { ...common, remaining, cycleMode, objective,
        demandProfile: burst ? [
          { until: now + 18 * HOUR, percentPerDay: 120 },
          { until: now + 54 * HOUR, percentPerDay: 0 },
          { until: common.end, percentPerDay: 210 },
        ] : undefined };
      const brute = bruteForce(input);
      const exact = solve(input);
      assert.ok(Math.abs(exact.servedPercent - brute.served) < 1e-6);
      if (objective === "urgent-24h") assert.ok(Math.abs(exact.urgentPercent - brute.urgent) < 1e-6);
      assert.equal(exact.actions.length, brute.used);
      assert.ok(Math.abs(exact.discardedPercent - brute.discarded) < 1e-6);
      assert.ok(exact.certificate.continuousUpperPercent >= brute.served - 1e-6);
      const independent = replay(input, exact.actions);
      assert.ok(Math.abs(independent.served - exact.servedPercent) < 1e-6);
    }
  }
});

test("constrained full-stock DP matches exhaustive feasibility and the low-waste objective", () => {
  for (const percentPerDay of [2, 60, 180]) {
    const input = { ...common, percentPerDay, requireAllCredits: true, maxDiscardPercent: 5 };
    const brute = bruteForce(input);
    const result = solve(input);
    assert.equal(result.feasible, Boolean(brute));
    if (brute) assert.ok(Math.abs(result.servedPercent - brute.served) < 1e-6);
    else assert.equal(result.certificate.gridOptimal, false);
  }
});

test("a demand-satisfied baseline has an analytical continuous-time optimum certificate", () => {
  const result = solve({ ...common, remaining: 100, percentPerDay: 5 });
  assert.equal(result.certificate.method, "demand-bound");
  assert.equal(result.certificate.continuousOptimal, true);
  assert.equal(result.certificate.continuousGapPercent, 0);
  assert.equal(result.operations, 0);
  assert.equal(result.actions.length, 0);
});

test("empty quota with continued work prioritizes a reset now over waiting", () => {
  const input = { ...common, remaining: 0, resetAt: now + 2 * DAY, period: 7 * DAY,
    percentPerDay: 70, objective: "urgent-24h" };
  const result = solve(input);
  assert.equal(result.actions[0].at, now);
  assert.equal(result.baselineUrgentPercent, 0);
  assert.ok(Math.abs(result.urgentPercent - 70) < 1e-6);
});

test("adaptive resolution is disclosed rather than labelled as continuous-time optimality", () => {
  const input = { ...common, end: now + 60 * DAY, percentPerDay: 80,
    stepMs: HOUR / 2, maxTransitions: 100_000 };
  const result = solve(input);
  assert.ok(result.stepMs > HOUR / 2);
  assert.equal(result.certificate.scope, "time-grid");
  assert.equal(result.certificate.gridOptimal, true);
  assert.ok(result.certificate.continuousGapPercent >= 0);
});

test("fixed-schedule historical stress replay is reproducible and never leaks a future reoptimization", () => {
  const input = { ...common, period: 7 * DAY, resetAt: now + 2 * DAY, remaining: 0 };
  const plan = solve(input);
  const history = Array.from({ length: 28 }, (_, i) => i % 5 === 0 ? 0 : (i % 3 + 1) * 10e6);
  const result = stressTest(input, plan.actions, history);
  assert.deepEqual(result, stressTest(input, plan.actions, history));
  assert.equal(result.ready, true);
  assert.equal(result.cases.length, 8);
  assert.equal(result.cases.filter((entry) => entry.burst).length, 4);
  assert.equal(stressTest(input, plan.actions, history.slice(0, 3)).ready, false);
  const replayed = simulate(input, plan.actions);
  assert.ok(Math.abs(replayed.servedPercent - plan.servedPercent) < 1e-6);
});

test("DP is never worse than the old beam search on an identical regular grid", () => {
  for (const remaining of [0, 30, 85]) for (const percentPerDay of [15, 45, 110]) {
    const input = { ...common, remaining, percentPerDay, end: now + 10 * DAY,
      period: 7 * DAY, resetAt: now + 3 * DAY, stepMs: HOUR / 2,
      credits: [1, 2, 3].map((ordinal) => ({ ordinal, expiresAt: now + ordinal * 3 * DAY })) };
    assert.ok(solve(input).servedPercent >= optimizeBeamSchedule(input).servedPercent - 1e-6);
  }
});

test("clustered expiries retain the earlier refill chain lost by beam pruning", () => {
  const input = { ...common, remaining: 31, percentPerDay: 58, end: now + 24 * DAY,
    period: 7 * DAY, resetAt: now + 22 * HOUR, stepMs: HOUR / 2,
    credits: [91, 190, 190, 284].map((hours, index) => ({ ordinal: index + 1, expiresAt: now + hours * HOUR })) };
  const result = solve(input);
  assert.ok(Math.abs(result.servedPercent - 731) < 1e-6);
  assert.ok(result.servedPercent - optimizeBeamSchedule(input).servedPercent > 155);
  assert.ok(Math.abs(replay(input, result.actions).served - result.servedPercent) < 1e-6);
});

test("reactive work continuation cannot anticipate a change in future demand", () => {
  const input = { ...common, remaining: 0, period: 7 * DAY, resetAt: now + 2 * DAY };
  const first = { until: now + DAY, percentPerDay: 140 };
  const calm = simulateReactive({ ...input, demandProfile: [first, { until: input.end, percentPerDay: 0 }] });
  const busy = simulateReactive({ ...input, demandProfile: [first, { until: input.end, percentPerDay: 300 }] });
  assert.deepEqual(calm.actions.filter((action) => action.at < now + DAY),
    busy.actions.filter((action) => action.at < now + DAY));
  assert.equal(calm.actions[0].at, now);
  assert.equal(simulateReactive({ ...input, percentPerDay: 0 }).actions.length, 0);
});
