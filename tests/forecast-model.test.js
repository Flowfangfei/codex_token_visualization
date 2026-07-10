const test = require("node:test");
const assert = require("node:assert/strict");
const ForecastModel = require("../web/forecast-model.js");

function day(index, alpha, beta) {
  return {
    date: `2026-07-${String(index).padStart(2, "0")}`,
    totalTokens: alpha + beta,
    modelBreakdowns: [
      { modelName: "alpha", totalTokens: alpha },
      { modelName: "beta", totalTokens: beta },
    ],
  };
}

test("learns a larger equivalent-token weight for the more quota-expensive model", () => {
  const days = [
    day(1, 8_000_000, 1_000_000),
    day(2, 7_000_000, 2_000_000),
    day(3, 6_000_000, 3_000_000),
    day(4, 5_000_000, 4_000_000),
    day(5, 4_000_000, 5_000_000),
    day(6, 3_000_000, 6_000_000),
    day(7, 2_000_000, 7_000_000),
    day(8, 1_000_000, 8_000_000),
  ];
  let alphaTotal = 0;
  let betaTotal = 0;
  const quotaPoints = days.map((entry) => {
    alphaTotal += entry.modelBreakdowns[0].totalTokens;
    betaTotal += entry.modelBreakdowns[1].totalTokens;
    return { day: entry.date, usedPercent: 5 + alphaTotal / 1_000_000 + (2 * betaTotal) / 1_000_000 };
  });
  const rawSlope = (quotaPoints.at(-1).usedPercent - quotaPoints[0].usedPercent) /
    (days.slice(1).reduce((sum, entry) => sum + entry.totalTokens, 0));
  const fit = ForecastModel.fitModelWeights(days, quotaPoints, rawSlope);

  assert.equal(fit.active, true);
  assert.ok(fit.weightMap.beta > fit.weightMap.alpha * 1.25);
  assert.ok(fit.rSquared > 0.98);
  const weighted = ForecastModel.applyModelWeights(days, fit);
  assert.ok(weighted.at(-1).totalTokens > weighted[0].totalTokens);
});

test("does not claim model weights when model mix is stable", () => {
  const days = Array.from({ length: 8 }, (_, index) => day(index + 1, 5_000_000, 5_000_000));
  const quotaPoints = days.map((entry, index) => ({ day: entry.date, usedPercent: 10 + index * 4 }));
  const fit = ForecastModel.fitModelWeights(days, quotaPoints, 4e-7);

  assert.equal(fit.active, false);
  assert.equal(fit.reason, "stable-model-mix");
});

test("learns from multiple observations inside one reset segment on the same day", () => {
  let alpha = 100_000_000;
  let beta = 40_000_000;
  const mixes = [[8, 1], [7, 2], [6, 3], [5, 4], [4, 5], [3, 6], [2, 7], [1, 8]];
  const quotaPoints = mixes.map(([alphaStep, betaStep], index) => {
    alpha += alphaStep * 1_000_000;
    beta += betaStep * 1_000_000;
    return {
      day: "2026-07-10",
      fetchedAt: `2026-07-10T${String(index + 8).padStart(2, "0")}:00:00.000Z`,
      totalTokens: alpha + beta,
      modelTotals: { alpha, beta },
      usedPercent: 10 + (alpha - 100_000_000) / 1_000_000 + (2 * (beta - 40_000_000)) / 1_000_000,
    };
  });
  const totalDelta = quotaPoints.at(-1).totalTokens - quotaPoints[0].totalTokens;
  const rawSlope = (quotaPoints.at(-1).usedPercent - quotaPoints[0].usedPercent) / totalDelta;
  const fit = ForecastModel.fitModelWeights([], quotaPoints, rawSlope);

  assert.equal(fit.active, true);
  assert.equal(fit.observationMode, true);
  assert.ok(fit.weightMap.beta > fit.weightMap.alpha * 1.25);
});

test("quota observation segmentation detects resets inside the same day", async () => {
  const { detectObservationSegment } = await import("../scripts/sync-account-quotas.mjs");
  const prior = { resetAt: "2026-07-17T00:00:00.000Z", usedPercent: 82, totalTokens: 500_000_000 };

  assert.equal(
    detectObservationSegment(prior, { ...prior, resetAt: "2026-07-24T00:00:00.000Z" }).reason,
    "reset-time-changed"
  );
  assert.equal(
    detectObservationSegment(prior, { ...prior, usedPercent: 3, totalTokens: 510_000_000 }).reason,
    "quota-percent-dropped"
  );
  assert.equal(
    detectObservationSegment(prior, { ...prior, totalTokens: 100_000_000 }).reason,
    "usage-counter-dropped"
  );
  assert.equal(
    detectObservationSegment(prior, { ...prior, usedPercent: 83, totalTokens: 520_000_000 }).newSegment,
    false
  );
  assert.equal(
    detectObservationSegment(prior, { ...prior, resetAt: "2026-07-17T00:00:00.400Z" }).newSegment,
    false
  );
});
