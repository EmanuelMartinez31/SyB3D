const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

module.exports = function setupIngame({ app, port, control }) {
const DRAFT_ORIGIN = process.env.SYB_DRAFT_URL || `http://127.0.0.1:${port}`;
const DATA_DIR = path.join(__dirname, 'data');
const LATEST_PATH = path.join(DATA_DIR, 'latest-gameinfo.json');
const SAMPLE_PATH = path.join(DATA_DIR, 'sample-gameinfo.json');
const SCHEMA_PATH = path.join(DATA_DIR, 'sample-schema.json');
const OVERLAY_DIR = path.join(__dirname, 'overlay');

fs.mkdirSync(DATA_DIR, { recursive: true });
const wss = new WebSocketServer({ noServer: true });

let latest = null;
let latestState = null;
let sequence = 0;
let lastReceivedAt = null;
let lastBytes = 0;
let lastCompactBytes = 0;
let sampleSaved = false;
let diskDirty = false;
let diskWriting = false;
let seriesSignature = '';
let draftPollInFlight = false;
const reportedWinners = new Set();
const winnerReportsInFlight = new Set();
const ignoredGameIds = new Set();
const draftSync = {
  connected: false,
  info: null,
  score: null,
  sideTeams: null,
  revision: 0,
  lastSync: null,
  lastError: null
};

function emptyObjectiveScores() {
  return {
    1: { dragon: 0, grubs: 0, riftHerald: 0, baron: 0, atakhan: 0, dragonType: null, dragonTypes: [] },
    2: { dragon: 0, grubs: 0, riftHerald: 0, baron: 0, atakhan: 0, dragonType: null, dragonTypes: [] }
  };
}

let objectiveTracking = {
  gameId: null,
  previousGameTime: null,
  scores: emptyObjectiveScores(),
  objectiveKinds: new Map(),
  dragonTypes: new Map(),
  unitTeams: new Map(),
  countedObjectives: new Set(),
  defeatedKinds: new Set(),
  defeatedObjectives: new Set(),
  defeatedGrubIds: new Set(),
  defeatedGrubTeams: new Map(),
  grubNotice: null,
  dragonNotice: null,
  baronNotice: null,
  heraldNotice: null,
  respawnAt: new Map()
};

function normalizeNonFinite(value) {
  if (value === 'NaN' || value === 'Infinity' || value === '-Infinity') return null;
  if (Array.isArray(value)) return value.map(normalizeNonFinite);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = normalizeNonFinite(item);
    return result;
  }
  return value;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactPosition(position) {
  if (!position || typeof position !== 'object') return null;
  return {
    x: finiteNumber(position.x),
    y: finiteNumber(position.y),
    z: finiteNumber(position.z)
  };
}

function remainingUntil(readyAt, gameTime) {
  const target = finiteNumber(readyAt);
  const now = finiteNumber(gameTime);
  if (target === null || now === null) return null;
  return Math.max(0, target - now);
}

function sideForTeam(team) {
  if (team === 1) return 'order';
  if (team === 2) return 'chaos';
  return 'neutral';
}

function sumBy(items, selector) {
  return items.reduce((total, item) => {
    const value = finiteNumber(selector(item));
    return total + (value === null ? 0 : value);
  }, 0);
}

function roleFromBuffs(common) {
  const buffs = Array.isArray(common.Buffs) ? common.Buffs : [];
  for (const buff of buffs) {
    const match = /RoleBound_(Top|Jungle|Mid|Bot|Support)_Quest/i.exec(buff?.Name || '');
    if (match) return match[1].toLowerCase();
  }
  return null;
}

function compactSpell(spell, gameTime) {
  if (!spell || typeof spell !== 'object') return null;
  return {
    name: spell.Name ?? null,
    icon: spell.Icon ?? null,
    level: spell.Level ?? null,
    readyAt: spell.ReadyAt ?? null,
    remaining: remainingUntil(spell.ReadyAt, gameTime),
    maxCooldown: spell.MaxCooldown ?? null,
    ammoReadyAt: spell.AmmoReadyAt ?? null,
    ammoRemaining: remainingUntil(spell.AmmoReadyAt, gameTime),
    ammoCooldown: spell.AmmoCooldown ?? null,
    ammoCount: spell.AmmoCount ?? null,
    toggled: spell.IsToggled ?? null
  };
}

function compactItem(item) {
  return {
    id: item.Id ?? null,
    slot: item.Slot ?? null,
    count: item.Count ?? null,
    stacks: item.Stacks ?? null,
    charges: item.Charges ?? null,
    combineCost: item.CombineCost ?? null
  };
}

// Misión de rol (parche 26.1+). El juego publica su estado en dos buffs:
//   SR_2026_S1_RoleBound_<Rol>_Quest           → Count = puntos acumulados
//   SR_2026_S1_RoleBound_<Rol>_QuestCompleted  → misión cumplida (Count 1)
// Solo top, mid y bot llevan puntos en ese contador (1200 / 1350 / 1350).
// La jungla lo deja en 1 y el apoyo no lo usa: ahí NO se inventa progreso,
// únicamente se informa si la misión está cumplida. El objeto del hueco 8
// (y su recompensa) sirve de respaldo cuando el buff todavía no ha salido.
const QUEST_POINT_MAX = { top: 1200, mid: 1350, bot: 1350, support: 800 };
// La mascota de jungla lleva los tratos en sus cargas (es el contador que se
// muestra tal cual). El objeto de apoyo NO se usa como contador: sus cargas son
// las wards disponibles, no el avance de la misión.
const JUNGLE_PET_IDS = new Set([1101, 1102, 1103, 1104, 1105, 1106, 1107]);
const SUPPORT_ITEM_IDS = new Set([3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877]);
const QUEST_ROLE_BY_ITEM = {
  1200: 'top', 1222: 'top', 1201: 'mid', 1202: 'bot', 1203: 'support', 1204: 'jungle'
};
const QUEST_REWARD_ROLE = {
  1220: 'top', 1221: 'top', 1206: 'mid', 1207: 'bot', 1208: 'support',
  1205: 'jungle', 1209: 'jungle', 1210: 'jungle', 1211: 'jungle'
};

function compactQuest(hero, role) {
  const buffs = Array.isArray(hero?.Common?.Buffs) ? hero.Common.Buffs : [];
  const items = Array.isArray(hero?.Items) ? hero.Items : [];

  let questRole = null;
  let done = null;
  let points = null;

  for (const buff of buffs) {
    const match = /RoleBound_(Top|Jungle|Mid|Bot|Support)_Quest(Completed)?/i.exec(buff?.Name || '');
    if (!match) continue;
    questRole = match[1].toLowerCase();
    if (match[2]) done = true;
    else if (done === null) done = false;
    const count = finiteNumber(buff.Count);
    if (count !== null) points = count;
  }

  // Respaldo por objetos cuando el buff aún no aparece (primeros segundos).
  const questItem = items.find(item => finiteNumber(item?.Slot) === 8) || null;
  const slotId = finiteNumber(questItem?.Id);
  const rewardRole = QUEST_REWARD_ROLE[slotId] || null;
  const itemRole = QUEST_ROLE_BY_ITEM[slotId] || null;
  if (!questRole) questRole = rewardRole || itemRole || role || null;
  if (!questRole) return null;
  if (rewardRole && done !== true) done = true;

  const quest = { role: questRole, itemId: itemRole || rewardRole ? slotId : null, done, value: null, max: null, count: null, smiteStage: null, petId: null };

  const max = QUEST_POINT_MAX[questRole];

  if (max && questRole === 'support') {
    // El apoyo llena su objeto: el avance es el oro que acumula la misión. Se
    // toma del buff de la misión y, si aún no lo publica, de las acumulaciones
    // del objeto de apoyo. Las cargas (wards) quedan descartadas a propósito.
    let value = finiteNumber(points);
    if (!(value > 1)) {
      const supportItem = items.find(item => SUPPORT_ITEM_IDS.has(finiteNumber(item?.Id)));
      const stacks = finiteNumber(supportItem?.Stacks);
      value = stacks > 1 ? stacks : null;
    }
    if (quest.done !== true && value !== null && value > 1) {
      const clamped = Math.max(0, Math.min(max, value));
      quest.done = clamped >= max;
      if (!quest.done) {
        quest.max = max;
        quest.value = clamped;
      }
    }
  } else if (max && finiteNumber(points) !== null) {
    const value = Math.max(0, Math.min(max, points));
    if (quest.done !== true) quest.done = value >= max;
    // Al cumplirse el juego reinicia el contador a 1: no se publica ese valor
    // como si fuera progreso.
    if (!quest.done) {
      quest.max = max;
      quest.value = value;
    }
  }

  // Contador de tratos de la mascota, el mismo en el indicador de misión y en
  // el icono del castigo. Para el apoyo no se publica nada: su contador de
  // objeto serían las wards, que no miden la misión.
  const petItem = questRole === 'jungle'
    ? items.find(item => JUNGLE_PET_IDS.has(finiteNumber(item?.Id)))
    : null;
  if (petItem) {
    const treats = finiteNumber(petItem.Charges)
      ?? finiteNumber(petItem.Count)
      ?? finiteNumber(petItem.Stacks);
    const petId = finiteNumber(petItem?.Id);
    if (petId !== null) quest.petId = petId;
    if (treats !== null) {
      quest.count = treats;
      quest.smiteStage = smiteStageFor(treats);
      // Sin tratos pendientes termina la misión de jungla.
      if (quest.smiteStage === 'primal') quest.done = true;
    }
  }

  return quest;
}

// El objeto de la mascota cuenta los tratos que FALTAN (empieza en 35 y baja).
// Etapas del castigo según ese contador:
//   más de 20 restantes → castigo normal (amarillo)
//   20 a 1 restantes    → castigo desatado (arcoíris)
//   0 restantes         → castigo primigenio, del color del objeto comprado
function smiteStageFor(remaining) {
  if (remaining <= 0) return 'primal';
  if (remaining <= 20) return 'unleashed';
  return 'smite';
}

function compactPlayer(hero, gameTime) {
  const info = hero.Info || {};
  const common = hero.Common || {};
  const spells = {};
  for (const key of ['Q', 'W', 'E', 'R', 'D', 'F']) {
    spells[key.toLowerCase()] = compactSpell(hero[key], gameTime);
  }
  const role = roleFromBuffs(common);

  return {
    id: info.NetworkId ?? null,
    team: info.Team ?? null,
    side: sideForTeam(info.Team),
    index: hero.HeroIndex ?? null,
    role,
    quest: compactQuest(hero, role),
    champion: common.Identifier ?? null,
    player: hero.NameAndTagline ?? info.Name ?? null,
    position: compactPosition(info.Position),
    level: common.Level ?? null,
    experience: hero.Experience ?? null,
    kda: {
      kills: hero.Kills ?? null,
      deaths: hero.Deaths ?? null,
      assists: hero.Assists ?? null
    },
    cs: {
      total: hero.CreepScore ?? null,
      lane: hero.LaneMinionKills ?? null,
      neutral: hero.NeutralMinionKills ?? null
    },
    gold: {
      current: hero.Gold ?? null,
      total: hero.TotalGold ?? null,
      givenOnDeath: hero.GoldGivenOnDeath ?? null
    },
    health: {
      current: common.Health ?? null,
      max: common.MaxHealth ?? null
    },
    resource: {
      current: hero.Resource ?? null,
      max: hero.MaxResource ?? null,
      type: hero.ResourceType ?? null
    },
    alive: common.IsAlive ?? null,
    zombie: common.IsZombie ?? null,
    recalling: common.IsRecalling ?? null,
    targetable: common.IsTargetable ?? null,
    respawnTime: hero.RespawnTime ?? null,
    visionScore: hero.VisionScore ?? null,
    items: Array.isArray(hero.Items) ? hero.Items.map(compactItem) : [],
    runes: Array.isArray(hero.Perks) ? hero.Perks.map(perk => perk.Id ?? null) : [],
    spells
  };
}

const LANE_NAMES = { 0: 'bot', 1: 'mid', 2: 'top' };
const TURRET_TIERS = {
  0: 'base',
  1: 'inhibitor',
  2: 'inner',
  3: 'outer',
  4: 'nexus',
  5: 'nexus'
};

function parseTurretName(name) {
  const match = /Turret_T(Order|Chaos)_L(\d+)_P(\d+)/i.exec(name || '');
  if (!match) return { lane: null, laneCode: null, tier: null, tierCode: null, countsTowardTowers: null };
  const laneCode = Number(match[2]);
  const tierCode = Number(match[3]);
  return {
    lane: LANE_NAMES[laneCode] ?? null,
    laneCode,
    tier: TURRET_TIERS[tierCode] ?? null,
    tierCode,
    // P0 es la torreta especial de base presente en GameInfo.
    countsTowardTowers: tierCode !== 0
  };
}

function compactTurret(turret) {
  const info = turret.Info || {};
  const common = turret.Common || {};
  return {
    id: info.NetworkId ?? null,
    name: info.Name ?? null,
    team: info.Team ?? null,
    side: sideForTeam(info.Team),
    ...parseTurretName(info.Name),
    position: compactPosition(info.Position),
    alive: common.IsAlive ?? null,
    health: common.Health ?? null,
    maxHealth: common.MaxHealth ?? null,
    plates: turret.PlateCount ?? null,
    maxPlates: turret.MaxPlateCount ?? null
  };
}

function compactInhibitor(inhibitor) {
  const info = inhibitor.Info || {};
  const match = /Inhib_T(?:Order|Chaos)_L(\d+)/i.exec(info.Name || '');
  const laneCode = match ? Number(match[1]) : null;
  return {
    id: info.NetworkId ?? null,
    name: info.Name ?? null,
    team: info.Team ?? null,
    side: sideForTeam(info.Team),
    lane: LANE_NAMES[laneCode] ?? null,
    laneCode,
    position: compactPosition(info.Position),
    health: inhibitor.Health ?? null,
    maxHealth: inhibitor.MaxHealth ?? null,
    status: inhibitor.Status ?? null
  };
}

function compactNexus(nexus) {
  const info = nexus.Info || {};
  return {
    id: info.NetworkId ?? null,
    name: info.Name ?? null,
    team: info.Team ?? null,
    side: sideForTeam(info.Team),
    position: compactPosition(info.Position),
    health: nexus.Health ?? null,
    maxHealth: nexus.MaxHealth ?? null,
    status: nexus.Status ?? null
  };
}

function campKind(name) {
  const normalized = String(name || '').toLowerCase();
  if (normalized.includes('dragon crab')) return 'scuttle-dragon';
  if (normalized.includes('baron crab')) return 'scuttle-baron';
  if (normalized.includes('dragon')) return 'dragon';
  if (normalized.includes('horde') || normalized.includes('grub')) return 'grubs';
  if (normalized.includes('herald')) return 'riftHerald';
  if (normalized.includes('atakhan')) return 'atakhan';
  if (normalized.includes('baron')) return 'baron';
  const kinds = {
    'minion_order red': 'red-order',
    'minion_order blue': 'blue-order',
    'minion_chaos red': 'red-chaos',
    'minion_chaos blue': 'blue-chaos'
  };
  return kinds[normalized] || 'unknown';
}

function objectiveSpawnAt(kind, endTime) {
  const target = finiteNumber(endTime);
  if (target === null) return null;
  // Los primeros marcadores de dragón y vacularbas llegan un minuto antes
  // y después aparece otro marcador con el minuto restante. Se fija la
  // aparición inicial real para que la cuenta nunca salte de 00:00 a 01:00.
  if (kind === 'dragon' && target <= 300) return 300;
  if (kind === 'grubs' && target <= 480) return 480;
  return target;
}

function compactObjectives(game, gameTime) {
  const camps = [];
  const neutralMinions = Array.isArray(game.NeutralMinions) ? game.NeutralMinions : [];
  for (const minion of neutralMinions) {
    const info = minion.Info || {};
    const common = minion.Common || {};
    if (common.Identifier !== 'SRU_CampRespawnMarker') continue;
    const buffs = Array.isArray(common.Buffs) ? common.Buffs : [];
    const timer = buffs.find(buff => /camprespawncountdown/i.test(buff?.Name || ''));
    if (!timer) continue;
    const kind = campKind(info.Name);
    const spawnAt = objectiveSpawnAt(kind, timer.EndTime);
    camps.push({
      id: info.NetworkId ?? null,
      name: info.Name ?? null,
      kind,
      position: compactPosition(info.Position),
      spawnAt,
      remaining: remainingUntil(spawnAt, gameTime),
      timerVisible: !/hidden/i.test(timer.Name || '')
    });
  }

  const active = {
    dragon: game.Dragon !== null && game.Dragon !== undefined,
    baron: game.Baron !== null && game.Baron !== undefined,
    atakhan: game.Atakhan !== null && game.Atakhan !== undefined,
    riftHerald: game.RiftHerald !== null && game.RiftHerald !== undefined,
    grubs: game.Grubs !== null && game.Grubs !== undefined
  };
  // Elimina marcadores agotados: dejar uno en 00:00 impediría seleccionar el
  // siguiente dragón o el Heraldo aunque ya exista un horario posterior.
  for (let index = camps.length - 1; index >= 0; index -= 1) {
    const camp = camps[index];
    if (finiteNumber(camp.remaining) !== null && camp.remaining <= 0.05 && !active[camp.kind]) {
      camps.splice(index, 1);
    }
  }
  const hasCamp = kind => camps.some(camp => camp.kind === kind);
  const addScheduledCamp = (kind, spawnAt) => {
    if (hasCamp(kind) || active[kind] || objectiveTracking.defeatedKinds.has(kind)) return;
    if (gameTime !== null && gameTime >= spawnAt) return;
    camps.push({
      id: `schedule-${kind}`,
      name: kind,
      kind,
      position: null,
      spawnAt,
      remaining: remainingUntil(spawnAt, gameTime),
      timerVisible: true,
      scheduled: true
    });
  };

  // Tras una muerte el juego puede tardar en crear el siguiente marcador o no
  // incluirlo. Dragón reaparece a los 5 minutos y Barón a los 6.
  for (const kind of ['dragon', 'baron']) {
    const spawnAt = objectiveTracking.respawnAt.get(kind);
    if (spawnAt === undefined || hasCamp(kind) || active[kind]) continue;
    camps.push({
      id: `tracked-${kind}-respawn`, name: kind, kind, position: null,
      spawnAt, remaining: remainingUntil(spawnAt, gameTime), timerVisible: true, tracked: true
    });
  }
  // Horarios iniciales para continuar la secuencia aunque no haya marcador nativo.
  addScheduledCamp('riftHerald', 900);
  addScheduledCamp('atakhan', 1200);
  // Barón aparece siempre a los 20:00, independientemente de cuándo muera el Heraldo.
  addScheduledCamp('baron', 1200);

  return {
    // El juego entrega «Fire», «Water»… El HUD solo conoce los nombres
    // canónicos, así que se normaliza aquí y se conserva el original si algún
    // día aparece un tipo nuevo.
    upcomingDragonType: normalizedDragonName(game.UpcomingDragonType),
    // Tipo del dragón que está vivo en el pozo (para su icono cuando ya salió).
    dragonType: liveDragonType(game),
    active,
    camps
  };
}

function normalizedDragonName(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : null;
  return normalizeDragonType(raw) || raw;
}

function liveDragonType(game) {
  const candidates = [];
  if (game.Dragon && typeof game.Dragon === 'object') candidates.push(game.Dragon);
  const units = Array.isArray(game.NeutralMinions) ? game.NeutralMinions : [];
  for (const unit of units) {
    if (objectiveKindFromUnit(unit) === 'dragon' && unit?.Common?.IsAlive !== false) candidates.push(unit);
  }
  for (const unit of candidates) {
    const type = dragonTypeFromUnit(unit);
    if (type) return type;
  }
  return null;
}

function compactWards(game) {
  const minions = Array.isArray(game.Minions) ? game.Minions : [];
  const wards = [];
  for (const minion of minions) {
    const info = minion.Info || {};
    const common = minion.Common || {};
    const identifier = common.Identifier || '';
    if (!/ward|trinket/i.test(identifier)) continue;
    wards.push({
      id: info.NetworkId ?? null,
      type: identifier,
      name: info.Name ?? null,
      team: info.Team ?? null,
      side: sideForTeam(info.Team),
      position: compactPosition(info.Position),
      alive: common.IsAlive ?? null,
      health: common.Health ?? null,
      maxHealth: common.MaxHealth ?? null
    });
  }
  return wards;
}

function eventCounts(gameEvents) {
  const counts = {};
  for (const [name, events] of Object.entries(gameEvents || {})) {
    counts[name] = Array.isArray(events) ? events.length : null;
  }
  return counts;
}

function objectiveKindFromUnit(unit) {
  const info = unit?.Info || {};
  const common = unit?.Common || {};
  const name = String(info.Name || '').toLowerCase();
  const identifier = String(common.Identifier || '').toLowerCase();
  if (name.startsWith('sru_dragon_') || identifier.startsWith('sru_dragon')) return 'dragon';
  if (identifier.startsWith('sru_baron')) return 'baron';
  if (identifier === 'sru_horde') return 'grubs';
  if (identifier === 'sru_riftherald') return 'riftHerald';
  if (identifier === 'sru_atakhan') return 'atakhan';
  return null;
}

function normalizeDragonType(value) {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('elder')) return 'Elder';
  if (normalized.includes('infernal') || normalized.includes('fire')) return 'Infernal';
  if (normalized.includes('mountain') || normalized.includes('earth')) return 'Mountain';
  if (normalized.includes('ocean') || normalized.includes('water')) return 'Ocean';
  if (normalized.includes('cloud') || normalized.includes('air')) return 'Cloud';
  if (normalized.includes('hextech')) return 'Hextech';
  if (normalized.includes('chemtech')) return 'Chemtech';
  return null;
}

