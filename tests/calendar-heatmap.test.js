const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCalendarHeatmap,
  levelFor,
  normalizeDateKey,
  thresholdsFor,
} = require("../web/calendar-heatmap.js");

test("calendar heatmap aligns weeks to Monday and aggregates duplicate dates", () => {
  const model = buildCalendarHeatmap(
    [
      { date: "2026-07-07", totalTokens: 100 },
      { date: "2026-07-08", totalTokens: 1000 },
      { date: "2026-07-08", totalTokens: 500 },
    ],
    { today: "2026-07-15", minWeeks: 2, maxWeeks: 53 }
  );

  assert.equal(model.rangeStart, "2026-07-06");
  assert.equal(model.rangeEnd, "2026-07-15");
  assert.equal(model.weekCount, 2);
  assert.equal(model.cells.length, 14);
  assert.equal(model.totalTokens, 1600);
  assert.equal(model.activeDays, 2);
  assert.equal(model.cells.find((cell) => cell.date === "2026-07-08").totalTokens, 1500);
  assert.equal(model.cells.find((cell) => cell.date === "2026-07-16").outside, true);
});

test("calendar heatmap caps history and emits month labels", () => {
  const model = buildCalendarHeatmap(
    [
      { date: "2024-01-01", totalTokens: 10 },
      { date: "2026-06-01", totalTokens: 20 },
      { date: "2026-07-01", totalTokens: 30 },
    ],
    { today: "2026-07-31", minWeeks: 4, maxWeeks: 8 }
  );

  assert.equal(model.weekCount, 8);
  assert.equal(model.cells.some((cell) => cell.date === "2024-01-01"), false);
  assert.deepEqual(model.months.map((entry) => entry.label), ["6月", "7月"]);
});

test("calendar heat levels use activity quantiles and keep equal values visible", () => {
  const thresholds = thresholdsFor([10, 20, 30, 40]);
  assert.deepEqual(thresholds, [17.5, 25, 32.5]);
  assert.equal(levelFor(0, thresholds), 0);
  assert.equal(levelFor(10, thresholds), 1);
  assert.equal(levelFor(20, thresholds), 2);
  assert.equal(levelFor(30, thresholds), 3);
  assert.equal(levelFor(40, thresholds), 4);
  assert.equal(levelFor(25, [25, 25, 25]), 3);
  assert.equal(normalizeDateKey("Jul 31, 2026"), "2026-07-31");
});
