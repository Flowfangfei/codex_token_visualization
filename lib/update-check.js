const { spawn } = require("node:child_process");

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached = null;
let inFlight = null;

function parseGitHubRemote(value) {
  const remote = String(value || "").trim().replace(/\.git$/i, "");
  const match = remote.match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+)$/i);
  return match ? { owner: match[1], repo: match[2] } : null;
}

function runGit(root, args, timeoutMs = 3000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, { cwd: root, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise(stdout.trim());
      else rejectPromise(new Error(stderr.trim() || `git exited with code ${code}`));
    });
  });
}

function classifyComparison(payload, repository, localSha, branch) {
  const aheadBy = Number(payload?.ahead_by);
  const behindBy = Number(payload?.behind_by);
  const updateAvailable = payload?.status === "ahead" && aheadBy > 0 && (!Number.isFinite(behindBy) || behindBy === 0);
  if (!updateAvailable) return { checked: true, updateAvailable: false };
  const remoteSha = String(payload?.head_commit?.sha || payload?.commits?.at(-1)?.sha || "");
  if (!/^[a-f0-9]{40}$/i.test(remoteSha)) return { checked: true, updateAvailable: false };
  const repositoryUrl = `https://github.com/${repository.owner}/${repository.repo}`;
  return {
    checked: true,
    updateAvailable: true,
    updateId: remoteSha.slice(0, 12),
    aheadBy,
    branch,
    repositoryUrl,
    compareUrl: `${repositoryUrl}/compare/${localSha}...${encodeURIComponent(branch)}`,
  };
}

async function performUpdateCheck(root, options = {}) {
  const git = options.git || ((args) => runGit(root, args));
  const fetchImpl = options.fetchImpl || fetch;
  const branch = options.branch || process.env.UPDATE_CHECK_BRANCH || "main";
  const [localSha, remoteValue] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["config", "--get", "remote.origin.url"]),
  ]);
  if (!/^[a-f0-9]{40}$/i.test(localSha)) return { checked: false, updateAvailable: false };
  const repository = parseGitHubRemote(remoteValue);
  if (!repository) return { checked: false, updateAvailable: false };
  const endpoint = `https://api.github.com/repos/${repository.owner}/${repository.repo}/compare/${localSha}...${encodeURIComponent(branch)}`;
  const response = await fetchImpl(endpoint, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "AI-Token-Ledger-update-check",
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return { checked: false, updateAvailable: false };
  return classifyComparison(await response.json(), repository, localSha, branch);
}

async function checkForUpdate(root) {
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;
  if (inFlight) return inFlight;
  inFlight = performUpdateCheck(root)
    .catch(() => ({ checked: false, updateAvailable: false }))
    .then((value) => {
      cached = { cachedAt: Date.now(), value };
      return value;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

module.exports = {
  parseGitHubRemote,
  classifyComparison,
  performUpdateCheck,
  checkForUpdate,
};
