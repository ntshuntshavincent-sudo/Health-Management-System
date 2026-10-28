# Syntax-check every backend JS file + report frontend deps + try loading the app.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

Write-Output '=== node --check backend files ==='
$files = Get-ChildItem "$root\backend\src", "$root\backend\server.js" -Recurse -File -Filter *.js |
  Where-Object { $_.FullName -notmatch 'node_modules' }
$fail = 0
foreach ($f in $files) {
  $out = & node --check $f.FullName 2>&1
  if ($LASTEXITCODE -ne 0) {
    $fail++
    Write-Output "FAIL  $($f.FullName)"
    Write-Output $out
  } else {
    Write-Output "ok    $($f.FullName.Substring($root.Length + 1))"
  }
}
Write-Output "backend syntax failures: $fail"

Write-Output ''
Write-Output '=== seed.js / migrate.js syntax ==='
foreach ($n in @('src\db\seed.js', 'src\db\migrate.js')) {
  $p = Join-Path "$root\backend" $n
  if (Test-Path $p) {
    $out = & node --check $p 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Output "FAIL  $n"; Write-Output $out } else { Write-Output "ok    $n" }
  }
}

Write-Output ''
Write-Output '=== frontend deps ==='
$nm = "$root\frontend\node_modules"
if (Test-Path "$nm\react\package.json")   { Write-Output 'react:        OK' } else { Write-Output 'react:        MISSING' }
if (Test-Path "$nm\react-dom\package.json"){ Write-Output 'react-dom:    OK' } else { Write-Output 'react-dom:    MISSING' }
if (Test-Path "$nm\react-scripts\bin\react-scripts.js") { Write-Output 'react-scripts: OK' } else { Write-Output 'react-scripts: MISSING' }
if (Test-Path "$nm\axios\package.json")   { Write-Output 'axios:        OK' } else { Write-Output 'axios:        MISSING' }
if (Test-Path "$nm\lucide-react\package.json") { Write-Output 'lucide-react: OK' } else { Write-Output 'lucide-react: MISSING' }
if (Test-Path "$nm\react-hot-toast\package.json") { Write-Output 'react-hot-toast: OK' } else { Write-Output 'react-hot-toast: MISSING' }
if (Test-Path "$nm\react-router-dom\package.json") { Write-Output 'react-router-dom: OK' } else { Write-Output 'react-router-dom: MISSING' }

Write-Output ''
Write-Output '=== load backend app (runtime require) ==='
Push-Location "$root\backend"
try {
  $env:NODE_ENV = 'development'
  & node -e "require('./src/app'); console.log('APP-LOADS-OK')" 2>&1 | Select-Object -First 6
} finally { Pop-Location }
