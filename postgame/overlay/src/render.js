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
      <div class="damage-label">DAÑO A CAMPEONES</div><div class="damage"></div>
      <div class="damage-total">Daño total <b></b></div>
    </div>
    <div class="statgrid">
      <div class="ministat"><span>CS</span><strong data-stat="cs"></strong></div>
      <div class="ministat"><span>ORO</span><strong data-stat="gold"></strong></div>
      <div class="ministat"><span>VISIÓN</span><strong data-stat="vision"></strong></div>
      <div class="ministat"><span>WARDS</span><strong data-stat="wards"></strong><small>COLOC. / DESTR.</small></div>
    </div>
    <div class="items"></div>`;
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
  card.querySelector('.damage').textContent = number(player.damage?.champions);
  card.querySelector('.damage-total b').textContent = number(player.damage?.total);
  setText(card, '[data-stat="cs"]', number(player.cs));
  setText(card, '[data-stat="gold"]', compact(player.gold));
  setText(card, '[data-stat="vision"]', number(player.vision?.score));
  const placed = number(player.vision?.wardsPlaced);
  const killed = number(player.vision?.wardsKilled);
  card.querySelector('[data-stat="wards"]').textContent = `${placed} / ${killed}`;
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
  for (const side of ['blue', 'red']) {
    const team = summary.teams[side];
    document.getElementById(`${side}-tag`).textContent = shortTeam(side, info);
    document.getElementById(`${side}-name`).textContent = text(
      info?.[side],
      side === 'blue' ? 'EQUIPO AZUL' : 'EQUIPO ROJO'
    );
    document.getElementById(`${side}-result`).textContent = team.result || 'FINALIZADA';
  }
  document.getElementById('blue-kills').textContent = number(summary.teams.blue.kills);
  document.getElementById('red-kills-top').textContent = number(summary.teams.red.kills);
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
