// POSTPARTIDA · NORMALIZACIÓN DE ESTADÍSTICAS
// Convierte respuestas distintas de LCU en una estructura única para la pantalla.

const ROLE_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

// ============================================================================
// 1. LECTURA TOLERANTE DE CAMPOS
// LCU cambia nombres y formatos según la ruta. Estas funciones aceptan varias
// alternativas y descartan vacíos, NaN e Infinity en lugar de romper la pantalla.
// ============================================================================
function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value;
    if (typeof number === 'number' && Number.isFinite(number)) return number;
  }
  return null;
}

function firstBoolean(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (/^(win|won|victory|true)$/i.test(value)) return true;
      if (/^(fail|loss|lost|defeat|false)$/i.test(value)) return false;
    }
  }
  return null;
}

// ============================================================================
// 2. LÍNEA Y LADO DEL JUGADOR
// Se reconocen TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY y sus equivalencias históricas.
// ============================================================================
function normalizeRole(...values) {
  const roles = {
    TOP: 'TOP',
    JUNGLE: 'JUNGLE',
    JG: 'JUNGLE',
    MIDDLE: 'MIDDLE',
    MID: 'MIDDLE',
    BOTTOM: 'BOTTOM',
    BOT: 'BOTTOM',
    ADC: 'BOTTOM',
    DUOCARRY: 'BOTTOM',
    UTILITY: 'UTILITY',
    SUPPORT: 'UTILITY',
    SUP: 'UTILITY',
    DUOSUPPORT: 'UTILITY'
  };
  // Algunos historiales incluyen Invalid/NONE antes del carril útil. Se sigue
  // buscando hasta encontrar un valor reconocido, incluidos los roles DUO.
  for (const value of values) {
    const normalized = firstText(value)
      .toUpperCase()
      .replace(/[\s_-]/g, '');
    if (roles[normalized]) return roles[normalized];
  }
  return '';
}

function sideFromTeam(value, index = 0) {
  if (value === 100 || value === 1 || value === '100' || value === '1') return 'blue';
  if (value === 200 || value === 2 || value === '200' || value === '2') return 'red';
  const normalized = firstText(value).toLowerCase();
  if (['blue', 'order', 'teamone', 'team1'].includes(normalized)) return 'blue';
  if (['red', 'chaos', 'teamtwo', 'team2'].includes(normalized)) return 'red';
  return index === 0 ? 'blue' : 'red';
}

// ============================================================================
// 3. IDENTIDAD, CAMPEÓN E INVENTARIO
// El resumen conserva Nombre#TAG; render.js decide ocultar la etiqueta visualmente.
// ============================================================================
function playerName(player = {}, identity = {}) {
  const source = { ...identity, ...player };
  const gameName = firstText(source.gameName, source.playerName, source.game_name);
  const tagLine = firstText(source.tagLine, source.tagline, source.tag_line);
  if (gameName) return tagLine ? `${gameName}#${tagLine}` : gameName;
  return firstText(source.summonerName, source.name, source.displayName, identity.summonerName);
}

function championFor(raw, championMap) {
  const id = firstNumber(raw.championId, raw.championID, raw.champion);
  const mapped = id !== null ? championMap?.get(id) : null;
  return {
    championId: id,
    champion: firstText(
      raw.championName,
      raw.championDisplayName,
      mapped?.name,
      raw.championAlias,
      mapped?.alias
    ),
    championAlias: firstText(
      raw.championAlias,
      raw.championAliasName,
      mapped?.alias,
      raw.championName,
      mapped?.name
    )
  };
}

