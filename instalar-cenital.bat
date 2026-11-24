@echo off
title Instalar la vista cenital (una sola vez)
cd /d "%~dp0"
echo.
echo  Esto engancha la vista cenital al servidor del Ingame.
echo  No sustituye ningun archivo: hace copia y anade dos lineas.
echo.
node "%~dp0ingame\instalar-cenital.js"
if errorlevel 1 (
  echo.
  echo  [AVISO] Si dice que no encuentra Node, abre el sistema con iniciar.bat una vez.
)
echo.
pause
