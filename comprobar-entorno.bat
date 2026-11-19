@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Comprobacion del entorno del sensor
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem  Comprueba, y arregla solo, lo que suele romperse cuando League Broadcast
rem  se actualiza:
rem    1. que el SDK de .NET que piden sus librerias este (si falta, lo
rem       intenta instalar con winget)
rem    2. que esten las librerias de League Broadcast
rem    3. que el proyecto apunte al .NET que esas librerias piden
rem       (si no coincide, lo cambia solo y vuelve a compilar)
rem    4. compilar
rem
rem  Uso:  doble clic                       -> comprueba, arregla y compila
rem        comprobar-entorno.bat /revisar   -> solo mira, no cambia nada
rem        comprobar-entorno.bat /auto      -> sin pausa (desde iniciar.bat)
rem        comprobar-entorno.bat /auto "ruta\SyBSensor.csproj"
rem ---------------------------------------------------------------------------

set "MODO=arreglar"
if /i "%~1"=="/revisar" set "MODO=revisar"
set "SINESPERA=0"
if /i "%~1"=="/auto" set "SINESPERA=1"
set "CSFORZADO=%~2"

echo.
echo  ==============================================================
echo   COMPROBACION DEL ENTORNO DEL SENSOR
echo  ==============================================================
echo   Modo: !MODO!
echo.

where dotnet >nul 2>&1 || goto SINDOTNET

rem ---------------------------------------------------------------- 1 - proyecto
set "CS="
if defined CSFORZADO if exist "!CSFORZADO!" set "CS=!CSFORZADO!"
if not defined CS if exist "%~dp0SyBSensor.csproj" set "CS=%~dp0SyBSensor.csproj"
if not defined CS if exist "%~dp0SyBSensor\SyBSensor.csproj" set "CS=%~dp0SyBSensor\SyBSensor.csproj"
if not defined CS for /r "%~dp0" %%F in (*.csproj) do if not defined CS set "CS=%%F"
if not defined CS goto SINPROYECTO
echo  Proyecto: !CS!

rem --------------------------------------- 2 - librerias de League Broadcast
set "LBDIR="
for /f "usebackq tokens=3 delims=<>" %%A in (`findstr /c:"<LbDir>" "!CS!"`) do if not defined LBDIR set "LBDIR=%%A"
if not defined LBDIR set "LBDIR=%LocalAppData%\LeagueBroadcast\current"
echo  League Broadcast: !LBDIR!
if not exist "!LBDIR!" goto SINLBDIR

set "FALTAN="
for %%R in (Farsight.dll BlueBottleClient.Common.dll BlueBottleClient.GameLib.dll AWSSDK.Core.dll AWSSDK.CognitoIdentity.dll AWSSDK.S3.dll FlatSharp.Runtime.dll Microsoft.Extensions.Logging.Abstractions.dll) do (
  if not exist "!LBDIR!\%%R" set "FALTAN=!FALTAN! %%R"
)
if defined FALTAN goto FALTANLIB
echo  Las ocho librerias de League Broadcast estan.
echo.

rem ------------------------------------------------------------- 3 - TFM actual
set "TFMACTUAL="
for /f "usebackq tokens=3 delims=<>" %%A in (`findstr /c:"<TargetFramework>" "!CS!"`) do if not defined TFMACTUAL set "TFMACTUAL=%%A"
if not defined TFMACTUAL goto SINTFM
echo  El proyecto apunta a: !TFMACTUAL!
echo.

rem ------------------------------------------------------------------ 4 - compilar
set "LOG=%~dp0compilar-salida.txt"
call :COMPILAR
if "!ERRORLEVEL!"=="0" goto FINOK

rem ------------------------------- 5 - si es CS1705, subir el .NET y reintentar
findstr /c:"CS1705" "%LOG%" >nul || goto FALLOOTRO
findstr /c:"System.Runtime, Version=" "%LOG%" >nul || goto FALLOOTRO

set "PEDIDA="
for /f "usebackq tokens=2 delims=," %%A in (`findstr /c:"System.Runtime, Version=" "%LOG%"`) do if not defined PEDIDA set "PEDIDA=%%A"
set "PEDIDA=!PEDIDA: =!"
set "PEDIDA=!PEDIDA:Version==!"
set "MAJOR="
for /f "tokens=1 delims=." %%B in ("!PEDIDA!") do set "MAJOR=%%B"
if not defined MAJOR goto FALLOOTRO

echo.
echo  Las librerias de League Broadcast piden .NET !MAJOR! y el proyecto
echo  esta en !TFMACTUAL!.

set "HAYSDK=0"
for /f "usebackq delims=" %%L in (`dotnet --list-sdks`) do (
  echo %%L | findstr /b /c:"!MAJOR!." >nul && set "HAYSDK=1"
)
if "!HAYSDK!"=="1" goto TFM
if /i "!MODO!"=="revisar" goto SINSDK
call :INSTALAR_SDK
if errorlevel 1 goto SINSDK

