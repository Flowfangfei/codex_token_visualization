param(
  [string]$Timezone = "Asia/Tokyo",
  [string]$FileDate
)

$ErrorActionPreference = "Stop"

$ExportScript = Join-Path $PSScriptRoot "export-daily.ps1"
$QuotaScript = Join-Path $PSScriptRoot "sync-account-quotas.mjs"
$Sources = @("codex", "claude", "all")
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

Write-Host "Done: exported Codex, Claude Code, all-agent usage, and account quota snapshots."
