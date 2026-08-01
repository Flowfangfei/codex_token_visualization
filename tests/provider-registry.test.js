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

test("Codex quota sync prefers the npm CLI shim over an inaccessible packaged executable", async () => {
  const { codexAppServerInvocation, resolveCodexCliPath } = await import("../scripts/sync-account-quotas.mjs");
  const npmShim = "C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd";
  const env = {
    APPDATA: "C:\\Users\\example\\AppData\\Roaming",
    CODEX_CLI_PATH: "C:\\stale\\codex.exe",
    PATH: "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\resources;C:\\Users\\example\\AppData\\Roaming\\npm",
  };
  const options = { platform: "win32", env, pathExists: (candidate) => candidate === npmShim };

  assert.equal(resolveCodexCliPath(options), npmShim);
  assert.deepEqual(codexAppServerInvocation(options), {
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", `& '${npmShim}' app-server --stdio`],
  });
});

test("Codex quota sync supports an explicit CLI path override", async () => {
  const { resolveCodexCliPath } = await import("../scripts/sync-account-quotas.mjs");
  assert.equal(resolveCodexCliPath({
    platform: "win32",
    env: { CODEX_CLI_PATH: "D:\\tools\\codex.exe" },
    pathExists: (candidate) => candidate === "D:\\tools\\codex.exe",
  }), "D:\\tools\\codex.exe");
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

test("Kimi CLI and desktop records merge without double-counting copied events", async () => {
  const { mergeKimiUsageSourceRecords } = await import("../scripts/sync-account-quotas.mjs");
  const shared = {
    type: "usage.record",
    time: new Date(2026, 6, 19, 10, 0).getTime(),
    model: "k3-agent",
    usageScope: "turn",
    usage: { inputOther: 100, output: 20, inputCacheRead: 300, inputCacheCreation: 10 },
  };
  const desktopOnly = {
    ...shared,
    time: new Date(2026, 6, 19, 10, 1).getTime(),
    usage: { inputOther: 200, output: 30, inputCacheRead: 400, inputCacheCreation: 0 },
  };
  const snapshot = mergeKimiUsageSourceRecords([
    { id: "kimi-code-cli", wireFiles: 1, records: [shared] },
    { id: "kimi-desktop", wireFiles: 2, records: [shared, desktopOnly] },
  ], "2026-07-19T02:00:00.000Z");

  assert.equal(snapshot.provider, "kimi-local-wire");
  assert.equal(snapshot.daily[0].totalTokens, 1060);
  assert.equal(snapshot.deduplicatedRecords, 1);
  assert.deepEqual(snapshot.usageSources, [
    { id: "kimi-code-cli", wireFiles: 1, usageRecords: 1, acceptedRecords: 1 },
    { id: "kimi-desktop", wireFiles: 2, usageRecords: 2, acceptedRecords: 1 },
  ]);
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

test("Kimi membership stats normalize monthly total and Kimi/Code composition", async () => {
  const { normalizeKimiMembershipStats } = await import("../scripts/sync-account-quotas.mjs");
  const snapshot = normalizeKimiMembershipStats({
    subscriptionBalance: {
      feature: "FEATURE_OMNI",
      amountUsedRatio: 0.5623,
      kimiCodeUsedRatio: 0.0292,
      expireTime: "2026-08-18T00:00:00Z",
    },
  }, "2026-07-19T15:00:00.000Z");

  assert.equal(snapshot.windows[0].name, "monthly_membership");
  assert.equal(snapshot.windows[0].windowKind, "monthly");
  assert.equal(snapshot.windows[0].usedPercent, 56.23);
  assert.equal(snapshot.windows[0].remainingPercent, 43.77);
  assert.equal(snapshot.windows[0].resetsAt, "2026-08-18T00:00:00.000Z");
  assert.deepEqual(snapshot.quotaBreakdown, [
    { label: "月度 Kimi", usedPercent: 53.31 },
    { label: "月度 Code", usedPercent: 2.92 },
  ]);
});

test("Kimi quota merge keeps monthly, weekly, and short windows", async () => {
  const { mergeKimiQuotaSnapshots, normalizeKimiMembershipStats, normalizeKimiUsagePayload } = await import("../scripts/sync-account-quotas.mjs");
  const membership = normalizeKimiMembershipStats({
    subscription_balance: {
      amount_used_ratio: 0.5,
      kimi_code_used_ratio: 0.1,
      expire_time: "2026-08-18T00:00:00Z",
    },
  }, "2026-07-19T15:00:00.000Z");
  const code = normalizeKimiUsagePayload({
    usage: { used: 14, limit: 100, resetTime: "2026-07-25T04:14:58Z" },
    limits: [{ detail: { used: 38, limit: 100 }, window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" } }],
  }, "2026-07-19T15:01:00.000Z");
  const snapshot = mergeKimiQuotaSnapshots(code, membership);

  assert.equal(snapshot.provider, "kimi-membership-and-code-usage");
  assert.deepEqual(snapshot.windows.map((window) => window.name), ["monthly_membership", "weekly_limit", "limit_1"]);
  assert.deepEqual(snapshot.quotaSources, ["kimi-membership-stats", "kimi-code-managed-usage"]);
});

test("Claude quota template keeps configured and newly discovered reset windows", async () => {
  const { applyQuotaWindowTemplate, normalizeClaudeUsagePayload } = await import("../scripts/sync-account-quotas.mjs");
  const quota = {
    discoverWindows: true,
    minimumForecastWindowMins: 10080,
    windows: [
      { name: "five_hour", label: "5 小时额度", windowDurationMins: 300 },
      { name: "seven_day_fable", label: "Fable 周额度", windowDurationMins: 10080, modelPatterns: ["fable"] },
    ],
  };
  const windows = normalizeClaudeUsagePayload({
    five_hour: { utilization: 25, resets_at: "2026-07-20T05:00:00Z" },
    seven_day_fable: { utilization: 40, resets_at: "2026-07-25T00:00:00Z" },
    future_model_window: { utilization: 12, resets_at: "2026-07-26T00:00:00Z" },
    extra_usage: { utilization: 5 },
  }, quota);
  const snapshot = applyQuotaWindowTemplate({ quota }, { windows });

  assert.deepEqual(snapshot.windows.map((window) => window.name), ["five_hour", "seven_day_fable", "future_model_window"]);
  assert.equal(snapshot.windows[0].selectable, false);
  assert.equal(snapshot.windows[1].label, "Fable 周额度");
  assert.notEqual(snapshot.windows[1].selectable, false);
  assert.deepEqual(snapshot.windows[1].modelPatterns, ["fable"]);
  assert.equal(snapshot.windows[2].usedPercent, 12);
  assert.equal(JSON.stringify(snapshot).includes("modelPatterns"), false);
});

test("model-specific quota windows use only matching cumulative model tokens", async () => {
  const { quotaWindowUsageAggregate } = await import("../scripts/sync-account-quotas.mjs");
  const aggregate = quotaWindowUsageAggregate({ modelPatterns: ["fable"] }, {
    totalTokens: 1000,
    models: { "claude-fable-5": 250, "claude-sonnet-5": 750 },
  });

  assert.equal(aggregate.totalTokens, 250);
  assert.deepEqual(aggregate.models, { "claude-fable-5": 250 });
});
