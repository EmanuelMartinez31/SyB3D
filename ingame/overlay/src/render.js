import { recursoDe, nombreDeRecurso, SIN_RECURSO } from './recursos.js';

const ROLE_ORDER = ['top', 'jungle', 'mid', 'bot', 'support'];
const DRAGON_ICONS = {
  Infernal: 'infernal', Mountain: 'mountain', Ocean: 'ocean', Cloud: 'cloud',
  Hextech: 'hextech', Chemtech: 'chemtech', Elder: 'elder'
};
const dragonIconSource = type => `./assets/objectives/dragon${DRAGON_ICONS[type] ? `_${DRAGON_ICONS[type]}` : ''}.png`;
const SECONDARY_OBJECTIVE_ICONS = {
  grubs: 'grub', riftHerald: 'riftherald', baron: 'baron'
};
const rowsByTeam = new Map([[1, new Map()], [2, new Map()]]);
let activeCatalog = null;
// Panel de diagnóstico de las fichas. Solo se enciende con ?debug=1 en la
// dirección del overlay: no cambia nada del HUD normal.
let cardDebug = false;
export function setCardDebug(on) {
  cardDebug = on ? true : false;
}

const byId = id => document.getElementById(id);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const numberOr = (value, fallback = 0) => finite(value) ? value : fallback;

/* ------------------------------------------------------------------
   (r82) Modo de partida: 5 vs 5 · 2 vs 2 · 1 vs 1.
   Lo elige el operador en el panel y llega dentro de «info», que es lo
   mismo que ya trae los nombres y los logos. Si no llega nada, se cuenta
   la gente que trae el juego. Sin panel y con diez jugadores, 5 vs 5, que
   es lo que había hasta ahora: así el 5 vs 5 se queda igual.
   ------------------------------------------------------------------ */
let modoActual = '5v5';

function normalizarModo(valor) {
  const bruto = String(valor ?? '').trim().toLowerCase().replace(/[^0-9a-z]/g, '');
  if (!bruto) return null;
  if (['1v1', '1vs1', '1'].includes(bruto)) return '1v1';
  if (['2v2', '2vs2', '2'].includes(bruto)) return '2v2';
  if (['5v5', '5vs5', '5'].includes(bruto)) return '5v5';
  return null;
}

function modoDePartida(state) {
  const info = state?.info || {};
  const delPanel = normalizarModo(info.modo ?? info.mode ?? info.modoPartida);
  const jugadores = Array.isArray(state?.players) ? state.players.length : 0;
  // Con dos jugadores en cancha no hay 5 vs 5 posible, y con cuatro es un 2 vs 2:
  // ahi manda el numero de jugadores, aunque el panel se haya quedado en 5 vs 5.
  // Con diez jugadores (o cualquier otra cifra) manda el panel.
  if (jugadores === 2) return '1v1';
  if (jugadores === 4) return '2v2';
  if (delPanel) return delPanel;
  return '5v5';
}

function aplicarModo(modo) {
  if (modo === modoActual) return;
  modoActual = modo;
  document.body.dataset.modo = modo;
  // Las tres reglas solo existen en el 1 vs 1: se limpian al salir del modo.
  if (modo !== '1v1') {
    primeras.anotadas = {};
    primeras.victoria = null;
    ocultarVictoria();
  }
}

/* Las tres formas de ganar un 1 vs 1: primera torre, primeros 100 cs y
   primera kill. Se encienden solas y no se apagan aunque el marcador pierda
   el dato después: son cosas que ya pasaron. */
const primeras = { gameId: null, anotadas: {}, victoria: null };

const nombreDeJugador = player => {
  const nombre = String(player?.player || '').split('#')[0].trim();
  return nombre || String(player?.champion || '').trim() || '—';
};

function jugadoresPorEquipo(state) {
  const jugadores = Array.isArray(state?.players) ? state.players : [];
  const deEquipo = team => jugadores.filter(jugador => jugador.team === team);
  return { 1: deEquipo(1), 2: deEquipo(2) };
}

const MOTIVOS_DE_VICTORIA = { torre: 'PRIMERA TORRE', cs: 'PRIMEROS 100 CS', kill: 'PRIMERA KILL' };

function anotarRegla(regla, team, nombre, campeon, cuando) {
  if (primeras.anotadas[regla]) return;
  primeras.anotadas[regla] = { team, nombre, campeon, cuando: finite(cuando) ? cuando : null };
  decidirVictoria();
}

// De las tres, la que ocurrió antes es la que da la partida. Se compara el
// instante de juego de cada una, no el orden en que se detectaron: si el HUD
// se abre con la partida empezada, las tres pueden aparecer en el mismo
// fotograma y hay que quedarse con la más antigua.
function decidirVictoria() {
  const reglas = Object.entries(primeras.anotadas);
  if (!reglas.length) return;
  const instante = datos => (finite(datos.cuando) ? datos.cuando : Infinity);
  const [regla, datos] = reglas.reduce((a, b) => (instante(a[1]) <= instante(b[1]) ? a : b));
  if (primeras.victoria && instante(primeras.victoria) <= instante(datos)) return;
  primeras.victoria = { regla, ...datos };
  mostrarVictoria(datos.team, datos.nombre, regla, datos.campeon);
}

function mostrarVictoria(team, nombre, regla, campeon) {
  const caja = byId('victory');
  if (!caja) return;
  caja.classList.remove('azul', 'rojo');
  caja.classList.add(team === 1 ? 'azul' : 'rojo');
  setText(byId('victory-name'), nombre);
  setText(byId('victory-reason'), MOTIVOS_DE_VICTORIA[regla] || '');
  const icono = byId('victory-icon');
  const letra = byId('victory-letter');
  if (icono && letra && !icono.dataset.victoryWired) {
    icono.dataset.victoryWired = '1';
    wireImageFallback(icono, letra);
  }
  const url = campeon && activeCatalog ? activeCatalog.championUrl(campeon) : null;
  setImage(icono, url, campeon || '', letra, (nombre || '?').slice(0, 1));
  caja.hidden = false;
}

function ocultarVictoria() {
  const caja = byId('victory');
  if (caja) caja.hidden = true;
}

function primeraDeLaLista(feed) {
  const asesinatos = Array.isArray(feed?.asesinatos) ? feed.asesinatos : [];
  return tipo => asesinatos.find(asesinato => asesinato?.victim?.tipo === tipo) || null;
}

function renderUnoContraUno(state) {
  const equipos = jugadoresPorEquipo(state);
  const { 1: azules, 2: rojos } = equipos;
  const azul = azules[0] || null;
  const rojo = rojos[0] || null;

  // El nombre del jugador ocupa el sitio del nombre del equipo.
  for (const [prefix, jugador] of [['blue', azul], ['red', rojo]]) {
    const etiqueta = byId(`${prefix}-name`);
    if (!etiqueta) continue;
    etiqueta.style.fontSize = '';       // el ajuste de siglas no pinta nada aquí
    setText(etiqueta, jugador ? nombreDeJugador(jugador) : '—');
    etiqueta.title = jugador ? nombreDeJugador(jugador) : '';
  }

  // El CS de cada uno, en la barra de arriba.
  setText(byId('blue-cs'), azul && finite(azul.cs?.total) ? azul.cs.total : '—');
  setText(byId('red-cs'), rojo && finite(rojo.cs?.total) ? rojo.cs.total : '—');

  const gameId = state?.meta?.gameId ?? null;
  if (primeras.gameId !== gameId) {
    primeras.gameId = gameId;
    primeras.anotadas = {};
    primeras.victoria = null;
    ocultarVictoria();
  }

  const jugadorDe = team => (team === 1 ? azul : rojo);
  const nombreDe = team => jugadorDe(team)
    ? nombreDeJugador(jugadorDe(team))
    : (team === 1 ? 'AZUL' : 'ROJO');
  const campeonDe = team => jugadorDe(team)?.champion || null;

  // Primera kill: la primera muerte de campeón que anotó el feed.
  const primeraKill = primeraDeLaLista(state?.killFeed)('campeon');
  if (primeraKill) {
    const team = finite(primeraKill.killer?.team) ? primeraKill.killer.team : null;
    if (team === 1 || team === 2) anotarRegla('kill', team, nombreDe(team), campeonDe(team), primeraKill.gameTime);
  }

  // Primera torre: la primera torre que cayó, también del feed. Si el feed ya
  // no la guarda, se mira qué lado perdió una.
  const primeraTorre = primeraDeLaLista(state?.killFeed)('torre');
  if (primeraTorre) {
    const team = finite(primeraTorre.killer?.team) ? primeraTorre.killer.team : null;
    if (team === 1 || team === 2) anotarRegla('torre', team, nombreDe(team), campeonDe(team), primeraTorre.gameTime);
  } else if (!primeras.anotadas.torre) {
    const torres = Array.isArray(state?.structures?.turrets) ? state.structures.turrets : [];
    const caida = torres.find(torre => torre?.alive === false && torre?.countsTowardTowers !== false && finite(torre?.team));
    if (caida) {
      const team = caida.team === 1 ? 2 : 1;
      anotarRegla('torre', team, nombreDe(team), campeonDe(team), state?.meta?.gameTime);
    }
  }

  // Primeros 100 cs.
  for (const jugador of [azul, rojo]) {
    if (!jugador || !finite(jugador.cs?.total) || jugador.cs.total < 100) continue;
    if (jugador.team === 1 || jugador.team === 2) {
      anotarRegla('cs', jugador.team, nombreDeJugador(jugador), jugador.champion || null, state?.meta?.gameTime);
    }
    break;
  }
}

function setText(element, value) {
  const text = String(value);
  if (element && element.textContent !== text) element.textContent = text;
}

function formatGold(value) {
  if (!finite(value)) return '—';
  return `${(value / 1000).toFixed(1)}K`;
}

function formatTime(seconds) {
  if (!finite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function percent(current, max) {
  if (!finite(current) || !finite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(1, current / max));
}

// Nombre del jugador tal cual lo manda el cliente (sin el #TAG). Si el
// cliente todavía no lo publicó, se usa el campeón: nunca una raya suelta.
function displayName(player) {
  const nombre = String(player?.player || '').split('#')[0].trim();
  if (nombre) return nombre;
  return String(player?.champion || '').trim() || '—';
}

function fitPlayerName(element, text) {
  const width = element.clientWidth;
  const fontStatus = document.fonts?.status || '';
  const key = `${text}|${width}|${fontStatus}`;
  if (element.dataset.fitKey === key) return;
  element.dataset.fitKey = key;
  element.style.fontSize = '19px';
  if (!width) return;
  let size = 19;
  while (element.scrollWidth > width && size > 9.5) {
    size = Math.max(9.5, size - 0.5);
    element.style.fontSize = `${size}px`;
  }
}

function setBar(element, current, max) {
  if (!element) return;
  const scale = percent(current, max);
  element.style.transform = `scaleX(${scale})`;
}

function setImage(img, source, alt, fallbackElement, fallbackText = '—') {
  if (!img) return;
  const candidates = [...new Set((Array.isArray(source) ? source : [source]).filter(Boolean))];
  const key = candidates.join('|');
  img.alt = alt || '';
  if (!candidates.length) {
    img.hidden = true;
    img.removeAttribute('src');
    img.dataset.sources = '';
    if (fallbackElement) {
      fallbackElement.hidden = false;
      setText(fallbackElement, fallbackText);
    }
    return;
  }
  if (img.dataset.sources !== key) {
    img.dataset.sources = key;
    img._sources = candidates;
    img._sourceIndex = 0;
    img._failed = false;
    img.dataset.url = candidates[0];
    img.src = candidates[0];
  }
  // No reexponer una imagen rota en cada snapshot si ya agotó sus respaldos.
  if (!img._failed) img.hidden = false;
  if (fallbackElement && !img._failed) fallbackElement.hidden = true;
}

function wireImageFallback(img, fallback) {
  img.addEventListener('error', () => {
    const sources = Array.isArray(img._sources) ? img._sources : [];
    const nextIndex = (img._sourceIndex ?? 0) + 1;
    if (nextIndex < sources.length) {
      img._sourceIndex = nextIndex;
      img.dataset.url = sources[nextIndex];
      img.src = sources[nextIndex];
      img.hidden = false;
      return;
    }
    img._failed = true;
    img.hidden = true;
    if (fallback) fallback.hidden = false;
  });
  img.addEventListener('load', () => {
    img._failed = false;
    img.hidden = false;
    if (fallback) fallback.hidden = true;
  });
}

const teamLogoAssets = new Map();

// (r71) Las siglas caben SIEMPRE en su hueco. El hueco mide 52 px y NO se
// ensancha: si se ensancha, la tabla de 906 px y todo lo que va colgado de la
// barra se descuadra. Lo que se ajusta es el tamaño de la letra: si las siglas
// caben se quedan al tamaño normal de la hoja, y si no, bajan justo lo
// necesario para que se lean enteras (sin recortes y sin puntos suspensivos).
//
// Se mide el texto de verdad (con un Range, que respeta la letra y el espacio
// entre letras) y no scrollWidth: con "text-overflow: ellipsis" y overflow
// oculto, scrollWidth se queda corto y daba por bueno un texto que se recortaba.
function anchoDelTexto(elemento) {
  const rango = document.createRange();
  rango.selectNodeContents(elemento);
  return rango.getBoundingClientRect().width;
}

// Lo último que se ajustó en cada hueco: si el texto no cambió, no se vuelve a
// medir (esto se llama en cada actualización del HUD).
const siglasAjustadas = new WeakMap();

function ajustarSiglas(elemento) {
  if (!elemento || !elemento.textContent) return;
  const texto = elemento.textContent;
  if (siglasAjustadas.get(elemento) === texto) return;
  siglasAjustadas.set(elemento, texto);
  elemento.style.fontSize = '';
  elemento.style.letterSpacing = '';
  // El hueco se mide igual que el texto (las dos cosas después del escalado
  // de la escena), así el ajuste vale con cualquier tamaño de lienzo.
  const hueco = elemento.getBoundingClientRect().width || 52;
  if (!hueco) return;
  const base = parseFloat(getComputedStyle(elemento).fontSize) || 27;
  // 1) Primero se aprieta el espacio entre letras: con 4 o 5 letras gana unos
  //    píxeles sin tocar el tamaño de la letra.
  if (anchoDelTexto(elemento) > hueco) elemento.style.letterSpacing = '0';
  // 2) Y si aún no cabe, se baja la letra lo justo (de medio en medio).
  let tam = base;
  let vueltas = 0;
  while (anchoDelTexto(elemento) > hueco && tam > 12 && vueltas < 60) {
    tam -= 0.5;
    elemento.style.fontSize = `${tam}px`;
    vueltas += 1;
  }
}

// Si las siglas se pintaron antes de que cargara la fuente, se vuelven a
// ajustar cuando la fuente está lista (si no, mediría con otra letra).
if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    for (const id of ['blue-name', 'red-name']) {
      const elemento = document.getElementById(id);
      if (elemento) siglasAjustadas.delete(elemento);   // se vuelve a medir
      ajustarSiglas(elemento);
    }
  }).catch(() => {});
}

function renderTeamIdentity(prefix, info) {
  const { fullName, shortName } = teamShortName(prefix, info);

  const siglas = byId(`${prefix}-name`);
  setText(siglas, shortName);
  siglas.title = fullName;
  // (r71) Que las siglas quepan SIEMPRE: 3, 4 o 5 letras.
  ajustarSiglas(siglas);
  setText(byId(`score-${prefix}-name`), fullName);

  if (!teamLogoAssets.has(prefix)) {
    const asset = { img: byId(`${prefix}-team-logo`), fallback: byId(`${prefix}-emblem`) };
    wireImageFallback(asset.img, asset.fallback);
    teamLogoAssets.set(prefix, asset);
  }
  const asset = teamLogoAssets.get(prefix);
  setText(asset.fallback, shortName.slice(0, 1));
  setImage(asset.img, info?.[`${prefix}Logo`], `Logo de ${fullName}`, asset.fallback, shortName.slice(0, 1));
}

// Data Dragon numera 16.22.1 y League usa el parche de temporada: 26.22.
function formatPatch(version) {
  const match = /^(\d+)\.(\d+)/.exec(String(version || ''));
  if (!match) return null;
  const major = Number(match[1]);
  const minor = match[2];
  return `${major + 10}.${minor}`;
}

function renderPatch(catalog) {
  const element = byId('game-patch');
  if (!element) return;
  const patch = formatPatch(catalog?.version);
  if (!patch) {
    element.hidden = true;
    return;
  }
  element.hidden = false;
  setText(element, `PARCHE ${patch}`);
  element.title = `Parche actual de League of Legends · versión ${catalog.version}`;
}

/* ------------------------------------------------------------------
   Runas del inicio de partida
   Se muestran del segundo 5 al 30 del reloj de la barra superior (lo que dura
   la presentación de los jugadores): las runas del equipo azul a la izquierda
   y las del rojo a la derecha.
   ------------------------------------------------------------------ */
const RUNE_INTRO_FROM = 5;
// Duran lo mismo que la presentación de los jugadores: del segundo 5 al 30.
const RUNE_INTRO_UNTIL = 30;
// Mismos tiempos que los avisos de objetivos: entra deslizándose desde la
// orilla y sale por la misma orilla, además de desvanecerse.
const RUNE_ENTER_MS = 560;
const RUNE_LEAVE_MS = 420;
let runeIntroSignature = '';
let runeIntroPhase = 'hidden';
let runeLeaveTimer = 0;

