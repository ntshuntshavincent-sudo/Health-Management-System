$stage = "c:\Users\LENOVO\Downloads\MY SYSTEM\_staging"
$slideDir = Join-Path $stage "pptx\ppt\slides"
if (-not (Test-Path $slideDir)) { Write-Output "no slides dir"; exit }
$files = Get-ChildItem $slideDir -Filter "slide*.xml" | Sort-Object { [int]($_.BaseName -replace '\D','') }
foreach ($f in $files) {
    $xml = Get-Content $f.FullName -Raw
    $texts = [regex]::Matches($xml, '<a:t>(.*?)</a:t>') | ForEach-Object { $_.Groups[1].Value }
    Write-Output ("### " + $f.Name)
    Write-Output (($texts -join " | "))
    Write-Output ""
}