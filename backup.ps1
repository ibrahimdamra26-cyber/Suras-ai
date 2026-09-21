# Suras AI-Pro - Backup the project source (excludes node_modules and logs).
# Run this periodically to keep a portable snapshot on E: (safe from C: format).
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$stage = "E:\Suras-Backups\stage"
$dest  = "E:\Suras-Backups\suras-$stamp.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (-not (Test-Path "E:\Suras-Backups")) { New-Item -ItemType Directory -Path "E:\Suras-Backups" | Out-Null }

# Stage a clean copy of the source tree
robocopy "E:\Suras" $stage /E /R:1 /W:1 /XD node_modules /XF *.log 2>&1 | Out-Null

# Zip it
Compress-Archive -Path "$stage\*" -DestinationPath $dest -Force
Remove-Item $stage -Recurse -Force

Write-Host "Backed up Suras source to: $dest"
Write-Host "Models live separately at E:\OllamaModels (relocated, format-safe)."
