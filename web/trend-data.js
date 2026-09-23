(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TrendData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DAY = 86400000;
  function stamp(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return NaN;
    const time = Date.parse(`${key}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key ? time : NaN;
  }
  const key = (time) => new Date(time).toISOString().slice(0, 10);
  function select(days, settings, today) {
    const records = new Map();
    for (const day of days) {
      if (!Number.isFinite(stamp(day.date))) continue;
      const previous = records.get(day.date);
      records.set(day.date, { ...day, totalTokens: (previous?.totalTokens || 0) + (Number(day.totalTokens) || 0),
        costUSD: (previous?.costUSD || 0) + (Number(day.costUSD) || 0), recorded: true });
    }
    const dates = [...records.keys()].sort();
    let end = stamp(today);
    let start;
    if (settings.range === "custom") {
      start = stamp(settings.start);
      end = stamp(settings.end);
    } else if (settings.range === "all") {
      start = dates.length ? stamp(dates[0]) : end;
      if (dates.length) end = Math.max(end, stamp(dates.at(-1)));
    } else {
      const count = [30, 90, 180, 365].includes(Number(settings.range)) ? Number(settings.range) : 30;
      start = end - (count - 1) * DAY;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: "请选择有效的开始和结束日期" };
    if (start > end) return { error: "开始日期不能晚于结束日期" };
    if ((end - start) / DAY > 36600) return { error: "时间范围不能超过 100 年" };
    const rows = [];
    for (let time = start; time <= end; time += DAY) {
      const date = key(time);
      rows.push(records.get(date) || { date, totalTokens: null, costUSD: null, recorded: false });
    }
    const max = Math.max(1, ...rows.map((row) => row.totalTokens || 0));
    return { start: key(start), end: key(end), rows, max,
      offset: (new Date(start).getUTCDay() + 6) % 7,
      total: rows.reduce((sum, row) => sum + (row.totalTokens || 0), 0),
      recordedDays: rows.filter((row) => row.recorded).length };
  }
  function level(value, max) {
    if (value === null) return "missing";
    if (!(value > 0)) return "0";
    return String(Math.min(4, Math.max(1, Math.ceil(value / max * 4))));
  }
  return { select, level };
});
