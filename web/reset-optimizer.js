(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ResetOptimizer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createOptimizer() {
  "use strict";
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  const EPS = 1e-7;

  function demandCurve({ now, end, percentPerDay, demandProfile }) {
    if (!demandProfile) return (time) => Math.max(0, Math.min(end, time) - now) * percentPerDay / DAY;
    const parts = [];
    let start = now;
    let sum = 0;
    for (const part of demandProfile) {
      if (!Number.isFinite(part.until) || part.until <= start || !Number.isFinite(part.percentPerDay)
        || part.percentPerDay < 0) throw new Error("Invalid demand profile");
      parts.push({ start, end: part.until, sum, rate: part.percentPerDay / DAY });
      sum += (part.until - start) * part.percentPerDay / DAY;
      start = part.until;
    }
    if (start < end) throw new Error("Demand profile does not cover the horizon");
    return (time) => {
      if (time <= now) return 0;
      time = Math.min(time, end);
      let lo = 0;
      let hi = parts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (parts[mid].end < time) lo = mid + 1;
        else hi = mid;
      }
      const part = parts[lo];
      return part.sum + (time - part.start) * part.rate;
    };
  }

  function dynamics(input) {
    const { now, resetAt, period, cycleMode, percentPerDay } = input;
    const demand = demandCurve(input);
    const rate = percentPerDay / DAY;
    const nextNatural = (time) => time < resetAt ? resetAt
      : resetAt + (Math.floor((time - resetAt) / period) + 1) * period;
    const afterReset = (time) => cycleMode === "restart" ? time + period : nextNatural(time);
    const served = (start, end, balance, nextReset) => {
      if (end <= start) return 0;
      if (!input.demandProfile) {
        if (end < nextReset) return Math.min(balance, (end - start) * rate);
        const cycles = Math.floor((end - nextReset) / period);
        return Math.min(balance, (nextReset - start) * rate) + cycles * Math.min(100, period * rate)
          + Math.min(100, (end - nextReset - cycles * period) * rate);
      }
      let total = 0;
      while (nextReset < end) {
        total += Math.min(balance, demand(nextReset) - demand(start));
        balance = 100;
        start = nextReset;
        nextReset += period;
      }
      return total + Math.min(balance, demand(end) - demand(start));
    };
    const balanceAt = (start, end, balance, nextReset) => {
      if (end >= nextReset) {
        start = nextReset + Math.floor((end - nextReset) / period) * period;
        balance = 100;
      }
      return Math.max(0, balance - (demand(end) - demand(start)));
    };
    return { demand, served, balanceAt, afterReset, nextNatural };
  }

  function planningGrid(input) {
    const { now, end, period, resetAt, credits } = input;
    let stepMs = input.stepMs || HOUR / 2;
    // Coarsen time, never prune states. The certificate always reports the actual grid.
    const maxTransitions = input.maxTransitions ?? 12_000_000;
    while (stepMs < end - now
      && credits.length * ((end - now) / stepMs + credits.length + 3) ** 2 / 2 > maxTransitions) stepMs *= 2;
    const times = new Set([now, end]);
    for (let time = now + stepMs; time < end; time += stepMs) times.add(time);
    for (let time = resetAt; time < end; time += period) if (time > now) times.add(time);
    for (const credit of credits) {
      const deadline = Math.max(now, credit.expiresAt - HOUR);
      if (deadline < end) times.add(deadline);
    }
    for (const part of input.demandProfile || []) if (part.until > now && part.until < end) times.add(part.until);
    if (now + DAY < end) times.add(now + DAY);
    return { times: [...times].sort((a, b) => a - b), stepMs };
  }

  function preferable(a, b, urgent) {
    if (!b) return true;
    if (urgent && Math.abs(a.urgent - b.urgent) > EPS) return a.urgent > b.urgent;
    if (Math.abs(a.served - b.served) > EPS) return a.served > b.served;
    return a.used !== b.used ? a.used < b.used : a.discarded < b.discarded - EPS;
  }

  function solve(input) {
    const { now, end, remaining, resetAt, period, cycleMode, credits, requireAllCredits = false,
      maxDiscardPercent = 100, objective = "total" } = input;
    if (![now, end, remaining, resetAt, period, input.percentPerDay].every(Number.isFinite)
      || !(end > now && period > 0 && resetAt > now) || remaining < 0 || remaining > 100
      || input.percentPerDay < 0 || !["fixed", "restart"].includes(cycleMode)) throw new Error("Invalid reset model");
    if (credits.some((credit, i) => !Number.isFinite(credit.expiresAt)
      || (i > 0 && credit.expiresAt < credits[i - 1].expiresAt))) throw new Error("Credits must be sorted by expiry");
    const flow = dynamics(input);
    const urgentEnd = Math.min(end, now + DAY);
    const urgent = objective === "urgent-24h";
    const baseline = { served: flow.served(now, end, remaining, resetAt),
      urgent: flow.served(now, urgentEnd, remaining, resetAt), used: 0, discarded: 0, path: null };
    const demandPercent = flow.demand(end);
    // Conservation bound: discard/expiry can only reduce this relaxed supply budget.
    const naturalCount = cycleMode === "fixed"
      ? Math.max(0, Math.ceil((end - resetAt) / period)) : Math.ceil((end - now) / period);
    const upper = Math.min(demandPercent, remaining + 100 * (credits.length + naturalCount));
    const finish = (best, grid, operations, analytic = false) => {
      const result = best || baseline;
      const actions = [];
      for (let link = result.path; link; link = link.previous) actions.push(link.action);
      actions.reverse();
      return { cycleMode, feasible: Boolean(best), objective, actions, stepMs: grid.stepMs,
        baselinePercent: baseline.served, servedPercent: result.served,
        gainPercent: Math.max(0, result.served - baseline.served), demandPercent,
        urgentPercent: result.urgent, baselineUrgentPercent: baseline.urgent,
        discardedPercent: result.discarded, operations,
        certificate: { method: analytic ? "demand-bound" : "exact-dp", scope: "time-grid",
          gridPoints: grid.times.length, stepMs: grid.stepMs, objective,
          continuousUpperPercent: upper, continuousGapPercent: Math.max(0, upper - result.served),
          gridOptimal: Boolean(best), continuousOptimal: Boolean(best) && upper - result.served <= EPS },
      };
    };
    const grid = planningGrid(input);
    if (!requireAllCredits && demandPercent - baseline.served <= EPS) return finish(baseline, grid, 0, true);
    const { times } = grid;
    const n = times.length - 1;
    const initialServed = times.map((time) => flow.served(now, time, remaining, resetAt));
    const initialUrgent = times.map((time) => flow.served(now, Math.min(time, urgentEnd), remaining, resetAt));
    const initialBalance = times.map((time) => flow.balanceAt(now, time, remaining, resetAt));
    const nextResets = times.map(flow.afterReset);
    const urgentTail = times.map((time, i) => flow.served(time, urgentEnd, 100, nextResets[i]));
    let previous = Array(n).fill(null);
    let operations = 0;
    for (let i = 0; i < credits.length; i += 1) {
      const credit = credits[i];
      const deadline = Math.max(now, credit.expiresAt - HOUR);
      const current = requireAllCredits ? Array(n).fill(null) : previous.slice();
      for (let j = 0; j < n && times[j] <= deadline && times[j] < credit.expiresAt; j += 1) {
        let best = current[j];
        let bestPrevious = null;
        let bestWaste = 0;
        const consider = (candidate, waste, path) => {
          if (waste >= 100 - EPS || waste > maxDiscardPercent + EPS || !preferable(candidate, best, urgent)) return;
          best = candidate;
          bestPrevious = path;
          bestWaste = waste;
        };
        if (!requireAllCredits || i === 0) {
          consider({ served: initialServed[j], urgent: initialUrgent[j], used: 1,
            discarded: initialBalance[j] }, initialBalance[j], null);
        }
        for (let s = 0; s < j; s += 1) {
          const prev = previous[s];
          if (!prev) continue;
          operations += 1;
          const reward = flow.served(times[s], times[j], 100, nextResets[s]);
          const candidate = { served: prev.served + reward,
            urgent: prev.urgent + (times[j] <= urgentEnd ? reward : urgentTail[s]),
            used: prev.used + 1, discarded: prev.discarded };
          // Balance is only needed for contenders or an explicit low-waste constraint.
          if (maxDiscardPercent >= 100 && best && (urgent && candidate.urgent < best.urgent - EPS
            || (!urgent || Math.abs(candidate.urgent - best.urgent) <= EPS) && candidate.served < best.served - EPS)) continue;
          const waste = flow.balanceAt(times[s], times[j], 100, nextResets[s]);
          candidate.discarded += waste;
          consider(candidate, waste, prev.path);
        }
        if (best && best !== current[j]) {
          best.path = { previous: bestPrevious, action: {
            ordinal: credit.ordinal, title: credit.title, expiresAt: credit.expiresAt, at: times[j],
            discardedPercent: bestWaste, restoredPercent: 100 - bestWaste, nextResetAt: nextResets[j],
          } };
          current[j] = best;
        }
      }
      previous = current;
    }
    let best = requireAllCredits && credits.length ? null : baseline;
    for (let j = 0; j < n; j += 1) {
      if (!previous[j]) continue;
      const candidate = { ...previous[j],
        served: previous[j].served + flow.served(times[j], end, 100, nextResets[j]),
        urgent: previous[j].urgent + urgentTail[j] };
      if (preferable(candidate, best, urgent)) best = candidate;
    }
    return finish(best, grid, operations);
  }

  function simulate(input, actions) {
    const flow = dynamics(input);
    const cutoff = Math.min(input.end, input.now + DAY);
    let time = input.now;
    let remaining = input.remaining;
    let nextReset = input.resetAt;
    let served = 0;
    let urgent = 0;
    let skipped = 0;
    for (const action of [...actions, { at: input.end, terminal: true }]) {
      if (action.at < time || action.at > input.end) throw new Error("Invalid action order");
      served += flow.served(time, action.at, remaining, nextReset);
      urgent += flow.served(time, Math.min(action.at, cutoff), remaining, nextReset);
      remaining = flow.balanceAt(time, action.at, remaining, nextReset);
      time = action.at;
      if (nextReset <= time) nextReset += (Math.floor((time - nextReset) / input.period) + 1) * input.period;
      if (action.terminal) break;
      if (action.at >= action.expiresAt) throw new Error("Expired action");
      if (remaining >= 100 - EPS) { skipped += 1; continue; }
      remaining = 100;
      nextReset = flow.afterReset(time);
    }
    return { servedPercent: served, urgentPercent: urgent, skipped };
  }

  function simulateReactive(input) {
    const parts = input.demandProfile || [{ until: input.end, percentPerDay: input.percentPerDay }];
    const credits = input.credits;
    let time = input.now;
    let balance = input.remaining;
    let natural = input.resetAt;
    let partIndex = 0;
    let creditIndex = 0;
    let served = 0;
    const actions = [];
    while (time < input.end) {
      if (natural <= time + 0.01) { balance = 100; natural += input.period; }
      while (parts[partIndex].until <= time && partIndex < parts.length - 1) partIndex += 1;
      const rate = parts[partIndex].percentPerDay / DAY;
      while (creditIndex < credits.length && (time >= credits[creditIndex].expiresAt
        || time > Math.max(input.now, credits[creditIndex].expiresAt - HOUR))) creditIndex += 1;
      // Only current exhaustion/current work is observable; no future profile is consulted.
      if (balance <= EPS && rate > 0 && creditIndex < credits.length) {
        const credit = credits[creditIndex++];
        balance = 100;
        if (input.cycleMode === "restart") natural = time + input.period;
        actions.push({ at: time, ordinal: credit.ordinal });
      }
      const exhaustion = balance > EPS && rate > 0 ? time + balance / rate : Infinity;
      const next = Math.min(input.end, parts[partIndex].until, natural, exhaustion);
      const accepted = Math.min(balance, (next - time) * rate);
      served += accepted;
      balance = Math.max(0, balance - accepted);
      time = next;
    }
    return { servedPercent: served, actions };
  }

  // Historical daily blocks retain short runs of high/low days. Intraday bursts are assumptions.
  function stressTest(input, actions, history) {
    const values = (history || []).filter((value) => Number.isFinite(value) && value >= 0).slice(-28);
    if (values.length < 14 || values.filter((value) => value > 0).length < 4) return { ready: false, sampleDays: values.length };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const cases = [];
    for (let sample = 0; sample < 8; sample += 1) {
      const burst = sample >= 4;
      let seed = sample + 17;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const profile = [];
      let source = 0;
      for (let day = 0, time = input.now; time < input.end; day += 1, time += DAY) {
        if (day % 3 === 0) source = Math.floor(random() * (values.length - 2));
        const rate = input.percentPerDay * values[source + day % 3] / mean;
        if (burst) profile.push({ until: Math.min(time + 6 * HOUR, input.end), percentPerDay: rate * 4 });
        if (!burst || time + 6 * HOUR < input.end) profile.push({ until: Math.min(time + DAY, input.end), percentPerDay: burst ? 0 : rate });
      }
      const scenario = { ...input, demandProfile: profile };
      const baseline = simulate(scenario, []);
      const result = simulate(scenario, actions);
      const reactive = simulateReactive(scenario);
      cases.push({ burst, gainPercent: result.servedPercent - baseline.servedPercent,
        urgentGainPercent: result.urgentPercent - baseline.urgentPercent, skipped: result.skipped,
        unservedPercent: Math.max(0, demandCurve(scenario)(input.end) - result.servedPercent),
        reactiveAdvantagePercent: reactive.servedPercent - result.servedPercent });
    }
    return { ready: true, sampleDays: values.length, cases,
      minGainPercent: Math.min(...cases.map((entry) => entry.gainPercent)),
      maxGainPercent: Math.max(...cases.map((entry) => entry.gainPercent)),
      meanGainPercent: cases.reduce((sum, entry) => sum + entry.gainPercent, 0) / cases.length,
      meanUnservedPercent: cases.reduce((sum, entry) => sum + entry.unservedPercent, 0) / cases.length,
      meanReactiveAdvantagePercent: cases.reduce((sum, entry) => sum + entry.reactiveAdvantagePercent, 0) / cases.length,
      reactiveWorseCases: cases.filter((entry) => entry.reactiveAdvantagePercent < -EPS).length,
      negativeCases: cases.filter((entry) => entry.gainPercent < -EPS).length };
  }

  return { dynamics, planningGrid, solve, simulate, simulateReactive, stressTest };
});
