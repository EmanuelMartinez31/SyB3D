@echo off
setlocal
cd /d "%~dp0"
title Libreria del parche - informe y arreglo
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0arreglar-libreria-parche.ps1"
echo.
echo Pulsa una tecla para cerrar.
pause >nul
