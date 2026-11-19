@echo off
setlocal
cd /d "%~dp0"

set DEST=%~dp0
if exist "%~dp0ingame\cinematica.js" goto listo
set DEST=%~dp0..\
if exist "%~dp0..\ingame\cinematica.js" goto listo
echo.
echo No encuentro la carpeta ingame. Descomprime este zip sobre la raiz del
echo proyecto (donde esta iniciar.bat) o dentro de ingame.
echo.
pause
exit /b 1

:listo
if not exist "%DEST%ingame\cine" mkdir "%DEST%ingame\cine"
echo Copia de seguridad de lo anterior...
copy /y "%DEST%ingame\cinematica.js" "%DEST%ingame\cinematica.js.r89.bak" >nul
if exist "%DEST%ingame\cine\calle-central.js" copy /y "%DEST%ingame\cine\calle-central.js" "%DEST%ingame\cine\calle-central.js.r89.bak" >nul
echo Instalando...
copy /y "%~dp0nuevo\ingame\cinematica.js" "%DEST%ingame\cinematica.js" >nul
copy /y "%~dp0nuevo\ingame\cine\calle-central.js" "%DEST%ingame\cine\calle-central.js" >nul
echo.
echo Hecho. Copias de antes: cinematica.js.r89.bak y calle-central.js.r89.bak
echo Reinicia el servidor del ingame para que lo coja.
echo.
pause
