const express = require('express');
const http = require('http');
const { EventEmitter } = require('events');
const setupDraft = require('./draft/server');
const setupIngame = require('./ingame/server');
const setupPostgame = require('./postgame/server');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const app = express();
const server = http.createServer(app);
const control = new EventEmitter();

// Los tres módulos comparten el mismo servidor HTTP, puerto y controles de serie.
const draft = setupDraft({ app, control });
const ingame = setupIngame({ app, port: PORT, control });
const postgame = setupPostgame({ app, port: PORT, control });

server.on('upgrade', (request, socket, head) => {
  let pathname = '/';
  try { pathname = new URL(request.url, 'http://localhost').pathname; }
  catch { socket.destroy(); return; }

  // Cada módulo conserva un canal aislado dentro del mismo servidor.
  const target = pathname === '/ws/ingame'
    ? ingame.wss
    : pathname === '/ws/postgame' ? postgame.wss : draft.wss;
  target.handleUpgrade(request, socket, head, ws => {
    target.emit('connection', ws, request);
  });
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${PORT} está ocupado. Cierra los servidores antiguos de SyB3D y SyBIngame antes de usar iniciar.bat.`);
  } else {
    console.error('No se pudo iniciar SyB3D+HUD:', error);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  ingame.start();
  postgame.start();
  console.log('============================================================');
  console.log('SyB3D+HUD listo: draft, ingame y postpartida funcionan en un solo puerto.');
  console.log(`Panel       → http://localhost:${PORT}/`);
  console.log(`Draft OBS   → http://localhost:${PORT}/overlay.html`);
  console.log(`Ingame OBS  → http://localhost:${PORT}/overlay/`);
  console.log(`Postpartida → http://localhost:${PORT}/postgame/`);
  console.log(`Demo final  → http://localhost:${PORT}/postgame/?demo=1`);
  console.log(`SyBSensor   → POST http://localhost:${PORT}/sensor`);
  console.log(`Estado      → http://localhost:${PORT}/status`);
  console.log('============================================================');
  console.log('El ingame quedará esperando datos hasta que entres a la partida.');
});
