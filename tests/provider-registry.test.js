const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { zstdCompressSync } = require("node:zlib");
const registry = require("../providers/registry.js");

test("public provider metadata excludes backend paths and adapters", () => {
  const publicEntries = registry.PROVIDERS.map(registry.publicProvider);
  assert.deepEqual(publicEntries.map((entry) => entry.id), [
    "codex",
    "claude",
    "cursor",
    "kimi",
    "opencode",
    "deepseek-harness",
    "grok",
    "grok-build",
  ]);
  for (const entry of publicEntries) {
    assert.equal("usage" in entry, false);
    assert.equal("quota" in entry, false);
    assert.equal("detectPaths" in entry, false);
    assert.equal("sourceDescription" in entry, false);
  }
  assert.equal(publicEntries.find((entry) => entry.id === "grok").overviewGroup, "grok");
  assert.equal(publicEntries.find((entry) => entry.id === "grok-build").overviewGroup, "grok");
});

test("automatic refresh excludes the redundant aggregate ccusage scan", () => {
  assert.deepEqual(registry.AUTO_EXPORT_SOURCES.map((entry) => entry.id), ["codex", "claude"]);
  assert.equal(registry.AGGREGATE_PROVIDER.usage.autoExport, false);
  assert.deepEqual(registry.AGGREGATE_PROVIDER.usage.ccusageArgs, ["daily"]);
});

test("Grok Build completed turns normalize cached input and deduplicate restored sessions", async () => {
  const { aggregateGrokBuildUsageRecords, parseGrokBuildUsageJsonl } = await import("../scripts/sync-account-quotas.mjs");
  const completed = {
    timestamp: 1788498000,
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "turn_completed",
        prompt_id: "private-prompt-id",
        usage: {
          modelUsage: {
            "grok-4.6-build": {
              inputTokens: 1000,
              outputTokens: 100,
              totalTokens: 1100,
              cachedReadTokens: 700,
              cacheCreationTokens: 100,
              reasoningTokens: 80,
              costUsdTicks: 1000000000,
            },
          },
        },
      },
    },
  };
  const first = parseGrokBuildUsageJsonl([
    JSON.stringify({ timestamp: 1788497999, params: { update: { sessionUpdate: "agent_message", usage: { inputTokens: 9999 } } } }),
    JSON.stringify(completed),
    "{unfinished",
  ].join("\n"), { sourceKey: "parent" });
  const restored = parseGrokBuildUsageJsonl(JSON.stringify(completed), { sourceKey: "restored-child" });
  const snapshot = aggregateGrokBuildUsageRecords(
    [...first.records, ...restored.records],
    "2026-09-04T01:00:00.000Z",
    { invalidLines: first.invalidLines + restored.invalidLines },
  );

  assert.equal(first.completedTurns, 1);
  assert.equal(first.invalidLines, 1);
  assert.equal(snapshot.recordCount, 1);
  assert.equal(snapshot.rawRecordCount, 2);
  assert.equal(snapshot.duplicateRecords, 1);
  assert.equal(snapshot.daily[0].inputTokens, 200);
  assert.equal(snapshot.daily[0].cacheReadTokens, 700);
  assert.equal(snapshot.daily[0].cacheCreationTokens, 100);
  assert.equal(snapshot.daily[0].outputTokens, 100);
  assert.equal(snapshot.daily[0].reasoningOutputTokens, 80);
  assert.equal(snapshot.daily[0].totalTokens, 1100);
  assert.equal(snapshot.daily[0].totalCost, 0.1);
  assert.equal(snapshot.daily[0].modelBreakdowns[0].modelName, "grok-4.6-build");
  assert.equal(JSON.stringify(snapshot).includes("private-prompt-id"), false);
  assert.equal(JSON.stringify(snapshot).includes("prompt_id"), false);
});

