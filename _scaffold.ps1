$root = "c:\Users\LENOVO\Downloads\MY SYSTEM"
$s = Join-Path $root "_staging"
Set-Location $root

# ── directories ───────────────────────────────────────────────────────────────
$dirs = @(
  "backend\src\db", "backend\src\middleware", "backend\src\routes", "backend\src\utils",
  "backend\migrations", "backend\logs",
  "frontend\src\api", "frontend\src\context", "frontend\src\components", "frontend\src\pages", "frontend\public",
  "deployment", "docs"
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Path (Join-Path $root $d) -Force | Out-Null }

# ─ copy reusable existing code into the new structure ────────────────────────
$map = @{
  "$s\frontend\index.css"        = "frontend\src\index.css"
  "$s\frontend\App.js"           = "frontend\src\App.js"
  "$s\frontend\client.js"        = "frontend\src\api\client.js"
  "$s\frontend\AuthContext.js"   = "frontend\src\context\AuthContext.js"
  "$s\frontend\Layout.js"        = "frontend\src\components\Layout.js"
  "$s\frontend\Sidebar.js"       = "frontend\src\components\Sidebar.js"
  "$s\frontend\Login.js"         = "frontend\src\pages\Login.js"
  "$s\frontend\Dashboard.js"     = "frontend\src\pages\Dashboard.js"
  "$s\frontend\Kiosk.js"         = "frontend\src\pages\Kiosk.js"
  "$s\frontend\Patients.js"      = "frontend\src\pages\Patients.js"
  "$s\frontend\Appointments.js"  = "frontend\src\pages\Appointments.js"
  "$s\frontend\Notes.js"         = "frontend\src\pages\Notes.js"
  "$s\frontend\Doctors.js"       = "frontend\src\pages\Providers.js"
  "$s\deploy\nginx.conf"         = "deployment\nginx.conf"
  "$s\deploy\ecosystem.config.js"= "deployment\ecosystem.config.js"
  "$s\deploy\deploy.sh"          = "deployment\deploy.sh"
  "$s\deploy\POPIA_COMPLIANCE.md"= "docs\POPIA_COMPLIANCE.md"
  "$s\deploy\security.js"        = "backend\src\middleware\security.js"
  "$s\deploy\sanitise.js"        = "backend\src\middleware\sanitise.js"
  "$s\deploy\popia.js"           = "backend\src\middleware\popia.js"
  "$s\backend\auth.js"           = "backend\src\middleware\auth.js"
  "$s\backend\pool.js"           = "backend\src\db\pool.js"
  "$s\tarsys\package-lock.json"  = "backend\package-lock.json"
}
foreach ($k in $map.Keys) {
  Copy-Item -Path $k -Destination (Join-Path $root $map[$k]) -Force
  Write-Output ("copied -> " + $map[$k])
}

Get-ChildItem -Path $root -Recurse -File -Depth 3 |
  Where-Object { $_.FullName -notmatch "_staging|node_modules|\.idea" } |
  ForEach-Object { Write-Output ("  " + $_.FullName.Replace($root + "\", "") + " [" + $_.Length + "]") }