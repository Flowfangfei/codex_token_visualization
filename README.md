# Codex Token Visualization

一个本地 Codex token 用量导出和可视化面板。它基于 `@ccusage/codex` 读取本机 Codex JSONL 日志，生成每日 JSON 快照，并用一个本地 WebUI 展示趋势、累计 token、缓存输入占比、费用估算、模型分布和每日明细。

这个工具默认把所有运行数据保存在项目目录内，避免每天把导出文件、`npx` 缓存或临时数据写到 C 盘用户目录。

## 适合谁用

- 想每天记录 Codex 本地 CLI token 消耗的人
- 想把 `@ccusage/codex daily --json` 的结果长期保存下来的人
- 想用浏览器快速查看每日趋势、累计消耗和模型分布的人
- 不希望日志导出文件堆到 C 盘的人

## 功能

- 一键导出 Codex 每日 token JSON
- 自动保存到项目内的 `codex-usage-logs/daily`
- `npx` 缓存固定到项目内的 `.npm-cache`
- 本地 WebUI 仪表盘
- 浏览器里点击“立即导出”即可刷新数据
- 支持 Windows 每日计划任务
- 提供可双击启动脚本
- 默认统计时区为 `Asia/Tokyo`

## 前置要求

需要安装：

- Windows 10/11
- Node.js 18 或更高版本
- PowerShell
- 可用的 Codex 本地日志

检查 Node.js：

```powershell
node --version
npx --version
```

如果系统没有 Node.js，请先安装 Node.js LTS。

## 快速开始

进入项目目录：

```powershell
cd "F:\学习和研究\新鲜玩意\codex额度助手"
```

手动导出一次：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-daily.ps1
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

这个脚本会自动判断本地 `8787` 服务是否已经运行：

- 如果没有运行，会在后台启动 `server.js`
- 如果已经运行，会直接打开浏览器
- 最终都会打开 `http://localhost:8787`

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
CodexUsageDailyExport
```

查看下一次运行时间：

```powershell
Get-ScheduledTaskInfo -TaskName CodexUsageDailyExport
```

删除计划任务：

```powershell
Unregister-ScheduledTask -TaskName CodexUsageDailyExport -Confirm:$false
```

## 数据保存在哪里

每日 JSON 快照默认保存到：

```text
.\codex-usage-logs\daily\codex-usage-YYYY-MM-DD.json
```

`npx` 缓存默认保存到：

```text
.\.npm-cache
```

这两个目录已经写入 `.gitignore`，不会被提交到 GitHub。

## 手动导出脚本

运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-daily.ps1
```

默认等价于：

```powershell
npx -y @ccusage/codex@latest daily --timezone Asia/Tokyo --json
```

但脚本额外做了几件事：

- 自动创建 `codex-usage-logs/daily`
- 自动创建 `.npm-cache`
- 把 `npx` 缓存固定到项目目录
- 输出 UTF-8 no BOM JSON，避免 Node.js 读取时报 BOM 错误
- 文件名使用当天日期，例如 `codex-usage-2026-05-06.json`

自定义时区：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-daily.ps1 -Timezone Asia/Shanghai
```

自定义输出根目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-daily.ps1 -OutputRoot "D:\codex-usage-logs"
```

## WebUI 使用方式

启动服务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-webui.ps1 -Port 8787
```

访问：

```text
http://localhost:8787
```

WebUI 会读取最新的 JSON 快照，并展示：

- 最新一天 token 用量
- 累计 token
- 缓存输入占比
- 费用估算
- 最近趋势图
- 最新一天 token 构成
- 模型分布
- 本地快照列表
- 每日明细表

点击页面右上角“立即导出”会调用本地 API，重新运行导出脚本并刷新界面。

## 项目结构

```text
.
├─ open-dashboard.bat
├─ 打开仪表盘.bat
├─ package.json
├─ server.js
├─ scripts
│  ├─ export-daily.ps1
│  ├─ open-dashboard.ps1
│  ├─ register-daily-task.ps1
│  └─ start-webui.ps1
├─ web
│  ├─ app.js
│  ├─ index.html
│  └─ styles.css
├─ codex-usage-logs
│  └─ daily
└─ .npm-cache
```

其中 `codex-usage-logs` 和 `.npm-cache` 是本地运行数据，不建议提交。

## 常见问题

### 页面显示没有数据

先手动导出一次：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-daily.ps1
```

然后刷新 `http://localhost:8787`。

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

常见原因是 Node.js 没有安装，或者 `node` 不在 PATH 里。

### 计划任务没有执行

查看任务状态：

```powershell
Get-ScheduledTask -TaskName CodexUsageDailyExport
Get-ScheduledTaskInfo -TaskName CodexUsageDailyExport
```

也可以手动运行任务：

```powershell
Start-ScheduledTask -TaskName CodexUsageDailyExport
```

## 统计边界

这个工具统计的是本机 Codex JSONL 日志里的 token 消耗，适合回答：

```text
我这台机器上的 Codex CLI 日志里，按天消耗了多少 token？
```

它不保证完全等价于 ChatGPT/Codex 订阅额度的内部扣减。官方额度扣减可能还会受 plan、任务复杂度、上下文规模、执行位置等因素影响。

## 隐私说明

默认不会上传任何本地 usage JSON。WebUI 运行在本机 `localhost`，读取的是本项目目录下的 JSON 快照。

提交到 GitHub 时，以下目录默认被忽略：

```text
codex-usage-logs/
.npm-cache/
verification/
node_modules/
```