function teamShortName(prefix, info) {
  const fallbackName = prefix === 'blue' ? 'AZUL' : 'ROJO';
  const fullName = String(info?.[prefix] || fallbackName).trim() || fallbackName;
  const words = fullName.split(/\s+/).filter(Boolean);
  const generatedShort = words.length > 1
    ? words.map(word => word[0]).join('').slice(0, 4)
    : fullName.slice(0, 4);
  return {
    fullName,
    shortName: String(info?.[`${prefix}Short`] || info?.[`${prefix}Tag`] || generatedShort)
      .trim().toUpperCase() || fallbackName
  };
}

function roleRank(role) {
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

function runePlayers(players, team) {
  return players
    .filter(player => player.team === team)
    .sort((a, b) => roleRank(a.role) - roleRank(b.role));
}

function buildRuneRow(player, catalog, index) {
  const row = document.createElement('li');
  row.className = 'rune-row';

  // Retrato del campeón
  const champ = assetWithFallback('rune-champ', '—');
  const championUrl = player.champion && catalog ? catalog.championUrl(player.champion) : null;
  setImage(champ.img, championUrl, player.champion || 'Campeón', champ.fallback, String(index + 1));

  // Runa principal (pieza grande)
  const runeIds = (Array.isArray(player.runes) ? player.runes : []).filter(finite);
  const key = assetWithFallback('rune-key', 'R');
  const keystoneUrl = runeIds.length && catalog ? catalog.runeUrl(runeIds[0]) : null;
  setImage(key.img, keystoneUrl, runeIds.length && catalog ? catalog.runeName(runeIds[0]) : '', key.fallback, 'R');

  // Runas menores: hasta 3 del árbol principal y 2 del secundario
  const minors = document.createElement('span');
  minors.className = 'rune-minors';
  const minorIds = runeIds.slice(1, 6);
  for (const id of minorIds) {
    const minor = document.createElement('i');
    minor.className = 'rune-minor';
    const image = document.createElement('img');
    const fallback = document.createElement('span');
    fallback.className = 'asset-fallback';
    fallback.hidden = true;
    wireImageFallback(image, fallback);
    minor.append(image, fallback);
    setImage(image, catalog ? catalog.runeUrl(id) : null, catalog ? catalog.runeName(id) : '', fallback, '');
    minors.append(minor);
  }

  row.append(champ.wrap, key.wrap, minors);
  return row;
}

function buildRunePanel(prefix, players, info, catalog) {
  const panel = document.createElement('aside');
  panel.className = `rune-panel rune-panel-${prefix}`;

  const title = document.createElement('div');
  title.className = 'rune-panel-title';
  title.textContent = 'Runas';

  const head = document.createElement('div');
  head.className = 'rune-team-head';
  const emblem = assetWithFallback('rune-team-emblem', prefix === 'blue' ? 'A' : 'R');
  const { shortName, fullName } = teamShortName(prefix, info);
  setImage(emblem.img, info?.[`${prefix}Logo`], `Logo de ${fullName}`, emblem.fallback, shortName.slice(0, 1));
  setText(emblem.fallback, shortName.slice(0, 1));
  // En la cabecera del panel va el nombre completo del equipo, no las siglas.
  const name = document.createElement('strong');
  name.className = 'rune-team-name';
  name.textContent = fullName;
  name.title = fullName;
  head.append(emblem.wrap, name);

  const list = document.createElement('ul');
  list.className = 'rune-list';
  runePlayers(players, prefix === 'blue' ? 1 : 2).forEach((player, index) => {
    list.append(buildRuneRow(player, catalog, index));
  });

  panel.append(title, head, list);
  return panel;
}

function buildRunePanels(state, catalog) {
  const players = Array.isArray(state.players) ? state.players : [];
  const signature = JSON.stringify([
    state.info?.blueShort, state.info?.blue, state.info?.blueLogo,
    state.info?.redShort, state.info?.red, state.info?.redLogo,
    players.map(player => [player.team, player.role, player.champion, (player.runes || []).join('-')])
  ]);
  if (signature === runeIntroSignature) return;
  runeIntroSignature = signature;
  const blue = byId('rune-side-blue');
  const red = byId('rune-side-red');
  blue.replaceChildren(buildRunePanel('blue', players, state.info, catalog));
  red.replaceChildren(buildRunePanel('red', players, state.info, catalog));
}

function hideRuneIntro(container) {
  if (runeIntroPhase !== 'shown') return;
  runeIntroPhase = 'leaving';
  window.clearTimeout(runeLeaveTimer);
  container.classList.remove('is-entering');
  container.classList.add('is-leaving');
  runeLeaveTimer = window.setTimeout(() => {
    container.hidden = true;
    container.classList.remove('is-leaving');
    runeIntroPhase = 'hidden';
  }, RUNE_LEAVE_MS);
}

function showRuneIntro(container) {
  window.clearTimeout(runeLeaveTimer);
  container.classList.remove('is-leaving');
  // Se obliga a un reflujo para que la animación arranque desde la orilla.
  container.hidden = true;
  void container.offsetWidth;
  container.hidden = false;
  void container.offsetWidth;
  container.classList.add('is-entering');
  runeIntroPhase = 'shown';
}

function renderRuneIntro(state, catalog) {
  const container = byId('rune-intro');
  if (!container) return;
  const gameTime = state?.meta?.gameTime;
  const visible = finite(gameTime) && gameTime >= RUNE_INTRO_FROM && gameTime <= RUNE_INTRO_UNTIL;

  if (!visible) {
    hideRuneIntro(container);
    return;
  }

  buildRunePanels(state, catalog);
  if (runeIntroPhase !== 'shown') showRuneIntro(container);
}

/* ------------------------------------------------------------------
   Detección de teamfight
   Se considera pelea cuando hay al menos FIGHT_MIN jugadores vivos de cada
   equipo metidos en el mismo choque y uno de los dos lados llega a
   FIGHT_MIN_MAYOR. Es decir: 4 contra 4, 5 contra 4, 4 contra 5… y también
   3 contra 4. Un 3 contra 3 no cuenta.

   Rebote (antiparpadeo): la pelea no se enciende ni se apaga de golpe.
     · entra cuando la condición se sostiene FIGHT_ENTER_S segundos
     · sale cuando lleva FIGHT_EXIT_S segundos sin cumplirse
   El rebote se mide con reloj real, así funciona igual en partida, en
   repetición y en la demo, y no depende de que el reloj del juego avance.
   Si entre dos estados pasa más de 1 s (pausa, OBS detenido) ese hueco no
   se cuenta.
   ------------------------------------------------------------------ */
const FIGHT_MIN = 3;          // mínimo por lado para que cuente como choque
const FIGHT_MIN_MAYOR = 4;    // uno de los dos lados tiene que llegar a cuatro
const FIGHT_GROUP_RADIUS = 1400;
const FIGHT_CLASH_RADIUS = 2200;
const FIGHT_ENTER_S = 0.6;
const FIGHT_EXIT_S = 2.0;

// R102 · manda el operador desde el Stream Deck: auto / off / on.
// El servidor lo mete en cada estado, así que una recarga del overlay no lo
// pierde.
const MODOS_PELEA = ['auto', 'off', 'on'];
let modoPelea = 'auto';

// R102 · el botón de alternar tiene que saber si la tira se está viendo ahora
// mismo, así que aquí se le cuenta al servidor cada vez que entra o sale.
// Se repite cada 15 s por si el servidor se reinició y se quedó sin el dato.
let visibilidadAvisada = null;
let cuandoSeAviso = 0;

function avisarVisibilidad() {
  const ahora = Date.now();
  if (fightVisible === visibilidadAvisada && ahora - cuandoSeAviso < 15000) return;
  visibilidadAvisada = fightVisible;
  cuandoSeAviso = ahora;
  if (typeof fetch !== 'function') return;
  try {
    fetch('/fight/visible', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visible: fightVisible })
    }).catch(() => {});
  } catch { /* si el overlay se abre como archivo suelto no hay a quién avisar */ }
}

const fightState = {
  active: false,
  sostiene: 0,   // segundos que lleva cumpliéndose la condición
  ausente: 0,    // segundos que lleva sin cumplirse
  stamp: null,   // reloj del cálculo anterior
  blue: [],
  red: []
};

function worldDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function detectFight(players) {
  const vivos = players.filter(player =>
    player.alive === true && player.position &&
    finite(player.position.x) && finite(player.position.z)
  );

  for (const team of [1, 2]) {
    const propios = vivos.filter(player => player.team === team);
    const rivales = vivos.filter(player => player.team !== team);
    if (propios.length < FIGHT_MIN || rivales.length < FIGHT_MIN) continue;

    for (const ancla of propios) {
      const grupo = propios.filter(player => worldDistance(player.position, ancla.position) <= FIGHT_GROUP_RADIUS);
      if (grupo.length < FIGHT_MIN) continue;
      const centro = {
        x: grupo.reduce((sum, player) => sum + player.position.x, 0) / grupo.length,
        z: grupo.reduce((sum, player) => sum + player.position.z, 0) / grupo.length
      };
      const enemigos = rivales.filter(player => worldDistance(player.position, centro) <= FIGHT_CLASH_RADIUS);
      if (enemigos.length < FIGHT_MIN) continue;
      // Un 3 contra 3 no es pelea: alguno de los dos lados debe llegar a cuatro.
      if (Math.max(grupo.length, enemigos.length) < FIGHT_MIN_MAYOR) continue;
      return {
        blue: (team === 1 ? grupo : enemigos).map(player => player.id).filter(id => id !== null),
        red: (team === 1 ? enemigos : grupo).map(player => player.id).filter(id => id !== null)
      };
    }
  }
  return null;
}

function fightClock() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function updateFight(players) {
  const ahora = fightClock();
  const paso = fightState.stamp === null
    ? 0
    : Math.min(Math.max(ahora - fightState.stamp, 0), 1000) / 1000;
  fightState.stamp = ahora;

  const deteccion = detectFight(players);

  if (fightState.active) {
    if (deteccion) {
      fightState.ausente = 0;
      fightState.blue = deteccion.blue;
      fightState.red = deteccion.red;
    } else {
      // Se guardan los últimos participantes durante el tiempo de salida para
      // que las cartas no se vacíen de golpe mientras se retiran.
      fightState.ausente += paso;
      if (fightState.ausente >= FIGHT_EXIT_S) {
        fightState.active = false;
        fightState.sostiene = 0;
        fightState.ausente = 0;
        fightState.blue = [];
        fightState.red = [];
      }
    }
  } else if (deteccion) {
    fightState.ausente = 0;
    fightState.sostiene += paso;
    if (fightState.sostiene >= FIGHT_ENTER_S) {
      fightState.active = true;
      fightState.sostiene = 0;
      fightState.blue = deteccion.blue;
      fightState.red = deteccion.red;
    }
  } else {
    fightState.sostiene = 0;
    fightState.ausente = 0;
  }

  return fightState.active
    ? { active: true, blue: fightState.blue, red: fightState.red }
    : { active: false, blue: [], red: [] };
}

/* ------------------------------------------------------------------
   Teamfight
   El servidor decide cuándo hay pelea y quién está en ella; aquí solo se
   pinta. La tabla de abajo baja y en su lugar aparecen los recuadros de
   los que están peleando, uno por uno desde las orillas hacia el centro.
   ------------------------------------------------------------------ */
const FIGHT_LEAVE_MS = 340;
const fightCards = new Map();
let fightVisible = false;
let fightLeaveTimer = 0;
let fightSettleTimer = 0;

