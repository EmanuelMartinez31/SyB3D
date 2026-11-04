const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

module.exports = function setupDraft({ app, control }) {
const wss = new WebSocketServer({ noServer: true });
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = process.env.SYB_DRAFT_STATE_FILE || path.join(DATA_DIR, 'draft-state.json');
const PRESETS_PATH = process.env.SYB_DRAFT_PRESETS_FILE || path.join(DATA_DIR, 'presets.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
app.use(express.static(path.join(__dirname, 'public')));
const LOCAL_MODELS = path.join(__dirname, 'models');
const LEGACY_MODELS = path.join(__dirname, '..', '..', 'SyB3D', 'models');
app.use('/models', express.static(fs.existsSync(LOCAL_MODELS) ? LOCAL_MODELS : LEGACY_MODELS));
app.use('/uploads', express.static(UPLOAD_DIR));

function emptyDraftState() {
  return {
    picks: [], bans: [], info: null, score: null, roster: null,
    history: { blue: [], red: [] },
    histTeams: {}, // nombreEquipo -> [campeones usados] (fearless por EQUIPO)
    teamBind: {}, // nombreEquipo -> [jugadores que lo identifican]
    sideTeams: null, // lado -> nombreEquipo (se recalcula con cada nueva sala)
    fearless: true,
    lcuEnabled: false
  };
}

// El estado se guarda localmente para sobrevivir a un reinicio del servidor.
// No contiene lockfile, contraseñas, tokens ni datos de LeagueBroadcast.
function loadDraftSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudo recuperar el draft guardado:', error.message);
    return null;
  }
}

const savedSnapshot = loadDraftSnapshot();
const restored = savedSnapshot?.state && typeof savedSnapshot.state === 'object'
  ? savedSnapshot.state
  : {};
const defaults = emptyDraftState();
let state = {
  ...defaults,
  ...restored,
  picks: Array.isArray(restored.picks) ? restored.picks : [],
  bans: Array.isArray(restored.bans) ? restored.bans : [],
  history: restored.history && typeof restored.history === 'object' ? restored.history : defaults.history,
  histTeams: restored.histTeams && typeof restored.histTeams === 'object' ? restored.histTeams : {},
  teamBind: restored.teamBind && typeof restored.teamBind === 'object' ? restored.teamBind : {},
  fearless: restored.fearless !== false,
  lcuEnabled: restored.lcuEnabled === true
};
let seriesRevision = Number.isInteger(savedSnapshot?.seriesRevision) ? savedSnapshot.seriesRevision : 0;
const countedGames = new Set(Array.isArray(savedSnapshot?.countedGames) ? savedSnapshot.countedGames : []);
const pendingWinners = new Map(
  Array.isArray(savedSnapshot?.pendingWinners)
    ? savedSnapshot.pendingWinners.filter(entry => Array.isArray(entry) && entry.length === 2)
    : []
);

function saveDraftState() {
  const snapshot = {
    version: 1,
    state,
    seriesRevision,
    countedGames: [...countedGames],
    pendingWinners: [...pendingWinners]
  };
  const temporaryPath = `${STATE_PATH}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(snapshot, null, 2));
    fs.renameSync(temporaryPath, STATE_PATH);
  } catch (error) {
    console.error('No se pudo guardar el estado del draft:', error.message);
    try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch {}
  }
}

// Los presets son configuraciones del operador; no contienen credenciales ni picks.
function loadPresets() {
  try {
    const saved = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'));
    return Array.isArray(saved) ? saved.filter(p => p && p.id && p.name && p.data && typeof p.data === 'object') : [];
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudieron recuperar los presets:', error.message);
    return [];
  }
}
let presets = loadPresets();
function savePresets() {
  const temporaryPath = `${PRESETS_PATH}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(presets, null, 2));
    fs.renameSync(temporaryPath, PRESETS_PATH);
    return true;
  } catch (error) {
    console.error('No se pudieron guardar los presets:', error.message);
    try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch {}
    return false;
  }
}

const broadcast = (obj) => wss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(obj)); });

