const ROLE_ORDER = ['top', 'jungle', 'mid', 'bot', 'support'];

// En el demo nadie muere de verdad, así que el contador de reaparición se
// simula: baja como lo haría en una partida y vuelve a empezar al llegar a cero.
const DEMO_RESPAWN_SECONDS = 25;
function demoRespawnIn(offsetSeconds) {
  const ciclo = (Date.now() / 1000 + offsetSeconds) % DEMO_RESPAWN_SECONDS;
  return Math.max(1, Math.round(DEMO_RESPAWN_SECONDS - ciclo));
}

const BLUE = [
  ['SyB Kaze', 'Aatrox', 11, 4, 1, 3, 148, 10350, 21100, [6631, 3047, 3071, 3742, 0, 0, 3364]],
  ['SyB Nami', 'Vi', 10, 2, 2, 7, 121, 8750, 19800, [6632, 3026, 3111, 3074, 0, 0, 3364]],
  ['SyB Zeke', 'Orianna', 12, 5, 0, 4, 172, 12400, 22400, [6655, 3020, 3089, 3135, 0, 0, 3364]],
  ['SyB Ryu', 'Jinx', 11, 3, 1, 5, 166, 11800, 21800, [6672, 3006, 3031, 3036, 0, 0, 3364]],
  ['SyB Mako', 'Thresh', 10, 1, 2, 10, 42, 7300, 17300, [3860, 3117, 3190, 3068, 0, 0, 3364]]
];

const RED = [
  ['RGE Ander', 'Camille', 11, 2, 3, 2, 142, 9900, 20400, [6632, 3047, 3074, 3071, 0, 0, 3364]],
  ['RGE Sora', 'Sejuani', 10, 1, 3, 6, 115, 8100, 18900, [6662, 3047, 3068, 3083, 0, 0, 3364]],
  ['RGE Lian', 'Sylas', 11, 4, 4, 1, 157, 11200, 21200, [6655, 3020, 3157, 3089, 0, 0, 3364]],
  ['RGE Noa', 'Jhin', 11, 2, 2, 4, 161, 10800, 20900, [6672, 3006, 3031, 3036, 0, 0, 3364]],
  ['RGE Ivo', 'Nautilus', 9, 0, 4, 8, 38, 6800, 16500, [3860, 3117, 3190, 3068, 0, 0, 3364]]
];

const RUNES = [
  [8010, 9111, 9104, 8299, 8448, 8453],
  [8010, 9111, 9104, 8299, 8448, 8453],
  [8112, 8139, 8138, 8135, 8226, 8210],
  [8005, 8009, 9103, 8014, 8139, 8138],
  [8439, 8448, 8444, 8453, 8242, 8347]
];

function spell(name, remaining = 0, maxCooldown = 300) {
  const gameTime = 1264;
  return {
    name,
    readyAt: gameTime + remaining,
    remaining,
    maxCooldown,
    level: 1,
    ammoRemaining: null,
    ammoCount: null,
    toggled: false
  };
}

function makePlayer(row, team, index) {
  const [player, champion, level, kills, deaths, assists, cs, current, total, itemIds] = row;
  const maxHealth = 1850 + level * 82;
  const maxResource = champion === 'Aatrox' ? 0 : 650 + level * 28;
  return {
    id: `${team}-${index}`,
    team,
    side: team === 1 ? 'order' : 'chaos',
    index,
    role: ROLE_ORDER[index],
    champion,
    player,
    position: null,
    level,
    experience: null,
    kda: { kills, deaths, assists },
    cs: { total: cs, lane: null, neutral: null },
    gold: { current, total, givenOnDeath: null },
    health: { current: maxHealth * (0.68 + index * 0.055), max: maxHealth },
    resource: { current: maxResource * 0.72, max: maxResource, type: maxResource ? 'mana' : 'none' },
    alive: !(team === 2 && index === 4),
    respawnIn: team === 2 && index === 4 ? demoRespawnIn(0) : null,
    zombie: false,
    recalling: false,
    targetable: true,
    respawnTime: null,
    visionScore: 8 + index * 5 + (team === 2 ? 3 : 0),
    items: itemIds.map((id, slot) => ({ id, slot, count: 1, stacks: null, charges: null })),
    runes: RUNES[index],
    spells: {
      q: null, w: null, e: null, r: null,
      d: spell(index === 1 ? 'SummonerSmite' : 'SummonerFlash', team === 2 && index === 3 ? 288 : 0),
      f: spell(index === 4 ? 'SummonerDot' : index === 3 ? 'SummonerHeal' : 'SummonerTeleport', 0)
    }
  };
}

