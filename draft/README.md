# Draft

Panel de control y overlay del draft. Es la cara visible durante la selección de
campeones y también el centro de mando de todo el HUD.

| | |
|---|---|
| Panel | `http://localhost:3000/` |
| Overlay para OBS | `http://localhost:3000/overlay.html` |
| Archivos | `draft/server.js`, `draft/public/index.html`, `draft/public/overlay.html` |
| Datos | `draft/data/presets.json`, `draft/data/draft-state.json` |
| Modelos 3D | `draft/models/` |
| Logos subidos | `draft/uploads/` |

---

## El panel

Se divide en tres secciones:

- **Draft** — turno, modo guiado o manual, parrilla de campeones, líneas, marcador,
  fearless y AUTO.
- **Producción** — torneo, nombres, siglas, logos y presets de equipo.
- **Postpartida** — estado, enlaces de OBS, mostrar u ocultar el resumen, captura,
  demo y vuelta al último resumen real.

El estado del sistema y el registro del operador están siempre visibles, en
cualquier sección.

### Serie

- Formatos: **BO1**, **BO3** y **BO5**.
- El centro muestra el formato y `PARTIDA N DE TOTAL`.
- Al detectar un nexo destruido la victoria queda **pendiente**: el marcador no
  cambia hasta que pulsas **«Siguiente juego»**. Los snapshots repetidos no
  duplican el resultado.
- **«Siguiente juego»** y **«Reset serie completa»** limpian también el ingame, para
  que no vuelvan a aparecer datos de la partida anterior.
- Al llegar a las victorias necesarias aparece `SERIE COMPLETADA`.

### Fearless

Los picks de la serie se acumulan por equipo y salen de la parrilla en las partidas
siguientes. Se conserva el orden de procesamiento del roster.

### Equipos y logos

- Formatos de logo: **PNG, JPG/JPEG, WEBP, GIF y SVG**, máximo 8 MB por archivo.
- Se guardan en `draft/uploads/` y se ajustan al recuadro sin deformarse.
- Al cambiar de lado se intercambian nombres, siglas, logos y victorias.
- Los nombres largos aprovechan todo el ancho central antes de partirse en líneas.

### Presets

`draft/data/presets.json` guarda tus combinaciones de torneo y equipos para
recuperarlas de un clic. **Este archivo no se borra**: son tus presets.

---

## El overlay

- **1920×1080 con fondo transparente.**
- En OBS: fuente de navegador apuntando a `http://localhost:3000/overlay.html`.
- Muestra los diez modelos 3D de los campeones elegidos, las líneas, los bans, el
  marcador y el temporizador de objetivos de la parte superior.

### Modelos 3D

Los modelos están en **`draft/models/`**, un `.glb` por campeón (176 campeones).

- Se cargan como `/models/{Nombre}.glb` desde el overlay.
- Pesan alrededor de **1.1 GB en total**. Están en el repositorio a propósito: sin
  ellos el draft no puede dibujar los campeones.
- Si falta el modelo de un campeón, la tarjeta se queda sin figura pero el resto del
  draft funciona.

### Fondo y recursos

El logo general y el fondo del draft están en **«Recursos avanzados del draft»**
dentro de Producción, porque los usa `overlay.html`.

---

## Rutas que sirve

| Ruta | Qué es |
|---|---|
| `/` | Panel de control (`public/index.html`) |
| `/overlay.html` | Overlay del draft |
| `/models/{Nombre}.glb` | Modelos 3D de los campeones |
| `/uploads/{archivo}` | Logos subidos desde el panel |
| `/api/presets` | Lectura y guardado de presets |
| WebSocket `/ws/draft` | Estado en vivo del draft |

---

## Rendimiento

Si el panel o el draft provocan tirones mientras se transmite:

- el indicador «EN VIVO» no anima nada de forma infinita;
- la escena 3D va a un máximo de **60 fps** y el lienzo interno está limitado a
  1920×1080 aunque el monitor tenga más densidad: así no se renderizan píxeles que
  nunca se ven;
- al deshacer, limpiar o restaurar un draft se liberan geometrías, materiales,
  texturas y esqueletos de los modelos retirados.

---

## Archivos

| Archivo | Para qué |
|---|---|
| `server.js` | Estado de la serie, presets, subida de logos, WebSocket |
| `public/index.html` | Panel de control completo |
| `public/overlay.html` | Overlay con la escena 3D |
| `data/presets.json` | **Tus presets** (no borrar) |
| `data/draft-state.json` | Estado de la serie en curso (se regenera) |
