import { loadGameCatalog } from './data-dragon.js';
import { createDemoState, advanceDemoState, aplicarBuffDemo } from './demo.js';
import { renderIngameState } from './render.js';
import { createVoidGrubAlert } from './voidgrub-alert.js';
import { createDragonAlert } from './dragon-alert.js';
import { createBaronAlert } from './baron-alert.js';
import { createHeraldAlert } from './herald-alert.js';

const params = new URLSearchParams(window.location.search);
const localHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const forceLive = params.get('live') === '1';
const demoMode = params.get('demo') === '1' || (!forceLive && !localHost && window.location.protocol !== 'file:');
const connection = document.getElementById('connection');
const demoBadge = document.getElementById('demo-badge');
const grubAlert = createVoidGrubAlert(document.getElementById('voidgrub-alert'));
const dragonAlert = createDragonAlert(document.getElementById('dragon-alert'));
const baronAlert = createBaronAlert(document.getElementById('baron-alert'));
const heraldAlert = createHeraldAlert(document.getElementById('herald-alert'));
let demoTimer = null;
let reconnectTimer = null;
let socket = null;
let hasLiveState = false;

function resizeStage() {
  const stage = document.getElementById('stage');
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `scale(${scale})`;
  stage.style.left = `${(window.innerWidth - 1920 * scale) / 2}px`;
  stage.style.top = `${(window.innerHeight - 1080 * scale) / 2}px`;
}

function setConnection(text, state = '') {
  connection.textContent = text;
  connection.classList.toggle('connected', state === 'connected');
  connection.classList.toggle('error', state === 'error');
}

function alertTeamShort(side, info) {
  const fallback = side === 'blue' ? 'AZUL' : 'ROJO';
  const fullName = String(info?.[side] || fallback).trim() || fallback;
  const words = fullName.split(/\s+/).filter(Boolean);
  const generated = words.length > 1
    ? words.map(word => word[0]).join('').slice(0, 4)
    : fullName.slice(0, 4);
  return String(info?.[`${side}Short`] || info?.[`${side}Tag`] || generated)
    .trim().toUpperCase() || fallback;
}

function syncAlert(alert, element, notice, info) {
  const side = notice?.team === 1 ? 'blue' : notice?.team === 2 ? 'red' : null;
  const badge = element.querySelector('.alert-team');
  if (side) {
    const shortName = alertTeamShort(side, info);
    const fullName = String(info?.[side] || shortName).trim() || shortName;
    element.dataset.team = side;
    badge.textContent = shortName;
    badge.title = `Objetivo conseguido por ${fullName}`;
    badge.hidden = false;
  } else {
    delete element.dataset.team;
    badge.textContent = '';
    badge.removeAttribute('title');
    badge.hidden = true;
  }
  alert.sync(notice);
}

function emptyLiveState(config) {
  const emptyObjectives = { dragon: 0, grubs: 0, riftHerald: 0, baron: 0, atakhan: 0, dragonTypes: [] };
  return {
    schemaVersion: 1,
    meta: { gameTime: null, gameId: null },
    teams: [
      { team: 1, objectives: { ...emptyObjectives } },
      { team: 2, objectives: { ...emptyObjectives } }
    ],
    players: [],
    objectives: { active: {}, camps: [], buffs: { 1: null, 2: null } },
    notices: { grubs: null, dragon: null, baron: null, herald: null },
    structures: { turrets: [], inhibitors: [], nexus: [] },
    wards: [],
    info: config?.info || null,
    score: config?.score || null,
    sideTeams: config?.sideTeams || null
  };
}

function acceptMessage(event, catalog) {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (!['ingame-init', 'ingame-state', 'ingame-clear'].includes(message?.type)) return;
  if (!message.data || typeof message.data !== 'object') return;
  if (message.type === 'ingame-clear') {
    hasLiveState = false;
    syncAlert(grubAlert, document.getElementById('voidgrub-alert'), null, message.data.info);
    syncAlert(dragonAlert, document.getElementById('dragon-alert'), null, message.data.info);
    syncAlert(baronAlert, document.getElementById('baron-alert'), null, message.data.info);
    syncAlert(heraldAlert, document.getElementById('herald-alert'), null, message.data.info);
    renderIngameState(emptyLiveState(message.data), catalog);
    setConnection('ESPERANDO PARTIDA', 'connected');
    return;
  }
  hasLiveState = true;
  syncAlert(grubAlert, document.getElementById('voidgrub-alert'), message.data?.notices?.grubs, message.data.info);
  syncAlert(dragonAlert, document.getElementById('dragon-alert'), message.data?.notices?.dragon, message.data.info);
  syncAlert(baronAlert, document.getElementById('baron-alert'), message.data?.notices?.baron, message.data.info);
  syncAlert(heraldAlert, document.getElementById('herald-alert'), message.data?.notices?.herald, message.data.info);
  renderIngameState(message.data, catalog);
  setConnection('EN VIVO', 'connected');
}

