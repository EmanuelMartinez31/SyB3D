# ---------------------------------------------------------------------------
#  arreglar-libreria-parche.ps1   (r93)
#  Mira por que el sensor dice "Game Lib not found" y deja preparado lo que
#  depende de League Broadcast. No toca nada sin preguntar.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Continue'
$informe = Join-Path $PSScriptRoot 'informe-leaguebroadcast.txt'
$lineas  = New-Object System.Collections.ArrayList

function W([string]$t) {
    [void]$lineas.Add($t)
    Write-Host $t
}
function Sep() { W '' ; W ('-' * 70) }

W '=============================================================='
W ' INFORME: por que el sensor no encuentra la libreria del juego'
W '=============================================================='
W (' Fecha: ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
W ''

# ---------------------------------------------------------------- 1 League Broadcast
Sep
W '1. LEAGUE BROADCAST'
Sep
$lb = $null
$candidatos = @(
    (Join-Path $env:LOCALAPPDATA 'LeagueBroadcast\current'),
    (Join-Path $env:LOCALAPPDATA 'LeagueBroadcast'),
    'C:\Program Files\LeagueBroadcast'
)
foreach ($c in $candidatos) {
    if (-not $lb -and (Test-Path $c)) {
        if (Test-Path (Join-Path $c 'LeagueBroadcast.exe')) { $lb = $c }
        elseif (Test-Path (Join-Path $c 'current')) {
            $cur = Join-Path $c 'current'
            if (Test-Path $cur) { $lb = $cur }
        }
    }
}
if (-not $lb) {
    W '   No encuentro la carpeta de League Broadcast.'
    W '   Se busco en:'
    foreach ($c in $candidatos) { W ('     ' + $c) }
} else {
    W ('   Carpeta: ' + $lb)
    $real = $lb
    try {
        $it = Get-Item -LiteralPath $lb -Force
        if ($it.Target) { $real = $it.Target; W ('   En realidad apunta a: ' + $real) }
    } catch { }
    $exe = Join-Path $real 'LeagueBroadcast.exe'
    if (Test-Path $exe) {
        $v = (Get-Item $exe).VersionInfo.FileVersion
        W ('   Version del ejecutable: ' + $v)
    } else {
        W '   No hay LeagueBroadcast.exe en esa carpeta.'
    }
}

$proc = Get-Process -Name 'LeagueBroadcast' -ErrorAction SilentlyContinue
if ($proc) { W '   League Broadcast esta ABIERTO ahora mismo.' } else { W '   League Broadcast esta cerrado.' }
$lolcli = Get-Process -Name 'LeagueClientUx','LeagueClient' -ErrorAction SilentlyContinue
if ($lolcli) { W '   El cliente de League of Legends esta ABIERTO.' } else { W '   El cliente de League of Legends esta cerrado.' }

# ---------------------------------------------------------------- 2 librerias lblib
Sep
W '2. LIBRERIAS DEL JUEGO (lblib) QUE HAY EN LEAGUE BROADCAST'
Sep
$encontradas = 0
if ($lb) {
    try {
        $libs = Get-ChildItem -LiteralPath $real -Recurse -Filter 'lblib*.dll' -ErrorAction SilentlyContinue -Force
        foreach ($l in $libs) {
            $encontradas++
            W ('   ' + $l.FullName)
            W ('       ' + $l.Length + ' bytes, modificado ' + $l.LastWriteTime)
            try {
                $fv = $l.VersionInfo.FileVersion
                if ($fv) { W ('       version del archivo: ' + $fv) }
            } catch { }
        }
    } catch { }
}
if ($encontradas -eq 0) { W '   Ninguna lblib*.dll dentro de League Broadcast.' }

$proyecto = Split-Path $PSScriptRoot -Parent
$carpetasSensor = @(
    (Join-Path $PSScriptRoot 'SyBSensor\bin\Release'),
    (Join-Path $PSScriptRoot 'SyBSensor\bin'),
    (Join-Path $proyecto 'SyBSensor\bin\Release'),
    (Join-Path $proyecto 'SyBSensor\bin')
)
W ''
W '   lblib que ve el sensor cerca de su ejecutable:'
$haySensor = $false
foreach ($cs in $carpetasSensor) {
    if (Test-Path $cs) {
        $l2 = Get-ChildItem -LiteralPath $cs -Recurse -Filter 'lblib*.dll' -ErrorAction SilentlyContinue -Force
        foreach ($l in $l2) { $haySensor = $true; W ('     ' + $l.FullName + '   (' + $l.LastWriteTime + ')') }
    }
}
if (-not $haySensor) { W '     ninguna' }

# ---------------------------------------------------------------- 3 donde esta el juego
Sep
W '3. DONDE ESTA INSTALADO LEAGUE OF LEGENDS'
Sep
$juego = $null
$claves = @(
    'HKLM:\SOFTWARE\WOW6432Node\Riot Games, Inc.\League of Legends',
    'HKLM:\SOFTWARE\Riot Games, Inc.\League of Legends',
    'HKCU:\SOFTWARE\Riot Games, Inc.\League of Legends'
)
foreach ($k in $claves) {
    try {
        if (Test-Path $k) {
            $p = (Get-ItemProperty -Path $k -ErrorAction Stop).InstallLocation
            if ($p) { W ('   Registro: ' + $k); W ('   -> ' + $p); if (-not $juego) { $juego = $p.TrimEnd('\') } }
        }
    } catch { }
}
foreach ($d in @('C','D','E','F','G','H')) {
    foreach ($sub in @('\Riot Games\League of Legends', '\Riot\Riot Games\League of Legends', '\Games\Riot Games\League of Legends')) {
        $p = $d + ':' + $sub
        if ((Test-Path $p) -and -not $juego) { $juego = $p; W ('   Encontrado en el disco: ' + $p) }
    }
}
if (-not $juego) { W '   No lo encuentro por registro ni en las rutas tipicas.' }
else { W ('   Carpeta del juego: ' + $juego) }

# ---------------------------------------------------------------- 4 Component.json
Sep
W '4. CONFIGURACION DE LEAGUE BROADCAST (LeagueInstall)'
Sep
$cfgs = New-Object System.Collections.ArrayList
$sitios = @()
if ($lb) { $sitios += $real }
$sitios += (Join-Path $env:APPDATA 'LeagueBroadcast')
$sitios += (Join-Path $env:LOCALAPPDATA 'LeagueBroadcast')
foreach ($s in $sitios) {
    if (Test-Path $s) {
        $f = Get-ChildItem -LiteralPath $s -Recurse -Filter 'Component.json' -ErrorAction SilentlyContinue -Force
        foreach ($x in $f) { if (-not $cfgs.Contains($x.FullName)) { [void]$cfgs.Add($x.FullName) } }
    }
}
if ($cfgs.Count -eq 0) {
    W '   No hay ningun Component.json. Tu version de League Broadcast guarda'
    W '   la ruta del juego en otro sitio, o no la tiene configurada.'
} else {
    foreach ($cfg in $cfgs) {
        W ('   Archivo: ' + $cfg)
        W ''
        try { W ((Get-Content -LiteralPath $cfg -Raw) -replace "`r",'') } catch { W '   No se pudo leer.' }
        W ''
    }
}

# ---------------------------------------------------------------- 5 arreglo
Sep
W '5. ARREGLO'
Sep
if ($cfgs.Count -eq 0) {
    W '   No puedo tocar nada: no hay Component.json que editar.'
} elseif (-not $juego) {
    W '   No puedo tocar nada: no se donde esta el juego.'
} elseif ($proc) {
    W '   League Broadcast esta abierto. Cierralo y vuelve a ejecutar esto.'
} else {
    $carpetaRiot = Split-Path (Split-Path $juego -Parent) -Parent
    $anadir = @($juego)
    if ($carpetaRiot -and (Test-Path $carpetaRiot)) { $anadir += $carpetaRiot }

    foreach ($cfg in $cfgs) {
        W ('   Revisando ' + $cfg)
        $texto = Get-Content -LiteralPath $cfg -Raw
        $json = $null
        try { $json = $texto | ConvertFrom-Json } catch {
            W '   No es un JSON que pueda leer sin romperlo. No lo toco.'
            continue
        }
        $prop = $json.PSObject.Properties['LeagueInstall']
        $actual = @()
        if ($prop -and $prop.Value) {
            if ($prop.Value -is [System.Array]) { $actual = @($prop.Value) }
            else { $actual = @(($prop.Value -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
        }
        W ('   LeagueInstall ahora: ' + ($(if ($actual.Count) { $actual -join ' | ' } else { '(vacio)' })))

        $falta = @()
        foreach ($a in $anadir) {
            $yaEsta = $false
            foreach ($b in $actual) {
                if ($b -and ($b.TrimEnd('\') -ieq $a.TrimEnd('\'))) { $yaEsta = $true }
            }
            if (-not $yaEsta) { $falta += $a }
        }
        if ($falta.Count -eq 0) { W '   Ya tiene la carpeta del juego. No toco nada.' ; continue }

        W ('   Falta: ' + ($falta -join ' | '))
        $r = Read-Host '   Lo anado al archivo? (S/N)'
        if ($r -notmatch '^[sS]') { W '   No lo he tocado.' ; continue }

        $nuevo = @($actual) + $falta
        $copia = $cfg + '.bak'
        if (-not (Test-Path $copia)) { Copy-Item -LiteralPath $cfg -Destination $copia -Force }
        try {
            if ($prop) { $json.PSObject.Properties['LeagueInstall'].Value = $nuevo }
            else { $json | Add-Member -NotePropertyName 'LeagueInstall' -NotePropertyValue $nuevo -Force }
            $salida = $json | ConvertTo-Json -Depth 20
            $utf8sinbom = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($cfg, $salida, $utf8sinbom)
            W '   Anadido y guardado. Copia del anterior en Component.json.bak'
        } catch {
            W ('   No pude guardarlo: ' + $_.Exception.Message)
            W '   Restauro el original.'
            Copy-Item -LiteralPath $copia -Destination $cfg -Force
        }
    }
}

# ---------------------------------------------------------------- 6 que hacer
Sep
W '6. QUE HACER AHORA, EN ESTE ORDEN'
Sep
W '   1) Cierra League Broadcast si esta abierto.'
W '   2) Abre el cliente de League of Legends y dejalo en el menu.'
W '   3) Abre League Broadcast y espera a que cargue del todo.'
W '   4) Arranca tu iniciar.bat.'
W ''
W '   Si el sensor sigue diciendo "Game Lib not found", mandame este informe'
W '   y la ventana del sensor.'
W ''
Sep

$lineas | Out-File -FilePath $informe -Encoding UTF8
Write-Host ''
Write-Host (' Informe guardado en: ' + $informe)
Write-Host ''
