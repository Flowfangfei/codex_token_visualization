param(
  [string]$Source = "codex",
  [string]$Timezone = "Asia/Tokyo",
  [string]$OutputRoot,
  [string]$FileDate
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ProviderConfigScript = Join-Path $PSScriptRoot "provider-config.mjs"
$ConfigBase64 = & node $ProviderConfigScript --source $Source --base64
if ($LASTEXITCODE -ne 0 -or -not $ConfigBase64) {
  throw "No ccusage provider is registered for $Source"
}
$ConfigJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String(($ConfigBase64 -join "")))
$Config = $ConfigJson | ConvertFrom-Json

$DailyRoot = if ($OutputRoot) { Join-Path $OutputRoot "daily" } else { [string]$Config.logRoot }
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

$OutputFile = Join-Path $DailyRoot "$($Config.filePrefix)-$FileDate.json"
$env:npm_config_cache = $NpmCache

$npxArgs = @(
  "--cache", $NpmCache,
  "-y",
  "ccusage@latest"
) + @($Config.ccusageArgs) + @(
  "--timezone", $Timezone,
  "--json"
)

Write-Host "Exporting $Source usage to: $OutputFile"
Write-Host "Timezone: $Timezone"
Write-Host "npm cache: $NpmCache"
Write-Host "Command: npx --cache `"$NpmCache`" -y ccusage@latest $(@($Config.ccusageArgs) -join ' ') --timezone $Timezone --json"

$json = (& npx @npxArgs) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) {
  throw "ccusage export failed with exit code $LASTEXITCODE"
}

$parsed = $json | ConvertFrom-Json
$formattedJson = $parsed | ConvertTo-Json -Depth 100
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputFile, $formattedJson, $utf8NoBom)

Write-Host "Done: $OutputFile"
