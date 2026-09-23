const test = require("node:test");
const assert = require("node:assert/strict");
const Billing = require("../web/billing.js");

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
