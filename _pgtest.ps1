$ErrorActionPreference = "Continue"
Write-Output ("node: " + (node -v))
Write-Output ("npm:  " + (npm -v))

$candidates = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName "bin\psql.exe" } | Where-Object { Test-Path $_ }
Write-Output ("psql candidates: " + ($candidates -join ", "))

$psql = $candidates | Select-Object -Last 1
if (-not $psql) { Write-Output "NO PSQL FOUND"; exit 1 }
Write-Output ("using: " + $psql)

foreach ($pw in @("postgres", "password", "admin", "root")) {
    $env:PGPASSWORD = $pw
    $out = & $psql -U postgres -h localhost -p 5432 -t -A -c "select 'CONNECT_OK ' || version();" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Output ("PASSWORD '" + $pw + "' WORKS -> " + ($out -join " "))
        Write-Output "PSQL_PATH=$psql"
        exit 0
    } else {
        Write-Output ("password '" + $pw + "' failed: " + (($out | Select-Object -First 1)))
    }
}
Write-Output "NO WORKING PASSWORD FOUND"