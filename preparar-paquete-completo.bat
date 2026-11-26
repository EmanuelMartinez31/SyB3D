@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"
title Preparar el paquete completo de SyB3D

echo ===========================================================
echo   PREPARAR EL PAQUETE COMPLETO
echo ===========================================================
echo.
echo  Monta una carpeta _paquete\SyB3D con TODO dentro:
echo    - el proyecto entero
echo    - los modelos (campeones y monstruos)
echo    - node_modules, para no tener que instalarlos
echo    - SyB3D.exe ya compilado en la raiz
echo.
echo  Luego lo comprime en  SyB3D-completo.zip
echo  Ese es el unico archivo que hay que subir y descargar.
echo.

if not exist "server.js" (
  echo [ERROR] No encuentro server.js
  echo         Ejecuta esto en la raiz del proyecto.
  echo.
  pause
  exit /b 1
)
if not exist "iniciar.bat" (
  echo [ERROR] No encuentro iniciar.bat
  echo.
  pause
  exit /b 1
)

set "BASE=%~dp0_paquete"
set "SALIDA=%~dp0_paquete\SyB3D"
set "ZIP=%~dp0SyB3D-completo.zip"

if exist "%BASE%" rmdir /s /q "%BASE%"
mkdir "%SALIDA%" 2>nul

echo.
echo [1/5] Copiando el proyecto...
robocopy "%~dp0." "%SALIDA%" /E /NFL /NDL /NJH /NJS /NC /NS ^
  /XD "%~dp0.git" "%~dp0_paquete" "%~dp0_pack-modelos" "%~dp0Lanzador\bin" "%~dp0Lanzador\obj" "%~dp0SyBSensor\bin" "%~dp0SyBSensor\obj" ^
  /XF "*.zip" "*.bak" "*.rar" "*.7z" >nul
if errorlevel 8 (
  echo [ERROR] Fallo al copiar el proyecto.
  pause
  exit /b 1
)
echo       hecho.

echo [2/5] Copiando node_modules...
if exist "%~dp0node_modules\express\package.json" (
  robocopy "%~dp0node_modules" "%SALIDA%\node_modules" /E /NFL /NDL /NJH /NJS /NC /NS >nul
  if errorlevel 8 (
    echo       [AVISO] No se copio entero. En el otro PC iniciar.bat lo instala solo.
  ) else (
    echo       hecho.
  )
) else (
  echo       [AVISO] No hay node_modules aqui.
  echo               En el otro PC, iniciar.bat los instala la primera vez.
)

echo [3/5] Poniendo SyB3D.exe en la raiz...
if exist "%~dp0Lanzador\dist\SyB3D.exe" (
  copy /y "%~dp0Lanzador\dist\SyB3D.exe" "%SALIDA%\SyB3D.exe" >nul
  echo       hecho.
) else (
  echo       [AVISO] No encuentro Lanzador\dist\SyB3D.exe
  echo               Compilalo antes con  Lanzador\compilar-lanzador.bat
  echo               El resto del paquete funciona igual.
)

echo [4/5] Comprobando los modelos...
set CAMP=0
set MONS=0
for /f %%A in ('dir /b /s /a-d "%SALIDA%\draft\models\*.glb" 2^>nul ^| find /c /v ""') do set CAMP=%%A
for /f %%A in ('dir /b /s /a-d "%SALIDA%\ingame\overlay\assets\models\*.glb" 2^>nul ^| find /c /v ""') do set MONS=%%A
echo       campeones: !CAMP!
echo       monstruos: !MONS!

if "!CAMP!"=="0" (
  echo.
  echo       [AVISO] No hay campeones. El draft y el postpartida saldrian
  echo               sin modelos 3D.
)
if "!MONS!"=="0" (
  echo.
  echo       [AVISO] No hay monstruos. Los avisos del ingame saldrian vacios.
)

