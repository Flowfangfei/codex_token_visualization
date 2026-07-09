param(
  [ValidateSet("codex", "claude", "all")]
  [string]$Source = "codex",
  [string]$Timezone = "Asia/Tokyo",
  [string]$OutputRoot,
  [string]$FileDate
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) {
  $OutputRoot = Join-Path $ProjectRoot (Join-Path "usage-logs" $Source)
}

$DailyRoot = Join-Path $OutputRoot "daily"
$NpmCache = Join-Path $ProjectRoot ".npm-cache"

New-Item -ItemType Directory -Force -Path $DailyRoot | Out-Null
New-Item -ItemType Directory -Force -Path $NpmCache | Out-Null

$NodeVersion = (& node --version) 2>$null
if ($LASTEXITCODE -ne 0 -or -not $NodeVersion) {
  throw "Node.js was not found. ccusage@latest requires Node.js 22 or newer."
}

if ($NodeVersion -notmatch "^v?(\d+)") {
  throw "Could not determine Node.js version: $NodeVersion"
}

$NodeMajor = [int]$Matches[1]
if ($NodeMajor -lt 22) {
  throw "ccusage@latest requires Node.js 22 or newer. Current version: $NodeVersion"
}

if (-not $FileDate) {
  $FileDate = Get-Date -Format "yyyy-MM-dd"
}

$SourceConfig = @{
  codex = @{
    Prefix = "codex-usage"
    Args = @("codex", "daily")
  }
  claude = @{
    Prefix = "claude-usage"
    Args = @("claude", "daily")
  }
  all = @{
    Prefix = "all-usage"
    Args = @("daily")
  }
}

$Config = $SourceConfig[$Source]
$OutputFile = Join-Path $DailyRoot "$($Config.Prefix)-$FileDate.json"
$env:npm_config_cache = $NpmCache

$npxArgs = @(
  "--cache", $NpmCache,
  "-y",
  "ccusage@latest"
) + $Config.Args + @(
  "--timezone", $Timezone,
  "--json"
)

Write-Host "Exporting $Source usage to: $OutputFile"
Write-Host "Timezone: $Timezone"
Write-Host "npm cache: $NpmCache"
Write-Host "Command: npx --cache `"$NpmCache`" -y ccusage@latest $($Config.Args -join ' ') --timezone $Timezone --json"

$json = (& npx @npxArgs) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) {
  throw "ccusage export failed with exit code $LASTEXITCODE"
}

$parsed = $json | ConvertFrom-Json
$formattedJson = $parsed | ConvertTo-Json -Depth 100
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputFile, $formattedJson, $utf8NoBom)

Write-Host "Done: $OutputFile"
