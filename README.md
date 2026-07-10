# AI Token Ledger

本项目是一个本地 AI coding agent token 用量导出和可视化面板。它基于 `ccusage` 读取本机 Codex 和 Claude Code 的本地 JSONL 日志，生成每日 JSON 快照，并用一个本地 WebUI 展示总览、Codex 明细、Claude Code 明细、模型分布、费用估算、缓存读取/写入、快照列表和每日明细。

所有运行数据默认保存在项目目录内，避免每天把导出文件、`npx` 缓存或临时数据写到 C 盘用户目录。

## 适合谁用

- 想每天记录 Codex 和 Claude Code 本地 token 消耗的人
- 想把 `ccusage` 的 JSON 输出长期按天保存下来的人
- 想在一个 WebUI 里看总消耗、单工具消耗和模型分布的人
- 不希望日志导出文件堆到 C 盘的人

## 功能

- 总览页：Codex + Claude Code + Cursor 的来源对比、总 token、近 30 日费用和总趋势
- 额度预测页：按来源显示官方账户额度窗口、真实重置时间、token 消耗速率和预测耗尽时间
- Codex 页：Codex 每日趋势、Token 构成、模型分布、快照和明细
- Claude Code 页：Claude Code 每日趋势、Token 构成、模型分布、快照和明细
- Cursor 页：Cursor usage events 聚合的独立每日 token 展示；账户账期与计划用量在额度预测页同步
- 数据源页：查看 Codex / Claude / Cursor / All 四个导出源、日志目录和账户额度快照
- Codex reset credits：读取本机 Codex 凭证后显示可用次数和有效期
- 一键全部导出：同时导出 Codex、Claude Code、all-agent 聚合 JSON，并同步账户额度快照
- 支持 Windows 每日计划任务，默认每天中午 12 点导出并同步账户额度
- 提供可双击启动脚本

## 前置要求

需要安装：

- Windows 10/11
- Node.js 22 或更高版本
- PowerShell
- 可用的 Codex 本地日志和/或 Claude Code 本地日志

检查 Node.js：

```powershell
node --version
npx --version
```

检查 `ccusage`：

```powershell
npx -y ccusage@latest codex daily --help
npx -y ccusage@latest claude daily --help
npx -y ccusage@latest daily --help
```

脚本内部使用 `npx -y ccusage@latest`，首次运行时会自动下载最新版 `ccusage`。你不需要全局安装 `ccusage`；如果已经全局安装，也不影响使用。

## 快速开始

进入项目目录：

```powershell
cd "F:\学习和研究\新鲜玩意\codex额度助手"
```

手动导出全部数据源：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-all-daily.ps1
```

启动仪表盘：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-webui.ps1 -Port 8787
```

打开浏览器访问：

```text
http://localhost:8787
```

## 最简单的打开方式

Windows 上可以直接双击项目根目录里的：

```text
打开仪表盘.bat
```

或：

```text
open-dashboard.bat
```

脚本会自动判断本地 `8787` 服务是否已经运行：

- 如果没有运行，会在后台启动 `server.js`
- 如果已经运行，会直接打开浏览器
- 最终都会打开 `http://localhost:8787`

## 数据保存在哪里

新的默认目录是：

```text
.\usage-logs\codex\daily\codex-usage-YYYY-MM-DD.json
.\usage-logs\claude\daily\claude-usage-YYYY-MM-DD.json
.\usage-logs\all\daily\all-usage-YYYY-MM-DD.json
.\usage-logs\quota-snapshots\codex\quota-codex-YYYY-MM-DD.json
.\usage-logs\quota-snapshots\claude\quota-claude-YYYY-MM-DD.json
.\usage-logs\quota-snapshots\cursor\quota-cursor-YYYY-MM-DD.json
.\usage-logs\quota-observations\{codex,claude,cursor}\quota-observations-YYYY-MM-DD.json
```

`npx` 缓存默认保存到：

```text
.\.npm-cache
```

这些目录已经写入 `.gitignore`，不会提交到 GitHub。

同一天内无论手动导出、计划任务导出，还是在 WebUI 里点击刷新，都会覆盖同一个当天文件。例如：

```text
.\usage-logs\claude\daily\claude-usage-2026-07-09.json
```

所以一天内多次刷新不会生成一堆重复 JSON。长期保存时最多按来源每天一个文件。

账户额度快照也按同一规则保存：同一天内无论浏览器刷新还是计划任务运行，都会覆盖该来源当天的 `quota-*.json`。这些快照只保存已经汇总后的百分比、重置时间、账期和计划用量，不保存 access token、cookie、邮箱或账户 ID。