:TFM
set "TFMNUEVO=net!MAJOR!.0-windows"
if /i "!TFMNUEVO!"=="!TFMACTUAL!" goto FALLOOTRO

if /i "!MODO!"=="revisar" (
  echo  Habria que ponerlo en !TFMNUEVO!. No lo toco en modo revisar.
  goto FALLOOTRO
)

echo  Lo subo a !TFMNUEVO! y vuelvo a compilar.
if not exist "!CS!.bak" copy /y "!CS!" "!CS!.bak" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='!CS!'; $t=Get-Content -Raw -LiteralPath $p; $t=$t -replace '<TargetFramework>[^<]*</TargetFramework>','<TargetFramework>!TFMNUEVO!</TargetFramework>'; Set-Content -LiteralPath $p -Value $t -NoNewline -Encoding UTF8"
if errorlevel 1 goto FALLOTFM
echo  Cambiado. El anterior queda como SyBSensor.csproj.bak
echo.
call :COMPILAR
if "!ERRORLEVEL!"=="0" goto FINAJUSTE
goto FALLOOTRO

rem --------------------------------------------------------------------- rutinas
:COMPILAR
echo  Compilando...
dotnet build "!CS!" -c Release > "%LOG%" 2>&1
set "RES=!ERRORLEVEL!"
if not "!RES!"=="0" (
  echo  Ha fallado. Errores:
  echo.
  findstr /c:"error" "%LOG%"
  echo.
  echo  El detalle completo esta en compilar-salida.txt
)
exit /b !RES!

:INSTALAR_SDK
echo.
echo  No tienes el SDK de .NET !MAJOR!. Lo intento instalar con winget.
echo  Puede salir el cartel de permisos de Windows: aceptalo.
where winget >nul 2>&1 || exit /b 1
winget install --id Microsoft.DotNet.SDK.!MAJOR! --exact --silent --accept-package-agreements --accept-source-agreements
set "OK=0"
for /f "usebackq delims=" %%L in (`dotnet --list-sdks`) do (
  echo %%L | findstr /b /c:"!MAJOR!." >nul && set "OK=1"
)
if "!OK!"=="1" exit /b 0
exit /b 1

rem --------------------------------------------------------------------- salidas
:FINOK
echo.
echo  ==============================================================
echo   TODO EN ORDEN
echo  ==============================================================
echo   Compilado sin errores, sin tocar nada.
echo.
goto SALIR

:FINAJUSTE
echo.
echo  ==============================================================
echo   ARREGLADO Y COMPILADO
echo  ==============================================================
echo   He subido el proyecto de !TFMACTUAL! a !TFMNUEVO! porque las
echo   librerias nuevas de League Broadcast lo pedian.
echo   Compilado sin errores.
echo.
goto SALIR

:SINSDK
echo.
echo  ==============================================================
echo   FALTA EL SDK DE .NET !MAJOR!
echo  ==============================================================
echo   Las librerias de League Broadcast piden .NET !MAJOR! y no
echo   esta instalado. Tienes estos:
echo.
dotnet --list-sdks
echo.
echo   Instalalo a mano desde
echo     https://dotnet.microsoft.com/download/dotnet/!MAJOR!.0
echo   y vuelve a ejecutar esto.
echo.
goto SALIR1

:FALTANLIB
echo.
echo  ==============================================================
echo   FALTA LEAGUE BROADCAST
echo  ==============================================================
echo   En su carpeta no estan:!FALTAN!
echo.
echo   Eso no se arregla desde el sensor: League Broadcast esta a
echo   medias. Abrelo y deja que termine de actualizarse; si sigue
echo   igual, reinstalalo encima y vuelve a probar.
echo.
goto SALIR1

:SINLBDIR
echo  NO existe esa carpeta: League Broadcast no esta instalado ahi.
echo.
goto SALIR1

:SINTFM
echo  No encuentro la etiqueta TargetFramework en el proyecto.
echo.
goto SALIR1

:FALLOTFM
echo  No pude cambiar el archivo del proyecto. Mandame esta ventana.
echo.
goto SALIR1

:FALLOOTRO
echo.
echo  ==============================================================
echo   NO SE PUDO COMPILAR
echo  ==============================================================
echo   Lo que ha dicho el compilador esta arriba. Mandame esta
echo   ventana entera y el archivo compilar-salida.txt.
echo.
goto SALIR1

:SINDOTNET
echo  No encuentro el comando "dotnet".
echo  Instala el SDK de .NET: https://dotnet.microsoft.com/download
echo.
goto SALIR1

:SINPROYECTO
echo  No encuentro SyBSensor.csproj en esta carpeta ni dentro.
echo  Copia este .bat en la carpeta del proyecto y vuelve a probar.
echo.
goto SALIR1

:SALIR
if "!SINESPERA!"=="0" pause
exit /b 0

:SALIR1
if "!SINESPERA!"=="0" pause
exit /b 1
