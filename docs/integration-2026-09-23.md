# September 23 integration

Upstream base: `c6f90076b82e`. Local route-pricing and Beijing-time
checkpoint: `cc4703c`. Installed-runtime checkpoint: `94eab64`.

## Merge decisions

| Area | Result |
| --- | --- |
| Heatmap | Upstream trend renderer, date filters and heat levels; remove the former standalone calendar panel. |
| Refresh | Keep upstream certificate handling, error reporting and inventory caching, alongside local parallel export and installed ccusage support. |
| Usage | Preserve local Grok collection, OpenCode provider mapping and existing daily ledgers. |
| Time | Use Asia/Shanghai, including the new demand estimator. |
| Billing | Preserve currency conversion and local route metadata. Adapt trend cost bars to the upstream normalized rows. |

## Pricing verification

Prices are reference estimates per million tokens, checked on 2026-09-23.
Historical models remain available for old logs. The catalog date describes
this update; it does not imply every historical rate was newly published.

- [OpenAI](https://developers.openai.com/api/docs/pricing): add GPT-6 Sol
  (USD 2 input, 0.20 cached, 2.50 cache write, 10 output) and Luna
  (0.10, 0.01, 0.125, 0.50), with published long-context rates.
- [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing):
  add Opus 5.5 (USD 4 input, 0.20 cached, 5 five-minute cache write, 20 output).
  Fable 5.1, Opus 5, Sonnet 5 and Haiku 4.5 rates remain unchanged.
- [xAI](https://docs.x.ai/developers/pricing): add Grok 4.7
  (USD 2 input, 0.50 cached, 6 output). Its Fast variant is restricted to
  Cursor/Grok Build; it has a separate price entry and long-context rates.
- [Cursor](https://cursor.com/docs/models-and-pricing): verify Composer 2.5,
  existing Grok variants and the displayed Gemini/Muse reference rates.
- [Kimi](https://platform.kimi.com/): K3 and K2.7 Code/K2.6 rates are unchanged.
- [DeepSeek](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/):
  the current table lists V4-Pro-0813 separately. Remove the former automatic
  Pro-to-Flash redirect; retain Pro prices and the old Flash aliases.
  Existing stored time-priced costs are not rewritten during this merge.
- [Zhipu](https://bigmodel.cn/pricing): add direct GLM-5.3 and GLM-5.3-Flash
  routes. Preserve the Ark GLM route's standard direct-API reference estimate;
  the displayed label is simply GLM-5.3-Flash.

Unverified dated Ark DeepSeek routes remain pending. No neighboring model
price is substituted. Currency conversion still uses the existing fixed
CNY/USD reference rate; it is not a live FX feed.

## Validation

131 automated tests passed after integration, including provider routes,
currency conversion, Beijing day boundaries, upstream trend ranges, refresh
results and quota prediction. Runtime and browser checks are recorded locally.

## Final code audit

Removed the superseded standalone calendar implementation and its tests;
the upstream trend component owns both line and heatmap modes. Recent metrics
now select calendar days, excluding older sparse records and future dates.
Overview totals convert CNY to USD explicitly, retain recorded time-priced
model costs, and preserve zero-cost entries. Latest-day labels use that day's
currency. Grok's price list excludes unrelated Cursor Composer entries.
New price entries follow a readable multiline format.

The existing large UI and collector modules remain a maintenance concern.
This integration avoids a broad structural rewrite while changing accounting
and upstream behavior; targeted regression tests cover the fixes above.
