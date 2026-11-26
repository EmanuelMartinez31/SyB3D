@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Arreglar la ruta de League Broadcast

echo ===========================================================
echo   ARREGLAR LA RUTA DEL SENSOR
echo ===========================================================
echo.
echo  SyBSensor.csproj tiene escrita a mano la ruta:
echo      C:\Users\31ema\AppData\Local\LeagueBroadcast\current\
echo.
echo  En otro PC esa carpeta no existe, y el sensor no arranca.
echo  Esto la cambia por una que Windows resuelve solo.
echo.

set "CS="
if exist "%~dp0SyBSensor\SyBSensor.csproj" set "CS=%~dp0SyBSensor\SyBSensor.csproj"
if not defined CS if exist "%~dp0SyBSensor.csproj" set "CS=%~dp0SyBSensor.csproj"

if not defined CS (
  echo [ERROR] No encuentro SyBSensor.csproj.
  echo         Ejecuta esto en la raiz del proyecto.
  echo.
  pause
  exit /b 1
)

echo  Proyecto: %CS%
echo.

findstr /c:"31ema" "%CS%" >nul
if errorlevel 1 (
  echo  Ya no tiene la ruta fija. No hay nada que hacer aqui.
  echo.
  pause
  exit /b 0
)

copy "%CS%" "%CS%.bak-ruta" >nul
echo  Copia de seguridad: SyBSensor.csproj.bak-ruta
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%CS%'; $t=Get-Content -Raw -LiteralPath $p; $n=$t.Replace('<LbDir>C:\Users\31ema\AppData\Local\LeagueBroadcast\current\</LbDir>','<LbDir>$(LocalAppData)\LeagueBroadcast\current\</LbDir>'); if ($n -eq $t) { exit 2 }; Set-Content -LiteralPath $p -Value $n -NoNewline -Encoding UTF8"

if errorlevel 2 (
  echo  [AVISO] No se encontro la linea exacta que esperaba.
  echo          Abre SyBSensor.csproj con el Bloc de notas y cambia a mano
  echo          la linea LbDir por esta:
  echo.
  echo          ^<LbDir^>$(LocalAppData)\LeagueBroadcast\current\^</LbDir^>
  echo.
  pause
  exit /b 2
)

if errorlevel 1 (
  echo  [ERROR] Algo fallo al escribir. Restaura SyBSensor.csproj.bak-ruta
  echo          encima del archivo.
  echo.
  pause
  exit /b 1
)

echo ===========================================================
echo   LISTO
echo ===========================================================
echo.
echo  Ahora la ruta se calcula sola en cualquier PC.
echo  Arranca con iniciar.bat.
echo.
pause
