@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Subir los modelos a un Release

set "REPO=EmanuelMartinez31/SyB3D"
set "TAG=completo-v1"
set "ARCHIVO=SyB3D-completo.zip"
set "TITULO=SyB3D completo"
set "URL=https://github.com/%REPO%/releases/download/%TAG%/%ARCHIVO%"

echo ===========================================================
echo   SUBIR EL PAQUETE COMPLETO
echo ===========================================================
echo.
echo  El navegador solo deja 25 MB al subir archivos AL REPOSITORIO.
echo  Un Release admite hasta 2 GB por archivo. El tuyo pesa mucho
echo  menos: cabe sin problema.
echo.
echo  Esto lo sube con GitHub CLI, que no tiene ese limite.
echo.

if not exist "%ARCHIVO%" (
  echo [ERROR] No encuentro %ARCHIVO%
  echo         Ejecuta antes preparar-paquete-completo.bat
  echo.
  pause
  exit /b 1
)

echo  Archivo: %ARCHIVO%
for %%F in ("%ARCHIVO%") do echo  Peso:    %%~zF bytes
echo.

rem ---------------------------------------------------------------- gh
where gh >nul 2>&1
if errorlevel 1 (
  echo  No tienes GitHub CLI. Intentando instalarlo con winget...
  echo.
  winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
  echo.
  if exist "%ProgramFiles%\GitHub CLI\gh.exe" (
    set "PATH=%ProgramFiles%\GitHub CLI;%PATH%"
  )
  where gh >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] No se pudo instalar o no se encuentra "gh".
    echo.
    echo  Instalalo a mano desde aqui y vuelve a ejecutar este archivo:
    echo      https://cli.github.com
    echo.
    pause
    exit /b 1
  )
)

rem ------------------------------------------------------------- sesion
gh auth status >nul 2>&1
if errorlevel 1 (
  echo  Hay que entrar en tu cuenta de GitHub.
  echo  Se abre el navegador: elige "Login with a web browser" y sigue
  echo  las instrucciones de la pantalla.
  echo.
  pause
  gh auth login
  if errorlevel 1 (
    echo.
    echo [ERROR] No se pudo iniciar sesion.
    echo.
    pause
    exit /b 1
  )
)

rem ------------------------------------------------------------ release
echo.
echo  Subiendo... esto tarda segun tu conexion. No cierres la ventana.
echo.

gh release view %TAG% --repo %REPO% >nul 2>&1
if errorlevel 1 (
  gh release create %TAG% "%ARCHIVO%" --repo %REPO% --title "%TITULO%" --notes "Modelos 3D de SyB3D: campeones para el draft y el postpartida, y monstruos para el ingame."
) else (
  echo  El release %TAG% ya existe: se anade el archivo.
  gh release upload %TAG% "%ARCHIVO%" --repo %REPO% --clobber
)

if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo subir. Copia el mensaje de arriba.
  echo.
  pause
  exit /b 1
)

echo.
echo ===========================================================
echo   LISTO
echo ===========================================================
echo.
echo   Descarga directa:
echo     %URL%
echo.
echo  Comprobando que responde...
curl -s -o nul -w "   Codigo HTTP: %%{http_code}\n" -L -I "%URL%"
echo.
echo   Si sale 302 o 200, ya funciona. preparar-paquete-completo.bat genera
echo   esa direccion dentro: no hay que pegar nada.
echo.
pause