function fightPercent(value, max) {
  if (!finite(value) || !finite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function buildFightCard(player, team, catalog) {
  const card = document.createElement('article');
  card.className = `fight-card fight-card-${team}`;
  // El índice de la escalera lo pone syncFightSide, que es quien conoce el orden.
  card.title = [player.player, player.champion].filter(Boolean).join(' · ');

  // Retrato con el nivel pegado abajo a la izquierda
  const portrait = assetWithFallback('fight-portrait', '');
  setImage(
    portrait.img,
    player.champion && catalog ? catalog.championUrl(player.champion) : null,
    player.champion || 'Campeón',
    portrait.fallback,
    String(player.champion || '')
  );
  const level = document.createElement('span');
  level.className = 'fight-level';
  setText(level, finite(player.level) ? player.level : '—');
  portrait.wrap.append(level);

  // Vida y maná
  const bars = document.createElement('span');
  bars.className = 'fight-bars';
  const hp = document.createElement('i');
  hp.className = 'fight-bar fight-bar-hp';
  const hpFill = document.createElement('b');
  hp.append(hpFill);
  const mp = document.createElement('i');
  mp.className = 'fight-bar fight-bar-mp';
  const mpFill = document.createElement('b');
  mp.append(mpFill);
  bars.append(hp, mp);

  // Dos hechizos de invocador y la definitiva en el tercer hueco
  const spells = document.createElement('span');
  spells.className = 'fight-spells';
  const refs = [];
  for (const [key, isUlt] of [['d', false], ['f', false], ['r', true]]) {
    const spell = player.spells?.[key] || null;
    const nombre = spell?.name || null;
    const slot = assetWithFallback(isUlt ? 'fight-spell is-ult' : 'fight-spell', '');
    // Si el icono de la definitiva no está disponible se usa el retrato del
    // campeón: en ningún caso aparece una letra en el hueco del hechizo.
    const fuentes = nombre ? catalog.spellUrls(nombre, spell.icon) : [];
    setImage(
      slot.img,
      isUlt ? [...fuentes, catalog.championUrl(player.champion)] : fuentes,
      nombre ? catalog.spellName(nombre) : '',
      slot.fallback,
      ''
    );
    slot.wrap.title = nombre ? catalog.spellName(nombre) : '';
    refs.push({ wrap: slot.wrap, key, spell });
    spells.append(slot.wrap);
  }

  const referencias = { el: card, hpFill, hp, mpFill, mp, refs, level, portrait: portrait.wrap };
  updateFightCard(referencias, player);

  card.append(portrait.wrap, bars, spells);
  return { el: card, refs: referencias };
}

// Vida, maná y enfriamientos cambian varias veces por segundo: se refrescan
// sin rehacer los recuadros para que no parpadeen.
function updateFightCard(refs, player) {
  const hpPct = fightPercent(player.health?.current, player.health?.max);
  refs.hpFill.style.width = `${hpPct}%`;
  refs.hp.classList.toggle('is-low', hpPct <= 30);
  refs.hp.title = `Vida ${Math.round(player.health?.current ?? 0)} / ${Math.round(player.health?.max ?? 0)}`;
  // (r90) No todos gastan maná: el color y el rótulo van según el campeón.
  // El que no gasta nada (Garen, Katarina, Riven…) se queda sin barra.
  const recursoFicha = recursoDe(player.champion);
  const sinRecursoFicha = recursoFicha === SIN_RECURSO;
  refs.mp.classList.toggle('is-sin', sinRecursoFicha);
  if (sinRecursoFicha) {
    refs.mp.removeAttribute('data-recurso');
    refs.mp.removeAttribute('title');
  } else {
    refs.mp.dataset.recurso = recursoFicha;
    refs.mpFill.style.width = `${fightPercent(player.resource?.current, player.resource?.max)}%`;
    refs.mp.title = `${nombreDeRecurso(recursoFicha)} ${Math.round(player.resource?.current ?? 0)} / ${Math.round(player.resource?.max ?? 0)}`;
  }
  setText(refs.level, finite(player.level) ? player.level : '—');
  // El muerto NO se retira: su ficha se queda en su sitio, en gris. Aquí no
  // hay contador de reaparición (eso es solo de la tabla de abajo).
  const muerto = player.alive === false;
  if (refs.el) refs.el.classList.toggle('is-dead', muerto);
  // Mismo marco que la tabla, aplicado al retrato de la ficha.
  const buff = muerto ? null : player.objectiveBuff || null;
  refs.portrait.classList.toggle('buff-baron', buff === 'baron');
  refs.portrait.classList.toggle('buff-elder', buff === 'elder');
  refs.portrait.title = buff === 'baron'
    ? 'Bendición del Barón'
    : buff === 'elder' ? 'Aspecto del Dragón' : '';
  for (const ref of refs.refs) {
    const spell = player.spells?.[ref.key] || null;
    const enfriando = finite(spell?.remaining) && spell.remaining > 0.05;
    ref.wrap.classList.toggle('is-cool', Boolean(enfriando));
  }
}

function roleOrden(player) {
  return roleRank(player.role);
}

// Cada tarjeta es un elemento propio que se conserva entre estados: si el
// jugador sigue en la pelea no se vuelve a crear (no parpadea). Cuando uno
// entra, su tarjeta sube; cuando sale, su tarjeta baja y se retira.
function entrando(card) {
  window.clearTimeout(card.temporizador);
  card.el.classList.remove('is-leaving');
  card.el.classList.add('is-entering');
  card.temporizador = window.setTimeout(() => card.el.classList.remove('is-entering'), 520);
}

function saliendo(card) {
  const el = card.el;
  window.clearTimeout(card.temporizador);
  el.classList.remove('is-entering');
  // Se queda quieta donde estaba mientras baja, sin empujar a las demás.
  el.style.left = `${el.offsetLeft}px`;
  el.classList.add('is-leaving');
  card.temporizador = window.setTimeout(() => el.remove(), 380);
}

function syncFightSide(players, team, catalog) {
  const side = byId(`fight-${team}`);
  if (!side) return;
  const ordenados = [...players].sort((a, b) => roleOrden(a) - roleOrden(b));
  side.style.setProperty('--n', String(ordenados.length));
  const presentes = new Set(ordenados.map(player => player.id));

  // Los que ya no están en la pelea: su tarjeta baja y desaparece.
  for (const [id, card] of [...fightCards]) {
    if (card.team !== team || presentes.has(id)) continue;
    fightCards.delete(id);
    saliendo(card);
  }

  // Los que siguen se reutilizan; los nuevos suben desde abajo.
  let anterior = null;
  ordenados.forEach((player, index) => {
    let card = fightCards.get(player.id);
    if (!card) {
      card = { ...buildFightCard(player, team, catalog), team, id: player.id };
      fightCards.set(player.id, card);
      entrando(card);
    }
    card.el.style.setProperty('--i', String(index));
    // Solo se mueve si de verdad está fuera de su sitio: mover un nodo reinicia
    // sus animaciones y haría parpadear la tira en cada estado.
    const enSuSitio = anterior === null
      ? side.firstElementChild === card.el
      : anterior.nextElementSibling === card.el;
    if (!enSuSitio) {
      if (anterior === null) side.insertBefore(card.el, side.firstElementChild);
      else side.insertBefore(card.el, anterior.nextElementSibling);
    }
    anterior = card.el;
  });
}

function hideFightStrip() {
  const strip = byId('fight-strip');
  const table = document.querySelector('.scoreboard');
  if (!strip) return;
  // Mientras ya está saliendo no se reprograma la salida: si se limpiara el
  // temporizador en cada estado, la tira no llegaría a ocultarse nunca.
  if (!fightVisible) return;
  window.clearTimeout(fightLeaveTimer);
  fightVisible = false;
  strip.classList.remove('is-in');
  strip.classList.add('is-out');
  syncTableVisibility();
  // Al salir se quita la marca de tarjeta nueva para que el hundimiento
  // general de la tira mande sobre cualquier animación pendiente.
  strip.querySelectorAll('.fight-card').forEach(el => el.classList.remove('is-entering'));
  fightLeaveTimer = window.setTimeout(() => {
    strip.hidden = true;
    strip.classList.remove('is-out', 'is-settled');
    fightCards.clear();
    strip.querySelectorAll('.fight-card').forEach(el => el.remove());
  }, FIGHT_LEAVE_MS + 320);
}

// Logo del torneo en el centro de la tira. Si el estado no trae logo, el hueco
// queda vacío: no se dibuja ningún sustituto.
function renderFightLogo(info) {
  const logo = byId('fight-tournament-logo');
  if (!logo) return;
  if (!logo._wired) {
    logo._wired = true;
    logo.addEventListener('error', () => { logo.hidden = true; });
  }
  const fuente = typeof info?.logo === 'string' && info.logo.trim() ? info.logo.trim() : null;
  if (logo.dataset.fuente === String(fuente)) return;
  logo.dataset.fuente = String(fuente);
  if (fuente) {
    logo.hidden = false;
    logo.src = fuente;
  } else {
    logo.hidden = true;
    logo.removeAttribute('src');
  }
}

function renderFight(state, catalog) {
  const strip = byId('fight-strip');
  const table = document.querySelector('.scoreboard');
  if (!strip) return;

  const players = Array.isArray(state?.players) ? state.players : [];

  // Apagada a mano: la tira no sale aunque la detección diga que sí.
  if (modoPelea === 'off') {
    fightState.active = false;
    fightState.sostiene = 0;
    fightState.ausente = 0;
    fightState.blue = [];
    fightState.red = [];
    hideFightStrip();
    return;
  }

  const fight = updateFight(players);
  renderFightLogo(state?.info);
  // Encendida a mano: sale aunque la detección no vea pelea.
  if (modoPelea !== 'on' && fight.active !== true) {
    hideFightStrip();
    return;
  }

  // La tira enseña SIEMPRE los cinco de cada equipo, estén o no metidos en la
  // pelea: el que cae no desaparece, su ficha se queda en su sitio en gris.
  // Quién empieza la pelea lo sigue decidiendo el servidor (updateFight).
  const blue = players.filter(player => player.team === 1);
  const red = players.filter(player => player.team === 2);
  if (!blue.length && !red.length) {
    hideFightStrip();
    return;
  }

  syncFightSide(blue, 'blue', catalog);
  syncFightSide(red, 'red', catalog);

  for (const player of [...blue, ...red]) {
    const card = fightCards.get(player.id);
    if (card) updateFightCard(card.refs, player);
  }

  window.clearTimeout(fightLeaveTimer);
  if (!fightVisible) {
    fightVisible = true;
    strip.hidden = false;
    strip.classList.remove('is-out', 'is-settled', 'is-in');
    void strip.offsetWidth;
    strip.classList.add('is-in');
    syncTableVisibility();
    // Cuando la última tarjeta termina de subir, la tira queda asentada y las
    // animaciones de entrada dejan de aplicarse a todas.
    const escalera = 70 * Math.max(blue.length, red.length) + 460;
    window.clearTimeout(fightSettleTimer);
    fightSettleTimer = window.setTimeout(() => {
      if (fightVisible) strip.classList.add('is-settled');
    }, escalera);
  }
}

/* ------------------------------------------------------------------
   Fichas de presentación del inicio
   Del segundo 5 al 30 se presenta a los diez jugadores de dos en dos: la
   ficha del azul y la del rojo del MISMO rol, cinco segundos cada pareja,
   en orden TOP → JUNGLA → MID → ADC → SOPORTE.

   Mientras duran, la tabla de abajo no se ve: su sitio lo ocupan las fichas.
   Los paneles de runas de los laterales siguen funcionando igual.

   La ficha es el arte 2D del campeón (el de carga, con su skin si el
   cliente la publica) y el nombre del jugador. Nada de modelos 3D.
   ------------------------------------------------------------------ */
const DECK_FROM = 5;
const DECK_STEP = 5;
const DECK_UNTIL = DECK_FROM + DECK_STEP * ROLE_ORDER.length; // 30 s
const DECK_LEAVE_MS = 420;
// La primera vez que aparecen, las fichas suben desde abajo con el mismo
// tiempo que usan las runas al entrar (560 ms). Se deja un poco más para
// quitar la clase cuando la animación ya ha terminado del todo.
const DECK_RISE_MS = 620;
const DECK_ROLE_LABEL = {
  top: 'TOP', jungle: 'JUNGLA', mid: 'MID', bot: 'ADC', support: 'SOPORTE'
};

let deckActive = false;
// Mientras dura la presentación (del segundo 0 al 30) la tabla no se muestra:
// primero porque la partida acaba de empezar y todavía no hay nada que contar,
// y después porque su sitio lo ocupan las fichas.
let deckHoldsTable = false;
let deckRoleKey = '';
let deckSignature = '';
let deckHideTimer = 0;
let deckRiseTimer = 0;
let deckShown = false;
let deckPlayers = [];
let deckArtReady = false;
let deckArtRequest = null;

// Antes de mostrar las fichas se resuelve el arte de cada skin: se pregunta a
// Community Dragon, que sabe el número exacto de cada skin. Se hace en cuanto
// empieza la partida, así a los 5 segundos ya está todo (y las imágenes
// descargadas). Si no hay red, se sigue igual con lo que se tenga.
function prepararArteDeck(catalog, players) {
  if (deckArtReady || deckArtRequest) return;
  const champions = players.map(player => player.champion).filter(Boolean);
  if (typeof catalog?.prepareSkins !== 'function') {
    deckArtReady = true;
    return;
  }
  deckArtRequest = catalog.prepareSkins(champions)
    .catch(() => {})
    .then(() => {
      deckArtReady = true;
      deckArtRequest = null;
      // Todavía no se ha mostrado nada: se puede reconstruir sin parpadeo.
      if (!deckShown) deckSignature = '';
      else refreshDeckArt();
    });
}

// La tabla de abajo se oculta cuando dura la presentación o hay una teamfight.
// Todo pasa por aquí para que los dos motivos no se pisen entre ellos.
function syncTableVisibility() {
  const table = document.querySelector('.scoreboard');
  if (!table) return;
  table.classList.toggle('is-out', fightVisible || deckHoldsTable);
}

// Si el catálogo de skins llegó cuando las fichas ya estaban en pantalla, se
// vuelve a pedir el arte de cada una: la skin sustituye al arte base sin
// rehacer las fichas (no hay parpadeo, la imagen anterior se queda hasta que
// carga la nueva).
function refreshDeckArt() {
  const catalog = activeCatalog;
  if (!catalog) return;
  const players = deckPlayers;
  for (const card of document.querySelectorAll('.deck-card')) {
    const role = card.dataset.role;
    const side = card.classList.contains('deck-card-blue') ? 1 : 2;
    const player = players.find(item => item.team === side && item.role === role);
    const img = card.querySelector('.deck-art img');
    if (!player || !img || !player.champion) continue;
    setImage(
      img,
      catalog.splashUrls(player.champion, player.skin),
      player.champion,
      card.querySelector('.deck-art .asset-fallback'),
      String(player.champion)
    );
  }
}

function buildDeckCard(player, catalog, team) {
  const card = document.createElement('article');
  card.className = `deck-card deck-card-${team}`;
  card.title = [displayName(player), player.champion].filter(Boolean).join(' · ');

  // Arte 2D del campeón, con su skin si el cliente la publicó. El respaldo del
  // catálogo es el arte base, así nunca queda un hueco vacío.
  const art = assetWithFallback('deck-art', '');
  setImage(
    art.img,
    player.champion && catalog ? catalog.splashUrls(player.champion, player.skin) : [],
    player.champion || 'Campeón',
    art.fallback,
    String(player.champion || '')
  );
  // La imagen solo se dibuja cuando ya está cargada (o si venía de la caché).
  const lista = () => art.wrap.classList.add('is-ready');
  const caida = () => art.wrap.classList.remove('is-ready');
  if (art.img.complete && art.img.naturalWidth > 0) lista();
  art.img.addEventListener('load', lista);
  art.img.addEventListener('error', caida);

  const foot = document.createElement('div');
  foot.className = 'deck-foot';
  const name = document.createElement('strong');
  name.className = 'deck-name';
  setText(name, displayName(player));
  const champion = document.createElement('span');
  champion.className = 'deck-champ';
  setText(
    champion,
    player.champion && catalog ? catalog.championName(player.champion) : (player.champion || '')
  );
  // Si el nombre coincide con el campeón, no se repite debajo.
  if (champion.textContent.trim().toLowerCase() === name.textContent.trim().toLowerCase()) {
    champion.hidden = true;
  }
  foot.append(name, champion);

  card.append(art.wrap, foot);
  return card;
}

// Se construyen las cinco fichas de cada lado una sola vez (no en cada
// estado) y luego solo se marca cuál está activa.
function buildDeck(players, catalog) {
  const signature = JSON.stringify(
    players.map(player => [player.team, player.role, player.champion, player.player, player.skin])
  );
  if (signature === deckSignature) return;
  deckSignature = signature;
  deckPlayers = players;
  deckRoleKey = '';
  const sides = [[1, byId('deck-blue'), 'blue'], [2, byId('deck-red'), 'red']];
  for (const [team, container, side] of sides) {
    if (!container) continue;
    container.replaceChildren();
    const suyos = players.filter(candidate => candidate.team === team);
    // En la Grieta cada equipo tiene sus cinco lineas y se ordena por rol. En
    // Abismo (1 vs 1 y 2 vs 2) no hay lineas: los jugadores llegan sin rol, asi
    // que va una ficha por jugador en el orden en que vienen. Antes se buscaban
    // los cinco roles, no se encontraba a nadie y no salia ninguna ficha.
    const hayLineas = suyos.length >= 5 && suyos.every(candidate => candidate.role);
    const orden = hayLineas
      ? ROLE_ORDER.map(role => suyos.find(candidate => candidate.role === role)).filter(Boolean)
      : suyos;
    orden.forEach((player, indice) => {
      const card = buildDeckCard(player, catalog, side);
      card.dataset.role = player.role || `puesto${indice + 1}`;
      container.append(card);
    });
  }
}

function setDeckActive(active) {
  const container = byId('deck-intro');
  if (!container) return;
  if (active) {
    window.clearTimeout(deckHideTimer);
    container.hidden = false;
    // La primera vez que se muestran, las fichas suben desde abajo: se le pone
    // la clase que lanza la animación y se le quita en cuanto termina, para que
    // a partir de ahí manden los cambios de rol de siempre. Del resto se encarga
    // el CSS, igual que en las runas.
    const primeraVez = !deckShown;
    if (primeraVez) {
      deckShown = true;
      container.classList.add('is-instant');
      container.classList.add('is-rising');
      window.clearTimeout(deckRiseTimer);
      deckRiseTimer = window.setTimeout(() => {
        container.classList.remove('is-rising');
      }, DECK_RISE_MS);
    }
    void container.offsetWidth;
    container.classList.remove('is-out');
    container.classList.add('is-in');
    if (primeraVez) {
      void container.offsetWidth;
      container.classList.remove('is-instant');
    }
    if (!deckActive) {
      deckActive = true;
      syncTableVisibility();
    }
    return;
  }
  if (!deckActive) return;
  deckActive = false;
  syncTableVisibility();
  // Sale hacia abajo antes de ocultarse, como el resto de cartas del HUD.
  container.classList.remove('is-in');
  container.classList.add('is-out');
  deckHideTimer = window.setTimeout(() => {
    if (deckActive) return;
    container.hidden = true;
    container.classList.remove('is-out');
    deckRoleKey = '';
    deckSignature = '';
  }, DECK_LEAVE_MS);
}

function renderDeck(state, catalog) {
  const container = byId('deck-intro');
  if (!container) return;
  const gameTime = state?.meta?.gameTime;
  const players = Array.isArray(state?.players) ? state.players : [];
  // Con menos de diez jugadores no hay presentación que valga… salvo en el
  // 1 vs 1, donde solo hay dos y la presentación es la suya.
  const hayEquipos = finite(gameTime)
    && (players.length >= 10 || (modoActual === '1v1' && players.length >= 2));
  // La tabla se retira desde el primer segundo y vuelve a los 30.
  const retiene = hayEquipos && gameTime >= 0 && gameTime < DECK_UNTIL;
  if (retiene !== deckHoldsTable) {
    deckHoldsTable = retiene;
    if (!deckHoldsTable) deckSignature = '';
    syncTableVisibility();
  }
  // La baraja se construye desde el primer segundo, aunque no se vea: las
  // imágenes se descargan durante los primeros 5 s y, cuando toca mostrarlas,
  // ya están listas (antes una ficha del TOP daba un salto al cargar). El arte
  // de cada skin se resuelve en paralelo desde ese mismo momento.
  if (hayEquipos) {
    prepararArteDeck(catalog, players);
    buildDeck(players, catalog);
  }

  // Las fichas, del segundo 5 al 30.
  const visible = hayEquipos && gameTime >= DECK_FROM && gameTime < DECK_UNTIL;

  if (!visible) {
    setDeckActive(false);
    return;
  }

  if (modoActual === '1v1') {
    // Una ficha por lado, las dos a la vez y durante todo el recorrido: no hay
    // líneas que presentar de una en una.
    if (deckRoleKey !== '1v1') {
      deckRoleKey = '1v1';
      setText(byId('deck-role-label'), '1 VS 1');
      for (const card of container.querySelectorAll('.deck-card')) card.classList.add('is-active');
    }
    setDeckActive(true);
    return;
  }
  const index = Math.min(
    ROLE_ORDER.length - 1,
    Math.max(0, Math.floor((gameTime - DECK_FROM) / DECK_STEP))
  );
  const role = ROLE_ORDER[index];
  if (role !== deckRoleKey) {
    deckRoleKey = role;
    setText(byId('deck-role-label'), DECK_ROLE_LABEL[role] || role.toUpperCase());
    for (const card of container.querySelectorAll('.deck-card')) {
      card.classList.toggle('is-active', card.dataset.role === role);
    }
  }
  setDeckActive(true);
}

function renderTeamIdentities(info) {
  renderTeamIdentity('blue', info);
  renderTeamIdentity('red', info);
}

function assetWithFallback(className, fallbackText = '—') {
  const wrap = document.createElement('span');
  wrap.className = className;
  const img = document.createElement('img');
  const fallback = document.createElement('span');
  fallback.className = 'asset-fallback';
  fallback.textContent = fallbackText;
  fallback.hidden = true;
  wrap.append(img, fallback);
  wireImageFallback(img, fallback);
  return { wrap, img, fallback };
}

/* ------------------------------------------------------------------
   Experiencia
   El cliente manda la experiencia de cada campeón, pero según la fuente
   puede venir como avance DENTRO del nivel o como total acumulado. Se
   resuelve solo: si el número cuadra con el nivel que informa el juego,
   se toma como total; si no, como avance del nivel. Con XP_MODE se puede
   forzar uno de los dos ('auto' | 'nivel' | 'total').
   ------------------------------------------------------------------ */
const XP_MODE = 'auto';
// Si algún día no se quiere la tercera barra, se apaga desde aquí.
const MOSTRAR_BARRA_XP = true;
const XP_MAX_LEVEL = 18;

// XP que pide el juego para pasar de un nivel al siguiente.
function xpParaSubir(level) {
  if (!finite(level) || level < 1 || level >= XP_MAX_LEVEL) return 0;
  return 280 + (level - 1) * 100;
}

// XP acumulada necesaria para estar en `level`.
function xpAcumulada(level) {
  let total = 0;
  for (let n = 1; n < level; n += 1) total += xpParaSubir(n);
  return total;
}

// Nivel que corresponde a una cantidad de XP acumulada.
function nivelPorXp(xp) {
  let level = 1;
  while (level < XP_MAX_LEVEL && xp >= xpAcumulada(level + 1)) level += 1;
  return level;
}

function progresoExperiencia(player) {
  const level = finite(player.level) ? player.level : null;
  const xp = finite(player.experience) ? player.experience : null;
  if (level === null || xp === null || xp < 0) return null;
  if (level >= XP_MAX_LEVEL) return { pct: 100, xp, need: 0, level };

  const need = xpParaSubir(level);
  if (need <= 0) return { pct: 100, xp, need: 0, level };

  let modo = XP_MODE;
  if (modo === 'auto') {
    const cuadraComoTotal = nivelPorXp(xp) === level;
    // Si el número entra en el nivel actual, se toma como avance del nivel;
    // si además cuadra como total, gana la lectura de avance (es la habitual).
    modo = xp < need ? 'nivel' : cuadraComoTotal ? 'total' : 'nivel';
  }

  let dentro = xp;
  if (modo === 'total') dentro = Math.max(0, xp - xpAcumulada(level));
  const pct = Math.max(0, Math.min(100, (dentro / need) * 100));
  return { pct, xp: Math.round(dentro), need, level };
}

function createPlayerRow(player) {
  const row = document.createElement('article');
  row.className = 'player-row';

  const spells = document.createElement('div');
  spells.className = 'icon-stack spell-stack';
  const spellD = assetWithFallback('spell-icon', '');
  const spellF = assetWithFallback('spell-icon', '');
  const cooldownD = document.createElement('span');
  const cooldownF = document.createElement('span');
  cooldownD.className = 'cooldown';
  cooldownF.className = 'cooldown';
  cooldownD.hidden = true;
  cooldownF.hidden = true;
  spellD.wrap.append(cooldownD);
  spellF.wrap.append(cooldownF);
  spells.append(spellD.wrap, spellF.wrap);

  const runes = document.createElement('div');
  runes.className = 'icon-stack rune-stack';
  const primaryRune = assetWithFallback('rune-icon', 'R');
  const secondaryRune = assetWithFallback('rune-icon', 'R');
  runes.append(primaryRune.wrap, secondaryRune.wrap);

  const championWrap = document.createElement('div');
  championWrap.className = 'champion-wrap';
  const champion = document.createElement('img');
  champion.className = 'champion-icon';
  const championFallback = document.createElement('span');
  championFallback.className = 'asset-fallback champion-icon';
  championFallback.hidden = true;
  wireImageFallback(champion, championFallback);
  const level = document.createElement('span');
  level.className = 'champion-level';
  // Contador de reaparición: encima del icono del campeón, solo mientras está
  // muerto. Se crea siempre y se oculta con [hidden] para no tocar el DOM luego.
  const respawn = document.createElement('span');
  respawn.className = 'respawn-timer';
  respawn.hidden = true;
  championWrap.append(champion, championFallback, level, respawn);

  const info = document.createElement('div');
  info.className = 'player-info';
  const name = document.createElement('strong');
  name.className = 'player-name';

  // Misión de rol en columna propia, entre el nombre y las estadísticas:
  // icono oficial de la posición sobre una barra de progreso, que se sustituye
  // por una palomita al cumplirse. Si el icono no carga queda la inicial.
  const quest = document.createElement('div');
  quest.className = 'player-quest';
  const questSlot = document.createElement('span');
  questSlot.className = 'quest-slot';
  const questIcon = document.createElement('img');
  questIcon.className = 'quest-icon';
  questIcon.alt = '';
  const questLetter = document.createElement('span');
  questLetter.className = 'quest-letter';
  questLetter.hidden = true;
  wireImageFallback(questIcon, questLetter);
  // Mismo numerito que lucen las wards y demás objetos del inventario.
  const questCount = document.createElement('span');
  questCount.className = 'quest-count';
  questCount.hidden = true;
  questSlot.append(questIcon, questLetter, questCount);
  const questTrack = document.createElement('span');
  questTrack.className = 'quest-track';
  const questFill = document.createElement('span');
  questTrack.append(questFill);
  const questCheck = document.createElement('span');
  questCheck.className = 'quest-check';
  questCheck.textContent = '✓';
  questCheck.setAttribute('aria-hidden', 'true');
  quest.append(questSlot, questTrack, questCheck);

  const championName = document.createElement('span');
  championName.className = 'champion-name';
  const bars = document.createElement('div');
  bars.className = 'resource-bars';
  const healthBar = document.createElement('div');
  healthBar.className = 'bar bar-health';
  const healthFill = document.createElement('span');
  healthBar.append(healthFill);
  const resourceBar = document.createElement('div');
  resourceBar.className = 'bar bar-resource';
  const resourceFill = document.createElement('span');
  resourceBar.append(resourceFill);
  // Tercera barra: la experiencia hacia el siguiente nivel.
  const xpBar = document.createElement('div');
  xpBar.className = 'bar bar-xp';
  const xpFill = document.createElement('span');
  xpBar.append(xpFill);
  bars.append(healthBar, resourceBar, xpBar);
  info.append(name, championName, bars);

  const kda = document.createElement('span');
  kda.className = 'kda';
  const cs = document.createElement('span');
  cs.className = 'cs';
  const stats = document.createElement('div');
  stats.className = 'player-stats';
  stats.append(cs, kda);

  const items = document.createElement('div');
  items.className = 'items';
  const itemSlots = Array.from({ length: 7 }, (_, index) => {
    const slot = document.createElement('span');
    slot.className = `item-slot${index === 6 ? ' trinket' : ''}`;
    const img = document.createElement('img');
    img.hidden = true;
    const count = document.createElement('span');
    count.className = 'item-count';
    count.hidden = true;
    const vision = document.createElement('span');
    vision.className = 'vision-score';
    vision.hidden = true;
    wireImageFallback(img, null);
    slot.append(img, count, vision);
    return { slot, img, count, vision, id: null };
  });
  const visualSlots = player.team === 1 ? [...itemSlots].reverse() : itemSlots;
  for (const slot of visualSlots) items.append(slot.slot);

  row.append(spells, runes, championWrap, info, quest, stats, items);
  return {
    row, championWrap, spellD, spellF, cooldownD, cooldownF, primaryRune, secondaryRune,
    champion, championFallback, level, respawn, name, championName, healthFill,
    resourceBar, resourceFill, xpBar, xpFill, kda, cs, itemSlots,
    quest, questIcon, questLetter, questCount, questFill, questCheck
  };
}

// El castigo tiene tres caras y el cliente no siempre manda el icono de la
// etapa actual: se resuelve con los tratos que le faltan a la mascota.
const SMITE_ICON_BY_STAGE = {
  smite: './assets/spells/summoner_smite.png',
  unleashed: './assets/spells/unleashed_smite.png'
};
// La última etapa toma el color del objeto de jungla comprado.
const SMITE_PRIMAL_BY_PET = {
  1101: './assets/spells/1101_smite.png', // Garra ígnea (rojo)
  1102: './assets/spells/1102_smite.png', // Caminabrisas (azul)
  1103: './assets/spells/1103_smite.png'  // Brincamontes (verde)
};

function smiteIconFile(spell, quest) {
  const icon = String(spell?.icon || '').toLowerCase();
  const bag = `${spell?.name || ''} ${icon}`.toLowerCase();
  if (!/smite|castigo|aplastar/.test(bag)) return null;
  // Si la mascota ya se consumió, el objeto desaparece del inventario y el
  // propio icono del cliente (1101/1102/1103) dice cuál era.
  const iconPetId = Number((icon.match(/^(11\d\d)_smite/) || [])[1]) || null;
  // Al llegar a 0 la mascota se consume y con ella el objeto: la misión de
  // jungla queda cumplida, así que la última etapa se deduce de ahí.
  const finished = quest?.role === 'jungle' && quest?.done === true;
  const stage = quest?.smiteStage || (finished || iconPetId ? 'primal' : null);
  if (!stage) return null;
  if (stage === 'primal') {
    const petId = finite(quest?.petId) ? quest.petId
      : finite(quest?.lastPetId) ? quest.lastPetId
      : iconPetId;
    return SMITE_PRIMAL_BY_PET[petId] || SMITE_PRIMAL_BY_PET[1101];
  }
  return SMITE_ICON_BY_STAGE[stage] || null;
}

function updateSpell(asset, cooldownElement, spell, key, quest) {
  const remaining = finite(spell?.remaining) ? spell.remaining : 0;
  const spellName = spell?.name || null;
  const localSmiteIcon = smiteIconFile(spell, quest);
  setImage(
    asset.img,
    localSmiteIcon || (spellName ? activeCatalog.spellUrls(spellName, spell?.icon) : null),
    spellName ? activeCatalog.spellName(spellName) : `Hechizo ${key.toUpperCase()}`,
    asset.fallback,
    // Sin letra de respaldo: si el icono no está publicado, el hueco queda
    // vacío en vez de mostrar una «D» o una «F» que no significa nada.
    ''
  );
  asset.wrap.title = spellName ? activeCatalog.spellName(spellName) : `Hechizo ${key.toUpperCase()}`;
  cooldownElement.hidden = remaining <= 0.05;
  if (remaining > 0.05) setText(cooldownElement, Math.ceil(remaining));
}

const QUEST_ROLE_LABELS = {
  top: { short: 'T', name: 'Calle superior', icon: './assets/ui/role-top.png' },
  jungle: { short: 'J', name: 'Jungla', icon: './assets/ui/role-jungle.png' },
  mid: { short: 'M', name: 'Calle central', icon: './assets/ui/role-mid.png' },
  bot: { short: 'B', name: 'Calle inferior', icon: './assets/ui/role-bot.png' },
  support: { short: 'S', name: 'Apoyo', icon: './assets/ui/role-support.png' }
};

function updatePlayerQuest(refs, quest) {
  const role = quest?.role;
  const label = QUEST_ROLE_LABELS[role];
  refs.quest.hidden = !label;
  if (!label) {
    refs.quest.removeAttribute('title');
    return;
  }

  const done = quest.done === true;
  const known = finite(quest.value) && finite(quest.max) && quest.max > 0;
  refs.quest.classList.toggle('done', done);
  // Jungla y apoyo no publican progreso: se oculta la barra en vez de pintar
  // un relleno inventado.
  refs.quest.classList.toggle('no-progress', !known);

  if (refs.questIcon.dataset.role !== role) {
    refs.questIcon.dataset.role = role;
    refs.questIcon._failed = false;
    refs.questIcon.hidden = false;
    refs.questIcon.src = label.icon;
  }
  setText(refs.questLetter, label.short);

  // Contador propio del objeto (jungla y apoyo): se pinta igual que el de un
  // objeto del inventario, sin interpretarlo como porcentaje.
  const count = finite(quest.count) ? quest.count : null;
  refs.questCount.hidden = count === null;
  if (count !== null) setText(refs.questCount, count);

  if (!done && known) {
    const percent = Math.max(0, Math.min(100, (quest.value / quest.max) * 100));
    refs.questFill.style.width = `${percent}%`;
  }

  refs.quest.title = done
    ? `Misión de rol cumplida (${label.name})`
    : known
      ? `Misión de rol de ${label.name} · ${quest.value}/${quest.max}`
      : count !== null
        ? `Misión de rol de ${label.name} · contador del objeto: ${count}`
        : `Misión de rol de ${label.name} · el juego no publica el progreso`;
  refs.quest.setAttribute('aria-label', refs.quest.title);
}

// Formato del contador: segundos sueltos por debajo de un minuto y m:ss a
// partir de ahí. Se redondea hacia arriba para que nunca muestre 0 y siga vivo.
function formatRespawn(seconds) {
  const total = Math.max(1, Math.ceil(seconds));
  if (total < 60) return String(total);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function updateRespawnTimer(element, player) {
  const muerto = player.alive === false;
  const segundos = finite(player.respawnIn) ? player.respawnIn : null;
  const visible = muerto && segundos !== null && segundos > 0;
  element.hidden = !visible;
  if (!visible) return;
  const texto = formatRespawn(segundos);
  setText(element, texto);
  element.title = `Reaparece en ${Math.ceil(segundos)} s`;
}

function updatePlayerRow(refs, player) {
  refs.row.classList.toggle('dead', player.alive === false);
  // Marco del buff de objetivo: solo se pinta en jugadores vivos que lo lleven.
  const buff = player.alive === false ? null : player.objectiveBuff || null;
  refs.championWrap.classList.toggle('buff-baron', buff === 'baron');
  refs.championWrap.classList.toggle('buff-elder', buff === 'elder');
  refs.championWrap.title = buff === 'baron'
    ? 'Bendición del Barón'
    : buff === 'elder' ? 'Aspecto del Dragón' : '';
  updateRespawnTimer(refs.respawn, player);
  refs.row.setAttribute('aria-label', `${displayName(player)}, ${player.champion || 'campeón'}`);
  const playerName = displayName(player);
  setText(refs.name, playerName);
  fitPlayerName(refs.name, playerName);
  refs.name.title = playerName;
  setText(refs.championName, activeCatalog.championName(player.champion || ''));
  setText(refs.level, finite(player.level) ? player.level : '—');

  setImage(
    refs.champion,
    player.champion ? activeCatalog.championUrl(player.champion) : null,
    activeCatalog.championName(player.champion || ''),
    refs.championFallback,
    (player.champion || '?').slice(0, 1)
  );

  // Se recuerda el objeto de jungla visto para conservar el color del castigo
  // cuando el juego lo consume al completar la misión.
  if (finite(player.quest?.petId)) refs.lastPetId = player.quest.petId;
  const questForSpells = player.quest
    ? { ...player.quest, lastPetId: refs.lastPetId ?? null }
    : null;
  updateSpell(refs.spellD, refs.cooldownD, player.spells?.d, 'd', questForSpells);
  updateSpell(refs.spellF, refs.cooldownF, player.spells?.f, 'f', questForSpells);

  const runeIds = Array.isArray(player.runes) ? player.runes : [];
  const primaryId = runeIds[0];
  setImage(
    refs.primaryRune.img,
    finite(primaryId) ? activeCatalog.runeUrl(primaryId) : null,
    finite(primaryId) ? activeCatalog.runeName(primaryId) : 'Runa principal',
    refs.primaryRune.fallback,
    'R'
  );
  refs.primaryRune.wrap.title = finite(primaryId) ? activeCatalog.runeName(primaryId) : '';
  setImage(
    refs.secondaryRune.img,
    activeCatalog.secondaryStyleUrl(runeIds),
    activeCatalog.secondaryStyleName(runeIds),
    refs.secondaryRune.fallback,
    'R'
  );
  refs.secondaryRune.wrap.title = activeCatalog.secondaryStyleName(runeIds);

  setBar(refs.healthFill, player.health?.current, player.health?.max);
  // (r90) Mismo criterio que en las fichas: el color y el rótulo dependen del
  // campeón, y el que no gasta nada no lleva barra.
  const recursoFila = recursoDe(player.champion);
  const hasResource = recursoFila !== SIN_RECURSO
    && finite(player.resource?.max) && player.resource.max > 0;
  refs.resourceBar.hidden = !hasResource;
  if (hasResource) {
    refs.resourceBar.dataset.recurso = recursoFila;
    setBar(refs.resourceFill, player.resource.current, player.resource.max);
    refs.resourceBar.title = `${nombreDeRecurso(recursoFila)} ${Math.round(player.resource.current)} / ${Math.round(player.resource.max)}`;
  } else {
    refs.resourceBar.removeAttribute('data-recurso');
    refs.resourceBar.removeAttribute('title');
  }

  // Experiencia: sin dato no se dibuja nada, no se inventa el avance.
  const xp = MOSTRAR_BARRA_XP ? progresoExperiencia(player) : null;
  refs.xpBar.hidden = !xp;
  if (xp) {
    refs.xpFill.style.transform = `scaleX(${Math.max(0, Math.min(1, xp.pct / 100))})`;
    refs.xpBar.title = xp.need > 0
      ? `Experiencia ${xp.xp} / ${xp.need} · nivel ${xp.level}`
      : `Experiencia · nivel ${xp.level} (máximo)`;
    refs.xpBar.classList.toggle('is-full', xp.pct >= 100);
  }

  const kills = finite(player.kda?.kills) ? player.kda.kills : '—';
  const deaths = finite(player.kda?.deaths) ? player.kda.deaths : '—';
  const assists = finite(player.kda?.assists) ? player.kda.assists : '—';
  setText(refs.kda, `${kills}/${deaths}/${assists}`);
  setText(refs.cs, finite(player.cs?.total) ? player.cs.total : '—');

  updatePlayerQuest(refs, player.quest);

  const items = Array.isArray(player.items) ? player.items : [];
  refs.itemSlots.forEach((slot, index) => {
    const item = items.find(candidate => candidate?.slot === index);
    const id = finite(item?.id) && item.id > 0 ? item.id : null;
    if (slot.id !== id) {
      slot.id = id;
      setImage(
        slot.img,
        id ? activeCatalog.itemUrls(id) : null,
        id ? activeCatalog.itemName(id) : '',
        null
      );
      slot.slot.title = id ? activeCatalog.itemName(id) : '';
    }
    const count = finite(item?.count) && item.count > 1 ? item.count : null;
    slot.count.hidden = count === null;
    if (count !== null) setText(slot.count, count);
    if (index === 6) {
      const visionScore = finite(player.visionScore) ? Math.max(0, Math.floor(player.visionScore)) : null;
      slot.vision.hidden = visionScore === null;
      if (visionScore !== null) setText(slot.vision, visionScore);
      const itemName = id ? activeCatalog.itemName(id) : 'Trinket';
      slot.slot.title = `${itemName} · Puntuación de visión: ${visionScore ?? '—'}`;
    }
  });
}

function playerKey(player, index) {
  return player.id ?? `${player.player || 'player'}-${player.champion || index}`;
}

function renderTeamPlayers(team, container) {
  const rows = rowsByTeam.get(team);
  const sorted = container._players.slice().sort((a, b) => {
    const roleA = ROLE_ORDER.indexOf(a.role);
    const roleB = ROLE_ORDER.indexOf(b.role);
    const normalizedA = roleA === -1 ? ROLE_ORDER.length : roleA;
    const normalizedB = roleB === -1 ? ROLE_ORDER.length : roleB;
    return normalizedA - normalizedB || numberOr(a.index, 99) - numberOr(b.index, 99);
  });
  const retained = new Set();

  sorted.forEach((player, index) => {
    const key = String(playerKey(player, index));
    retained.add(key);
    if (!rows.has(key)) rows.set(key, createPlayerRow(player));
    const refs = rows.get(key);
    container.append(refs.row);
    updatePlayerRow(refs, player);
  });

  for (const [key, refs] of rows) {
    if (!retained.has(key)) {
      refs.row.remove();
      rows.delete(key);
    }
  }
  return sorted;
}

function objectiveCamp(objectives, kind) {
  return (objectives.camps || [])
    .filter(candidate => candidate.kind === kind)
    .sort((a, b) => numberOr(a.spawnAt, Infinity) - numberOr(b.spawnAt, Infinity))[0] || null;
}

function renderObjective(kind, element, state) {
  const objectives = state.objectives || {};
  const camp = objectiveCamp(objectives, kind);
  const timer = element.querySelector('strong');
  if (objectives.active?.[kind]) {
    // Mientras el objetivo está en el mapa se rotula solo «VIVO».
    setText(timer, 'VIVO');
  } else if (camp && finite(camp.remaining)) {
    setText(timer, formatTime(camp.remaining));
  } else {
    setText(timer, '—');
  }
  element.hidden = !camp && !objectives.active?.[kind];
}

// El dragón usa como icono el tipo que corresponde: el del dragón vivo en el
// pozo o, si aún no ha salido, el del próximo en aparecer.
function renderDragonObjective(state) {
  const element = byId('objective-dragon');
  if (!element) return;
  const objectives = state.objectives || {};
  const active = Boolean(objectives.active?.dragon);
  const type = active
    ? objectives.dragonType || objectives.upcomingDragonType
    : objectives.upcomingDragonType;
  const icon = byId('objective-dragon-icon');
  if (icon) {
    const source = dragonIconSource(type);
    if (icon.getAttribute('src') !== source) icon.src = source;
    icon.title = type ? `Dragón: ${type}` : 'Próximo dragón';
  }
  renderObjective('dragon', element, state);
}

function renderSecondaryObjective(state) {
  const element = byId('objective-secondary');
  const objectives = state.objectives || {};
  const kinds = ['grubs', 'riftHerald', 'baron', 'atakhan'];
  const labels = { grubs: 'VACULARVAS', riftHerald: 'HERALDO', baron: 'BARÓN', atakhan: 'ATAKHAN' };
  // Un marcador agotado de vacularbas no debe bloquear el siguiente objetivo.
  const kind = kinds.find(candidate => objectives.active?.[candidate])
    || kinds.find(candidate => objectiveCamp(objectives, candidate)?.remaining > 0.05);
  if (!kind) {
    element.hidden = true;
    return;
  }
  const icon = byId('objective-secondary-icon');
  const iconName = SECONDARY_OBJECTIVE_ICONS[kind];
  icon.hidden = !iconName;
  if (iconName) {
    const src = `./assets/objectives/${iconName}.png`;
    if (icon.getAttribute('src') !== src) icon.src = src;
    icon.title = labels[kind];
  }
  renderObjective(kind, element, state);
}

function renderGoldMatchups(bluePlayers, redPlayers) {
  const container = byId('gold-matchups');
  const roleLabels = ['TOP', 'JG', 'MID', 'ADC', 'SUP'];
  // (r82) En el 1 vs 1 la columna del medio tiene un solo piso.
  const filas = modoActual === '5v5'
    ? 5
    : Math.max(1, Math.min(5, Math.max(bluePlayers.length, redPlayers.length)));
  while (container.children.length < filas) {
    const row = document.createElement('div');
    row.className = 'matchup-row';
    const difference = document.createElement('span');
    difference.className = 'lane-difference';
    const role = document.createElement('small');
    const value = document.createElement('strong');
    difference.append(role, value);
    row.append(difference);
    container.append(row);
  }

  [...container.children].forEach((row, index) => {
    const bluePlayer = bluePlayers[index];
    const redPlayer = redPlayers[index];
    row.hidden = !bluePlayer && !redPlayer;
    if (row.hidden) return;
    const blueGold = bluePlayer?.gold?.total;
    const redGold = redPlayer?.gold?.total;
    setText(row.querySelector('small'), modoActual === '1v1' ? '1 VS 1' : (roleLabels[index] || 'LINEA'));
    const differenceElement = row.querySelector('strong');
    differenceElement.classList.remove('advantage-blue', 'advantage-red');
    // (r82) En el 1 vs 1 el medio de la tabla lleva la diferencia de CS,
    // que es lo que decide la partida, y no la de oro.
    if (modoActual === '1v1') {
      const blueCs = bluePlayer?.cs?.total;
      const redCs = redPlayer?.cs?.total;
      setText(row.querySelector('small'), 'CS');
      differenceElement.classList.remove('advantage-blue', 'advantage-red', 'advantage-neutral');
      if (finite(blueCs) && finite(redCs)) {
        const diferencia = blueCs - redCs;
        const signo = diferencia > 0 ? '+' : diferencia < 0 ? '-' : '±';
        setText(differenceElement, `${signo}${Math.abs(diferencia)}`);
        differenceElement.classList.add(diferencia > 0 ? 'advantage-blue' : diferencia < 0 ? 'advantage-red' : 'advantage-neutral');
        row.title = 'Diferencia de CS entre los dos jugadores';
      } else {
        setText(differenceElement, '—');
        row.title = '';
      }
      return;
    }
    if (finite(blueGold) && finite(redGold)) {
      const difference = blueGold - redGold;
      const sign = difference > 0 ? '+' : difference < 0 ? '-' : '±';
      setText(differenceElement, `${sign}${formatGold(Math.abs(difference))}`);
      differenceElement.classList.add(difference > 0 ? 'advantage-blue' : difference < 0 ? 'advantage-red' : 'advantage-neutral');
      row.title = modoActual === '1v1'
        ? 'Diferencia de oro total entre los dos jugadores'
        : `Diferencia de oro total en ${roleLabels[index] || 'la línea'}`;
    } else {
      setText(differenceElement, '—');
      row.title = '';
    }
  });
}

function renderDragonHistory(prefix, objectives) {
  const list = byId(`${prefix}-dragon-list`);
  const types = Array.isArray(objectives?.dragonTypes) ? objectives.dragonTypes : [];
  const total = finite(objectives?.dragon) ? Math.max(0, objectives.dragon) : types.length;
  while (list.children.length < total) {
    const icon = document.createElement('img');
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    list.append(icon);
  }
  [...list.children].forEach((icon, index) => {
    icon.hidden = index >= total;
    if (icon.hidden) return;
    const type = types[index] || null;
    const src = dragonIconSource(type);
    if (icon.getAttribute('src') !== src) icon.src = src;
    icon.title = type ? `Dragón ${type}` : 'Dragón conseguido';
  });
  list.hidden = total === 0;
  list.classList.toggle('dense', total >= 7);
  list.setAttribute('aria-label', `${total} dragones conseguidos`);
}

function renderSeries(score) {
  const candidate = String(score?.format || 'BO1').toUpperCase();
  const format = ['BO1', 'BO3', 'BO5'].includes(candidate) ? candidate : 'BO1';
  const maxWins = format === 'BO5' ? 3 : format === 'BO3' ? 2 : 1;
  const totalGames = maxWins * 2 - 1;
  const wins = {};
  setText(byId('series-format'), format);
  for (const prefix of ['blue', 'red']) {
    const element = byId(`${prefix}-series-score`);
    wins[prefix] = Math.min(maxWins, Math.max(0, Math.floor(numberOr(score?.[prefix], 0))));
    // Un cuadro por victoria necesaria: BO1 → 1, BO3 → 2, BO5 → 3. Los ganados
    // van rellenos con el color del equipo.
    while (element.children.length < maxWins) element.append(document.createElement('i'));
    while (element.children.length > maxWins) element.lastElementChild.remove();
    [...element.children].forEach((pip, index) => {
      pip.className = `series-pip ${prefix}${index < wins[prefix] ? ' filled' : ''}`;
    });
    element.hidden = false;
    element.title = `${wins[prefix]} de ${maxWins} victorias en la serie`;
    element.setAttribute('aria-label', `${wins[prefix]} de ${maxWins} victorias en la serie`);
  }
  const seriesComplete = wins.blue >= maxWins || wins.red >= maxWins;
  const gameNumber = Math.min(wins.blue + wins.red + 1, totalGames);
  setText(
    byId('game-label'),
    seriesComplete ? 'SERIE COMPLETADA' : `PARTIDA ${gameNumber} DE ${totalGames}`
  );
}

// ============================================================================
// BUFFS DE OBJETIVO
// El servidor entrega en objectives.buffs el tiempo restante del barón o del
// dragón ancestral por equipo. La barra se pinta en el hueco central de la
// banda, del lado del equipo que consiguió el objetivo.
// ============================================================================
const OBJECTIVE_BUFF_META = {
  baron: { icon: './assets/objectives/baron.png', label: 'Barón', title: 'Bendición del Barón' },
  elder: { icon: './assets/objectives/dragon_elder.png', label: 'Dragón ancestral', title: 'Aspecto del Dragón' }
};

function objectiveBuffBar(side, team, buff, teamName) {
  const bar = byId(`buff-bar-${side}`);
  if (!bar) return;
  const meta = buff ? OBJECTIVE_BUFF_META[buff.kind] : null;
  const remaining = finite(buff?.remaining) ? buff.remaining : null;
  if (!meta || remaining === null || remaining <= 0.05) {
    bar.hidden = true;
    delete bar.dataset.kind;
    bar.removeAttribute('title');
    return;
  }
  // El ancho se calcula sobre la duración real del buff: si el juego cambia
  // los 180 s del barón o los 150 s del ancestral, la barra sigue cuadrando.
  const duration = finite(buff.duration) && buff.duration > 0 ? buff.duration : remaining;
  bar.hidden = false;
  bar.dataset.kind = buff.kind;
  const icon = byId(`buff-icon-${side}`);
  if (icon && icon.getAttribute('src') !== meta.icon) icon.src = meta.icon;
  const fill = byId(`buff-fill-${side}`);
  if (fill) fill.style.transform = `scaleX(${percent(remaining, duration).toFixed(4)})`;
  const texto = formatTime(remaining);
  setText(byId(`buff-time-${side}`), texto);
  bar.title = `${meta.title} · ${texto} restantes · ${teamName}`;
  bar.setAttribute('aria-label', `${meta.title} de ${teamName}: ${texto} restantes`);
}

function renderObjectiveBuffs(state) {
  const buffs = state?.objectives?.buffs || {};
  const info = state?.info || {};
  objectiveBuffBar('blue', 1, buffs[1] || buffs['1'] || null, teamShortName('blue', info).shortName);
  objectiveBuffBar('red', 2, buffs[2] || buffs['2'] || null, teamShortName('red', info).shortName);
}

function renderTeams(teams) {
  const blue = teams.find(team => team.team === 1) || {};
  const red = teams.find(team => team.team === 2) || {};
  setText(byId('blue-kills'), finite(blue.kills) ? blue.kills : '—');
  setText(byId('red-kills'), finite(red.kills) ? red.kills : '—');
  setText(byId('blue-gold'), formatGold(blue.totalGold));
  setText(byId('red-gold'), formatGold(red.totalGold));
  const objectiveIds = { grubs: 'grubs-score', riftHerald: 'herald-score', baron: 'baron-score' };
  for (const [prefix, team] of [['blue', blue], ['red', red]]) {
    for (const [kind, id] of Object.entries(objectiveIds)) {
      const value = team.objectives?.[kind];
      setText(byId(`${prefix}-${id}`), finite(value) ? value : '—');
    }
    renderDragonHistory(prefix, team.objectives);
  }

  const blueTowers = finite(red.towersLost) ? red.towersLost : 11 - numberOr(red.towersRemaining, 11);
  const redTowers = finite(blue.towersLost) ? blue.towersLost : 11 - numberOr(blue.towersRemaining, 11);
  setText(byId('blue-towers'), blueTowers);
  setText(byId('red-towers'), redTowers);

  // La ventaja de oro se muestra debajo del oro del equipo que la tiene; el
  // otro lado queda sin marca. Si van empatados, no se muestra en ninguno.
  const blueLead = byId('blue-gold-lead');
  const redLead = byId('red-gold-lead');
  if (finite(blue.totalGold) && finite(red.totalGold)) {
    const difference = blue.totalGold - red.totalGold;
    const amount = difference === 0 ? '' : `+${formatGold(Math.abs(difference))}`;
    blueLead.hidden = difference <= 0;
    redLead.hidden = difference >= 0;
    if (difference !== 0) {
      setText(blueLead, amount);
      setText(redLead, amount);
    }
  } else {
    blueLead.hidden = true;
    redLead.hidden = true;
  }
}

/* ------------------------------------------------------------------
   Panel de diagnóstico de las fichas  (?debug=1)
   Enseña lo que llegó de verdad, sin adornos:
     equipo · rol · campeón (tal cual lo manda el juego) · skin (tal cual)
     · nombre (y de dónde salió) · archivo de arte que cargó
   Sirve para ver en una sola captura por qué una ficha no trae su skin o su
   nombre. No aparece si la dirección no lleva ?debug=1.
   ------------------------------------------------------------------ */
function renderCardDebug(state) {
  let panel = byId('card-debug');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'card-debug';
    panel.className = 'card-debug';
    document.getElementById('stage')?.append(panel);
  }
  const players = Array.isArray(state?.players) ? state.players : [];
  const limpiar = texto => String(texto || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const filas = players.map(player => {
    // Se busca la ficha por equipo Y rol, y se comprueba que el campeón sea el
    // mismo: si dos jugadores comparten rol (jungla repetida en la muestra de
    // prueba) no se enseña el archivo de la ficha equivocada.
    const card = [...document.querySelectorAll('.deck-card')]
      .find(item => item.dataset.role === player.role
        && item.classList.contains(player.team === 1 ? 'deck-card-blue' : 'deck-card-red')
        && limpiar(item.title.split('·').pop()) === limpiar(player.champion));
    const img = card?.querySelector('.deck-art img');
    const cargado = img?.currentSrc ? img.currentSrc.split('/').pop() : (img ? '—' : 'sin ficha');
    return [
      `${player.team === 1 ? 'AZUL' : 'ROJO'} ${String(player.role || '').toUpperCase().padEnd(7)}`,
      String(player.champion || '—').padEnd(12),
      `skin ${String(player.skin ?? 'null').padStart(7)}`,
      `${String(player.player || '—')} [${player.nameFrom || '?'}]`,
      cargado
    ].join(' · ');
  });
  const skins = [...document.querySelectorAll('.deck-card .deck-art img')]
    .filter(img => img.currentSrc).length;
  panel.textContent = [
    'DIAGNÓSTICO DE FICHAS (?debug=1)',
    `fichas con imagen cargada: ${skins}`,
    ...filas
  ].join('\n');
}

/* ------------------------------------------------------------------
   Barra de presentación del inicio
   Del segundo 0 al 30 —el mismo tramo en el que la tabla se aparta— el
   marcador y la banda de objetivos se retiran y en su sitio queda esta barra
   ancha y casi transparente: escudo y nombre de cada equipo, el VS y el logo
   del torneo en el centro. En cuanto las runas y las fichas se van, la barra
   sale y el marcador vuelve a su sitio.
   ------------------------------------------------------------------ */
const INTRO_FROM = 0;
const INTRO_UNTIL = DECK_UNTIL;   // 30 s: lo mismo que las runas y las fichas
const INTRO_LEAVE_MS = 300;
const introLogoAssets = new Set();
let introShown = false;
let introLeaveTimer = 0;
let introChromeHeld = false;
let introSignature = '';

// El marcador, la banda de objetivos y los dos temporizadores de las esquinas
// entran y salen juntos. Los temporizadores lo hacen deslizándose por su
// lateral: el de las vacularbas por la izquierda y el del dragón por la derecha
// (el desplazamiento se lo pone el CSS).
function setIntroChrome(held) {
  if (held === introChromeHeld) return;
  introChromeHeld = held;
  document.querySelectorAll('.topbar, .objective-ribbon, .objectives').forEach(element => {
    element.classList.toggle('is-intro-out', held);
  });
}

function updateIntroBanner(state) {
  const info = state?.info || {};
  const signature = JSON.stringify([
    info.blue, info.blueShort, info.blueLogo, info.red, info.redShort, info.redLogo,
    info.logo, info.tournament
  ]);
  if (signature === introSignature) return;
  introSignature = signature;

  for (const prefix of ['blue', 'red']) {
    const img = byId(`intro-${prefix}-logo`);
    const letter = byId(`intro-${prefix}-emblem`);
    const name = byId(`intro-${prefix}-name`);
    if (!img || !letter) continue;
    if (!introLogoAssets.has(prefix)) {
      wireImageFallback(img, letter);
      introLogoAssets.add(prefix);
    }
    const { fullName, shortName } = teamShortName(prefix, info);
    setText(letter, shortName.slice(0, 1));
    if (name) {
      setText(name, fullName);
      name.title = fullName;
    }
    // Debajo del escudo va el nombre completo del equipo, no las siglas.
    setImage(img, info?.[`${prefix}Logo`], `Logo de ${fullName}`, letter, shortName.slice(0, 1));
  }

  const torneo = byId('intro-tournament-logo');
  if (torneo) {
    if (!torneo._wired) {
      torneo._wired = true;
      torneo.addEventListener('error', () => { torneo.hidden = true; });
    }
    const fuente = typeof info.logo === 'string' && info.logo.trim() ? info.logo.trim() : '';
    if (fuente) {
      if (torneo.getAttribute('src') !== fuente) torneo.src = fuente;
      torneo.alt = info.tournament ? `Logo de ${info.tournament}` : 'Logo del torneo';
      torneo.hidden = false;
    } else {
      torneo.hidden = true;
      torneo.removeAttribute('src');
    }
  }
}

function showIntroBanner(container) {
  window.clearTimeout(introLeaveTimer);
  container.hidden = false;
  void container.offsetWidth;
  container.classList.remove('is-out');
  container.classList.add('is-in');
  introShown = true;
}

function hideIntroBanner(container) {
  if (!introShown) return;
  introShown = false;
  container.classList.remove('is-in');
  container.classList.add('is-out');
  window.clearTimeout(introLeaveTimer);
  introLeaveTimer = window.setTimeout(() => {
    if (introShown) return;
    container.hidden = true;
    container.classList.remove('is-out');
  }, INTRO_LEAVE_MS);
}

function renderIntroBanner(state) {
  const container = byId('intro-banner');
  if (!container) return;
  const gameTime = state?.meta?.gameTime;
  const visible = finite(gameTime) && gameTime >= INTRO_FROM && gameTime < INTRO_UNTIL;
  setIntroChrome(visible);
  if (!visible) {
    hideIntroBanner(container);
    return;
  }
  updateIntroBanner(state);
  if (!introShown) showIntroBanner(container);
}

/* ------------------------------------------------------------------
   Cámaras de los jugadores
   Dos cámaras a la vez: la del equipo que ocupa el lado izquierdo y la del que
   ocupa el derecho, siempre del MISMO rol. Del segundo 30 en adelante cambian
   de rol cada 20 s: TOP -> JUNGLA -> MID -> ADC -> SOPORTE y vuelta a empezar.

   Los enlaces son fijos (uno por equipo y rol): el jugador abre el suyo una vez
   y ya no tiene que hacer nada más, ni escribir su nombre. El equipo de cada
   lado lo manda el draft, así que si cambian de lado entre partidas, las
   cámaras se cambian de lado con ellos.

   La pareja siguiente se deja cargada en el segundo reproductor de cada caja:
   al cambiar de rol solo se destapa la que ya estaba lista, sin esperar.
   ------------------------------------------------------------------ */
const CAM_ROLES = ['top', 'jungle', 'mid', 'bot', 'support'];
// Cada cuánto se le pregunta a cada cámara si su jugador está emitiendo.
// VDO.Ninja contesta con la lista de conexiones que tiene abiertas.
const CAM_SONDEO_MS = 1000;
// Si VDO.Ninja no contesta nada en este tiempo, se deja de ocultar cajas y se
// vuelve al comportamiento de antes (mejor una caja vacía que ninguna cámara).
const CAM_ESPERA_MS = 12000;
const CAM_ETIQUETA = { top: 'TOP', jungle: 'JUNGLA', mid: 'MID', bot: 'ADC', support: 'SOPORTE' };
let camDatos = null;          // lo que devuelve /camaras/enlaces
let camPeticion = null;       // petición en curso
let camFirma = '';            // equipos para los que ya se pidieron enlaces
let camPareja = -1;           // índice de la pareja que se está mostrando
const camSlots = new Map();   // `${lado}` -> { iframes, cargado: Map }
const camVivos = new Map();   // id del enlace -> true si ese jugador está emitiendo
let camSondeo = 0;            // momento del último sondeo
let camRespuestas = 0;        // cuántas veces ha contestado VDO.Ninja
let camVisitando = null;      // desde cuándo se ven las cajas
let camSondeoCaido = false;   // VDO.Ninja no contesta: no se oculta nada
let camUltimoEstado = null;   // último estado pintado, para repintar al llegar respuesta

function camLineaDeJuego(juego) {
  return CAM_ROLES.includes(juego) ? juego : null;
}

// Nombre visible del jugador: el del juego, sin el #TAG ni el tag (displayName).
function camNombre(state, team, linea) {
  const jugador = (Array.isArray(state?.players) ? state.players : [])
    .find(player => player.team === team && camLineaDeJuego(player.role) === linea);
  return jugador ? displayName(jugador) : '—';
}

function camPedirEnlaces(azul, rojo) {
  const firma = `${azul}|${rojo}`;
  if (firma === camFirma || camPeticion) return;
  camPeticion = fetch(`/camaras/enlaces?azul=${encodeURIComponent(azul)}&rojo=${encodeURIComponent(rojo)}`)
    .then(respuesta => (respuesta.ok ? respuesta.json() : null))
    .then(datos => {
      if (!datos || !datos.equipos) return null;
      camDatos = datos;
      // Solo se da por buena cuando la respuesta llegó: si falló (el servidor
      // aún no estaba listo), se vuelve a intentar en el siguiente fotograma.
      camFirma = firma;
      return datos;
    })
    .catch(() => null)
    .finally(() => { camPeticion = null; });
}

function camSlot(caja, lado) {
  if (!camSlots.has(lado)) {
    camSlots.set(lado, {
      iframes: [...caja.querySelectorAll('.camara-video iframe')],
      cargado: new Map()   // `${equipo}|${linea}|${bucle}` -> iframe
    });
  }
  return camSlots.get(lado);
}

// Deja cargada la cámara de un equipo y línea en uno de los dos reproductores
// de la caja. Si ya estaba puesta, no se recarga (no hay parpadeo).
function camCargar(estado, equipo, linea, indice) {
  const iframe = estado.iframes[indice];
  if (!iframe || !equipo || !linea) return null;
  const datos = camDatos?.equipos?.[equipo]?.[linea];
  const url = datos?.ver || '';
  if (!url) return null;
  if (iframe.dataset.url !== url) {
    iframe.dataset.url = url;
    iframe.dataset.stream = datos.id || '';
    iframe.src = url;
    iframe.title = `Cámara de ${equipo} · ${CAM_ETIQUETA[linea]}`;
  }
  return iframe;
}

// ------------------------------------------------------------------
// ¿Está emitiendo el jugador?
// A cada cámara se le pregunta {getStreamIDs:true} y VDO.Ninja responde con las
// conexiones que tiene abiertas en ese momento. Si la lista viene vacía, ese
// jugador no está emitiendo y su caja no se muestra: así no queda un hueco
// negro cuando alguien no pone cámara.
// El reloj de la rotación no cambia: cada lado sigue su turno de 20 s, aunque
// una de las dos cajas esté oculta, para que el equipo que sí tiene cámaras no
// se desfase.
// ------------------------------------------------------------------
function camIframeDe(origen) {
  for (const iframe of document.querySelectorAll('.camara-video iframe')) {
    try { if (iframe.contentWindow === origen) return iframe; } catch { /* nada */ }
  }
  return null;
}

function camEscucharRespuestas() {
  window.addEventListener('message', (evento) => {
    const datos = evento.data;
    if (!datos || typeof datos !== 'object' || !datos.streamIDs || typeof datos.streamIDs !== 'object') return;
    const iframe = camIframeDe(evento.source);
    if (!iframe) return;
    const id = iframe.dataset.stream;
    if (!id) return;
    camRespuestas += 1;
    // La respuesta es de esta cámara en concreto: si no ve ninguna conexión
    // abierta, ese jugador no está emitiendo.
    const vivo = Object.keys(datos.streamIDs).length > 0;
    if (camVivos.get(id) !== vivo) {
      camVivos.set(id, vivo);
      if (camUltimoEstado) renderCamaras(camUltimoEstado);
    }
  }, false);
}

function camSondear() {
  const ahora = performance.now();
  if (ahora - camSondeo < CAM_SONDEO_MS) return;
  camSondeo = ahora;
  const aprendiendo = camVisitando !== null && !camSondeoCaido && camRespuestas === 0;
  if (aprendiendo && ahora - camVisitando > CAM_ESPERA_MS) {
    camSondeoCaido = true;
    if (camUltimoEstado) renderCamaras(camUltimoEstado);
  }
  for (const iframe of document.querySelectorAll('.camara-video iframe')) {
    const id = iframe.dataset.stream;
    if (!id) continue;
    try { iframe.contentWindow?.postMessage({ getStreamIDs: true, cib: id }, '*'); } catch { /* nada */ }
  }
}

function camPintarCaja(caja, lado, equipo, linea, state, indiceVisible) {
  const estado = camSlot(caja, lado);
  const elegida = camCargar(estado, equipo, linea, indiceVisible);
  const id = elegida?.dataset.stream || '';
  // La caja solo se muestra cuando ese jugador está emitiendo. Si VDO.Ninja
  // nunca contesta se cae al comportamiento de antes y se muestra igual.
  const emitiendo = Boolean(id) && (camSondeoCaido || camVivos.get(id) === true);
  estado.iframes.forEach(iframe => iframe.classList.toggle('is-on', iframe === elegida && emitiendo));
  caja.classList.toggle('is-viva', emitiendo);
  const rol = caja.querySelector('.camara-rol');
  const nombre = caja.querySelector('.camara-nombre');
  const chip = caja.querySelector('.camara-estado');
  if (rol) setText(rol, CAM_ETIQUETA[linea] || '');
  if (nombre) setText(nombre, camNombre(state, lado === 'izq' ? 1 : 2, linea));
  // El chip solo dice qué está mirando. VDO.Ninja no avisa al HUD si el jugador
  // ya entró (se comprobó: no manda ningún mensaje al conectar), así que poner
  // "EN VIVO" seria mentir: mientras no llegue imagen, la caja se ve oscura.
  if (chip) setText(chip, 'CÁMARA');
}

let camRelojListo = false;
function camArrancarReloj() {
  if (camRelojListo) return;
  camRelojListo = true;
  camEscucharRespuestas();
  setInterval(camSondear, CAM_SONDEO_MS);
}

function renderCamaras(state) {
  camArrancarReloj();
  camUltimoEstado = state;
  const contenedor = byId('camaras');
  if (!contenedor) return;
  const cajas = {
    izq: contenedor.querySelector('.camara-izq'),
    der: contenedor.querySelector('.camara-der')
  };
  if (!cajas.izq || !cajas.der) return;

  const azul = String(state?.info?.blue || '').trim();
  const rojo = String(state?.info?.red || '').trim();
  const ladosActuales = camDatos?.lados || {};
  if (azul && rojo && (ladosActuales.blue !== azul || ladosActuales.red !== rojo)) {
    camPedirEnlaces(azul, rojo);
  }

  const gameTime = state?.meta?.gameTime;
  const desde = finite(camDatos?.desdeSegundo) ? camDatos.desdeSegundo : 30;
  const cada = finite(camDatos?.cadaSegundos) && camDatos.cadaSegundos > 0 ? camDatos.cadaSegundos : 20;
  const orden = Array.isArray(camDatos?.orden) && camDatos.orden.length ? camDatos.orden : CAM_ROLES;
  const listo = camDatos?.activo !== false && azul && rojo
    && camDatos?.equipos?.[azul] && camDatos?.equipos?.[rojo];
  const visible = listo && finite(gameTime) && gameTime >= desde;

  if (!visible) {
    contenedor.hidden = true;
    contenedor.classList.remove('is-on');
    camPareja = -1;
    return;
  }

  if (contenedor.hidden) contenedor.hidden = false;
  if (camVisitando === null) camVisitando = performance.now();
  // Se pinta un fotograma con el contenedor aún sin la clase: así la entrada
  // se ve (sube y aparece) en vez de saltar.
  void contenedor.offsetWidth;
  contenedor.classList.add('is-on');

  const indice = Math.max(0, Math.floor((gameTime - desde) / cada)) % orden.length;
  const linea = orden[indice];
  const siguiente = orden[(indice + 1) % orden.length];
  const pareja = indice % 2;
  // El lado lo manda el HUD (info.blue / info.red), no la última respuesta del
  // servidor: si todavía no llegaron los enlaces del equipo que acaba de cambiar
  // de lado, se ve SIN SEÑAL un instante, nunca la cámara del equipo anterior.
  const equipoIzq = azul;
  const equipoDer = rojo;

  camPintarCaja(cajas.izq, 'izq', equipoIzq, linea, state, pareja);
  camPintarCaja(cajas.der, 'der', equipoDer, linea, state, pareja);

  // La siguiente pareja se va cargando en el otro reproductor: al cambiar de
  // rol solo se destapa, sin pantalla negra ni espera.
  if (camPareja !== indice) {
    camCargar(camSlot(cajas.izq, 'izq'), equipoIzq, siguiente, (pareja + 1) % 2);
    camCargar(camSlot(cajas.der, 'der'), equipoDer, siguiente, (pareja + 1) % 2);
  }
  camPareja = indice;
}

/* ------------------------------------------------------------------
   AVISOS DE ASESINATOS
   Los asesinatos ya llegan en el GameInfo (GameEvents.DeathEvents). El
   servidor los separa, quita los repetidos y encadena los del mismo
   campeón; aquí solo se pintan.

   · Arriba del minimapa va una fila por asesinato, con el matador y la
     víctima pegados y cada mitad con el color de su equipo. La fila nueva
     entra abajo y las anteriores suben. Cada fila dura 4 s.
   · El cartel central sale SOLO de triple en adelante (el doble no lleva
     cartel). Aparece 2 s después del último asesinato de la cadena, para
     dar tiempo a que encadene otro (de triple a cuádruple), y se queda
     4 s. Si encadena mientras está en pantalla, crece en el sitio.
   ------------------------------------------------------------------ */
const KILL_FEED_VISIBLE_MS = 4000;
const KILL_FEED_MAX_FILAS = 5;
const MULTIKILL_ESPERA_MS = 2000;
const MULTIKILL_VISIBLE_MS = 4000;
const MULTIKILL_TITULOS = { 3: 'ASESINATO TRIPLE', 4: 'ASESINATO CUÁDRUPLE', 5: 'ASESINATO PENTA' };

const killFeedVistos = new Set();
// Al conectar con una partida ya empezada no se repiten los asesinatos viejos,
// pero los de los últimos segundos SÍ tienen que salir: antes se perdía el
// primero de todos.
const KILL_FEED_ANTIGUEDAD_S = 3;
let killFeedPrimerEstado = true;
const multikill = { id: null, visible: false, mostrar: null, ocultar: null };

function inicialDe(parte) {
  const texto = String(nombreDeParte(parte) || '?').trim();
  return (texto[0] || '?').toUpperCase();
}

// Nombre visible de un jugador: nunca el # ni lo que venga detrás.
function sinEtiqueta(texto) {
  const valor = String(texto ?? '');
  const corte = valor.indexOf('#');
  return (corte >= 0 ? valor.slice(0, corte) : valor).trim();
}

// Lo que se escribe en el recuadro: el nombre del jugador si es un campeón, y
// el nombre del bicho si es un monstruo o «Torre» si es una torre.
function nombreDeParte(parte) {
  if (parte?.tipo === 'monstruo') return parte.nombre || 'Objetivo';
  if (parte?.tipo === 'torre') return parte.nombre || 'Torre';
  return sinEtiqueta(parte?.player) || parte?.champion || '—';
}

// El nombre se ajusta al hueco bajando el tamaño de letra: nunca se recorta
// con puntos suspensivos.
const KILL_NOMBRE_MAX_PX = 15;
const KILL_NOMBRE_MIN_PX = 9.5;
// Por debajo de este tamaño de letra no se baja si el reparto de la fila se
// puede ensanchar: antes se ensancha la mitad del nombre que se achica la letra.
const KILL_NOMBRE_COMODO_PX = 11.5;
function ajustarNombreDeAsesinato(elemento, minimo = KILL_NOMBRE_MIN_PX, permitirSalto = false) {
  elemento.style.fontSize = '';
  elemento.style.letterSpacing = '';
  elemento.style.whiteSpace = '';
  elemento.style.lineHeight = '';
  if (!elemento.clientWidth) return;
  let tamano = KILL_NOMBRE_MAX_PX;
  while (elemento.scrollWidth > elemento.clientWidth && tamano > minimo) {
    tamano = Math.max(minimo, tamano - 0.5);
    elemento.style.fontSize = `${tamano}px`;
  }
  if (elemento.scrollWidth > elemento.clientWidth) elemento.style.letterSpacing = '0';
  // Si aun así no cabe (nombre muy largo), se parte en dos renglones dentro de
  // la fila antes que recortarlo.
  if (permitirSalto && elemento.scrollWidth > elemento.clientWidth) {
    elemento.style.whiteSpace = 'normal';
    elemento.style.lineHeight = '0.92';
  }
}

// Ajuste de los dos nombres de una fila. Primero se respeta el reparto de
// siempre (58 % / 42 %). Si con ese reparto hay que bajar demasiado la letra,
// la fila se ensancha a lo que pidan los nombres, y solo entonces se achica.
function ajustarNombresDeFila(fila) {
  const nombres = [...fila.querySelectorAll('.kill-name')];
  const desborda = () => nombres.some(nombre => nombre.scrollWidth > nombre.clientWidth + 1);
  const ajustar = (minimo, salto) => {
    nombres.forEach(nombre => ajustarNombreDeAsesinato(nombre, minimo, salto));
  };
  fila.classList.remove('ancha');
  ajustar(KILL_NOMBRE_COMODO_PX, false);
  if (!desborda()) return;
  // Se ensancha el reparto de la fila antes de seguir achicando la letra.
  fila.classList.add('ancha');
  ajustar(KILL_NOMBRE_MIN_PX, false);
  if (!desborda()) return;
  // Último recurso, ya con la letra al mínimo: dos renglones antes que recortar.
  ajustar(KILL_NOMBRE_MIN_PX, true);
}

// Icono de cada mitad: la cara del campeón, la torre, o el bicho que ha muerto
// (con su variante si es un dragón elemental).
function iconoDeParte(parte, catalog) {
  if (parte?.tipo === 'torre') return './assets/objectives/tower.png';
  if (parte?.tipo === 'monstruo') {
    if (parte.kind === 'dragon') return dragonIconSource(parte.dragonType || null);
    const hoja = SECONDARY_OBJECTIVE_ICONS[parte.kind];
    return hoja ? `./assets/objectives/${hoja}.png` : null;
  }
  return parte?.champion && catalog ? catalog.championUrl(parte.champion) : null;
}

function mitadDeAsesinato(parte, rol, catalog) {
  const tipo = parte?.tipo === 'monstruo' || parte?.tipo === 'torre' ? parte.tipo : 'campeon';
  const mitad = document.createElement('span');
  mitad.className = `kill-half kill-${rol}`;
  mitad.dataset.tipo = tipo;
  // El color de la mitad sale del equipo: el del campeón, el de la torre caída,
  // y neutro para los monstruos, que no son de nadie.
  mitad.dataset.team = tipo === 'monstruo' ? '0' : parte?.team === 2 ? '2' : parte?.team === 1 ? '1' : '0';

  const icono = assetWithFallback('kill-icon-wrap', inicialDe(parte));
  icono.img.className = 'kill-icon';
  setImage(
    icono.img,
    iconoDeParte(parte, catalog),
    nombreDeParte(parte),
    icono.fallback,
    inicialDe(parte)
  );

  const nombre = document.createElement('span');
  nombre.className = 'kill-name';
  setText(nombre, nombreDeParte(parte));

  mitad.append(icono.wrap, nombre);
  return mitad;
}

// Desplazamiento suave de la banda: cuando entra una fila, la banda crece
// hacia arriba de golpe; en vez de eso se compensa ese salto y se suelta con
// una transición, así las filas anteriores suben deslizándose.
// Los movimientos se hacen con la Web Animations API: no dependen de reglas
// de CSS, así que se mueven igual aunque algo las pise.
const KILL_FEED_ENTRADA_MS = 380;
const KILL_FEED_ENTRADA_PX = 34;
const KILL_FEED_DESPLAZAMIENTO_MS = 380;
const KILL_FEED_SALIDA_MS = 260;
const KILL_FEED_CURVA = 'cubic-bezier(.16,.84,.28,1)';

function animar(elemento, fotogramas, opciones) {
  if (!elemento || typeof elemento.animate !== 'function') return null;
  try {
    return elemento.animate(fotogramas, opciones);
  } catch (error) {
    return null;
  }
}

// Desplazamiento en curso de la banda (0 si está quieta).
function desplazamientoVisual(elemento) {
  if (typeof getComputedStyle !== 'function') return 0;
  const valor = getComputedStyle(elemento).transform;
  if (!valor || valor === 'none') return 0;
  try {
    const matriz = new DOMMatrixReadOnly(valor);
    return Number.isFinite(matriz.m42) ? matriz.m42 : 0;
  } catch (error) {
    return 0;
  }
}

function desplazarBanda(contenedor, banda, posicionPrevia) {
  const desplazamiento = posicionPrevia - contenedor.offsetTop; // > 0: creció hacia arriba
  // Si la banda venía moviéndose, se arranca desde donde está en pantalla.
  const enCurso = typeof banda.getAnimations === 'function' ? banda.getAnimations() : [];
  const extra = enCurso.length ? desplazamientoVisual(banda) : 0;
  enCurso.forEach(animacion => animacion.cancel());
  const partida = desplazamiento + extra;
  if (!partida) return;
  animar(
    banda,
    [{ transform: `translateY(${partida}px)` }, { transform: 'translateY(0px)' }],
    { duration: KILL_FEED_DESPLAZAMIENTO_MS, easing: KILL_FEED_CURVA }
  );
}

// La banda de filas va dentro del contenedor: el contenedor recorta siempre en
// el mismo sitio (el borde de arriba del minimapa) y la banda es lo que se
// desliza, así la fila nueva nunca se asoma por encima del minimapa.
function bandaDeFilas(contenedor) {
  let banda = contenedor.querySelector('.kill-feed-inner');
  if (!banda) {
    banda = document.createElement('div');
    banda.className = 'kill-feed-inner';
    contenedor.append(banda);
  }
  return banda;
}

function agregarFilaAsesinato(contenedor, asesinato, catalog) {
  const banda = bandaDeFilas(contenedor);
  // Dónde está la banda ahora, antes de meter la fila nueva.
  const posicionPrevia = contenedor.offsetTop;

  const fila = document.createElement('div');
  fila.className = 'kill-row';
  // Las torres no traen matador: la fila lleva solo el recuadro de la torre.
  if (asesinato?.killer) {
    fila.append(mitadDeAsesinato(asesinato.killer, 'killer', catalog));
  } else {
    fila.classList.add('sola');
  }
  fila.append(mitadDeAsesinato(asesinato?.victim, 'victim', catalog));
  contenedor.hidden = false;
  banda.append(fila);
  const filas = banda.querySelectorAll('.kill-row');
  if (filas.length > KILL_FEED_MAX_FILAS) filas[0].remove();

  ajustarNombresDeFila(fila);
  desplazarBanda(contenedor, banda, posicionPrevia);

  // Entra desde abajo.
  const entrada = animar(
    fila,
    [
      { opacity: 0, transform: `translateY(${KILL_FEED_ENTRADA_PX}px)` },
      { opacity: 1, transform: 'translateY(0px)' }
    ],
    { duration: KILL_FEED_ENTRADA_MS, easing: KILL_FEED_CURVA, fill: 'backwards' }
  );
  if (!entrada) fila.classList.add('is-on');

  setTimeout(() => {
    if (typeof fila.getAnimations === 'function') {
      fila.getAnimations().forEach(animacion => animacion.cancel());
    }
    fila.classList.remove('is-on');
    fila.classList.add('is-saliendo');
    const salida = animar(
      fila,
      [
        { opacity: 1, transform: 'translateY(0px)' },
        { opacity: 0, transform: 'translateY(-9px)' }
      ],
      { duration: KILL_FEED_SALIDA_MS, easing: 'ease-in', fill: 'forwards' }
    );
    setTimeout(() => {
      // Al quitarse la fila la banda encoge, y las demás bajarían de golpe:
      // se compensa igual que al entrar, para que bajen deslizándose.
      const posicionPrevia = contenedor.offsetTop;
      fila.remove();
      desplazarBanda(contenedor, banda, posicionPrevia);
    }, salida ? KILL_FEED_SALIDA_MS : 0);
  }, KILL_FEED_VISIBLE_MS);
}

function renderKillFeed(state, catalog) {
  const contenedor = byId('kill-feed');
  if (!contenedor) return;
  const asesinatos = Array.isArray(state?.killFeed?.asesinatos) ? state.killFeed.asesinatos : [];
  const banda = bandaDeFilas(contenedor);
  if (!asesinatos.length) {
    killFeedVistos.clear();
    killFeedPrimerEstado = true;
    if (typeof banda.getAnimations === 'function') {
      banda.getAnimations().forEach(animacion => animacion.cancel());
    }
    banda.replaceChildren();
    banda.style.transition = '';
    banda.style.transform = '';
    contenedor.hidden = true;
    return;
  }
  const gameTime = finite(state?.meta?.gameTime) ? state.meta.gameTime : null;
  let nueva = false;
  for (const asesinato of asesinatos) {
    if (!asesinato?.id || killFeedVistos.has(asesinato.id)) continue;
    killFeedVistos.add(asesinato.id);
    const antiguo = killFeedPrimerEstado && gameTime !== null && finite(asesinato.gameTime)
      && gameTime - asesinato.gameTime > KILL_FEED_ANTIGUEDAD_S;
    if (antiguo) continue;
    agregarFilaAsesinato(contenedor, asesinato, catalog);
    nueva = true;
  }
  killFeedPrimerEstado = false;
  if (nueva) contenedor.hidden = false;
}

function pintarMultikill(cadena, catalog) {
  const elemento = byId('multikill');
  if (!elemento) return;
  const nivel = Math.min(Math.max(Math.round(cadena.nivel), 3), 5);
  elemento.dataset.nivel = String(nivel);
  setText(byId('multikill-title'), MULTIKILL_TITULOS[nivel] || '');

  const campeon = cadena?.killer?.champion || null;
  setImage(
    byId('multikill-icon'),
    campeon && catalog ? catalog.championUrl(campeon) : null,
    campeon ? (catalog.championName(campeon) || campeon) : '',
    null,
    ''
  );
}

function mostrarMultikill() {
  const elemento = byId('multikill');
  if (!elemento) return;
  elemento.hidden = false;
  requestAnimationFrame(() => elemento.classList.add('is-on'));
  multikill.visible = true;
}

function ocultarMultikill() {
  const elemento = byId('multikill');
  clearTimeout(multikill.mostrar);
  clearTimeout(multikill.ocultar);
  multikill.visible = false;
  if (!elemento) return;
  elemento.classList.remove('is-on');
  setTimeout(() => { if (!multikill.visible) elemento.hidden = true; }, 340);
}

function renderMultikill(state, catalog) {
  const cadena = state?.killFeed?.cadena || null;
  const nivel = finite(cadena?.nivel) ? cadena.nivel : 0;
  if (nivel < 3 || !cadena?.id) {
    multikill.id = null;
    clearTimeout(multikill.mostrar);
    if (multikill.visible) ocultarMultikill();
    return;
  }
  if (cadena.id === multikill.id) return;   // misma cadena: no se toca
  multikill.id = cadena.id;
  pintarMultikill(cadena, catalog);

  clearTimeout(multikill.mostrar);
  clearTimeout(multikill.ocultar);
  if (multikill.visible) {
    // Ya estaba en pantalla: se actualiza en el sitio y se le reinician los 4 s.
    multikill.ocultar = setTimeout(ocultarMultikill, MULTIKILL_VISIBLE_MS);
    return;
  }
  multikill.mostrar = setTimeout(() => {
    mostrarMultikill();
    multikill.ocultar = setTimeout(ocultarMultikill, MULTIKILL_VISIBLE_MS);
  }, MULTIKILL_ESPERA_MS);
}

/* ------------------------------------------------------------------
   R104 · Colores del HUD
   El panel manda tres colores base en info.tema: acento, azul y rojo. Hasta
   ahora el ingame los recibía y no hacía nada con ellos, así que se quedaba
   siempre con el dorado y el azul/rojo de fábrica. Aquí se cambian las
   variables de la hoja de estilos, y los tonos claros y oscuros se calculan
   solos a partir de esos tres.
   ------------------------------------------------------------------ */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
let temaAplicado = '';

function canalesHex(hex) {
  const h = String(hex).replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)).join(' ');
}

// Mezcla hacia blanco (factor > 0) para los tonos claros de cada lado.
function aclararHex(hex, factor) {
  const h = String(hex).replace('#', '');
  return '#' + [0, 2, 4].map(i => {
    const valor = parseInt(h.substr(i, 2), 16);
    return Math.round(valor + (255 - valor) * factor).toString(16).padStart(2, '0');
  }).join('');
}

// Mezcla hacia negro para los bordes y los degradados oscuros.
function oscurecerHex(hex, factor) {
  const h = String(hex).replace('#', '');
  return '#' + [0, 2, 4].map(i => {
    const valor = parseInt(h.substr(i, 2), 16);
    return Math.round(valor * (1 - factor)).toString(16).padStart(2, '0');
  }).join('');
}

function aplicarTemaHUD(tema) {
  if (!tema || typeof tema !== 'object') return;
  const limpio = valor => (HEX_COLOR.test(String(valor || '').trim()) ? String(valor).trim().toLowerCase() : null);
  const acento = limpio(tema.acento);
  const azul = limpio(tema.azul);
  const rojo = limpio(tema.rojo);
  const firma = [acento, azul, rojo].join('|');
  if (!acento && !azul && !rojo) return;
  if (firma === temaAplicado) return;   // ya está puesto: no se toca en cada estado
  temaAplicado = firma;

  const raiz = document.documentElement.style;
  if (acento) {
    raiz.setProperty('--accent', acento);
    raiz.setProperty('--accent-rgb', canalesHex(acento));
    raiz.setProperty('--accent-dark', oscurecerHex(acento, .58));
    raiz.setProperty('--p-gold-400', acento);
  }
  if (azul) {
    const claro = aclararHex(azul, .45);
    raiz.setProperty('--team-blue', azul);
    raiz.setProperty('--team-blue-rgb', canalesHex(azul));
    raiz.setProperty('--team-blue-dark', oscurecerHex(azul, .55));
    raiz.setProperty('--p-blue-500', azul);
    raiz.setProperty('--p-blue-300', claro);
    raiz.setProperty('--p-blue-300-rgb', canalesHex(claro));
  }
  if (rojo) {
    const claro = aclararHex(rojo, .45);
    raiz.setProperty('--team-red', rojo);
    raiz.setProperty('--team-red-rgb', canalesHex(rojo));
    raiz.setProperty('--team-red-dark', oscurecerHex(rojo, .55));
    raiz.setProperty('--p-red-500', rojo);
    raiz.setProperty('--p-red-300', claro);
    raiz.setProperty('--p-red-300-rgb', canalesHex(claro));
  }
}

/* ------------------------------------------------------------------
   R105 · MAPA GIGANTE
   El mapa de la Grieta se abre a pantalla completa y enseña dónde está cada
   jugador. La imagen ya viene en perspectiva, así que el trabajo es pasar las
   coordenadas del juego a píxeles de esa imagen.

   MAPA_H es la proyección del plano del mapa: se sacó midiendo los dos nexos
   sobre la imagen. Va de (0,0) —esquina de arriba a la izquierda— a (1,1).
   ------------------------------------------------------------------ */
const MAPA_MIN = -120;
const MAPA_MAX = 14820;
const MAPA_ANCHO = 1920;                 // tamaño del archivo grieta-3d.webp
const MAPA_ALTO = 1080;
const MAPA_ESCALA = 1;                   // se pinta a tamaño natural
// Proyección medida sobre la imagen nueva. Error 0 px en los 49 puntos
// de control: los dos nexos, el dragón, el barón y el borde del mapa.
const MAPA_H = [[739.176495, -352.485070, 512.885086],
                [-25.693254, 253.218772, 189.375535],
                [-0.074198, -0.360684, 1.0]];

const mapaGlobos = new Map();            // jugador -> nodo

/* ------------------------------------------------------------------
   Máscara del terreno. Se lee el contorno de la propia imagen del mapa para
   saber dónde hay suelo: así ningún globo queda colgando en el vacío y las
   líneas de bot y top no se ven aplastadas contra el borde.
   ------------------------------------------------------------------ */
const mapaMascara = { datos: null, w: 0, h: 0 };
(function prepararMascara() {
  if (typeof document === 'undefined') return;
  const img = new Image();
  img.onload = () => {
    const w = 480, h = Math.max(1, Math.round(480 * img.height / img.width));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    try {
      mapaMascara.datos = g.getImageData(0, 0, w, h).data;
      mapaMascara.w = w; mapaMascara.h = h;
    } catch (e) { /* sin permiso para leer píxeles: se sigue sin máscara */ }
  };
  img.src = './assets/map/grieta-3d-r124.webp';
})();

function hayTerreno(x, y) {
  const m = mapaMascara;
  if (!m.datos) return true;                  // sin máscara no se toca nada
  const px = Math.round((x / MAPA_ANCHO) * m.w);
  const py = Math.round((y / MAPA_ALTO) * m.h);
  if (px < 0 || py < 0 || px >= m.w || py >= m.h) return false;
  return m.datos[(py * m.w + px) * 4 + 3] > 110;
}

// Coordenadas del juego (x, z) a un punto de la imagen del mapa.
function puntoDelMapa(x, z) {
  const u = (x - MAPA_MIN) / (MAPA_MAX - MAPA_MIN);
  const v = 1 - (z - MAPA_MIN) / (MAPA_MAX - MAPA_MIN);
  // Si la posición se sale del mapa (un dato raro del sensor, o alguien en la
  // fuente), no se pinta nada: mejor ningún globo que uno en el sitio erróneo.
  if (u < -0.015 || u > 1.015 || v < -0.015 || v > 1.015) return null;
  const w = MAPA_H[2][0] * u + MAPA_H[2][1] * v + MAPA_H[2][2];
  if (!finite(w) || Math.abs(w) < 1e-6) return null;
  return {
    x: (MAPA_H[0][0] * u + MAPA_H[0][1] * v + MAPA_H[0][2]) / w,
    y: (MAPA_H[1][0] * u + MAPA_H[1][1] * v + MAPA_H[1][2]) / w,
    v,                                    // 0 = fondo del mapa, 1 = primer plano
  };
}

/* ---- Modo cámara: las burbujas sobre el juego real -----------------------
   El juego no deja MOVER su cámara, pero sí deja LEERLA (/camara/leer).
   Con su posición, su giro y su campo de visión se calcula en qué píxel de la
   pantalla cae cada campeón, y las burbujas van encima del mapa de verdad.

   Convención comprobada contra una captura real del juego:
       rot.x = giro horizontal (yaw)
       rot.y = inclinación     (56 = como el modo top, 90 = al suelo)
       fieldOfView = campo vertical
   ------------------------------------------------------------------ */
const camara = { pos: null, rot: null, fov: 40, valida: false };

function refrescarCamara() {
  if (typeof fetch !== 'function') return;
  fetch('/camara/leer', { cache: 'no-store' })
    .then(r => r.json())
    .then(j => {
      const g = j && j.juego;
      if (!g || !g.cameraPosition || !g.cameraRotation) { camara.valida = false; return; }
      camara.pos = g.cameraPosition;
      camara.rot = g.cameraRotation;
      camara.fov = Number(g.fieldOfView) || 40;
      camara.valida = true;
    })
    .catch(() => { camara.valida = false; });
}
if (typeof window !== 'undefined') {
  refrescarCamara();
  setInterval(refrescarCamara, 250);
}

function proyectarCamara(x, z) {
  if (!camara.valida || !camara.pos || !camara.rot) return null;
  const W = MAPA_ANCHO, H = MAPA_ALTO;
  const psi = camara.rot.x * Math.PI / 180;
  const theta = camara.rot.y * Math.PI / 180;
  const cf = Math.cos(theta);
  const f = [Math.sin(psi) * cf, -Math.sin(theta), Math.cos(psi) * cf];   // hacia dónde mira
  const rg = [Math.cos(psi), 0, -Math.sin(psi)];                          // derecha
  const up = [                                                            // arriba (f x rg)
    f[1] * rg[2] - f[2] * rg[1],
    f[2] * rg[0] - f[0] * rg[2],
    f[0] * rg[1] - f[1] * rg[0]
  ];
  const v = [x - camara.pos.x, -camara.pos.y, z - camara.pos.z];
  const zc = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
  if (zc <= 1) return null;
  const xc = v[0] * rg[0] + v[1] * rg[1] + v[2] * rg[2];
  const yc = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
  const fv = camara.fov * Math.PI / 180;
  const fh = 2 * Math.atan(Math.tan(fv / 2) * (W / H));
  const sx = W / 2 + (xc / zc) / Math.tan(fh / 2) * (W / 2);
  const sy = H / 2 - (yc / zc) / Math.tan(fv / 2) * (H / 2);
  if (!finite(sx) || !finite(sy)) return null;
  return { x: sx, y: sy, v: 0.5 };
}

/* ------------------------------------------------------------------
   Comprobación a mano: la tecla P pone cuatro marcas en el nexo azul, el
   nexo rojo, el dragón y el barón. Si caen donde toca, el mapa y las
   cuentas están bien y lo que falla son las posiciones que llegan.
   ------------------------------------------------------------------ */
const MARCAS = [
  { n: 'AZUL',   x: 1450,  z: 1500  },
  { n: 'ROJO',   x: 13250, z: 13350 },
  { n: 'DRAGON', x: 9750,  z: 4400  },
  { n: 'BARON',  x: 5000,  z: 10450 }];
let marcasPuestas = false;

function alternarMarcas() {
  const caja = byId('mapa-globos');
  if (!caja) return;
  marcasPuestas = !marcasPuestas;
  caja.querySelectorAll('.mapa-marca').forEach(n => n.remove());
  if (!marcasPuestas) return;
  for (const m of MARCAS) {
    const p = puntoDelMapa(m.x, m.z);
    if (!p) continue;
    const el = document.createElement('div');
    el.className = 'mapa-marca';
    el.textContent = m.n;
    el.style.left = `${(p.x / MAPA_ANCHO) * 100}%`;
    el.style.top = `${(p.y / MAPA_ALTO) * 100}%`;
    caja.appendChild(el);
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', e => {
    if (e.key === 'p' || e.key === 'P') alternarMarcas();
  });
}

