Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = "c:\Users\LENOVO\Downloads\MY SYSTEM"
Set-Location $root

$stage = Join-Path $root "_staging"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

$targets = @{
    "files (1).zip" = "backend"
    "files (2).zip" = "frontend"
    "files (3).zip" = "deploy"
}
foreach ($k in $targets.Keys) {
    $dest = Join-Path $stage $targets[$k]
    New-Item -ItemType Directory -Path $dest | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $root $k), $dest)
    Write-Output ("extracted " + $k + " -> " + $targets[$k])
}

# pptx text
$pptxDest = Join-Path $stage "pptx"
New-Item -ItemType Directory -Path $pptxDest | Out-Null
[System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $root "HealthRecord_DoH_Pitch.pptx"), $pptxDest)
Write-Output "extracted pptx"

# include source files referenced by .idea for context
Write-Output ""
Write-Output "=== STAGING TREE ==="
Get-ChildItem -Path $stage -Recurse -File | ForEach-Object {
    Write-Output ($_.FullName.Replace($stage, "") + "  [" + $_.Length + "]")
}