function dragonTypeFromUnit(unit) {
  return normalizeDragonType(`${unit?.Info?.Name || ''} ${unit?.Common?.Identifier || ''}`);
}

function objectiveKindFromEvent(value) {
  const byNumber = ['dragon', 'baron', 'grubs', 'atakhan', 'riftHerald'];
  if (Number.isInteger(value)) return byNumber[value] || null;
  const normalized = String(value || '').toLowerCase();
  const kinds = {
    dragon: 'dragon',
    baron: 'baron',
    horde: 'grubs',
    grubs: 'grubs',
    atakhan: 'atakhan',
    riftherald: 'riftHerald'
  };
  return kinds[normalized] || null;
}

function resetObjectiveTracking(gameId) {
  objectiveTracking = {
    gameId,
    previousGameTime: null,
    scores: emptyObjectiveScores(),
    objectiveKinds: new Map(),
    dragonTypes: new Map(),
    unitTeams: new Map(),
    countedObjectives: new Set(),
    defeatedKinds: new Set(),
    defeatedObjectives: new Set(),
    defeatedGrubIds: new Set(),
    defeatedGrubTeams: new Map(),
    grubNotice: null,
    dragonNotice: null,
    baronNotice: null,
    heraldNotice: null,
    respawnAt: new Map()
  };
}

