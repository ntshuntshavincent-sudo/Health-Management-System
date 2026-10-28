$c = Get-Content 'frontend\src\pages\Kiosk.js'
Write-Output ("TOTAL=" + $c.Count)
$i = 1
foreach ($line in $c) { Write-Output ("{0,4}: {1}" -f $i, $line); $i++ }
