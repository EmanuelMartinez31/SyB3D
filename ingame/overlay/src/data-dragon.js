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

// ============================================================================
// SKINS
// El cliente del juego da un número de skin por jugador, pero ese número no
// siempre coincide con el que usa Data Dragon en el nombre del archivo: hay
// campeones cuyas skins están numeradas distinto, y skins nuevas que Data
// Dragon todavía no publica. Por eso:
//   1. se pide a Community Dragon el catálogo de skins del campeón, que trae
//      el id EXACTO de cada skin y la ruta de su arte;
//   2. se prueba primero Data Dragon con el número correcto;
//   3. si falla, el arte de Community Dragon;
//   4. y si todo falla, el retrato cuadrado del campeón (nunca queda el hueco).
// ============================================================================
const skinCatalog = new Map(); // campeón normalizado → { byId, byNum, base }
let catalogVersion = FALLBACK_VERSION; // versión de Data Dragon en uso
const skinRequests = new Map(); // campeón normalizado → promesa en curso

function skinKey(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// Data Dragon nombra sus archivos con SU identificador, que no siempre es el
// que manda el juego: el cliente puede mandar el nombre interno («ChoGath»,
// «VelKoz», «TahmKench») o el nombre visible («Tahm Kench»), y Data Dragon los
// publica como «Chogath», «Velkoz», «TahmKench». Como las rutas distinguen
// mayúsculas, se resuelve siempre contra el catálogo de campeones.
const championByKey = new Map(); // nombre normalizado → { id, nombre, key }

function indexChampions(champions) {
  championByKey.clear();
  for (const [nombre, datos] of Object.entries(champions || {})) {
    const entrada = {
      id: datos?.id || nombre,
      nombre: datos?.name || nombre,
      key: datos?.key || null
    };
    for (const clave of [nombre, entrada.id, entrada.nombre]) {
      const indice = skinKey(clave);
      if (indice && !championByKey.has(indice)) championByKey.set(indice, entrada);
    }
  }
}

// Identificador EXACTO que usa Data Dragon para sus archivos.
function championFileId(identifier) {
  return championByKey.get(skinKey(identifier))?.id || String(identifier || '');
}

function championEntry(identifier) {
  return championByKey.get(skinKey(identifier)) || null;
}

function cdragonSplash(path) {
  const prefix = '/lol-game-data/assets/';
  const texto = String(path || '');
  if (!texto.toLowerCase().startsWith(prefix)) return null;
  return `${CDRAGON}/${texto.slice(prefix.length).toLowerCase()}`;
}

// Catálogo de skins de un campeón, pedido a DATA DRAGON: es el mismo servidor
// del que ya salen los retratos y el arte base, así que si el HUD tiene arte,
// el catálogo también llega. Trae, por cada skin, su id completo (223030) y su
// número de archivo (30), que es justo lo que hace falta para armar la ruta.
async function ddragonSkinCatalog(identifier) {
  const archivo = championFileId(identifier);
  if (!archivo) return null;
  const datos = await fetchJson(
    `${DDRAGON}/cdn/${catalogVersion}/data/es_ES/champion/${encodeURIComponent(archivo)}.json`
  );
  const campeon = datos?.data?.[archivo] || Object.values(datos?.data || {})[0];
  const byId = new Map();
  const byNum = new Map();
  const byName = new Map();
  const entradas = [];
  let base = null;
  for (const skin of Array.isArray(campeon?.skins) ? campeon.skins : []) {
    const id = Number(skin?.id);
    const num = Number(skin?.num);
    const entrada = {
      id,
      num,
      // Ruta de Data Dragon: img/champion/splash/{Archivo}_{num}.jpg
      url: null,
      nombre: skin?.name || '',
      // Skin de la que sale este croma (ver más abajo).
      padre: null
    };
    if (Number.isFinite(id)) byId.set(id, entrada);
    if (Number.isFinite(num)) byNum.set(num, entrada);
    const clave = skinKey(entrada.nombre);
    if (clave) byName.set(clave, entrada);
    entradas.push(entrada);
    if (num === 0) base = entrada;
  }

  // CROMAS: muchas skins tienen variantes de color que se llaman igual que la
  // original más un paréntesis: «Tahm Kench pergaminos de Shan Hai (cuarzo
  // rosa)». Esas variantes NO tienen arte de carga propio en Data Dragon, así
  // que su dirección da 404 y la ficha se caía al arte base. Aquí se apunta
  // cuál es la skin original de cada croma: la que se llama igual sin el
  // paréntesis. Con eso la ficha enseña el arte de la skin de verdad.
  for (const entrada of entradas) {
    const sinParentesis = String(entrada.nombre || '').replace(/\s*\([^)]*\)\s*$/, '');
    if (sinParentesis === entrada.nombre) continue;
    const original = byName.get(skinKey(sinParentesis));
    if (original && original !== entrada) entrada.padre = original.num;
  }

  return byId.size ? { byId, byNum, byName, base } : null;
}

// Catálogo de skins de un campeón. `numericKey` es el número de campeón de
// Riot (Tahm Kench = 223), que es el nombre del archivo en Community Dragon:
// se usa para el respaldo.
function requestSkinCatalog(identifier, numericKey) {
  const key = skinKey(identifier);
  if (!key) return Promise.resolve(null);
  if (skinCatalog.has(key)) return Promise.resolve(skinCatalog.get(key));
  if (skinRequests.has(key)) return skinRequests.get(key);
  const promise = ddragonSkinCatalog(identifier)
    .then(catalogo => {
      if (catalogo) {
        skinCatalog.set(key, catalogo);
        return catalogo;
      }
      return cdragonSkinCatalog(key, numericKey);
    })
    .catch(() => cdragonSkinCatalog(key, numericKey))
    .finally(() => skinRequests.delete(key));
  skinRequests.set(key, promise);
  return promise;
}

