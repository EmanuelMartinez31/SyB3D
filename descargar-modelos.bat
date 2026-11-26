@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Descargar los modelos 3D

rem ===========================================================================
rem  PEGA AQUI EL ENLACE DEL .ZIP DEL RELEASE
rem
rem  Se saca asi: GitHub -> tu repo -> Releases -> el release "Modelos 3D"
rem  -> clic derecho en modelos-syb3d.zip -> "Copiar direccion del enlace".
rem  Queda una cosa tipo:
rem  https://github.com/EmanuelMartinez31/SyB3D/releases/download/modelos-v1/modelos-syb3d.zip
rem ===========================================================================
set "URL="

echo ===========================================================
echo   DESCARGAR LOS MODELOS 3D
echo ===========================================================
echo.

if "%URL%"=="" (
  echo  Falta el enlace.
  echo.
  echo  Abre descargar-modelos.bat con el Bloc de notas y pega la
  echo  direccion del .zip del release en la linea que dice  set "URL="
  echo.
  echo  Te abro la pagina de releases por si no la encuentras.
  echo.
  start "" "https://github.com/EmanuelMartinez31/SyB3D/releases"
  pause
  exit /b 1
)

if not exist "%~dp0draft" (
  echo [ERROR] No encuentro la carpeta draft.
  echo         Ejecuta esto en la raiz del proyecto.
  echo.
  pause
  exit /b 1
)

echo  Descargando...
echo  %URL%
echo.
curl -L --fail --progress-bar "%URL%" -o "%~dp0modelos-syb3d.zip"
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo descargar. Comprueba el enlace y la conexion.
  echo.
  pause
  exit /b 1
)

echo.
echo  Descomprimiendo en draft\models ...
if not exist "%~dp0draft\models" mkdir "%~dp0draft\models"
tar -xf "%~dp0modelos-syb3d.zip" -C "%~dp0draft\models"
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo descomprimir.
  echo         El .zip esta en la raiz; descomprimelo a mano dentro de
  echo         draft\models
  echo.
  pause
  exit /b 1
)

echo.
echo  Comprobando...
for /f %%C in ('dir /b "%~dp0draft\models\*.glb" 2^>nul ^| find /c /v ""') do set "CUANTOS=%%C"
echo  Modelos encontrados: %CUANTOS% .glb
echo.

if "%CUANTOS%"=="0" (
  echo [AVISO] No hay ningun .glb. Puede que el .zip llevara la carpeta
  echo         modelos dentro. Mira en draft\models y saca los archivos
  echo         un nivel arriba si hace falta.
  echo.
) else (
  echo  Los modelos estan en su sitio.
  echo.
)

del "%~dp0modelos-syb3d.zip" 2>nul
echo  Ya se puede borrar nada mas. Arranca con iniciar.bat.
echo.
pause