为了识别同一天内的额度重置，项目还会写入紧凑的 `quota-observations-YYYY-MM-DD.json`。每个来源每天仍只有一个观测文件，内部观测点会去重并限制为最多 96 条，只保留最近 120 天。观测点仅含额度窗口、分段编号、汇总 Token 和模型汇总，不含凭证、原始请求、会话内容或账户 ID。

旧版本的 Codex 快照目录：

```text
.\codex-usage-logs\daily
```

仍会作为读取 fallback。首次用新版导出后，Codex 会开始写入 `.\usage-logs\codex\daily`。

## 手动导出

导出全部数据源：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-all-daily.ps1
```

只导出 Codex：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-daily.ps1 -Source codex
```

只导出 Claude Code：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-daily.ps1 -Source claude
```

只导出 all-agent 聚合：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-daily.ps1 -Source all
```

默认时区是 `Asia/Tokyo`。你也可以改成：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-all-daily.ps1 -Timezone Asia/Shanghai
```

## 每日自动导出

默认推荐中午导出，避免晚上电脑已经关机导致任务错过。

注册每天中午 12 点导出：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-daily-task.ps1 -At 12:00 -Timezone Asia/Tokyo
```

如果任务已经存在，需要覆盖：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-daily-task.ps1 -At 12:00 -Timezone Asia/Tokyo -Force
```

计划任务名称默认是：

```text
AITokenLedgerDailyExport
```

查看下一次运行时间：

```powershell
Get-ScheduledTaskInfo -TaskName AITokenLedgerDailyExport
```

删除计划任务：

```powershell
Unregister-ScheduledTask -TaskName AITokenLedgerDailyExport -Confirm:$false
```

## WebUI 使用方式

WebUI 顶部有四个视图：

- `总览`：显示 Codex + Claude Code 的总消耗和来源对比
- `Codex`：只看 Codex
- `Claude Code`：只看 Claude Code
- `数据源`：查看三个导出源的本地快照状态

右上角两个操作：

- 刷新图标：同时导出 Codex、Claude Code 和 all-agent 聚合，然后刷新当前视图
- `全部导出`：和刷新图标相同，用于更明确地手动触发一次全量导出

首次打开页面只会读取本地已有 JSON，不会自动运行导出命令。这样可以避免每次打开浏览器都启动 `npx`；需要最新数据时再手动点击刷新。

点击刷新图标或 `全部导出` 时会统一执行：

1. 导出 Codex、Claude Code 和 all-agent 的当日 token 快照。
2. 同步 Codex、Claude Code 和 Cursor 的账户额度快照。
3. 重新读取当前页面，因此无论停留在哪个标签页都会看到同一轮最新数据。

在“额度预测”页可以分别选择 Codex、Claude Code 或 Cursor。`刷新时同步账户额度` 默认开启；关闭后，该来源的浏览器刷新和每日计划任务都不会读取其账户凭证或发起账户用量请求。

## 额度预测与自动周期

Codex、Claude Code 和 Cursor 的周期优先从账户数据自动读取，不需要手动填写结束日：

- Codex：通过本机 `codex app-server` 的 `account/rateLimits/read` 读取短窗口、长窗口、已用百分比和重置时间。
- Claude Code：从本机 `~\.claude\.credentials.json` 的 Claude OAuth 登录态读取账户 usage 窗口；请求只发送到 `https://api.anthropic.com/api/oauth/usage`。
- Cursor：从 Windows Cursor 本地 `state.vscdb` 读取会话凭证，请求 `https://cursor.com/api/usage-summary` 获得账期，并以 Cursor 设置页同口径的 `Included in Pro`、`Auto + Composer`、`API` 百分比作为额度主统计；旧的计划单位只保留为诊断数据。同步还会通过 usage events 接口汇总最近 90 天的每日 token 快照。

三种凭证均只在本机内存中用于对应官方账户请求，服务端不会返回或写入 access token、refresh token、cookie、邮箱或完整账户 ID。网络不可用、凭证失效、Cursor 未登录，或接口结构变更时，预测页会保留最近快照并显示同步失败；你仍可使用页面里的手动 Token 预算作为后备。

预测分为三个阶段：

