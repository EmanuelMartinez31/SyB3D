@echo off
title Volver la camara a su sitio
cd /d "%~dp0"
echo.
echo  Devolviendo la camara...
echo.
curl -s -X POST http://127.0.0.1:3000/camara/bajar
echo.
echo.
pause
