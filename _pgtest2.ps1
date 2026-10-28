$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$log  = "c:\Users\LENOVO\Downloads\MY SYSTEM\_pgtest2.out.txt"
$lines = @()
$lines += "node: " + (node -v)
foreach ($pw in @("postgres", "password", "admin123", "root", "1234")) {
    $env:PGPASSWORD = $pw
    $env:PGCONNECT_TIMEOUT = "5"
    $out = & $psql -U postgres -h localhost -p 5432 -t -A -c "select current_user;" 2>&1 | Out-String
    $lines += ("pw='" + $pw + "' exit=" + $LASTEXITCODE + " out=" + ($out -replace "\s+", " ").Trim())
}
$lines | Out-File -FilePath $log -Encoding utf8
Get-Content $log | Write-Output