1. 当前重置分段少于 3 个观测点：显示账户当前剩余额度、真实重置时间，以及“今日截至当前 / 近 3 日 / 近 7 日”的原始 Token 加权日均。
2. 同一重置分段达到至少 3 个观测点：对观测点之间的 Token 增量与官方已用百分比做最小二乘拟合，得到实际 `百分比 / Token` 扣减系数、预计耗尽时间和 `R²`。
3. 同一重置分段达到至少 7 个观测点，且模型占比有足够变化：使用带先验收缩和权重上下限的岭回归反向学习各模型的额度权重，再生成“模型等效 Token”日均。若样本不足、模型混合稳定或拟合质量下降，会自动退回原始 Token 单斜率，不输出不可靠的模型换算。

当 `resetsAt` 改变、官方已用百分比明显下降，或本地累计计数回退时，会自动开启新的拟合分段。即使上午用完额度、当天手动重置后继续使用，重置前后的 Token 也不会混入同一条拟合曲线。

Cursor 的账户百分比与 token 目前不保证一一对应，因此会同时显示官方账期、分项百分比和最近 90 天的每日 token 事件；在百分比与 token 的对应关系被账户数据稳定验证前，不把两者强行换算成固定 token 上限，避免错误预测。

## Codex reset credits 有效期

页面会尝试读取本机 Codex 登录凭证：

```text
~\.codex\auth.json
```

然后用其中的 `tokens.access_token` 请求 ChatGPT 的 reset credits 接口：

```text
https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
```

前端只展示：

- `available_count`
- 每个 credit 的 `status`
- 每个 credit 的 `title`
- 每个 credit 的 `granted_at`
- 每个 credit 的 `expires_at`

`granted_at` 和 `expires_at` 会转成本机本地时间显示。服务端不会把 `access_token`、`refresh_token`、cookie 或完整唯一 ID 返回给前端。若接口返回 `401`，通常表示本机 Codex 凭证失效，或 Authorization header 没有正确携带。

reset credits 只属于 Codex / ChatGPT 口径，所以不会显示在 Claude Code 页。

## 项目结构

```text
.
├─ open-dashboard.bat
├─ 打开仪表盘.bat
├─ package.json
├─ server.js
├─ scripts
│  ├─ export-all-daily.ps1
│  ├─ export-daily.ps1
│  ├─ open-dashboard.ps1
│  ├─ register-daily-task.ps1
│  ├─ sync-account-quotas.mjs
│  └─ start-webui.ps1
├─ web
│  ├─ app.js
│  ├─ index.html
│  └─ styles.css
├─ usage-logs
│  ├─ codex
│  ├─ claude
│  ├─ cursor
│  ├─ all
│  ├─ quota-snapshots
│  └─ quota-observations
└─ .npm-cache
```

`usage-logs`、旧的 `codex-usage-logs` 和 `.npm-cache` 都是本地运行数据，不建议提交。

## 常见问题

### 页面显示没有数据

先手动导出一次：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-all-daily.ps1
```

然后刷新 `http://localhost:8787`。

### Claude Code 页没有数据

先确认本机有 Claude Code 日志：

```powershell
Test-Path "$HOME\.claude"
```

再确认 `ccusage` 能读取：

```powershell
npx -y ccusage@latest claude daily --json
```

如果这里没有数据，WebUI 也不会有 Claude Code 数据。

### 端口 8787 被占用

换一个端口启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-webui.ps1 -Port 8790
```

然后访问：

```text
http://localhost:8790
```

### 双击脚本闪退

直接在 PowerShell 里运行，能看到错误信息：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\open-dashboard.ps1 -Port 8787
```

常见原因是 Node.js 没有安装、版本低于 22，或者 `node` 不在 PATH 里。

## 统计边界

这个工具统计的是本机 JSONL 日志里的 token 消耗，适合回答：

```text
我这台机器上的 Codex / Claude Code 本地日志里，按天消耗了多少 token？
```

它不保证完全等价于 ChatGPT、Codex 或 Claude 订阅额度的官方内部扣减。官方额度扣减可能还会受 plan、任务复杂度、上下文规模、执行位置、缓存策略等因素影响。

Claude Code 的官方监控也可以走 Anthropic Usage/Cost API、Claude Code analytics 或 OpenTelemetry；本项目选择 `ccusage` 是因为它更轻量，适合个人机器的本地可视化。

## 隐私说明

默认不会上传任何本地 usage JSON。WebUI 运行在本机 `localhost`，读取的是本项目目录下的 JSON 快照。

提交到 GitHub 时，以下目录默认被忽略：

```text
usage-logs/
codex-usage-logs/
.npm-cache/
verification/
node_modules/
```
