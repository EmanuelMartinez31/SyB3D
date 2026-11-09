@echo off
title Instalar la cinematica en el Ingame (una sola vez)
cd /d "%~dp0"
echo.
echo  Esto engancha la cinematica de inicio al servidor del Ingame.
echo  No sustituye ningun archivo: hace copia y anade tres lineas.
echo  Se puede ejecutar varias veces sin problema.
echo.
node "%~dp0ingame\instalar-cinematica.js"
if errorlevel 1 (
  echo.
  echo  [AVISO] Si dice que no encuentra Node, abre el sistema con iniciar.bat una vez.
)
echo.
pause
