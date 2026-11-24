@echo off
title Subir la camara (vista cenital)
cd /d "%~dp0"
echo.
echo  Subiendo la camara del juego...
echo.
curl -s -X POST http://127.0.0.1:3000/camara/arriba
echo.
echo.
echo  Si ha salido "ok":true, la camara ya esta arriba.
echo  Para volver: doble clic en volver-cenital.bat
echo.
pause
