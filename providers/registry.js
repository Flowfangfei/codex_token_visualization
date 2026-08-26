const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const USAGE_ROOT = process.env.USAGE_LOG_ROOT || path.join(ROOT, "usage-logs");
const APP_DATA = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const DEEPSEEK_HARNESS_ROOT = process.env.DEEPSEEK_HARNESS_ROOT || "D:\\deepseek-harness";
const DEEPSEEK_HARNESS_HOME = process.env.DEEPSEEK_HARNESS_HOME
  || path.join(DEEPSEEK_HARNESS_ROOT, ".dsh-home");
const DEEPSEEK_HARNESS_SESSION_ROOT = process.env.DEEPSEEK_HARNESS_SESSION_ROOT
  || path.join(DEEPSEEK_HARNESS_HOME, "sessions");
const GROK_HOME = process.env.GROK_HOME || path.join(os.homedir(), ".grok");
const GROK_SESSION_ROOT = process.env.GROK_SESSION_ROOT || path.join(GROK_HOME, "sessions");
const GROK_CLI_PATH = process.env.GROK_CLI_PATH
  || path.join(GROK_HOME, "bin", process.platform === "win32" ? "grok.exe" : "grok");

function usageDirectory(id, envName) {
  return process.env[envName] || path.join(USAGE_ROOT, id, "daily");
}

function provider(definition) {
  return Object.freeze({
    navigation: true,
    forecast: true,
    resetCredits: false,
    ...definition,
  });
}

const PROVIDERS = Object.freeze([
  provider({
    id: "codex",
    label: "Codex",
    shortLabel: "Codex",
    tone: "codex",
    color: "#9b4732",
    planLabel: "ChatGPT Pro 5x",
    subtitle: "Codex 本地 JSONL",
    trendTitle: "Codex 最近使用量",
    breakdownTitle: "Codex Token 构成",
    resetCredits: true,
    detectPaths: [process.env.CODEX_AUTH_PATH || path.join(os.homedir(), ".codex", "auth.json")],
    usage: {
      adapter: "ccusage",
      filePrefix: "codex-usage",
      ccusageArgs: ["codex", "daily"],
      logRoot: usageDirectory("codex", "CODEX_USAGE_LOG_DIR"),
      legacyRoots: [path.join(ROOT, "codex-usage-logs", "daily")],
    },
    quota: {
      adapter: "codex-app-server",
      discoverWindows: true,
      minimumForecastWindowMins: 10080,
      windows: [
        { name: "primary", label: "主要额度" },
        { name: "secondary", label: "次要额度" },
      ],
    },
    sourceDescription: "ccusage codex daily + Codex app-server",
  }),
  provider({
    id: "claude",
    label: "Claude Code",
    shortLabel: "Claude",
    tone: "claude",
    color: "#b36b37",
    planLabel: "Claude Max 5x",
    subtitle: "Claude Code 本地 JSONL",
    trendTitle: "Claude Code 最近使用量",
    breakdownTitle: "Claude Token 构成",
    detectPaths: [path.join(os.homedir(), ".claude")],
    usage: {
      adapter: "ccusage",
      filePrefix: "claude-usage",
      ccusageArgs: ["claude", "daily"],
      logRoot: usageDirectory("claude", "CLAUDE_USAGE_LOG_DIR"),
    },
    quota: {
      adapter: "claude-oauth",
      discoverWindows: true,
      minimumForecastWindowMins: 10080,
      windows: [
        { name: "five_hour", label: "5 小时额度", windowDurationMins: 300, windowKind: "rolling" },
        { name: "seven_day", label: "周总额度", windowDurationMins: 10080, windowKind: "weekly" },
        { name: "seven_day_opus", label: "Opus 周额度", windowDurationMins: 10080, windowKind: "weekly", modelPatterns: ["opus"] },
        { name: "seven_day_sonnet", label: "Sonnet 周额度", windowDurationMins: 10080, windowKind: "weekly", modelPatterns: ["sonnet"] },
        { name: "seven_day_fable", label: "Fable 周额度", windowDurationMins: 10080, windowKind: "weekly", modelPatterns: ["fable"] },
      ],
    },
    sourceDescription: "ccusage claude daily + Claude OAuth usage",
  }),
  provider({
    id: "cursor",
    label: "Cursor",
    shortLabel: "Cursor",
    tone: "cursor",
    color: "#2f6970",
    planLabel: "Cursor Pro",
    subtitle: "Cursor 账户使用事件",
    trendTitle: "Cursor 最近使用量",
    breakdownTitle: "Cursor Token 构成",
    detectPaths: [path.join(APP_DATA, "Cursor"), path.join(os.homedir(), ".cursor")],
    usage: {
      adapter: "cursor-events",
      filePrefix: "cursor-usage",
      logRoot: usageDirectory("cursor", "CURSOR_USAGE_LOG_DIR"),
    },
    quota: {
      adapter: "cursor-account",
      discoverWindows: true,
      minimumForecastWindowMins: 10080,
      windows: [
        { name: "included_pro_total", label: "Included in Pro", windowKind: "billing" },
        { name: "auto_composer", label: "Auto + Composer", windowKind: "breakdown", selectable: false },
        { name: "api", label: "API", windowKind: "breakdown", selectable: false },
      ],
    },
    sourceDescription: "Cursor local account database + account usage APIs",
  }),
  provider({
    id: "kimi",
    label: "Kimi",
    shortLabel: "Kimi",
    tone: "kimi",
    color: "#55784f",
    planLabel: "Kimi Code",
    subtitle: "Kimi CLI + 桌面应用本地日志",
    trendTitle: "Kimi 最近使用量",
    breakdownTitle: "Kimi Token 构成",
    detectPaths: [
      process.env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code"),
      process.env.KIMI_DESKTOP_CODE_HOME
        || path.join(APP_DATA, "kimi-desktop", "daimon-share", "daimon", "runtime", "kimi-code", "home"),
    ],
    usage: {
      adapter: "kimi-local-wire",
      filePrefix: "kimi-usage",
      logRoot: usageDirectory("kimi", "KIMI_USAGE_LOG_DIR"),
    },
    quota: {
      adapter: "kimi-managed-usage",
      discoverWindows: true,
      minimumForecastWindowMins: 10080,
      windows: [
        { name: "monthly_membership", label: "月度总额", windowDurationMins: 43200, windowKind: "monthly" },
        { name: "weekly_limit", label: "Kimi Code 周额度", windowDurationMins: 10080, windowKind: "weekly" },
        { name: "limit_1", label: "Kimi Code 5 小时额度", windowDurationMins: 300, windowKind: "rolling" },
      ],
    },
    sourceDescription: "Kimi Code CLI and desktop wire logs + Code and membership usage APIs",
  }),
  provider({
    id: "opencode",
    label: "OpenCode",
    shortLabel: "OpenCode",
    tone: "opencode",
    color: "#6b5f86",
    planLabel: null,
    subtitle: "OpenCode 本地会话数据库",
    trendTitle: "OpenCode 最近使用量",
    breakdownTitle: "OpenCode Token 构成",
    forecast: false,
    detectPaths: [
      process.env.OPENCODE_DB_PATH || path.join(os.homedir(), ".local", "share", "opencode", "opencode.db"),
    ],
    usage: {
      adapter: "opencode-sqlite",
      filePrefix: "opencode-usage",
      logRoot: usageDirectory("opencode", "OPENCODE_USAGE_LOG_DIR"),
    },
    quota: null,
    sourceDescription: "OpenCode local SQLite assistant message usage",
  }),
  provider({
    id: "deepseek-harness",
    label: "DeepSeek Harness",
    shortLabel: "DeepSeek",
    tone: "deepseek",
    color: "#4c64b8",
    planLabel: null,
    subtitle: "DeepSeek Harness 本地会话计量",
    trendTitle: "DeepSeek Harness 最近使用量",
    breakdownTitle: "DeepSeek Harness Token 构成",
    forecast: false,
    detectPaths: [DEEPSEEK_HARNESS_SESSION_ROOT],
    usage: {
      adapter: "deepseek-harness-zstd",
      filePrefix: "deepseek-harness-usage",
      logRoot: usageDirectory("deepseek-harness", "DEEPSEEK_HARNESS_USAGE_LOG_DIR"),
      sessionRoot: DEEPSEEK_HARNESS_SESSION_ROOT,
      providerIds: String(process.env.DEEPSEEK_HARNESS_PROVIDER_IDS || "deepseek,deepseek-official")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    },
    quota: null,
    sourceDescription: "DeepSeek Harness local Zstandard session usage events",
  }),
  provider({
    id: "grok",
    label: "Grok",
    shortLabel: "Grok",
    tone: "grok",
    color: "#5a6573",
    planLabel: null,
    subtitle: "Grok CLI 本机会话计量",
    trendTitle: "Grok 最近使用量",
    breakdownTitle: "Grok Token 构成",
    forecast: false,
    detectPaths: [GROK_CLI_PATH, GROK_SESSION_ROOT],
    usage: {
      adapter: "grok-local-jsonl",
      filePrefix: "grok-usage",
      logRoot: usageDirectory("grok", "GROK_USAGE_LOG_DIR"),
      sessionRoot: GROK_SESSION_ROOT,
    },
    quota: null,
    sourceDescription: "Grok CLI local primary-session token records",
  }),
]);

