(function attachCalendarHeatmap(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CalendarHeatmap = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCalendarHeatmap() {
  "use strict";

  const DAY_MS = 86_400_000;
  const MONTHS = new Map(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
      (month, index) => [month, index]
    )
  );

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dateKey(date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  function parseDate(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    }

    const text = String(value ?? "").trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      const parsed = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    const named = text.match(/^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})$/);
    if (named && MONTHS.has(named[1])) {
      return new Date(Date.UTC(Number(named[3]), MONTHS.get(named[1]), Number(named[2])));
    }

    const parsed = new Date(text);
    if (!Number.isFinite(parsed.getTime())) return null;
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }

  function normalizeDateKey(value) {
    const parsed = parseDate(value);
    return parsed ? dateKey(parsed) : null;
  }

  function addDays(date, amount) {
    return new Date(date.getTime() + Number(amount || 0) * DAY_MS);
  }

  function startOfWeek(date) {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    return addDays(date, -mondayOffset);
  }

  function daysBetween(start, end) {
    return Math.round((end.getTime() - start.getTime()) / DAY_MS);
  }

  function quantile(sortedValues, position) {
    if (!sortedValues.length) return 0;
    if (sortedValues.length === 1) return sortedValues[0];
    const index = (sortedValues.length - 1) * position;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  function thresholdsFor(values) {
    const sorted = values
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (!sorted.length) return [0, 0, 0];
    return [quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75)];
  }

  function levelFor(value, thresholds) {
    const tokens = Number(value) || 0;
    if (tokens <= 0) return 0;
    if (thresholds[0] === thresholds[2]) return 3;
    if (tokens <= thresholds[0]) return 1;
    if (tokens <= thresholds[1]) return 2;
    if (tokens <= thresholds[2]) return 3;
    return 4;
  }

  function buildCalendarHeatmap(days, options = {}) {
    const dailyTotals = new Map();
    for (const day of Array.isArray(days) ? days : []) {
      const key = normalizeDateKey(day?.date ?? day?.period);
      if (!key) continue;
      const tokens = Math.max(0, Number(day?.totalTokens) || 0);
      dailyTotals.set(key, (dailyTotals.get(key) || 0) + tokens);
    }

    const availableDates = [...dailyTotals.keys()].sort();
    if (!availableDates.length) {
      return {
        activeDays: 0,
        cells: [],
        maxTokens: 0,
        months: [],
        rangeEnd: null,
        rangeStart: null,
        thresholds: [0, 0, 0],
        totalTokens: 0,
        weekCount: 0,
      };
    }

    const minWeeks = Math.max(1, Math.floor(Number(options.minWeeks) || 13));
    const maxWeeks = Math.max(minWeeks, Math.floor(Number(options.maxWeeks) || 53));
    const earliestDate = parseDate(availableDates[0]);
    const latestDate = parseDate(availableDates.at(-1));
    const today = parseDate(options.today) || parseDate(new Date());
    const rangeEndDate = latestDate > today ? latestDate : today;
    const endWeekStart = startOfWeek(rangeEndDate);
    const earliestWeekStart = startOfWeek(earliestDate);
    const cappedWeekStart = addDays(endWeekStart, -(maxWeeks - 1) * 7);
    const minimumWeekStart = addDays(endWeekStart, -(minWeeks - 1) * 7);
    const naturalStart = earliestWeekStart < cappedWeekStart ? cappedWeekStart : earliestWeekStart;
    const rangeStartDate = naturalStart > minimumWeekStart ? minimumWeekStart : naturalStart;
    const weekCount = Math.floor(daysBetween(rangeStartDate, endWeekStart) / 7) + 1;
    const rangeEndKey = dateKey(rangeEndDate);
    const positiveValues = [...dailyTotals.entries()]
      .filter(([key, value]) => key >= dateKey(rangeStartDate) && key <= rangeEndKey && value > 0)
      .map(([, value]) => value);
    const thresholds = thresholdsFor(positiveValues);
    const cells = [];

    for (let index = 0; index < weekCount * 7; index += 1) {
      const current = addDays(rangeStartDate, index);
      const key = dateKey(current);
      const outside = current > rangeEndDate;
      const totalTokens = outside ? 0 : dailyTotals.get(key) || 0;
      cells.push({
        date: key,
        dayOfWeek: current.getUTCDay(),
        level: outside ? 0 : levelFor(totalTokens, thresholds),
        outside,
        totalTokens,
        week: Math.floor(index / 7),
      });
    }

    const months = [];
    const firstMonth = `${cells[0].date.slice(0, 7)}`;
    months.push({
      column: 1,
      label: `${Number(firstMonth.slice(5, 7))}月`,
      month: firstMonth,
    });
    for (let index = 1; index < cells.length; index += 1) {
      const cell = cells[index];
      if (cell.outside || !cell.date.endsWith("-01")) continue;
      const month = cell.date.slice(0, 7);
      if (months.some((entry) => entry.month === month)) continue;
      months.push({
        column: cell.week + 1,
        label: `${Number(month.slice(5, 7))}月`,
        month,
      });
    }

    return {
      activeDays: cells.filter((cell) => !cell.outside && cell.totalTokens > 0).length,
      cells,
      maxTokens: Math.max(0, ...positiveValues),
      months,
      rangeEnd: rangeEndKey,
      rangeStart: dateKey(rangeStartDate),
      thresholds,
      totalTokens: cells.reduce((sum, cell) => sum + cell.totalTokens, 0),
      weekCount,
    };
  }

  return {
    buildCalendarHeatmap,
    levelFor,
    normalizeDateKey,
    thresholdsFor,
  };
});
