@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"
title Guardar los cambios en GitHub

echo ===========================================================
echo   GUARDAR LOS CAMBIOS EN GITHUB
echo ===========================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No encuentro git. Instalalo desde https://git-scm.com
  echo.
  pause
  exit /b 1
)

echo Esto es lo que ha cambiado:
echo.
git status --short
echo.

set HAY=0
for /f "delims=" %%A in ('git status --porcelain') do set HAY=1

if "!HAY!"=="0" (
  echo No hay nada que guardar. Todo esta ya en GitHub.
  echo.
  pause
  exit /b 0
)

echo.
set "MENSAJE="
set /p MENSAJE="Describe el cambio y pulsa Enter: "
if "!MENSAJE!"=="" set "MENSAJE=actualizacion"

echo.
echo Anadiendo archivos...
git add .
if errorlevel 1 (
  echo.
  echo [ERROR] Fallo al anadir. Mira el mensaje de arriba.
  echo.
  pause
  exit /b 1
)

echo Guardando...
git commit -m "!MENSAJE!"
if errorlevel 1 (
  echo.
  echo [ERROR] Fallo al guardar. Mira el mensaje de arriba.
  echo.
  pause
  exit /b 1
)

echo Subiendo a GitHub...
git push
if errorlevel 1 (
  echo.
  echo [ERROR] Fallo al subir. Mira el mensaje de arriba.
  echo  Si dice algo de "too large" o "exceeds 100 MB", hay un archivo
  echo  grande colandose: revisa el .gitignore.
  echo.
  pause
  exit /b 1
)

echo.
echo ===========================================================
echo   LISTO
echo ===========================================================
echo.
echo   Tus cambios ya estan en GitHub.
echo.
echo   Eso es el respaldo del CODIGO. No hace falta tocar el
echo   release completo-v1: ese solo sirve para instalar en otro PC.
echo.
echo   Solo si has cambiado MODELOS hay que ir al release:
echo       empaquetar-modelos.bat  y luego  subir-modelos.bat
echo.
pause
