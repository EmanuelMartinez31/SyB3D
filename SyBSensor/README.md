# SyBSensor

Programa en .NET que lee la partida de League of Legends desde dentro y manda los
datos al HUD. **Sin él, el ingame y el postpartida no tienen nada que mostrar.**

| | |
|---|---|
| Archivos | `Program.cs`, `LegacyTcpIpcClient.cs`, `SyBSensor.csproj` |
| Destino de los datos | `POST http://localhost:3000/sensor` |
| Lo arranca | `iniciar.bat`, solo, en su propia ventana |

No tiene pantalla: es una **ventana de consola** que va escribiendo lo que hace. Deja
esa ventana abierta mientras juegas.

---

## Qué hace

1. Se engancha al cliente del juego cuando lo detecta (**autoinyección**).
2. Se conecta a `127.0.0.1:4998`, el canal **TCP legacy** que abre `lblib` dentro del
   juego.
3. Recibe el **GameInfo** completo muchas veces por segundo: los diez héroes, sus
   posiciones, vida, maná, oro, objetos, runas, hechizos, torretas, inhibidores,
   nexos, monstruos neutrales y objetivos.
4. Lo serializa a JSON y lo envía al HUD.

Cada envío deja una línea en la ventana:

```
[GameInfo #1] 226292 bytes
```

Si ves esas líneas subiendo, el sensor está funcionando.

---

## Cómo arrancarlo

`iniciar.bat` lo hace solo. Busca la carpeta del sensor en este orden y se queda con
la primera que encuentre:

```
SyB3D+HUD\SyBSensor
SyB3D+HUD\SyBSensor\SyBSensor
..\SyBSensor
..\SyBSensor\SyBSensor
```

- Si encuentra un **`SyBSensor.csproj`** → lo arranca con `dotnet run`.
- Si encuentra un **`SyBSensor.exe`** → abre el ejecutable.
- Si no encuentra nada → avisa y sigue: el HUD arranca igual, solo que sin datos.

En la ventana principal aparece `SyBSensor encontrado en: ...` para que sepas qué
carpeta usó. Si esa ruta no es la que esperabas, es que quedó una copia vieja en otro
sitio.

> **Ábrelo antes que el juego.** El sensor espera al cliente; si el juego ya estaba
> abierto, ciérralo y vuelve a entrar para que la inyección ocurra.

---

## Compilarlo

```bat
cd SyBSensor
dotnet build
```

Necesita **.NET SDK 10** y la carpeta de **LeagueBroadcast** instalada, porque toma de
ahí sus bibliotecas (`Farsight.dll`, `BlueBottleClient.*`, `AWSSDK.*`, `FlatSharp`,
`lblib.dll`).

La ruta está fijada en el `.csproj`:

```xml
<LbDir>C:\Users\31ema\AppData\Local\LeagueBroadcast\current\</LbDir>
```

**Si cambias de PC o de usuario de Windows**, esa línea hay que ajustarla a la ruta
real de LeagueBroadcast en la máquina nueva. Es el error más común al mover el
proyecto: `dotnet build` falla diciendo que no encuentra `Farsight.dll`.

Al compilar se copian esas dependencias junto al ejecutable, así que después puedes
usar `SyBSensor.exe` directamente sin recompilar.

---

## Qué manda y qué no

### Sí manda

Todo lo que el HUD necesita para dibujar la partida: héroes, estadísticas, objetos,
runas, hechizos, estructuras, monstruos y eventos.

### NO manda las skins

El GameInfo **no incluye la skin** de cada campeón. Por eso el servidor del HUD
pregunta aparte a la API local del juego (`127.0.0.1:2999`) para saber qué skin lleva
cada jugador. Si esa API no responde, las fichas usan el arte base del campeón.

### El nombre del jugador no siempre es fiable

El campo `NameAndTagline` a veces llega:

- **vacío**, o
- con el **nombre del campeón** en lugar del nombre del jugador (pasa con bots y con
  cuentas que el juego no resuelve; por ejemplo: `"Rammus"`).

El HUD lo detecta, descarta esos valores y usa el nombre real que publica la API
local del juego. No hace falta tocar el sensor por esto.

---

## Detalles técnicos

| Cosa | Valor |
|---|---|
| Versión que anuncia en consola | `SyBSensor v12.1` |
| Framework | `.NET 10` (`net10.0-windows`) |
| Transporte con el juego | **TCP legacy** en `127.0.0.1:4998` |
| NamedPipe / autenticación IPC | **no se usa** (eliminado a propósito) |
| LeagueBroadcast | **no se abre**; solo se usan sus DLL y su sesión local |
| Reintento de conexión TCP | cada 750 ms |
| Timeout del envío al HUD | 15 s |
| Tamaño máximo de mensaje | 64 MB |

El canal TCP lo usan dos archivos:

- **`LegacyTcpIpcClient.cs`** — abre el socket, se registra (`Response`) y va leyendo
  los snapshots con FlatSharp.
- **`Program.cs`** — orquesta todo: inyección, reintentos, serialización y envío por
  HTTP.

### Sobre la sesión local

`Program.cs` lee `%APPDATA%\BlueBottle\LeagueBroadcast\data\Credentials.bbd`
**solo en memoria**, para comprobar la versión de `lblib` contra la del juego. El
archivo **nunca se modifica ni se guarda**. Si no existe, el sensor funciona igual con
la `lblib` local; solo avisa en la consola.

---

## Problemas frecuentes

**La ventana se abre y no pasa nada.**
Falta abrir el juego. Espera: la línea `Buscando el LoL...` significa que está
esperando.

**Se queda en `Buscando el LoL...` aunque el juego esté abierto.**
Ábrelo **después** del sensor. Ciérralo y vuelve a entrar.

**`Inyeccion fallo: ...`**
El sensor no puede engancharse al juego. Suele ser por permisos: prueba a ejecutar
`iniciar.bat` como administrador.

**`TCP legacy: ... Reintentando...` en bucle.**
El canal `127.0.0.1:4998` no está disponible. Revisa que el juego esté realmente en
partida y que no haya otro programa usando ese puerto.

**`No se pudo enviar GameInfo al HUD`.**
El servidor del HUD no está corriendo. Comprueba que la ventana de `node server.js`
sigue abierta y que `http://localhost:3000/status` responde.

**Dos sensores a la vez.**
Meten snapshots duplicados en el ingame. Comprueba que no quedó una copia vieja del
sensor en otra carpeta: en la consola se ve qué ruta usó `iniciar.bat`.

**Al mover la carpeta del sensor.**
Borra antes `SyBSensor\bin` y `SyBSensor\obj`: guardan rutas absolutas del sitio viejo
y `dotnet run` puede fallar con errores raros.
