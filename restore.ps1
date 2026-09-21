# Suras AI-Pro - Restore after formatting C: or on a fresh machine.
# Prerequisites (install on C: as usual): Node.js (LTS), Ollama (Windows app), optionally Git.
# The project (E:\Suras) and the AI models (E:\OllamaModels) already live on E: and survive a C: format.
$ErrorActionPreference = 'SilentlyContinue'

Write-Host "[1/4] Pointing Ollama to the model store on E: (survives C: format)..."
[System.Environment]::SetEnvironmentVariable("OLLAMA_MODELS", "E:\OllamaModels", "User")

Write-Host "[2/4] Starting Ollama if not running..."
$svc = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*ollama.exe*serve*' }
if (-not $svc) {
    Start-Process -FilePath "ollama.exe" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 6
}
ollama list

Write-Host "[3/4] Installing dependencies only if missing, then launching server + client..."
Set-Location E:\Suras
if (-not (Test-Path "E:\Suras\node_modules")) { npm install }
if (-not (Test-Path "E:\Suras\server\node_modules")) { Push-Location E:\Suras\server; npm install; Pop-Location }
if (-not (Test-Path "E:\Suras\client\node_modules")) { Push-Location E:\Suras\client; npm install; Pop-Location }
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -Command `"cd E:\Suras\server; npm run dev`"" -WindowStyle Hidden
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -Command `"cd E:\Suras\client; npm run dev`"" -WindowStyle Hidden

Write-Host "[4/4] Done. Suras is restoring. Open http://localhost:5173"
Write-Host "If models are missing, run: ollama pull qwen2.5-coder:7b   (and qwen2.5-coder:1.5b)"
