# SyB3D + HUD

HUD para transmisiones de League of Legends: **draft**, **ingame** y **postpartida** en
un solo servidor, más el **sensor** que lee la partida desde el juego.

Todo corre en tu PC, en el puerto **3000**. No hace falta internet salvo para los
retratos, iconos y el arte de las skins, que salen de Data Dragon.

---

## Qué hay dentro

| Carpeta | Qué es | README |
|---|---|---|
| `draft/` | Panel de control y overlay del draft (picks, bans, fearless, marcador de serie, presets de equipo) | [draft/README.md](draft/README.md) |
| `ingame/` | Overlay de la partida en vivo: tabla, runas, objetivos, teamfight, presentación de jugadores | [ingame/README.md](ingame/README.md) |
| `postgame/` | Resumen final con modelos 3D, MVP, captura automática e historial | [postgame/README.md](postgame/README.md) |
| `SyBSensor/` | Programa .NET que lee la partida y la envía al HUD | [SyBSensor/README.md](SyBSensor/README.md) |
| `server.js` | Servidor que une los tres módulos | este archivo |
| `iniciar.bat` | Lo único que hay que ejecutar | este archivo |

El **panel** se abre en `http://localhost:3000/` y controla los tres overlays:
nombres de equipo, siglas, logos, torneo, formato de serie y marcador.

---

## Instalación

**Necesitas:**

- **Node.js** 18 o superior — [nodejs.org](https://nodejs.org)
- **.NET SDK 10** — solo si vas a compilar el sensor ([dotnet.microsoft.com](https://dotnet.microsoft.com))
- **League of Legends** instalado (el sensor necesita el cliente abierto)

1. Copia la carpeta del proyecto a:

   ```
   F:\Streams\OBS\Broadcast\SyB3D+HUD
   ```

2. Doble clic en **`iniciar.bat`**.

   La primera vez instala las dependencias solo (`npm install`) y después arranca:
   - el servidor del HUD en el puerto 3000;
   - el sensor en su propia ventana, si encuentra la carpeta `SyBSensor`.

   Deja las dos ventanas abiertas. Si el sensor no arranca, el HUD funciona igual:
   simplemente se queda esperando los datos de la partida.

3. **Abre el juego DESPUÉS** de arrancar `iniciar.bat`. El sensor se engancha al
   cliente cuando lo detecta.

---

## Direcciones (todas en el puerto 3000)

| Qué | Dirección | Para OBS |
|---|---|---|
| Panel de control | `http://localhost:3000/` | no |
| Overlay del **draft** | `http://localhost:3000/overlay.html` | sí · 1920×1080 |
| Overlay del **ingame** | `http://localhost:3000/overlay/` | sí · 1920×1080 |
| Resumen **postpartida** | `http://localhost:3000/postgame/` | sí · 1920×1080 |
| Demo del postpartida | `http://localhost:3000/postgame/?demo=1` | — |
| Ajustar escala de modelos | `http://localhost:3000/postgame/ajustar-modelos.html` | no |
| Estado del sistema | `http://localhost:3000/status` | no |
| Receptor del sensor | `POST http://localhost:3000/sensor` | lo usa el sensor |

Los overlays de draft e ingame tienen **fondo transparente** en OBS. El postpartida
es una pantalla completa con fondo opaco.

En OBS usa **fuente de navegador** de 1920×1080. Si alguna vez cambias el puerto,
actualiza las tres fuentes.

---

## Atajos útiles en la dirección

Se añaden a la URL del overlay correspondiente:

| Atajo | Qué hace |
|---|---|
| `/overlay/?demo=1` | Presentación y tabla del ingame con datos inventados, sin partida |
| `/overlay/?demo=1&t=12` | Igual, pero empezando en ese segundo del reloj |
| `/overlay/?debug=1` | Panel de diagnóstico sobre el HUD: campeón, skin y nombre de cada jugador |
| `/postgame/?demo=1` | Resumen de partida ficticio |

`?debug=1` es lo primero que hay que mirar si una ficha sale sin su arte o sin nombre.

---

## Cómo se hablan las piezas

```
   Juego (League of Legends)
         │  el sensor lee la memoria y la manda por HTTP
         ▼
   SyBSensor  ──POST /sensor──▶  server.js (puerto 3000)
                                      │
                        ┌─────────────┼─────────────┐
                        ▼             ▼             ▼
                     draft/       ingame/       postgame/
                   (panel y      (overlay      (resumen y
                    overlay)      en vivo)      captura LCU)
```

- El **sensor** es el único que habla con el juego por dentro.
- El **ingame** además pregunta a la API local del juego (`127.0.0.1:2999`) por las
  **skins** y los **nombres** de los jugadores.
- El **postpartida** usa la **LCU** (el cliente del LoL) para capturar la partida al
  terminar.
- Los tres comparten configuración de equipos a través del panel.

---

## Antes de arrancar

- **No** abras los antiguos `node server.js` de `SyB3D` o `SyBIngame`, ni
  LeagueBroadcast: el puerto 3000 tiene que estar libre.
- El ingame puede arrancar antes de la partida: se queda esperando los datos.
- Cierra con `Ctrl+C` la ventana del servidor, no con la X, para que no quede colgado.

---

## Archivos que se regeneran solos

Estos no hacen falta para que el proyecto funcione: se crean otra vez cuando se
necesitan. Si algún día quieres que el repositorio pese menos, son los primeros
candidatos a sacar.

| Cosa | Por qué se puede quitar | Cómo vuelve |
|---|---|---|
| `node_modules/` | Son dependencias descargables | `npm install` (o `iniciar.bat`, que lo hace solo) |
| `SyBSensor/bin`, `SyBSensor/obj` | Compilados de .NET | `dotnet build` |
| `srv-stdout.txt`, `srv-stderr.txt` | Salidas de consola de una ejecución | Se crean al arrancar |
| `ingame/data/diag.json` | Informe de diagnóstico de una partida | Se escribe solo en la siguiente |
| `postgame/data/history/` | Partidas ya capturadas | Se van creando al jugar |
| `draft/uploads/` | Logos subidos desde el panel | Se suben de nuevo desde el panel |

Y estos **no se deben borrar nunca**, porque son parte del proyecto o son tuyos:

| Cosa | Por qué |
|---|---|
| `draft/models/` | Los modelos 3D de los campeones: el draft no dibuja nada sin ellos |
| `postgame/data/scale-fix.json` | Tus ajustes de tamaño por campeón, hechos uno por uno |
| `draft/data/presets.json` | Tus presets de equipo y torneo |
| `ingame/overlay/assets/` | Iconos, hechizos, roles y modelos de objetivos |
| `ingame/overlay/vendor/` | `three.js`, que el overlay necesita para los modelos 3D |

---

## Problemas frecuentes

**El puerto 3000 está ocupado.**
Quedó un servidor viejo abierto. Cierra las ventanas de Node y vuelve a empezar.

**El ingame no muestra nada.**
Mira `http://localhost:3000/status`. Si `receiving` es `false`, el sensor no está
enviando: revisa su ventana.

**Una skin sale sin su arte.**
Abre `http://localhost:3000/overlay/?debug=1` y mira qué archivo intentó cargar.
Detalle en [ingame/README.md](ingame/README.md#diagnóstico).

**El postpartida no captura la partida.**
Necesita el cliente del LoL abierto (LCU). Detalle en [postgame/README.md](postgame/README.md).

**Cambié un archivo y no se ve el cambio.**
El servidor no se recarga solo: ciérralo y vuelve a abrir `iniciar.bat`. Y refresca
la fuente en OBS, que guarda la página en memoria.