test("Grok Build parser falls back to top-level usage and accepts ISO timestamps", async () => {
  const { aggregateGrokBuildUsageRecords, parseGrokBuildUsageJsonl } = await import("../scripts/sync-account-quotas.mjs");
  const parsed = parseGrokBuildUsageJsonl(JSON.stringify({
    timestamp: "2026-09-04T02:30:00.000Z",
    params: {
      update: {
        sessionUpdate: "turn_completed",
        usage: {
          inputTokens: 90,
          outputTokens: 10,
          totalTokens: 100,
          cachedReadTokens: 50,
          reasoningTokens: 4,
          costUsdTicks: 500000000,
        },
      },
    },
  }), { sourceKey: "standalone" });
  const snapshot = aggregateGrokBuildUsageRecords(parsed.records);

  assert.equal(parsed.missingTimestamps, 0);
  assert.equal(snapshot.daily[0].modelBreakdowns[0].modelName, "unknown");
  assert.equal(snapshot.daily[0].inputTokens, 40);
  assert.equal(snapshot.daily[0].cacheReadTokens, 50);
  assert.equal(snapshot.daily[0].totalTokens, 100);
  assert.equal(snapshot.daily[0].totalCost, 0.05);
});

test("Grok Build billing normalizes the official weekly percentage and reset", async () => {
  const { normalizeGrokBillingPayload } = await import("../scripts/sync-account-quotas.mjs");
  const snapshot = normalizeGrokBillingPayload({
    config: {
      creditUsagePercent: 9,
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-09-02T07:38:26Z",
        end: "2026-09-09T07:38:26Z",
      },
      prepaidBalance: { val: 250 },
      isUnifiedBillingUser: true,
    },
    subscriptionTier: "SuperGrok",
  }, "2026-09-04T06:00:00.000Z");

  assert.equal(snapshot.provider, "grok-build-official-cli-billing");
  assert.equal(snapshot.planType, "SuperGrok");
  assert.equal(snapshot.windows[0].name, "weekly_limit");
  assert.equal(snapshot.windows[0].label, "SuperGrok 周总额度");
  assert.equal(snapshot.windows[0].usedPercent, 9);
  assert.equal(snapshot.windows[0].remainingPercent, 91);
  assert.equal(snapshot.windows[0].windowDurationMins, 10080);
  assert.equal(snapshot.windows[0].resetsAt, "2026-09-09T07:38:26.000Z");
  assert.equal(snapshot.prepaidBalanceCents, 250);

  assert.throws(() => normalizeGrokBillingPayload({
    config: {
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-09-02T07:38:26Z",
        end: "2026-09-09T07:38:26Z",
      },
    },
  }), /did not include a current usage period/);

  const unnamedPlan = normalizeGrokBillingPayload({
    config: {
      creditUsagePercent: 0,
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-09-02T07:38:26Z",
        end: "2026-09-09T07:38:26Z",
      },
    },
  });
  assert.equal(unnamedPlan.windows[0].label, "Grok 共享周额度");
});

test("Grok Build banked reset parser drops token ids and keeps expiry only", async () => {
  const { parseGrokResetCreditsBuffer } = await import("../scripts/sync-account-quotas.mjs");
  const varint = (input) => {
    let value = Number(input);
    const bytes = [];
    do {
      const byte = value % 128;
      value = Math.floor(value / 128);
      bytes.push(byte | (value > 0 ? 0x80 : 0));
    } while (value > 0);
    return Buffer.from(bytes);
  };
  const field = (number, payload) => Buffer.concat([varint(number * 8 + 2), varint(payload.length), payload]);
  const expiresAt = "2026-09-12T18:49:00.000Z";
  const timestamp = Buffer.concat([
    varint(1 * 8),
    varint(Math.floor(new Date(expiresAt).getTime() / 1000)),
  ]);
  const token = Buffer.concat([
    field(1, Buffer.from("must-not-survive", "utf8")),
    field(3, timestamp),
  ]);
  const payload = field(1, token);
  const frame = Buffer.alloc(5 + payload.length);
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);

  const snapshot = parseGrokResetCreditsBuffer(frame, new Date("2026-09-04T00:00:00Z").getTime());
  assert.equal(snapshot.available_count, 1);
  assert.equal(snapshot.credits[0].status, "available");
  assert.equal(snapshot.credits[0].expires_at, expiresAt);
  assert.equal(JSON.stringify(snapshot).includes("must-not-survive"), false);
});

