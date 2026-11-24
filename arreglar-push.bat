@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Arreglar el push de SyB3D
echo   Carpeta: %CD%
echo ============================================
echo.

echo 1) Comprobando que estamos en el repositorio...
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo    ERROR: esta carpeta no es un repositorio de git.
  echo    Copia este .bat a la carpeta de SyB3D y vuelve a ejecutarlo.
  pause
  exit /b 1
)
echo    OK.
echo.

echo 2) En que commits aparece el archivo pesado:
git log --oneline -- streamdeck/Grieta.glb
echo.

echo 3) Sacandolo del commit (el archivo se queda en tu disco, no se borra)...
git rm --cached --ignore-unmatch streamdeck/Grieta.glb
if errorlevel 1 (
  echo    No estaba en el indice; seguimos.
)
echo.

echo 4) Anotandolo en .gitignore para que no vuelva a colarse...
findstr /C:"Grieta.glb" .gitignore >nul 2>&1
if errorlevel 1 (
  echo.>> .gitignore
  echo # Modelo 3D pesado: se queda fuera del repositorio>> .gitignore
  echo streamdeck/Grieta.glb>> .gitignore
  echo *.glb>> .gitignore
)
git add .gitignore
echo    OK.
echo.

echo 5) Rehaciendo el ultimo commit sin el archivo...
git commit --amend --no-edit
if errorlevel 1 (
  echo    ERROR al rehacer el commit. No se ha subido nada. Revisa el mensaje de arriba.
  pause
  exit /b 1
)
echo.

echo 6) Limpieza de objetos grandes que ya no se usan...
git gc --prune=now --quiet
echo.

echo 7) Subiendo...
git push
if errorlevel 1 (
  echo.
  echo    El push ha fallado otra vez. Copiame lo que salga en pantalla.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Listo. El repositorio ya esta subido.
echo   El archivo Grieta.glb sigue en tu carpeta,
echo   pero fuera de git.
echo ============================================
pause
