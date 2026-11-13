// POSTPARTIDA · SERIE DE ORO
// El ingame graba una muestra del oro total de cada héroe cada 15 s de partida
// (ingame/data/gold-series.json y una copia por partida). Aquí se busca la serie
// de ese partido y se coloca en el mismo orden que las tarjetas del resumen, para
// que la pantalla solo tenga que pintar. Si no hay serie, el resumen se guarda
// igual y la gráfica no aparece: nunca se inventan valores.

const fs = require('fs');
const path = require('path');

const ROLE_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const INGAME_DATA = path.join(__dirname, '..', '..', 'ingame', 'data');
const GOLD_SERIES_LATEST = path.join(INGAME_DATA, 'gold-series.json');
const GOLD_SERIES_DIR = path.join(INGAME_DATA, 'gold-series');

// El ingame nombra las líneas top/jungle/mid/bot/support y el resumen
// TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY: aquí se habla siempre el del resumen.
const ROLE_ALIASES = {
  TOP: 'TOP', JUNGLE: 'JUNGLE', MID: 'MIDDLE', MIDDLE: 'MIDDLE',
  BOT: 'BOTTOM', BOTTOM: 'BOTTOM', ADC: 'BOTTOM',
  SUPPORT: 'UTILITY', UTILITY: 'UTILITY', SUP: 'UTILITY'
};

function normalRole(value) {
  return ROLE_ALIASES[String(value || '').trim().toUpperCase()] || null;
}

function normalSide(player) {
  const lado = String(player?.side || '').toLowerCase();
  if (lado === 'blue' || lado === 'order') return 'blue';
  if (lado === 'red' || lado === 'chaos') return 'red';
  if (player?.team === 1) return 'blue';
  if (player?.team === 2) return 'red';
  return null;
}

function roleWeight(player) {
  const index = ROLE_ORDER.indexOf(normalRole(player?.role));
  return index < 0 ? 99 : index;
}

function championKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readGoldSeries(gameId, gameDuration) {
  const seguro = String(gameId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
  const rutas = seguro
    ? [path.join(GOLD_SERIES_DIR, `${seguro}.json`), GOLD_SERIES_LATEST]
    : [GOLD_SERIES_LATEST];
  for (const ruta of rutas) {
    try {
      const serie = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      if (!Array.isArray(serie?.times) || serie.times.length < 2) continue;
      const mismoJuego = !gameId || !serie.gameId || String(serie.gameId) === String(gameId);
      // Sin GameId coincidente se acepta si la duración encaja: es la partida
      // que se acaba de jugar y el operador no siempre tiene el mismo id.
      const duracionParecida =
        typeof gameDuration === 'number' &&
        typeof serie.duration === 'number' &&
        Math.abs(serie.duration - gameDuration) <= 120;
      if (!mismoJuego && !duracionParecida) continue;
      return serie;
    } catch {}
  }
  return null;
}

// Devuelve la serie ordenada como las tarjetas del resumen (blue[i] con el
// jugador i del equipo azul) o null si no hay nada que dibujar.
function goldSeriesForCards(serie, summary) {
  if (!serie?.times?.length || !summary?.teams?.blue || !summary?.teams?.red) return null;
  const resultado = {
    step: serie.step || 15,
    times: serie.times.slice(),
    duration: serie.duration || 0,
    blue: [],
    red: []
  };
  // La serie puede venir del ingame (players con su lado) o ya ordenada por
  // lados (blue/red), como la de la demostración. Las dos formas valen.
  const deLaSerie = Array.isArray(serie.players)
    ? serie.players
    : ['blue', 'red'].flatMap(side =>
        (serie[side] || []).map(player => ({ ...player, side }))
      );
  const usados = new Set();
  for (const side of ['blue', 'red']) {
    const delLado = deLaSerie.filter(player => normalSide(player) === side);
    const porRol = [...delLado].sort((a, b) => roleWeight(a) - roleWeight(b));
    const jugadores = Array.isArray(summary.teams[side].players)
      ? summary.teams[side].players
      : [];
    jugadores.forEach((jugador, indice) => {
      const clave = championKey(jugador.champion || jugador.championAlias);
      let elegido = delLado.find(
        player => !usados.has(player) && clave && championKey(player.champion) === clave
      );
      if (!elegido) {
        elegido = delLado.find(
          player => !usados.has(player) && normalRole(player.role) === normalRole(jugador.role)
        );
      }
      if (!elegido && porRol[indice] && !usados.has(porRol[indice])) elegido = porRol[indice];
      if (elegido) usados.add(elegido);
      resultado[side].push({
        champion: jugador.champion ?? null,
        championAlias: jugador.championAlias ?? null,
        role: jugador.role ?? null,
        total: elegido && Array.isArray(elegido.total) ? elegido.total.slice() : null
      });
    });
  }

  // El último punto se cierra con la duración real y el oro final del resumen:
  // así la curva termina donde terminó la partida y coincide con la tarjeta.
  const duracion =
    typeof summary.gameDuration === 'number' && summary.gameDuration > 0
      ? summary.gameDuration
      : resultado.duration;
  if (!(duracion > 0)) return null;
  // Las muestras posteriores al final real se descartan: el eje no puede ir
  // hacia atrás. Si no quedan al menos dos puntos, no hay gráfica.
  let cuantas = resultado.times.length;
  while (cuantas > 1 && resultado.times[cuantas - 1] > duracion + 0.5) cuantas -= 1;
  resultado.times = resultado.times.slice(0, cuantas);
  for (const side of ['blue', 'red']) {
    for (const entrada of resultado[side]) {
      if (Array.isArray(entrada.total)) entrada.total = entrada.total.slice(0, cuantas);
    }
  }
  if (resultado.times.length < 2) return null;
  const ultimaT = resultado.times[resultado.times.length - 1];
  const cerrar = duracion - ultimaT >= 5;
  if (cerrar) resultado.times.push(duracion);
  else resultado.times[resultado.times.length - 1] = duracion;
  for (const side of ['blue', 'red']) {
    const jugadores = summary.teams[side].players || [];
    resultado[side].forEach((entrada, indice) => {
      if (!Array.isArray(entrada.total)) return;
      const final = jugadores[indice]?.gold;
      if (cerrar) {
        entrada.total.push(
          typeof final === 'number' ? final : entrada.total[entrada.total.length - 1] ?? 0
        );
      } else if (typeof final === 'number') {
        entrada.total[entrada.total.length - 1] = final;
      }
    });
  }
  // Relleno de seguridad: cualquier hueco se queda con el valor anterior para
  // que la pantalla reciba siempre series del mismo largo.
  for (const side of ['blue', 'red']) {
    for (const entrada of resultado[side]) {
      if (!Array.isArray(entrada.total)) continue;
      while (entrada.total.length < resultado.times.length) {
        entrada.total.push(entrada.total[entrada.total.length - 1] ?? 0);
      }
      entrada.total = entrada.total.slice(0, resultado.times.length);
    }
  }
  resultado.duration = duracion;
  const hayCurva = [...resultado.blue, ...resultado.red].some(entrada =>
    Array.isArray(entrada.total)
  );
  return hayCurva ? resultado : null;
}

module.exports = { readGoldSeries, goldSeriesForCards, GOLD_SERIES_DIR, GOLD_SERIES_LATEST };