test("DeepSeek Harness concatenated Zstandard frames decode without exposing message content", async () => {
  const { decodeDeepSeekHarnessSessionBuffer, scanZstdFrameRanges } = await import("../scripts/sync-account-quotas.mjs");
  const first = zstdCompressSync(`${JSON.stringify({
    type: "session",
    id: "must-not-survive",
    createdAt: new Date(2026, 7, 13, 9, 0).getTime(),
  })}\n${JSON.stringify({
    type: "request/context",
    time: new Date(2026, 7, 13, 9, 1).getTime(),
    data: { provider: "deepseek-official", model: "deepseek-v4-pro", contextWindow: 128000 },
  })}\n`);
  const second = zstdCompressSync(`${JSON.stringify({
    type: "assistant/chunk",
    time: new Date(2026, 7, 13, 9, 2).getTime(),
    data: { turn: 1, step: 1, chunk: { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } } },
  })}\n`);
  const unfinished = zstdCompressSync(`${JSON.stringify({ type: "turn/end", data: { reason: "done" } })}\n`);
  const buffer = Buffer.concat([first, second, unfinished.subarray(0, Math.floor(unfinished.length / 2))]);

  const scan = scanZstdFrameRanges(buffer);
  assert.equal(scan.frames.length, 2);
  assert.equal(typeof scan.tornStart, "number");
  const decoded = decodeDeepSeekHarnessSessionBuffer(buffer);
  assert.equal(decoded.frames, 2);
  assert.equal(decoded.tornFrame, true);
  assert.deepEqual(decoded.events.map((event) => event.type), [
    "session",
    "request/context",
    "assistant/chunk",
  ]);
  assert.equal(JSON.stringify(decoded).includes("must-not-survive"), false);
});

test("DeepSeek Harness final usage replaces stream usage and excludes other routes", async () => {
  const { aggregateDeepSeekHarnessEvents } = await import("../scripts/sync-account-quotas.mjs");
  const morning = new Date(2026, 7, 13, 9, 0).getTime();
  const snapshot = aggregateDeepSeekHarnessEvents([[
    { type: "session", createdAt: morning },
    { type: "request/context", route: { provider: "deepseek-official", model: "deepseek-v4-pro" } },
    {
      type: "assistant/chunk",
      key: "1:1",
      time: morning,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        reasoningOutputTokens: 2,
        cacheReadTokens: 20,
        cacheCreationTokens: 1,
        totalTokens: 36,
        totalCost: 0,
      },
    },
    {
      type: "assistant/message",
      key: "1:1",
      time: morning + 1000,
      route: { provider: "deepseek-official", model: "deepseek-v4-pro" },
      usage: {
        inputTokens: 12,
        outputTokens: 6,
        reasoningOutputTokens: 3,
        cacheReadTokens: 20,
        cacheCreationTokens: 1,
        totalTokens: 39,
        totalCost: 0,
      },
    },
    { type: "request/context", route: { provider: "openai", model: "gpt-5.5" } },
    {
      type: "assistant/chunk",
      key: "1:2",
      time: morning + 2000,
      usage: {
        inputTokens: 999,
        outputTokens: 999,
        reasoningOutputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 1998,
        totalCost: 0,
      },
    },
  ]], "2026-08-13T01:00:00.000Z");

  assert.equal(snapshot.provider, "deepseek-harness-session-zstd");
  assert.equal(snapshot.recordCount, 1);
  assert.equal(snapshot.daily.length, 1);
  assert.equal(snapshot.daily[0].totalTokens, 39);
  assert.equal(snapshot.daily[0].reasoningOutputTokens, 3);
  assert.equal(snapshot.daily[0].modelBreakdowns[0].modelName, "deepseek-official/deepseek-v4-pro");
});