function registerUnitTeams(units) {
  for (const unit of units || []) {
    const id = finiteNumber(unit?.Info?.NetworkId);
    const team = finiteNumber(unit?.Info?.Team);
    if (id !== null && (team === 1 || team === 2)) objectiveTracking.unitTeams.set(id, team);
  }
}

function recordSecuredObjective(kind, objectiveId, killerId) {
  const team = objectiveTracking.unitTeams.get(killerId);
  if (!kind || !finiteNumber(objectiveId) || objectiveId <= 0 || (team !== 1 && team !== 2)) return;
  const key = `${kind}:${objectiveId}`;
  if (objectiveTracking.countedObjectives.has(key)) return;
  objectiveTracking.countedObjectives.add(key);
  objectiveTracking.scores[team][kind] += 1;
  if (kind === 'dragon') {
    const dragonType = objectiveTracking.dragonTypes.get(objectiveId) || null;
    objectiveTracking.scores[team].dragonTypes.push(dragonType);
    objectiveTracking.scores[team].dragonType = dragonType
      || objectiveTracking.scores[team].dragonType;
  }
}

function updateObjectiveScores(game) {
  const gameId = game.GameId ?? null;
  const gameTime = finiteNumber(game.GameTime);
  const newGame = gameId !== null && objectiveTracking.gameId !== null && gameId !== objectiveTracking.gameId;
  const timeReset = gameTime !== null && objectiveTracking.previousGameTime !== null
    && gameTime + 5 < objectiveTracking.previousGameTime;
  if (newGame || timeReset || (gameId !== null && objectiveTracking.gameId === null)) {
    resetObjectiveTracking(gameId);
  }
  objectiveTracking.previousGameTime = gameTime;

  registerUnitTeams(game.Heroes);
  registerUnitTeams(game.Minions);
  registerUnitTeams(game.NeutralMinions);
  const upcomingDragonType = normalizeDragonType(game.UpcomingDragonType);
  for (const unit of game.NeutralMinions || []) {
    const id = finiteNumber(unit?.Info?.NetworkId);
    const kind = objectiveKindFromUnit(unit);
    if (id !== null && kind) {
      objectiveTracking.objectiveKinds.set(id, kind);
      if (kind === 'dragon') {
        objectiveTracking.dragonTypes.set(id, dragonTypeFromUnit(unit) || upcomingDragonType);
      }
    }
  }

  const trackDefeat = (kind, eventTime, objectiveId, killerId) => {
    if (!kind) return;
    const id = finiteNumber(objectiveId);
    const at = finiteNumber(eventTime) ?? gameTime;
    const killerTeam = objectiveTracking.unitTeams.get(finiteNumber(killerId));
    const securedByTeam = killerTeam === 1 || killerTeam === 2 ? killerTeam : null;
    // El mismo DeathEvent llega en muchos snapshots; no debe mover el respawn.
    const defeatKey = `${kind}:${id ?? at ?? 'unknown'}`;
    if (objectiveTracking.defeatedObjectives.has(defeatKey)) return;
    objectiveTracking.defeatedObjectives.add(defeatKey);
    objectiveTracking.defeatedKinds.add(kind);
    if (at !== null && kind === 'dragon') {
      objectiveTracking.respawnAt.set(kind, at + 300);
      // Cada dragón tiene un aviso propio; trackDefeat ya descartó eventos repetidos.
      objectiveTracking.dragonNotice = {
        id: `dragon:${String(gameId ?? 'partida')}:${id ?? at ?? 'desconocido'}`,
        kind: 'dragon',
        dragonType: objectiveTracking.dragonTypes.get(id) || upcomingDragonType || null,
        gameId: gameId ?? null,
        gameTime: at,
        team: securedByTeam
      };
      console.log(`Aviso 3D de dragón activado | juego=${gameId ?? 'desconocido'} | tipo=${objectiveTracking.dragonNotice.dragonType || 'desconocido'}`);
    }
    if (at !== null && kind === 'baron') {
      objectiveTracking.respawnAt.set(kind, at + 360);
      objectiveTracking.baronNotice = {
        id: `baron:${String(gameId ?? 'partida')}:${id ?? at ?? 'desconocido'}`,
        kind: 'baron',
        gameId: gameId ?? null,
        gameTime: at,
        team: securedByTeam
      };
      console.log(`Aviso 3D de Barón activado | juego=${gameId ?? 'desconocido'}`);
    }
    if (at !== null && kind === 'riftHerald') {
      objectiveTracking.heraldNotice = {
        id: `herald:${String(gameId ?? 'partida')}:${id ?? at ?? 'desconocido'}`,
        kind: 'riftHerald',
        gameId: gameId ?? null,
        gameTime: at,
        team: securedByTeam
      };
      console.log(`Aviso 3D de Heraldo activado | juego=${gameId ?? 'desconocido'}`);
    }
    if (kind === 'grubs' && id !== null && id > 0) {
      objectiveTracking.defeatedGrubIds.add(id);
      if (securedByTeam !== null) objectiveTracking.defeatedGrubTeams.set(id, securedByTeam);
      // El aviso depende exclusivamente de tres muertes con NetworkId distinto.
      // Que Grubs desaparezca al surgir el Heraldo no interviene en esta condición.
      if (objectiveTracking.defeatedGrubIds.size === 3 && !objectiveTracking.grubNotice) {
        const blueGrubs = [...objectiveTracking.defeatedGrubTeams.values()].filter(team => team === 1).length;
        const redGrubs = [...objectiveTracking.defeatedGrubTeams.values()].filter(team => team === 2).length;
        // Las vacularbas se adjudican al equipo que asegura dos de tres, no al que mata la última.
        const grubMajorityTeam = blueGrubs >= 2 ? 1 : redGrubs >= 2 ? 2 : null;
        objectiveTracking.grubNotice = {
          id: `grubs:${String(gameId ?? 'partida')}:${[...objectiveTracking.defeatedGrubIds].sort((a, b) => a - b).join('-')}`,
          kind: 'grubs',
          gameId: gameId ?? null,
          gameTime: at,
          team: grubMajorityTeam,
          defeated: 3
        };
        console.log(`Aviso 3D de vacularbas activado | juego=${gameId ?? 'desconocido'} | muertes=3 | equipo=${grubMajorityTeam ?? 'desconocido'}`);
      }
    }
  };

  const events = game.GameEvents || {};
  for (const event of events.DeathEvents || []) {
    const victimId = finiteNumber(event?.VictimNetworkId);
    const killerId = finiteNumber(event?.KillerNetworkId);
    const kind = objectiveTracking.objectiveKinds.get(victimId);
    trackDefeat(kind, event?.GameTime, victimId, killerId);
    recordSecuredObjective(kind, victimId, killerId);
  }
  // Los robos también llegan como muerte. countedObjectives evita sumarlos dos veces.
  for (const event of events.ObjectiveStealEvents || []) {
    const objectiveId = finiteNumber(event?.ObjectiveNetworkId);
    const killerId = finiteNumber(event?.KillerNetworkId);
    const kind = objectiveKindFromEvent(event?.ObjectiveType);
    trackDefeat(kind, event?.GameTime, objectiveId, killerId);
    recordSecuredObjective(kind, objectiveId, killerId);
  }

  return {
    1: { ...objectiveTracking.scores[1], dragonTypes: [...objectiveTracking.scores[1].dragonTypes] },
    2: { ...objectiveTracking.scores[2], dragonTypes: [...objectiveTracking.scores[2].dragonTypes] }
  };
}

