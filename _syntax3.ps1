# Compact syntax check: prints ONLY failures, ASCII-encoded, to _syntax3.out.txt
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$lines = @()

$files = Get-ChildItem "$root\backend" -Recurse -File -Filter *.js |
  Where-Object { $_.FullName -notmatch 'node_modules' }

foreach ($f in $files) {
  $out = & node --check $f.FullName 2>&1
  if ($LASTEXITCODE -ne 0) {
    $msg = (($out | Out-String) -split "`r?`n" | Where-Object { $_ -match 'Error|^\s*at' } | Select-Object -First 3) -join ' | '
    $lines += "FAIL " + $f.FullName.Substring($root.Length + 1)
    $lines += "     " + $msg
  }
}
$lines += "TOTAL-FAILURES: " + ($lines | Where-Object { $_ -like 'FAIL*' }).Count
$lines | Set-Content -Path "$root\_syntax3.out.txt" -Encoding ASCII