test("OpenCode assistant messages aggregate by day and provider-qualified model", async () => {
  const { aggregateOpenCodeUsageRecords } = await import("../scripts/sync-account-quotas.mjs");
  const snapshot = aggregateOpenCodeUsageRecords([
    {
      date: "2026-08-06",
      modelName: "deepseek/deepseek-v4-flash",
      inputTokens: 120,
      outputTokens: 30,
      reasoningOutputTokens: 10,
      cacheReadTokens: 400,
      cacheCreationTokens: 20,
      totalTokens: 580,
      totalCost: 0.01,
    },
    {
      date: "2026-08-06",
      modelName: "anthropic/claude-sonnet-4-5",
      inputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 0,
      cacheReadTokens: 100,
      cacheCreationTokens: 0,
      totalTokens: 200,
      totalCost: 0.02,
    },
  ], "2026-08-06T08:00:00.000Z");

  assert.equal(snapshot.provider, "opencode-sqlite");
  assert.equal(snapshot.recordCount, 2);
  assert.equal(snapshot.daily.length, 1);
  assert.equal(snapshot.daily[0].totalTokens, 780);
  assert.equal(snapshot.daily[0].cacheReadTokens, 500);
  assert.equal(snapshot.totals.totalCost, 0.03);
  assert.deepEqual(snapshot.daily[0].modelsUsed, [
    "deepseek/deepseek-v4-flash",
    "anthropic/claude-sonnet-4-5",
  ]);
});

test("Grok primary-session usage separates cache and reasoning without changing the total", async () => {
  const { aggregateGrokUsageRecords, grokTurnUsageRecord } = await import("../scripts/sync-account-quotas.mjs");
  const timestamp = new Date(2026, 7, 26, 9, 30).getTime();
  const record = grokTurnUsageRecord({
    timestamp: Math.floor(timestamp / 1000),
    params: {
      update: {
        sessionUpdate: "turn_completed",
        prompt_id: "prompt-local-1",
        usage: {
          inputTokens: 1000,
          outputTokens: 200,
          totalTokens: 1200,
          cachedReadTokens: 400,
          cacheCreationTokens: 100,
          reasoningTokens: 50,
          modelUsage: {
            "grok-4.6-build": {
              inputTokens: 1000,
              outputTokens: 200,
              totalTokens: 1200,
              cachedReadTokens: 400,
              cacheCreationTokens: 100,
              reasoningTokens: 50,
            },
          },
        },
      },
      _meta: { agentTimestampMs: timestamp, eventId: "event-local-1" },
    },
  });
  const snapshot = aggregateGrokUsageRecords([{ ...record, dedupeKey: undefined }], "2026-08-26T01:30:00.000Z");

  assert.equal(record.date, "2026-08-26");
  assert.deepEqual({
    inputTokens: record.inputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheCreationTokens: record.cacheCreationTokens,
    outputTokens: record.outputTokens,
    reasoningOutputTokens: record.reasoningOutputTokens,
    totalTokens: record.totalTokens,
  }, {
    inputTokens: 500,
    cacheReadTokens: 400,
    cacheCreationTokens: 100,
    outputTokens: 150,
    reasoningOutputTokens: 50,
    totalTokens: 1200,
  });
  assert.equal(snapshot.provider, "grok-local-primary-session-jsonl");
  assert.equal(snapshot.daily[0].modelBreakdowns[0].modelName, "grok-4.6-build");
  assert.equal(snapshot.totals.totalTokens, 1200);
});