// ============================================================================
// 3b. PÁGINA DE RUNAS
// El cliente entrega perk0..perk5, el árbol principal y el secundario, y los
// tres fragmentos (statPerks). Se guardan por separado para poder pintar la
// página completa; además se conserva el par [piedra angular, secundario] que
// ya usaba la pantalla, por si algún consumidor antiguo lo necesita.
// ============================================================================
function runePageFrom(raw = {}, stats = {}) {
  const pick = (...values) => {
    for (const value of values) {
      const number = firstNumber(value);
      if (number !== null) return number;
    }
    return null;
  };
  const statPerks = stats.statPerks || raw.statPerks || {};
  return {
    primary: pick(stats.perkPrimaryStyle, raw.perkPrimaryStyle),
    secondary: pick(stats.perkSubStyle, raw.perkSubStyle),
    keystone: pick(stats.perk0, raw.perk0),
    picks: [
      pick(stats.perk1, raw.perk1),
      pick(stats.perk2, raw.perk2),
      pick(stats.perk3, raw.perk3),
      pick(stats.perk4, raw.perk4),
      pick(stats.perk5, raw.perk5)
    ],
    shards: [
      pick(statPerks.offense, stats.statPerksOffense, raw.statPerksOffense),
      pick(statPerks.flex, stats.statPerksFlex, raw.statPerksFlex),
      pick(statPerks.defense, stats.statPerksDefense, raw.statPerksDefense)
    ]
  };
}

function itemList(stats) {
  const direct = stats.items || stats.itemIds;
  if (Array.isArray(direct) && direct.length) {
    return Array.from({ length: 7 }, (_, index) => {
      const value = direct[index];
      return firstNumber(value?.itemId, value?.id, value) ?? 0;
    });
  }
  return Array.from({ length: 7 }, (_, index) => firstNumber(stats[`item${index}`]) ?? 0);
}

// ============================================================================
// 4. ESTADÍSTICAS DE UN JUGADOR
// Reúne KDA, daño, curación, CS, oro, visión, wards y objetos en una sola forma.
// ============================================================================
function normalizePlayer(raw = {}, context = {}) {
  const stats = raw.stats && typeof raw.stats === 'object' ? raw.stats : raw;
  const identity = context.identity || {};
  const champion = championFor({ ...raw, ...stats }, context.championMap);
  const kills = firstNumber(stats.kills, stats.Kills);
  const deaths = firstNumber(stats.deaths, stats.Deaths);
  const assists = firstNumber(stats.assists, stats.Assists);
  const role = normalizeRole(
    raw.teamPosition,
    raw.individualPosition,
    raw.position,
    raw.role,
    raw.timeline?.teamPosition,
    raw.timeline?.role,
    raw.timeline?.lane
  );
  return {
    participantId: firstNumber(raw.participantId, raw.participantID),
    player: playerName(raw, identity),
    ...champion,
    role,
    teamId: firstNumber(raw.teamId, context.teamId),
    win: firstBoolean(raw.win, stats.win, context.win),
    kda: { kills, deaths, assists },
    damage: {
      champions: firstNumber(stats.totalDamageDealtToChampions),
      total: firstNumber(stats.totalDamageDealt),
      taken: firstNumber(stats.totalDamageTaken),
      mitigated: firstNumber(stats.damageSelfMitigated),
      physical: firstNumber(stats.physicalDamageDealtToChampions),
      magic: firstNumber(stats.magicDamageDealtToChampions),
      true: firstNumber(stats.trueDamageDealtToChampions)
    },
    healing: firstNumber(stats.totalHeal, stats.totalHealing),
    cs:
      firstNumber(stats.totalMinionsKilled, stats.neutralMinionsKilled) !== null
        ? (firstNumber(stats.totalMinionsKilled) ?? 0) +
          (firstNumber(stats.neutralMinionsKilled) ?? 0)
        : firstNumber(stats.creepScore, stats.cs),
    gold: firstNumber(stats.goldEarned, stats.totalGold, stats.gold),
    vision: {
      score: firstNumber(stats.visionScore),
      wardsPlaced: firstNumber(stats.wardsPlaced),
      wardsKilled: firstNumber(stats.wardsKilled),
      controlWards: firstNumber(stats.visionWardsBoughtInGame)
    },
    items: itemList(stats),
    spells: [firstNumber(raw.spell1Id, stats.spell1Id), firstNumber(raw.spell2Id, stats.spell2Id)],
    runes: [firstNumber(stats.perk0, stats.perkPrimaryStyle), firstNumber(stats.perkSubStyle)],
    runePage: runePageFrom(raw, stats),
    level: firstNumber(stats.champLevel, stats.level),
    timeCCingOthers: firstNumber(stats.timeCCingOthers),
    turretKills: firstNumber(stats.turretKills),
    inhibitorKills: firstNumber(stats.inhibitorKills),
    objectivesStolen: firstNumber(stats.objectivesStolen)
  };
}

