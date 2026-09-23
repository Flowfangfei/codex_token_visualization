const test = require("node:test");
const assert = require("node:assert/strict");
const Billing = require("../web/billing.js");

test("recent metrics use calendar boundaries with gaps and exclude future dates", () => {
  const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  const fn = source.match(/function sumRecent\(days, read, count = 30\) \{[\s\S]*?\n\}/)[0];
  const sum = vm.runInNewContext(fn + "; sumRecent", {
    localDateKey: () => "2026-09-23", dayKey: (day) => day.date,
    addDays: (date, offset) => new Date(Date.parse(date) + offset * 86400000).toISOString().slice(0, 10),
  });
  assert.equal(sum(["2026-08-24", "2026-08-25", "2026-09-23", "2026-09-24"].map(date => ({ date })), () => 1), 2);
});

test("overview preserves time-priced CNY models alongside USD models and zero costs", () => {
  const timed = { modelName: "deepseek-v4-pro", inputTokens: 1e6,
    totalTokens: 1e6, timedBilling: true, costCurrency: "CNY", totalCost: 47.5 };
  const usd = { modelName: "gpt-6-sol", inputTokens: 1e6, totalTokens: 1e6 };
  const result = Billing.estimateDayCost({ modelBreakdowns: [timed, usd] });
  assert.equal(result.currency, "USD");
  assert.ok(Math.abs(result.usd - (Billing.toUsd(47.5, "CNY") + 2)) < 1e-9);
  assert.equal(Billing.estimateUsageCost({ ...timed, totalCost: 0 }).amount, 0);
  assert.equal(Billing.ratesForProvider("grok").some(rate => rate.id.includes("composer")), false);
});

test("September catalog keeps new models and providers distinct", () => {
  for (const [name, input, output] of [
    ["gpt-6-sol", 2, 10], ["gpt-6-luna", 0.1, 0.5],
    ["claude-opus-5-5", 4, 20], ["grok-4.7", 2, 6],
    ["grok-4.7-fast", 4, 12], ["glm-5.3", 8, 28],
  ]) {
    const result = Billing.estimateUsageCost({ modelName: name, inputTokens: 1e6, outputTokens: 1e6 });
    assert.equal(result.matched, true, name);
    assert.equal(result.amount, input + output, name);
  }
  assert.equal(Billing.matchRate("glm-5.3-flash").label, "GLM-5.3-Flash");
  assert.equal(Billing.matchRate("volcengine/glm-5-3-flash-260828").label, "GLM-5.3-Flash");
  assert.equal(Billing.matchRate("alias/deepseek-v4-pro-260425", "volcengine"), null);
  assert.equal(Billing.matchRate("alias/gpt-6-sol", "openai").id, "gpt-6-sol");
});

test("merged trend retains supplied USD costs", () => {
  const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  const fn = source.match(/function chartCost\(day\) \{[\s\S]*?\n\}/)[0];
  const chartCost = vm.runInNewContext(fn + "; chartCost");
  assert.equal(chartCost({ recorded: true, costUSD: 12.5 }), 12.5);
  assert.equal(chartCost({ recorded: false, costUSD: null }), 0);
});