test("Grok local reader skips subagents, deduplicates forks, and exports no session content", async () => {
  const { readGrokUsage } = await import("../scripts/sync-account-quotas.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-local-usage-"));
  const timestamp = new Date(2026, 7, 26, 10, 0).getTime();
  const usageUpdate = (promptId, totalTokens) => JSON.stringify({
    timestamp: Math.floor(timestamp / 1000),
    params: {
      update: {
        sessionUpdate: "turn_completed",
        prompt_id: promptId,
        usage: {
          inputTokens: totalTokens - 100,
          outputTokens: 100,
          totalTokens,
          cachedReadTokens: 0,
          cacheCreationTokens: 0,
          reasoningTokens: 0,
          modelUsage: { "grok-4.6-build": { inputTokens: totalTokens - 100, outputTokens: 100, totalTokens } },
        },
      },
      _meta: { agentTimestampMs: timestamp },
    },
  });
  const writeSession = (name, relationship, lines) => {
    const directory = path.join(root, name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "events.jsonl"), `${JSON.stringify({ session_relationship: relationship })}\n`);
    fs.writeFileSync(path.join(directory, "updates.jsonl"), `${lines.join("\n")}\n`);
  };

  try {
    writeSession("primary", "primary", [
      JSON.stringify({ params: { update: { content: { text: "must-not-survive" } } } }),
      usageUpdate("same-prompt", 1200),
    ]);
    writeSession("fork", "primary", [usageUpdate("same-prompt", 1200)]);
    writeSession("child", "subagent", [usageUpdate("child-prompt", 900)]);

    const snapshot = readGrokUsage({ usage: { sessionRoot: root } });
    assert.equal(snapshot.recordCount, 1);
    assert.equal(snapshot.totals.totalTokens, 1200);
    assert.equal(snapshot.duplicateRecords, 1);
    assert.equal(snapshot.skippedNonPrimaryFiles, 1);
    assert.equal(JSON.stringify(snapshot).includes("must-not-survive"), false);
    assert.equal(JSON.stringify(snapshot).includes("same-prompt"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

test("Claude OAuth refresh rotates credentials without dropping unrelated fields", async () => {
  const { refreshClaudeCredential } = await import("../scripts/sync-account-quotas.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "token-ledger-claude-"));
  const credentialPath = path.join(directory, ".credentials.json");
  const original = {
    retainedRootField: { enabled: true },
    claudeAiOauth: {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: 1,
      scopes: ["user:profile"],
      subscriptionType: "max",
    },
  };
  fs.writeFileSync(credentialPath, JSON.stringify(original), "utf8");

  try {
    let request = null;
    const refreshed = await refreshClaudeCredential(original, {
      credentialPath,
      now: 1_000_000,
      fetchImpl: async (url, options) => {
        request = { url, body: JSON.parse(options.body) };
        return new Response(JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
          scope: "user:profile user:inference",
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const persisted = JSON.parse(fs.readFileSync(credentialPath, "utf8"));

    assert.equal(request.url, "https://platform.claude.com/v1/oauth/token");
    assert.deepEqual(request.body, {
      grant_type: "refresh_token",
      refresh_token: "old-refresh",
      client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
      scope: "user:profile",
    });
    assert.deepEqual(persisted.retainedRootField, { enabled: true });
    assert.equal(persisted.claudeAiOauth.subscriptionType, "max");
    assert.equal(persisted.claudeAiOauth.accessToken, "new-access");
    assert.equal(persisted.claudeAiOauth.refreshToken, "new-refresh");
    assert.equal(persisted.claudeAiOauth.expiresAt, 4_600_000);
    assert.deepEqual(refreshed.claudeAiOauth.scopes, ["user:profile", "user:inference"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Claude OAuth refresh adopts credentials rotated by another process", async () => {
  const { refreshClaudeCredential } = await import("../scripts/sync-account-quotas.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "token-ledger-claude-race-"));
  const credentialPath = path.join(directory, ".credentials.json");
  const original = { claudeAiOauth: { accessToken: "old-access", refreshToken: "old-refresh", expiresAt: 1 } };
  const rotated = { claudeAiOauth: { accessToken: "other-access", refreshToken: "other-refresh", expiresAt: Date.now() + 3600000 } };
  fs.writeFileSync(credentialPath, JSON.stringify(original), "utf8");

  try {
    const result = await refreshClaudeCredential(original, {
      credentialPath,
      fetchImpl: async () => {
        fs.writeFileSync(credentialPath, JSON.stringify(rotated), "utf8");
        return new Response("{}", { status: 400, headers: { "content-type": "application/json" } });
      },
    });
    assert.deepEqual(result, rotated);
    assert.deepEqual(JSON.parse(fs.readFileSync(credentialPath, "utf8")), rotated);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
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
