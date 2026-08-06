param(
  [string]$TaskName = "AITokenLedgerDailyExport",
  [string]$At = "12:00",
  [string]$Timezone = "Asia/Tokyo",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ExportScript = Join-Path $PSScriptRoot "export-all-daily.ps1"

if (-not (Test-Path $ExportScript)) {
  throw "Cannot find export script: $ExportScript"
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing -and -not $Force) {
  Write-Host "Task already exists: $TaskName"
  Write-Host "Use -Force to replace it."
  exit 0
}

if ($existing -and $Force) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$ExportScript`" -Timezone `"$Timezone`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Export every registered local agent usage source into the project data folder." | Out-Null

Write-Host "Registered daily task: $TaskName"
Write-Host "Runs every day at: $At"
Write-Host "Timezone argument for ccusage: $Timezone"
Write-Host "Output folder: $(Join-Path $ProjectRoot 'usage-logs')"