/* Desliza cada burbuja hacia su destino. Se para solo cuando todas han
   llegado, para no dejar una animación corriendo sin necesidad. */
let bucleBurbujas = 0;
function arrancarSuavizado() {
  if (bucleBurbujas) return;
  bucleBurbujas = requestAnimationFrame(pasoSuavizado);
}
function pasoSuavizado() {
  bucleBurbujas = 0;
  let sigue = false;
  for (const globo of mapaGlobos.values()) {
    if (!finite(globo.tx) || !finite(globo.ty) || !finite(globo.cx)) continue;
    const dx = globo.tx - globo.cx;
    const dy = globo.ty - globo.cy;
    if (Math.abs(dx) < 0.015 && Math.abs(dy) < 0.015) {
      globo.cx = globo.tx;
      globo.cy = globo.ty;
    } else {
      /* Se va frenando al llegar, y ademas tiene tope de velocidad para que
         el arranque no sea un tiron. */
      let mx = dx * 0.14;
      let my = dy * 0.14;
      const largo = Math.hypot(mx, my);
      const TOPE = 2.2;
      if (largo > TOPE) { mx = (mx / largo) * TOPE; my = (my / largo) * TOPE; }
      globo.cx += mx;
      globo.cy += my;
      sigue = true;
    }
    globo.el.style.left = `${globo.cx}%`;
    globo.el.style.top = `${globo.cy}%`;
  }
  if (sigue) bucleBurbujas = requestAnimationFrame(pasoSuavizado);
}