// ============================================================================
// 5. ORDEN Y VALIDACIÓN DEL EQUIPO
// Las tarjetas se ordenan por línea. Sin cinco jugadores por lado no se acepta
// el resumen, para evitar reemplazar uno bueno por datos incompletos.
// ============================================================================
function sortTeamPlayers(players) {
  return players
    .map((player, index) => ({ player, index }))
    .sort((a, b) => {
      const roleA = ROLE_ORDER.indexOf(a.player.role);
      const roleB = ROLE_ORDER.indexOf(b.player.role);
      if (roleA >= 0 && roleB >= 0) return roleA - roleB;
      if (roleA >= 0) return -1;
      if (roleB >= 0) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.player);
}

// ============================================================================
// 4b. CINCO LÍNEAS POR EQUIPO
// El cliente repite la posición cuando la partida no trae posiciones asignadas
// (dos o tres JUNGLE en el mismo equipo), y la tabla acababa mostrando dos "JG"
// y ningún "SUP". Aquí se conserva el primer rol declarado y los roles que
// faltan se reparten entre los jugadores repetidos en el orden canónico, de
// modo que cada equipo siempre muestra TOP, JG, MID, ADC y SUP una sola vez.
// ============================================================================
const SMITE_SPELL = 11;

// El cliente repite posiciones cuando la partida no trae líneas asignadas, así
// que al equipo llegan, por ejemplo, dos JUNGLE y dos BOTTOM. Para desempatar
// se usan pistas del propio resumen:
//   · JUNGLE  → el que lleva Castigo (hechizo 11);
//   · BOTTOM  → el que más granjeo tiene (un tirador duplica al soporte);
//   · UTILITY → el que menos granjeo tiene.
const ROLE_PRIORITY = ['JUNGLE', 'BOTTOM', 'UTILITY', 'MIDDLE', 'TOP'];

function minionsOf(player) {
  const cs = Number(player?.cs);
  return Number.isFinite(cs) ? cs : null;
}

function hasSmite(player) {
  return (player?.spells || []).some((spell) => Number(spell) === SMITE_SPELL);
}

// Elige, entre varios candidatos, al que mejor encaja en un rol.
// Diferencia mínima de granjeo para fiarse de la pista. Por debajo, los datos
// están incompletos y se respeta el orden en que llegaron los jugadores.
const CS_GAP = 30;

function bestFit(players, role) {
  const conGranjeo = players.filter((player) => minionsOf(player) !== null);
  const valores = conGranjeo.map(minionsOf);
  const hayPista = valores.length > 1 && Math.max(...valores) - Math.min(...valores) >= CS_GAP;
  if (role === 'JUNGLE') {
    return players.find(hasSmite) || players[0] || null;
  }
  if (role === 'BOTTOM') {
    if (!hayPista) return players[0] || null;
    return conGranjeo.reduce((best, player) =>
      minionsOf(player) > minionsOf(best) ? player : best
    );
  }
  if (role === 'UTILITY') {
    if (!hayPista) return players[0] || null;
    return conGranjeo.reduce((best, player) =>
      minionsOf(player) < minionsOf(best) ? player : best
    );
  }
  return players[0] || null;
}

function completeTeamRoles(players) {
  const resolved = players.map((player) => ({ ...player }));
  const claims = new Map();
  for (const player of resolved) {
    if (!player.role) continue;
    if (!claims.has(player.role)) claims.set(player.role, []);
    claims.get(player.role).push(player);
  }

  const assigned = new Map();
  // 1) Una línea reclamada por un solo jugador se respeta tal cual.
  for (const [role, list] of claims) {
    if (list.length === 1) assigned.set(list[0], role);
  }
  // 2) Con varias reclamaciones se queda el que mejor encaja; el resto vuelve al bombo.
  for (const [role, list] of claims) {
    if (list.length < 2) continue;
    const free = list.filter((player) => !assigned.has(player));
    const keeper = bestFit(free, role);
    if (keeper) assigned.set(keeper, role);
  }

  // 3) Las líneas que faltan se reparten por prioridad y por encaje real.
  let pool = resolved.filter((player) => !assigned.has(player));
  const taken = new Set(assigned.values());
  for (const role of ROLE_PRIORITY) {
    if (taken.has(role) || !pool.length) continue;
    const pick = bestFit(pool, role);
    if (!pick) break;
    assigned.set(pick, role);
    taken.add(role);
    pool = pool.filter((player) => player !== pick);
  }
  // 4) Si aún queda alguien (equipos incompletos), se le da lo que quede.
  for (const player of pool) {
    const libre = ROLE_ORDER.find((role) => !taken.has(role));
    if (!libre) break;
    assigned.set(player, libre);
    taken.add(libre);
  }

  for (const player of resolved) player.role = assigned.get(player) || player.role || '';

  // 5) Pareja de la botella. El caso más común cuando las posiciones llegan
  //    asignadas pero al revés: el ADC aparece como UTILITY y el soporte como
  //    BOTTOM. Se comparan los granjeos y se intercambian si están claramente
  //    al revés. Un tirador duplica de sobra al soporte; el umbral evita tocar
  //    nada cuando los datos vienen incompletos.
  const abajo = resolved.find((player) => player.role === 'BOTTOM');
  const soporte = resolved.find((player) => player.role === 'UTILITY');
  if (abajo && soporte && abajo !== soporte) {
    const csAbajo = minionsOf(abajo);
    const csSoporte = minionsOf(soporte);
    if (
      csAbajo !== null &&
      csSoporte !== null &&
      csSoporte - csAbajo >= CS_GAP &&
      csSoporte >= csAbajo * 1.3
    ) {
      abajo.role = 'UTILITY';
      soporte.role = 'BOTTOM';
    }
  }

  return resolved;
}

function finalizeSummary({ gameId, gameDuration, gameCreation, teams, source, context }) {
  const blue = sortTeamPlayers(
    completeTeamRoles(teams.filter((team) => team.side === 'blue').flatMap((team) => team.players))
  );
  const red = sortTeamPlayers(
    completeTeamRoles(teams.filter((team) => team.side === 'red').flatMap((team) => team.players))
  );
  if (blue.length !== 5 || red.length !== 5) return null;
  const blueWin = firstBoolean(
    ...teams.filter((team) => team.side === 'blue').map((team) => team.win)
  );
  const redWin = firstBoolean(
    ...teams.filter((team) => team.side === 'red').map((team) => team.win)
  );
  const winner =
    blueWin === true || redWin === false
      ? 'blue'
      : redWin === true || blueWin === false
        ? 'red'
        : null;
  const sumKills = (players) => players.reduce((sum, player) => sum + (player.kda.kills ?? 0), 0);
  return {
    schemaVersion: 1,
    gameId: firstText(gameId, context.gameId) || `partida-${Date.now()}`,
    source,
    capturedAt: new Date().toISOString(),
    gameCreation: firstNumber(gameCreation, context.gameCreation),
    gameDuration: firstNumber(gameDuration, context.gameDuration),
    gameNumber: Math.max(
      1,
      (firstNumber(context.series?.score?.blue) ?? 0) +
        (firstNumber(context.series?.score?.red) ?? 0) +
        1
    ),
    format: firstText(context.series?.score?.format) || 'BO3',
    info: context.series?.info || null,
    sideTeams: context.series?.sideTeams || null,
    winner,
    teams: {
      blue: {
        side: 'blue',
        result: winner === 'blue' ? 'VICTORIA' : winner === 'red' ? 'DERROTA' : '',
        kills: sumKills(blue),
        players: blue
      },
      red: {
        side: 'red',
        result: winner === 'red' ? 'VICTORIA' : winner === 'blue' ? 'DERROTA' : '',
        kills: sumKills(red),
        players: red
      }
    }
  };
}

// ============================================================================
// 6. ADAPTADORES DE LAS DOS FUENTES LCU
// normalizeEog lee las estadísticas de fin de partida; normalizeHistory lee
// /lol-match-history. Ambas terminan en el mismo formato de resumen.
// ============================================================================
function normalizeEog(data, context = {}) {
  if (!data || typeof data !== 'object') return null;
  const container =
    data.statsBlock && typeof data.statsBlock === 'object' ? { ...data.statsBlock, ...data } : data;
  const rawTeams = Array.isArray(container.teams) ? container.teams : [];
  const teams = rawTeams.map((team, index) => {
    const rawPlayers = Array.isArray(team.players)
      ? team.players
      : Array.isArray(team.participants)
        ? team.participants
        : [];
    const teamId = firstNumber(team.teamId, team.teamID, team.id);
    const win = firstBoolean(team.isWinningTeam, team.isWinner, team.win, team.result);
    return {
      side: sideFromTeam(teamId ?? team.team ?? team.side, index),
      win,
      players: rawPlayers.map((player) =>
        normalizePlayer(player, { championMap: context.championMap, teamId, win })
      )
    };
  });
  return finalizeSummary({
    gameId: firstText(container.gameId, container.gameID, container.game?.gameId),
    gameDuration: firstNumber(
      container.gameDuration,
      container.gameLength,
      container.game?.gameDuration
    ),
    gameCreation: firstNumber(container.gameCreation, container.game?.gameCreation),
    teams,
    source: context.source || 'lcu-end-of-game',
    context
  });
}

// Convierte la respuesta del historial directo, incluida la partida observada.
function normalizeHistory(data, context = {}) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.participants)) return null;
  const identities = new Map(
    (data.participantIdentities || []).map((identity) => [
      identity.participantId,
      identity.player || {}
    ])
  );
  const rawTeams = Array.isArray(data.teams) ? data.teams : [];
  const teams = rawTeams.map((team, index) => {
    const teamId = firstNumber(team.teamId, team.teamID);
    const win = firstBoolean(team.win, team.isWinningTeam);
    const participants = data.participants.filter(
      (player) => firstNumber(player.teamId) === teamId
    );
    return {
      side: sideFromTeam(teamId, index),
      win,
      players: participants.map((player) =>
        normalizePlayer(player, {
          identity: identities.get(player.participantId),
          championMap: context.championMap,
          teamId,
          win
        })
      )
    };
  });
  // Algunos clientes omiten teams: se reconstruye por teamId sin inventar el resultado.
  if (!teams.length) {
    for (const teamId of [100, 200]) {
      teams.push({
        side: sideFromTeam(teamId),
        win: null,
        players: data.participants
          .filter((player) => firstNumber(player.teamId) === teamId)
          .map((player) =>
            normalizePlayer(player, {
              identity: identities.get(player.participantId),
              championMap: context.championMap,
              teamId
            })
          )
      });
    }
  }
  return finalizeSummary({
    gameId: context.gameId || data.gameId,
    gameDuration: data.gameDuration,
    gameCreation: data.gameCreation,
    teams,
    source: 'lcu-match-history',
    context
  });
}

// Resumen ya guardado en disco: se le corrigen las líneas sin volver a
// consultar al cliente. Algunas capturas antiguas quedaron con dos JUNGLE y sin
// UTILITY, y la pantalla las mostraba tal cual al recuperarlas al arrancar.
function repairSummaryRoles(summary) {
  if (!summary?.teams) return summary;
  const teams = {};
  for (const side of ['blue', 'red']) {
    const players = summary.teams[side]?.players;
    if (!Array.isArray(players)) return summary;
    teams[side] = { ...summary.teams[side], players: sortTeamPlayers(completeTeamRoles(players)) };
  }
  return { ...summary, teams: { ...summary.teams, ...teams } };
}

module.exports = { normalizeEog, normalizeHistory, normalizeRole, sideFromTeam, repairSummaryRoles };
