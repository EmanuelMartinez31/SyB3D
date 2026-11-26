@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"
title Empaquetar todos los modelos

echo ===========================================================
echo   EMPAQUETAR TODOS LOS MODELOS EN UN SOLO ARCHIVO
echo ===========================================================
echo.
echo  Junta en un solo .zip:
echo     campeones\   (los de draft\models)
echo     monstruos\   (los de ingame\overlay\assets\models)
echo.
echo  Ese .zip es lo unico que hay que subir y descargar.
echo  Los archivos NO se mueven de su sitio: solo se copian.
echo.

if not exist "draft\models" (
  echo [ERROR] No encuentro draft\models
  echo         Ejecuta esto en la raiz del proyecto.
  echo.
  pause
  exit /b 1
)
if not exist "ingame\overlay\assets\models" (
  echo [ERROR] No encuentro ingame\overlay\assets\models
  echo         Ejecuta esto en la raiz del proyecto.
  echo.
  pause
  exit /b 1
)

set "PACK=%~dp0_pack-modelos"
set "SALIDA=%~dp0modelos-syb3d.zip"

if exist "%PACK%" rmdir /s /q "%PACK%"
mkdir "%PACK%\campeones" 2>nul
mkdir "%PACK%\monstruos" 2>nul

echo Copiando campeones...
xcopy "draft\models\*.glb" "%PACK%\campeones\" /Y /Q >nul

echo Copiando monstruos...
xcopy "ingame\overlay\assets\models\*.glb" "%PACK%\monstruos\" /Y /Q >nul

set CAMP=0
set MONS=0
for /f %%A in ('dir /b "%PACK%\campeones\*.glb" 2^>nul ^| find /c /v ""') do set CAMP=%%A
for /f %%A in ('dir /b "%PACK%\monstruos\*.glb" 2^>nul ^| find /c /v ""') do set MONS=%%A

echo.
echo   Campeones copiados: !CAMP!
echo   Monstruos copiados: !MONS!
echo.

if "!CAMP!"=="0" (
  echo [AVISO] No se copio ningun campeon. Revisa draft\models
  echo.
)
if "!MONS!"=="0" (
  echo [AVISO] No se copio ningun monstruo. Revisa ingame\overlay\assets\models
  echo.
)

if exist "%SALIDA%" del "%SALIDA%"

echo Comprimiendo... esto tarda un rato con 1 GB.
echo.
tar -a -c -f "%SALIDA%" -C "%PACK%" campeones monstruos
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo comprimir.
  echo.
  pause
  exit /b 1
)

for %%F in ("%SALIDA%") do set TAM=%%~zF
set /a TAMMB=!TAM!/1048576

echo.
echo ===========================================================
echo   LISTO
echo ===========================================================
echo.
echo   Archivo: %SALIDA%
echo   Peso:    !TAMMB! MB
echo.
echo   Lo que queda por hacer:
echo.
echo     1. Ve a github.com/EmanuelMartinez31/SyB3D/releases
echo     2. Draft a new release
echo     3. Etiqueta: modelos-v1   Titulo: Modelos 3D
echo     4. Arrastra modelos-syb3d.zip a "Attach binaries"
echo     5. Publish release
echo     6. Copia el enlace del .zip y pegalo dentro de
echo        descargar-modelos.bat, en la linea  set "URL="
echo.
echo   El .zip se puede borrar despues; los modelos siguen en su sitio.
echo.
start "" explorer "%~dp0"
pause
