# Ingame

Overlay de la partida en vivo. Es lo que se ve encima del juego mientras se juega.

| | |
|---|---|
| Overlay para OBS | `http://localhost:3000/overlay/` |
| Archivos | `ingame/server.js`, `ingame/overlay/index.html`, `ingame/overlay/src/*.js` |
| Assets | `ingame/overlay/assets/` (iconos, hechizos, roles, modelos 3D de objetivos) |
| three.js | `ingame/overlay/vendor/three/` |

**1920×1080 con fondo transparente.** En OBS, fuente de navegador.

---

## Qué se ve

### Tabla de estadísticas (abajo)

- 906 px de ancho, centrada.
- Una fila por jugador: campeón, hechizos, KDA, CS, objetos, oro, barra de vida,
  maná y experiencia.
- El icono de rol oficial va entre el CS/KDA y el nombre.
- La barra de **experiencia** es la tercera, debajo de vida y maná.
- La diferencia de oro va debajo del oro del jugador, con el parche en el centro.
- El marcador de serie nunca es un número ni una barra horizontal: es **una barra
  vertical** de bloques iguales.

### Presentación de jugadores (segundo 5 al 30)

Al empezar la partida, la tabla desaparece y salen **dos fichas 2D** por turno (una
azul y una roja, del mismo rol), cinco segundos cada rol, en orden
**TOP → JUNGLA → MID → ADC → SOPORTE**.

- Cada ficha: **arte de carga del campeón con su skin** y el **nombre del jugador**.
- Entre las dos, el rol y **VS** debajo.
- Las orillas de las fichas caen justo sobre las orillas de la tabla (906 px).
- La tabla vuelve al segundo 30.

### Runas (segundo 5 al 30)

Los paneles de runas de los dos equipos, a los lados, durante el mismo tiempo que la
presentación. Se construyen una sola vez por partida.

### Objetivos

- **Arriba a la izquierda:** temporizador de las **vacularbas** — icono a la
  izquierda, tiempo a la derecha.
- **Arriba a la derecha:** temporizador del **dragón** — tiempo a la izquierda,
  icono a la derecha.
- **Banda central:** objetivos conseguidos por equipo (vacularbas, heraldos, barones
  y el historial de dragones).
- **Avisos 3D** al asegurar un objetivo: vacularbas, dragón, barón y heraldo, con la
  sigla del equipo en su color.

### Teamfight

Aparece cuando hay una pelea de verdad:

- mínimo **3 jugadores vivos por lado** y uno de los dos llegando a **4**;
- **3v3 nunca cuenta**;
- 0,6 s de espera para entrar y 2,0 s para salir (no parpadea);
- cada campeón lleva su propia tarjeta, con el logo del torneo a la altura de la
  tarjeta;
- los muertos y los ausentes no se muestran.

### Fichas de jugador

- Los jugadores muertos se ven en gris y con el **contador de reaparición** encima
  del icono del campeón.
- La **misión de rol** se muestra entre el CS/KDA y el nombre.
- En jungla no hay barra de progreso: solo el contador de la mascota.
- El **Smite** cambia de color: amarillo hasta el minuto 20, arcoíris desde el 20, y
  del color del objeto de jungla cuando se queda sin cargas.
- **Los hechizos nunca muestran la letra D ni F** en ninguna parte.

---

## De dónde salen los datos

Dos fuentes, y conviene saber cuál es cuál:

### 1. SyBSensor (el sensor)

Manda el GameInfo completo a `POST /sensor`. De ahí salen las posiciones, la vida, el
oro, los objetos, las runas, las muertes, los objetivos…

**El sensor NO manda las skins.** Tampoco es fiable el nombre del jugador: a veces
llega vacío, o llega el nombre del campeón disfrazado de nombre de jugador (pasa con
bots y con cuentas que el juego no resuelve).

### 2. La API local del juego

El servidor pregunta a `https://127.0.0.1:2999/liveclientdata/playerlist`, que es la
API que el propio League of Legends abre durante la partida. De ahí salen:

- **la skin** de cada jugador (`skinID`),
- **el nombre real** (`summonerName` / `riotId`).

Se consulta cada segundo al principio y cada 3 s cuando ya están las diez skins.

---

## Cómo se elige el arte de una skin

El `skinID` que publica el juego es el número **corto** de la skin (38, 47, 27…), y
**no siempre coincide** con el número del archivo de Data Dragon. Además, muchas
skins que la gente usa son **variantes de color (cromas)**, y los cromas no tienen
arte de carga propio.

La cadena de intentos, en orden:

1. `Champion_38.jpg` — el arte de la skin exacta.
2. `Champion_19.jpg` — si esa skin es un croma, el arte de su **skin original**
   (se busca por nombre, quitando el paréntesis).
3. `Champion_<número del juego>.jpg`.
4. Si el número viniera en formato largo (223030), su parte corta (30).
5. Community Dragon.
6. Arte base del campeón.
7. Retrato del campeón.

Los pasos 6 y 7 son la red: **una ficha nunca se queda vacía**.

### Diagnóstico

Si una ficha sale sin su skin o sin nombre:

**En el HUD:** añade `?debug=1` a la dirección del overlay:

```
http://localhost:3000/overlay/?debug=1
```

Sale un recuadro con una línea por jugador y **el archivo de arte que cargó de verdad**.
Si termina en `_0.jpg` está saliendo el arte base.

**En el navegador:**

```
http://localhost:3000/ingame/diag
```

Tabla con campeón, skin, nombre y de dónde salió el nombre, más un aviso en verde o
rojo sobre si la API del juego responde y, si no, el motivo exacto
(`ECONNREFUSED`, `ETIMEDOUT`, `404`…).

**En disco:** mientras hay partida se escribe `ingame/data/diag.json` solo, cada 3
segundos. Ese archivo incluye **dos jugadores tal cual los publica el juego**, que es
lo que hace falta para diagnosticar un caso raro.

> Ese archivo se reescribe en cada partida. Si lo necesitas para revisar algo,
> cópialo antes de jugar otra: la siguiente partida lo sobrescribe.

---

## Rutas que sirve

| Ruta | Qué es |
|---|---|
| `/overlay/` | El overlay |
| `POST /sensor` | Receptor del GameInfo que manda SyBSensor |
| `/gameinfo` | Último GameInfo crudo recibido |
| `/ingame` | Último estado ya procesado (lo que consume el overlay) |
| `/ingame/diag` | Página de diagnóstico de fichas |
| `/status` | Estado del sistema para el panel |
| `/hud/status` | Estado del HUD nativo del juego |
| `/hud/hide`, `/hud/show` | Ocultar o mostrar el HUD nativo del juego |
| WebSocket `/ws/ingame` | Estado en vivo |

---

## Notas

- El **minimapa** lleva marco propio del HUD (azul, rojo y negro). El marco del juego
  se tapa con una banda; no se puede apagar desde los ajustes del juego.
- Los **objetivos 3D** usan los `.glb` de `ingame/overlay/assets/models/`.
- Los iconos de hechizos propios están en `ingame/overlay/assets/spells/`, para los
  que Data Dragon no publica (Smite especiales, Teleport mejorado…).
- `vendor/three/` es three.js copiado dentro del proyecto: el overlay lo necesita para
  los modelos 3D y así no depende de internet.
