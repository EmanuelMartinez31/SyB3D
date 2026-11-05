// POSTPARTIDA · SERVIDOR LOCAL
// Captura estadísticas, conserva resúmenes, sincroniza el panel y controla OBS.
// El orden de las secciones sigue el recorrido: estado → LCU → captura → rutas.

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { normalizeEog, normalizeHistory, repairSummaryRoles } = require('./lib/normalize');
const { createDemoSummary } = require('./demo-summary');

// ============================================================================
// 1. CONFIGURACIÓN Y ESTADO EN MEMORIA
// El servidor principal llama a esta función y comparte app, eventos y puerto.
// latestSummary = último real; viewSummary = lo que OBS está viendo (real/demo).
// ============================================================================
module.exports = function setupPostgame({ app, control, port }) {
  const OVERLAY_DIR = path.join(__dirname, 'overlay');
  const DATA_DIR = path.join(__dirname, 'data');
  const HISTORY_DIR = path.join(DATA_DIR, 'history');
  const LATEST_PATH = path.join(DATA_DIR, 'latest-postgame.json');
  const DRAFT_ORIGIN = process.env.SYB_DRAFT_URL || `http://127.0.0.1:${port}`;
  const LOCK_PATHS = [
    process.env.SYB_LOL_LOCKFILE,
    'F:\\Riot\\Riot Games\\League of Legends\\lockfile',
    'C:\\Riot Games\\League of Legends\\lockfile',
    'D:\\Riot Games\\League of Legends\\lockfile',
    'C:\\Program Files\\Riot Games\\League of Legends\\lockfile'
  ].filter(Boolean);
  const wss = new WebSocketServer({ noServer: true });
  fs.mkdirSync(HISTORY_DIR, { recursive: true });

  let latestSummary = null;
  let viewSummary = null;
  let visible = false;
  let timer = null;
  let panelTimer = null;
  let panelRefreshInFlight = false;
  let panelInfo = null;
  let panelSideTeams = null;
  let panelSignature = '';
  let pollInFlight = false;
  let captureInFlight = false;
  let championMap = null;
  let previousPhase = '';
  let captureCycle = 0;
  let capturedCycle = -1;
  let capturePending = false;
  let nextCaptureAt = 0;
  let lastLogStatus = '';
  const status = {
    clientConnected: false,
    phase: '',
    capturing: false,
    lastError: null,
    lastCapturedAt: null,
    lastCapturedGameId: null,
    source: null
  };

  // ==========================================================================
  // 2. RECUPERACIÓN DEL ÚLTIMO RESUMEN
  // Se restaura al arrancar, pero permanece oculto hasta que el operador lo muestre.
  // ==========================================================================
  try {
    // Un resumen guardado con dos JUNGLE y sin UTILITY se corrige al cargarlo:
    // así la pantalla nunca muestra líneas repetidas aunque la captura sea vieja.
    const saved = repairSummaryRoles(JSON.parse(fs.readFileSync(LATEST_PATH, 'utf8')));
    if (saved?.teams?.blue?.players?.length === 5 && saved?.teams?.red?.players?.length === 5) {
      latestSummary = saved;
      viewSummary = saved;
      status.lastCapturedAt = saved.capturedAt || null;
      status.lastCapturedGameId = saved.gameId || null;
      status.source = saved.source || null;
      console.log(
        `Postpartida recuperado | juego=${saved.gameId || 'desconocido'} | oculto hasta que el operador lo muestre`
      );
    }
  } catch {}

  // ==========================================================================
  // 3. PRESENTACIÓN Y SINCRONIZACIÓN CON EL PANEL
  // Solo se sustituyen nombres, siglas, logos y torneo. Nunca las estadísticas.
  // ==========================================================================
  function summaryWithPanel(summary) {
    if (!summary || summary.demo || !panelInfo) return summary;
    return { ...summary, info: panelInfo, sideTeams: panelSideTeams || summary.sideTeams };
  }

  function publicState() {
    return {
      visible,
      summary: summaryWithPanel(viewSummary),
      isDemo: viewSummary?.demo === true,
      latestAvailable: latestSummary !== null,
      latestGameId: latestSummary?.gameId || null,
      webSocketClients: [...wss.clients].filter((client) => client.readyState === 1).length,
      status: { ...status }
    };
  }

  function broadcast() {
    const message = JSON.stringify({ type: 'postgame-state', data: publicState() });
    for (const client of wss.clients) if (client.readyState === 1) client.send(message);
  }

  function logStatus(message) {
    if (message === lastLogStatus) return;
    lastLogStatus = message;
    console.log(message);
  }

  async function refreshPanelInfo() {
    if (panelRefreshInFlight) return;
    panelRefreshInFlight = true;
    try {
      const series = await localJson(`${DRAFT_ORIGIN}/series-state`);
      if (!series?.info || typeof series.info !== 'object') return;
      const signature = JSON.stringify([series.info, series.sideTeams || null]);
      if (signature === panelSignature) return;
      panelSignature = signature;
      panelInfo = series.info;
      panelSideTeams = series.sideTeams || null;
      // Los datos deportivos del resumen se conservan; solo se actualiza la
      // presentación con los nombres, siglas, logos y torneo actuales del panel.
      broadcast();
    } catch {
    } finally {
      panelRefreshInFlight = false;
    }
  }

  // ==========================================================================
  // 4. CONEXIÓN LOCAL CON EL CLIENTE DE LOL
  // El lockfile solo se lee en memoria. Las peticiones LCU van a 127.0.0.1.
  // No se muestran contraseñas ni se utiliza LeagueBroadcast.
  // ==========================================================================
  function findLockfile() {
    for (const candidate of LOCK_PATHS) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {}
    }
    return null;
  }

  function readLockfile() {
    const filename = findLockfile();
    if (!filename) return null;
    // El contenido se usa solo en memoria para 127.0.0.1; nunca se guarda ni se registra.
    const parts = fs.readFileSync(filename, 'utf8').split(':');
    if (parts.length < 4) throw new Error('Lockfile local incompleto');
    return { port: parts[2], password: parts[3] };
  }

  function lcuGet(lock, apiPath) {
    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          host: '127.0.0.1',
          port: lock.port,
          path: apiPath,
          method: 'GET',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`riot:${lock.password}`).toString('base64')
          },
          agent: new https.Agent({ rejectUnauthorized: false })
        },
        (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            text += chunk;
            if (text.length > 12_000_000)
              request.destroy(new Error('Respuesta LCU demasiado grande'));
          });
          response.on('end', () => {
            let data = null;
            try {
              data = text ? JSON.parse(text) : null;
            } catch {
              return reject(new Error(`LCU devolvió JSON inválido (${apiPath})`));
            }
            if (response.statusCode < 200 || response.statusCode >= 300) {
              return reject(new Error(`LCU HTTP ${response.statusCode} en ${apiPath}`));
            }
            resolve(data);
          });
        }
      );
      request.setTimeout(3500, () =>
        request.destroy(new Error(`LCU agotó el tiempo en ${apiPath}`))
      );
      request.on('error', reject);
      request.end();
    });
  }

  // ==========================================================================
  // 5. CATÁLOGOS Y DATOS DEL PANEL
  // Data Dragon proporciona nombres de campeones; si falla, se usa el catálogo LCU.
  // ==========================================================================
  function httpsJson(url) {
    return new Promise((resolve, reject) => {
      const request = https.get(url, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error('Catálogo de campeones inválido'));
          }
        });
      });
      request.setTimeout(5000, () =>
        request.destroy(new Error('Catálogo de campeones no respondió'))
      );
      request.on('error', reject);
    });
  }

  function localJson(url) {
    return new Promise((resolve, reject) => {
      const request = http.get(url, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error('Respuesta local inválida'));
          }
        });
      });
      request.setTimeout(2000, () => request.destroy(new Error('El panel de serie no respondió')));
      request.on('error', reject);
    });
  }

  async function getSeriesState() {
    try {
      return await localJson(`${DRAFT_ORIGIN}/series-state`);
    } catch {
      return { info: null, score: null, sideTeams: null };
    }
  }

  async function getChampionMap(lock) {
    if (championMap) return championMap;
    // Prioriza los mismos nombres en inglés que ya utiliza la biblioteca GLB del draft.
    try {
      const versions = await httpsJson('https://ddragon.leagueoflegends.com/api/versions.json');
      const data = await httpsJson(
        `https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`
      );
      championMap = new Map(
        Object.values(data.data || {}).map((champion) => [
          Number(champion.key),
          { name: champion.name, alias: champion.id }
        ])
      );
      return championMap;
    } catch {}
    // Respaldo local: no depende de Internet y conserva el alias interno del campeón.
    const local = await lcuGet(lock, '/lol-game-data/assets/v1/champion-summary.json');
    if (!Array.isArray(local) || !local.length)
      throw new Error('No se pudo cargar el catálogo de campeones');
    championMap = new Map(
      local
        .filter((champion) => Number.isFinite(champion.id))
        .map((champion) => [
          champion.id,
          { name: champion.name || champion.alias, alias: champion.alias || champion.name }
        ])
    );
    return championMap;
  }

  // ==========================================================================
  // 6. IDENTIFICACIÓN DE UNA PARTIDA OBSERVADA
  // SyBSensor aporta GameId y duración aunque el operador no sea jugador.
  // matchHistoryId() separa LA1-1759132007 → 1759132007 solo para la consulta.
  // ==========================================================================
  function observedGameContext(game) {
    const gameId = game?.GameId ?? game?.meta?.gameId ?? null;
    if (gameId === null || gameId === undefined || gameId === '') return null;
    return {
      gameId,
      gameDuration: game?.GameTime ?? game?.meta?.gameTime ?? null,
      gameCreation: null
    };
  }

  function matchHistoryId(gameId) {
    const value = String(gameId ?? '').trim();
    // Farsight entrega, por ejemplo, LA1-1759132007; esta ruta LCU espera
    // únicamente la parte numérica. El resumen conserva el GameId original.
    const prefixed = /^[A-Za-z0-9]+-(\d+)$/.exec(value);
    return prefixed ? prefixed[1] : value;
  }

  async function getObservedGameContext() {
    // El sensor identifica también las personalizadas observadas, aunque el
    // operador no sea participante y la partida no aparezca en su historial.
    try {
      const state = await localJson(`${DRAFT_ORIGIN}/ingame`);
      const observed = observedGameContext(state);
      if (observed) return observed;
    } catch {}
    try {
      const saved = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, '..', 'ingame', 'data', 'latest-gameinfo.json'),
          'utf8'
        )
      );
      return observedGameContext(saved);
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // 7. CAPTURA Y PERSISTENCIA
  // Se intentan primero las estadísticas EOG y después el historial directo.
  // El último resumen se escribe atómicamente y cada partida tiene su historial.
  // ==========================================================================
  function requestCapture() {
    if (!capturePending) captureCycle += 1;
    capturePending = true;
    nextCaptureAt = 0;
  }

  async function persistSummary(summary) {
    const json = JSON.stringify(summary, null, 2);
    const temp = `${LATEST_PATH}.tmp`;
    await fs.promises.writeFile(temp, json);
    await fs.promises.rename(temp, LATEST_PATH);
    const safeId = String(summary.gameId || Date.now())
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 80);
    await fs.promises.writeFile(path.join(HISTORY_DIR, `${safeId}.json`), json);
  }

  async function captureSummary() {
    if (captureInFlight) throw new Error('Ya hay una captura en curso');
    captureInFlight = true;
    status.capturing = true;
    status.lastError = null;
    broadcast();
    try {
      const lock = readLockfile();
      if (!lock) throw new Error('No se encontró el cliente de LoL');
      const [champions, series, gameflow, observed] = await Promise.all([
        getChampionMap(lock),
        getSeriesState(),
        lcuGet(lock, '/lol-gameflow/v1/session').catch(() => null),
        getObservedGameContext()
      ]);
      const context = {
        championMap: champions,
        series,
        gameId: gameflow?.gameData?.gameId ?? observed?.gameId,
        gameDuration: gameflow?.gameData?.gameTime ?? observed?.gameDuration,
        gameCreation: gameflow?.gameData?.gameCreation ?? observed?.gameCreation
      };
      const errors = [];
      let discoveredGameId = context.gameId || null;
      for (const [endpoint, source] of [
        ['/lol-end-of-game/v1/eog-stats-block', 'lcu-end-of-game'],
        ['/lol-end-of-game/v1/gameclient-eog-stats-block', 'lcu-gameclient-end-of-game']
      ]) {
        try {
          const data = await lcuGet(lock, endpoint);
          discoveredGameId =
            discoveredGameId || data?.gameId || data?.gameID || data?.game?.gameId || null;
          const summary = normalizeEog(data, { ...context, gameId: discoveredGameId, source });
          if (summary) return await acceptSummary(summary);
          errors.push(`${endpoint}: no contiene 5 jugadores por equipo`);
        } catch (error) {
          errors.push(error.message);
        }
      }
      if (discoveredGameId) {
        try {
          const history = await lcuGet(
            lock,
            `/lol-match-history/v1/games/${encodeURIComponent(matchHistoryId(discoveredGameId))}`
          );
          const summary = normalizeHistory(history, { ...context, gameId: discoveredGameId });
          if (summary) return await acceptSummary(summary);
          errors.push('Historial: no contiene 5 jugadores por equipo');
        } catch (error) {
          errors.push(error.message);
        }
      }
      if (!discoveredGameId)
        errors.push('No se encontró GameId en Gameflow ni en los datos de SyBSensor');
      throw new Error(errors.join(' | '));
    } catch (error) {
      status.lastError = error.message;
      throw error;
    } finally {
      captureInFlight = false;
      status.capturing = false;
      broadcast();
    }
  }

  // Un resumen válido se guarda, se muestra y completa la captura pendiente.
  async function acceptSummary(summary) {
    await persistSummary(summary);
    latestSummary = summary;
    viewSummary = summary;
    visible = true;
    status.lastCapturedAt = summary.capturedAt;
    status.lastCapturedGameId = summary.gameId;
    status.source = summary.source;
    status.lastError = null;
    capturedCycle = captureCycle;
    capturePending = false;
    console.log(
      `Resumen postpartida guardado y mostrado | juego=${summary.gameId} | fuente=${summary.source}`
    );
    broadcast();
    return summary;
  }

  // ==========================================================================
  // 8. DETECCIÓN AUTOMÁTICA Y REINTENTOS
  // EndOfGame y el nexo destruido activan la captura. Los reintentos continúan
  // aunque LCU pase a None o Lobby mientras las estadísticas terminan de generarse.
  // ==========================================================================
  async function poll() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const lock = readLockfile();
      if (!lock) {
        status.clientConnected = false;
        status.phase = '';
        logStatus('Postpartida LCU: esperando cliente de LoL...');
        return;
      }
      const phase = String((await lcuGet(lock, '/lol-gameflow/v1/gameflow-phase')) || '');
      status.clientConnected = true;
      status.phase = phase;
      logStatus(`Postpartida LCU: conectado | fase=${phase || 'desconocida'}`);
      if (phase !== previousPhase) {
        if (phase === 'EndOfGame') {
          requestCapture();
          console.log('Fin de partida detectado; preparando estadísticas...');
        }
        previousPhase = phase;
      }
      // También continúa en None/Lobby: una personalizada observada puede no
      // producir una fase EndOfGame en LCU y las estadísticas pueden tardar.
      if (capturePending && capturedCycle !== captureCycle && Date.now() >= nextCaptureAt) {
        nextCaptureAt = Date.now() + 5000;
        try {
          await captureSummary();
          capturedCycle = captureCycle;
        } catch (error) {
          logStatus(`Postpartida pendiente; reintento automático en 5 s (${error.message})`);
        }
      }
    } catch (error) {
      status.clientConnected = false;
      status.lastError = error.message;
      logStatus(`Postpartida LCU: ${error.message}`);
    } finally {
      pollInFlight = false;
    }
  }

  // ==========================================================================
  // 9. RUTAS HTTP Y CONTROLES
  // /state lo consulta la pantalla, /demo genera datos ficticios, /models lista
  // los GLB y /control recibe mostrar, ocultar, demo, último real y capturar.
  // ==========================================================================
  app.use('/postgame', express.static(OVERLAY_DIR));
  app.get('/postgame/api/state', (req, res) => res.json(publicState()));
  app.get('/postgame/api/demo', (req, res) => res.json(createDemoSummary()));
  app.get('/postgame/api/models', (req, res) => {
    const roots = [
      path.join(__dirname, '..', 'draft', 'models'),
      path.join(__dirname, '..', '..', 'SyB3D', 'models')
    ];
    const root = roots.find((candidate) => fs.existsSync(candidate));
    if (!root) return res.json({ files: [] });
    const files = fs.readdirSync(root).filter((file) => file.toLowerCase().endsWith('.glb'));
    res.json({ files });
  });
  // Ajuste de tamaño por campeón. El operador lo fija desde
  // ajustar-modelos.html y se guarda en data/scale-fix.json. La pantalla lo
  // aplica encima del encuadre automático, así un modelo que salga pequeño o
  // grande se corrige sin tocar el código.
  const SCALE_PATH = path.join(DATA_DIR, 'scale-fix.json');
  // El archivo guarda { scaleFix: { campeón: multiplicador }, updatedAt }.
  // Aquí se devuelve SOLO el mapa de campeones: la pantalla espera
  // { campeón: multiplicador } y antes recibía el objeto entero anidado, así que
  // no encontraba ningún campeón y el ajuste solo funcionaba por el navegador.
  function leerAjustesEscala() {
    try {
      const datos = JSON.parse(fs.readFileSync(SCALE_PATH, 'utf8'));
      if (!datos || typeof datos !== 'object') return {};
      const mapa = datos.scaleFix && typeof datos.scaleFix === 'object' ? datos.scaleFix : datos;
      const limpio = {};
      for (const [campeon, valor] of Object.entries(mapa)) {
        if (campeon === 'updatedAt' || campeon === 'scaleFix') continue;
        const numero = Number(valor);
        if (Number.isFinite(numero) && numero > 0.2 && numero < 5) limpio[campeon] = numero;
      }
      return limpio;
    } catch {
      return {};
    }
  }
  app.get('/postgame/api/scale-fix', (req, res) => res.json({ scaleFix: leerAjustesEscala() }));
  app.post('/postgame/api/scale-fix', express.json({ limit: '16kb' }), (req, res) => {
    const entrada = req.body?.scaleFix;
    if (!entrada || typeof entrada !== 'object') {
      return res.status(400).json({ error: 'Se esperaba { scaleFix: { campeón: multiplicador } }' });
    }
    const limpio = {};
    for (const [campeon, valor] of Object.entries(entrada)) {
      const numero = Number(valor);
      if (!Number.isFinite(numero) || numero < 0.2 || numero > 5) continue;
      limpio[String(campeon).slice(0, 40)] = Number(numero.toFixed(3));
    }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SCALE_PATH, JSON.stringify({ scaleFix: limpio, updatedAt: new Date().toISOString() }, null, 2));
      broadcast();
      res.json({ ok: true, scaleFix: limpio });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  app.post('/postgame/api/control', express.json({ limit: '16kb' }), async (req, res) => {
    const action = req.body?.action;
    try {
      if (action === 'show') {
        if (!viewSummary && latestSummary) viewSummary = latestSummary;
        if (!viewSummary)
          return res.status(404).json({ error: 'Todavía no hay un resumen guardado' });
        visible = true;
      } else if (action === 'hide') visible = false;
      else if (action === 'demo') {
        viewSummary = createDemoSummary();
        visible = true;
      } else if (action === 'latest') {
        if (!latestSummary)
          return res.status(404).json({ error: 'Todavía no hay un resumen real guardado' });
        viewSummary = latestSummary;
        visible = true;
      } else if (action === 'recapture') {
        await captureSummary();
        return res.json({ ok: true, state: publicState() });
      } else return res.status(400).json({ error: 'Acción no admitida' });
      broadcast();
      res.json({ ok: true, state: publicState() });
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message, state: publicState() });
    }
  });

  // ==========================================================================
  // 10. WEBSOCKET, EVENTOS COMPARTIDOS Y ARRANQUE
  // El nexo destruido llega desde ingame/server.js; no se modifica SyBSensor.
  // ==========================================================================
  wss.on('connection', (ws) =>
    ws.send(JSON.stringify({ type: 'postgame-init', data: publicState() }))
  );

  // La limpieza del ingame no modifica latestSummary, viewSummary ni el archivo guardado.
  control.on('series-control', () => {
    void refreshPanelInfo();
    broadcast();
  });
  control.on('ingame-game-ended', (result) => {
    if (result?.gameId === null || result?.gameId === undefined) return;
    requestCapture();
    console.log(`Nexo destruido en la partida observada ${result.gameId}; preparando resumen...`);
  });

  return {
    wss,
    start() {
      if (timer) return;
      timer = setInterval(poll, 2000);
      timer.unref();
      panelTimer = setInterval(refreshPanelInfo, 1000);
      panelTimer.unref();
      void refreshPanelInfo();
      void poll();
    }
  };
};