/* El recuadro oscuro de la esquina (el marco del minimapa) se tapa y en su
   sitio va el logo del torneo, lo mas grande que quepa. */
let logoMinimapa = null;
function renderLogoMinimapa(state, mostrar) {
  const marco = document.querySelector('.minimap-frame');
  if (!marco) return;
  if (!logoMinimapa) {
    const caja = document.createElement('div');
    caja.className = 'minimap-logo';
    const img = document.createElement('img');
    img.alt = '';
    img.addEventListener('error', () => { img.hidden = true; });
    caja.appendChild(img);
    caja._img = img;
    marco.appendChild(caja);
    logoMinimapa = caja;
  }

  const info = state && state.info ? state.info : {};
  let fuente = typeof info.logo === 'string' && info.logo.trim() ? info.logo.trim() : '';
  /* Si el estado no trae el logo, se usa el mismo que ya esta puesto en la
     intro o en el panel de pelea: asi sale siempre. */
  if (!fuente) {
    for (const id of ['intro-tournament-logo', 'fight-tournament-logo']) {
      const otro = byId(id);
      const src = otro && otro.getAttribute('src');
      if (src && src.trim()) { fuente = src.trim(); break; }
    }
  }
  const img = logoMinimapa._img;
  if (fuente) {
    if (img.getAttribute('src') !== fuente) img.src = fuente;
    img.hidden = false;
    logoMinimapa.title = info.tournament ? String(info.tournament) : '';
  } else {
    img.hidden = true;
  }

  marco.classList.toggle('con-logo', mostrar === true);
}

