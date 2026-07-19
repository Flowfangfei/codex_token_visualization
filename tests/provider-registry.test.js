const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../providers/registry.js");

test("public provider metadata excludes backend paths and adapters", () => {
  const publicEntries = registry.PROVIDERS.map(registry.publicProvider);
  assert.deepEqual(publicEntries.map((entry) => entry.id), ["codex", "claude", "cursor", "kimi"]);
  for (const entry of publicEntries) {
    assert.equal("usage" in entry, false);
    assert.equal("quota" in entry, false);
    assert.equal("detectPaths" in entry, false);
    assert.equal("sourceDescription" in entry, false);
  }
});

test("Kimi wire records aggregate only turn-scoped token events", async () => {
  const { aggregateKimiUsageRecords } = await import("../scripts/sync-account-quotas.mjs");
  const records = [
    {
      type: "usage.record",
      time: new Date(2026, 6, 19, 9, 0).getTime(),
      model: "kimi-code/k3",
      usageScope: "turn",
      usage: { inputOther: 100, output: 20, inputCacheRead: 300, inputCacheCreation: 10 },
    },
    {
      type: "usage.record",
      time: new Date(2026, 6, 19, 9, 1).getTime(),
      model: "kimi-code/k3",
      usageScope: "session",
      usage: { inputOther: 9999, output: 9999 },
    },
  ];
  const snapshot = aggregateKimiUsageRecords(records, "2026-07-19T01:00:00.000Z");
  assert.equal(snapshot.daily.length, 1);
  assert.equal(snapshot.daily[0].totalTokens, 430);
  assert.equal(snapshot.daily[0].cacheReadTokens, 300);
  assert.equal(snapshot.daily[0].modelBreakdowns[0].modelName, "kimi-code/k3");
});

test("Kimi managed usage normalizes weekly and short quota windows", async () => {
  const { normalizeKimiUsagePayload } = await import("../scripts/sync-account-quotas.mjs");
  const snapshot = normalizeKimiUsagePayload({
    usage: { used: 5, limit: 100, reset_in: 604800 },
    limits: [{ detail: { used: 2, limit: 100 }, window: { duration: 5, unit: "hour" }, reset_in: 18000 }],
  }, "2026-07-19T00:00:00.000Z");
  assert.equal(snapshot.windows.length, 2);
  assert.equal(snapshot.windows[0].usedPercent, 5);
  assert.equal(snapshot.windows[0].windowDurationMins, 10080);
  assert.equal(snapshot.windows[1].windowDurationMins, 300);
  assert.deepEqual(snapshot.quotaBreakdown.map((entry) => entry.usedPercent), [5, 2]);
});