const AGGREGATE_PROVIDER = provider({
  id: "all",
  label: "All Agents",
  shortLabel: "All",
  tone: "all",
  color: "#2d2822",
  planLabel: null,
  subtitle: "ccusage 聚合快照",
  navigation: false,
  forecast: false,
  usage: {
    adapter: "ccusage",
    filePrefix: "all-usage",
    ccusageArgs: ["daily"],
    logRoot: usageDirectory("all", "ALL_USAGE_LOG_DIR"),
    autoExport: false,
  },
  quota: null,
  sourceDescription: "ccusage daily aggregate",
});

const ALL_SOURCES = Object.freeze([...PROVIDERS, AGGREGATE_PROVIDER]);
const AUTO_EXPORT_SOURCES = Object.freeze(
  ALL_SOURCES.filter((entry) => entry.usage.adapter === "ccusage" && entry.usage.autoExport !== false)
);

function getProvider(id, { includeAggregate = true } = {}) {
  const candidates = includeAggregate ? ALL_SOURCES : PROVIDERS;
  return candidates.find((entry) => entry.id === id) || null;
}

function publicProvider(entry) {
  return {
    id: entry.id,
    label: entry.label,
    shortLabel: entry.shortLabel,
    tone: entry.tone,
    color: entry.color,
    navigation: entry.navigation,
    forecast: entry.forecast,
    resetCredits: entry.resetCredits,
    subtitle: entry.subtitle,
    trendTitle: entry.trendTitle || "最近使用量",
    breakdownTitle: entry.breakdownTitle || "Token 构成",
  };
}

module.exports = {
  ROOT,
  USAGE_ROOT,
  PROVIDERS,
  AGGREGATE_PROVIDER,
  ALL_SOURCES,
  AUTO_EXPORT_SOURCES,
  getProvider,
  publicProvider,
};