// ===== Lógica de equipos: los nombres y el fearless SIGUEN A LOS EQUIPOS =====
function ensureTeamBinds() {
  if (!state.info || !state.info.blue || !state.info.red) return;
  if (!state.sideTeams) state.sideTeams = { blue: state.info.blue, red: state.info.red };
  const roster = state.roster || { blue: [], red: [] };
  ['blue', 'red'].forEach(side => {
    const t = state.sideTeams[side];
    if (!t) return;
    state.teamBind[t] = [...new Set([...(state.teamBind[t] || []), ...(roster[side] || []).filter(Boolean)])];
  });
}
function reassignTeams() {
  if (!state.sideTeams) return false;
  const roster = state.roster || { blue: [], red: [] };
  const teams = [state.sideTeams.blue, state.sideTeams.red].filter(Boolean);
  const overlap = (team, side) => (state.teamBind[team] || []).filter(p => p && (roster[side] || []).includes(p)).length;
  console.log('REASSIGN lados=', JSON.stringify(state.sideTeams), '| rosterAzul=', JSON.stringify(roster.blue), '| binds=', JSON.stringify(state.teamBind));
  let changed = false;
  teams.forEach(team => {
    const nAzul = overlap(team, 'blue'), nRojo = overlap(team, 'red');
    const currentSide = state.sideTeams.blue === team ? 'blue' : 'red';
    const majoritySide = nAzul > nRojo ? 'blue' : nRojo > nAzul ? 'red' : currentSide;
    if (majoritySide !== currentSide) {
      const other = teams.find(t => t !== team);
      state.sideTeams = majoritySide === 'blue' ? { blue: team, red: other } : { blue: other, red: team };
      changed = true;
    }
  });
  if (changed && state.info) {
    const previousInfo = state.info;
    state.info = {
      ...previousInfo,
      blue: state.sideTeams.blue,
      red: state.sideTeams.red,
      blueShort: previousInfo.redShort || '',
      redShort: previousInfo.blueShort || '',
      blueLogo: previousInfo.redLogo || '',
      redLogo: previousInfo.blueLogo || ''
    };
    // Las victorias visibles y las pendientes siguen al equipo, no al color.
    if (state.score) state.score = { ...state.score, blue: state.score.red, red: state.score.blue };
    for (const [gameId, winner] of pendingWinners) {
      pendingWinners.set(gameId, winner === 'blue' ? 'red' : 'blue');
    }
  }
  // extender binds con suplentes nuevos
  ['blue', 'red'].forEach(side => {
    const t = state.sideTeams[side];
    if (!t) return;
    const add = (roster[side] || []).filter(p => p && !(state.teamBind[t] || []).includes(p));
    if (add.length) state.teamBind[t] = [...(state.teamBind[t] || []), ...add];
  });
  return changed;
}
function rebuildHistoryView() {
  const view = { blue: [], red: [] };
  ['blue', 'red'].forEach(side => {
    // Prioridad: sideTeams → info → clave genérica del lado
    const t = (state.sideTeams && state.sideTeams[side])
           || (state.info && state.info[side])
           || side;
    view[side] = [...new Set(state.histTeams[t] || [])];
  });
  state.history = view;
}

// ========== LCU: selección automática desde el cliente de LoL ==========
const LOCK_PATHS = [
  'F:\\Riot\\Riot Games\\League of Legends\\lockfile',
  'C:\\Riot Games\\League of Legends\\lockfile',
  'D:\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files\\Riot Games\\League of Legends\\lockfile'
];
const lcu = { timer: null, prev: new Map(), roles: new Map(), roster: null, champMap: null, lastTimerSec: null, timerBase: null, lastPhase: null };
const ROLE_ORDER_SRV = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

function findLockfile() {
  for (const p of LOCK_PATHS) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}