let mapaAbiertoEn = 0;
let globosMostrados = false;
/* El difuminado del alrededor: tapa las rocas y el vacio que quedan fuera
   del mapa para que todo se vea parejo. Va dentro del mapa grande y solo se
   enciende con la camara arriba. */
let vineta = null;
function asegurarVineta() {
  if (vineta) return;
  const capa = byId('mapa-gigante');
  if (!capa) return;
  const d = document.createElement('div');
  d.className = 'mapa-vineta';
  capa.insertBefore(d, capa.firstChild);
  vineta = d;
}

/* ==================================================================
   TARJETAS DE ESTADISTICAS DEL MAPA GRANDE
   Un jugador por lado (el del equipo azul a la izquierda, el del rojo a
   la derecha) con sus estadisticas de combate. Van cambiando cada cinco
   segundos por linea: top, jungla, mid, adc, support.
   ================================================================== */
function renderMapaGigante(state, catalog) {
  const capa = byId('mapa-gigante');
  const caja = byId('mapa-globos');
  if (!capa || !caja) return;

  const abierto = state?.mapOpen === true || window.__mapaAbierto === true;
  if (abierto !== capa.classList.contains('is-open')) {
    capa.classList.toggle('is-open', abierto);
    capa.setAttribute('aria-hidden', abierto ? 'false' : 'true');
    if (abierto) mapaAbiertoEn = performance.now();
  }
  /* Con el mapa abierto se apartan las runas del inicio y la presentacion de
     jugadores: si no, se comen las tarjetas de estadisticas. Solo se ocultan
     mientras el mapa esta abierto; su cuenta atras sigue igual. */
  if (abierto !== document.body.classList.contains('mapa-abierto')) {
    document.body.classList.toggle('mapa-abierto', abierto);
  }

  const players = Array.isArray(state?.players) ? state.players : [];
  const situados = players.filter(player =>
    finite(player?.position?.x) && finite(player?.position?.z)
  );

  /* Si el juego nos deja leer su cámara, las burbujas van encima del mapa de
     verdad y no hace falta el mapa dibujado. Si no, se sigue igual que antes. */
  const modoCamara = camara.valida && camara.pos !== null;
  if (modoCamara !== capa.classList.contains('modo-camara')) {
    capa.classList.toggle('modo-camara', modoCamara);
  }
  renderLogoMinimapa(state, modoCamara && abierto);
  asegurarVineta();

  /* La camara tarda un par de segundos en subir. Mientras sube, los globos
     se quedan escondidos: si no, se les ve colocarse mal y luego recolocarse. */
  const alturaCamara = modoCamara && camara.pos ? Number(camara.pos.y) : 0;
  /* Se espera a que la camara este arriba de verdad. La red de seguridad
     (4,5 s) evita que los globos se queden escondidos si algo falla. */
  const camaraArriba = !modoCamara || alturaCamara > 9000
    || (mapaAbiertoEn > 0 && performance.now() - mapaAbiertoEn > 4500);


  const vistos = new Set();
  situados.forEach((player, indice) => {
    const clave = player.id ?? `${player.team}-${player.role}-${indice}`;
    /* Se apunta SIEMPRE que el jugador esta en la lista. Antes, si la cuenta
       de la posicion fallaba un solo fotograma, el globo se borraba y habia
       que volver a crearlo: por eso a veces desaparecian y volvian. */
    vistos.add(clave);

    let punto = modoCamara
      ? proyectarCamara(player.position.x, player.position.z)
      : puntoDelMapa(player.position.x, player.position.z);

    /* Si la cuenta falla un instante, se usa la ultima posicion buena que
       hubiera: el globo se queda quieto en vez de desaparecer. */
    const previo = mapaGlobos.get(clave);
    if (!punto && previo && previo.ultimo) punto = previo.ultimo;
    if (!punto) return;
    if (modoCamara) {
      // Respaldo: no salirse de la pantalla por un valor raro.
      if (!(punto.x > -400 && punto.x < MAPA_ANCHO + 400
            && punto.y > -400 && punto.y < MAPA_ALTO + 400)) {
        if (previo && previo.ultimo) punto = previo.ultimo;
        else return;
      }
    }

    let globo = mapaGlobos.get(clave);
    if (!globo) {
      const el = document.createElement('div');
      el.className = 'mapa-globo';
      const sombra = document.createElement('div');
      sombra.className = 'mapa-sombra';
      const pin = document.createElement('div');
      pin.className = 'mapa-pin';
      const aro = document.createElement('div');
      aro.className = 'mapa-aro';
      const img = document.createElement('img');
      img.alt = '';
      const letra = document.createElement('span');
      letra.textContent = '?';
      aro.append(img, letra);
      pin.appendChild(aro);
      el.append(sombra, pin);
      caja.appendChild(el);
      globo = { el, img, letra, campeon: null };
      mapaGlobos.set(clave, globo);
    }

    globo.el.classList.toggle('blue', player.team === 1);
    globo.el.classList.toggle('red', player.team === 2);
    globo.el.classList.toggle('is-dead', player.alive === false);

    if (globo.campeon !== player.champion) {
      globo.campeon = player.champion;
      const url = player.champion && catalog ? catalog.championUrl(player.champion) : null;
      if (url) {
        globo.img.hidden = false;
        globo.img.src = url;
        globo.img.onerror = () => { globo.img.hidden = true; };
        globo.letra.hidden = true;
      } else {
        globo.img.hidden = true;
        globo.letra.hidden = false;
        globo.letra.textContent = String(player.champion || '?').slice(0, 2).toUpperCase();
      }
    }

    /* La posición no se pone de golpe: se guarda como destino y el globo va
       deslizándose hasta ella. Así el movimiento se ve continuo y no a
       tirones, que es lo que pasaba cuando el juego manda datos a saltos. */
    globo.ultimo = punto;
    globo.tx = (punto.x / MAPA_ANCHO) * 100;
    globo.ty = (punto.y / MAPA_ALTO) * 100;
    if (!finite(globo.cx) || !finite(globo.cy)) {
      globo.cx = globo.tx;
      globo.cy = globo.ty;
      globo.el.style.left = `${globo.cx}%`;
      globo.el.style.top = `${globo.cy}%`;
    }
    arrancarSuavizado();
    // Los de delante se ven un poco más grandes, como en el juego.
    const tam = (16 + 10 * punto.v) * 1.5 * MAPA_ESCALA;

    /* El punto es exacto: la punta de la flecha cae justo ahí. Si ese punto
       está fuera del terreno (las líneas de bot y top van por el borde), el
       aro se aparta hacia dentro del mapa y la flecha se estira para seguir
       señalando el sitio. */
    let sep = 0, dx = 0;
    /* En modo cámara la posición ya sale exacta del juego: no se aparta nada. */
    if (!modoCamara && !hayTerreno(punto.x, punto.y)) {
      const ang = Math.atan2(MAPA_ALTO / 2 - punto.y, MAPA_ANCHO / 2 - punto.x);
      for (let d = 8; d <= 320; d += 8) {
        const tx = punto.x + Math.cos(ang) * d;
        const ty = punto.y + Math.sin(ang) * d;
        if (hayTerreno(tx, ty)) {
          dx = tx - punto.x;
          sep = Math.max(0, punto.y - ty);
          break;
        }
      }
    }

    /* Si dos globos se pisan se apartan, pero MUY poco: como mucho media
       burbuja. Antes se empujaban hasta 70 px y los que iban juntos en el
       carril acababan encima de la piedra. Si aun así no caben, se hacen un
       poco más pequeños en vez de seguir separándose. */
    let escalaGrupo = 1;
    const tope = tam * 0.5;
    if (!modoCamara) for (const otro of mapaGlobos.values()) {
      if (otro === globo || !otro.colocado) continue;
      const ddx = (punto.x + dx) - otro.colocado.x;
      const ddy = (punto.y - sep) - otro.colocado.y;
      const dist = Math.hypot(ddx, ddy);
      if (dist < tam * 1.05) {
        const falta = tam * 1.05 - dist;
        const signo = ddx >= 0 ? 1 : -1;
        dx = Math.max(-tope, Math.min(tope, dx + signo * falta * 0.5));
        sep = Math.max(sep, Math.min(tope, sep + falta * 0.45));
        escalaGrupo = 0.82;
      }
    }

    globo.colocado = { x: punto.x + dx, y: punto.y - sep };
    globo.el.style.setProperty('--tam', `${(tam * escalaGrupo).toFixed(1)}px`);
    globo.el.style.setProperty('--sep', `${sep.toFixed(1)}px`);
    globo.el.style.setProperty('--dx', `${dx.toFixed(1)}px`);
  });

  mapaGlobos.forEach((globo, clave) => {
    if (vistos.has(clave)) return;
    globo.el.remove();
    mapaGlobos.delete(clave);
  });

  /* Una vez que salen, ya no se esconden hasta que se cierra el mapa. Asi no
     parpadean si la lectura de la camara falla un instante. */
  if (!abierto) globosMostrados = false;
  else if (camaraArriba) globosMostrados = true;

  // Al abrirse, los globos entran uno detrás de otro (solo si la camara llego).
  if (abierto && (camaraArriba || globosMostrados)) {
    [...mapaGlobos.values()].forEach((globo, i) => {
      if (globo.el.classList.contains('subiendo')) return;
      globo.el.style.animationDelay = `${360 + i * 55}ms`;
      globo.el.classList.add('subiendo');
    });
  } else {
    mapaGlobos.forEach(globo => globo.el.classList.remove('subiendo'));
  }
}

