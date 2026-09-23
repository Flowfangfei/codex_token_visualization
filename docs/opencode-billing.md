# OpenCode route pricing

OpenCode usage keeps the full provider/model identifier. Custom provider
names are resolved through a local `usage-logs/opencode-billing-routes.json`
file, or the file selected by `OPENCODE_BILLING_ROUTES_PATH`:

```json
{"providers":{"example-ark-alias":"volcengine"}}
```

This file contains no credentials and stays outside Git. Model versions match
exactly within the resolved provider. A dated Ark DeepSeek model does not
inherit DeepSeek's direct-API redirect or time-of-day pricing.

The Ark GLM-5.3-Flash route uses the model maker's direct API standard
price as a reference estimate, checked against
[Zhipu's official pricing](https://bigmodel.cn/pricing) on 2026-09-21.
Prices per million tokens are CNY 0.8 input, 0.23 cache read, and 2.8 output.
Limited-time discounts are excluded. The original Ark route is preserved;
this reference estimate does not represent an Ark invoice.

Unverified routes retain their token counts and show pending pricing.
Existing recorded costs remain available when positive. The priced subtotal
does not include unknown amounts. Mixed USD/CNY estimates are converted
before summation.

Remaining: verify Ark prices for `deepseek-v4-pro-260425` and
`deepseek-v4-1-flash-260910`. Neither exact version was present in the fetched
Ark catalog. Do not substitute a different version's price.
