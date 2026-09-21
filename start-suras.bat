@echo off
setlocal EnableDelayedExpansion
title Suras AI Launcher
cd /d E:\Suras

echo ============================================
echo   Suras AI Launcher - Cloud Mind OpenAI via Python
echo ============================================
echo.

:: === 1) Server :3001 (spawns Python engine :3010 by itself) ===
echo [1/3] Suras Server :3001 ...
powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { $pid = $conn.OwningProcess; Write-Output \"Port 3001 is in use by PID=$pid\"; Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue; exit 0 } else { exit 1 }"
if %errorlevel%==0 (
    echo   Port 3001 was occupied; stale Suras process was stopped.
)

echo   Starting Server...
start "Suras Server" cmd /k "title Suras Server && cd /d E:\Suras\server && node index.js"
set TRIES=0
:wait_server
timeout /t 2 >nul
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
    echo   Server OK.
) else (
    set /a TRIES+=1
    if !TRIES! LSS 15 goto wait_server
    echo   [ERROR] Server did not come up on :3001 - check the Suras Server window.
    pause
    exit /b 1
)

:: === 2) Python engine :3010 (auto-spawned by the Server) ===
echo [2/3] Python engine :3010 ...
set TRIES=0
:wait_gov
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
    echo   Engine OK.
    goto client_step
)
timeout /t 2 >nul
set /a TRIES+=1
if !TRIES! LSS 15 goto wait_gov
echo   [WARN] Engine :3010 not up yet - Server will keep retrying it in background.

:: === 3) Client UI :5173 (fixed port) ===
:client_step
echo [3/3] Suras Client :5173 ...
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
    echo   Client OK.
    goto open_browser
)
echo   Starting Client...
start "Suras Client" cmd /k "title Suras Client && cd /d E:\Suras\client && npx vite --port 5173 --strictPort"
set TRIES=0
:wait_client
timeout /t 2 >nul
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
    echo   Client OK.
    goto open_browser
)
set /a TRIES+=1
if !TRIES! LSS 15 goto wait_client
echo   [ERROR] Client did not come up on :5173 - check the Suras Client window.
pause
exit /b 1

:: === 4) Open browser only when UI is really up ===
:open_browser
echo Opening Suras UI...
start http://localhost:5173
echo.
echo ============================================
echo  Suras system is ONLINE:
echo   UI      http://localhost:5173
echo   API     http://localhost:3001
echo   Engine  http://127.0.0.1:3010
echo ============================================
pause
exit /b 0