function lcuGet(port, pass, apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: '127.0.0.1', port, path: apiPath,
      headers: { Authorization: 'Basic ' + Buffer.from(`riot:${pass}`).toString('base64') },
      agent: new https.Agent({ rejectUnauthorized: false })
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
    req.on('error', reject); req.end();
  });
}
function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function loadChampMap() {
  const versions = await httpsGetJson('https://ddragon.leagueoflegends.com/api/versions.json');
  const data = await httpsGetJson(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`);
  const map = {};
  Object.values(data.data).forEach(c => { map[parseInt(c.key)] = c.name; });
  lcu.champMap = map;
  console.log(`LCU: mapa de campeones cargado (${Object.keys(map).length})`);
}
let lastLcuState = '';
function lcuState(s) { if (s !== lastLcuState) { lastLcuState = s; console.log(s); } }

function updatePickRole(team, champion, role) {
  const pick = [...state.picks].reverse().find(p => p.team === team && p.champion === champion);
  if (!pick || pick.role === role) return false;
  pick.role = role;
  return true;
}

async function lcuTick() {
  const lock = findLockfile();
  if (!lock) { lcuState('LCU: esperando cliente de LoL (lockfile no encontrado)...'); return; }
  const parts = fs.readFileSync(lock, 'utf8').split(':');
  const port = parts[2], pass = parts[3];
  let session;
  try { session = await lcuGet(port, pass, '/lol-champ-select/v1/session'); }
  catch (e) { lcuState('LCU: error de conexión — ' + e.message); return; }
  if (!session || !Array.isArray(session.actions)) {
    lcuState('LCU: conectado — esperando champ select...');
    if (lcu.lastTimerSec !== null) { lcu.lastTimerSec = null; broadcast({ type: 'timer', data: null }); }
    return;
  }
  lcuState('LCU: ¡EN CHAMP SELECT! monitoreando...');

  const current = new Map();
  for (const set of session.actions) {
    for (const a of set) {
      if (a.completed && a.championId) current.set(a.id, { type: a.type, championId: a.championId, cell: a.actorCellId });
    }
  }
  if (current.size === 0) { lcu.prev = new Map(); lcu.roles = new Map(); } // draft nuevo: resetea, pero sigue (timer/roster)

  const cellPlayer = {};
  [...(session.myTeam || []), ...(session.theirTeam || [])].forEach(p => {
    cellPlayer[p.cellId] = p.gameName;
  });

  let draftStateChanged = false;
  for (const [id, a] of current) {
    if (lcu.prev.has(id) || !lcu.champMap) continue;
    const name = lcu.champMap[a.championId];
    if (!name) continue;
    const entry = { type: a.type, team: a.cell < 5 ? 'blue' : 'red', champion: name, auto: true };
    const slot = a.cell < 5 ? a.cell : a.cell - 5;
    entry.role = ROLE_ORDER_SRV[slot];
    if (cellPlayer[a.cell]) entry.player = cellPlayer[a.cell];
    state[a.type === 'ban' ? 'bans' : 'picks'].push(entry);
    draftStateChanged = true;
    broadcast(entry);
    console.log(`LCU → ${a.type.toUpperCase()} ${entry.team}: ${name}`);
  }
  lcu.prev = current;

  // Movimientos (swap): el campeón va al slot fijo del jugador
  [...(session.myTeam || []), ...(session.theirTeam || [])].forEach(p => {
    if (!p.championId || !lcu.champMap || !lcu.champMap[p.championId]) return;
    const slot = p.cellId < 5 ? p.cellId : p.cellId - 5;
    const now = { champ: lcu.champMap[p.championId], role: ROLE_ORDER_SRV[slot] };
    const prev = lcu.roles.get(p.cellId);
    if (!prev || prev.champ !== now.champ) {
      lcu.roles.set(p.cellId, now);
      const team = p.cellId < 5 ? 'blue' : 'red';
      if (updatePickRole(team, now.champ, now.role)) draftStateChanged = true;
      broadcast({ type: 'role', team, champion: now.champ, role: now.role });
      console.log(`LCU → ${now.champ} se mueve al slot ${slot} (${now.role})`);
    }
  });

  // Roster de la sala: nombres + usados fearless siguen a los EQUIPOS aunque cambien de lado
  const roster = { blue: ['', '', '', '', ''], red: ['', '', '', '', ''] };
  [...(session.myTeam || []), ...(session.theirTeam || [])].forEach(p => {
    const i = p.cellId < 5 ? p.cellId : p.cellId - 5;
    roster[p.cellId < 5 ? 'blue' : 'red'][i] = p.gameName || '';
  });
  if (JSON.stringify(roster) !== JSON.stringify(lcu.roster)) {
    lcu.roster = roster;
    state.roster = roster;
    const namesSwapped = reassignTeams(); // PRIMERO detectar el cambio de lado con los vínculos viejos
    ensureTeamBinds();                    // DESPUÉS extender vínculos (suplentes) con el lado ya corregido
    rebuildHistoryView();
    broadcast({ type: 'history', data: state.history });
    if (namesSwapped) {
      broadcast({ type: 'info', data: state.info });
      broadcast({ type: 'score', data: state.score });
      console.log(`LCU → equipos cambiados de lado: ${state.sideTeams.blue} (blue) vs ${state.sideTeams.red} (red)`);
    }
    broadcast({ type: 'roster', data: roster });
    draftStateChanged = true;
  }
  if (draftStateChanged) saveDraftState();

  // Timer: se calcula localmente (el LCU entrega valores congelados entre acciones)
  const t = session.timer;
  if (t && t.phase === 'FINALIZATION' && lcu.lastPhase !== 'FINALIZATION') {
    lcu.lastPhase = 'FINALIZATION';
    broadcast({ type: 'draftend' });
  }
  if (t && t.phase !== 'FINALIZATION') lcu.lastPhase = t.phase;
  if (t && typeof t.adjustedTimeLeftInPhase === 'number') {
    lcu.timerBase = { leftMs: t.adjustedTimeLeftInPhase, epoch: t.internalNowInEpochMs || Date.now(), total: t.totalTimeInPhase || 30000 };
  }
  if (lcu.timerBase) {
    const remain = lcu.timerBase.leftMs - (Date.now() - lcu.timerBase.epoch);
    const sec = Math.max(0, Math.ceil(remain / 1000));
    if (sec !== lcu.lastTimerSec) {
      lcu.lastTimerSec = sec;
      let team = null, act = null;
      for (const set of session.actions) {
        for (const a of set) {
          if (!a.completed) { team = a.actorCellId < 5 ? 'blue' : 'red'; act = a.type; break; }
        }
        if (team) break;
      }
      broadcast({ type: 'timer', data: { left: sec, total: Math.max(1, Math.round(lcu.timerBase.total / 1000)), phase: t ? t.phase : '', team, act } });
    }
  } else if (lcu.lastTimerSec !== null) {
    lcu.lastTimerSec = null;
    broadcast({ type: 'timer', data: null });
  }
}

function lcuStart() {
  if (lcu.timer) return;
  loadChampMap().catch(e => console.log('LCU mapa error:', e.message));
  lcu.timer = setInterval(lcuTick, 1000);
  console.log('LCU: monitoreo iniciado');
}
function lcuStop() {
  clearInterval(lcu.timer); lcu.timer = null;
  lcu.prev = new Map(); lcu.roles = new Map(); lcu.lastTimerSec = null;
  console.log('LCU: monitoreo detenido');
}
// =======================================================================

// Estado que consume SyBIngame. El draft sigue siendo la fuente principal.
app.get('/series-state', (req, res) => {
  res.json({ info: state.info, score: state.score, sideTeams: state.sideTeams, revision: seriesRevision });
});

// Diagnóstico público local: cantidades y estado, sin lockfile ni credenciales.
app.get('/draft-status', (req, res) => {
  const clients = [...wss.clients].filter(client => client.readyState === 1);
  res.json({
    webSocketClients: clients.length,
    overlayClients: clients.filter(client => client.clientRole === 'overlay').length,
    panelClients: clients.filter(client => client.clientRole === 'panel').length,
    lcuActive: Boolean(lcu.timer),
    lcuState: lastLcuState || 'Automático detenido'
  });
});

function applyPendingWinners() {
  if (!pendingWinners.size) return false;
  const current = state.score && typeof state.score === 'object'
    ? state.score
    : { format: 'BO1', blue: 0, red: 0 };
  const format = ['BO1', 'BO3', 'BO5'].includes(current.format) ? current.format : 'BO1';
  const score = {
    format,
    blue: Math.max(0, Math.floor(Number(current.blue) || 0)),
    red: Math.max(0, Math.floor(Number(current.red) || 0))
  };
  const maxWins = format === 'BO5' ? 3 : format === 'BO3' ? 2 : 1;
  for (const [gameId, winner] of pendingWinners) {
    if (score[winner] < maxWins) score[winner] += 1;
    countedGames.add(gameId);
  }
  pendingWinners.clear();
  state.score = score;
  return true;
}

function notifySeriesControl(reason) {
  control.emit('series-control', {
    reason,
    info: state.info,
    score: state.score,
    sideTeams: state.sideTeams,
    revision: seriesRevision
  });
}

const PRESET_FIELDS = ['tournament', 'blue', 'red', 'blueShort', 'redShort', 'blueLogo', 'redLogo'];
function normalizePresetData(source) {
  const input = source && typeof source === 'object' ? source : {};
  const data = {};
  PRESET_FIELDS.forEach(field => {
    const limit = field.endsWith('Short') ? 5 : field.endsWith('Logo') ? 2048 : 120;
    data[field] = String(input[field] || '').trim().slice(0, limit);
    if (field.endsWith('Short')) data[field] = data[field].toUpperCase();
  });
  return data;
}

app.get('/api/presets', (req, res) => {
  const ordered = [...presets].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  res.json({ presets: ordered });
});

app.post('/api/presets', express.json({ limit: '32kb' }), (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Escribe un nombre para el preset' });
  const existing = presets.find(p => p.name.toLowerCase() === name.toLowerCase());
  const preset = {
    id: existing?.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    data: normalizePresetData(req.body?.data),
    updatedAt: new Date().toISOString()
  };
  if (existing) Object.assign(existing, preset);
  else presets.push(preset);
  if (!savePresets()) return res.status(500).json({ error: 'No se pudo escribir el archivo de presets' });
  res.status(existing ? 200 : 201).json({ ok: true, preset, updated: Boolean(existing) });
});

app.delete('/api/presets/:id', (req, res) => {
  const index = presets.findIndex(p => p.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'El preset ya no existe' });
  const [removed] = presets.splice(index, 1);
  if (!savePresets()) return res.status(500).json({ error: 'No se pudo actualizar el archivo de presets' });
  // Los archivos de logos se conservan: pueden seguir usándose en otros presets o en el overlay actual.
  res.json({ ok: true, removed: { id: removed.id, name: removed.name } });
});

app.post('/api/team-logo/:side', express.raw({ type: 'image/*', limit: '8mb' }), (req, res) => {
  const side = req.params.side;
  if (!['blue', 'red'].includes(side)) return res.status(400).json({ error: 'Lado inválido' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Imagen vacía o tipo no admitido' });
  const extensions = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/svg+xml': '.svg'
  };
  const extension = extensions[String(req.get('content-type')).split(';')[0].toLowerCase()];
  if (!extension) return res.status(415).json({ error: 'Usa PNG, JPG, WEBP, GIF o SVG' });
  const filename = `${side}-${Date.now()}${extension}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.body);
  res.status(201).json({ url: `/uploads/${filename}` });
});