function teamState(players, team, towersLost) {
  const sum = selector => players.reduce((total, player) => total + selector(player), 0);
  return {
    team,
    side: team === 1 ? 'order' : 'chaos',
    kills: sum(player => player.kda.kills),
    deaths: sum(player => player.kda.deaths),
    assists: sum(player => player.kda.assists),
    totalGold: sum(player => player.gold.total),
    currentGold: sum(player => player.gold.current),
    totalCs: sum(player => player.cs.total),
    towersLost,
    towersRemaining: 11 - towersLost,
    outerTurretPlatesRemaining: 0,
    objectives: team === 1
      ? { dragon: 2, grubs: 4, riftHerald: 1, baron: 0, atakhan: 0, dragonType: 'Mountain', dragonTypes: ['Infernal', 'Mountain'] }
      : { dragon: 1, grubs: 2, riftHerald: 0, baron: 1, atakhan: 0, dragonType: 'Ocean', dragonTypes: ['Ocean'] }
  };
}

export function createDemoState(format = 'BO3') {
  const bluePlayers = BLUE.map((row, index) => makePlayer(row, 1, index));
  const redPlayers = RED.map((row, index) => makePlayer(row, 2, index));
  const seriesFormat = ['BO1', 'BO3', 'BO5'].includes(format) ? format : 'BO3';
  return {
    schemaVersion: 1,
    meta: { sequence: 0, receivedAt: null, gameId: 'demo', gameTime: 1264, playbackSpeed: 1 },
    info: {
      blue: 'Synergy Brothers', red: 'Rogue Giants',
      blueShort: 'SYB', redShort: 'RGE', blueLogo: null, redLogo: null
    },
    score: { format: seriesFormat, blue: seriesFormat === 'BO1' ? 0 : 1, red: seriesFormat === 'BO1' ? 0 : 1 },
    teams: [teamState(bluePlayers, 1, 3), teamState(redPlayers, 2, 2)],
    players: [...bluePlayers, ...redPlayers],
    objectives: {
      upcomingDragonType: 'Hextech',
      active: { dragon: false, baron: false, atakhan: false, riftHerald: false, grubs: false },
      // Tiempo restante del buff de objetivo en la vista previa.
      buffs: { 1: null, 2: null },
      camps: [
        { kind: 'dragon', remaining: 96, spawnAt: 1360, timerVisible: true },
        { kind: 'grubs', remaining: 242, spawnAt: 1506, timerVisible: true }
      ]
    },
    structures: { turrets: [], inhibitors: [], nexus: [] },
    wards: [],
    eventCounts: {}
  };
}

// Buff de objetivo simulado: sirve para ver los marcos y la barra sin una
// partida en vivo. El HUD lo pinta igual que el que llega del servidor.
export function aplicarBuffDemo(state, kind, team, restante) {
  const duration = kind === 'elder' ? 150 : 180;
  const seconds = Number.isFinite(restante) ? Math.max(1, restante) : duration;
  state.objectives = state.objectives || {};
  state.objectives.buffs = state.objectives.buffs || { 1: null, 2: null };
  state.objectives.buffs[team] = { kind, remaining: seconds, duration, endsAt: null, carriers: 5 };
  // Solo se marca al equipo del buff: el rival conserva el suyo si ya tenía.
  for (const player of state.players) {
    if (player.team === team) player.objectiveBuff = kind;
  }
  return state;
}

export function advanceDemoState(state, elapsedSeconds) {
  state.meta.gameTime += elapsedSeconds;
  state.meta.sequence += 1;
  for (const camp of state.objectives.camps) {
    if (typeof camp.remaining === 'number') camp.remaining = Math.max(0, camp.remaining - elapsedSeconds);
  }
  // El buff de objetivo del demo también corre y desaparece al agotarse.
  for (const team of [1, 2]) {
    const buff = state.objectives?.buffs?.[team];
    if (!buff) continue;
    buff.remaining = Math.max(0, buff.remaining - elapsedSeconds);
    if (buff.remaining > 0.05) continue;
    state.objectives.buffs[team] = null;
    for (const player of state.players) {
      if (player.team === team) player.objectiveBuff = null;
    }
  }
  for (const player of state.players) {
    // El muerto del demo reaparece: la cuenta atrás baja y vuelve a empezar.
    if (player.alive === false && typeof player.respawnIn === 'number') {
      player.respawnIn = player.respawnIn - elapsedSeconds;
      if (player.respawnIn <= 0.5) player.respawnIn = DEMO_RESPAWN_SECONDS;
    }
    for (const key of ['d', 'f']) {
      const current = player.spells[key];
      if (current && typeof current.remaining === 'number') {
        current.remaining = Math.max(0, current.remaining - elapsedSeconds);
      }
    }
  }
  return state;
}