export function renderIngameState(state, catalog) {
  if (!state || typeof state !== 'object') return;
  aplicarTemaHUD(state.info?.tema);
  if (MODOS_PELEA.includes(state.fightMode)) modoPelea = state.fightMode;
  if (cardDebug) renderCardDebug(state);
  activeCatalog = catalog;
  aplicarModo(modoDePartida(state));
  const teams = Array.isArray(state.teams) ? state.teams : [];
  const players = Array.isArray(state.players) ? state.players : [];
  renderTeams(teams);
  renderTeamIdentities(state.info);
  renderPatch(catalog);
  renderSeries(state.score);
  renderRuneIntro(state, catalog);
  renderDeck(state, catalog);
  renderIntroBanner(state);
  renderCamaras(state);
  renderFight(state, catalog);
  renderMapaGigante(state, catalog);
  avisarVisibilidad();
  setText(byId('game-time'), formatTime(state.meta?.gameTime));

  if (modoActual === '1v1') renderUnoContraUno(state);

  renderDragonObjective(state);
  renderSecondaryObjective(state);
  renderObjectiveBuffs(state);

  const blueContainer = byId('blue-players');
  const redContainer = byId('red-players');
  blueContainer._players = players.filter(player => player.team === 1);
  redContainer._players = players.filter(player => player.team === 2);
  const bluePlayers = renderTeamPlayers(1, blueContainer);
  const redPlayers = renderTeamPlayers(2, redContainer);
  renderGoldMatchups(bluePlayers, redPlayers);
  renderKillFeed(state, catalog);
  renderMultikill(state, catalog);
}
