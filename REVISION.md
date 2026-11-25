# Revisión del repositorio — después de la limpieza

Revisado el árbol actual de `main`. La limpieza se aplicó: **185 archivos, 28,3 MB** (antes 392 MB).

---

## 1. Está todo lo necesario ✅

Comprobado uno por uno, no a ojo:

| Comprobación | Resultado |
|---|---|
| `server.js` de la raíz → `draft/server`, `ingame/server`, `postgame/server` | ✅ los tres están |
| `ingame/server.js` → `1v1-ganador`, `camaras`, `cinematica`, `replay`, `vista-cenital` | ✅ los cinco están |
| `postgame/server.js` → `demo-summary`, `lib/gold-series`, `lib/normalize` | ✅ los tres están |
| `/overlay.html` → `draft/public/overlay.html` | ✅ 67 KB |
| `/overlay/` → `ingame/overlay/index.html` + `src/` + `vendor/three` | ✅ completo |
| `/postgame/` → `postgame/overlay/index.html` + `src/` + `styles.css` | ✅ completo |
| `package.json` + `package-lock.json` (`express`, `ws`) | ✅ |
| `iniciar.bat` + `comprobar-entorno.bat` | ✅ |
| `SyBSensor` (`.cs`, `.csproj`, `README`) | ✅ |
| `.gitignore` nuevo aplicado | ✅ |
| Recursos del HUD (fuentes, iconos, hechizos, objetivos, mapas) | ✅ |

## 2. Sacar `node_modules` no rompe nada ✅

Verificado en `iniciar.bat`, líneas 13-19:

```bat
if not exist "node_modules\express\package.json" goto instalar
if not exist "node_modules\ws\package.json" goto instalar
...
call npm install
```

Detecta que faltan `express` y `ws` y los instala solo la primera vez. Correcto.

## 3. Las carpetas borradas se recrean solas ✅

- `postgame/data/history/` → `fs.mkdirSync(HISTORY_DIR, { recursive: true })` en `postgame/server.js:34`
- `ingame/data/gold-series/` → `fs.mkdirSync(GOLD_SERIES_DIR, { recursive: true })` en `ingame/server.js:1597`

## 4. Avisos (no son fallos, pero conviene saberlos)

**`draft/models/` ya no está en el repo.** Los tres modelos 3D siguen en tu disco, así que en tu PC
todo funciona. Pero si algún día clonas el repo en otro ordenador, el postpartida saldrá sin los
campeones en 3D hasta que copies esa carpeta. Está en el `.gitignore`, que es lo correcto.

**La primera vez tras clonar tarda un poco más** porque `npm install` descarga `express` y `ws`.

## 5. Lo que todavía sobra (10 archivos, ~1,1 MB)

Se me escaparon en la primera pasada porque no tienen extensión de texto:

| Archivo | Peso | Qué es |
|---|---|---|
| `ingame/server.js.bak` | 94,6 KB | Copia del servidor de cuando se aplicaba un parche |
| `ingame/server.js.antes-cenital` | 100,7 KB | Idem |
| `ingame/server.js.antes-cinematica` | 74,2 KB | Idem |
| `ingame/cinematica.js.r89.bak` | 20,6 KB | Idem |
| `ingame/cine/calle-central.js.r89.bak` | 18,0 KB | Idem |
| `ingame/overlay/assets/map/grieta-3d-r117.webp` | 151 KB | Versión vieja del mapa |
| `…-r119.webp` | 136 KB | Versión vieja |
| `…-r120.webp` | 136 KB | Versión vieja |
| `…-r121.webp` | 190 KB | Versión vieja |
| `…-r123.webp` | 192 KB | Versión vieja |

Los cinco backups los dejaban los instaladores de los parches que ya borramos.

De los mapas solo se usan **dos**: `grieta-3d.webp` (el que se ve) y `grieta-3d-r124.webp`
(referenciado en `render.js:2855`). Los otros cinco no los menciona ni un archivo del repo.

Se quitan con **`limpiar-basura.bat`**.

---

## 6. El panel de control

Corregido: **solo Draft, Ingame y Postpartida**, como pediste. Fuera la sección de herramientas
(ajustar cámara, escalar modelos, demo): la escala de modelos ya está en la pestaña Postpartida
y la cámara se ajusta desde su propia página.

Probado en 1920×1080: tres filas, URLs completas sin recortar, botón copiar funcionando y el punto
de estado del servidor respondiendo. Cero errores de JavaScript.
