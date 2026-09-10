(function attachResetPlanner(root, factory) {
  if (typeof module === "object" && module.exports) root.ResetOptimizer = require("./reset-optimizer.js");
  else if (typeof WorkerGlobalScope !== "undefined" && root instanceof WorkerGlobalScope) importScripts("/reset-optimizer.js");
  const api = factory(root.ResetOptimizer);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ResetPlanner = api;
  if (typeof WorkerGlobalScope !== "undefined" && root instanceof WorkerGlobalScope) {
    root.onmessage = ({ data }) => {
      try { root.postMessage({ id: data.id, result: api.planResets(data.input) }); }
      catch (_) { root.postMessage({ id: data.id, error: "重置规划计算失败" }); }
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createResetPlanner(optimizer) {
  "use strict";

  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  const EPSILON = 1e-7;
  const MAX_CREDITS = 24;
  const MAX_DAYS = 60;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function inventory(payload, policy, now) {
    const items = (Array.isArray(payload?.credits) ? payload.credits : [])
      .filter((credit) => credit?.status === "available")
      .map((credit, index) => ({
        ordinal: index + 1,
        title: String(credit.title || "Reset"),
        expiresAt: finite(credit.expires_at_ms) ?? Date.parse(credit.expires_at),
      }));
    const eligible = items.filter((credit) => Number.isFinite(credit.expiresAt) && credit.expiresAt > now
      && (!policy?.creditTitles?.length || policy.creditTitles.includes(credit.title)));
    eligible.sort((left, right) => left.expiresAt - right.expiresAt || left.ordinal - right.ordinal);
    const reported = finite(payload?.available_count);
    return {
      availableCount: reported,
      credits: eligible.slice(0, MAX_CREDITS),
      excludedCount: Math.max(0, (reported ?? items.length) - Math.min(eligible.length, MAX_CREDITS)),
      countMismatch: reported === null || reported < 0 || !Number.isInteger(reported) || reported !== items.length,
    };
  }

  function advance(state, start, end, ratePerMs, period) {
    let remaining = state.remaining;
    let nextReset = state.nextReset;
    let served = state.served;
    let time = start;
    while (time < end - 0.1) {
      if (nextReset <= time + 0.1) {
        remaining = 100;
        nextReset += period;
      }
      const boundary = Math.min(end, nextReset);
      const demand = (boundary - time) * ratePerMs;
      const accepted = Math.min(remaining, demand);
      remaining = Math.max(0, remaining - accepted);
      served += accepted;
      time = boundary;
    }
    if (nextReset <= end + 0.1) {
      remaining = 100;
      nextReset += period;
    }
    return { ...state, remaining, nextReset, served };
  }

  function better(left, right) {
    if (!right) return true;
    if (Math.abs(left.served - right.served) > EPSILON) return left.served > right.served;
    if (left.used !== right.used) return left.used < right.used;
    return left.discarded < right.discarded - EPSILON;
  }

  function actionsOf(state) {
    const actions = [];
    for (let link = state.lastAction; link; link = link.previous) actions.push(link.action);
    return actions.reverse();
  }

  // Search a bounded set of half-hour schedules, retaining distinct expiry/cycle states.
  // Percent is continuous; bucket rounding only prunes candidates, never changes usage.
  function optimizeBeamSchedule({ now, end, remaining, resetAt, period, percentPerDay, credits, cycleMode,
    stepMs = HOUR / 2, beamWidth = 32, maxDiscardPercent = 100, requireAllCredits = false }) {
    const ratePerMs = percentPerDay / DAY;
    const initial = { remaining, nextReset: resetAt, served: 0, creditIndex: 0, used: 0,
      discarded: 0, lastAction: null };
    const baseline = advance(initial, now, end, ratePerMs, period);
    const times = new Set([now, end]);
    for (let time = now + stepMs; time < end; time += stepMs) times.add(time);
    for (let time = resetAt; time < end; time += period) if (time > now) times.add(time);
    for (const credit of credits) {
      // Keep an hour for the user to act. Expiry inside that margin remains actionable now.
      const deadline = Math.max(now, credit.expiresAt - HOUR);
      if (deadline < end) times.add(deadline);
    }
    const grid = [...times].sort((left, right) => left - right);
    let states = [initial];
    let operations = 0;
    for (let index = 0; index < grid.length - 1; index += 1) {
      const time = grid[index];
      const nextTime = grid[index + 1];
      const groups = new Map();
      const retain = (state) => {
        const advanced = advance(state, time, nextTime, ratePerMs, period);
        const group = groups.get(advanced.creditIndex) || new Map();
        const key = `${Math.round((advanced.nextReset - now) / HOUR)}:${Math.floor(advanced.remaining)}`;
        const previous = group.get(key);
        if (better(advanced, previous)) group.set(key, advanced);
        groups.set(advanced.creditIndex, group);
        operations += 1;
      };
      for (const original of states) {
        let creditIndex = original.creditIndex;
        while (creditIndex < credits.length && time > Math.max(now, credits[creditIndex].expiresAt - HOUR)) {
          creditIndex += 1;
        }
        if (requireAllCredits && creditIndex !== original.creditIndex) continue;
        const state = { ...original, creditIndex };
        retain(state);
        const credit = credits[creditIndex];
        if (!credit || time >= credit.expiresAt || state.remaining >= 100 - EPSILON
          || state.remaining > maxDiscardPercent + EPSILON) continue;
        retain({ ...state, remaining: 100, creditIndex: creditIndex + 1, used: state.used + 1,
          nextReset: cycleMode === "restart" ? time + period : state.nextReset,
          discarded: state.discarded + state.remaining,
          lastAction: { previous: state.lastAction, action: {
            ordinal: credit.ordinal, title: credit.title, expiresAt: credit.expiresAt, at: time,
            discardedPercent: state.remaining, restoredPercent: 100 - state.remaining,
            nextResetAt: cycleMode === "restart" ? time + period : state.nextReset,
          } },
        });
      }
      states = [...groups.values()].flatMap((group) => [...group.values()]
        .sort((a, b) => (b.served + b.remaining) - (a.served + a.remaining)
          || b.served - a.served || a.used - b.used)
        .slice(0, beamWidth));
    }
    // Normal planning keeps the baseline; the optional workload search must use every credit.
    const candidates = requireAllCredits ? states.filter((state) => state.used === credits.length) : states;
    const best = candidates.reduce((result, state) => better(state, result) ? state : result,
      requireAllCredits ? null : baseline);
    const outcome = best || baseline;
    return {
      cycleMode, feasible: Boolean(best), baselinePercent: baseline.served, servedPercent: outcome.served,
      gainPercent: Math.max(0, outcome.served - baseline.served),
      demandPercent: (end - now) * ratePerMs, discardedPercent: outcome.discarded,
      actions: actionsOf(outcome), operations, stepMs,
    };
  }

  const optimizeSchedule = (input) => optimizer.solve(input);

  function planResets(input) {
    const now = finite(input.now) ?? Date.now();
    const policy = input.policy || {};
    const stock = inventory(input.credits, policy, now);
    const base = { now, ...stock, status: "unavailable", scenarios: [] };
    if (!input.credits?.ok) return { ...base, reason: "credits-unavailable" };
    if (stock.countMismatch) return { ...base, reason: "credit-count-mismatch" };
    if (!stock.availableCount) return { ...base, status: "empty", reason: "no-credits" };
    if (!stock.credits.length) return { ...base, reason: "no-dated-credits" };
    const remaining = finite(input.remainingPercent);
    const resetAt = Date.parse(input.resetAt);
    const period = finite(input.windowDurationMins) * 60000;
    if (remaining === null || remaining < 0 || remaining > 100 || !Number.isFinite(resetAt)
      || resetAt <= now || period < 7 * DAY || period > 32 * DAY) {
      return { ...base, reason: "quota-unavailable" };
    }
    const fetchedAt = Date.parse(input.fetchedAt);
    if (!Number.isFinite(fetchedAt) || now - fetchedAt > 6 * HOUR || fetchedAt > now + HOUR) {
      return { ...base, reason: "stale-quota" };
    }
    if (input.usageFetchedAt !== undefined) {
      const usageFetchedAt = Date.parse(input.usageFetchedAt);
      if (!Number.isFinite(usageFetchedAt) || now - usageFetchedAt > 6 * HOUR
        || Math.abs(usageFetchedAt - fetchedAt) > HOUR) return { ...base, reason: "stale-usage" };
    }
    const dailyTokens = finite(input.dailyTokens);
    const percentPerDay = finite(input.percentPerDay);
    if (!(dailyTokens > 0)) return { ...base, status: "sampling", reason: "no-recent-usage" };
    if (input.calibration && input.calibration.ready !== true) {
      return { ...base, status: "sampling", reason: input.calibration.reason || "model-calibrating" };
    }
    if (!(percentPerDay > 0) || (finite(input.intervalCount) ?? 0) < 2) {
      return { ...base, status: "sampling", reason: "insufficient-fit" };
    }
    const fitQuality = finite(input.rSquared);
    if (fitQuality === null || fitQuality < 0.3) return { ...base, status: "sampling", reason: "weak-fit" };
    if (!new Set(["restart", "fixed", "unknown"]).has(policy.cycleMode)) {
      return { ...base, reason: "unknown-reset-scope" };
    }

    const lastExpiry = stock.credits.at(-1).expiresAt;
    const end = Math.min(now + MAX_DAYS * DAY, lastExpiry + period);
    const credits = stock.credits.filter((credit) => credit.expiresAt - HOUR < end);
    const tokensPerPercent = dailyTokens / percentPerDay;
    const equivalentDailyTokens = finite(input.equivalentDailyTokens);
    const equivalentTokensPerPercent = equivalentDailyTokens > 0 ? equivalentDailyTokens / percentPerDay : null;
    // Token projections are display-only. The optimizer and policy comparison use quota points.
    const projectTokens = (result) => ({ ...result,
      baselineTokens: result.baselinePercent * tokensPerPercent,
      servedTokens: result.servedPercent * tokensPerPercent,
      gainTokens: result.gainPercent * tokensPerPercent,
      gainEquivalentTokens: equivalentTokensPerPercent === null ? null : result.gainPercent * equivalentTokensPerPercent,
    });
    const modes = policy.cycleMode === "unknown" ? ["restart", "fixed"] : [policy.cycleMode];
    const scenarios = [0.7, 1, 1.3].map((factor) => {
      const alternatives = modes.map((cycleMode) => {
        const result = optimizeSchedule({ now, end, remaining, resetAt, period,
          percentPerDay: percentPerDay * factor, credits, cycleMode });
        return projectTokens(result);
      });
      const conservative = alternatives.reduce((a, b) => a.gainPercent <= b.gainPercent ? a : b);
      return { factor, percentPerDay: percentPerDay * factor, dailyTokens: dailyTokens * factor, ...conservative, alternatives };
    });
    const urgentPlans = remaining <= percentPerDay ? modes.map((cycleMode) => {
      const urgent = optimizeSchedule({ now, end, remaining, resetAt, period, percentPerDay,
        credits, cycleMode, objective: "urgent-24h" });
      const regular = scenarios[1].alternatives.find((entry) => entry.cycleMode === cycleMode);
      return { ...urgent,
        extraTodayPercent: Math.max(0, urgent.urgentPercent - urgent.baselineUrgentPercent),
        versusRegularTodayPercent: Math.max(0, urgent.urgentPercent - regular.urgentPercent),
        horizonTradeoffPercent: Math.max(0, regular.servedPercent - urgent.servedPercent),
        extraTodayTokens: Math.max(0, urgent.urgentPercent - urgent.baselineUrgentPercent) * tokensPerPercent,
        versusRegularTodayTokens: Math.max(0, urgent.urgentPercent - regular.urgentPercent) * tokensPerPercent,
        horizonTradeoffTokens: Math.max(0, regular.servedPercent - urgent.servedPercent) * tokensPerPercent };
    }) : [];
    const stress = optimizer.stressTest({ now, end, remaining, resetAt, period, percentPerDay, credits,
      cycleMode: scenarios[1].cycleMode }, scenarios[1].actions, input.recentDailyTokens);
    const fullUseAtRate = (factor) => modes.map((cycleMode) => optimizeSchedule({
      now, end, remaining, resetAt, period, percentPerDay: percentPerDay * factor, credits, cycleMode,
      maxDiscardPercent: 5, requireAllCredits: true,
    }));
    const usesStock = (plans) => plans.every((plan) => plan.feasible && plan.actions.length === credits.length
      && plan.gainPercent > EPSILON && plan.actions.every((action) => action.discardedPercent <= 5));
    let target = null;
    if (credits.length && !usesStock(scenarios[1].alternatives)) {
      let low = 1;
      let high = 2;
      let plans;
      while (high <= 8) {
        plans = fullUseAtRate(high);
        if (usesStock(plans)) break;
        low = high;
        high *= 2;
      }
      if (high <= 8) {
        // A reference workload, not a proof of the global minimum required pace.
        for (let iteration = 0; iteration < 6; iteration += 1) {
          const middle = (low + high) / 2;
          const candidate = fullUseAtRate(middle);
          if (usesStock(candidate)) { high = middle; plans = candidate; }
          else low = middle;
        }
        target = { factor: high, percentPerDay: percentPerDay * high, dailyTokens: dailyTokens * high,
          alternatives: plans.map(projectTokens) };
      }
    }
    return {
      ...base, status: "ready", reason: null, end, resetAt, remainingPercent: remaining,
      percentPerDay, dailyTokens, tokensPerPercent, fitQuality, intervalCount: input.intervalCount,
      benefitUnit: "quota-percentage-points", equivalentDailyTokens, equivalentTokensPerPercent,
      period, scenarios, plan: scenarios[1], policyUncertain: modes.length > 1,
      target,
      urgentPlans,
      stress,
      truncated: end < lastExpiry + period || stock.excludedCount > 0,
      deferredCount: stock.credits.length - credits.length,
    };
  }

  return { inventory, advance, optimizeSchedule, optimizeBeamSchedule, planResets };
});
