@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Sensor de SyB3D - arreglo para .NET 11 (r90c)
cd /d "%~dp0"

set "LBDIR=%LocalAppData%\LeagueBroadcast\current"
set "LISTADO=%~dp0listado-leaguebroadcast.txt"

echo.
echo  ==============================================================
echo   SENSOR DE SyB3D - LEAGUE BROADCAST NUEVO (.NET 11)
echo  ==============================================================
echo.
echo --- SDK de .NET instalados -------------------------------------
dotnet --list-sdks
echo.

echo --- Carpeta de League Broadcast --------------------------------
echo    %LBDIR%
if not exist "%LBDIR%" goto SINLB

rem Listado completo, para poder mandarlo si algo no cuadra.
dir "%LBDIR%" > "%LISTADO%" 2>&1
echo    Listado guardado en: %LISTADO%

set TOTAL=0
for /f %%C in ('dir /b "%LBDIR%\*.dll" 2^>nul ^| find /c /v ""') do set TOTAL=%%C
echo    DLL en la carpeta: !TOTAL!
echo.
echo    Las que el sensor necesita:
set FALTAN=0
for %%R in (Farsight.dll BlueBottleClient.Common.dll BlueBottleClient.GameLib.dll AWSSDK.Core.dll AWSSDK.CognitoIdentity.dll AWSSDK.S3.dll FlatSharp.Runtime.dll Microsoft.Extensions.Logging.Abstractions.dll) do (
  if exist "%LBDIR%\%%R" (
    echo      OK     %%R
  ) else (
    echo      FALTA  %%R
    set FALTAN=1
  )
)
echo.
echo    lblib:
if exist "%LBDIR%\lblib*.dll" (
  dir /b "%LBDIR%\lblib*.dll"
) else (
  echo      ninguna lblib*.dll suelta ^(normal: la nueva la baja por parche^)
)
echo ---------------------------------------------------------------
echo.

if "!FALTAN!"=="1" goto FALTANLIB

goto SEGUIR

:SINLB
echo    NO existe esa carpeta: League Broadcast no esta instalado ahi.
goto SEGUIR

:FALTANLIB
echo  ==============================================================
echo   FALTA League Broadcast
echo  ==============================================================
echo   La carpeta de League Broadcast no tiene las librerias que el
echo   sensor necesita (las de arriba, marcadas FALTA).
echo.
echo   Eso no se arregla desde el sensor: hay que arreglar League
echo   Broadcast. Normalmente pasa cuando su actualizacion se queda a
echo   medias ^(te sale lo de "Asset update failed"^).
echo.
echo   1) Abre League Broadcast y deja que termine de actualizarse.
echo      Si se queda igual, cierralo y vuelve a abrirlo.
echo   2) Si sigue, reinstala League Broadcast encima.
echo   3) Despues vuelve a ejecutar este .bat.
echo.
echo   Mandame tambien el archivo:
echo      %LISTADO%
echo.
pause
exit /b 1

:SEGUIR
set HAY11=0
for /f "delims=" %%L in ('dotnet --list-sdks 2^>nul') do (
  echo %%L | findstr /b /c:"11." >nul && set HAY11=1
)
if "!HAY11!"=="0" goto SINONCE
goto BUSCAR

:SINONCE
echo  No tienes ningun SDK 11 instalado.
echo  Se instala ahora con winget; acepta lo que pida.
echo.
winget install --id Microsoft.DotNet.SDK.11 --exact --accept-package-agreements --accept-source-agreements
echo.
echo  CIERRA esta ventana y vuelve a ejecutar el .bat.
echo  Si winget no lo encuentra: https://dotnet.microsoft.com/download/dotnet/11.0
echo.
pause
exit /b 1

:BUSCAR
echo  SDK 11 encontrado. Buscando el proyecto del sensor...
echo.
rem 1) al lado del .bat   2) en la subcarpeta del sensor   3) busqueda general
set "PROYECTO="
if exist "%~dp0SyBSensor.csproj" set "PROYECTO=%~dp0SyBSensor.csproj"
if not defined PROYECTO if exist "%~dp0SyBSensor\SyBSensor.csproj" set "PROYECTO=%~dp0SyBSensor\SyBSensor.csproj"
if not defined PROYECTO for /r "%~dp0" %%F in (*.csproj) do if not defined PROYECTO set "PROYECTO=%%F"
if not defined PROYECTO goto SINPROYECTO
if not exist "!PROYECTO!" goto SINPROYECTO

echo  Proyecto: !PROYECTO!
for %%D in ("!PROYECTO!") do set CARPETA=%%~dpD

set GLOBAL=
if exist "!CARPETA!global.json" set GLOBAL=!CARPETA!global.json
if not defined GLOBAL goto COMPILAR
echo.
echo  OJO: hay un global.json que puede fijar el SDK:
echo        !GLOBAL!
findstr /i "version" "!GLOBAL!"
echo  Si ahi pone 10.x, renombralo a global.json.viejo y vuelve a probar.
echo.

:COMPILAR
echo  Compilando...
echo.
dotnet build "!PROYECTO!" -c Release
if errorlevel 1 goto FALLO

echo.
echo  ==============================================================
echo   COMPILADO SIN ERRORES
echo  ==============================================================
echo   Ya puedes arrancar el programa como siempre.
echo.
echo   Los avisos MSB3277 ^(WindowsBase, System.Reactive...^) son
echo   inofensivos: los provoca la propia libreria de League Broadcast.
echo.
pause
exit /b 0

:FALLO
echo.
echo  ==============================================================
echo   LA COMPILACION HA FALLADO
echo  ==============================================================
echo   Busca la primera linea que empiece por "error". Lo mas normal:
echo.
echo    MSB3030   -> una DLL que el .csproj queria copiar no existe.
echo    MSB3245   -> una referencia no se encuentra: falta una DLL en
echo                 la carpeta de League Broadcast.
echo    CS1705    -> sigue sin usarse el SDK 11 (mira global.json).
echo    NETSDK1045-> falta el SDK 11 de verdad.
echo.
echo   Mandame esta ventana entera y el listado:
echo      %LISTADO%
echo.
pause
exit /b 1

:SINPROYECTO
echo  No encuentro SyBSensor.csproj.
echo.
echo  Copia este .bat en la carpeta del proyecto ^(la que tiene dentro
echo  la carpeta SyBSensor^) y vuelve a hacer doble clic.
echo.
pause
exit /b 1
