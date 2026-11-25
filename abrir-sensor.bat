@echo off
rem ---------------------------------------------------------------------------
rem Vuelve a abrir SyBSensor si se ha cerrado sin querer.
rem Se puede usar a mano (doble clic) o desde el boton "Abrir sensor" del panel.
rem Busca el sensor igual que iniciar.bat: dentro del proyecto y al lado.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
title Abrir SyBSensor

set "SENSOR_DIR="
set "SENSOR_EXE="
for %%R in (
  "%~dp0SyBSensor"
  "%~dp0SyBSensor\SyBSensor"
  "%~dp0..\SyBSensor"
  "%~dp0..\SyBSensor\SyBSensor"
) do (
  if not defined SENSOR_DIR (
    if exist "%%~R\SyBSensor.exe" (
      set "SENSOR_DIR=%%~R"
      set "SENSOR_EXE=1"
    ) else (
      if exist "%%~R\SyBSensor.csproj" (
        set "SENSOR_DIR=%%~R"
      )
    )
  )
)

if not defined SENSOR_DIR (
  echo [AVISO] No se encontro la carpeta de SyBSensor.
  echo         Se busco en SyB3D+HUD\SyBSensor y en la carpeta de al lado.
  echo.
  echo         Si el sensor esta en otro sitio, abrelo a mano: el overlay
  echo         lo recibira igual.
  echo.
  pause
  exit /b 1
)

echo SyBSensor encontrado en: %SENSOR_DIR%

if defined SENSOR_EXE (
  echo Iniciando SyBSensor en su propia ventana...
  start "SyBSensor" /D "%SENSOR_DIR%" cmd /k "SyBSensor.exe"
  exit /b 0
)

where dotnet >nul 2>&1
if errorlevel 1 (
  echo [AVISO] No se encontro dotnet; el sensor no se puede arrancar.
  echo         Instala el SDK de .NET 11.
  echo.
  pause
  exit /b 1
)

rem Igual que iniciar.bat: antes de arrancar se comprueba el entorno y se
rem arregla solo lo que cambia con cada parche del juego.
call "%~dp0comprobar-entorno.bat" /auto "%SENSOR_DIR%\SyBSensor.csproj"
if errorlevel 1 (
  echo.
  echo [ERROR] El sensor no compila. El motivo esta arriba, con el detalle
  echo         en compilar-salida.txt.
  echo.
  pause
  exit /b 1
)

echo Iniciando SyBSensor en su propia ventana...
start "SyBSensor" /D "%SENSOR_DIR%" cmd /k "timeout /t 2 /nobreak >nul && dotnet run -c Release"
exit /b 0
