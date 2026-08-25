param(
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Url = "http://localhost:$Port"
$ReadyApiUrl = "$Url/api/providers"

function Get-PortOwner {
  param([int]$LocalPort)

  return Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Test-TokenDashboard {
  param([string]$BaseUrl)

  try {
    $response = Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match '<title>AI Token Ledger</title>'
  } catch {
    return $false
  }
}

function Test-CurrentDashboard {
  param([string]$Endpoint)

  try {
    $response = Invoke-RestMethod -Uri $Endpoint -TimeoutSec 2
    return $response.ok -eq $true -and @($response.providers).Count -gt 0
  } catch {
    return $false
  }
}

function Stop-ExistingDashboard {
  param([int]$LocalPort, [string]$BaseUrl)

  $connection = Get-PortOwner -LocalPort $LocalPort
  if (-not $connection) {
    return
  }

  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
  $isNodeDashboard = $owner.Name -ieq "node.exe" -and
    $owner.CommandLine -match '(?i)server\.js' -and
    (Test-TokenDashboard -BaseUrl $BaseUrl)

  if (-not $isNodeDashboard) {
    throw "Port $LocalPort is already used by another application (PID $($connection.OwningProcess)). Use a different port."
  }

  Write-Host "Restarting the existing dashboard process (PID $($connection.OwningProcess))..."
  Stop-Process -Id $connection.OwningProcess -Force
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 200
    if (-not (Get-PortOwner -LocalPort $LocalPort)) {
      return
    }
  }
  throw "The previous dashboard process did not release port $LocalPort."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found in PATH. Install Node.js 22.15 or newer, or start the dashboard from a terminal where node is available."
}
$nodeVersion = [version](& node -p "process.versions.node")
if ($nodeVersion -lt [version]"22.15.0") {
  throw "Node.js $nodeVersion is too old. Install Node.js 22.15 or newer to read DeepSeek Harness Zstandard logs."
}

Stop-ExistingDashboard -LocalPort $Port -BaseUrl $Url

$nodePath = (Get-Command node).Source
$process = Start-Process `
  -FilePath $nodePath `
  -ArgumentList @(".\server.js", "--port", "$Port") `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -PassThru

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  if (Test-CurrentDashboard -Endpoint $ReadyApiUrl) {
    $ready = $true
    break
  }
  if ($process.HasExited) {
    break
  }
}

if (-not $ready) {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  throw "Dashboard did not start a compatible API on $Url."
}

Start-Process $Url
