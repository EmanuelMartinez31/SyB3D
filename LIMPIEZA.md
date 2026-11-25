# Limpieza del repositorio SyB3D

Revisado archivo por archivo con el árbol del repo (commit `ba97c49`, «ARREGLO_REPLAY»).

| | Antes | Después |
|---|---|---|
| Peso | **392 MB** | **~28 MB** |
| Archivos | **1425** | **~215** |

No se toca ni una línea de código: lo que se quita es compilado, dependencias, modelos y archivos viejos.

---

## 1. Lo que sobra sin discusión — 363 MB en 1174 archivos

### 1.1 `SyBSensor/bin/` y `SyBSensor/obj/` — 343,9 MB en 535 archivos

Es el **87 % del repositorio**. Es el compilado del sensor y **se regenera solo**.

Comprobado en `SyBSensor.csproj`: las DLLs de League Broadcast **no** se leen de `bin/`, se leen de
`C:\Users\31ema\AppData\Local\LeagueBroadcast\current\` (la propiedad `LbDir`). Y `iniciar.bat` compila
el sensor con `dotnet run -c Release`. O sea, que `bin/` no lo usa nadie.

> Se sacan con `git rm --cached`: **siguen en tu disco**. No tienes que recompilar nada.

### 1.2 `node_modules/` — 2,4 MB en 636 archivos

Está subido al repo cuando no debe. Se instala con `npm install`, y `iniciar.bat` ya lo hace solo la
primera vez. Además es lo que más ensucia cualquier diff: 636 de los 1425 archivos del repo son esto.

### 1.3 `draft/models/` — 16,8 MB en 3 archivos

`Naafiri`, `Poppy` y `Thresh`, 6 MB cada uno. Ya están en el `.gitignore`, pero se subieron antes de
tenerlo. Se sacan del repo y **se quedan en tu disco**.

---

## 2. Basura suelta en la raíz

| Archivo | Qué es |
|---|---|
| `compilar-salida.txt` | Salida de una compilación de .NET |
| `srv-stdout.txt` | Log de una ejecución del servidor |
| `srv-stderr.txt` | Log de errores (vacío) |
| `listado-leaguebroadcast.txt` | 38 KB de un `dir` de `C:` |
| `informe-leaguebroadcast.txt` | Nota vieja sobre el sensor |
| `falta` | Fragmento de una nota: «NETSDK1045 - el SDK 11 de verdad» |
| `no` | Fragmento: «MSB3030 - se encuentra una DLL…» |
| `sigue` | Fragmento: «CS1705 - sin usarse el SDK 11…» |

`iniciar - Acceso directo.lnk` **se queda**: es el atajo con el que abres el HUD y se sigue subiendo.

---

## 2b. Quitados porque tú lo dijiste

| Qué | Peso |
|---|---|
| `calibrar-mapa-3d.html` | 18 KB |
| `streamdeck/` (nota vieja r50) | 6 KB |
| `postgame/data/history/` (20 JSON) | 0,5 MB |
| `ingame/data/gold-series/` (12 JSON) | 0,1 MB |

Las dos carpetas del historial las recrea el servidor solo al arrancar
(`fs.mkdirSync(..., { recursive: true })` en `postgame/server.js:34` y
`ingame/server.js:1597`), así que no falta nada. Se añaden al `.gitignore` para que no vuelvan.

## 3. Instaladores y parches de una sola vez

Estos ya se aplicaron hace tiempo. **Su función vive dentro de `ingame/server.js`**, no en estos archivos:

| Archivo | Qué hacía |
|---|---|
| `instalar-cenital.bat` + `ingame/instalar-cenital.js` | Metía la vista cenital en el servidor |
| `instalar-cinematica.bat` + `ingame/instalar-cinematica.js` | Metía la cinemática en el servidor |
| `instalar-cinematica-r96.bat` | Versión vieja del anterior |
| `aplicar-parche-1v1.bat` + `ingame/aplicar-parche.js` | Parche del 1v1 |
| `ingame/aplicar-parche-cinematica.js` | Parche de la cinemática |
| `arreglar-libreria-parche.bat` + `.ps1` | Diagnosticaba la librería del parche |
| `arreglar-sensor-net11.bat` | Arreglaba el SDK del sensor |
| `arreglar-push.bat` | Arreglaba el push a GitHub |

Ninguno de ellos está referenciado por el servidor: `ingame/server.js` solo hace
`require` de `1v1-ganador`, `camaras`, `cinematica`, `replay` y `vista-cenital`.

**El script te pregunta antes de borrarlos.** Si dices que no, se quedan.

---

## 4. Lo que NO se toca

- `server.js`, `iniciar.bat`, `iniciar - Acceso directo.lnk`, `comprobar-entorno.bat`, `package.json`
- `draft/`, `ingame/`, `postgame/`, `SyBSensor/*.cs`, `SyBSensor/SyBSensor.csproj`
- `ingame/cine/` entero (lo carga `cinematica.js` y `replay.js`)
- `ingame/overlay/vendor/` (three.js)
- `abrir-ajustes.bat`, `probar-interfaz.bat`, `leer-cenital.bat`, `probar-cenital.bat`,
  `volver-cenital.bat` — son atajos del operador y tocan endpoints que existen

---

## Cómo ejecutarlo

1. Abre una terminal en la carpeta del proyecto.
2. Comprueba que no tienes nada sin subir: `git status`
3. Doble clic en **`limpiar-repo.bat`**.
4. Si va bien: `git push`

El script guarda antes una etiqueta de seguridad. Para deshacerlo todo:

```
git reset --hard antes-de-la-limpieza
```

### Lo que hace el script

1. Saca del repo (sin borrar de tu disco) `node_modules`, `SyBSensor/bin`, `SyBSensor/obj` y `draft/models`.
2. Borra la basura de la raíz, `calibrar-mapa-3d.html`, `streamdeck/` y el historial de partidas.
3. Pregunta si quieres borrar los instaladores de la sección 3.
4. Pone el `.gitignore` nuevo (el viejo queda como `.gitignore.antes-de-la-limpieza`).
5. Hace el commit.

Después del `push`, GitHub te ofrecerá compactar el historial: el `.git` seguirá pesando 400 MB aunque
la carpeta ya no. Si quieres, se puede hacer una limpieza del historial con `git filter-repo`, pero eso
reescribe todos los commits y hay que avisar a todo el que tenga el repo clonado.
