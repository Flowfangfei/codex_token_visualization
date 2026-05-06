param(
  [string]$Timezone = "Asia/Tokyo",
  [string]$OutputRoot,
  [string]$FileDate
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) {
  $OutputRoot = Join-Path $ProjectRoot "codex-usage-logs"
}

$DailyRoot = Join-Path $OutputRoot "daily"
$NpmCache = Join-Path $ProjectRoot ".npm-cache"

New-Item -ItemType Directory -Force -Path $DailyRoot | Out-Null
New-Item -ItemType Directory -Force -Path $NpmCache | Out-Null

if (-not $FileDate) {
  $FileDate = Get-Date -Format "yyyy-MM-dd"
}

$OutputFile = Join-Path $DailyRoot "codex-usage-$FileDate.json"
$env:npm_config_cache = $NpmCache

$npxArgs = @(
  "--cache", $NpmCache,
  "-y",
  "@ccusage/codex@latest",
  "daily",
  "--timezone", $Timezone,
  "--json"
)

Write-Host "Exporting Codex usage to: $OutputFile"
Write-Host "Timezone: $Timezone"
Write-Host "npm cache: $NpmCache"

$json = (& npx @npxArgs) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) {
  throw "ccusage export failed with exit code $LASTEXITCODE"
}

$parsed = $json | ConvertFrom-Json
$formattedJson = $parsed | ConvertTo-Json -Depth 100
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputFile, $formattedJson, $utf8NoBom)

Write-Host "Done: $OutputFile"
