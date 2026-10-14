# HUD 3D de Draft para League of Legends

Overlay 3D para pick/ban con control 100% manual por un operador.
Panel web → WebSocket → escena Three.js → Browser Source en OBS.

## Requisitos
- Node.js 18+ (https://nodejs.org)
- (Opcional) VS Code con extensión "Live Server" — no es necesario, el servidor ya sirve todo.

## Instalación y arranque
```bash
npm install
npm start
```

## Uso
1. **Panel de operador**: http://localhost:3000
   - Elige equipo (azul/rojo), haz clic en un campeón para PICK (aparece en 3D) o BAN (solo log).
2. **Overlay para OBS**: http://localhost:3000/overlay.html
   - En OBS: Add → Browser → URL `http://localhost:3000/overlay.html`
   - ✅ Marca "Refresh browser when scene becomes active" si quieres que se reinicie al entrar a la escena.

## Modelos 3D de campeones
Coloca los modelos en formato **.glb** dentro de la carpeta `/models` con el nombre del campeón
(p. ej. `models/Jinx.glb`). Los modelos se cargan automáticamente al hacer pick.

Cómo obtenerlos legalmente (assets de Riot, uso comunitario permitido bajo Legal Jibber Jabber):
- Herramienta "League Model Viewer" / converters basados en CommunityDragon
  → https://github.com/CommunityDragon
- Exportar como glTF (.glb) con la herramienta de tu preferencia.

Si el modelo no existe, el overlay muestra un placeholder de color según el equipo.

## Estructura
```
server.js            Servidor Express + WebSocket (puerto 3000)
public/index.html    Panel de operador
public/overlay.html  Escena 3D (Three.js) para OBS
models/              Aquí van los .glb de campeones
```

## Siguientes pasos sugeridos
- Sincronización con el cliente real vía LCU (lol-pick-ban-ui de RCVolus) como fuente de datos
- Transiciones cinematográficas (GSAP / postprocesado)
- Pantalla de bans con imágenes 2D oficiales
- Tema visual de tu torneo (colores, logo, tipografía)