app.post('/series/game-winner', express.json({ limit: '32kb' }), (req, res) => {
  const gameId = String(req.body?.gameId || '').trim();
  const winner = req.body?.winner;
  if (!gameId || !['blue', 'red'].includes(winner)) {
    return res.status(400).json({ error: 'Se requieren gameId y winner=blue|red' });
  }
  // Un reporte que terminó de viajar después de limpiar pertenece a la partida vieja.
  if (Number.isInteger(req.body?.revision) && req.body.revision !== seriesRevision) {
    return res.json({ ok: true, stale: true, pending: false, score: state.score });
  }
  if (pendingWinners.has(gameId) || countedGames.has(gameId)) {
    return res.json({ ok: true, duplicate: true, pending: pendingWinners.has(gameId), score: state.score });
  }

  // No se modifica el marcador al terminar: el punto aparece con «Siguiente juego».
  pendingWinners.set(gameId, winner);
  saveDraftState();
  console.log(`Victoria ${winner} pendiente | juego=${gameId} | se aplicará al pulsar Siguiente juego`);
  res.json({ ok: true, pending: true, counted: false, duplicate: false, score: state.score });
});

wss.on('connection', (ws, request) => {
  try {
    ws.clientRole = new URL(request.url, 'http://localhost').searchParams.get('client') || 'unknown';
  } catch {
    ws.clientRole = 'unknown';
  }
  ws.send(JSON.stringify({ type: 'init', state }));
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'pick') state.picks.push(msg);
    if (msg.type === 'ban') state.bans.push(msg);
    if (msg.type === 'info') {
      const prev = state.sideTeams;
      state.info = msg.data;
      if (state.info && state.info.blue && state.info.red) {
        if (prev) {
          // renombrar claves si el operador editó los nombres a media serie
          ['blue', 'red'].forEach(side => {
            const o = prev[side], n = state.info[side];
            if (o && n && o !== n && state.histTeams[o]) {
              state.histTeams[n] = state.histTeams[o];
              delete state.histTeams[o];
            }
          });
        }
        // Siempre sincronizar sideTeams con info (cubre el caso sin LCU)
        state.sideTeams = { blue: state.info.blue, red: state.info.red };
      }
      ensureTeamBinds();
      rebuildHistoryView();
    }
    if (msg.type === 'score') state.score = msg.data;
    if (msg.type === 'lcu') {
      state.lcuEnabled = msg.action === 'start';
      msg.action === 'start' ? lcuStart() : lcuStop();
      saveDraftState();
      broadcast({ type: 'lcu-state', data: state.lcuEnabled });
      return;
    }
    if (msg.type === 'role') updatePickRole(msg.team, msg.champion, msg.role);
    if (msg.type === 'fearless') {
      state.fearless = msg.on;
      if (!msg.on) { state.histTeams = {}; rebuildHistoryView(); broadcast({ type: 'history', data: state.history }); }
    }
    if (msg.type === 'undo') {
      const list = msg.itype === 'ban' ? state.bans : state.picks;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].team === msg.team) { list.splice(i, 1); break; }
      }
    }
    if (msg.type === 'clear') {
      const scoreChanged = applyPendingWinners();
      seriesRevision += 1;
      const wipeRoster = state.fearless === false || (state.score && state.score.format === 'BO1');
      if (wipeRoster) {
        state.histTeams = {};
      } else {
        state.picks.forEach(p => {
          let team = null;
          // 1) Por jugador vinculado (LCU activo)
          if (p.player) team = Object.keys(state.teamBind).find(t => (state.teamBind[t] || []).includes(p.player));
          // 2) Por sideTeams (LCU detectó lado)
          if (!team && state.sideTeams) team = state.sideTeams[p.team];
          // 3) Fallback directo a info (sin LCU — el nombre del equipo viene del panel)
          if (!team && state.info) team = state.info[p.team];
          // 4) Último recurso: usar el lado como clave genérica
          if (!team) team = p.team;
          (state.histTeams[team] = state.histTeams[team] || []).push(p.champion);
        });
      }
      state = { picks: [], bans: [], info: state.info, score: state.score, roster: state.roster, history: state.history, histTeams: state.histTeams, teamBind: state.teamBind, sideTeams: state.sideTeams, fearless: state.fearless, lcuEnabled: state.lcuEnabled };
      rebuildHistoryView();
      broadcast({ type: 'history', data: state.history });
      if (scoreChanged) broadcast({ type: 'score', data: state.score });
      if (wipeRoster) {
        // BO1 / fearless OFF: el siguiente juego es con EQUIPOS DISTINTOS — limpiar nombres de jugadores
        state.roster = null;
        lcu.roster = null;
        broadcast({ type: 'roster', data: { blue: ['', '', '', '', ''], red: ['', '', '', '', ''] } });
      }
      notifySeriesControl('next-game');
    }
    if (msg.type === 'resetall') {
      state.picks = []; state.bans = []; state.score = null;
      countedGames.clear();
      pendingWinners.clear();
      seriesRevision += 1;
      state.histTeams = {}; state.teamBind = {}; state.sideTeams = null;
      state.roster = null; lcu.roster = null;
      rebuildHistoryView();
      broadcast({ type: 'history', data: state.history });
      broadcast({ type: 'score', data: null });
      broadcast({ type: 'roster', data: { blue: ['', '', '', '', ''], red: ['', '', '', '', ''] } });
      notifySeriesControl('reset-series');
    }
    saveDraftState();
    broadcast(msg);
  });
});

// Si AUTO estaba activado, el reinicio del servidor lo reanuda sin otra acción.
if (state.lcuEnabled) lcuStart();

return { wss };
};
