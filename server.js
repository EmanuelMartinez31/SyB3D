const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/models', express.static(path.join(__dirname, 'models')));

let state = {
  picks: [], bans: [], info: null, score: null, roster: null,
  history: { blue: [], red: [] },
  histTeams: {},     // nombreEquipo -> [campeones usados] (fearless por EQUIPO)
  teamBind: {},      // nombreEquipo -> [jugadores que lo identifican]
  sideTeams: null,   // lado -> nombreEquipo (se recalcula con cada nueva sala)
  fearless: true
};
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
  if (changed && state.info) state.info = { ...state.info, blue: state.sideTeams.blue, red: state.sideTeams.red };
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
    const t = state.sideTeams && state.sideTeams[side];
    view[side] = t ? [...new Set(state.histTeams[t] || [])] : [];
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

  for (const [id, a] of current) {
    if (lcu.prev.has(id) || !lcu.champMap) continue;
    const name = lcu.champMap[a.championId];
    if (!name) continue;
    const entry = { type: a.type, team: a.cell < 5 ? 'blue' : 'red', champion: name, auto: true };
    const slot = a.cell < 5 ? a.cell : a.cell - 5;
    entry.role = ROLE_ORDER_SRV[slot];
    if (cellPlayer[a.cell]) entry.player = cellPlayer[a.cell];
    state[a.type === 'ban' ? 'bans' : 'picks'].push(entry);
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
      broadcast({ type: 'role', team: p.cellId < 5 ? 'blue' : 'red', champion: now.champ, role: now.role });
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
    ensureTeamBinds(); // DESPUÉS extender vínculos (suplentes) con el lado ya corregido
    rebuildHistoryView();
    broadcast({ type: 'history', data: state.history });
    if (namesSwapped) { broadcast({ type: 'info', data: state.info }); console.log(`LCU → equipos cambiados de lado: ${state.sideTeams.blue} (blue) vs ${state.sideTeams.red} (red)`); }
    broadcast({ type: 'roster', data: roster });
  }

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

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', state }));
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'pick') state.picks.push(msg);
    if (msg.type === 'ban') state.bans.push(msg);
    if (msg.type === 'info') {
      const prev = state.sideTeams;
      state.info = msg.data;
      if (prev && state.info) {
        // renombrar claves si el operador editó los nombres a media serie
        ['blue', 'red'].forEach(side => {
          const o = prev[side], n = state.info[side];
          if (o && n && o !== n && state.histTeams[o]) {
            state.histTeams[n] = state.histTeams[o];
            delete state.histTeams[o];
          }
        });
        state.sideTeams = { blue: state.info.blue, red: state.info.red };
      }
      ensureTeamBinds();
    }
    if (msg.type === 'score') state.score = msg.data;
    if (msg.type === 'lcu') { msg.action === 'start' ? lcuStart() : lcuStop(); return; }
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
      const wipeRoster = state.fearless === false || (state.score && state.score.format === 'BO1');
      if (wipeRoster) {
        state.histTeams = {};
      } else {
        state.picks.forEach(p => {
          let team = null;
          if (p.player) team = Object.keys(state.teamBind).find(t => (state.teamBind[t] || []).includes(p.player));
          if (!team && state.sideTeams) team = state.sideTeams[p.team];
          if (team) (state.histTeams[team] = state.histTeams[team] || []).push(p.champion);
        });
      }
      state = { picks: [], bans: [], info: state.info, score: state.score, roster: state.roster, history: state.history, histTeams: state.histTeams, teamBind: state.teamBind, sideTeams: state.sideTeams, fearless: state.fearless };
      rebuildHistoryView();
      broadcast({ type: 'history', data: state.history });
      if (wipeRoster) {
        // BO1 / fearless OFF: el siguiente juego es con EQUIPOS DISTINTOS — limpiar nombres de jugadores
        state.roster = null;
        lcu.roster = null;
        broadcast({ type: 'roster', data: { blue: ['', '', '', '', ''], red: ['', '', '', '', ''] } });
      }
    }
        if (msg.type === 'resetall') {
      state.picks = []; state.bans = []; state.score = null;
      state.histTeams = {}; state.teamBind = {}; state.sideTeams = null;
      state.roster = null; lcu.roster = null;
      rebuildHistoryView();
      broadcast({ type: 'history', data: state.history });
      broadcast({ type: 'score', data: null });
      broadcast({ type: 'roster', data: { blue: ['', '', '', '', ''], red: ['', '', '', '', ''] } });
    }
    broadcast(msg);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Listo: panel -> http://localhost:${PORT}  |  overlay -> http://localhost:${PORT}/overlay.html`));
