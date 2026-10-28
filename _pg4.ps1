$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$log  = "c:\Users\LENOVO\Downloads\MY SYSTEM\_pg4.out.txt"
"" | Out-File -FilePath $log -Encoding utf8
function Log($m) { $m | Out-File -FilePath $log -Encoding utf8 -Append }

Log ("pgpass candidates:")
foreach ($p in @("$env:APPDATA\postgresql\pgpass.conf", "$env:APPDATA\postgresql\pgpass", "C:\Users\LENOVO\AppData\Roaming\postgresql\pgpass.conf")) {
    if (Test-Path $p) { Log ("  FOUND " + $p); Log ((Get-Content $p -Raw)) } else { Log ("  missing " + $p) }
}

Log "connection probes on port 1357:"
foreach ($pw in @("postgres","Postgres123","password","admin","root","1234","postgres123","MySystem2026","P@ssw0rd")) {
    $env:PGPASSWORD = $pw
    $out = & $psql -w -U postgres -h 127.0.0.1 -p 1357 -t -A -c "select 'OK';" 2>&1 | Out-String
    $code = $LASTEXITCODE
    Log ("  pw='" + $pw + "' exit=" + $code + " out=" + (($out -replace "\r?\n"," ").Trim()))
    if ($code -eq 0) { Log ("WORKING_PASSWORD=" + $pw); break }
}