# AI Token Ledger

本项目是一个本地 AI coding agent token 用量导出和可视化面板。它基于 `ccusage` 读取本机 Codex 和 Claude Code 的本地 JSONL 日志，生成每日 JSON 快照，并用一个本地 WebUI 展示总览、Codex 明细、Claude Code 明细、模型分布、费用估算、缓存读取/写入、快照列表和每日明细。

所有运行数据默认保存在项目目录内，避免每天把导出文件、`npx` 缓存或临时数据写到 C 盘用户目录。

## 适合谁用

- 想每天记录 Codex 和 Claude Code 本地 token 消耗的人
- 想把 `ccusage` 的 JSON 输出长期按天保存下来的人
- 想在一个 WebUI 里看总消耗、单工具消耗和模型分布的人
- 不希望日志导出文件堆到 C 盘的人

## 功能

- 总览页：Codex + Claude Code 总 token、近 30 日费用、总趋势、来源对比
- Codex 页：Codex 每日趋势、Token 构成、模型分布、快照和明细
- Claude Code 页：Claude Code 每日趋势、Token 构成、模型分布、快照和明细
- 数据源页：查看 Codex / Claude / All 三个导出源是否有快照、日志目录和行数
- Codex reset credits：读取本机 Codex 凭证后显示可用次数和有效期
- 一键全部导出：同时导出 Codex、Claude Code 和 all-agent 聚合 JSON
- 支持 Windows 每日计划任务，默认每天中午 12 点导出
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

- 刷新图标：导出当前视图对应的数据源并刷新页面
- `全部导出`：同时导出 Codex、Claude Code 和 all-agent 聚合，然后刷新当前视图

首次打开页面只会读取本地已有 JSON，不会自动运行导出命令。这样可以避免每次打开浏览器都启动 `npx`；需要最新数据时再手动点击刷新。

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
│  └─ start-webui.ps1
├─ web
│  ├─ app.js
│  ├─ index.html
│  └─ styles.css
├─ usage-logs
│  ├─ codex
│  ├─ claude
│  └─ all
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
