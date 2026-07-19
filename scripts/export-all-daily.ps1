param(
  [string]$Timezone = "Asia/Tokyo",
  [string]$FileDate
)

$ErrorActionPreference = "Stop"

$ExportScript = Join-Path $PSScriptRoot "export-daily.ps1"
$QuotaScript = Join-Path $PSScriptRoot "sync-account-quotas.mjs"
$ProviderConfigScript = Join-Path $PSScriptRoot "provider-config.mjs"
$SourcesBase64 = & node $ProviderConfigScript --ccusage-sources --base64
if ($LASTEXITCODE -ne 0 -or -not $SourcesBase64) {
  throw "Could not read the registered ccusage providers"
}
$SourcesJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String(($SourcesBase64 -join "")))
$Sources = @($SourcesJson | ConvertFrom-Json)
$Failures = @()

foreach ($Source in $Sources) {
  try {
    $args = @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", $ExportScript,
      "-Source", $Source,
      "-Timezone", $Timezone
    )

    if ($FileDate) {
      $args += @("-FileDate", $FileDate)
    }

    & powershell.exe @args
    if ($LASTEXITCODE -ne 0) {
      throw "$Source export failed with exit code $LASTEXITCODE"
    }
  } catch {
    $Failures += "${Source}: $($_.Exception.Message)"
  }
}

if (Test-Path $QuotaScript) {
  try {
    & node --no-warnings $QuotaScript --json
    if ($LASTEXITCODE -ne 0) {
      throw "account quota sync failed with exit code $LASTEXITCODE"
    }
  } catch {
    $Failures += "account quotas: $($_.Exception.Message)"
  }
}

if ($Failures.Count -gt 0) {
  throw "One or more exports failed:`n$($Failures -join "`n")"
}

Write-Host "Done: exported every registered ccusage source and synchronized all account quota adapters."
