$root = "c:\Users\LENOVO\Downloads\MY SYSTEM"
$log  = Join-Path $root "_check.out.txt"
$out  = @()

$nm = Join-Path $root "backend\node_modules"
$out += "node_modules exists: " + (Test-Path $nm)
if (Test-Path $nm) {
    $pkgs = Get-ChildItem $nm -Directory | Where-Object { $_.Name -notlike '.*' } | Select-Object -ExpandProperty Name
    $out += "package count: " + $pkgs.Count
    foreach ($p in @('express','cors','dotenv','express-validator','express-rate-limit','helmet','jsonwebtoken','morgan','pg','uuid','winston','bcryptjs')) {
        $out += ("  " + $p + ": " + ($pkgs -contains $p))
    }
}

$pkg = Join-Path $root "backend\package.json"
$out += "--- package.json dependencies ---"
$out += (Get-Content $pkg -Raw)

$out | Out-File -FilePath $log -Encoding utf8