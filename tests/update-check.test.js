const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGitHubRemote, classifyComparison, performUpdateCheck } = require("../lib/update-check.js");

const LOCAL_SHA = "1".repeat(40);
const REMOTE_SHA = "2".repeat(40);
const REPOSITORY = { owner: "Zhen-WushuiLingchun", repo: "codex_token_visualization" };

test("parses HTTPS and SSH GitHub origin URLs only", () => {
  assert.deepEqual(parseGitHubRemote("https://github.com/owner/repo.git"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGitHubRemote("git@github.com:owner/repo.git"), { owner: "owner", repo: "repo" });
  assert.equal(parseGitHubRemote("https://example.com/owner/repo.git"), null);
});

test("shows an update only when the remote branch is strictly ahead", () => {
  const available = classifyComparison({
    status: "ahead",
    ahead_by: 3,
    behind_by: 0,
    head_commit: { sha: REMOTE_SHA },
  }, REPOSITORY, LOCAL_SHA, "main");
  assert.equal(available.updateAvailable, true);
  assert.equal(available.aheadBy, 3);
  assert.equal(available.updateId, REMOTE_SHA.slice(0, 12));

  for (const status of ["identical", "behind", "diverged"]) {
    assert.equal(classifyComparison({ status, ahead_by: 3, behind_by: 1 }, REPOSITORY, LOCAL_SHA, "main").updateAvailable, false);
  }
});

test("network and GitHub API failures remain silent", async () => {
  const git = async (args) => args.includes("HEAD") ? LOCAL_SHA : "https://github.com/owner/repo.git";
  const unavailable = await performUpdateCheck(".", {
    git,
    fetchImpl: async () => ({ ok: false }),
  });
  assert.deepEqual(unavailable, { checked: false, updateAvailable: false });
});
