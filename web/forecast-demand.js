(function attachForecastDemand(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ForecastDemand = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createForecastDemand() {
  "use strict";
  const HOUR = 3600000;
  const MAX_GAP = 6 * HOUR;
  const number = (value) => value === null || value === undefined || value === "" ? null
    : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const timestamp = (value) => value ? Date.parse(value) : NaN;
  const dateKey = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  function dayStart(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return NaN;
    const [year, month, day] = key.split("-").map(Number);
    const value = new Date(year, month - 1, day).getTime();
    return dateKey(value) === key ? value : NaN;
  }
  function shiftDay(key, count) {
    const date = new Date(dayStart(key));
    date.setDate(date.getDate() + count);
    return dateKey(date);
  }
  const sameCycle = (a, b) => Math.abs(a.reset - b.reset) <= 5 * 60000
    && (a.segment == null || b.segment == null || String(a.segment) === String(b.segment));
  const fresh = (point) => Number.isFinite(point.usageAt) && Math.abs(point.time - point.usageAt) <= HOUR;

  function restrictionEvidence(observations, windowName, asOf, currentUsage) {
    const points = [...new Map((observations || []).filter((point) => point.windowName === windowName)
      .map((point) => ({ time: timestamp(point.fetchedAt), reset: timestamp(point.resetAt),
        usageAt: timestamp(point.usageFetchedAt), used: number(point.usedPercent),
        total: number(point.totalTokens), measured: number(Object.hasOwn(point, "demandTokens") ? point.demandTokens : point.totalTokens),
        segment: point.segment }))
      .filter((point) => Number.isFinite(point.time) && point.time <= asOf && point.used !== null && point.used <= 100)
      .map((point) => [point.time, point])).values()].sort((a, b) => a.time - b.time);
    let cycle = 0;
    points.forEach((point, index) => {
      const prior = points[index - 1];
      if (prior && (!sameCycle(prior, point) || point.used + 0.5 < prior.used
        || (point.total !== null && prior.total !== null && point.total < prior.total))) cycle += 1;
      point.cycle = cycle;
    });
    // Full-looking pools can still serve traffic (rounding, overage, shared products).
    // In that case absence of traffic is not evidence that this pool blocked work.
    const nonBinding = new Set();
    points.forEach((point, index) => {
      const prior = points[index - 1];
      if (prior?.used === 100 && point.used === 100 && prior.cycle === point.cycle
        && fresh(prior) && fresh(point) && prior.total !== null && point.total > prior.total) nonBinding.add(point.cycle);
    });
    const intervals = [];
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      if (a.used !== 100 || !(a.reset > a.time) || nonBinding.has(a.cycle)) continue;
      const b = points[index + 1];
      const end = Math.min(b?.time ?? asOf, a.reset, asOf);
      if (end <= a.time) continue;
      const interval = { start: a.time, end, kind: "unknown", removedTokens: null };
      const same = b && a.cycle === b.cycle && sameCycle(a, b);
      if (end - a.time <= MAX_GAP && fresh(a) && a.total !== null) {
        if (b && b.time === end && fresh(b) && b.total !== null) {
          if (same && b.used === 100 && a.total === b.total) {
            Object.assign(interval, { kind: "empty", removedTokens: 0 });
          } else if (dateKey(a.time) === dateKey(end) && b.total >= a.total
            && a.measured !== null && b.measured !== null && b.measured >= a.measured) {
            Object.assign(interval, { kind: "recovery-gap", removedTokens: b.measured - a.measured });
          }
        } else if (!b && number(currentUsage?.totalTokens) === a.total
          && Math.abs(timestamp(currentUsage?.fetchedAt) - asOf) <= HOUR) {
          Object.assign(interval, { kind: "provisional", removedTokens: 0 });
        }
      }
      intervals.push(interval);
    }
    return { intervals, nonBindingCycles: nonBinding.size };
  }

  function blend(todayRate, threeDayRate, sevenDayRate) {
    const parts = [];
    if (todayRate > 0) parts.push([todayRate, 0.55]);
    if (threeDayRate > 0) parts.push([threeDayRate, todayRate > 0 ? 0.3 : 0.65]);
    if (sevenDayRate > 0) parts.push([sevenDayRate, todayRate > 0 ? 0.15 : 0.35]);
    const weight = parts.reduce((sum, part) => sum + part[1], 0);
    return weight ? parts.reduce((sum, part) => sum + part[0] * part[1], 0) / weight : null;
  }

  function estimate({ days = [], observations = [], windowName, now = Date.now(), usageFetchedAt,
    currentUsage, fallbackDailyTokens } = {}) {
    // Freeze rates at the usage snapshot, not at the time an idle browser redraws.
    const usageTime = timestamp(usageFetchedAt);
    const asOf = Number.isFinite(usageTime) && usageTime <= now ? usageTime : now;
    const today = dateKey(asOf);
    const totals = new Map();
    for (const day of days) {
      const key = String(day?.date ?? day?.period ?? "").slice(0, 10);
      if (Number.isFinite(dayStart(key)) && key <= today) totals.set(key, (totals.get(key) || 0) + (number(day.totalTokens) || 0));
    }
    const first = [...totals.keys()].sort()[0] || today;
    const evidence = restrictionEvidence(observations, windowName, asOf, currentUsage);
    const rows = [];
    for (let key = shiftDay(today, -28); key <= today; key = shiftDay(key, 1)) {
      if (key < first) continue;
      const start = dayStart(key);
      const end = Math.min(asOf, dayStart(shiftDay(key, 1)));
      let removedMs = 0;
      let removedTokens = 0;
      let unknown = false;
      let provisionalMs = 0;
      let recoveryMs = 0;
      for (const interval of evidence.intervals) {
        const overlap = Math.max(0, Math.min(end, interval.end) - Math.max(start, interval.start));
        if (!overlap) continue;
        if (interval.kind === "unknown") { unknown = true; continue; }
        removedMs += overlap;
        if (interval.kind === "provisional") provisionalMs += overlap;
        if (interval.kind === "recovery-gap") {
          recoveryMs += overlap;
          removedTokens += interval.removedTokens;
        }
      }
      const tokens = totals.get(key) || 0;
      const hours = Math.max(0, end - start) / HOUR;
      const availableHours = Math.max(0, hours - removedMs / HOUR);
      if (removedTokens > tokens || (availableHours === 0 && tokens > removedTokens)) unknown = true;
      rows.push({ date: key, tokens, hours, availableHours, unknown,
        knownTokens: Math.max(0, tokens - removedTokens), removedHours: removedMs / HOUR,
        provisionalHours: provisionalMs / HOUR, recoveryHours: recoveryMs / HOUR });
    }
    const windowRows = (count) => rows.filter((row) => row.date >= shiftDay(today, -(count - 1)));
    const summarize = (entries, adjusted, minHours) => {
      const usable = adjusted ? entries.filter((row) => !row.unknown) : entries;
      const tokens = usable.reduce((sum, row) => sum + (adjusted ? row.knownTokens : row.tokens), 0);
      const hours = usable.reduce((sum, row) => sum + (adjusted ? row.availableHours : row.hours), 0);
      // Do not extrapolate a nearly entirely censored window from minutes of exposure.
      return { tokens, hours, rate: tokens > 0 && (!adjusted || hours >= minHours)
        ? tokens * 24 / Math.max(1, hours) : null };
    };
    const one = summarize(windowRows(1), true, 1);
    const three = summarize(windowRows(3), true, 6);
    const seven = summarize(windowRows(7), true, 6);
    const observed = [1, 3, 7].map((count) => summarize(windowRows(count), false, 0));
    const recent = windowRows(7);
    const hasCensoring = recent.some((row) => row.unknown || row.removedHours > 0);
    const observedWeightedRate = blend(...observed.map((entry) => entry.rate));
    let weightedRate = hasCensoring ? blend(one.rate, three.rate, seven.rate) : observedWeightedRate;
    let referenceDays = 0;
    if (weightedRate === null && hasCensoring) {
      const reference = rows.filter((row) => !row.unknown && row.removedHours === 0 && row.date < today);
      const summary = summarize(reference, true, 24);
      if (reference.length >= 3 && summary.rate > 0) {
        weightedRate = summary.rate;
        referenceDays = reference.length;
      }
    }
    const isFallback = weightedRate === null && !hasCensoring && number(fallbackDailyTokens) > 0;
    if (isFallback) weightedRate = number(fallbackDailyTokens);
    return {
      today, asOf, todayUsage: totals.get(today) || 0, elapsedHours: observed[0].hours,
      todayRate: hasCensoring ? one.rate : observed[0].rate,
      threeDayUsage: observed[1].tokens, threeDayRate: hasCensoring ? three.rate : observed[1].rate,
      sevenDayUsage: observed[2].tokens, sevenDayRate: hasCensoring ? seven.rate : observed[2].rate,
      weightedRate, observedWeightedRate, isFallback,
      demand: { ready: !hasCensoring || weightedRate > 0, adjusted: hasCensoring,
        reason: hasCensoring && !(weightedRate > 0) ? "censored-demand-unavailable" : null,
        removedHours: recent.reduce((sum, row) => sum + row.removedHours, 0),
        provisionalHours: recent.reduce((sum, row) => sum + row.provisionalHours, 0),
        recoveryHours: recent.reduce((sum, row) => sum + row.recoveryHours, 0),
        unknownDays: recent.filter((row) => row.unknown).length, referenceDays,
        nonBindingCycles: evidence.nonBindingCycles,
        availableHours: [one.hours, three.hours, seven.hours],
        excludedStressDays: rows.filter((row) => row.date < today && (row.unknown || row.removedHours > 0)).length },
      // Null retains the calendar position; it is not a zero-demand observation.
      stressHistory: rows.filter((row) => row.date < today)
        .map((row) => row.unknown || row.removedHours > 0 ? null : row.tokens),
    };
  }
  return { estimate, restrictionEvidence };
});
