# SURAS AI-PRO Startup Script
Write-Host "🚀 Starting Suras AI-Pro Ecosystem..." -ForegroundColor Cyan

# 1. Start Server
Write-Host "📡 Launching Orchestrator (Server)..." -ForegroundColor Blue
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd server; npm.cmd run dev"

# 2. Start Client
Write-Host "🖥️ Launching Dashboard (Client)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd client; npm.cmd run dev"

Write-Host "✅ Systems initiated. Dashboard should be available at http://localhost:5173" -ForegroundColor Yellow
Write-Host "Press any key to exit this launcher..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
