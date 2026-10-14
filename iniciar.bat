@echo off
title HUD Draft 3D - Servidor
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo  [ERROR] Node.js no encontrado.
  echo  Instalalo desde https://nodejs.org y reinicia la PC.
  echo.
  pause
  exit /b
)
echo  ============================================
echo   HUD DRAFT 3D - Servidor iniciando...
echo   Panel:    http://localhost:3000
echo   Overlay:  http://localhost:3000/overlay.html
echo  ============================================
echo.
node server.js
pause