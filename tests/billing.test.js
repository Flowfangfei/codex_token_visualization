const test = require("node:test");
const assert = require("node:assert/strict");
const Billing = require("../web/billing.js");

test("maps observed and current model routes to the 2026-09-10 catalog", () => {
  const expected = {
    "gpt-6-astra": "gpt-6-astra",
    "gpt-5.5": "gpt-5.5",
    "gpt-5.6-sol": "gpt-5.6-sol",
    "gpt-5.6-terra": "gpt-5.6-terra",
    "kimi-code/k3": "kimi-k3",
    "k3-agent": "kimi-k3",
    "kimi-code/kimi-for-coding": "kimi-k2.7-code",
    "deepseek-official/deepseek-v4-flash": "deepseek-flash",
    "deepseek-official/deepseek-flash": "deepseek-flash",
    "grok-4.6-build": "grok-4.6",
    "Codex · gpt-5.6-sol": "gpt-5.6-sol",
    "claude-fable-5": "claude-fable-5",
    "claude-fable-5-1": "claude-fable-5.1",
    "claude-opus-4-8": "claude-opus-5",
    "claude-sonnet-5": "claude-sonnet-5",
    "composer-2.5": "composer-2.5",
    "composer-2.5-fast": "composer-2.5-fast",
    "cursor-grok-4.5-high-fast": "cursor-grok-4.5-fast",
    "gemini-3.8-flash": "gemini-3.8-flash",
    "muse-spark-1.3": "muse-spark-1.3",
  };

  for (const [name, id] of Object.entries(expected)) {
    const matched = Billing.matchRate(name);
    assert.equal(matched?.id, id, name);
  }
});
test("does not confuse GPT-5.5 Pro or Kimi K3 with neighboring SKUs", () => {
  assert.equal(Billing.matchRate("gpt-5.5-pro").id, "gpt-5.5-pro");
  assert.equal(Billing.matchRate("gpt-5.6-luna").id, "gpt-5.6-luna");
  assert.equal(Billing.matchRate("deepseek-official/deepseek-v4-pro").id, "deepseek-v4-pro");
  assert.equal(Billing.matchRate("unknown-router/mystery-model"), null);
});

test("estimates GPT-5.5 at the published $5 / $0.50 / $30 card", () => {
  const cost = Billing.estimateUsageCost({
    modelName: "gpt-5.5",
    inputTokens: 34_277,
    cacheReadTokens: 277_504,
    cacheCreationTokens: 0,
    outputTokens: 12_580,
  });
  assert.equal(cost.matched, true);
  assert.equal(cost.rate.id, "gpt-5.5");
  assert.ok(Math.abs(cost.usd - 0.687537) < 1e-9);
});

