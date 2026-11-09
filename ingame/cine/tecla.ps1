# Pulsa una tecla del juego desde el servidor del Ingame.
#   -Accion barras    -> oculta / devuelve las barras de vida (tecla del juego)
#   -Accion dirigida  -> camara dirigida (tecla D)
#
# Foco forzado a la ventana del juego + tecla con codigo de exploracion,
# igual que la version que ya funciona en las pruebas.

param(
  [ValidateSet('barras', 'dirigida')][string]$Accion = 'barras'
)

$ErrorActionPreference = 'Stop'

if (-not ('EnvioIngame' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class EnvioIngame {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
}

$teclas = @{
  'a' = @(0x41, 0x1E); 'b' = @(0x42, 0x30); 'c' = @(0x43, 0x2E); 'd' = @(0x44, 0x20)
  'e' = @(0x45, 0x12); 'f' = @(0x46, 0x21); 'g' = @(0x47, 0x22); 'h' = @(0x48, 0x23)
  'i' = @(0x49, 0x17); 'j' = @(0x4A, 0x24); 'k' = @(0x4B, 0x25); 'l' = @(0x4C, 0x26)
  'm' = @(0x4D, 0x32); 'n' = @(0x4E, 0x31); 'o' = @(0x4F, 0x18); 'p' = @(0x50, 0x19)
  'q' = @(0x51, 0x10); 'r' = @(0x52, 0x13); 's' = @(0x53, 0x1F); 't' = @(0x54, 0x14)
  'u' = @(0x55, 0x16); 'v' = @(0x56, 0x2F); 'w' = @(0x57, 0x11); 'x' = @(0x58, 0x2D)
  'y' = @(0x59, 0x15); 'z' = @(0x5A, 0x2C)
  '0' = @(0x30, 0x0B); '1' = @(0x31, 0x02); '2' = @(0x32, 0x03); '3' = @(0x33, 0x04)
  '4' = @(0x34, 0x05); '5' = @(0x35, 0x06); '6' = @(0x36, 0x07); '7' = @(0x37, 0x08)
  '8' = @(0x38, 0x09); '9' = @(0x39, 0x0A)
  'f1' = @(0x70, 0x3B); 'f2' = @(0x71, 0x3C); 'f3' = @(0x72, 0x3D); 'f4' = @(0x73, 0x3E)
  'f5' = @(0x74, 0x3F); 'f6' = @(0x75, 0x40); 'f7' = @(0x76, 0x41); 'f8' = @(0x77, 0x42)
  'f9' = @(0x78, 0x43); 'f10' = @(0x79, 0x44); 'f11' = @(0x7A, 0x57); 'f12' = @(0x7B, 0x58)
  '-' = @(0xBD, 0x0C); '=' = @(0xBB, 0x0D); '[' = @(0xDB, 0x1A); ']' = @(0xDD, 0x1B)
  ';' = @(0xBA, 0x27); ',' = @(0xBC, 0x33); '.' = @(0xBE, 0x34); '/' = @(0xBF, 0x35)
  'numpad-' = @(0x6D, 0x4A); 'numpad+' = @(0x6B, 0x4E)
  'space' = @(0x20, 0x39); 'tab' = @(0x09, 0x0F); 'escape' = @(0x1B, 0x01)
  'minus' = @(0xBD, 0x0C); 'oemminus' = @(0xBD, 0x0C); 'subtract' = @(0x6D, 0x4A)
  'oemplus' = @(0xBB, 0x0D); 'add' = @(0x6B, 0x4E)
}

function Get-VentanaJuego {
  $procs = @(Get-Process -Name 'League of Legends*' -ErrorAction SilentlyContinue |
             Where-Object { $_.MainWindowHandle -ne 0 })
  if ($procs.Count -eq 0) { return [IntPtr]::Zero }
  return $procs[0].MainWindowHandle
}

function Set-FocoJuego {
  param([IntPtr]$Ventana)
  if ($Ventana -eq [IntPtr]::Zero) { return $false }
  try {
    if ([EnvioIngame]::IsIconic($Ventana)) { [EnvioIngame]::ShowWindow($Ventana, 9) | Out-Null }
    $fg = [EnvioIngame]::GetForegroundWindow()
    [uint32]$pidFg = 0
    $tidFg = [EnvioIngame]::GetWindowThreadProcessId($fg, [ref]$pidFg)
    $tidMe = [EnvioIngame]::GetCurrentThreadId()
    [EnvioIngame]::AttachThreadInput($tidMe, $tidFg, $true) | Out-Null
    [EnvioIngame]::BringWindowToTop($Ventana) | Out-Null
    [EnvioIngame]::SetForegroundWindow($Ventana) | Out-Null
    [EnvioIngame]::AttachThreadInput($tidMe, $tidFg, $false) | Out-Null
    Start-Sleep -Milliseconds 250
    return ([EnvioIngame]::GetForegroundWindow() -eq $Ventana)
  } catch { return $false }
}

function Get-RutaConfigJuego {
  $candidatos = @()
  foreach ($p in @(Get-Process -Name 'League of Legends*' -ErrorAction SilentlyContinue)) {
    try {
      if ($p.Path) {
        $juego = Split-Path (Split-Path $p.Path -Parent) -Parent
        $candidatos += (Join-Path $juego 'Config\PersistedSettings.json')
      }
    } catch { }
  }
  foreach ($base in @("$env:ProgramFiles\Riot Games", "${env:ProgramFiles(x86)}\Riot Games", 'C:\Riot Games')) {
    if ($base) { $candidatos += (Join-Path $base 'League of Legends\Config\PersistedSettings.json') }
  }
  foreach ($c in $candidatos) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return $null
}

function Get-TeclaBarras {
  # Tecla que el jugador tiene asignada a "Mostrar barras de vida".
  $cfg = Get-RutaConfigJuego
  if (-not $cfg) { return $null }
  try { $texto = [IO.File]::ReadAllText($cfg) } catch { return $null }
  $pos = 0
  while ($true) {
    $i = $texto.IndexOf('evtShowHealthBars', $pos)
    if ($i -lt 0) { break }
    $pos = $i + 18
    $trozo = $texto.Substring($i, [math]::Min(300, $texto.Length - $i))
    $m = [regex]::Match($trozo, '"value"\s*:\s*"([^"]*)"')
    if (-not $m.Success) { continue }
    $valor = $m.Groups[1].Value
    if ([string]::IsNullOrWhiteSpace($valor) -or $valor -match 'Unbound') { continue }
    $partes = [regex]::Matches($valor, '\[([^\]]+)\]')
    $tecla = ''
    foreach ($p in $partes) {
      $v = $p.Groups[1].Value
      if ($v -notmatch '^(Shift|Ctrl|Control|Alt)$') { $tecla = $v }
    }
    if (-not $tecla) { $tecla = $valor.Trim('[', ']') }
    return $tecla
  }
  return $null
}

function Send-Tecla {
  param([string]$Nombre)
  $Ventana = Get-VentanaJuego
  if ($Ventana -eq [IntPtr]::Zero) { Write-Output 'sin ventana del juego'; return $false }

  $n = $Nombre.ToLower().Trim()
  if (-not $teclas.ContainsKey($n)) { Write-Output "tecla no soportada: $Nombre"; return $false }
  $cod = $teclas[$n]

  $foco = Set-FocoJuego $Ventana
  if (-not $foco) { Write-Output 'sin foco (se envia igual)' }
  [EnvioIngame]::keybd_event([byte]$cod[0], [byte]$cod[1], 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [EnvioIngame]::keybd_event([byte]$cod[0], [byte]$cod[1], 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  Write-Output "tecla '$n' enviada"
  return $true
}

if ($Accion -eq 'dirigida') {
  Send-Tecla -Nombre 'd' | Out-Null
  exit 0
}

$teclaBarras = Get-TeclaBarras
if (-not $teclaBarras) {
  Write-Output 'el juego no tiene tecla para las barras de vida'
  exit 0
}
Send-Tecla -Nombre $teclaBarras | Out-Null
