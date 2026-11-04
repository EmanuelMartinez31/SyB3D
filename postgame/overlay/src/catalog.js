// Data Dragon solo proporciona retratos e iconos de objetos. Los GLB son locales.
const DDRAGON = 'https://ddragon.leagueoflegends.com';
let version = '16.21.1';

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
  return {
    itemUrl(id) {
      return `${DDRAGON}/cdn/${version}/img/item/${encodeURIComponent(id)}.png`;
    },
    championUrl(alias) {
      return `${DDRAGON}/cdn/${version}/img/champion/${encodeURIComponent(alias)}.png`;
    }
  };
}
