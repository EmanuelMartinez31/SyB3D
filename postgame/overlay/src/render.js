// POSTPARTIDA · CONSTRUCCIÓN DE LA INTERFAZ
// Convierte el resumen JSON en encabezado, franjas de equipo y diez tarjetas.

import { selectMvp } from './mvp.js';

// ============================================================================
// 1. FORMATO DE DATOS
// Estas funciones convierten valores del resumen en texto legible y seguro.
// ============================================================================
const ROLE_LABELS = { TOP: 'TOP', JUNGLE: 'JG', MIDDLE: 'MID', BOTTOM: 'ADC', UTILITY: 'SUP' };
const numberFormat = new Intl.NumberFormat('es-ES');

function text(value, fallback = '—') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}
function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : '—';
}
function compact(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value / 1000).toFixed(1)}K`
    : '—';
}
function duration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '00:00';
  const total = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function shortTeam(side, info) {
  const fallback = side === 'blue' ? 'AZUL' : 'ROJO';
  const fullName = String(info?.[side] || fallback).trim() || fallback;
  const words = fullName.split(/\s+/).filter(Boolean);
  const generated =
    words.length > 1
      ? words
          .map((word) => word[0])
          .join('')
          .slice(0, 4)
      : fullName.slice(0, 4);
  return (
    String(info?.[`${side}Short`] || info?.[`${side}Tag`] || generated)
      .trim()
      .toUpperCase() || fallback
  );
}
// El resumen puede conservar Nombre#TAG, pero la pantalla muestra solo Nombre.
function playerDisplayName(value) {
  const name = String(value || 'Jugador');
  const tag = name.lastIndexOf('#');
  return (tag >= 0 ? name.slice(0, tag) : name).trim() || 'Jugador';
}
function setText(root, selector, value) {
  root.querySelector(selector).textContent = text(value);
}
// ============================================================================
// 2. ESTRUCTURA HTML DE UNA TARJETA
// Se crea una sola vez por jugador. styles.css posiciona cada uno de estos bloques.
// ============================================================================
function cardTemplate(side) {
  const card = document.createElement('article');
  card.className = `card ${side === 'red' ? 'redcard' : ''}`;
  card.innerHTML = `
    <div class="mvp" hidden>MVP</div>
    <div class="role"></div>
    <img class="team-watermark" alt="" hidden>
    <div class="model3d"><img class="model-fallback" alt="" hidden><span class="model-missing" hidden>MODELO 3D NO DISPONIBLE</span></div>
    <div class="identity"><strong></strong><span></span></div>
    <div class="stats">
      <div class="kda-label">K / D / A</div><div class="kda"></div><div class="kda-ratio"></div>
    </div>
    <div class="runepage" aria-label="Runas del jugador">
      <div class="rune-tree primary">
        <div class="rune-tree-head">
          <img class="rune-icon style" data-rune="primary" alt="" hidden>
          <strong class="rune-tree-name" data-tree="primary"></strong>
        </div>
        <div class="rune-line" data-line="primary"></div>
      </div>
      <div class="rune-tree secondary">
        <div class="rune-tree-head">
          <img class="rune-icon style" data-rune="secondary" alt="" hidden>
          <strong class="rune-tree-name" data-tree="secondary"></strong>
        </div>
        <div class="rune-line" data-line="secondary"></div>
      </div>
      <div class="rune-shards"></div>
    </div>
    <div class="statgrid">
      <div class="ministat"><span>CS</span><strong data-stat="cs"></strong></div>
      <div class="ministat"><span>ORO</span><strong data-stat="gold"></strong></div>
      <div class="ministat"><span>DAÑO A CAMPEONES</span><strong data-stat="damage"></strong></div>
    </div>
    <div class="items"></div>
    <div class="spellpair" aria-label="Hechizos de invocador">
      <div class="spellslot" data-spell="0"><img alt="" hidden></div>
      <div class="spellslot" data-spell="1"><img alt="" hidden></div>
    </div>`;
  return card;
}
// ============================================================================
// 3. CONTENIDO DE UNA TARJETA
// Recibe las estadísticas ya normalizadas y el logo del equipo correspondiente.
// No consulta LCU ni modifica datos: únicamente rellena el HTML.
// ============================================================================
function fillCard(card, player, side, catalog, isMvp, logoSource) {
  const kda = player.kda || {};
  const watermark = card.querySelector('.team-watermark');
  const source = String(logoSource || '').trim();
  watermark.hidden = !source;
  watermark.onerror = () => {
    watermark.hidden = true;
  };
  if (source) watermark.src = source;
  else watermark.removeAttribute('src');
  setText(card, '.role', ROLE_LABELS[player.role] || player.role || '—');
  const displayName = playerDisplayName(player.player);
  setText(card, '.identity strong', displayName, 'Jugador');
  card.querySelector('.identity strong').title = displayName;
  setText(card, '.identity span', player.champion || player.championAlias, 'Campeón');
  card.querySelector('.kda').textContent =
    `${number(kda.kills)} / ${number(kda.deaths)} / ${number(kda.assists)}`;
  const ratio =
    typeof kda.kills === 'number' && typeof kda.assists === 'number'
      ? ((kda.kills + kda.assists) / Math.max(1, kda.deaths || 0)).toFixed(2)
      : '—';
  card.querySelector('.kda-ratio').textContent = `${ratio} KDA`;
  setText(card, '[data-stat="cs"]', number(player.cs));
  setText(card, '[data-stat="gold"]', compact(player.gold));
  setText(card, '[data-stat="damage"]', number(player.damage?.champions));
  fillRunes(card, player, catalog);
  fillSpells(card, player, catalog);
  card.querySelector('.mvp').hidden = !isMvp;
  const fallback = card.querySelector('.model-fallback');
  const alias = player.championAlias || player.champion;
  if (alias) {
    fallback.src = catalog.championUrl(alias);
    fallback.alt = `Retrato de ${player.champion || alias}`;
    fallback.hidden = false;
    fallback.onerror = () => {
      fallback.hidden = true;
    };
  }
  // Inventario: seis espacios, incluidos los vacíos, para conservar la alineación.
  const items = card.querySelector('.items');
  // Solo los seis objetos de inventario; el trinket rojo/amarillo/azul no se muestra.
  (player.items || []).slice(0, 6).forEach((id) => {
    const slot = document.createElement('div');
    slot.className = `item ${id ? '' : 'empty'}`;
    if (id) {
      const image = document.createElement('img');
      image.src = catalog.itemUrl(id);
      image.alt = `Objeto ${id}`;
      image.onerror = () => {
        image.hidden = true;
      };
      slot.appendChild(image);
    }
    items.appendChild(slot);
  });
}

// ============================================================================
// 3b. RUNAS DE LA TARJETA
// Se pinta la página completa: los dos árboles, la piedra angular, las cinco
// runas elegidas y los tres fragmentos. Cada icono se toma del catálogo; si
// un id no tiene icono conocido, ese hueco simplemente no se dibuja.
// ============================================================================
function runeIcon(catalog, id) {
  if (typeof id !== 'number' || !Number.isFinite(id)) return null;
  return catalog.runeUrl ? catalog.runeUrl(id) : null;
}

function fillRunes(card, player, catalog) {
  const page = player.runePage || {};
  const picks = Array.isArray(page.picks) ? page.picks : [];
  // La página de runas tiene 1 piedra angular + 3 runas del árbol principal y
  // 2 del secundario. Se reparten así para poder nombrar cada árbol.
  const planes = {
    primary: { style: page.primary ?? null, ids: [page.keystone ?? null, ...picks.slice(0, 3)] },
    secondary: { style: page.secondary ?? null, ids: picks.slice(3, 5) }
  };
  for (const [slot, plan] of Object.entries(planes)) {
    const icono = card.querySelector(`[data-rune="${slot}"]`);
    const fuente = runeIcon(catalog, plan.style);
    if (icono) {
      if (!fuente) {
        icono.hidden = true;
        icono.removeAttribute('src');
      } else {
        icono.hidden = false;
        icono.src = fuente;
        icono.alt = '';
        icono.onerror = () => {
          icono.hidden = true;
        };
      }
    }
    const nombre = card.querySelector(`[data-tree="${slot}"]`);
    if (nombre) {
      const texto = catalog.styleName ? catalog.styleName(plan.style) : '';
      nombre.textContent = texto || '';
      nombre.hidden = !texto;
    }
    const linea = card.querySelector(`[data-line="${slot}"]`);
    if (!linea) continue;
    linea.replaceChildren();
    plan.ids.forEach((id, indice) => {
      const origen = runeIcon(catalog, id);
      if (!origen) return;
      const imagen = document.createElement('img');
      imagen.className = `rune-icon ${slot === 'primary' && indice === 0 ? 'keystone' : 'pick'}`;
      imagen.alt = '';
      imagen.src = origen;
      imagen.onerror = () => imagen.remove();
      linea.appendChild(imagen);
    });
  }

  const shards = card.querySelector('.rune-shards');
  shards.replaceChildren();
  for (const id of page.shards || []) {
    const fuente = catalog.shardUrl ? catalog.shardUrl(id) : null;
    if (!fuente) continue;
    const imagen = document.createElement('img');
    imagen.className = 'rune-icon shard';
    imagen.alt = '';
    imagen.src = fuente;
    shards.appendChild(imagen);
  }
}

// ============================================================================
// 3c. HECHIZOS DE INVOCADOR
// Los dos hechizos van al hueco libre a la derecha del inventario. Si el id no
// tiene icono conocido, el hueco queda vacío en vez de mostrar un icono falso.
// ============================================================================
function fillSpells(card, player, catalog) {
  const ids = Array.isArray(player.spells) ? player.spells : [];
  card.querySelectorAll('.spellslot').forEach((slot) => {
    const indice = Number(slot.dataset.spell);
    const imagen = slot.querySelector('img');
    const fuente = catalog.spellUrl ? catalog.spellUrl(ids[indice]) : null;
    if (!fuente) {
      imagen.hidden = true;
      imagen.removeAttribute('src');
      slot.classList.add('empty');
      return;
    }
    slot.classList.remove('empty');
    imagen.hidden = false;
    imagen.src = fuente;
    imagen.alt = `Hechizo ${indice === 0 ? 'D' : 'F'}`;
    imagen.onerror = () => {
      imagen.hidden = true;
      slot.classList.add('empty');
    };
  });
}

// ============================================================================
// 4. PANTALLA COMPLETA
// Actualiza encabezado y equipos, genera las diez tarjetas y devuelve a main.js
// las zonas .model3d donde models.js debe dibujar cada campeón.
// ============================================================================
export function renderPostgame(summary, catalog) {
  const stage = document.getElementById('stage');
  if (!summary?.teams?.blue || !summary?.teams?.red) {
    stage.hidden = true;
    return [];
  }
  stage.hidden = false;
  const info = summary.info || {};
  document.getElementById('series-format').textContent =
    `${summary.format || 'BO3'} · JUEGO ${summary.gameNumber || 1}`;
  document.getElementById('game-duration').textContent = duration(summary.gameDuration);
  document.getElementById('tournament-name').textContent = String(
    info.tournament || info.torneo || info.tournamentName || ''
  ).trim();
  // Logo del torneo: es el mismo "logo general" que ya usa el overlay del
  // draft y la tira de teamfight (info.logo del panel). Si no llega, no se
  // dibuja nada y el nombre del torneo ocupa su sitio.
  const tournamentLogo = document.getElementById('tournament-logo');
  if (tournamentLogo) {
    const marca = String(info.logo || info.tournamentLogo || '').trim();
    tournamentLogo.hidden = !marca;
    tournamentLogo.onerror = () => {
      tournamentLogo.hidden = true;
    };
    if (marca) tournamentLogo.src = marca;
    else tournamentLogo.removeAttribute('src');
  }
  document.getElementById('demo-badge').hidden = !summary.demo;
  // Logos pequeños del encabezado. Las marcas de agua se asignan en fillCard().
  for (const side of ['blue', 'red']) {
    const logo = document.getElementById(`${side}-logo`);
    const source = String(info?.[`${side}Logo`] || '').trim();
    logo.hidden = !source;
    logo.onerror = () => {
      logo.hidden = true;
    };
    if (source) {
      logo.src = source;
      logo.alt = `Logo de ${info?.[side] || (side === 'blue' ? 'equipo azul' : 'equipo rojo')}`;
    } else logo.removeAttribute('src');
  }
  const winner = String(summary.winner || '').toLowerCase();
  for (const side of ['blue', 'red']) {
    const team = summary.teams[side];
    document.getElementById(`${side}-tag`).textContent = shortTeam(side, info);
    document.getElementById(`${side}-name`).textContent = text(
      info?.[side],
      side === 'blue' ? 'EQUIPO AZUL' : 'EQUIPO ROJO'
    );
    const label = document.getElementById(`${side}-result`);
    const gano = winner ? winner === side : /victoria|win/i.test(String(team.result || ''));
    label.textContent = gano ? 'VICTORIA' : 'DERROTA';
    label.classList.toggle('win', gano);
    label.classList.toggle('loss', !gano);
  }
  document.getElementById('blue-kills').textContent = number(summary.teams.blue.kills);
  document.getElementById('red-kills').textContent = number(summary.teams.red.kills);
  const mvp = selectMvp(summary);
  const views = [];
  for (const side of ['blue', 'red']) {
    const container = document.getElementById(`${side}-cards`);
    container.replaceChildren();
    summary.teams[side].players.forEach((player, index) => {
      const card = cardTemplate(side);
      // La misma fuente del panel alimenta el encabezado y la marca de agua;
      // el canvas WebGL tiene z-index 3 y por tanto dibuja al campeón por delante.
      const isMvp = mvp?.side === side && mvp.index === index;
      fillCard(card, player, side, catalog, isMvp, info?.[`${side}Logo`]);
      container.appendChild(card);
      views.push({ element: card.querySelector('.model3d'), player, side });
    });
  }
  return views;
}
