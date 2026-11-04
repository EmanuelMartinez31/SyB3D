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

function displayName(player) {
  return String(player?.player || '—').split('#')[0].trim() || '—';
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
  const fallbackName = prefix === 'blue' ? 'AZUL' : 'ROJO';
  const fullName = String(info?.[prefix] || fallbackName).trim() || fallbackName;
  const words = fullName.split(/\s+/).filter(Boolean);
  const generatedShort = words.length > 1
    ? words.map(word => word[0]).join('').slice(0, 4)
    : fullName.slice(0, 4);
  const shortName = String(info?.[`${prefix}Short`] || info?.[`${prefix}Tag`] || generatedShort)
    .trim().toUpperCase() || fallbackName;

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

function createPlayerRow(player) {
  const row = document.createElement('article');
  row.className = 'player-row';

  const spells = document.createElement('div');
  spells.className = 'icon-stack spell-stack';
  const spellD = assetWithFallback('spell-icon', 'D');
  const spellF = assetWithFallback('spell-icon', 'F');
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
  championWrap.append(champion, championFallback, level);

  const info = document.createElement('div');
  info.className = 'player-info';
  const name = document.createElement('strong');
  name.className = 'player-name';
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
  bars.append(healthBar, resourceBar);
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

  row.append(spells, runes, championWrap, info, stats, items);
  return {
    row, spellD, spellF, cooldownD, cooldownF, primaryRune, secondaryRune,
    champion, championFallback, level, name, championName, healthFill,
    resourceBar, resourceFill, kda, cs, itemSlots
  };
}

function updateSpell(asset, cooldownElement, spell, key) {
  const remaining = finite(spell?.remaining) ? spell.remaining : 0;
  const spellName = spell?.name || null;
  setImage(
    asset.img,
    spellName ? activeCatalog.spellUrls(spellName, spell?.icon) : null,
    spellName ? activeCatalog.spellName(spellName) : `Hechizo ${key.toUpperCase()}`,
    asset.fallback,
    key.toUpperCase()
  );
  asset.wrap.title = spellName ? activeCatalog.spellName(spellName) : `Hechizo ${key.toUpperCase()}`;
  cooldownElement.hidden = remaining <= 0.05;
  if (remaining > 0.05) setText(cooldownElement, Math.ceil(remaining));
}

function updatePlayerRow(refs, player) {
  refs.row.classList.toggle('dead', player.alive === false);
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

  updateSpell(refs.spellD, refs.cooldownD, player.spells?.d, 'd');
  updateSpell(refs.spellF, refs.cooldownF, player.spells?.f, 'f');

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

  const kills = finite(player.kda?.kills) ? player.kda.kills : '—';
  const deaths = finite(player.kda?.deaths) ? player.kda.deaths : '—';
  const assists = finite(player.kda?.assists) ? player.kda.assists : '—';
  setText(refs.kda, `${kills}/${deaths}/${assists}`);
  setText(refs.cs, finite(player.cs?.total) ? player.cs.total : '—');

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
  setText(element.querySelector('small'), labels[kind]);
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
    const blue = document.createElement('span');
    blue.className = 'individual-gold blue';
    const difference = document.createElement('span');
    difference.className = 'lane-difference';
    const role = document.createElement('small');
    const value = document.createElement('strong');
    difference.append(role, value);
    const red = document.createElement('span');
    red.className = 'individual-gold red';
    row.append(blue, difference, red);
    container.append(row);
  }

  [...container.children].forEach((row, index) => {
    const bluePlayer = bluePlayers[index];
    const redPlayer = redPlayers[index];
    row.hidden = !bluePlayer && !redPlayer;
    if (row.hidden) return;
    const blueGold = bluePlayer?.gold?.total;
    const redGold = redPlayer?.gold?.total;
    setText(row.querySelector('.individual-gold.blue'), formatGold(blueGold));
    setText(row.querySelector('.individual-gold.red'), formatGold(redGold));
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
  const visible = format !== 'BO1';
  const maxWins = format === 'BO5' ? 3 : format === 'BO3' ? 2 : 1;
  const totalGames = maxWins * 2 - 1;
  const wins = {};
  setText(byId('series-format'), format);
  for (const prefix of ['blue', 'red']) {
    const element = byId(`${prefix}-series-score`);
    wins[prefix] = Math.min(maxWins, Math.max(0, Math.floor(numberOr(score?.[prefix], 0))));
    setText(element, wins[prefix]);
    element.hidden = !visible;
    element.setAttribute('aria-label', `${wins[prefix]} victorias en la serie`);
  }
  const seriesComplete = wins.blue >= maxWins || wins.red >= maxWins;
  const gameNumber = Math.min(wins.blue + wins.red + 1, totalGames);
  setText(
    byId('game-label'),
    seriesComplete ? 'SERIE COMPLETADA' : `PARTIDA ${gameNumber} DE ${totalGames}`
  );
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

  if (finite(blue.totalGold) && finite(red.totalGold)) {
    const difference = blue.totalGold - red.totalGold;
    const leader = difference > 0 ? 'AZUL' : difference < 0 ? 'ROJO' : '';
    setText(byId('gold-lead'), leader ? `${leader} +${formatGold(Math.abs(difference))}` : '±0.0K');
  } else {
    setText(byId('gold-lead'), '—');
  }
}

export function renderIngameState(state, catalog) {
  if (!state || typeof state !== 'object') return;
  activeCatalog = catalog;
  const teams = Array.isArray(state.teams) ? state.teams : [];
  const players = Array.isArray(state.players) ? state.players : [];
  renderTeams(teams);
  renderTeamIdentities(state.info);
  renderSeries(state.score);
  setText(byId('game-time'), formatTime(state.meta?.gameTime));

  renderObjective('dragon', byId('objective-dragon'), state);
  renderSecondaryObjective(state);
  const dragonType = state.objectives?.upcomingDragonType;
  const dragonTypeIcon = byId('objective-dragon-type');
  dragonTypeIcon.hidden = !DRAGON_ICONS[dragonType];
  if (!dragonTypeIcon.hidden) {
    const src = dragonIconSource(dragonType);
    if (dragonTypeIcon.getAttribute('src') !== src) dragonTypeIcon.src = src;
    dragonTypeIcon.title = `Próximo dragón: ${dragonType}`;
  }

  const blueContainer = byId('blue-players');
  const redContainer = byId('red-players');
  blueContainer._players = players.filter(player => player.team === 1);
  redContainer._players = players.filter(player => player.team === 2);
  const bluePlayers = renderTeamPlayers(1, blueContainer);
  const redPlayers = renderTeamPlayers(2, redContainer);
  renderGoldMatchups(bluePlayers, redPlayers);
}
