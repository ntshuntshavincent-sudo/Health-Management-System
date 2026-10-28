$log = "c:\Users\LENOVO\Downloads\MY SYSTEM\_pg3.out.txt"
$out = @()

$procs = Get-Process postgres -ErrorAction SilentlyContinue
$out += "postgres PIDs: " + ($procs.Id -join ",")
$pids = $procs.Id
$conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $pids -contains $_.OwningProcess }
$out += "listening: " + (($conns | ForEach-Object { $_.LocalAddress + ":" + $_.LocalPort }) -join " ; ")

$conf = "C:\Program Files\PostgreSQL\18\data\postgresql.conf"
if (Test-Path $conf) {
    $out += "--- postgresql.conf (active lines) ---"
    $out += (Get-Content $conf | Where-Object { $_ -match "^\s*(port|listen_addresses|unix_socket)" })
} else { $out += "no postgresql.conf at $conf" }

$hba = "C:\Program Files\PostgreSQL\18\data\pg_hba.conf"
if (Test-Path $hba) {
    $out += "--- pg_hba.conf (active lines) ---"
    $out += (Get-Content $hba | Where-Object { $_ -match "^\s*host" })
} else { $out += "no pg_hba.conf" }

$out | Out-File -FilePath $log -Encoding utf8