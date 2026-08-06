const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  defaultDisplaySettings,
  normalizeDisplaySettings,
  readDisplaySettings,
  writeDisplaySettings,
} = require("../lib/display-settings.js");

const providers = [
  { id: "codex", navigation: true },
  { id: "claude", navigation: true },
  { id: "opencode", navigation: true },
  { id: "all", navigation: false },
];

test("display settings default to every navigable provider", () => {
  assert.deepEqual(defaultDisplaySettings(providers), {
    version: 1,
    visibleProviders: ["codex", "claude", "opencode"],
    hiddenProviders: [],
  });
});

test("display settings discard unknown and duplicate provider ids", () => {
  assert.deepEqual(normalizeDisplaySettings({
    visibleProviders: ["opencode", "unknown", "opencode", "codex"],
  }, providers).visibleProviders, ["codex", "opencode"]);
});

test("display settings keep at least one provider visible", () => {
  assert.deepEqual(
    normalizeDisplaySettings({ visibleProviders: [] }, providers).visibleProviders,
    ["codex"],
  );
});

test("newly registered providers become visible without changing saved settings", () => {
  const stored = normalizeDisplaySettings({ visibleProviders: ["codex"] }, providers.slice(0, 2));
  assert.deepEqual(
    normalizeDisplaySettings(stored, providers).visibleProviders,
    ["codex", "opencode"],
  );
});

test("display settings persist without exposing non-provider values", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "token-ledger-display-"));
  const filePath = path.join(directory, "display-settings.json");
  try {
    writeDisplaySettings(filePath, { visibleProviders: ["opencode", "bad-id"] }, providers);
    assert.deepEqual(readDisplaySettings(filePath, providers), {
      version: 1,
      visibleProviders: ["opencode"],
      hiddenProviders: ["codex", "claude"],
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
