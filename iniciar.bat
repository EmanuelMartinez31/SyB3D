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
rem ---------------------------------------------------------------------------
rem SyBSensor se busca primero DENTRO de este proyecto y despues al lado, asi
rem funciona tanto si la carpeta esta en SyB3D+HUD\SyBSensor como si sigue
rem siendo vecina (SyBSensor junto a SyB3D+HUD). Tambien se admite que el
rem proyecto .NET este un nivel mas abajo (SyBSensor\SyBSensor).
rem ---------------------------------------------------------------------------
set "SENSOR_DIR="
set "SENSOR_CS="
set "SENSOR_EXE="
for %%R in (
  "%~dp0SyBSensor"
  "%~dp0SyBSensor\SyBSensor"
  "%~dp0..\SyBSensor"
  "%~dp0..\SyBSensor\SyBSensor"
) do (
  if not defined SENSOR_DIR (
    if exist "%%~R\SyBSensor.csproj" (
      set "SENSOR_DIR=%%~R"
      set "SENSOR_CS=1"
    ) else (
      if exist "%%~R\SyBSensor.exe" (
        set "SENSOR_DIR=%%~R"
        set "SENSOR_EXE=1"
      )
    )
  )
)
if not defined SENSOR_DIR (
  echo [AVISO] No se encontro la carpeta de SyBSensor.
  echo         Se busco en: SyB3D+HUD\SyBSensor y en la carpeta de al lado.
  echo         Arranca el sensor a mano; el overlay lo recibira igual.
  goto sensor_listo
)
echo SyBSensor encontrado en: %SENSOR_DIR%
if defined SENSOR_EXE goto sensor_exe
where dotnet >nul 2>&1
if errorlevel 1 (
  echo [AVISO] No se encontro dotnet; el sensor no se inicio automaticamente.
  goto sensor_listo
)
echo Iniciando SyBSensor en su propia ventana...
start "SyBSensor" /D "%SENSOR_DIR%" cmd /k "timeout /t 2 /nobreak >nul && dotnet run"
goto sensor_listo
:sensor_exe
echo Iniciando SyBSensor en su propia ventana...
start "SyBSensor" /D "%SENSOR_DIR%" cmd /k "SyBSensor.exe"
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
