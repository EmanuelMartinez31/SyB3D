const DDRAGON = 'https://ddragon.leagueoflegends.com';
const CDRAGON = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';
const FALLBACK_VERSION = '16.21.1';
const LOCAL_SPELL_ICONS = new Set([
  'summoner_boost.png', 'summoner_exhaust.png', 'summoner_flash.png', 'summoner_haste.png',
  'summoner_heal.png', 'summoner_smite.png', 'summoner_teleport_new.png', 'summonermana.png',
  'summonerignite.png', 'summoner_mark.png', 'summonerbarrier.png', 'summoner_backtrack.png',
  'summoner_empty.png', 'summoner_emptysmite.png', '1101_smite.png', '1102_smite.png', '1103_smite.png'
]);

// El cliente entrega el Teleport mejorado como «Unleashed_Teleport_New.dds».
// Ese icono no está publicado ni en Data Dragon ni en los assets del cliente,
// así que se usa el de Teleport normal: es el mismo hechizo y evita el hueco.
const SPELL_ICON_ALIASES = [
  [/teleport/i, 'summoner_teleport_new.png']
];

function spellIconFile(icon) {
  const basename = String(icon || '').split(/[\\/]/).pop().toLowerCase();
  const filename = basename.replace(/\.(?:dds|tex)$/, '.png');
  if (LOCAL_SPELL_ICONS.has(filename)) return filename;
  const alias = SPELL_ICON_ALIASES.find(([pattern]) => pattern.test(filename));
  return alias ? alias[1] : null;
}

function cdragonAsset(iconPath) {
  const prefix = '/lol-game-data/assets/';
  const path = String(iconPath || '');
  return path.toLowerCase().startsWith(prefix)
    ? `${CDRAGON}/${path.slice(prefix.length).toLowerCase()}`
    : null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function loadGameCatalog() {
  let version = FALLBACK_VERSION;
  let champions = {};
  let items = {};
  let spells = {};
  let cdragonItems = new Map();
  let runeById = new Map();
  let styleById = new Map();

  try {
    const versions = await fetchJson(`${DDRAGON}/api/versions.json`);
    if (Array.isArray(versions) && versions.length) version = versions[0];
    const [championData, itemData, spellData, runeStyles, cdragonItemData] = await Promise.all([
      fetchJson(`${DDRAGON}/cdn/${version}/data/es_ES/champion.json`),
      fetchJson(`${DDRAGON}/cdn/${version}/data/es_ES/item.json`),
      fetchJson(`${DDRAGON}/cdn/${version}/data/es_ES/summoner.json`),
      fetchJson(`${DDRAGON}/cdn/${version}/data/es_ES/runesReforged.json`),
      fetchJson(`${CDRAGON}/v1/items.json`).catch(() => [])
    ]);
    champions = championData.data || {};
    items = itemData.data || {};
    spells = spellData.data || {};
    cdragonItems = new Map((Array.isArray(cdragonItemData) ? cdragonItemData : [])
      .filter(item => Number.isFinite(item?.id) && item?.iconPath)
      .map(item => [item.id, cdragonAsset(item.iconPath)]));
    for (const style of runeStyles) {
      styleById.set(style.id, style);
      for (const slot of style.slots || []) {
        for (const rune of slot.runes || []) {
          runeById.set(rune.id, { ...rune, styleId: style.id });
        }
      }
    }
  } catch {
    // Las imágenes conservan una versión fija de respaldo; el HUD sigue siendo usable.
  }

  return {
    version,
    championUrl(identifier) {
      return `${DDRAGON}/cdn/${version}/img/champion/${encodeURIComponent(identifier)}.png`;
    },
    championName(identifier) {
      return champions[identifier]?.name || identifier;
    },
    itemUrls(id) {
      return [
        `${DDRAGON}/cdn/${version}/img/item/${id}.png`,
        cdragonItems.get(id) || null
      ];
    },
    itemName(id) {
      return items[String(id)]?.name || `Objeto ${id}`;
    },
    spellUrls(name, icon) {
      const localFile = spellIconFile(icon);
      // Si hay alias local, se reutiliza ese nombre también para el respaldo
      // remoto; si no, se usa el que trae el propio cliente.
      const basename = localFile
        || String(icon || '').split(/[\\/]/).pop().toLowerCase().replace(/\.(?:dds|tex)$/, '.png');
      return [
        localFile ? `./assets/spells/${localFile}` : null,
        `${DDRAGON}/cdn/${version}/img/spell/${encodeURIComponent(name)}.png`,
        basename.endsWith('.png') ? `${CDRAGON}/data/spells/icons2d/${basename}` : null
      ];
    },
    spellName(name) {
      return spells[name]?.name || name;
    },
    runeUrl(id) {
      const rune = runeById.get(id);
      return rune ? `${DDRAGON}/cdn/img/${rune.icon}` : null;
    },
    runeName(id) {
      return runeById.get(id)?.name || `Runa ${id}`;
    },
    secondaryStyleUrl(runeIds) {
      if (!Array.isArray(runeIds) || !runeIds.length) return null;
      const primary = runeById.get(runeIds[0]);
      const secondary = runeIds.slice(1).map(id => runeById.get(id)).find(rune => rune && rune.styleId !== primary?.styleId);
      const style = secondary ? styleById.get(secondary.styleId) : null;
      return style ? `${DDRAGON}/cdn/img/${style.icon}` : null;
    },
    secondaryStyleName(runeIds) {
      if (!Array.isArray(runeIds) || !runeIds.length) return '';
      const primary = runeById.get(runeIds[0]);
      const secondary = runeIds.slice(1).map(id => runeById.get(id)).find(rune => rune && rune.styleId !== primary?.styleId);
      return secondary ? styleById.get(secondary.styleId)?.name || '' : '';
    }
  };
}
