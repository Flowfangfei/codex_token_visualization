param(
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Url = "http://localhost:$Port"
$ApiUrl = "$Url/api/usage"

function Test-Dashboard {
  param([string]$Endpoint)

  try {
    $response = Invoke-WebRequest -Uri $Endpoint -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found in PATH. Install Node.js or start the dashboard from a terminal where node is available."
}

if (-not (Test-Dashboard -Endpoint $ApiUrl)) {
  Start-Process `
    -FilePath "node" `
    -ArgumentList ".\server.js --port $Port" `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden | Out-Null

  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Dashboard -Endpoint $ApiUrl) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    throw "Dashboard did not start on $Url. Port $Port may be occupied by another app."
  }
}

Start-Process $Url
