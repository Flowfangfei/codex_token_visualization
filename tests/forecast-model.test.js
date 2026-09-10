const test = require("node:test");
const assert = require("node:assert/strict");
const ForecastModel = require("../web/forecast-model.js");

function interval(model, index, tokens = 1_000_000, quota = 2) {
  return { segmentIndex: index % 2, endedAt: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
    deltaTokens: tokens, deltaPercent: quota, modelDeltas: { [model]: tokens } };
}

test("new models cannot inherit old other-model weights, even with a large historical sample", () => {
  const history = Array.from({ length: 20 }, (_, index) => interval("old", index));
  const recent = [{ totalTokens: 2e6, modelBreakdowns: [{ modelName: "gpt-6-astra", totalTokens: 2e6 }] }];
  const weighted = { active: true, primaryModels: ["old"], weightMap: { old: 1, "other-models": 0.5 } };
  let result = ForecastModel.assessModelCalibration(history, recent, weighted);
  assert.equal(result.ready, false);
  assert.deepEqual(result.unsupportedModels, ["gpt-6-astra"]);
  assert.equal(result.support["gpt-6-astra"], 0);
  history.push(...[0, 1, 2].map((i) => interval("gpt-6-astra", i, 2e6, 10)));
  result = ForecastModel.assessModelCalibration(history, recent, weighted);
  assert.equal(result.ready, false); // Three samples alone do not create a fitted model weight.
  assert.equal(result.support["gpt-6-astra"], 3);
  assert.equal(history.length, 23);
});

test("raw scalar fits need a stable mix; unchanged single-model usage remains usable", () => {
  const history = [0, 1, 2, 3].map((i) => interval("old", i));
  const usage = (model) => [{ totalTokens: 1e6, modelBreakdowns: [{ modelName: model, totalTokens: 1e6 }] }];
  assert.equal(ForecastModel.assessModelCalibration(history, usage("old"), { active: false }).ready, true);
  history.push(...[0, 1, 2].map((i) => interval("new", i)));
  assert.equal(ForecastModel.assessModelCalibration(history, usage("new"), { active: false }).reason, "model-mix-changed");
  assert.equal(ForecastModel.assessModelCalibration(history, [{ totalTokens: 1e6 }], { active: false }).ready, false);
});

test("recent models get explicit features instead of being hidden by large old-model lifetime totals", () => {
  const history = [
    ...[0, 1, 2, 3].map((i) => interval("old-a", i, (i + 1) * 100e6, (i + 1) * 10)),
    ...[0, 1, 2, 3].map((i) => interval("old-b", i, (i + 1) * 100e6, (i + 1) * 20)),
    ...[0, 1, 2, 3].map((i) => interval("gpt-6-astra", i, (i + 1) * 1e6, (i + 1) * 0.4)),
  ];
  const recent = [{ totalTokens: 1e6, modelBreakdowns: [{ modelName: "gpt-6-astra", totalTokens: 1e6 }] }];
  const raw = ForecastModel.fitSegmentedQuota(history);
  const fit = ForecastModel.fitModelWeightsFromIntervals(history, raw.model.slope,
    { priorityModels: ForecastModel.recentModelNames(recent) });
  assert.equal(fit.active, true);
  assert.ok(fit.primaryModels.includes("gpt-6-astra"));
  assert.ok(fit.weightMap["gpt-6-astra"] > fit.weightMap["old-a"]);
  assert.equal(ForecastModel.assessModelCalibration(history, recent, fit).ready, true);
  assert.equal(fit.sampleCount, history.length);
});

test("invalid weights and too few per-model observations do not pass calibration", () => {
  const history = [0, 1].map((i) => interval("new", i));
  const recent = [{ totalTokens: 1e6, modelBreakdowns: [{ modelName: "new", totalTokens: 1e6 }] }];
  const fit = { active: true, primaryModels: ["new"], weightMap: { new: 2 } };
  assert.equal(ForecastModel.assessModelCalibration(history, recent, fit).ready, false);
  history.push(interval("new", 2));
  assert.equal(ForecastModel.assessModelCalibration(history, recent, fit).ready, true);
  fit.weightMap.new = Infinity;
  assert.equal(ForecastModel.assessModelCalibration(history, recent, fit).ready, false);
});