function buildIngameState(game, meta) {
  const gameTime = finiteNumber(game.GameTime);
  const players = (Array.isArray(game.Heroes) ? game.Heroes : [])
    .map(hero => compactPlayer(hero, gameTime));
  const turrets = (Array.isArray(game.Turrets) ? game.Turrets : []).map(compactTurret);
  const inhibitors = (Array.isArray(game.BarracksDampeners) ? game.BarracksDampeners : []).map(compactInhibitor);
  const nexus = (Array.isArray(game.Hqs) ? game.Hqs : []).map(compactNexus);
  const objectiveScores = updateObjectiveScores(game);

  const teams = [1, 2].map((team, index) => {
    const members = players.filter(player => player.team === team);
    const teamTurrets = turrets.filter(turret => turret.team === team && turret.countsTowardTowers);
    const outerTurrets = teamTurrets.filter(turret => turret.tier === 'outer');
    const teamStats = Array.isArray(game.TeamStats) ? game.TeamStats[index] : null;
    return {
      team,
      side: sideForTeam(team),
      kills: sumBy(members, player => player.kda.kills),
      deaths: sumBy(members, player => player.kda.deaths),
      assists: sumBy(members, player => player.kda.assists),
      totalGold: sumBy(members, player => player.gold.total),
      currentGold: sumBy(members, player => player.gold.current),
      totalCs: sumBy(members, player => player.cs.total),
      // Se conserva el orden TeamStats[0]=Order y [1]=Chaos observado en Farsight.
      towersLost: teamStats?.TowersLost ?? null,
      towersRemaining: teamTurrets.filter(turret => turret.alive === true).length,
      outerTurretPlatesRemaining: sumBy(outerTurrets, turret => turret.plates),
      objectives: objectiveScores[team]
    };
  });

  return {
    schemaVersion: 1,
    meta: {
      sequence: meta.sequence,
      receivedAt: meta.receivedAt,
      rawBytes: meta.rawBytes,
      gameId: game.GameId ?? null,
      gameTime,
      playbackSpeed: game.PlaybackSpeed ?? null,
      utcTime: game.UtcTime ?? null
    },
    teams,
    players,
    objectives: compactObjectives(game, gameTime),
    notices: {
      grubs: objectiveTracking.grubNotice,
      dragon: objectiveTracking.dragonNotice,
      baron: objectiveTracking.baronNotice,
      herald: objectiveTracking.heraldNotice
    },
    structures: { turrets, inhibitors, nexus },
    wards: compactWards(game),
    eventCounts: eventCounts(game.GameEvents)
  };
}

