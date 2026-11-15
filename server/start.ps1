# Starter: bring up cloudflared tunnel + Express server
# Run this once; it will fork both processes into background

$ErrorActionPreference = 'Continue'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $base

# 1. Kill old stuff
Write-Output "[1/4] Killing old processes..."
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 1500

# 2. Start cloudflared tunnel
Write-Output "[2/4] Starting cloudflared tunnel..."
$cfExe = "C:\Users\qinzh\AppData\Roaming\npm\node_modules\cloudflared\bin\cloudflared.exe"
$cfLog = Join-Path $env:TEMP "cf-final.log"
$cfErr = Join-Path $env:TEMP "cf-final-err.log"
Remove-Item $cfLog, $cfErr -ErrorAction SilentlyContinue
$cfProc = Start-Process -FilePath $cfExe -ArgumentList "tunnel","--url","http://localhost:3000" -WindowStyle Hidden -PassThru -RedirectStandardOutput $cfLog -RedirectStandardError $cfErr
Write-Output "    cloudflared PID=$($cfProc.Id)"

# 3. Wait for tunnel URL
Write-Output "[3/4] Waiting for tunnel URL..."
$tunnelUrl = ""
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  $all = ""
  if (Test-Path $cfLog) { $all += (Get-Content $cfLog -ErrorAction SilentlyContinue) -join "`n" }
  if (Test-Path $cfErr) { $all += "`n" + ((Get-Content $cfErr -ErrorAction SilentlyContinue) -join "`n") }
  $m = [regex]::Match($all, 'https://[a-zA-Z0-9\-]+\.trycloudflare\.com')
  if ($m.Success) { $tunnelUrl = $m.Value; break }
}
if (-not $tunnelUrl) { Write-Output "❌ Tunnel URL not found"; exit 1 }
Write-Output "    ✅ Tunnel URL: $tunnelUrl"

# 4. Update .env with tunnel URL
Write-Output "[4/4] Updating .env and starting Express..."
# Use node to write .env (avoids PS permission issues with WriteAllText)
$nodeScript = @"
const fs = require('fs');
const p = '.env';
let raw = fs.readFileSync(p, 'utf8');
raw = raw.replace(/^ALIPAY_RETURN_URL=.*$/m, 'ALIPAY_RETURN_URL=$tunnelUrl/api/pay/return');
raw = raw.replace(/^ALIPAY_NOTIFY_URL=.*$/m, 'ALIPAY_NOTIFY_URL=$tunnelUrl/api/pay/notify');
fs.writeFileSync(p, raw, 'utf8');
console.log('env OK');
"@
$nodeScript | Out-File -FilePath (Join-Path $base "_env_update.js") -Encoding ascii
Push-Location $base
node _env_update.js
Remove-Item "_env_update.js" -ErrorAction SilentlyContinue
Pop-Location

# Start Express
$serverOut = Join-Path $base "server-out.log"
$serverErr = Join-Path $base "server-err.log"
Remove-Item $serverOut, $serverErr -ErrorAction SilentlyContinue
$nodeExe = (Get-Command node).Source
$serverProc = Start-Process -FilePath $nodeExe -ArgumentList "src/index.js" -WorkingDirectory $base -WindowStyle Hidden -PassThru -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr
Write-Output "    Express PID=$($serverProc.Id)"

# Verify
Start-Sleep -Seconds 4
try {
  $h = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 5
  Write-Output "    ✅ Server health: $($h.Content)"
} catch { Write-Output "    ❌ Server health: $_" }

Write-Output "`n=== ALL SET ==="
Write-Output "Tunnel URL: $tunnelUrl"
Write-Output "Local server: http://localhost:3000/"
Write-Output "Kill tunnel: Stop-Process -Id $($cfProc.Id) -Force"
Write-Output "Kill server: Stop-Process -Id $($serverProc.Id) -Force"
