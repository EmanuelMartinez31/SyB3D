@echo off
title Leer lo que dice el juego
cd /d "%~dp0"
echo.
echo  Esto NO cambia nada: solo pregunta al juego como tiene la camara.
echo  Copia TODO lo que salga y mandamelo.
echo.
curl -s http://127.0.0.1:3000/camara/leer
echo.
echo.
pause
