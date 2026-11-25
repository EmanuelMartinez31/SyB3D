@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"
title Limpieza del repositorio SyB3D

echo ===============================================================
echo   LIMPIEZA DEL REPOSITORIO SyB3D
echo ===============================================================
echo.
echo  Que va a hacer:
echo    - Sacar del repo lo que se regenera solo (SIGUE EN TU DISCO).
echo    - Borrar basura: logs, notas sueltas y atajos de Windows.
echo    - (Opcional) Borrar los instaladores de una sola vez ya aplicados.
echo.
echo  ANTES DE SEGUIR, comprueba que no tienes nada sin subir:
echo.
git status --short
echo.
echo  Si aparece algo tuyo sin subir, guardalo: pulsa Ctrl+C y subelo.
echo.
pause

rem --- Una red de seguridad por si hay que volver atras ---------------
for /f %%i in ('git rev-parse --short HEAD') do set ANTES=%%i
git tag -f antes-de-la-limpieza >nul 2>&1
echo.
echo  Punto de vuelta atras guardado (etiqueta "antes-de-la-limpieza", commit %ANTES%).
echo  Para deshacerlo todo:  git reset --hard antes-de-la-limpieza
echo.

rem =====================================================================
rem  1. LO QUE SE REGENERA SOLO
rem     git rm --cached: lo quita del repositorio pero LO DEJA EN TU DISCO
rem =====================================================================
echo ---- 1. Sacando del repositorio lo que se regenera solo ----
git rm -r --cached --quiet --ignore-unmatch node_modules
git rm -r --cached --quiet --ignore-unmatch SyBSensor/bin
git rm -r --cached --quiet --ignore-unmatch SyBSensor/obj
git rm -r --cached --quiet --ignore-unmatch draft/models
echo      node_modules, SyBSensor/bin, SyBSensor/obj, draft/models
echo      (siguen en tu disco, aqui solo dejan de estar en el repositorio)
echo.

rem =====================================================================
rem  2. BASURA: logs, notas y atajos
rem =====================================================================
echo ---- 2. Borrando basura de la raiz ----
git rm -f --quiet --ignore-unmatch compilar-salida.txt srv-stdout.txt srv-stderr.txt
git rm -f --quiet --ignore-unmatch listado-leaguebroadcast.txt informe-leaguebroadcast.txt
git rm -f --quiet --ignore-unmatch falta no sigue
echo      logs y notas de errores sueltas (el acceso directo SE QUEDA)
echo.

rem --- 2b. Elegidos por ti -------------------------------------------
echo ---- 2b. Otros que decidiste quitar ----
git rm -rf --quiet --ignore-unmatch calibrar-mapa-3d.html
git rm -rf --quiet --ignore-unmatch streamdeck
git rm -r --quiet --ignore-unmatch postgame/data/history
git rm -r --quiet --ignore-unmatch ingame/data/gold-series
echo      calibrar-mapa-3d, streamdeck y el historial de partidas
echo      (las carpetas del historial se recrean solas al arrancar)
echo.

rem =====================================================================
rem  3. INSTALADORES DE UNA SOLA VEZ (ya aplicados)
rem =====================================================================
echo ---- 3. Instaladores y parches de una sola vez ----
echo.
echo  Estos ya se aplicaron hace tiempo. Sus funciones viven dentro de
echo  ingame/server.js, no en estos archivos:
echo.
echo    instalar-cenital.bat        + ingame/instalar-cenital.js
echo    instalar-cinematica.bat     + ingame/instalar-cinematica.js
echo    instalar-cinematica-r96.bat
echo    aplicar-parche-1v1.bat      + ingame/aplicar-parche.js
echo    ingame/aplicar-parche-cinematica.js
echo    arreglar-libreria-parche.bat + arreglar-libreria-parche.ps1
echo    arreglar-sensor-net11.bat
echo    arreglar-push.bat
echo.
set /p QUIERE=  Borrarlos? (s/N):
if /i not "%QUIERE%"=="s" (
  echo      Se quedan como estan.
  goto siguiente
)
git rm -f --quiet --ignore-unmatch instalar-cenital.bat ingame/instalar-cenital.js
git rm -f --quiet --ignore-unmatch instalar-cinematica.bat instalar-cinematica-r96.bat ingame/instalar-cinematica.js
git rm -f --quiet --ignore-unmatch aplicar-parche-1v1.bat ingame/aplicar-parche.js ingame/aplicar-parche-cinematica.js
git rm -f --quiet --ignore-unmatch arreglar-libreria-parche.bat arreglar-libreria-parche.ps1
git rm -f --quiet --ignore-unmatch arreglar-sensor-net11.bat arreglar-push.bat
echo      Borrados.
:siguiente
echo.

rem =====================================================================
rem  4. GITIGNORE NUEVO
rem =====================================================================
echo ---- 4. Poniendo el .gitignore nuevo ----
if exist ".gitignore.antes-de-la-limpieza" del ".gitignore.antes-de-la-limpieza"
if exist ".gitignore" ren ".gitignore" ".gitignore.antes-de-la-limpieza"
if exist "gitignore-nuevo.txt" (
  ren "gitignore-nuevo.txt" ".gitignore"
) else (
  echo      [AVISO] No encuentro gitignore-nuevo.txt al lado de este .bat.
  echo              Copia el .gitignore nuevo a mano antes de hacer commit.
)
echo.

rem =====================================================================
rem  5. COMMIT
rem =====================================================================
echo ---- 5. Guardando el cambio ----
git add -A
git commit -m "Limpieza: fuera compilado, dependencias, modelos y basura vieja" >nul
echo.
echo ===============================================================
echo   LISTO
echo ===============================================================
echo.
git log --oneline -1
echo.
echo  Ahora subelo con:
echo.
echo      git push
echo.
echo  Si algo se rompe y quieres volver atras:
echo.
echo      git reset --hard antes-de-la-limpieza
echo.
pause