test("measured expensive models are not truncated to an arbitrary fourfold cap", () => {
  const history = [
    ...[0, 1, 2, 3].map((i) => interval("old", i, (i + 1) * 100e6, (i + 1) * 10)),
    ...[0, 1, 2, 3].map((i) => interval("new", i, (i + 1) * 1e6, (i + 1) * 2)),
  ];
  const raw = ForecastModel.fitSegmentedQuota(history);
  const fit = ForecastModel.fitModelWeightsFromIntervals(history, raw.model.slope, { priorityModels: ["new"] });
  assert.equal(fit.active, true);
  assert.ok(fit.weightMap.new > 4);
  const recent = [{ totalTokens: 1e6, modelBreakdowns: [{ modelName: "new", totalTokens: 1e6 }] }];
  assert.equal(ForecastModel.assessModelCalibration(history, recent, fit).ready, true);
});

test("recent model-specific mismatch is not hidden by a large historical sample", () => {
  const history = [...Array.from({ length: 20 }, (_, i) => interval("old", i, 100e6, 10)),
    ...[20, 21, 22].map((i) => interval("new", i, 1e6, 5))];
  const recent = [{ totalTokens: 1e6, modelBreakdowns: [{ modelName: "new", totalTokens: 1e6 }] }];
  const oldWeights = { active: true, primaryModels: ["old", "new"], weightMap: { old: 1, new: 1 } };
  assert.equal(ForecastModel.assessModelCalibration(history, recent, oldWeights).reason, "model-fit-unstable");
});

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
  const prior = { windowName: "weekly_limit", resetAt: "2026-07-17T00:00:00.000Z", usedPercent: 82, totalTokens: 500_000_000 };

  assert.equal(
    detectObservationSegment(prior, { ...prior, windowName: "monthly_membership" }).reason,
    "quota-window-changed"
  );

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

test("multiple resets in one day create isolated fit intervals", async () => {
  const { detectObservationSegment } = await import("../scripts/sync-account-quotas.mjs");
  const samples = [
    { fetchedAt: "2026-07-11T01:00:00Z", resetAt: "2026-07-18T00:00:00Z", usedPercent: 10, totalTokens: 100_000_000 },
    { fetchedAt: "2026-07-11T03:00:00Z", resetAt: "2026-07-18T00:00:00Z", usedPercent: 35, totalTokens: 125_000_000 },
    { fetchedAt: "2026-07-11T05:00:00Z", resetAt: "2026-07-18T00:00:00Z", usedPercent: 2, totalTokens: 130_000_000 },
    { fetchedAt: "2026-07-11T07:00:00Z", resetAt: "2026-07-18T00:00:00Z", usedPercent: 20, totalTokens: 148_000_000 },
    { fetchedAt: "2026-07-11T09:00:00Z", resetAt: "2026-07-18T00:00:00Z", usedPercent: 1, totalTokens: 150_000_000 },
    { fetchedAt: "2026-07-11T11:00:00Z", resetAt: "2026-07-18T00:00:00Z", usedPercent: 12, totalTokens: 161_000_000 },
  ];
  let segment = 0;
  const observations = samples.map((sample, index) => {
    const prior = index > 0 ? samples[index - 1] : null;
    const decision = detectObservationSegment(prior, sample);
    if (decision.newSegment) segment += 1;
    return { ...sample, segment, modelTotals: { alpha: sample.totalTokens } };
  });
  const segments = [...observations.reduce((groups, observation) => {
    const group = groups.get(observation.segment) || [];
    group.push(observation);
    groups.set(observation.segment, group);
    return groups;
  }, new Map()).values()];
  const intervals = ForecastModel.buildSegmentIntervals(segments);

  assert.deepEqual(observations.map((observation) => observation.segment), [1, 1, 2, 2, 3, 3]);
  assert.deepEqual(intervals.map((interval) => interval.deltaTokens), [25_000_000, 18_000_000, 11_000_000]);
  assert.deepEqual(intervals.map((interval) => interval.deltaPercent), [25, 18, 11]);
  assert.equal(ForecastModel.fitSegmentedQuota(intervals).segmentCount, 3);
});

