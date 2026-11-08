# Postpartida

Resumen de la partida al terminar: los diez jugadores con modelos 3D, estadísticas
completas, MVP del ganador y marca de agua del logo de cada equipo.

| | |
|---|---|
| Pantalla para OBS | `http://localhost:3000/postgame/` |
| Demo | `http://localhost:3000/postgame/?demo=1` |
| Ajustar escala de modelos | `http://localhost:3000/postgame/ajustar-modelos.html` |
| Archivos | `postgame/server.js`, `postgame/overlay/*`, `postgame/lib/normalize.js` |
| Datos | `postgame/data/` |

**1920×1080 con fondo opaco** (es una pantalla completa de estadísticas, no un overlay
transparente).

---

## Qué muestra

- Encabezado con el **nombre del torneo** y los logos de los dos equipos a los lados.
- Cinco tarjetas por equipo: modelo 3D del campeón, nombre del invocador, campeón,
  KDA, daño total, daño a campeones, daño recibido, curación, CS, oro y visión.
- **Seis objetos** del inventario por jugador (sin el trinket).
- **Puntuación de visión** y wards colocados y destruidos.
- **MVP** en un jugador del equipo ganador.
- El logo actual de cada equipo como **marca de agua** detrás del campeón.

---

## MVP

Riot no entrega un MVP oficial en estos resúmenes, así que el MVP es **una
clasificación propia de SyB**, no una condecoración del juego.

- Solo participan los jugadores del **equipo que ganó**. Nunca un perdedor.
- Combina seis aportaciones: oro por minuto, visión por minuto, participación en
  asesinatos, KDA, utilidad defensiva (daño recibido y CC) e impacto de daño.
- Así no basta con tener el daño más alto: tanques y soportes también pueden
  destacar.
- Empates: participación, KDA, daño a campeones, oro y, al final, el orden de las
  tarjetas.
- Si no se puede identificar al ganador o faltan estadísticas, **no se muestra MVP**.

---

## Cómo captura la partida

La captura se dispara sola:

1. cuando la LCU entra en `EndOfGame`, **o**
2. cuando SyBSensor detecta la destrucción del nexo — esto cubre las partidas
   personalizadas observadas, en las que la LCU puede quedarse en `None`.

Si las estadísticas todavía no están listas, reintenta cada 5 segundos, incluso
después de salir de `EndOfGame`.

Si las rutas de EOG no están disponibles, toma el `GameId` que ya entrega el sensor y
consulta directamente `/lol-match-history/v1/games/{gameId}`. Si el identificador
trae plataforma (`LA1-1759132007`), la consulta usa solo la parte numérica
(`1759132007`), pero el resumen y la deduplicación conservan el identificador
completo.

**No depende de tu historial personal**: por eso también funciona en una partida que
solo estás observando.

También puedes forzarla con **«Capturar ahora»**, que usa el último GameInfo guardado
en `ingame/data/latest-gameinfo.json` aunque el ingame ya se haya limpiado.

---

## Dónde guarda

| Archivo | Qué es | ¿Se puede borrar? |
|---|---|---|
| `postgame/data/scale-fix.json` | **Tus ajustes de tamaño por campeón** | **NO — es tuyo** |
| `postgame/data/latest-postgame.json` | Último resumen | sí, se regenera con la siguiente captura |
| `postgame/data/history/{gameId}.json` | Una entrada por partida capturada | sí, se van creando solas |

Al reiniciar el servidor se recupera el último resumen, pero vuelve **oculto** hasta
que pulses «Mostrar resumen».

«Siguiente juego» y «Reset serie completa» limpian el ingame, pero **no** borran el
resumen: puedes preparar la siguiente partida sin perder la pantalla anterior.

---

## Ajustar el tamaño de los modelos

Algunos campeones salen pequeños o grandes por cómo está hecho su `.glb`. Se corrige
sin tocar código:

1. Abre `http://localhost:3000/postgame/ajustar-modelos.html`.
2. Ajusta el campeón que quieras.
3. Se guarda en **`postgame/data/scale-fix.json`** y la pantalla lo aplica encima del
   encuadre automático.

El archivo tiene esta forma:

```json
{
  "scaleFix": {
    "zac": 1.35,
    "tahmkench": 0.85,
    "thresh": 1.6
  },
  "updatedAt": "2026-11-06T23:54:25.148Z"
}
```

**Consérvalo**: son horas de ajustar modelos uno por uno.

---

## Los modelos

- El postpartida busca el `.glb` del campeón dentro de **`draft/models/`** (los mismos
  modelos que usa el draft). No hay una segunda copia.
- Si falta el modelo o no carga, la tarjeta conserva las estadísticas y muestra el
  **retrato** del campeón.
- En la demo, Aurora se repite como modelo de prueba.
- Nocturne tiene una escala fija de 0,9; el resto se corrige con `scale-fix.json`.

---

## Archivos

| Archivo | Para qué |
|---|---|
| `server.js` | Conexión LCU, captura, persistencia, controles y API |
| `lib/normalize.js` | Convierte EOG e historial a una misma estructura de diez jugadores |
| `demo-summary.js` | Datos ficticios para probar sin partida real |
| `overlay/index.html` | La pantalla |
| `overlay/src/main.js` | Recibe el estado y conecta el WebSocket |
| `overlay/src/render.js` | Encabezado, franjas y tarjetas |
| `overlay/src/mvp.js` | Puntúa solo a los ganadores y decide el MVP |
| `overlay/src/models.js` | Carga los `.glb`, anima, ajusta escala y dibuja |
| `overlay/src/scale-fix.js` | Correcciones individuales de escala |
| `overlay/src/catalog.js` | Direcciones de retratos y objetos de Data Dragon |
| `overlay/ajustar-modelos.html` | Pantalla para ajustar tamaños |

---

## Rutas que sirve

| Ruta | Qué es |
|---|---|
| `/postgame/` | La pantalla del resumen |
| `/postgame/ajustar-modelos.html` | Ajustador de escalas |
| `/postgame/api/state` | Estado actual del resumen |
| `/postgame/api/demo` | Resumen de demostración |
| `/postgame/api/models` | Lista de modelos disponibles |
| WebSocket `/ws/postgame` | Estado en vivo |

---

## Notas

- Usa **solo el cliente local de LoL (LCU)**. No abre LeagueBroadcast ni usa sus
  canales.
- Las credenciales del lockfile se leen **únicamente en memoria** para conectar con
  `127.0.0.1`; nunca se guardan ni se muestran.
- Los objetos y retratos salen de Data Dragon cuando hay conexión. Los modelos 3D y el
  resto de la interfaz funcionan sin internet.
- Un error de captura **no borra** el resumen anterior.
