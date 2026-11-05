$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$out = Join-Path $root 'diagnostico-resultado.txt'
$lines = New-Object System.Collections.Generic.List[string]
function Write-Line($t) { $lines.Add([string]$t); Write-Host $t }

Write-Line "=========================================================="
Write-Line "  DIAGNOSTICO SyB3D"
Write-Line "=========================================================="
Write-Line ("Fecha:    " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Write-Line ("Carpeta:  " + $root)
Write-Line ""

Write-Line "--- 1. Node.js / npm ---"
Write-Line ("  node: " + ((& node -v 2>&1) -join ' '))
Write-Line ("  npm:  " + ((& npm -v 2>&1) -join ' '))
Write-Line ""

Write-Line "--- 2. Archivos clave del proyecto ---"
foreach ($f in @('server.js', 'package.json', 'draft\server.js', 'ingame\server.js', 'postgame\server.js', 'ingame\overlay\index.html', 'ingame\overlay\src\render.js')) {
  $p = Join-Path $root $f
  if (Test-Path $p) { Write-Line ("  OK      " + $f) } else { Write-Line ("  FALTA   " + $f) }
}
Write-Line ""

Write-Line "--- 3. Dependencias (node_modules) ---"
foreach ($m in @('express', 'ws')) {
  $p = Join-Path $root ("node_modules\" + $m + "\package.json")
  if (Test-Path $p) { Write-Line ("  OK      " + $m) } else { Write-Line ("  FALTA   " + $m) }
}
Write-Line ""

Write-Line "--- 4. Puerto 3000 ANTES de arrancar ---"
$net = & netstat -ano 2>$null | Select-String ":3000" | Select-String "LISTENING"
if ($net) {
  foreach ($n in $net) {
    $line = $n.ToString().Trim()
    Write-Line ("  " + $line)
    $procId = ($line -split '\s+')[-1]
    if ($procId -match '^\d+$') {
      $name = (& tasklist /FI ("PID eq " + $procId) /NH 2>$null | Out-String).Trim()
      if ($name) { Write-Line ("     proceso: " + $name) }
    }
  }
} else {
  Write-Line "  NADIE escucha en el puerto 3000"
}
Write-Line ""

Write-Line "--- 5. Arrancando el servidor durante 6 segundos ---"
$so = Join-Path $root 'srv-stdout.txt'
$se = Join-Path $root 'srv-stderr.txt'
Remove-Item $so, $se -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $root `
  -RedirectStandardOutput $so -RedirectStandardError $se -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 6
$alive = -not $proc.HasExited
Write-Line ("  proceso sigue vivo a los 6s: " + $alive)
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/status' -TimeoutSec 4
  Write-Line ("  /status -> HTTP " + $r.StatusCode)
  Write-Line ("  " + $r.Content)
} catch {
  Write-Line ("  /status FALLA -> " + $_.Exception.Message)
}
if ($alive) { Stop-Process -Id $proc.Id -Force; Write-Line "  (servidor detenido por el diagnostico)" }
Write-Line ""

Write-Line "--- 6. Lo que imprime el servidor ---"
$any = $false
if (Test-Path $so) {
  Get-Content $so | ForEach-Object { if ($_.Trim()) { Write-Line ("  OUT| " + $_); $script:any = $true } }
}
if (Test-Path $se) {
  Get-Content $se | ForEach-Object { if ($_.Trim()) { Write-Line ("  ERR| " + $_); $script:any = $true } }
}
if (-not $any) { Write-Line "  (sin salida: el proceso murio sin escribir nada)" }
Write-Line ""

Write-Line "--- 7. Lockfile de League of Legends ---"
$found = $false
foreach ($lf in @(
  'F:\Riot\Riot Games\League of Legends\lockfile',
  'C:\Riot Games\League of Legends\lockfile',
  'D:\Riot Games\League of Legends\lockfile',
  'C:\Program Files\Riot Games\League of Legends\lockfile'
)) {
  if (Test-Path $lf) { Write-Line ("  ENCONTRADO  " + $lf); $found = $true }
}
if (-not $found) { Write-Line "  No se encontro el lockfile en las rutas habituales (normal si LoL esta cerrado)" }
Write-Line ""

Write-Line "--- 8. Estado de git ---"
$status = (& git status --porcelain 2>&1 | Out-String).Trim()
if ($status) { foreach ($s in ($status -split "`n")) { Write-Line ("  " + $s.TrimEnd()) } } else { Write-Line "  (sin cambios pendientes)" }
Write-Line ("  rama: " + ((& git rev-parse --abbrev-ref HEAD 2>&1) -join ' '))
Write-Line ("  ultimo commit: " + ((& git log -1 --pretty='%h %s' 2>&1) -join ' '))
Write-Line ""
Write-Line "=== FIN DEL DIAGNOSTICO ==="

$lines -join "`r`n" | Set-Content -Path $out -Encoding UTF8
Write-Host ""
Write-Host "=========================================================="
Write-Host (" Reporte guardado en: " + $out)
Write-Host " Abrelo, copia todo el texto y pasalo al chat."
Write-Host "=========================================================="
