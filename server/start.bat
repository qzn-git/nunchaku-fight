@echo off
cd /d "%~dp0"

echo ============================================================
echo  nunchaku-pay-server - Alipay Payment Service
echo ============================================================
echo.

REM Check node
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] node.js not found. Please install Node.js first.
    echo Download: https://nodejs.org/
    pause
    exit /b 1
)

REM Check dependencies
if not exist "node_modules" (
    echo [INFO] node_modules not found, running npm install...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo.
)

echo [INFO] Starting service...
echo [INFO] URL: http://localhost:3000/
echo [INFO] Press Ctrl+C to stop.
echo.

REM Run node with output redirected to log files
node src/index.js > start-out.log 2> start-err.log

REM If we get here, node exited
echo.
echo [ERROR] Service stopped unexpectedly.
echo ---------- stdout (last 10 lines) ----------
if exist start-out.log (
    powershell -NoProfile -Command "Get-Content start-out.log -Tail 10"
)
echo ---------- stderr (last 10 lines) ----------
if exist start-err.log (
    powershell -NoProfile -Command "Get-Content start-err.log -Tail 10"
)
echo -------------------------------------------
echo Full log files: start-out.log, start-err.log
pause
