param(
  [string]$Timezone = "Asia/Tokyo",
  [string]$FileDate
)

$ErrorActionPreference = "Stop"

$ExportScript = Join-Path $PSScriptRoot "export-daily.ps1"
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

if ($Failures.Count -gt 0) {
  throw "One or more exports failed:`n$($Failures -join "`n")"
}

Write-Host "Done: exported codex, claude, and all-agent usage."
