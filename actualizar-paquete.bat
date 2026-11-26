@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Actualizar el paquete completo

echo ===========================================================
echo   ACTUALIZAR EL PAQUETE COMPLETO
echo ===========================================================
echo.
echo  Hace los dos pasos seguidos:
echo     1. Vuelve a montar el zip, ahora con README-PAQUETE.txt dentro
echo     2. Lo sube al release completo-v1 y sustituye al anterior
echo.
echo  Tarda lo mismo que la primera vez: es un zip de casi 1 GB.
echo  Si solo quieres tocar el README sin volver a subir todo, mira
echo  la nota del final de este mensaje.
echo.
pause

call "%~dp0preparar-paquete-completo.bat"
call "%~dp0subir-paquete.bat"

echo.
echo ===========================================================
echo   FIN
echo ===========================================================
echo.
echo  NOTA: si dentro de un rato solo cambias el texto del README y
echo  no quieres volver a subir 1 GB, puedes subir solo ese archivo:
echo.
echo      gh release upload completo-v1 README-PAQUETE.txt --repo EmanuelMartinez31/SyB3D --clobber
echo.
echo  Pero asi queda como archivo aparte en el release, no dentro del zip.
echo.
pause
