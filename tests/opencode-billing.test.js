const test = require("node:test");
const assert = require("node:assert/strict");
const Billing = require("../web/billing.js");

test("OpenCode custom aliases resolve to exact provider/version prices", () => {
  const cost = Billing.estimateUsageCost({
    modelName: "private-alias/glm-5-3-flash-260828", billingProvider: "volcengine",
    inputTokens: 1e6, cacheReadTokens: 1e6, outputTokens: 1e6,
  });
  assert.equal(cost.rate.id, "volcengine/glm-5-3-flash-260828");
  assert.equal(cost.currency, "CNY");
  assert.ok(Math.abs(cost.amount - 3.83) < 1e-9);
  assert.equal(cost.rate.source, "https://bigmodel.cn/pricing");
  assert.ok(Math.abs(cost.usd - 3.83 / Billing.CNY_PER_USD) < 1e-9);
});

test("Ark dated DeepSeek routes never inherit direct-provider redirection or pricing", () => {
  for (const model of ["deepseek-v4-pro-260425", "deepseek-v4-1-flash-260910"]) {
    const result = Billing.estimateUsageCost({ modelName: `private-alias/${model}`, billingProvider: "volcengine", inputTokens: 1e6 });
    assert.equal(result.matched, false);
    assert.equal(result.rate, null);
  }
});

test("provider metadata survives collection and overview display prefixes", async () => {
  const { aggregateOpenCodeUsageRecords } = await import("../scripts/sync-account-quotas.mjs");
  const snapshot = aggregateOpenCodeUsageRecords([{ date: "2026-09-21", modelName: "alias/glm-5-3-flash-260828", billingProvider: "volcengine", inputTokens: 1e6, totalTokens: 1e6 }]);
  const model = snapshot.daily[0].modelBreakdowns[0];
  assert.equal(model.billingProvider, "volcengine");
  model.modelName = `OpenCode · ${model.modelName}`;
  assert.equal(Billing.estimateDayCost(snapshot.daily[0]).usd, 0.8 / Billing.CNY_PER_USD);
});

test("mixed currencies and unmatched recorded costs are included without relabelling CNY as USD", () => {
  const result = Billing.estimateDayCost({ modelBreakdowns: [
    { modelName: "alias/glm-5-3-flash-260828", billingProvider: "volcengine", inputTokens: 1e6 },
    { modelName: "kimi-k3", inputTokens: 1e6 },
    { modelName: "unknown/custom", billingProvider: "unknown", inputTokens: 1e6, totalCost: 2 },
  ] });
  assert.equal(result.currency, "USD");
  assert.ok(Math.abs(result.usd - (20.8 / Billing.CNY_PER_USD + 2)) < 1e-9);
  assert.equal(result.unmatchedTokens, 1e6);
});
