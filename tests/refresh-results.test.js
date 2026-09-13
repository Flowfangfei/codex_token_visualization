const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeRefreshResults } = require("../lib/refresh-results.js");

test("usage export success cannot conceal a reset inventory failure", () => {
  const summary = summarizeRefreshResults([
    { source: "codex", ok: true }, { source: "quota:codex", ok: true },
    { source: "reset:codex", ok: false, error: "fetch failed" },
  ]);
  assert.equal(summary.ok, false);
  assert.equal(summary.partial, true);
  assert.equal(summary.results.at(-1).error, "fetch failed");
});

test("provider partial warnings prevent an all-success summary", () => {
  const summary = summarizeRefreshResults([{ source: "quota:kimi", ok: true, partial: true }]);
  assert.equal(summary.ok, false);
  assert.equal(summary.partial, true);
});

test("empty, failed and complete refreshes have distinct statuses", () => {
  assert.deepEqual(summarizeRefreshResults([]), { ok: false, partial: false, results: [] });
  assert.equal(summarizeRefreshResults([{ ok: false }]).partial, false);
  const summary = summarizeRefreshResults([{ source: "reset:grok-build", ok: true }]);
  assert.equal(summary.ok, true);
  assert.equal(summary.partial, false);
});
