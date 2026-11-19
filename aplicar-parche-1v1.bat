@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Falta Node.js en este equipo.
  echo.
  pause
  exit /b 1
)
node "%~dp0ingame\aplicar-parche.js"
echo.
pause
