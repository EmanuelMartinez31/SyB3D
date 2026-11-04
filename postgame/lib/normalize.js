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

function finalizeSummary({ gameId, gameDuration, gameCreation, teams, source, context }) {
  const blue = sortTeamPlayers(
    teams.filter((team) => team.side === 'blue').flatMap((team) => team.players)
  );
  const red = sortTeamPlayers(
    teams.filter((team) => team.side === 'red').flatMap((team) => team.players)
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

module.exports = { normalizeEog, normalizeHistory, normalizeRole, sideFromTeam };
