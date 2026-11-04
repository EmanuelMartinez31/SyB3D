// POSTPARTIDA · DATOS DE DEMOSTRACIÓN
// Sirven para revisar diseño, controles y modelos sin jugar ni consultar LCU.

// Datos ficticios de los diez jugadores. Ninguno proviene de una partida real.
const champions = {
  blue: ['Aatrox', 'Sejuani', 'Aurora', 'Jinx', 'Thresh'],
  red: ['Renekton', 'Vi', 'Orianna', 'Ezreal', 'Leona']
};
const aliases = {
  blue: ['Aatrox', 'Sejuani', 'Aurora', 'Jinx', 'Thresh'],
  red: ['Renekton', 'Vi', 'Orianna', 'Ezreal', 'Leona']
};
const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const numbers = [
  [7, 2, 9, 32840, 68420, 245, 15200, 38, 14, 6],
  [10, 4, 8, 29615, 74105, 198, 14800, 51, 18, 9],
  [5, 3, 12, 35270, 71380, 276, 15600, 42, 12, 5],
  [4, 4, 10, 27930, 62740, 288, 14400, 31, 9, 4],
  [0, 5, 19, 11480, 48310, 54, 10100, 86, 27, 14],
  [4, 6, 7, 26410, 65720, 231, 13100, 35, 13, 5],
  [6, 5, 5, 24780, 69290, 176, 12800, 47, 16, 7],
  [5, 5, 6, 30120, 67510, 259, 13700, 39, 11, 6],
  [3, 6, 8, 22960, 58180, 271, 12500, 29, 8, 3],
  [0, 4, 9, 9740, 41960, 49, 9300, 78, 24, 12]
];
const itemSets = [
  [3076, 3068, 3075, 3143, 3083, 3047, 3364],
  [6630, 3071, 3065, 3156, 3026, 3111, 3364],
  [6655, 3089, 3135, 3157, 3102, 3020, 3364],
  [3031, 3094, 3036, 3072, 3033, 3006, 3363],
  [3190, 3109, 3060, 3107, 3222, 3117, 3364],
  [3068, 3076, 3075, 3143, 3083, 3047, 3364],
  [6631, 3071, 3156, 3065, 3026, 3111, 3364],
  [6653, 3089, 3135, 3157, 3102, 3020, 3364],
  [3031, 3094, 3036, 3072, 3033, 3006, 3363],
  [3190, 3109, 3060, 3107, 3222, 3117, 3364]
];

// Crea un jugador usando la fila de números correspondiente a su posición.
function makePlayer(side, index) {
  const globalIndex = side === 'blue' ? index : index + 5;
  const n = numbers[globalIndex];
  return {
    participantId: globalIndex + 1,
    player: `Jugador ${String(globalIndex + 1).padStart(2, '0')}`,
    champion: champions[side][index],
    championAlias: aliases[side][index],
    championId: null,
    role: roles[index],
    teamId: side === 'blue' ? 100 : 200,
    win: side === 'blue',
    kda: { kills: n[0], deaths: n[1], assists: n[2] },
    damage: {
      champions: n[3],
      total: n[4],
      taken: 42000 + globalIndex * 1730,
      mitigated: 18000 + globalIndex * 740
    },
    healing: 2600 + globalIndex * 910,
    cs: n[5],
    gold: n[6],
    vision: {
      score: n[7],
      wardsPlaced: n[8],
      wardsKilled: n[9],
      controlWards: Math.max(1, Math.floor(n[8] / 4))
    },
    items: itemSets[globalIndex],
    spells: [4, index === 1 ? 11 : 12],
    runes: [8010, 11000],
    level: 16,
    timeCCingOthers: 14 + index * 5,
    turretKills: index === 3 ? 4 : 1,
    inhibitorKills: 0,
    objectivesStolen: 0
  };
}

// La demo tiene gameId propio y demo:true; el servidor nunca la guarda como real.
function createDemoSummary() {
  const blue = Array.from({ length: 5 }, (_, index) => makePlayer('blue', index));
  const red = Array.from({ length: 5 }, (_, index) => makePlayer('red', index));
  return {
    schemaVersion: 1,
    gameId: 'demo-postgame',
    source: 'demo',
    demo: true,
    capturedAt: new Date().toISOString(),
    gameCreation: Date.now(),
    gameDuration: 1968,
    gameNumber: 2,
    format: 'BO3',
    info: {
      tournament: 'TORNEO DE DEMOSTRACIÓN',
      blue: 'NÉBULA',
      red: 'ABISMO',
      blueShort: 'NEB',
      redShort: 'ABM'
    },
    sideTeams: { blue: 'NÉBULA', red: 'ABISMO' },
    winner: 'blue',
    teams: {
      blue: { side: 'blue', result: 'VICTORIA', kills: 26, players: blue },
      red: { side: 'red', result: 'DERROTA', kills: 18, players: red }
    }
  };
}

module.exports = { createDemoSummary };