function webSocketUrl() {
  if (window.location.protocol === 'file:') return 'ws://localhost:3000/ws/ingame';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/ingame`;
}

function connect(catalog) {
  window.clearTimeout(reconnectTimer);
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  setConnection(hasLiveState ? 'RECONECTANDO' : 'CONECTANDO');
  socket = new WebSocket(webSocketUrl());

  socket.addEventListener('open', () => {
    setConnection(hasLiveState ? 'RECONECTANDO' : 'CONECTADO · ESPERANDO DATOS');
  });
  socket.addEventListener('message', event => acceptMessage(event, catalog));
  socket.addEventListener('close', () => {
    setConnection('SIN SEÑAL · REINTENTANDO', 'error');
    reconnectTimer = window.setTimeout(() => connect(catalog), 1500);
  });
  socket.addEventListener('error', () => socket.close());
}

async function start() {
  resizeStage();
  window.addEventListener('resize', resizeStage);
  void grubAlert.prepare();
  void dragonAlert.prepare();
  void baronAlert.prepare();
  void heraldAlert.prepare();
  const catalog = await loadGameCatalog();

  if (demoMode) {
    document.body.dataset.mode = 'demo';
    demoBadge.hidden = false;
    setConnection('VISTA PREVIA', 'connected');
    const requestedFormat = String(params.get('bo') || 'BO3').toUpperCase();
    const demoFormat = ['BO1', 'BO3', 'BO5'].includes(requestedFormat) ? requestedFormat : 'BO3';
    let state = createDemoState(demoFormat);
    const demoObjectiveTeam = params.get('team') === 'red' ? 2 : 1;
    renderIngameState(state, catalog);
    if (params.get('grubs') === '1') {
      syncAlert(grubAlert, document.getElementById('voidgrub-alert'), { id: 'demo-grubs', kind: 'grubs', defeated: 3, team: demoObjectiveTeam }, state.info);
    }
    const demoDragons = {
      air: 'Cloud', cloud: 'Cloud',
      fire: 'Infernal', infernal: 'Infernal',
      earth: 'Mountain', mountain: 'Mountain',
      water: 'Ocean', ocean: 'Ocean',
      hextech: 'Hextech', chemtech: 'Chemtech', quimtech: 'Chemtech',
      elder: 'Elder', ancestral: 'Elder'
    };
    const requestedDragon = String(params.get('dragon') || '').toLowerCase();
    const demoDragonType = requestedDragon === '1' ? 'Cloud' : demoDragons[requestedDragon];
    if (demoDragonType) {
      syncAlert(dragonAlert, document.getElementById('dragon-alert'), { id: `demo-dragon-${requestedDragon}`, kind: 'dragon', dragonType: demoDragonType, team: demoObjectiveTeam }, state.info);
    }
    if (params.get('baron') === '1') {
      syncAlert(baronAlert, document.getElementById('baron-alert'), { id: 'demo-baron', kind: 'baron', team: demoObjectiveTeam }, state.info);
    }
    // Vista previa del buff de objetivo: &buff=baron|elder para el equipo de
    // &team y &buff2=baron|elder para el contrario, con &bufftime segundos.
    const buffKinds = { baron: 'baron', elder: 'elder', ancestral: 'elder' };
    const pedirBuff = clave => buffKinds[String(params.get(clave) || '').toLowerCase()];
    const buffPropio = pedirBuff('buff');
    if (buffPropio) aplicarBuffDemo(state, buffPropio, demoObjectiveTeam, Number(params.get('bufftime')));
    const buffRival = pedirBuff('buff2');
    if (buffRival) {
      aplicarBuffDemo(state, buffRival, demoObjectiveTeam === 1 ? 2 : 1, Number(params.get('bufftime2')));
    }
    // El demo expone su estado para las capturas de prueba del HUD.
    window.__sybDemoState = () => state;
    if (params.get('herald') === '1') {
      syncAlert(heraldAlert, document.getElementById('herald-alert'), { id: 'demo-herald', kind: 'riftHerald', team: demoObjectiveTeam }, state.info);
    }
    let previous = performance.now();
    demoTimer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(1, (now - previous) / 1000);
      previous = now;
      state = advanceDemoState(state, elapsed);
      renderIngameState(state, catalog);
    }, 250);
    return;
  }

  document.body.dataset.mode = 'live';
  demoBadge.hidden = true;
  connect(catalog);
}

start();
