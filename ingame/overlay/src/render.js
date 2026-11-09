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

function renderTeamIdentity(prefix, info) {
  const { fullName, shortName } = teamShortName(prefix, info);

  setText(byId(`${prefix}-name`), shortName);
  byId(`${prefix}-name`).title = fullName;
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

  const referencias = { hpFill, hp, mpFill, mp, refs, level, portrait: portrait.wrap };
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
  refs.mpFill.style.width = `${fightPercent(player.resource?.current, player.resource?.max)}%`;
  refs.mp.title = `Maná ${Math.round(player.resource?.current ?? 0)} / ${Math.round(player.resource?.max ?? 0)}`;
  setText(refs.level, finite(player.level) ? player.level : '—');
  // Mismo marco que la tabla, aplicado al retrato de la ficha.
  const buff = player.alive === false ? null : player.objectiveBuff || null;
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
  const fight = updateFight(players);
  renderFightLogo(state?.info);
  if (fight.active !== true) {
    hideFightStrip();
    return;
  }

  // Solo los que están dentro de la pelea: ni muertos ni los de fuera. El
  // filtro de vivos también actúa durante la salida, cuando la lista de
  // participantes se queda congelada unos segundos.
  const dentro = new Set([...(fight.blue || []), ...(fight.red || [])]);
  const enPie = player => dentro.has(player.id) && player.alive !== false;
  const blue = players.filter(player => player.team === 1 && enPie(player));
  const red = players.filter(player => player.team === 2 && enPie(player));
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
    for (const role of ROLE_ORDER) {
      const player = players.find(candidate => candidate.team === team && candidate.role === role);
      if (!player) continue;
      const card = buildDeckCard(player, catalog, side);
      card.dataset.role = role;
      container.append(card);
    }
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
  // Con menos de diez jugadores no hay presentación que valga.
  const hayEquipos = finite(gameTime) && players.length >= 10;
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
  const hasResource = finite(player.resource?.max) && player.resource.max > 0;
  refs.resourceBar.hidden = !hasResource;
  if (hasResource) setBar(refs.resourceFill, player.resource.current, player.resource.max);

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
    setText(timer, 'EN JUEGO');
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
  while (container.children.length < 5) {
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
    setText(row.querySelector('small'), roleLabels[index] || 'LINEA');
    const differenceElement = row.querySelector('strong');
    differenceElement.classList.remove('advantage-blue', 'advantage-red');
    if (finite(blueGold) && finite(redGold)) {
      const difference = blueGold - redGold;
      const sign = difference > 0 ? '+' : difference < 0 ? '-' : '±';
      setText(differenceElement, `${sign}${formatGold(Math.abs(difference))}`);
      differenceElement.classList.add(difference > 0 ? 'advantage-blue' : difference < 0 ? 'advantage-red' : 'advantage-neutral');
      row.title = `Diferencia de oro total en ${roleLabels[index] || 'la línea'}`;
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

export function renderIngameState(state, catalog) {
  if (!state || typeof state !== 'object') return;
  if (cardDebug) renderCardDebug(state);
  activeCatalog = catalog;
  const teams = Array.isArray(state.teams) ? state.teams : [];
  const players = Array.isArray(state.players) ? state.players : [];
  renderTeams(teams);
  renderTeamIdentities(state.info);
  renderPatch(catalog);
  renderSeries(state.score);
  renderRuneIntro(state, catalog);
  renderDeck(state, catalog);
  renderFight(state, catalog);
  setText(byId('game-time'), formatTime(state.meta?.gameTime));

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
}