rem --- el README del paquete se escribe aqui mismo: asi no puede faltar ---
set "LEEME=%SALIDA%\README-PAQUETE.txt"
(
  echo SyB3D - PANEL DE CONTROL DE TRANSMISION
  echo =======================================
  echo.
  echo QUE ES ESTO
  echo   El sistema completo: draft, HUD de partida y postpartida, con su
  echo   lanzador. Ya trae dentro el codigo, los 173 modelos de campeones,
  echo   los 10 de monstruos y las dependencias de Node.
  echo.
  echo.
  echo LO QUE HAY QUE TENER INSTALADO
  echo ------------------------------
  echo.
  echo   1. NODE.JS - OBLIGATORIO
  echo      https://nodejs.org  -  boton LTS  -  siguiente, siguiente
  echo      Sin esto no arranca nada.
  echo      Comprobar:  node --version
  echo.
  echo   2. .NET 11 SDK - OBLIGATORIO
  echo      https://dotnet.microsoft.com/download
  echo      Hace falta para abrir SyB3D.exe y para compilar el sensor.
  echo      Comprobar:  dotnet --list-sdks
  echo.
  echo   3. LEAGUE BROADCAST - NECESARIO PARA LA PARTIDA
  echo      El sensor lee los datos del juego a traves de sus librerias.
  echo      Sin el, el draft y la postpartida van, pero no hay datos en vivo.
  echo.
  echo   4. WEBVIEW2 RUNTIME - Windows 11 ya lo trae
  echo      Windows 10 puede no tenerlo. Es gratis, de Microsoft.
  echo      Buscar en Google: WebView2 Runtime Evergreen Bootstrapper
  echo.
  echo   5. LEAGUE OF LEGENDS
  echo.
  echo.
  echo COMO ARRANCAR
  echo -------------
  echo   Doble clic en SyB3D.exe
  echo.
  echo   La primera vez tarda: arranca el servidor y espera a que responda.
  echo   Si prefieres ver los mensajes, abre iniciar.bat.
  echo.
  echo   NO muevas SyB3D.exe de su carpeta: necesita encontrar server.js e
  echo   iniciar.bat a su lado.
  echo.
  echo.
  echo LOS .BAT Y CUANDO USARLOS
  echo -------------------------
  echo   iniciar.bat
  echo       Arranque clasico por consola. Es lo que lanza SyB3D.exe por
  echo       dentro. Si algo falla, abre este para leer el error.
  echo.
  echo   abrir-sensor.bat
  echo       Reabre el sensor si se cerro sin querer. Tambien esta el boton
  echo       "Abrir sensor" en el panel, en Estado del sistema.
  echo.
  echo   arreglar-sensor-otro-pc.bat
  echo       PRIMERO QUE NADA en un PC nuevo. SyBSensor.csproj lleva escrita
  echo       a mano la ruta de League Broadcast, con el nombre de usuario
  echo       antiguo. En otro PC esa ruta no existe y el sensor no compila.
  echo       Este .bat la cambia por una que Windows resuelve solo.
  echo.
  echo   comprobar-entorno.bat
  echo       Lo usa iniciar.bat solo. Revisa el .NET y las librerias de
  echo       League Broadcast, y arregla lo que cambie con cada parche.
  echo       No hace falta abrirlo a mano.
  echo.
  echo   descargar-modelos.bat
  echo       Solo si te faltan modelos. En este paquete ya vienen dentro.
  echo       Baja el pack de modelos desde el release de GitHub.
  echo.
  echo   empaquetar-modelos.bat, preparar-paquete-completo.bat, subir-paquete.bat
  echo       Solo para el PC que hace los paquetes. Aqui no los necesitas.
  echo.
  echo.
  echo ERRORES COMUNES Y QUE HACER
  echo ---------------------------
  echo   "No se pudo abrir el panel" y habla de WebView2
  echo       Falta el WebView2 Runtime. Ver el punto 4 arriba.
  echo.
  echo   ERROR El sensor no compila
  echo       Casi siempre es la ruta de League Broadcast.
  echo       Doble clic en arreglar-sensor-otro-pc.bat y vuelve a probar.
  echo       Si sigue, abre compilar-salida.txt: ahi esta el motivo exacto.
  echo.
  echo   AVISO No se encontro dotnet
  echo       Falta el SDK de .NET 11. Ver el punto 2.
  echo.
  echo   El puerto 3000 esta ocupado
  echo       Tienes otro SyB3D abierto. Cierralo.
  echo.
  echo   Los avisos del ingame salen sin monstruo
  echo       Falta la carpeta ingame\overlay\assets\models. Deben ser 10 .glb.
  echo.
  echo   El draft o la postpartida salen sin campeones
  echo       Falta la carpeta draft\models. Deben ser 173 .glb.
  echo.
  echo   ERROR al descomprimir, o rutas demasiado largas
  echo       Descomprime en C:\SyB3D, no en el Escritorio ni en Descargas.
  echo.
  echo.
  echo QUE HAY DENTRO
  echo --------------
  echo   SyB3D.exe             el lanzador
  echo   iniciar.bat           arranque por consola
  echo   server.js             el servidor del puerto 3000
  echo   draft\                draft, overlay y modelos de campeones
  echo   ingame\               HUD de partida y modelos de monstruos
  echo   postgame\             pantalla de postpartida
  echo   SyBSensor\            el sensor .NET
  echo   Lanzador\             codigo del .exe, por si hay que recompilarlo
  echo   node_modules\         dependencias ya instaladas
  echo.
  echo.
  echo COMPROBACION EN 3 MINUTOS
  echo -------------------------
  echo   1. Descomprime en C:\SyB3D
  echo   2. Doble clic en arreglar-sensor-otro-pc.bat
  echo   3. Doble clic en SyB3D.exe
  echo   4. Estado del sistema, Servidor en verde
  echo   5. Postpartida, Abrir demo: si salen los campeones en 3D, todo bien
) > "%LEEME%"

echo README-PAQUETE.txt escrito en el paquete.

echo [5/5] Comprimiendo... paciencia, es 1 GB.
echo.
if exist "%ZIP%" del "%ZIP%"
tar -a -c -f "%ZIP%" -C "%BASE%" SyB3D
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo comprimir.
  echo.
  pause
  exit /b 1
)

for %%F in ("%ZIP%") do set TAM=%%~zF
set /a TAMMB=!TAM!/1048576

echo.
echo ===========================================================
echo   LISTO
echo ===========================================================
echo.
echo   Archivo : %ZIP%
echo   Peso    : !TAMMB! MB
echo.
echo   Contenido: 173 + 10 modelos y el proyecto entero
echo.
echo   Ahora subelo con  subir-paquete.bat
echo.
echo   Cuando termine todo, la carpeta _paquete se puede borrar.
echo.
start "" explorer "%~dp0"
pause
