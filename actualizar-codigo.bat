@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Actualizar el codigo de SyB3D

echo ===========================================================
echo   ACTUALIZAR EL CODIGO
echo ===========================================================
echo.
echo  Baja la ultima version del repositorio (unos 21 MB, no 973)
echo  y la copia encima del proyecto.
echo.
echo  NO toca:
echo     draft\models                     los 173 campeones
echo     ingame\overlay\assets\models     los 10 monstruos
echo     draft\data y draft\uploads       presets y logos
echo     node_modules                     las dependencias
echo     SyB3D.exe                        el lanzador
echo.
echo  Antes de copiar deja una copia de seguridad del codigo en
echo  _backup-actualizacion, por si algo sale mal.
echo.

set "URL=https://github.com/EmanuelMartinez31/SyB3D/archive/refs/heads/main.zip"
set "ZIP=%TEMP%\SyB3D-main.zip"
set "TMP=%TEMP%\SyB3D-actualizacion"
set "BACKUP=%~dp0_backup-actualizacion"

echo [1/4] Descargando...
if exist "%ZIP%" del "%ZIP%"
curl -L --fail --progress-bar "%URL%" -o "%ZIP%"
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo descargar. Comprueba la conexion.
  echo.
  pause
  exit /b 1
)

echo.
echo [2/4] Descomprimiendo...
if exist "%TMP%" rmdir /s /q "%TMP%"
mkdir "%TMP%" 2>nul
tar -xf "%ZIP%" -C "%TMP%"
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo descomprimir.
  echo.
  pause
  exit /b 1
)

set "NUEVO=%TMP%\SyB3D-main"
if not exist "%NUEVO%\server.js" (
  echo.
  echo [ERROR] Lo descargado no parece el proyecto: falta server.js
  echo.
  pause
  exit /b 1
)

echo.
echo [3/4] Copia de seguridad del codigo actual...
if exist "%BACKUP%" rmdir /s /q "%BACKUP%"
robocopy "%~dp0." "%BACKUP%" /E /NFL /NDL /NJH /NJS /NC /NS ^
  /XD "%~dp0draft\models" "%~dp0ingame\overlay\assets\models" "%~dp0node_modules" "%~dp0.git" "%~dp0_paquete" "%~dp0_pack-modelos" "%~dp0_backup-actualizacion" "%~dp0Lanzador\bin" "%~dp0Lanzador\obj" ^
  /XF "*.zip" "*.bak" >nul
echo       hecha.

echo [4/4] Copiando el codigo nuevo...
robocopy "%NUEVO%" "%~dp0." /E /NFL /NDL /NJH /NJS /NC /NS >nul
if errorlevel 8 (
  echo.
  echo [ERROR] Fallo al copiar. Restaura desde _backup-actualizacion
  echo.
  pause
  exit /b 1
)

if exist "%ZIP%" del "%ZIP%" 2>nul
if exist "%TMP%" rmdir /s /q "%TMP%" 2>nul

echo.
echo ===========================================================
echo   LISTO
echo ===========================================================
echo.
echo   El codigo esta al dia. Los modelos no se han tocado.
echo.
echo   AHORA:
echo.
echo   - Reinicia el servidor: cierra la ventana y abre SyB3D.exe
echo     o iniciar.bat.
echo.
echo   - Si en la actualizacion cambio la carpeta Lanzador, hay que
echo     recompilar el .exe:
echo         Lanzador\compilar-lanzador.bat
echo.
echo   - Si la actualizacion trae modelos nuevos, eso NO va aqui:
echo     se suben al release y se bajan con descargar-modelos.bat
echo.
echo   Copia de seguridad del codigo anterior:
echo     %BACKUP%
echo   Se puede borrar cuando compruebes que todo va bien.
echo.
pause
