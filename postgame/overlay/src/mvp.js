// POSTPARTIDA · SELECCIÓN DEL MVP
// Puntuación estadística propia de SyB: no es un MVP oficial de Riot.
// Solamente compara jugadores del equipo ganador y utiliza datos ya normalizados.

function stat(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function winnerSide(summary) {
  if (summary?.winner === 'blue' || summary?.winner === 'red') return summary.winner;
  for (const side of ['blue', 'red']) {
    const team = summary?.teams?.[side];
    if (String(team?.result || '').toUpperCase() === 'VICTORIA') return side;
  }
  for (const side of ['blue', 'red']) {
    if (summary?.teams?.[side]?.players?.some((player) => player.win === true)) return side;
  }
  return null;
}

function scorePlayer(player, context) {
  const kills = stat(player.kda?.kills);
  const deaths = stat(player.kda?.deaths);
  const assists = stat(player.kda?.assists);
  const damage = stat(player.damage?.champions);
  const taken = stat(player.damage?.taken);
  const gold = stat(player.gold);
  const vision = stat(player.vision?.score);
  const crowdControl = stat(player.timeCCingOthers);

  // Participación y repartos internos permiten comparar aportaciones distintas:
  // carries, tanques y soportes no dependen únicamente de hacer daño.
  const killParticipation = (kills + assists) / Math.max(1, context.teamKills);
  const damageShare = damage / Math.max(1, context.teamDamage);
  const takenShare = taken / Math.max(1, context.teamDamageTaken);
  const smartKda = (kills - deaths + assists / 1.5) / 3.5;
  const kdaRatio = (kills + assists) / Math.max(1, deaths);

  const goldScore = gold / context.minutes / 130;
  const visionScore = (vision / context.minutes) * 1.6;
  const participationScore = killParticipation * 2;
  const utilityScore = takenShare + crowdControl / 50 - 0.6;
  const damageScore = damageShare + damage / context.minutes / 800;

  // No se recorta el resultado: el MVP es una clasificación y los límites
  // artificiales podrían producir empates entre actuaciones diferentes.
  const score =
    goldScore +
    visionScore +
    participationScore +
    smartKda +
    utilityScore +
    damageScore;

  const hasStats = [kills, assists, damage, taken, gold, vision, crowdControl].some(
    (value) => value > 0
  );
  return { score, killParticipation, kdaRatio, damage, gold, hasStats };
}

export function selectMvp(summary) {
  const side = winnerSide(summary);
  const players = side ? summary?.teams?.[side]?.players : null;
  if (!side || !Array.isArray(players) || players.length === 0) return null;

  const teamKills = players.reduce((total, player) => total + stat(player.kda?.kills), 0);
  const teamDamage = players.reduce(
    (total, player) => total + stat(player.damage?.champions),
    0
  );
  const teamDamageTaken = players.reduce(
    (total, player) => total + stat(player.damage?.taken),
    0
  );
  // Todas las capturas reales incluyen duración. El valor de 30 minutos evita
  // puntuaciones infinitas si un resumen antiguo o incompleto no la conserva.
  const minutes = stat(summary.gameDuration) > 0 ? summary.gameDuration / 60 : 30;
  const context = { teamKills, teamDamage, teamDamageTaken, minutes };

  const candidates = players
    .map((player, index) => ({ side, index, player, ...scorePlayer(player, context) }))
    .filter((candidate) => candidate.hasStats);
  if (!candidates.length) return null;

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.killParticipation - a.killParticipation ||
      b.kdaRatio - a.kdaRatio ||
      b.damage - a.damage ||
      b.gold - a.gold ||
      a.index - b.index
  );
  return candidates[0];
}