function httpRequestJson(url, method = 'GET', payload = null) {
  return new Promise((resolve, reject) => {
    const body = payload === null ? null : JSON.stringify(payload);
    const request = http.request(url, {
      method,
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      } : {}
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        text += chunk;
        if (text.length > 2_000_000) request.destroy(new Error('Respuesta demasiado grande'));
      });
      response.on('end', () => {
        let data = null;
        try { data = text ? JSON.parse(text) : null; }
        catch { return reject(new Error(`JSON inválido de SyB3D (HTTP ${response.statusCode})`)); }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(data?.error || `SyB3D respondió HTTP ${response.statusCode}`));
        }
        resolve(data);
      });
    });
    request.setTimeout(2000, () => request.destroy(new Error('Tiempo de espera agotado')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function absoluteDraftAsset(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { return new URL(value.trim(), `${DRAFT_ORIGIN}/`).href; }
  catch { return ''; }
}

function normalizeDraftInfo(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null;
  return {
    ...info,
    blueLogo: absoluteDraftAsset(info.blueLogo),
    redLogo: absoluteDraftAsset(info.redLogo)
  };
}

function broadcastLatestState() {
  if (!latestState) return;
  const message = JSON.stringify({ type: 'ingame-state', data: latestState });
  lastCompactBytes = Buffer.byteLength(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

function applyDraftState(data, broadcastWaiting = true) {
  const info = normalizeDraftInfo(data?.info);
  const score = data?.score && typeof data.score === 'object' ? data.score : null;
  const sideTeams = data?.sideTeams && typeof data.sideTeams === 'object' ? data.sideTeams : null;
  const revision = Number.isInteger(data?.revision) ? data.revision : draftSync.revision;
  const wasConnected = draftSync.connected;
  draftSync.connected = true;
  draftSync.info = info;
  draftSync.score = score;
  draftSync.sideTeams = sideTeams;
  draftSync.revision = revision;
  draftSync.lastSync = new Date().toISOString();
  draftSync.lastError = null;
  if (!wasConnected) console.log(`SyB3D sincronizado desde ${DRAFT_ORIGIN}`);

  const signature = JSON.stringify({ info, score, sideTeams, revision });
  if (signature === seriesSignature) return;
  seriesSignature = signature;
  if (latestState) {
    latestState.info = info;
    latestState.score = score;
    latestState.sideTeams = sideTeams;
    broadcastLatestState();
  } else if (broadcastWaiting) {
    const message = JSON.stringify({ type: 'ingame-clear', data: currentSeriesConfig() });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(message);
    }
  }
}

async function syncDraftState() {
  if (draftPollInFlight) return;
  draftPollInFlight = true;
  try {
    applyDraftState(await httpRequestJson(`${DRAFT_ORIGIN}/series-state`));
  } catch (error) {
    const shouldLog = draftSync.connected || draftSync.lastError !== error.message;
    draftSync.connected = false;
    draftSync.lastError = error.message;
    if (shouldLog) console.log(`SyB3D no disponible; se conserva la última configuración (${error.message})`);
  } finally {
    draftPollInFlight = false;
  }
}

function detectGameWinner(game) {
  const gameId = game?.GameId;
  const gameTime = finiteNumber(game?.GameTime);
  if (gameId === null || gameId === undefined || gameTime === null || gameTime < 60) return null;
  const deathIds = new Set((game.GameEvents?.DeathEvents || [])
    .map(event => finiteNumber(event?.VictimNetworkId))
    .filter(id => id !== null));

  for (const nexus of Array.isArray(game.Hqs) ? game.Hqs : []) {
    const team = finiteNumber(nexus?.Info?.Team);
    if (team !== 1 && team !== 2) continue;
    const health = finiteNumber(nexus?.Health);
    const id = finiteNumber(nexus?.Info?.NetworkId);
    const destroyed = (health !== null && health <= 0) || (id !== null && deathIds.has(id));
    if (destroyed) {
      return {
        gameId: String(gameId),
        winner: team === 1 ? 'red' : 'blue',
        losingTeam: team,
        gameTime
      };
    }
  }
  return null;
}

async function maybeReportGameWinner(game) {
  const result = detectGameWinner(game);
  if (!result || reportedWinners.has(result.gameId) || winnerReportsInFlight.has(result.gameId)) return;
  winnerReportsInFlight.add(result.gameId);
  // El postpartida también depende del nexo: en personalizadas observadas LCU
  // puede permanecer en None y nunca generar una fase EndOfGame.
  control.emit('ingame-game-ended', result);
  try {
    const response = await httpRequestJson(
      `${DRAFT_ORIGIN}/series/game-winner`,
      'POST',
      { ...result, revision: draftSync.revision }
    );
    if (response?.ok) {
      reportedWinners.add(result.gameId);
      console.log(
        `Victoria ${result.winner} reportada | juego=${result.gameId} | ` +
        `${response.stale ? 'partida anterior descartada' : response.duplicate ? 'ya estaba registrada' : response.pending ? 'pendiente hasta Siguiente juego' : 'registrada'}`
      );
    }
  } catch (error) {
    if (!draftSync.lastError || draftSync.connected) {
      console.log(`No se pudo reportar la victoria; se reintentará (${error.message})`);
    }
  } finally {
    winnerReportsInFlight.delete(result.gameId);
  }
}

function currentSeriesConfig(reason = 'waiting') {
  return {
    reason,
    info: draftSync.info,
    score: draftSync.score,
    sideTeams: draftSync.sideTeams,
    revision: draftSync.revision
  };
}

function clearIngame(config) {
  const previousGameId = latest?.GameId ?? latestState?.meta?.gameId;
  if (previousGameId !== null && previousGameId !== undefined) {
    ignoredGameIds.add(String(previousGameId));
    // Evita crecimiento indefinido durante muchas series en el mismo proceso.
    if (ignoredGameIds.size > 20) ignoredGameIds.delete(ignoredGameIds.values().next().value);
  }

  latest = null;
  latestState = null;
  sequence = 0;
  lastReceivedAt = null;
  lastBytes = 0;
  lastCompactBytes = 0;
  diskDirty = false;
  resetObjectiveTracking(null);
  applyDraftState(config, false);

  const message = JSON.stringify({ type: 'ingame-clear', data: currentSeriesConfig(config?.reason) });
  lastCompactBytes = Buffer.byteLength(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
  console.log(`Ingame limpio (${config?.reason || 'control de serie'}); se ignorará la partida anterior`);
}

control.on('series-control', clearIngame);

const REPLAY_RENDER_PATH = '/replay/render';
const INTERFACE_PROPERTIES = [
  'interfaceKillCallouts',
  'interfaceAnnounce',
  'interfaceScore',
  'interfaceScoreboard',
  'interfaceNeutralTimers',
  'interfaceFrames',
  'interfaceTimeline',
  'interfaceChat',
  'interfaceMinimap',
  'interfaceTarget',
  'interfaceQuests',
  'interfaceReplay'
];

function parseReplayBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function replayRenderRequest(method, properties) {
  return new Promise((resolve, reject) => {
    const body = properties ? JSON.stringify(properties) : null;
    const request = https.request({
      hostname: '127.0.0.1',
      port: 2999,
      path: REPLAY_RENDER_PATH,
      method,
      // El endpoint local de replay usa un certificado propio del juego.
      // Esta excepción queda limitada exclusivamente a 127.0.0.1:2999.
      rejectUnauthorized: false,
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      } : {}
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          request.destroy(new Error('Respuesta de replay demasiado grande'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: response.statusCode || 0,
          body: parseReplayBody(text)
        });
      });
    });
    request.setTimeout(2500, () => {
      request.destroy(new Error('El endpoint de replay no respondió a tiempo'));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function replayError(message, result) {
  const error = new Error(message);
  error.gameStatus = result?.statusCode ?? null;
  error.gameResponse = result?.body ?? null;
  return error;
}

async function getReplayRenderStatus() {
  const result = await replayRenderRequest('GET');
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw replayError(`El juego respondió HTTP ${result.statusCode} al consultar replay`, result);
  }
  return result;
}

async function setInterfaceVisibility(visible) {
  const properties = Object.fromEntries(
    INTERFACE_PROPERTIES.map(property => [
      property,
      // Se conservan el minimapa y el panel del jugador seleccionado.
      visible || property === 'interfaceMinimap' || property === 'interfaceTarget'
    ])
  );
  let lastResult = null;

  // GameLib también reintenta 404/405 durante unos dos segundos mientras
  // el endpoint de replay termina de hacerse escribible.
  for (let attempt = 1; attempt <= 9; attempt += 1) {
    lastResult = await replayRenderRequest('POST', properties);
    if (lastResult.statusCode >= 200 && lastResult.statusCode < 300) {
      return { properties, game: lastResult };
    }
    const retryable = lastResult.statusCode === 404 || lastResult.statusCode === 405;
    if (!retryable || attempt === 9) {
      throw replayError(`El juego rechazó el cambio de HUD con HTTP ${lastResult.statusCode}`, lastResult);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw replayError('No se pudo cambiar la visibilidad del HUD', lastResult);
}

let autoHideInFlight = false;
let autoHideGameId = null;
let autoHideRetryAt = 0;
let autoHideLastError = '';

async function autoHideNativeHud(game) {
  const key = String(game?.GameId ?? 'partida-actual');
  if (autoHideGameId === key || autoHideInFlight || Date.now() < autoHideRetryAt) return;
  autoHideInFlight = true;
  try {
    await setInterfaceVisibility(false);
    autoHideGameId = key;
    autoHideLastError = '';
    console.log(`HUD nativo oculto automáticamente | juego=${key} | minimapa y jugador seleccionado visibles`);
  } catch (error) {
    autoHideRetryAt = Date.now() + 2000;
    if (autoHideLastError !== error.message) {
      console.log(`HUD automático pendiente; se reintentará (${error.message})`);
    }
    autoHideLastError = error.message;
  } finally {
    autoHideInFlight = false;
  }
}

function inventory(value, currentPath = '$', depth = 0, output = []) {
  if (depth > 14) return output;
  if (Array.isArray(value)) {
    output.push({ path: currentPath, type: 'array', length: value.length });
    if (value.length) inventory(value[0], `${currentPath}[0]`, depth + 1, output);
  } else if (value && typeof value === 'object') {
    output.push({ path: currentPath, type: 'object' });
    for (const [key, item] of Object.entries(value)) {
      inventory(item, `${currentPath}.${key}`, depth + 1, output);
    }
  } else {
    output.push({ path: currentPath, type: value === null ? 'null' : typeof value, value });
  }
  return output;
}

function saveFirstSample(raw) {
  if (sampleSaved) return;
  sampleSaved = true;
  const rawText = JSON.stringify(raw, null, 2);
  const schemaText = JSON.stringify(inventory(raw), null, 2);
  fs.writeFile(SAMPLE_PATH, rawText, error => {
    if (error) console.error('No se pudo guardar la muestra:', error.message);
    else console.log(`Muestra inicial guardada en ${SAMPLE_PATH}`);
  });
  fs.writeFile(SCHEMA_PATH, schemaText, error => {
    if (error) console.error('No se pudo guardar el inventario:', error.message);
    else console.log(`Inventario de campos guardado en ${SCHEMA_PATH}`);
  });
}

const diskTimer = setInterval(async () => {
  if (!diskDirty || diskWriting || latest === null) return;
  diskWriting = true;
  diskDirty = false;
  const tempPath = `${LATEST_PATH}.tmp`;
  try {
    await fs.promises.writeFile(tempPath, JSON.stringify(latest));
    await fs.promises.rename(tempPath, LATEST_PATH);
  } catch (error) {
    console.error('No se pudo actualizar latest-gameinfo.json:', error.message);
  } finally {
    diskWriting = false;
  }
}, 1000);
diskTimer.unref();

app.use(express.json({ limit: '8mb' }));
app.use('/overlay', express.static(OVERLAY_DIR));

app.post('/sensor', (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Se esperaba un objeto GameInfo JSON' });
  }

  const normalized = normalizeNonFinite(req.body);
  const incomingGameId = normalized.GameId;
  if (incomingGameId !== null && incomingGameId !== undefined && ignoredGameIds.has(String(incomingGameId))) {
    return res.sendStatus(204);
  }

  saveFirstSample(normalized);
  const nextSequence = sequence + 1;
  const receivedAt = new Date().toISOString();
  const rawBytes = Number(req.get('content-length')) || 0;

  let adapted;
  try {
    adapted = buildIngameState(normalized, {
      sequence: nextSequence,
      receivedAt,
      rawBytes
    });
  } catch (error) {
    console.error('No se pudo adaptar GameInfo:', error);
    return res.status(500).json({ error: 'No se pudo adaptar GameInfo' });
  }

  adapted.info = draftSync.info;
  adapted.score = draftSync.score;
  adapted.sideTeams = draftSync.sideTeams;

  latest = normalized;
  latestState = adapted;
  sequence = nextSequence;
  lastReceivedAt = receivedAt;
  lastBytes = rawBytes;
  const message = JSON.stringify({ type: 'ingame-state', data: latestState });
  lastCompactBytes = Buffer.byteLength(message);
  diskDirty = true;

  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
  void maybeReportGameWinner(normalized);
  void autoHideNativeHud(normalized);

  if (sequence === 1 || sequence % 20 === 0) {
    console.log(
      `GameInfo #${sequence}: ${lastBytes} bytes crudos → ${lastCompactBytes} bytes WS | ` +
      `clientes WS: ${wss.clients.size}`
    );
  }
  res.sendStatus(204);
});

app.get('/status', (req, res) => {
  const staleMs = lastReceivedAt ? Date.now() - Date.parse(lastReceivedAt) : null;
  res.json({
    receiving: staleMs !== null && staleMs < 2000,
    sequence,
    lastReceivedAt,
    lastBytes,
    lastCompactBytes,
    webSocketClients: wss.clients.size,
    latestAvailable: latest !== null,
    compactAvailable: latestState !== null,
    draft: {
      url: DRAFT_ORIGIN,
      connected: draftSync.connected,
      lastSync: draftSync.lastSync,
      error: draftSync.lastError
    },
    winnersReported: reportedWinners.size,
    hudAutoHide: {
      gameId: autoHideGameId,
      inFlight: autoHideInFlight,
      error: autoHideLastError || null,
      preserve: ['interfaceMinimap', 'interfaceTarget']
    }
  });
});

app.get('/gameinfo', (req, res) => {
  if (latest === null) return res.status(404).json({ error: 'Todavía no llega GameInfo' });
  res.json(latest);
});

app.get('/ingame', (req, res) => {
  if (latestState === null) return res.status(404).json({ error: 'Todavía no llega GameInfo' });
  res.json(latestState);
});

app.get('/hud/status', async (req, res) => {
  try {
    const result = await getReplayRenderStatus();
    res.json({ ok: true, game: result });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error.message,
      gameStatus: error.gameStatus ?? null,
      gameResponse: error.gameResponse ?? null
    });
  }
});

app.post('/hud/hide', async (req, res) => {
  try {
    const result = await setInterfaceVisibility(false);
    res.json({ ok: true, visible: false, ...result });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error.message,
      gameStatus: error.gameStatus ?? null,
      gameResponse: error.gameResponse ?? null
    });
  }
});

app.post('/hud/show', async (req, res) => {
  try {
    const result = await setInterfaceVisibility(true);
    res.json({ ok: true, visible: true, ...result });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error.message,
      gameStatus: error.gameStatus ?? null,
      gameResponse: error.gameResponse ?? null
    });
  }
});

wss.on('connection', ws => {
  console.log(`Overlay conectado por WebSocket (${wss.clients.size} cliente(s))`);
  if (latestState !== null) {
    ws.send(JSON.stringify({ type: 'ingame-init', data: latestState }));
  } else {
    ws.send(JSON.stringify({ type: 'ingame-clear', data: currentSeriesConfig() }));
  }
  ws.on('close', () => console.log(`Overlay desconectado (${wss.clients.size} cliente(s))`));
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Snapshot demasiado grande' });
  }
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  console.error('Error HTTP:', error);
  res.status(500).json({ error: 'Error interno del receptor' });
});

return {
  wss,
  start() {
    const draftTimer = setInterval(syncDraftState, 1000);
    draftTimer.unref();
    void syncDraftState();
  }
};
};