function cdragonSkinCatalog(key, numericKey) {
  if (!numericKey) return Promise.resolve(null);
  const url = `${CDRAGON}/v1/champions/${numericKey}.json`;
  return fetchJson(url)
    .then(datos => {
      const byId = new Map();
      const byNum = new Map();
      let base = null;
      for (const skin of Array.isArray(datos?.skins) ? datos.skins : []) {
        const id = Number(skin?.id);
        const arte = cdragonSplash(skin?.splashPath);
        // El número de la skin va al final de la ruta: …_splash_centered_30.jpg
        const coincidencia = /_(\d+)\.jpg$/i.exec(String(skin?.splashPath || ''));
        const num = coincidencia ? Number(coincidencia[1]) : null;
        const entrada = { id, num, url: arte, nombre: skin?.name || '' };
        if (Number.isFinite(id)) byId.set(id, entrada);
        if (Number.isFinite(num)) byNum.set(num, entrada);
        if (num === 0) base = entrada;
      }
      if (!byId.size) return null;
      const catalogo = { byId, byNum, base };
      skinCatalog.set(key, catalogo);
      return catalogo;
    })
    .catch(() => null);
}

// Prepara el arte de todos los campeones que van a salir en las fichas. Se
// lanza al empezar la partida, mientras la presentación todavía no se ve, así
// cuando aparecen las fichas ya está resuelto.
async function prepareSkins(identifiers, numericByChampion) {
  const unicos = [...new Set((identifiers || []).filter(Boolean))];
  await Promise.all(unicos.map(id => requestSkinCatalog(id, numericByChampion?.[skinKey(id)])));
  return unicos.length;
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
    catalogVersion = version;
    const [championData, itemData, spellData, runeStyles, cdragonItemData] = await Promise.all([
      fetchJson(`${DDRAGON}/cdn/${version}/data/es_ES/champion.json`),
      fetchJson(`${DDRAGON}/cdn/${version}/data/es_ES/item.json`),
      fetchJson(`${DDRAGON}/cdn/${version}/data/es_ES/summoner.json`),
      fetchJson(`${DDRAGON}/cdn/${version}/data/es_ES/runesReforged.json`),
      fetchJson(`${CDRAGON}/v1/items.json`).catch(() => [])
    ]);
    champions = championData.data || {};
    indexChampions(champions);
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
      return championEntry(identifier)?.nombre || champions[identifier]?.name || identifier;
    },
    // Arte de carga del campeón para las fichas grandes. Devuelve la lista de
    // candidatos en orden: el que carga primero es el que se ve.
    splashUrls(identifier, skin) {
      if (!identifier) return [];
      const archivo = championFileId(identifier);
      const ddragon = `${DDRAGON}/cdn/img/champion/splash/${encodeURIComponent(archivo)}`;
      const cuadrado = `${DDRAGON}/cdn/img/champion/${encodeURIComponent(archivo)}.png`;
      const candidatos = [];
      const push = url => { if (url && !candidatos.includes(url)) candidatos.push(url); };

      const numero = Number.isFinite(skin) && skin >= 0 ? Math.floor(skin) : 0;
      const catalogo = skinCatalog.get(skinKey(identifier));
      let resuelta = null;
      if (catalogo && numero > 0) {
        // El cliente puede mandar el id completo (223030) o solo el número (30).
        resuelta = catalogo.byId.get(numero) || catalogo.byNum.get(numero) || null;
        if (!resuelta && numero > 1000) resuelta = catalogo.byNum.get(numero % 1000) || null;
      }

      if (numero > 0) {
        // 1) Data Dragon con el número correcto de la skin.
        if (resuelta && Number.isFinite(resuelta.num)) push(`${ddragon}_${resuelta.num}.jpg`);
        // 2) Si esa skin es un CROMA (una variante de color), su arte propio no
        //    existe: se usa el de la skin original. Es lo que hacía que Tahm
        //    Kench «Shan Hai (cuarzo rosa)» y Ekko «True Damage (obsidiana)»
        //    salieran sin su arte y se quedaran con el base.
        if (resuelta && Number.isFinite(resuelta.padre)) push(`${ddragon}_${resuelta.padre}.jpg`);
        // 3) Data Dragon con el número tal cual lo mandó el juego.
        push(`${ddragon}_${numero}.jpg`);
        // 4) El cliente manda el id largo (223030 = campeón 223 + skin 30) y
        //    Data Dragon numera la skin con la parte de la derecha. Este paso
        //    NO necesita el catálogo: es la red que salva la ficha cuando el
        //    catálogo no llega (sin internet, Community Dragon bloqueado…).
        if (numero > 1000) push(`${ddragon}_${numero % 1000}.jpg`);
        // 5) El arte de Community Dragon de esa skin exacta.
        if (resuelta?.url) push(resuelta.url);
      }
      // 6) Arte base (Data Dragon y Community Dragon).
      push(`${ddragon}_0.jpg`);
      if (catalogo?.base?.url) push(catalogo.base.url);
      // 7) Último recurso: el retrato del campeón. Nunca queda el hueco vacío.
      push(cuadrado);
      return candidatos;
    },
    // Arranca la descarga del catálogo de skins de esos campeones.
    prepareSkins(identifiers) {
      const numericByChampion = {};
      for (const [nombre, datos] of Object.entries(champions)) {
        numericByChampion[skinKey(datos?.id || nombre)] = datos?.key || null;
        numericByChampion[skinKey(nombre)] = datos?.key || null;
      }
      return prepareSkins(identifiers, numericByChampion);
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