test("uses the August 21 GPT-5.6 Sol promotional API price", () => {
  const cost = Billing.estimateUsageCost({
    modelName: "gpt-5.6-sol",
    inputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(cost.usd, 4 + 0.4 + 5 + 20);
});

test("prices Kimi's current K3 and K2.7 Code routes in CNY", () => {
  const k3 = Billing.estimateUsageCost({
    modelName: "kimi-code/k3-256k",
    inputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  const coding = Billing.estimateUsageCost({
    modelName: "kimi-for-coding-highspeed",
    inputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(k3.currency, "CNY");
  assert.equal(k3.amount, 20 + 2 + 100);
  assert.equal(coding.rate.id, "kimi-k2.7-code");
  assert.equal(coding.amount, 6.5 + 1.3 + 27);
});

test("does not bill reasoning tokens a second time", () => {
  const withReasoning = Billing.estimateUsageCost({
    modelName: "grok-4.6-build",
    inputTokens: 1000,
    cacheReadTokens: 2000,
    outputTokens: 300,
    reasoningOutputTokens: 250,
  });
  const withoutReasoning = Billing.estimateUsageCost({
    modelName: "grok-4.6-build",
    inputTokens: 1000,
    cacheReadTokens: 2000,
    outputTokens: 300,
  });
  assert.equal(withReasoning.usd, withoutReasoning.usd);
  assert.equal(withReasoning.usd, (1000 * 2 + 2000 * 0.5 + 300 * 6) / 1_000_000);
});

test("sums a mixed day from model breakdowns and ignores source costUSD", () => {
  const day = {
    costUSD: 999,
    models: {
      "gpt-5.6-sol": { inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0, totalTokens: 1_000_000 },
      "gpt-5.6-terra": { inputTokens: 0, cacheReadTokens: 0, outputTokens: 1_000_000, totalTokens: 1_000_000 },
    },
  };
  const estimated = Billing.estimateDayCost(day);
  assert.equal(estimated.usd, 4 + 12);
  assert.equal(estimated.matchedTokens, 2_000_000);
  assert.equal(estimated.unmatchedTokens, 0);
});

test("falls back to recorded cost only when no model can be priced", () => {
  const day = {
    totalCost: 3.5,
    modelBreakdowns: [{ modelName: "mystery-model", inputTokens: 100, outputTokens: 20, totalTokens: 120 }],
  };
  const estimated = Billing.estimateDayCost(day);
  assert.equal(estimated.matched, false);
  assert.equal(estimated.usd, 3.5);
});

test("exposes a dated catalog for the billing API", () => {
  const catalog = Billing.catalog();
  assert.equal(catalog.asOf, "2026-09-10");
  assert.equal(catalog.currency, "USD");
  assert.ok(catalog.rates.some((entry) => entry.id === "gpt-6-astra" && entry.input === 10 && entry.output === 50));
  assert.ok(catalog.rates.some((entry) => entry.id === "gpt-5.6-sol" && entry.input === 4 && entry.output === 20));
  assert.ok(catalog.rates.some((entry) => entry.id === "deepseek-flash" && entry.currency === "CNY" && entry.peak?.output === 8));
  assert.ok(catalog.routes.some((entry) => entry.route === "auto-smart" && entry.destinations.includes("claude-fable-5-1")));
});

test("filters the rate card by Provider without dropping observed models", () => {
  assert.deepEqual(Billing.ratesForProvider("grok").map((entry) => entry.id), ["grok-4.6", "grok-4.5", "grok-4.3", "grok-build-0.1"]);
  assert.ok(Billing.ratesForProvider("codex").every((entry) => entry.vendor === "openai"));
  assert.ok(Billing.ratesForProvider("kimi").some((entry) => entry.id === "kimi-k3"));
  assert.deepEqual(Billing.routesForProvider("cursor").map((entry) => entry.id), ["cursor-auto-smart"]);
  assert.equal(Billing.ratesForProvider("overview").length, Billing.RATES.length);
});

test("prices DeepSeek V4 Flash in CNY using Shanghai weekday peak windows", () => {
  const peakAt = new Date("2026-08-27T02:00:00.000Z");
  const lunchAt = new Date("2026-08-27T05:00:00.000Z");
  const weekendAt = new Date("2026-08-22T02:00:00.000Z");
  assert.equal(Billing.isPeakAt(peakAt), true);
  assert.equal(Billing.isPeakAt(lunchAt), false);
  assert.equal(Billing.isPeakAt(weekendAt), false);

  const usage = { modelName: "deepseek-official/deepseek-v4-flash", inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 };
  assert.equal(Billing.estimateUsageCost(usage, usage.modelName, { at: peakAt }).amount, 2);
  assert.equal(Billing.estimateUsageCost(usage, usage.modelName, { at: peakAt }).currency, "CNY");
  assert.equal(Billing.estimateUsageCost(usage, usage.modelName, { at: peakAt }).window, "peak");
  assert.equal(Billing.estimateUsageCost(usage, usage.modelName, { at: lunchAt }).amount, 1);
  assert.equal(Billing.estimateUsageCost(usage, usage.modelName, { at: weekendAt }).amount, 1);
});

test("routes DeepSeek V4 Pro to V4.1 Flash after the announced cutoff", () => {
  const usage = { modelName: "deepseek-v4-pro", inputTokens: 1_000_000, outputTokens: 0 };
  const before = Billing.estimateUsageCost(usage, usage.modelName, { at: "2026-09-10T02:00:00.000Z" });
  const after = Billing.estimateUsageCost(usage, usage.modelName, { at: "2026-09-14T05:00:00.000Z" });
  assert.equal(before.rate.id, "deepseek-v4-pro");
  assert.equal(before.amount, 9);
  assert.equal(after.rate.id, "deepseek-flash");
  assert.equal(after.rate.routedFrom, "deepseek-v4-pro");
  assert.equal(after.amount, 1);
});

test("keeps a timed DeepSeek day in CNY instead of restating it at off-peak USD", () => {
  const estimated = Billing.estimateDayCost({
    timedBilling: true,
    costCurrency: "CNY",
    totalCost: 23.79,
    modelBreakdowns: [{
      modelName: "deepseek-official/deepseek-v4-flash",
      totalCost: 23.79,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    }],
  });
  assert.equal(estimated.timed, true);
  assert.equal(estimated.currency, "CNY");
  assert.equal(estimated.amount, 23.79);
});

test("annotates a usage snapshot with estimatedCostUSD and leaves stored fields intact", () => {
  const snapshot = Billing.annotateSnapshot({
    source: "grok",
    daily: [{
      date: "2026-08-26",
      totalCost: 0,
      modelBreakdowns: [{
        modelName: "grok-4.6-build",
        inputTokens: 1_000_000,
        cacheReadTokens: 0,
        outputTokens: 0,
        totalTokens: 1_000_000,
      }],
    }],
    totals: { totalCost: 0, totalTokens: 1_000_000 },
  });
  assert.equal(snapshot.daily[0].totalCost, 0);
  assert.equal(snapshot.daily[0].estimatedCostUSD, 2);
  assert.equal(snapshot.totals.estimatedCostUSD, 2);
  assert.equal(snapshot.billing.asOf, "2026-09-10");
  assert.equal(snapshot.billing.models[0].rate, "grok-4.6");
});
