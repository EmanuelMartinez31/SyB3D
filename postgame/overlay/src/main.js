// POSTPARTIDA · CONTROLADOR DE LA PANTALLA
// Flujo general: servidor → main.js → render.js (tarjetas) + models.js (3D).

import { loadCatalog } from './catalog.js';
import { renderPostgame } from './render.js';
import { createPostgameModels } from './models.js';

// ============================================================================
// 1. ESTADO DE LA PANTALLA
// renderedKey evita reconstruir las tarjetas si llega el mismo resumen otra vez.
// ============================================================================
const params = new URLSearchParams(location.search);
const demoMode = params.get('demo') === '1';
const stage = document.getElementById('stage');
let socket = null;
let reconnectTimer = null;
let renderedKey = '';
let currentState = null;
let catalog;
let models;

// ============================================================================
// 2. ADAPTACIÓN AL TAMAÑO DE OBS
// El diseño siempre se compone a 1920 × 1080 y luego se escala proporcionalmente.
// ============================================================================
function resizeStage() {
  const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `scale(${scale})`;
  stage.style.left = `${(innerWidth - 1920 * scale) / 2}px`;
  stage.style.top = `${(innerHeight - 1080 * scale) / 2}px`;
}

// ============================================================================
// 3. DIBUJO DE UN NUEVO ESTADO
// Primero se crean las tarjetas HTML; después se vinculan los modelos 3D.
// La información del panel forma parte de la clave para reflejar cambios de
// nombres, siglas, torneo o logos sin volver a capturar la partida.
// ============================================================================
async function applyState(data) {
  currentState = data;
  if (!data?.visible || !data.summary) {
    renderedKey = '';
    stage.hidden = true;
    await models.sync(null, []);
    return;
  }
  const summary = data.summary;
  const key = [
    summary.gameId,
    summary.capturedAt,
    summary.source,
    summary.demo,
    JSON.stringify(summary.info || {}),
    JSON.stringify(summary.sideTeams || {})
  ].join(':');
  if (key === renderedKey && !stage.hidden) return;
  renderedKey = key;
  const views = renderPostgame(summary, catalog);
  await models.sync(summary, views);
}

// ============================================================================
// 4. MENSAJES DEL SERVIDOR
// Solo se aceptan los dos tipos de mensaje pertenecientes al postpartida.
// ============================================================================
function acceptMessage(event) {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (!['postgame-init', 'postgame-state'].includes(message?.type)) return;
  void applyState(message.data);
}

// ============================================================================
// 5. WEBSOCKET Y RECONEXIÓN
// El canal /ws/postgame mantiene OBS sincronizado con los controles del panel.
// ============================================================================
function connect() {
  clearTimeout(reconnectTimer);
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/ws/postgame`);
  socket.addEventListener('message', acceptMessage);
  socket.addEventListener('close', () => {
    reconnectTimer = setTimeout(connect, 1500);
  });
  socket.addEventListener('error', () => socket.close());
}

// ============================================================================
// 6. ARRANQUE
// ?demo=1 usa datos ficticios aislados. La ruta normal recupera el estado real
// y después abre el WebSocket para recibir mostrar, ocultar y actualizaciones.
// ============================================================================
async function start() {
  resizeStage();
  addEventListener('resize', resizeStage);
  catalog = await loadCatalog();
  models = createPostgameModels(document.getElementById('webgl'));
  window.__postgameDebug = () => ({
    visible: !stage.hidden,
    gameId: currentState?.summary?.gameId || null,
    demo: currentState?.summary?.demo === true,
    cards: document.querySelectorAll('.card').length,
    models: { ...models.debug }
  });
  if (demoMode) {
    const summary = await fetch('/postgame/api/demo').then((response) => response.json());
    await applyState({ visible: true, summary, isDemo: true });
    return;
  }
  try {
    const response = await fetch('/postgame/api/state');
    await applyState(await response.json());
  } catch {
    stage.hidden = true;
  }
  connect();
}

void start();
