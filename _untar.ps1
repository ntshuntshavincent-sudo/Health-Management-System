$root = "c:\Users\LENOVO\Downloads\MY SYSTEM"
$src  = Join-Path $root "patient-system.tar.gz"
$dest = Join-Path $root "_staging\tarsys"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest | Out-Null
tar -xzf $src -C $dest
Write-Output "=== tar extracted ==="
Get-ChildItem -Path $dest -Recurse -File | ForEach-Object { Write-Output ($_.FullName.Replace($dest, "") + "  [" + $_.Length + "]") }