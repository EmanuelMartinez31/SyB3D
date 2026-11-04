@echo off
setlocal
cd /d "%~dp0"
title SyB3D+HUD

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js. Instala Node.js y vuelve a abrir este archivo.
  pause
  exit /b 1
)

if not exist "node_modules\express\package.json" goto instalar
if not exist "node_modules\ws\package.json" goto instalar
goto iniciar

:instalar
echo Instalando dependencias la primera vez...
call npm install
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudieron instalar las dependencias.
  pause
  exit /b 1
)

:iniciar
set "SENSOR_DIR="
if exist "%~dp0..\SyBSensor\SyBSensor.csproj" set "SENSOR_DIR=%~dp0..\SyBSensor"
if exist "%~dp0..\SyBSensor\SyBSensor\SyBSensor.csproj" set "SENSOR_DIR=%~dp0..\SyBSensor\SyBSensor"
if not defined SENSOR_DIR goto sensor_listo
where dotnet >nul 2>&1
if errorlevel 1 (
  echo [AVISO] No se encontro dotnet; SyBSensor no se inicio automaticamente.
  goto sensor_listo
)
echo Iniciando SyBSensor en su propia ventana...
start "SyBSensor" /D "%SENSOR_DIR%" cmd /k "timeout /t 2 /nobreak >nul && dotnet run"
:sensor_listo

if exist "draft\models" goto modelos_listos
if not exist "..\SyB3D\models" goto modelos_listos
echo Copiando tus modelos 3D desde el SyB3D original...
xcopy "..\SyB3D\models" "draft\models\" /E /I /Q /Y >nul
if errorlevel 1 echo [AVISO] No se copiaron los modelos; se intentara usar la carpeta original.
:modelos_listos
echo.
echo Iniciando Draft, Ingame y Postpartida juntos en el puerto 3000...
echo No abras los servidores antiguos de SyB3D o SyBIngame al mismo tiempo.
echo.
node server.js

echo.
echo El servidor se detuvo. Revisa el mensaje anterior si hubo un error.
pause
