(function attachBilling(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Billing = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createBilling() {
  "use strict";

  const PRICE_AS_OF = "2026-09-23";
  const CURRENCY = "USD";
  const TOKEN_SCALE = 1_000_000;
  const CNY_PER_USD = 1.5 / 0.22;
  const VENDOR_PREFIXES = new Set([
    "openai",
    "chatgpt",
    "codex",
    "anthropic",
    "claude",
    "moonshot",
    "moonshotai",
    "kimi",
    "kimi-code",
    "zhipu",
    "zhipuai",
    "deepseek",
    "deepseek-official",
    "xai",
    "x-ai",
    "spacexai",
    "grok",
    "cursor",
    "opencode",
    "google",
    "gemini",
    "meta",
  ]);

  const RATES = Object.freeze([
    rate({
      "id": "gpt-6-sol",
      "vendor": "openai",
      "label": "GPT-6 Sol",
      "input": 2,
      "cacheRead": 0.2,
      "cacheWrite": 2.5,
      "output": 10,
      "longContext": {
        "threshold": 272000,
        "input": 4,
        "cacheRead": 0.4,
        "cacheWrite": 5,
        "output": 15
      },
      "source": "https://developers.openai.com/api/docs/pricing",
      "routes": [
        "gpt-6-sol"
      ],
      "aliases": [
        "gpt-6-sol"
      ]
    }),
    rate({
      "id": "gpt-6-luna",
      "vendor": "openai",
      "label": "GPT-6 Luna",
      "input": 0.1,
      "cacheRead": 0.01,
      "cacheWrite": 0.125,
      "output": 0.5,
      "longContext": {
        "threshold": 272000,
        "input": 0.2,
        "cacheRead": 0.02,
        "cacheWrite": 0.25,
        "output": 0.75
      },
      "source": "https://developers.openai.com/api/docs/pricing",
      "routes": [
        "gpt-6-luna"
      ],
      "aliases": [
        "gpt-6-luna"
      ]
    }),
    rate({
      "id": "claude-opus-5.5",
      "vendor": "anthropic",
      "label": "Claude Opus 5.5",
      "aliases": [
        "claude-opus-5-5",
        "opus-5.5",
        "opus-5-5"
      ],
      "input": 4,
      "cacheRead": 0.2,
      "cacheWrite": 5,
      "output": 20,
      "source": "https://platform.claude.com/docs/en/about-claude/pricing",
      "routes": [
        "claude-opus-5.5"
      ]
    }),
    rate({
      "id": "grok-4.7",
      "vendor": "xai",
      "label": "Grok 4.7",
      "input": 2,
      "cacheRead": 0.5,
      "output": 6,
      "longContext": {
        "threshold": 200000,
        "input": 4,
        "cacheRead": 1,
        "output": 12
      },
      "source": "https://docs.x.ai/developers/pricing",
      "routes": [
        "grok-4.7"
      ],
      "aliases": [
        "grok-4.7"
      ]
    }),
    rate({
      "id": "cursor-grok-4.7-fast",
      "vendor": "cursor",
      "label": "Grok 4.7 Fast · Cursor / Grok Build",
      "routes": [
        "grok-4.7-fast"
      ],
      "aliases": [
        "grok-4.7-fast",
        "grok-4-7-fast"
      ],
      "input": 4,
      "cacheRead": 1,
      "output": 12,
      "longContext": {
        "threshold": 200000,
        "input": 6,
        "cacheRead": 1.5,
        "output": 18
      },
      "note": "Cursor / Grok Build 专用；无公共 xAI API Fast 路由。",
      "source": "https://docs.x.ai/developers/pricing"
    }),
    rate({
      "id": "glm-5.3",
      "vendor": "zhipu",
      "label": "GLM-5.3",
      "currency": "CNY",
      "routes": [
        "glm-5.3"
      ],
      "input": 8,
      "cacheRead": 2,
      "output": 28,
      "source": "https://bigmodel.cn/pricing",
      "aliases": [
        "glm-5.3"
      ]
    }),
    rate({
      "id": "glm-5.3-flash",
      "vendor": "zhipu",
      "label": "GLM-5.3-Flash",
      "currency": "CNY",
      "routes": [
        "glm-5.3-flash"
      ],
      "input": 0.8,
      "cacheRead": 0.23,
      "output": 2.8,
      "note": "官方 API 标准价，不含限时折扣。",
      "source": "https://bigmodel.cn/pricing",
      "aliases": [
        "glm-5.3-flash"
      ]
    }),
    rate({
      id: "volcengine/glm-5-3-flash-260828",
      vendor: "volcengine",
      label: "GLM-5.3-Flash",
      currency: "CNY",
      routes: ["volcengine/glm-5-3-flash-260828"],
      input: 0.8,
      cacheRead: 0.23,
      output: 2.8,
      note: "按智谱官方 API 直连标准价估算，单位为元/百万 Token；2026-09-23 核验，不含限时折扣。实际调用路由仍为火山方舟，此处不表示方舟实际扣款。",
      source: "https://bigmodel.cn/pricing",
    }),
    rate({
      id: "gpt-6-astra",
      vendor: "openai",
      label: "GPT-6 Astra",
      routes: ["gpt-6-astra"],
      aliases: ["gpt-6-astra", "astra"],
      input: 10,
      cacheRead: 1,
      cacheWrite: 12.5,
      output: 50,
      longContext: { threshold: 272000, input: 20, cacheRead: 2, cacheWrite: 25, output: 75 },
      note: "输入超过 272K token 时，整次请求采用长上下文价。日账本没有单次请求长度，因此费用估算使用标准价。",
      source: "https://developers.openai.com/api/docs/pricing",
    }),
    rate({
      id: "gpt-5.6-sol",
      vendor: "openai",
      label: "GPT-5.6 Sol",
      routes: ["gpt-5.6-sol", "gpt-5.6"],
      aliases: ["gpt-5.6-sol", "gpt-5.6"],
      input: 4,
      cacheRead: 0.4,
      cacheWrite: 5,
      output: 20,
      longContext: { threshold: 272000, input: 8, cacheRead: 0.8, cacheWrite: 10, output: 30 },
      note: "2026-08-21 起的促销价，至少用到 2026-11-21。长上下文价未按日账本拆分。",
      source: "https://developers.openai.com/api/docs/pricing",
    }),
    rate({
      id: "gpt-5.6-terra",
      vendor: "openai",
      label: "GPT-5.6 Terra",
      routes: ["gpt-5.6-terra"],
      aliases: ["gpt-5.6-terra"],
      input: 2,
      cacheRead: 0.2,
      cacheWrite: 2.5,
      output: 12,
      longContext: { threshold: 272000, input: 4, cacheRead: 0.4, cacheWrite: 5, output: 18 },
      source: "https://developers.openai.com/api/docs/pricing",
    }),
    rate({
      id: "gpt-5.6-luna",
      vendor: "openai",
      label: "GPT-5.6 Luna",
      routes: ["gpt-5.6-luna"],
      aliases: ["gpt-5.6-luna"],
      input: 0.2,
      cacheRead: 0.02,
      cacheWrite: 0.25,
      output: 1.2,
      longContext: { threshold: 272000, input: 0.4, cacheRead: 0.04, cacheWrite: 0.5, output: 1.8 },
      source: "https://developers.openai.com/api/docs/pricing",
    }),
    rate({
      id: "gpt-5.5",
      vendor: "openai",
      label: "GPT-5.5",
      routes: ["gpt-5.5", "chat-latest"],
      aliases: ["gpt-5.5"],
      input: 5,
      cacheRead: 0.5,
      cacheWrite: 6.25,
      output: 30,
      note: "缓存写入按 GPT-5.6 官方表的 1.25× 输入价补齐；ChatGPT Rate Card 只公布了输入、缓存读取和输出。",
      source: "https://help.openai.com/articles/20001415",
    }),
    rate({
      id: "gpt-5.5-pro",
      vendor: "openai",
      label: "GPT-5.5 Pro",
      routes: ["gpt-5.5-pro"],
      aliases: ["gpt-5.5-pro"],
      input: 30,
      cacheRead: null,
      cacheWrite: null,
      output: 180,
      source: "https://help.openai.com/articles/20001415",
    }),
    rate({
      id: "claude-fable-5.1",
      vendor: "anthropic",
      label: "Claude Fable 5.1",
      routes: ["claude-fable-5-1"],
      aliases: ["claude-fable-5-1", "claude-fable-5.1", "fable-5-1", "fable-5.1", "fable"],
      input: 10,
      cacheRead: 0.25,
      cacheWrite: 12.5,
      output: 50,
      note: "5 分钟缓存写入价；1 小时缓存写入为 $20。",
      source: "https://platform.claude.com/docs/en/about-claude/pricing",
    }),
    rate({
      id: "claude-fable-5",
      vendor: "anthropic",
      label: "Claude Fable 5",
      routes: ["claude-fable-5"],
      aliases: ["claude-fable-5", "fable-5"],
      input: 10,
      cacheRead: 1,
      cacheWrite: 12.5,
      output: 50,
      source: "https://platform.claude.com/docs/en/about-claude/models/overview",
    }),
    rate({
      id: "claude-opus-5",
      vendor: "anthropic",
      label: "Claude Opus 5",
      routes: ["claude-opus-5"],
      aliases: ["claude-opus-5", "opus-5", "claude-opus-4-8", "opus-4-8", "opus-4.8", "opus"],
      input: 5,
      cacheRead: 0.5,
      cacheWrite: 6.25,
      output: 25,
      source: "https://platform.claude.com/docs/en/about-claude/models/overview",
    }),
    rate({
      id: "claude-sonnet-5",
      vendor: "anthropic",
      label: "Claude Sonnet 5",
      routes: ["claude-sonnet-5"],
      aliases: ["claude-sonnet-5", "sonnet-5", "claude-sonnet-4-6", "sonnet-4-6", "sonnet"],
      input: 2,
      cacheRead: 0.2,
      cacheWrite: 2.5,
      output: 10,
      note: "官方已确认 $2/$10 为标准价，原定 2026-09-01 的涨价不再执行。",
      source: "https://platform.claude.com/docs/en/about-claude/pricing",
    }),
    rate({
      id: "claude-haiku-4.5",
      vendor: "anthropic",
      label: "Claude Haiku 4.5",
      routes: ["claude-haiku-4-5"],
      aliases: ["claude-haiku-4-5", "claude-haiku-4.5", "haiku-4-5", "haiku-4.5", "haiku"],
      input: 1,
      cacheRead: 0.1,
      cacheWrite: 1.25,
      output: 5,
      source: "https://platform.claude.com/docs/en/about-claude/models/overview",
    }),
    rate({
      id: "kimi-k3",
      vendor: "moonshot",
      label: "Kimi K3",
      routes: ["kimi-k3", "k3", "k3-256k"],
      aliases: ["kimi-k3", "k3", "k3-256k", "k3-agent", "kimi-k3-agent"],
      currency: "CNY",
      input: 20,
      cacheRead: 2,
      cacheWrite: null,
      output: 100,
      note: "Kimi Code 使用 k3 或 k3-256k；关闭 Thinking 会转到 K2.6。",
      source: "https://platform.kimi.com/",
    }),
    rate({
      id: "kimi-k2.7-code",
      vendor: "moonshot",
      label: "Kimi K2.7 Code",
      routes: ["kimi-k2.7-code", "kimi-for-coding", "kimi-for-coding-highspeed"],
      aliases: ["kimi-for-coding", "kimi-for-coding-highspeed", "k2.7-code", "k2.7", "kimi-k2.7-code"],
      currency: "CNY",
      input: 6.5,
      cacheRead: 1.3,
      cacheWrite: null,
      output: 27,
      note: "Kimi Code 的 HighSpeed 使用同一模型，按会员额度约 3 倍消耗；关闭 Thinking 会转到 K2.6。",
      source: "https://platform.kimi.com/",
    }),
    rate({
      id: "kimi-k2.6",
      vendor: "moonshot",
      label: "Kimi K2.6",
      routes: ["kimi-k2.6"],
      aliases: ["kimi-k2.6", "k2.6"],
      currency: "CNY",
      input: 6.5,
      cacheRead: 1.1,
      cacheWrite: null,
      output: 27,
      source: "https://platform.kimi.com/",
    }),
    rate({
      id: "deepseek-flash",
      vendor: "deepseek",
      label: "DeepSeek V4.1 Flash",
      routes: ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
      aliases: ["deepseek-flash", "deepseek-v4.1-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "v4.1-flash", "v4-flash"],
      currency: "CNY",
      peakTimezone: "Asia/Shanghai",
      input: 1,
      cacheRead: 0.02,
      cacheWrite: null,
      output: 4,
      peak: { input: 2, cacheRead: 0.04, output: 8 },
      note: "旧路由 deepseek-v4-flash 与视觉实验路由已转到 V4.1 Flash。工作日北京时间 9:00–12:00、14:00–18:00 为高峰。",
      source: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
    }),
    rate({
      id: "deepseek-v4-pro",
      vendor: "deepseek",
      label: "DeepSeek V4 Pro",
      routes: ["deepseek-v4-pro"],
      aliases: ["deepseek-v4-pro", "v4-pro"],
      currency: "CNY",
      peakTimezone: "Asia/Shanghai",
      input: 4.5,
      cacheRead: 0.15,
      cacheWrite: null,
      output: 13.5,
      peak: { input: 9, cacheRead: 0.3, output: 27 },
      note: "2026-09-23 官方价表仍列为 V4-Pro-0813，按 Pro 峰谷价估算。",
      source: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
    }),
    rate({
      id: "grok-4.6",
      vendor: "xai",
      label: "Grok 4.6",
      routes: ["grok-4.6"],
      aliases: ["grok-4.6", "grok-4.6-build", "grok-4-6"],
      input: 2,
      cacheRead: 0.5,
      cacheWrite: null,
      output: 6,
      longContext: { threshold: 200000, input: 4, cacheRead: 1, output: 12 },
      note: "提示达到 200K 后整单按长上下文价。日账本无法还原单次提示长度，估算用标准价。",
      source: "https://docs.x.ai/developers/pricing",
    }),
    rate({
      id: "grok-4.5",
      vendor: "xai",
      label: "Grok 4.5",
      routes: ["grok-4.5"],
      aliases: ["grok-4.5", "grok-4-5"],
      input: 2,
      cacheRead: 0.3,
      cacheWrite: null,
      output: 6,
      longContext: { threshold: 200000, input: 4, cacheRead: 0.6, output: 12 },
      source: "https://docs.x.ai/developers/pricing",
    }),
    rate({
      id: "grok-4.3",
      vendor: "xai",
      label: "Grok 4.3",
      routes: ["grok-4.3"],
      aliases: ["grok-4.3", "grok-4-3", "grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning", "grok-4-fast-reasoning", "grok-4-fast-non-reasoning", "grok-4-0709", "grok-code-fast-1", "grok-3"],
      input: 1.25,
      cacheRead: 0.2,
      cacheWrite: null,
      output: 2.5,
      longContext: { threshold: 200000, input: 2.5, cacheRead: 0.4, output: 5 },
      note: "2026-05-15 下线的一组旧路由目前由 Grok 4.3 提供服务。",
      source: "https://docs.x.ai/developers/pricing",
    }),
    rate({
      id: "grok-build-0.1",
      vendor: "xai",
      label: "Grok Build 0.1",
      routes: ["grok-build-0.1"],
      aliases: ["grok-build-0.1"],
      input: 1,
      cacheRead: 0.2,
      cacheWrite: null,
      output: 2,
      longContext: { threshold: 200000, input: 2, cacheRead: 0.4, output: 4 },
      source: "https://docs.x.ai/developers/pricing",
    }),
    rate({
      id: "composer-2.5",
      vendor: "cursor",
      label: "Cursor Composer 2.5",
      routes: ["composer-2.5"],
      aliases: ["composer-2.5", "composer-2-5"],
      input: 0.5,
      cacheRead: 0.2,
      cacheWrite: null,
      output: 2.5,
      source: "https://cursor.com/docs/models-and-pricing",
    }),
    rate({
      id: "composer-2.5-fast",
      vendor: "cursor",
      label: "Cursor Composer 2.5 Fast",
      routes: ["composer-2.5-fast"],
      aliases: ["composer-2.5-fast", "composer-2-5-fast"],
      input: 3,
      cacheRead: 0.5,
      cacheWrite: null,
      output: 15,
      note: "Cursor 产品中的默认快速变体。",
      source: "https://cursor.com/docs/models-and-pricing",
    }),
    rate({
      id: "cursor-grok-4.6-fast",
      vendor: "cursor",
      label: "Cursor Grok 4.6 Fast",
      routes: ["cursor-grok-4.6-fast"],
      aliases: ["cursor-grok-4.6-fast", "cursor-grok-4-6-fast", "grok-4.6-fast"],
      input: 4,
      cacheRead: 1,
      cacheWrite: null,
      output: 12,
      source: "https://cursor.com/docs/models-and-pricing",
    }),
    rate({
      id: "cursor-grok-4.5",
      vendor: "cursor",
      label: "Cursor Grok 4.5",
      routes: ["cursor-grok-4.5"],
      aliases: ["cursor-grok-4.5", "cursor-grok-4.5-high", "cursor-grok-4-5"],
      input: 2,
      cacheRead: 0.5,
      cacheWrite: null,
      output: 6,
      source: "https://cursor.com/docs/models-and-pricing",
    }),
    rate({
      id: "cursor-grok-4.5-fast",
      vendor: "cursor",
      label: "Cursor Grok 4.5 Fast",
      routes: ["cursor-grok-4.5-fast"],
      aliases: ["cursor-grok-4.5-fast", "cursor-grok-4.5-high-fast", "cursor-grok-4-5-fast", "grok-4.5-fast"],
      input: 4,
      cacheRead: 1,
      cacheWrite: null,
      output: 18,
      source: "https://cursor.com/docs/models-and-pricing",
    }),
    rate({
      id: "gemini-3.1-pro",
      vendor: "google",
      label: "Gemini 3.1 Pro",
      routes: ["gemini-3.1-pro-preview"],
      aliases: ["gemini-3.1-pro-preview", "gemini-3.1-pro", "gemini-3-1-pro"],
      input: 2,
      cacheRead: 0.2,
      cacheWrite: null,
      output: 12,
      note: "Cursor Other Models 池公开价；输入超过 200K 时 Google 直连 API 采用长上下文价。",
      source: "https://cursor.com/docs/models-and-pricing",
    }),
    rate({
      id: "gemini-3.8-flash",
      vendor: "google",
      label: "Gemini 3.8 Flash",
      routes: ["gemini-3.8-flash"],
      aliases: ["gemini-3.8-flash", "gemini-3-8-flash"],
      input: 0.75,
      cacheRead: 0.075,
      cacheWrite: null,
      output: 3.5,
      note: "Cursor Other Models 池公开价。Google 直连 API 的当前输出价为 $3.75。",
      source: "https://cursor.com/docs/models-and-pricing",
    }),
    rate({
      id: "muse-spark-1.3",
      vendor: "meta",
      label: "Meta Muse Spark 1.3",
      routes: ["muse-spark-1.3"],
      aliases: ["muse-spark-1.3", "muse-spark-1-3"],
      input: 1.25,
      cacheRead: 0.15,
      cacheWrite: null,
      output: 4.25,
      source: "https://cursor.com/docs/models-and-pricing",
    }),
  ]);

  const ROUTES = Object.freeze([
    Object.freeze({
      id: "cursor-auto-smart",
      provider: "cursor",
      route: "auto-smart",
      destinations: Object.freeze(["gpt-5.5", "claude-opus-5", "grok-4.5", "claude-fable-5-1"]),
      note: "Cursor Router 按 Cost、Balance 或 Intelligence 模式选择模型，并按实际路由模型计费。Teams 与 Enterprise 的第三方模型另收 Cursor Token Rate。",
      source: "https://prod.cursor.com/help/models-and-usage/available-models",
    }),
    Object.freeze({
      id: "kimi-thinking-fallback",
      provider: "kimi",
      route: "k3 / k3-256k / kimi-for-coding",
      destinations: Object.freeze(["kimi-k2.6"]),
      note: "K3 或 K2.7 Code 关闭 Thinking 时转到 K2.6。",
      source: "https://www.kimi.com/code/docs/kimi-code/models.html",
    }),
    Object.freeze({
      id: "deepseek-flash-legacy-routes",
      provider: "deepseek-harness",
      route: "deepseek-v4-flash / deepseek-v4-flash-vision-exp",
      destinations: Object.freeze(["deepseek-flash"]),
      note: "旧 Flash 路由由 V4.1 Flash 提供服务；Pro 保持独立路由和价格。",
      source: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
    }),
  ]);

  const MATCHERS = RATES.flatMap((entry) => {
    const aliases = unique([entry.id, ...(entry.aliases || [])]);
    return aliases.map((alias) => ({ alias, rate: entry, length: alias.length }));
  }).sort((a, b) => b.length - a.length);

  function rate(entry) {
    return Object.freeze({
      id: entry.id,
      vendor: entry.vendor,
      label: entry.label,
      currency: entry.currency || "USD",
      peakTimezone: entry.peakTimezone || null,
      routes: Object.freeze([...(entry.routes || [entry.id])]),
      aliases: Object.freeze([...(entry.aliases || [])]),
      input: entry.input,
      cacheRead: entry.cacheRead ?? null,
      cacheWrite: entry.cacheWrite ?? null,
      output: entry.output,
      peak: entry.peak ? Object.freeze({ ...entry.peak }) : null,
      longContext: entry.longContext ? Object.freeze({ ...entry.longContext }) : null,
      redirect: entry.redirect ? Object.freeze({ ...entry.redirect }) : null,
      note: entry.note || null,
      source: entry.source,
    });
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function stripDisplayPrefix(value) {
    return String(value || "").replace(/^[^\n]+ · /, "");
  }

  function normalizeModelName(name) {
    let value = stripDisplayPrefix(name).trim().toLowerCase().replace(/_/g, "-");
    value = value.replace(/\\/g, "/");
    const parts = value.split("/").filter(Boolean);
    while (parts.length > 1 && VENDOR_PREFIXES.has(parts[0])) {
      parts.shift();
    }
    return parts.join("-");
  }

  function containsAlias(normalized, alias) {
    if (!normalized || !alias) return false;
    if (normalized === alias) return true;
    if (!normalized.includes(alias)) return false;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(normalized);
  }

  function matchRate(modelName, billingProvider) {
    const route = stripDisplayPrefix(modelName).trim().toLowerCase();
    if (billingProvider) {
      // OpenCode custom provider names are local aliases, not model vendors.
      const model = route.includes("/") ? route.slice(route.indexOf("/") + 1) : route;
      const scoped = RATES.find((entry) => entry.id === `${billingProvider}/${model}`);
      if (scoped) return scoped;
      const vendor = { openai: "openai", anthropic: "anthropic", deepseek: "deepseek", "deepseek-official": "deepseek", xai: "xai", zhipu: "zhipu", "zhipuai": "zhipu", "zhipuai-coding-plan": "zhipu", moonshot: "moonshot", moonshotai: "moonshot" }[billingProvider];
      return vendor ? RATES.find((entry) => entry.vendor === vendor && entry.routes.includes(model)) || null : null;
    }
    if (route.startsWith("volcengine/")) {
      return RATES.find((entry) => entry.id === route) || null;
    }
    const normalized = normalizeModelName(modelName);
    if (!normalized) return null;
    for (const matcher of MATCHERS) {
      if (normalized === matcher.alias) return matcher.rate;
    }
    for (const matcher of MATCHERS) {
      if (containsAlias(normalized, matcher.alias)) return matcher.rate;
    }
    return null;
  }

  function usageParts(usage) {
    const input = numberOrZero(usage?.inputTokens);
    const cacheRead = numberOrZero(usage?.cacheReadTokens ?? usage?.cachedInputTokens);
    const cacheWrite = numberOrZero(usage?.cacheCreationTokens);
    const output = numberOrZero(usage?.outputTokens);
    const explicit = numberOrZero(usage?.totalTokens);
    const tokens = explicit || input + cacheRead + cacheWrite + output;
    return { input, cacheRead, cacheWrite, output, tokens };
  }

  function rateAmount(rateEntry, field) {
    const value = rateEntry?.[field];
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function clockInZone(date, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    return {
      weekday: parts.weekday,
      minutes: Number(parts.hour) * 60 + Number(parts.minute),
    };
  }

  function isPeakAt(value, timeZone = "Asia/Shanghai") {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    const clock = clockInZone(date, timeZone);
    if (clock.weekday === "Sat" || clock.weekday === "Sun") return false;
    return (clock.minutes >= 9 * 60 && clock.minutes < 12 * 60)
      || (clock.minutes >= 14 * 60 && clock.minutes < 18 * 60);
  }

  function toUsd(amount, currency) {
    if (currency === "CNY") return Number(amount || 0) / CNY_PER_USD;
    return Number(amount || 0);
  }

  function pricedRate(rateEntry, at) {
    if (!rateEntry) return null;
    const instant = at == null ? new Date() : at instanceof Date ? at : new Date(at);
    const redirectActive = rateEntry.redirect
      && !Number.isNaN(instant.getTime())
      && instant.getTime() >= new Date(rateEntry.redirect.effectiveAt).getTime();
    const routed = redirectActive
      ? RATES.find((entry) => entry.id === rateEntry.redirect.targetId) || rateEntry
      : rateEntry;
    const peak = routed.peak && at != null && isPeakAt(at, routed.peakTimezone || "Asia/Shanghai");
    if (!peak) {
      return { ...routed, routedFrom: redirectActive ? rateEntry.id : null, window: "off_peak" };
    }
    return {
      ...routed,
      input: routed.peak.input,
      cacheRead: routed.peak.cacheRead ?? routed.cacheRead,
      cacheWrite: routed.peak.cacheWrite ?? routed.cacheWrite,
      output: routed.peak.output,
      routedFrom: redirectActive ? rateEntry.id : null,
      window: "peak",
    };
  }

  function estimateUsageCost(usage, modelName = usage?.modelName || usage?.name, options = {}) {
    const parts = usageParts(usage);
    const matched = matchRate(modelName, usage?.billingProvider);
    const name = String(modelName || usage?.modelName || usage?.name || "unknown-model");
    if (usage?.timedBilling === true && ["USD", "CNY"].includes(usage.costCurrency)
      && [usage.costUSD, usage.totalCost, usage.cost].some((value) => value != null)) {
      const amount = recordedCost(usage);
      return { modelName: name, rate: matched, amount, currency: usage.costCurrency,
        usd: toUsd(amount, usage.costCurrency), window: "recorded", matched: true, ...parts };
    }
    if (!matched) {
      return {
        modelName: name,
        rate: null,
        amount: usage?.billingProvider ? recordedCost(usage) : 0,
        currency: "USD",
        usd: usage?.billingProvider ? recordedCost(usage) : 0,
        window: "off_peak",
        matched: false,
        ...parts,
      };
    }

    const active = pricedRate(matched, options.at);
    const cacheReadRate = active.cacheRead == null ? active.input : active.cacheRead;
    const cacheWriteRate = active.cacheWrite == null ? active.input : active.cacheWrite;
    const amount =
      (parts.input * rateAmount(active, "input") +
        parts.cacheRead * Number(cacheReadRate || 0) +
        parts.cacheWrite * Number(cacheWriteRate || 0) +
        parts.output * rateAmount(active, "output")) /
      TOKEN_SCALE;
    const currency = active.currency || "USD";

    return {
      modelName: name,
      rate: active,
      amount,
      currency,
      usd: toUsd(amount, currency),
      window: active.window,
      matched: true,
      ...parts,
    };
  }

  function listDayModels(day) {
    if (day?.models && typeof day.models === "object" && !Array.isArray(day.models)) {
      return Object.entries(day.models).map(([name, usage]) => ({
        modelName: name,
        ...usage,
      }));
    }
    if (Array.isArray(day?.modelBreakdowns)) return day.modelBreakdowns;
    return [];
  }

  function recordedCost(entry) {
    return numberOrZero(entry?.costUSD ?? entry?.totalCost ?? entry?.cost);
  }

  function timedCurrency(day, models = []) {
    if (day?.costCurrency) return day.costCurrency;
    const named = models.find((model) => model?.costCurrency)?.costCurrency;
    if (named) return named;
    const matched = matchRate(models[0]?.modelName || models[0]?.name);
    return matched?.currency || "USD";
  }

  function estimateDayCost(day) {
    const models = listDayModels(day);
    const timed = day?.timedBilling === true || day?.costCurrency === "CNY";
    if (timed) {
      const storedModels = models.reduce((sum, model) => sum + recordedCost(model), 0);
      const hasStoredModels = models.some((model) =>
        [model.costUSD, model.totalCost, model.cost].some((value) => value != null));
      const amount = hasStoredModels ? storedModels : recordedCost(day);
      const currency = timedCurrency(day, models);
      const parts = usageParts(day);
      return {
        amount,
        currency,
        usd: toUsd(amount, currency),
        matched: true,
        timed: true,
        matchedTokens: parts.tokens,
        unmatchedTokens: 0,
        fallback: false,
        models: models.map((model) => estimateUsageCost({
          ...model, timedBilling: true, costCurrency: model.costCurrency || currency,
        }, model.modelName || model.name)),
      };
    }

    if (!models.length) {
      const fallback = recordedCost(day);
      const parts = usageParts(day);
      return {
        amount: fallback,
        currency: "USD",
        usd: fallback,
        matched: false,
        timed: false,
        matchedTokens: 0,
        unmatchedTokens: parts.tokens,
        fallback: fallback > 0,
        models: [],
      };
    }

    const details = models.map((model) =>
      estimateUsageCost(model, model.modelName || model.name)
    );
    const matchedTokens = details.reduce((sum, item) => sum + (item.matched ? item.tokens : 0), 0);
    const unmatchedTokens = details.reduce((sum, item) => sum + (item.matched ? 0 : item.tokens), 0);
    const currencies = new Set(details.filter((item) => item.matched).map((item) => item.currency));
    if (details.some((item) => !item.matched && item.usd > 0)) currencies.add("USD");
    const totalCurrency = currencies.size === 1 ? [...currencies][0] : "USD";
    const priced = details.reduce((sum, item) => sum + (currencies.size > 1 ? item.usd : item.amount), 0);
    const amount = matchedTokens > 0 ? priced : recordedCost(day);
    return {
      amount,
      currency: totalCurrency,
      usd: toUsd(amount, totalCurrency),
      matched: matchedTokens > 0,
      timed: false,
      matchedTokens,
      unmatchedTokens,
      fallback: matchedTokens === 0 && recordedCost(day) > 0,
      models: details,
    };
  }

  function estimateDaysCost(days) {
    const list = Array.isArray(days) ? days : [];
    return list.reduce((sum, day) => sum + estimateDayCost(day).usd, 0);
  }

  function estimatePeriodCost(days) {
    const list = Array.isArray(days) ? days : [];
    if (!list.length) return { amount: 0, currency: "USD", usd: 0 };
    const first = estimateDayCost(list[0]);
    const homogeneous = list.every((day) => estimateDayCost(day).currency === first.currency);
    const usd = estimateDaysCost(list);
    if (!homogeneous) return { amount: usd, currency: "USD", usd };
    return {
      amount: list.reduce((sum, day) => sum + estimateDayCost(day).amount, 0),
      currency: first.currency,
      usd,
    };
  }

  function collectModelCosts(days) {
    const totals = new Map();
    for (const day of Array.isArray(days) ? days : []) {
      const estimated = estimateDayCost(day);
      if (estimated.models.length) {
        for (const model of estimated.models) {
          const prev = totals.get(model.modelName) || {
            name: model.modelName,
            total: 0,
            usd: 0,
            amount: 0,
            currency: "USD",
            matched: false,
            rate: null,
          };
          prev.total += model.tokens;
          prev.usd += model.usd;
          prev.amount += model.amount || model.usd;
          prev.currency = model.currency || prev.currency;
          prev.matched = prev.matched || model.matched;
          prev.rate = prev.rate || model.rate;
          totals.set(model.modelName, prev);
        }
        continue;
      }

      const name = "unknown-model";
      const parts = usageParts(day);
      const prev = totals.get(name) || {
        name,
        total: 0,
        usd: 0,
        amount: 0,
        currency: "USD",
        matched: false,
        rate: null,
      };
      prev.total += parts.tokens;
      prev.usd += recordedCost(day);
      prev.amount += recordedCost(day);
      totals.set(name, prev);
    }

    return [...totals.values()].sort((a, b) => b.total - a.total);
  }

  function formatRateLabel(entry) {
    if (!entry) return "无公开单价";
    const currency = entry.currency || "USD";
    const cache = entry.cacheRead == null ? "—" : formatListedRate(entry.cacheRead, currency);
    return `${formatListedRate(entry.input, currency)} / ${cache} / ${formatListedRate(entry.output, currency)}`;
  }

  function trimNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    return String(Number(number.toFixed(4)));
  }

  function formatUsdRate(value) {
    return formatListedRate(value, "USD");
  }

  function formatListedRate(value, currency = "USD") {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    return `${currency === "CNY" ? "¥" : "$"}${trimNumber(value)}`;
  }

  const VENDOR_LABELS = Object.freeze({
    zhipu: "智谱",
    volcengine: "火山方舟",
    openai: "OpenAI",
    anthropic: "Anthropic",
    moonshot: "Moonshot",
    deepseek: "DeepSeek",
    xai: "xAI",
    cursor: "Cursor",
    google: "Google",
    meta: "Meta",
  });

  const PROVIDER_VENDORS = Object.freeze({
    codex: Object.freeze(["openai"]),
    claude: Object.freeze(["anthropic"]),
    cursor: Object.freeze(["cursor", "openai", "anthropic", "xai", "google", "meta"]),
    kimi: Object.freeze(["moonshot"]),
    "deepseek-harness": Object.freeze(["deepseek"]),
    grok: Object.freeze(["xai", "cursor"]),
    "grok-build": Object.freeze(["xai", "cursor"]),
  });

  function vendorLabel(vendor) {
    return VENDOR_LABELS[vendor] || vendor;
  }

  function ratesForProvider(providerId) {
    const vendors = PROVIDER_VENDORS[providerId];
    if (!vendors) return [...RATES];
    const allowed = new Set(vendors);
    return RATES.filter((entry) => allowed.has(entry.vendor)
      && (!["grok", "grok-build"].includes(providerId)
        || entry.vendor !== "cursor" || entry.id.startsWith("cursor-grok-")));
  }

  function routesForProvider(providerId) {
    if (!providerId || providerId === "overview") return [...ROUTES];
    return ROUTES.filter((entry) => entry.provider === providerId);
  }

  function usedRateIds(days) {
    return new Set(
      collectModelCosts(days)
        .map((model) => model.rate?.id)
        .filter(Boolean)
    );
  }

  function roundUsd(value) {
    return Math.round((Number(value) || 0) * 1e6) / 1e6;
  }

  function annotateSnapshot(snapshot) {
    const days = Array.isArray(snapshot?.daily) ? snapshot.daily : [];
    const annotatedDays = days.map((day) => {
      const estimated = estimateDayCost(day);
      return {
        ...day,
        estimatedCostUSD: roundUsd(estimated.usd),
        unpricedTokens: estimated.unmatchedTokens,
        estimatedCostCNY: estimated.currency === "CNY" ? roundUsd(estimated.amount) : undefined,
      };
    });
    const period = estimatePeriodCost(days);
    const models = collectModelCosts(days).map((model) => ({
      name: model.name,
      usd: roundUsd(model.usd),
      amount: roundUsd(model.amount || model.usd),
      currency: model.currency || "USD",
      rate: model.rate?.id || null,
    }));
    return {
      ...snapshot,
      daily: annotatedDays,
      totals: {
        ...(snapshot?.totals || {}),
        estimatedCostUSD: roundUsd(period.usd),
        estimatedCostCNY: period.currency === "CNY" ? roundUsd(period.amount) : snapshot?.totals?.estimatedCostCNY,
      },
      billing: {
        asOf: PRICE_AS_OF,
        currency: period.currency,
        estimatedCostUSD: roundUsd(period.usd),
        estimatedCostCNY: period.currency === "CNY" ? roundUsd(period.amount) : null,
        timedBilling: snapshot?.timedBilling === true,
        models,
      },
    };
  }

  function catalog() {
    return {
      asOf: PRICE_AS_OF,
      currency: CURRENCY,
      unit: "currency_per_million_tokens",
      note: "按官方 API 单价从本地 Token 构成估算。Kimi 与 DeepSeek 保留人民币价，其余为美元；订阅额度和历史账单不在这张价表内。",
      rates: RATES.map((entry) => ({
        id: entry.id,
        vendor: entry.vendor,
        vendorLabel: vendorLabel(entry.vendor),
        label: entry.label,
        currency: entry.currency,
        routes: [...entry.routes],
        aliases: [...entry.aliases],
        input: entry.input,
        cacheRead: entry.cacheRead,
        cacheWrite: entry.cacheWrite,
        output: entry.output,
        peak: entry.peak ? { ...entry.peak } : null,
        longContext: entry.longContext ? { ...entry.longContext } : null,
        redirect: entry.redirect ? { ...entry.redirect } : null,
        note: entry.note,
        source: entry.source,
      })),
      routes: ROUTES.map((entry) => ({
        ...entry,
        destinations: [...entry.destinations],
      })),
    };
  }

  return {
    PRICE_AS_OF,
    CURRENCY,
    TOKEN_SCALE,
    CNY_PER_USD,
    RATES,
    ROUTES,
    VENDOR_LABELS,
    PROVIDER_VENDORS,
    catalog,
    vendorLabel,
    ratesForProvider,
    routesForProvider,
    usedRateIds,
    annotateSnapshot,
    normalizeModelName,
    matchRate,
    isPeakAt,
    usageParts,
    listDayModels,
    estimateUsageCost,
    estimateDayCost,
    estimateDaysCost,
    estimatePeriodCost,
    collectModelCosts,
    formatRateLabel,
    formatUsdRate,
    formatListedRate,
    toUsd,
  };
});
