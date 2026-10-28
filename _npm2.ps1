$root = "c:\Users\LENOVO\Downloads\MY SYSTEM"
$log  = Join-Path $root "_npm2.out.txt"
"" | Out-File -FilePath $log -Encoding utf8
function Log($m) { $m | Out-File -FilePath $log -Encoding utf8 -Append }

Log ("npm.cmd path: " + (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source)

$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCmd) { Log "npm.cmd not found on PATH"; exit 1 }

Log "--- npm --version ---"
$out = & $npmCmd --version 2>&1 | Out-String
Log ("exit=" + $LASTEXITCODE + " " + $out.Trim())

Log "--- npm config get registry ---"
$out = & $npmCmd config get registry 2>&1 | Out-String
Log ("exit=" + $LASTEXITCODE + " " + $out.Trim())

Log "--- npm install (backend) ---"
Push-Location (Join-Path $root "backend")
$out = & $npmCmd install --no-fund --no-audit --loglevel=error express cors dotenv express-validator express-rate-limit helmet jsonwebtoken morgan pg uuid winston bcryptjs 2>&1 | Out-String
Log ("exit=" + $LASTEXITCODE)
Log ($out.Trim())
Pop-Location

Log ("node_modules exists: " + (Test-Path (Join-Path $root "backend\node_modules")))