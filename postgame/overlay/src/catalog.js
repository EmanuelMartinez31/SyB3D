// Data Dragon proporciona retratos, iconos de objetos y runas. Los GLB son locales.
const DDRAGON = 'https://ddragon.leagueoflegends.com';
// Los fragmentos (las tres piezas pequeñas de la página) no están en Data Dragon:
// se piden al CDN de Community Dragon, que sí publica esos iconos.
const CDRAGON =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1';
let version = '16.21.1';

// Los nueve fragmentos repartidos entre las tres filas. El id que manda el
// cliente es el de la izquierda; a la derecha, el archivo del CDN.
const SHARD_ICONS = {
  5001: 'statmodshealthscalingicon',
  5002: 'statmodsarmoricon',
  5003: 'statmodsmagicresicon',
  5005: 'statmodsattackspeedicon',
  5006: 'statmodsmovespeedicon',
  5007: 'statmodscdrscalingicon',
  5008: 'statmodsadaptiveforceicon',
  5009: 'statmodsadaptiveforceicon',
  5010: 'statmodsmovespeedicon',
  5011: 'statmodshealthplusicon',
  5013: 'statmodstenacityicon',
  5014: 'statmodsadaptiveforceicon'
};

// id de runa o de estilo → ruta de su icono dentro de Data Dragon.
const runeIcons = new Map();
// id de estilo → nombre del árbol en español («Precisión», «Dominación»…).
const runeNames = new Map();
// Respaldo si Data Dragon no responde: los cinco árboles no cambian nunca.
const STYLE_NAMES = { 8000: 'Precisión', 8100: 'Dominación', 8200: 'Brujería', 8300: 'Inspiración', 8400: 'Valor' };

// id de hechizo de invocador → archivo de su icono. Se rellena con summoner.json;
// la tabla corta sirve de respaldo para los hechizos más usados.
const spellIcons = new Map([
  [1, 'SummonerBoost'], [3, 'SummonerExhaust'], [4, 'SummonerFlash'], [6, 'SummonerHaste'],
  [7, 'SummonerHeal'], [11, 'SummonerSmite'], [12, 'SummonerTeleport'], [13, 'SummonerMana'],
  [14, 'SummonerDot'], [21, 'SummonerBarrier'], [32, 'SummonerSnowball'], [39, 'SummonerSnowURFSnowball_Mark']
]);

// El cliente entrega el Teleport mejorado como un icono que no está publicado.
// Se usa el de Teleport normal: es el mismo hechizo y evita el hueco.
const SPELL_ALIASES = [[/unleashed/i, 'SummonerTeleport']];

// Descarga el árbol de runas una sola vez. Si falla, la tarjeta recurre al
// respaldo que manda cada jugador en el propio resumen.
async function loadRunes() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`${DDRAGON}/cdn/${version}/data/es_ES/runesReforged.json`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    const styles = await response.json();
    if (!Array.isArray(styles)) return;
    for (const style of styles) {
      if (style?.id && style?.icon) runeIcons.set(Number(style.id), style.icon);
      if (style?.id && style?.name) runeNames.set(Number(style.id), style.name);
      for (const slot of style?.slots || []) {
        for (const rune of slot?.runes || []) {
          if (rune?.id && rune?.icon) runeIcons.set(Number(rune.id), rune.icon);
        }
      }
    }
  } catch {}
}

// Hechizos de invocador: id numérico → archivo del icono. Solo se usa para
// pintar la ficha del jugador; si falla, queda la tabla corta de respaldo.
async function loadSpells() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/summoner.json`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await response.json();
    for (const entrada of Object.values(data?.data || {})) {
      const id = Number(entrada?.key);
      const file = String(entrada?.image?.full || '').replace(/\.png$/i, '');
      if (Number.isFinite(id) && file) spellIcons.set(id, file);
    }
  } catch {}
}

// Obtiene la versión disponible y conserva una anterior como respaldo si falla.
export async function loadCatalog() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`${DDRAGON}/api/versions.json`, { signal: controller.signal });
    clearTimeout(timer);
    const versions = await response.json();
    if (Array.isArray(versions) && versions.length) version = versions[0];
  } catch {}
  await loadRunes();
  await loadSpells();
  return {
    itemUrl(id) {
      return `${DDRAGON}/cdn/${version}/img/item/${encodeURIComponent(id)}.png`;
    },
    championUrl(alias) {
      return `${DDRAGON}/cdn/${version}/img/champion/${encodeURIComponent(alias)}.png`;
    },
    // Icono de una runa o de un árbol. Devuelve null si no está en el mapa:
    // es mejor no pintar nada que pintar un icono equivocado.
    runeUrl(id) {
      const icon = runeIcons.get(Number(id));
      return icon ? `${DDRAGON}/cdn/img/${icon}` : null;
    },
    // Nombre del árbol de runas en español. Si Data Dragon falló, la tabla fija.
    styleName(id) {
      return runeNames.get(Number(id)) || STYLE_NAMES[Number(id)] || '';
    },
    // Icono de un hechizo de invocador. Los ids desconocidos no se pintan.
    spellUrl(id) {
      let file = spellIcons.get(Number(id)) || null;
      if (!file) {
        const alias = SPELL_ALIASES.find(([pattern]) => pattern.test(String(id)));
        if (alias) file = alias[1];
      }
      return file ? `${DDRAGON}/cdn/${version}/img/spell/${encodeURIComponent(file)}.png` : null;
    },
    // Icono de un fragmento. Los ids nuevos que no estén en la tabla no se pintan.
    shardUrl(id) {
      const file = SHARD_ICONS[Number(id)];
      return file ? `${CDRAGON}/perk-images/statmods/${file}.png` : null;
    }
  };
}
