@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Compilar SyB3D

echo ===========================================================
echo   COMPILANDO SyB3D
echo ===========================================================
echo.
echo  Hace falta el SDK de .NET 11 (el mismo que compila SyBSensor).
echo  La primera vez tarda un poco: descarga el paquete de WebView2.
echo.

where dotnet >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No encuentro "dotnet".
  echo         Instala el SDK de .NET 11 desde https://dotnet.microsoft.com
  echo.
  pause
  exit /b 1
)

echo Compilando...
echo.
dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none -o "%~dp0dist"

if errorlevel 1 goto fallo

echo.
echo Creando el acceso directo en el escritorio...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $e=$PWD.Path+'\dist\SyB3D.exe'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($d+'\SyB3D.lnk'); $s.TargetPath=$e; $s.WorkingDirectory=$PWD.Path+'\dist'; $s.IconLocation=$e+',0'; $s.Description='SyB3D - Panel de control'; $s.Save()"

echo.
echo ===========================================================
echo   LISTO
echo ===========================================================
echo.
if exist "%~dp0dist\SyB3D.exe" (
  echo   El ejecutable esta en:
  echo     %~dp0dist\SyB3D.exe
  echo.
  echo   Y ya tienes un acceso directo llamado "SyB3D" en el
  echo   escritorio. Doble clic ahi y ya esta.
  echo.
  echo   IMPORTANTE: no saques el .exe de su carpeta. Si lo quieres
  echo   abrir desde otro sitio, usa el acceso directo.
  echo.
) else (
  echo   [AVISO] No ha dado error pero no veo dist\SyB3D.exe.
  echo           Mira a ver que hay en la carpeta Lanzador\dist
  echo.
)
start "" "%~dp0dist"
echo Se abre la carpeta para que lo veas. Pulsa una tecla para cerrar.
pause >nul
exit /b 0

:fallo
echo.
echo ===========================================================
echo   [ERROR] NO COMPILO
echo ===========================================================
echo.
echo  Copia el mensaje de arriba tal cual y me lo pasas.
echo.
echo  Ayuda rapida:
echo    - Si dice NETSDK1045 o habla de "net11.0": tienes otra
echo      version del SDK. Dime el numero y lo ajusto.
echo    - Si dice que no encuentra WebView2: es que no hay
echo      internet, o el NuGet esta bloqueado.
echo.
pause
exit /b 1
