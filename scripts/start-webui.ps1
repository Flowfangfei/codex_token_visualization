param(
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "Starting Codex usage dashboard..."
Write-Host "URL: http://localhost:$Port"

node .\server.js --port $Port