test("observation compaction preserves multiple reset boundaries", async () => {
  const { compactObservations } = await import("../scripts/sync-account-quotas.mjs");
  const observations = Array.from({ length: 120 }, (_, index) => ({
    id: index,
    segment: index < 40 ? 1 : index < 80 ? 2 : 3,
    resetDetected: index === 40 || index === 80,
  }));
  const compacted = compactObservations(observations, 96);
  const ids = new Set(compacted.map((observation) => observation.id));

  assert.equal(compacted.length, 96);
  assert.deepEqual(compacted.map((observation) => observation.id), [...compacted].map((observation) => observation.id).sort((a, b) => a - b));
  [0, 39, 40, 79, 80, 119].forEach((id) => assert.equal(ids.has(id), true));
});

test("observation compaction retains the first and latest point for every quota window", async () => {
  const { compactObservations } = await import("../scripts/sync-account-quotas.mjs");
  const observations = Array.from({ length: 120 }, (_, index) => ({
    id: index,
    windowName: index % 3 === 0 ? "monthly" : index % 3 === 1 ? "weekly" : "five_hour",
    segment: index < 60 ? 1 : 2,
    resetDetected: index === 60 || index === 61 || index === 62,
  }));
  const compacted = compactObservations(observations, 24);
  const ids = new Set(compacted.map((observation) => observation.id));

  [0, 1, 2, 57, 58, 59, 60, 61, 62, 117, 118, 119].forEach((id) => assert.equal(ids.has(id), true));
});

test("segmented quota fit keeps historical intervals after a new cycle starts", () => {
  const segments = [
    [
      { fetchedAt: "2026-07-01T08:00:00Z", usedPercent: 10, totalTokens: 100_000_000, modelTotals: { alpha: 100_000_000 } },
      { fetchedAt: "2026-07-01T10:00:00Z", usedPercent: 20, totalTokens: 110_000_000, modelTotals: { alpha: 110_000_000 } },
      { fetchedAt: "2026-07-01T12:00:00Z", usedPercent: 35, totalTokens: 125_000_000, modelTotals: { alpha: 125_000_000 } },
    ],
    [
      { fetchedAt: "2026-07-08T08:00:00Z", usedPercent: 0, totalTokens: 130_000_000, modelTotals: { alpha: 130_000_000 } },
    ],
  ];
  const intervals = ForecastModel.buildSegmentIntervals(segments);
  const fit = ForecastModel.fitSegmentedQuota(intervals, { referenceTime: "2026-07-08T08:00:00Z" });

  assert.equal(intervals.length, 2);
  assert.equal(fit.intervalCount, 2);
  assert.ok(fit.model);
  assert.ok(Math.abs(fit.model.slope - 1e-6) < 1e-10);
});

test("segmented fit gives newer cycles more influence", () => {
  const intervals = [
    { segmentIndex: 0, endedAt: "2026-05-01T00:00:00Z", deltaTokens: 10_000_000, deltaPercent: 10 },
    { segmentIndex: 0, endedAt: "2026-05-02T00:00:00Z", deltaTokens: 10_000_000, deltaPercent: 10 },
    { segmentIndex: 1, endedAt: "2026-07-01T00:00:00Z", deltaTokens: 10_000_000, deltaPercent: 20 },
    { segmentIndex: 1, endedAt: "2026-07-02T00:00:00Z", deltaTokens: 10_000_000, deltaPercent: 20 },
  ];
  const fit = ForecastModel.fitSegmentedQuota(intervals, { referenceTime: "2026-07-02T00:00:00Z", halfLifeDays: 28 });

  assert.ok(fit.model.slope > 1.5e-6);
  assert.equal(fit.segmentCount, 2);
});

test("learns model weights from intervals pooled across reset segments", () => {
  const intervals = Array.from({ length: 8 }, (_, index) => {
    const alpha = (8 - index) * 1_000_000;
    const beta = (index + 1) * 1_000_000;
    return {
      segmentIndex: index < 4 ? 0 : 1,
      endedAt: `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
      deltaTokens: alpha + beta,
      deltaPercent: alpha / 1_000_000 + (2 * beta) / 1_000_000,
      modelDeltas: { alpha, beta },
    };
  });
  const rawFit = ForecastModel.fitSegmentedQuota(intervals);
  const modelFit = ForecastModel.fitModelWeightsFromIntervals(intervals, rawFit.model.slope);

  assert.equal(modelFit.active, true);
  assert.equal(modelFit.intervalMode, true);
  assert.ok(modelFit.weightMap.beta > modelFit.weightMap.alpha * 1.2);
});
