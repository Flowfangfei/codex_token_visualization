const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("browser and collectors use Beijing day boundaries independently of host timezone", () => {
  for (const file of ["web/app.js", "scripts/sync-account-quotas.mjs"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const fn = source.match(/function localDateKey\(date = new Date\(\)\) \{[\s\S]*?\n\}/)[0];
    const dateKey = vm.runInNewContext(fn + "; localDateKey");
    assert.equal(dateKey(new Date("2026-09-21T15:30:00Z")), "2026-09-21");
    assert.equal(dateKey(new Date("2026-09-21T16:00:00Z")), "2026-09-22");
  }
});

test("ledger converts timestamp dates using Beijing time", async () => {
  const { mergeUsageSnapshotHistory } = await import("../scripts/usage-storage.mjs");
  const result = mergeUsageSnapshotHistory([], { daily: [
    { date: "2026-09-21T15:30:00Z", totalTokens: 1 },
    { date: "2026-09-21T16:00:00Z", totalTokens: 2 },
  ], totals: { totalTokens: 3 } });
  assert.deepEqual(result.daily.map(day => day.date), ["2026-09-21", "2026-09-22"]);
});
