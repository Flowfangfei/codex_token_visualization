param(
  [string]$Source = "codex",
  [string]$Timezone = "Asia/Tokyo",
  [string]$OutputRoot,
  [string]$FileDate
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ProviderConfigScript = Join-Path $PSScriptRoot "provider-config.mjs"
$UsageStorageScript = Join-Path $PSScriptRoot "usage-storage.mjs"
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

$OutputFile = Join-Path $DailyRoot "$($Config.filePrefix).json"
$env:npm_config_cache = $NpmCache

$ccusageArgs = @($Config.ccusageArgs) + @(
  "--timezone", $Timezone,
  "--json"
)

Write-Host "Exporting $Source usage to: $OutputFile"
Write-Host "Timezone: $Timezone"
Write-Host "npm cache: $NpmCache"

$directCcusage = $null
if ($env:CCUSAGE_FORCE_NPX -ne "1") {
  $directCcusage = @(Get-Command "ccusage" -CommandType Application,ExternalScript -ErrorAction SilentlyContinue)[0]
}

if ($directCcusage) {
  $ccusageExecutable = if ($directCcusage.Path) { $directCcusage.Path } else { $directCcusage.Source }
  Write-Host "Runner: installed ccusage"
  Write-Host "Command: `"$ccusageExecutable`" $(@($Config.ccusageArgs) -join ' ') --timezone $Timezone --json"
  $json = (& $ccusageExecutable @ccusageArgs) -join [Environment]::NewLine
} else {
  $npxArgs = @(
    "--cache", $NpmCache,
    "-y",
    "ccusage@latest"
  ) + $ccusageArgs
  Write-Host "Runner: npx fallback"
  Write-Host "Command: npx --cache `"$NpmCache`" -y ccusage@latest $(@($Config.ccusageArgs) -join ' ') --timezone $Timezone --json"
  $json = (& npx @npxArgs) -join [Environment]::NewLine
}

if ($LASTEXITCODE -ne 0) {
  throw "ccusage export failed with exit code $LASTEXITCODE"
}

$parsed = $json | ConvertFrom-Json
$formattedJson = $parsed | ConvertTo-Json -Depth 100
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$TemporaryFile = "$OutputFile.$PID.tmp"
[System.IO.File]::WriteAllText($TemporaryFile, $formattedJson, $utf8NoBom)
try {
  $MergeArgs = @(
    $UsageStorageScript,
    "--output", $OutputFile,
    "--prefix", [string]$Config.filePrefix,
    "--incoming", $TemporaryFile,
    "--root", $DailyRoot
  )
  foreach ($LegacyRoot in @($Config.legacyRoots)) {
    if ($LegacyRoot) {
      $MergeArgs += @("--root", [string]$LegacyRoot)
    }
  }
  & node @MergeArgs | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Usage history consolidation failed with exit code $LASTEXITCODE"
  }
} finally {
  if (Test-Path -LiteralPath $TemporaryFile) {
    Remove-Item -LiteralPath $TemporaryFile -Force
  }
}

Write-Host "Done: $OutputFile"
