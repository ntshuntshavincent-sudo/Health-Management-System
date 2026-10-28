Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = "c:\Users\LENOVO\Downloads\MY SYSTEM"
Set-Location $root

Write-Output "=== .idea contents ==="
Get-ChildItem -Path (Join-Path $root ".idea") -Recurse -File | ForEach-Object { Write-Output $_.FullName.Replace($root, ".") }

foreach ($name in @("files (1).zip", "files (2).zip", "files (3).zip")) {
    $p = Join-Path $root $name
    Write-Output ""
    Write-Output ("=== ZIP: " + $name + " ===")
    $zip = [System.IO.Compression.ZipFile]::OpenRead($p)
    Write-Output ("TOTAL ENTRIES: " + $zip.Entries.Count)
    $i = 0
    foreach ($e in $zip.Entries) {
        $i++
        if ($i -le 80) { Write-Output ("  " + $e.FullName + "   [" + $e.Length + "]") }
    }
    $zip.Dispose()
}

Write-Output ""
Write-Output "=== TAR.GZ: patient-system.tar.gz ==="
tar -tzf (Join-Path $root "patient-system.tar.gz") | Select-Object -First 200