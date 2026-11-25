@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Limpieza: backups viejos y mapas que no se usan

echo ===============================================================
echo   LIMPIEZA 2 · BACKUPS VIEJOS Y MAPAS QUE NO SE USAN
echo ===============================================================
echo.
echo   Son 10 archivos, unos 1,1 MB. Ninguno lo usa el programa.
echo.
echo     5 copias .bak que dejaban los instaladores de los parches
echo     5 mapas viejos (solo se usan grieta-3d.webp y r124)
echo.
pause

for /f %%i in ('git rev-parse --short HEAD') do set ANTES=%%i
git tag -f antes-de-la-basura >nul 2>&1
echo.
echo   Punto de vuelta atras: etiqueta "antes-de-la-basura" (%ANTES%).
echo.

git rm -f --quiet --ignore-unmatch ingame/server.js.bak
git rm -f --quiet --ignore-unmatch ingame/server.js.antes-cenital
git rm -f --quiet --ignore-unmatch ingame/server.js.antes-cinematica
git rm -f --quiet --ignore-unmatch ingame/cinematica.js.r89.bak
git rm -f --quiet --ignore-unmatch ingame/cine/calle-central.js.r89.bak
git rm -f --quiet --ignore-unmatch ingame/overlay/assets/map/grieta-3d-r117.webp
git rm -f --quiet --ignore-unmatch ingame/overlay/assets/map/grieta-3d-r119.webp
git rm -f --quiet --ignore-unmatch ingame/overlay/assets/map/grieta-3d-r120.webp
git rm -f --quiet --ignore-unmatch ingame/overlay/assets/map/grieta-3d-r121.webp
git rm -f --quiet --ignore-unmatch ingame/overlay/assets/map/grieta-3d-r123.webp

git add -A
git commit -m "Limpieza: fuera copias .bak y mapas viejos sin usar" >nul
echo.
echo   Hecho.
echo.
git log --oneline -1
echo.
echo   Para subirlo:   git push
echo   Para deshacer:  git reset --hard antes-de-la-basura
echo.
pause
