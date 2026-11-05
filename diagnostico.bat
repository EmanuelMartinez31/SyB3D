@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Diagnostico SyB3D

echo ============================================================
echo   DIAGNOSTICO DE SyB3D
echo.
echo   IMPORTANTE: copia este .bat y el .ps1 que viene con el
echo   DENTRO de la carpeta del proyecto (donde esta server.js),
echo   y ejecuta este .bat desde ahi.
echo.
echo   Cierra antes las ventanas de SyBSensor y del servidor.
echo ============================================================
echo.

if not exist "server.js" (
  echo [ERROR] No encuentro server.js en esta carpeta.
  echo         Mueve diagnostico.bat a la carpeta del proyecto.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnostico.ps1"

echo.
pause
