// POSTPARTIDA · MODELOS 3D
// Administra archivos GLB, animaciones, escala y dibujo de los diez campeones.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { SCALE_FIX } from './scale-fix.js';

// ============================================================================
// 1. BÚSQUEDA DE ARCHIVOS
// Normalizar nombres permite encontrar "AurelionSol.glb" aunque el dato del
// campeón contenga espacios, apóstrofos o acentos.
// ============================================================================
function normalizedName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

// Percentil de una lista ya ordenada.
function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

// ============================================================================
// 1a. NUBE DE VÉRTICES DEL CUERPO
// Es la medida en la que se apoya todo el encuadre. Se toman los vértices de
// las mallas del cuerpo (las que tienen peso de vértices suficiente) y se
// construye un histograma vertical:
//   · el suelo es la franja MÁS BAJA con densidad real (un efecto que cuelga
//     por debajo o un hueso suelto no cuentan);
//   · la coronilla es la franja MÁS ALTA con densidad real (el filo de un arma,
//     un tótem o un penacho fino no cuentan).
// Con esto, el alto medido es el del cuerpo aunque el GLB traiga accesorios.
// ============================================================================
const MUESTRAS_MAX = 45000;
const PESO_MINIMO_MALLA = 0.02;

function vertexCloud(model) {
  let total = 0;
  const mallas = [];
  model.traverse((node) => {
    const attr = node.geometry?.attributes?.position;
    if (!node.isMesh || !attr) return;
    mallas.push({ node, attr, count: attr.count });
    total += attr.count;
  });
  if (!mallas.length || !total) return null;
  // Se descartan mallas anecdóticas (un adorno de diez vértices) para que no
  // arrastren el histograma, pero se conservan todas las del cuerpo.
  const utiles = mallas.filter((m) => m.count >= total * PESO_MINIMO_MALLA);
  const elegidas = utiles.length ? utiles : mallas;
  const paso = Math.max(1, Math.floor(total / MUESTRAS_MAX));
  const puntos = [];
  const v = new THREE.Vector3();
  let indice = 0;
  for (const m of elegidas) {
    for (let i = 0; i < m.attr.count; i += 1) {
      if (indice++ % paso) continue;
      v.fromBufferAttribute(m.attr, i).applyMatrix4(m.node.matrixWorld);
      puntos.push(v.x, v.y, v.z);
    }
  }
  return puntos.length >= 90 ? puntos : null;
}

// Extremos verticales por densidad.
function verticalSpan(puntos) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < puntos.length; i += 3) {
    const y = puntos[i];
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const rango = max - min;
  if (!(rango > 0.0001)) return null;
  const FRANJAS = 300;
  const cuenta = new Array(FRANJAS).fill(0);
  const muestras = puntos.length / 3;
  for (let i = 1; i < puntos.length; i += 3) {
    const f = Math.min(FRANJAS - 1, Math.floor(((puntos[i] - min) / rango) * FRANJAS));
    cuenta[f] += 1;
  }
  // Un cuerpo llena sus franjas; un arma fina deja muy pocos vértices por franja.
  const umbral = Math.max(2, Math.round(muestras * 0.0025));
  let primera = -1;
  let ultima = -1;
  for (let f = 0; f < FRANJAS; f += 1) {
    if (cuenta[f] < umbral) continue;
    if (primera < 0) primera = f;
    ultima = f;
  }
  if (primera < 0) return null;
  const base = min + (primera / FRANJAS) * rango;
  const crown = min + ((ultima + 1) / FRANJAS) * rango;
  return { base, crown, rango, altura: crown - base };
}

function measureCloud(model) {
  const puntos = vertexCloud(model);
  if (!puntos) return null;
  const span = verticalSpan(puntos);
  if (!span || span.altura < span.rango * 0.25) return null;

  // Ancho y fondo solo con los vértices del cuerpo (entre el 8 % y el 92 % del
  // alto) y recortando las colas, para que los brazos abiertos o un arma
  // lateral tampoco marquen el ancho.
  const xs = [];
  const zs = [];
  const bajo = span.base + span.altura * 0.08;
  const alto = span.base + span.altura * 0.92;
  for (let i = 0; i < puntos.length; i += 3) {
    const y = puntos[i + 1];
    if (y < bajo || y > alto) continue;
    xs.push(puntos[i]);
    zs.push(puntos[i + 2]);
  }
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const minX = percentile(xs, 0.02);
  const maxX = percentile(xs, 0.98);
  const minZ = percentile(zs, 0.02);
  const maxZ = percentile(zs, 0.98);
  const box = new THREE.Box3(
    new THREE.Vector3(minX, span.base, minZ),
    new THREE.Vector3(maxX, span.crown, maxZ)
  );
  return {
    box,
    size: box.getSize(new THREE.Vector3()),
    base: span.base,
    crown: span.crown,
    source: 'cuerpo'
  };
}

// Respaldo por huesos: solo se usa cuando la nube de vértices no existe (por
// ejemplo, modelos sin geometría legible).
const CROWN_PATTERN = /(head|skull|cabeza)[\s_.-]*(top|end|tip)|(top|end)[\s_.-]*(head|skull)/i;
const HEAD_PATTERN = /head|skull|cabeza|cráneo|craneo/i;

function measureBones(model, full, bones) {
  const point = new THREE.Vector3();
  const find = (pattern) => {
    let best = null;
    for (const bone of bones) {
      if (!pattern.test(bone.name || '')) continue;
      const y = bone.getWorldPosition(point).y;
      if (!best || y > best.y) best = { bone, y };
    }
    return best;
  };
  const ys = bones.map((bone) => bone.getWorldPosition(point).y).sort((a, b) => a - b);
  const feet = ys[0];
  const crownBone = find(CROWN_PATTERN);
  const headBone = find(HEAD_PATTERN);
  let crown;
  if (crownBone) crown = crownBone.y;
  else if (headBone && headBone.y > feet) crown = headBone.y + (headBone.y - feet) * 0.075;
  else crown = percentile(ys, 0.97);
  const bodyHeight = crown - feet;
  const fullSize = full.getSize(new THREE.Vector3());
  if (!(bodyHeight > 0.0001) || bodyHeight < fullSize.y * 0.25) {
    return { box: full, size: fullSize, base: full.min.y, crown: full.max.y, source: 'caja' };
  }
  const body = new THREE.Box3();
  for (const bone of bones) body.expandByPoint(bone.getWorldPosition(point));
  const marginX = Math.max((body.max.x - body.min.x) * 0.3, bodyHeight * 0.08);
  const marginZ = Math.max((body.max.z - body.min.z) * 0.3, bodyHeight * 0.08);
  const box = new THREE.Box3(
    new THREE.Vector3(body.min.x - marginX, feet, body.min.z - marginZ),
    new THREE.Vector3(body.max.x + marginX, crown, body.max.z + marginZ)
  );
  return { box, size: box.getSize(new THREE.Vector3()), base: feet, crown, source: 'huesos' };
}

// Medida del CUERPO, no del modelo completo.
//
// Los GLB de campeón suelen traer el arma, el tótem o un efecto muy por encima
// de la cabeza. Si eso entra en la medida, el campeón se encoge: por eso Illaoi,
// Zac o Alistar salían más pequeños que los demás. Aquí la altura se toma desde
// los pies hasta la coronilla:
//   1) un hueso de "fin de cabeza", si el rig lo trae (la medida exacta);
//   2) si no, el hueso de la cabeza más un margen de media cabeza;
//   3) si el rig no tiene cabeza, un percentil alto de los huesos, que ignora
//      los huesos sueltos de armas y efectos.
function measureBody(model) {
  const full = new THREE.Box3().setFromObject(model);
  const cloud = measureCloud(model);
  if (cloud) return cloud;
  const bones = [];
  model.traverse((node) => {
    if (node.isBone) bones.push(node);
  });
  if (bones.length) return measureBones(model, full, bones);
  return { box: full, size: full.getSize(new THREE.Vector3()), base: full.min.y, crown: full.max.y, source: 'caja' };
}

// ============================================================================
// 1a-bis. CALIBRACIÓN POR SILUETA
// La medida geométrica puede fallar: un arma, un tótem o un efecto por encima de
// la cabeza descuadran cualquier caja. Aquí se dibuja el modelo y se mide lo que
// de verdad se ve:
//   · por cada fila de píxeles se cuenta cuánto ocupa el personaje;
//   · el cuerpo son las filas con densidad alta (un arma fina deja muy pocas
//     columnas por fila, así que no cuenta);
//   · se reescala para que ese cuerpo ocupe el 92 % del alto del hueco.
// Con esto todos los campeones quedan del mismo tamaño en pantalla, midan lo
// que midan sus archivos.
// ============================================================================
// Fracción del alto del hueco que debe ocupar el cuerpo. Se deja aire arriba
// porque la cámara mira un poco por debajo de la cabeza: con más de 0,82 el
// modelo se recorta por arriba.
const CUERPO_OBJETIVO = 0.8;
const ANCHO_OBJETIVO = 0.98; // fracción del ancho que puede ocupar
const DENSIDAD_FILA = 0.06; // una fila es "cuerpo" si llega al 6 % del máximo

function measureSilhouette(renderer, view, ancho, alto) {
  const target = new THREE.WebGLRenderTarget(ancho, alto, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat
  });
  const previo = new THREE.Color();
  renderer.getClearColor(previo);
  const previoAlpha = renderer.getClearAlpha();
  const anterior = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.setViewport(0, 0, ancho, alto);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    view.camera.aspect = ancho / alto;
    view.camera.updateProjectionMatrix();
    renderer.render(view.scene, view.camera);

    const buffer = new Uint8Array(ancho * alto * 4);
    renderer.readRenderTargetPixels(target, 0, 0, ancho, alto, buffer);
    const filas = new Array(alto).fill(0);
    const columnas = new Array(ancho).fill(0);
    let maximo = 0;
    for (let y = 0; y < alto; y += 1) {
      // readRenderTargetPixels devuelve la fila 0 abajo
      for (let x = 0; x < ancho; x += 1) {
        const alfa = buffer[((y * ancho) + x) * 4 + 3];
        if (alfa < 12) continue;
        filas[y] += 1;
        columnas[x] += 1;
      }
    }
    for (const v of filas) if (v > maximo) maximo = v;
    if (!maximo) return null;
    const umbral = Math.max(2, maximo * DENSIDAD_FILA);
    let abajo = -1;
    let arriba = -1;
    for (let y = 0; y < alto; y += 1) {
      if (filas[y] < umbral) continue;
      if (abajo < 0) abajo = y;
      arriba = y;
    }
    let izq = -1;
    let der = -1;
    for (let x = 0; x < ancho; x += 1) {
      if (!columnas[x]) continue;
      if (izq < 0) izq = x;
      der = x;
    }
    // Alto visible completo (con brazos, armas y efectos): sirve de respaldo
    // cuando la densidad no describe bien al personaje.
    let visibleAbajo = -1;
    let visibleArriba = -1;
    for (let y = 0; y < alto; y += 1) {
      if (!filas[y]) continue;
      if (visibleAbajo < 0) visibleAbajo = y;
      visibleArriba = y;
    }
    if (abajo < 0) return null;
    return {
      // Los pies siempre están apoyados abajo, así que solo recorta por arriba.
      tocaBorde: visibleArriba >= alto - 2,
      altoCuerpo: arriba - abajo + 1,
      altoVisible: visibleAbajo < 0 ? 0 : visibleArriba - visibleAbajo + 1,
      anchoCuerpo: der - izq + 1,
      altoTotal: alto,
      anchoTotal: ancho
    };
  } finally {
    renderer.setRenderTarget(anterior);
    renderer.setClearColor(previo, previoAlpha);
    target.dispose();
  }
}

// Ajusta la escala del modelo ya colocado midiendo su silueta en pantalla.
//
// Reglas, en este orden:
//   1. nunca se permite que el modelo toque el borde del hueco (se recortaría);
//   2. el cuerpo (las filas con densidad alta) debe ocupar el 80 % del alto;
//   3. si el cuerpo no llega pero el modelo entero sí cabe, se encaja el alto
//      visible al 88 % (así un campeón con un arma grande no queda diminuto);
//   4. cada corrección se comprueba: si toca el borde o empeora, se deshace.
function calibrateToView(renderer, view, model, aspect) {
  const aspectoPrevio = view.camera?.aspect;
  const ancho = 240;
  const alto = Math.max(120, Math.round(ancho / Math.max(0.4, aspect)));
  const objetivoCuerpo = alto * CUERPO_OBJETIVO;
  const objetivoVisible = alto * 0.88;

  const medir = () => measureSilhouette(renderer, view, ancho, alto);
  const recolocar = () => {
    model.updateMatrixWorld(true);
    const caja = new THREE.Box3().setFromObject(model);
    const centro = caja.getCenter(new THREE.Vector3());
    model.position.x -= centro.x;
    model.position.z -= centro.z;
    model.updateMatrixWorld(true);
    model.position.y -= new THREE.Box3().setFromObject(model).min.y;
    model.updateMatrixWorld(true);
  };
  const escala = (factor) => {
    model.scale.multiplyScalar(factor);
    recolocar();
  };

  try {
    let actual = medir();
    if (globalThis.__depurarModelos) console.log('inicio', JSON.stringify(actual));
    if (!actual) return;

    for (let intento = 0; intento < 4; intento += 1) {
      // Si el modelo toca arriba o abajo, solo puede encogerse.
      const recortado = actual.tocaBorde;
      const cuerpoBajo = actual.altoCuerpo < objetivoCuerpo * 0.97;
      const visibleBajo = actual.altoVisible < objetivoVisible * 0.97;
      let factor = 1;
      if (recortado) {
        factor = 0.88;
      } else if (cuerpoBajo && actual.altoCuerpo >= actual.altoVisible * 0.82) {
        // El cuerpo domina la silueta: se busca el objetivo del cuerpo.
        factor = objetivoCuerpo / actual.altoCuerpo;
      } else if (visibleBajo) {
        // Hay mucho accesorio alrededor del cuerpo: se encaja el total.
        factor = objetivoVisible / actual.altoVisible;
      }
      factor = Math.min(1.5, Math.max(0.55, factor));
      if (Math.abs(factor - 1) < 0.03) return;

      const previo = actual;
      escala(factor);
      const intentoMedida = medir();
      if (!intentoMedida) {
        escala(1 / factor);
        return;
      }
      // Un ajuste que recorta o que deja el modelo peor, se deshace.
      const empeora =
        (intentoMedida.tocaBorde && !previo.tocaBorde) ||
        Math.abs(intentoMedida.altoCuerpo - objetivoCuerpo) >=
          Math.abs(previo.altoCuerpo - objetivoCuerpo);
      if (globalThis.__depurarModelos) console.log('paso', intento, 'factor', factor.toFixed(3), JSON.stringify(intentoMedida), 'empeora', empeora);
      if (empeora) {
        escala(1 / factor);
        return;
      }
      actual = intentoMedida;
    }
  } finally {
    // La cámara vuelve a su proporción real: la calibración usa la suya.
    if (view.camera && typeof aspectoPrevio === 'number') {
      view.camera.aspect = aspectoPrevio;
      view.camera.updateProjectionMatrix();
    }
  }
}

// ============================================================================
// 1b. TAMAÑO DE CADA CAMPEÓN EN EL JUEGO
// Un campeón no mide lo mismo que otro: Kog'Maw es un bicho pequeño y Zac,
// Alistar o Illaoi son enormes. Igualarlos todos al mismo alto es lo que hacía
// que los pequeños se vieran gigantes y los grandes diminutos.
// Esta tabla es el tamaño relativo con el que se percibe cada campeón en la
// Grieta (1 = campeón estándar). Se aplica igual para todos los skins.
// ============================================================================
const TAMANO_CAMPEON = {
  // Muy pequeños
  kogmaw: 0.6, tristana: 0.68, teemo: 0.62, veigar: 0.66, amumu: 0.68, nunu: 0.7,
  annie: 0.62, lulu: 0.64, poppy: 0.72, yordle: 0.66, kennen: 0.66, ziggs: 0.68,
  heimerdinger: 0.7, rumble: 0.76, gnar: 0.68, fizz: 0.7, yuumi: 0.55, kled: 0.8,
  corki: 0.78, velkoz: 0.9, taliyah: 0.9,
  // Pequeños
  ashe: 0.9, ezreal: 0.9, jinx: 0.92, caitlyn: 0.94, vayne: 0.9, twitch: 0.88,
  sivir: 0.9, mf: 0.92, missfortune: 0.92, kaisa: 0.94, xayah: 0.94, kalista: 0.92,
  jhin: 0.98, samira: 0.94, aphelios: 0.94, senna: 1.0, sera: 1.0,
  // Medianos
  ahri: 1.0, syndra: 1.0, lux: 1.0, orianna: 1.0, leblanc: 0.98, ahri2: 1.0,
  vi: 1.02, leesin: 1.0, elise: 1.0, evelynn: 1.0, akali: 0.98, zed: 1.0,
  talon: 1.0, yasuo: 1.0, yone: 1.0, riven: 1.0, fiora: 1.0, irelia: 1.0,
  katarina: 0.98, diana: 1.0, morgana: 1.0, karma: 1.0, sona: 0.96, janna: 0.98,
  nami: 0.98, soraka: 0.96, lulu2: 0.64, zilean: 1.0, anivia: 1.05,
  // Grandes
  illaoi: 1.12, darius: 1.08, garen: 1.08, sett: 1.1, mordekaiser: 1.14,
  aatrox: 1.12, urgot: 1.12, sion: 1.2, chogath: 1.18, mundo: 1.12, drmundo: 1.12,
  malphite: 1.14, nasus: 1.12, renekton: 1.08, trundle: 1.12, volibear: 1.16,
  warwick: 1.08, yorick: 1.08, thresh: 1.1, blitzcrank: 1.12, nautilus: 1.14,
  leona: 1.06, taric: 1.06, braum: 1.08, alistar: 1.16, galio: 1.16, ornn: 1.2,
  maokai: 1.14, rammus: 1.1, sejuani: 1.1, skarner: 1.1, hecarim: 1.12,
  vi2: 1.02, zac: 1.22, tahmkench: 1.18, kench: 1.18, gragas: 1.12, nunu2: 0.7,
  ksante: 1.14, ambessa: 1.08, mummy: 0.68,
  // Voladores y flotantes: un poco por debajo porque ocupan mucho con las alas
  aurelionsol: 1.16, shyvana: 1.2, anivia2: 1.05, kayle: 1.02, asol: 1.16
};

const TAMANO_MIN = 0.5;
const TAMANO_MAX = 1.3;

function tamanoRelativo(nombre) {
  const clave = normalizedName(nombre);
  const valor = TAMANO_CAMPEON[clave];
  if (typeof valor !== 'number') return 1;
  return Math.min(TAMANO_MAX, Math.max(TAMANO_MIN, valor));
}

// ============================================================================
// 1c. ENCAJE EN LA TARJETA
// Tres reglas, en este orden:
//   1. el ALTO DEL CUERPO fija el tamaño, corregido por el tamaño real del
//      campeón (tabla de arriba): cada uno se ve de su tamaño, sin extremos;
//   2. el ANCHO del cuerpo no puede salirse del hueco;
//   3. el modelo COMPLETO (con alas, armas o efectos) tampoco puede salirse:
//      así un volador nunca se corta. Es un tope de seguridad, no la medida.
// ============================================================================
const WORLD_HEIGHT = 2.62; // alto del hueco en unidades de mundo
const SIN_RECORTE = 0.995; // fracción del hueco que puede ocupar el CUERPO
// El arma o el tótem pueden sobresalir: se recorta el accesorio, nunca el
// cuerpo. Un 25 % da aire de sobra sin que el campeón se encoja.
const AIRE_ACCESORIO = 1.25;

function computeFit(body, aspect, fix, totalWidth, totalHeight) {
  const altoObjetivo = WORLD_HEIGHT * SIN_RECORTE;
  // 1) Alto del cuerpo con el tamaño propio del campeón.
  const fitHeight = (altoObjetivo * (fix || 1)) / body.y;
  // 2) Ancho del cuerpo.
  const anchoCuerpo = WORLD_HEIGHT * aspect * 0.96;
  const fitWidth = anchoCuerpo / body.x;
  let fit = Math.min(fitHeight, fitWidth);
  // 3) El cuerpo nunca se sale del hueco.
  fit = Math.min(fit, altoObjetivo / body.y);
  // 4) El accesorio puede sobresalir un poco; las alas de un volador, no
  //    (por eso el ancho del modelo completo se mantiene estricto).
  if (totalHeight > 0) fit = Math.min(fit, (altoObjetivo * AIRE_ACCESORIO) / totalHeight);
  if (totalWidth > 0) fit = Math.min(fit, (WORLD_HEIGHT * aspect * 0.98) / totalWidth);
  return { fit, fitHeight, fitWidth };
}

// ============================================================================
// 2. RENDERER COMPARTIDO
// Se crea un único WebGLRenderer. Las diez escenas se dibujan en distintas
// regiones del mismo canvas en lugar de crear diez contextos WebGL.
// ============================================================================
export { measureBody, computeFit, calibrateToView, measureSilhouette, tamanoRelativo };

// Ajustes guardados por el operador en postgame/data/scale-fix.json
// (clave: nombre normalizado del campeón, valor: multiplicador).
export const escalaGuardada = new Map();

export async function cargarAjustesDeEscala() {
  escalaGuardada.clear();
  const aplicar = (datos) => {
    for (const [campeon, valor] of Object.entries(datos || {})) {
      const numero = Number(valor);
      if (Number.isFinite(numero) && numero > 0.2 && numero < 5) {
        escalaGuardada.set(normalizedName(campeon), numero);
      }
    }
  };
  // 1) Lo guardado en este navegador: es instantáneo y no depende del servidor.
  try {
    const local = localStorage.getItem('syb3d-scale-fix');
    if (local) aplicar(JSON.parse(local));
  } catch {}
  // 2) Lo guardado en disco por el servidor (vale para otros equipos/OBS).
  try {
    const respuesta = await fetch(`/postgame/api/scale-fix?t=${Date.now()}`, { cache: 'no-store' });
    const datos = await respuesta.json();
    aplicar(datos?.scaleFix);
  } catch {}
}

export function createPostgameModels(canvas) {
  const loader = new GLTFLoader();
  const cache = new Map();
  const stage = document.getElementById('stage');
  let renderer;
  let generation = 0;
  let views = [];
  let active = false;
  let lastFrame = 0;
  let modelFiles = [];
  const debug = { available: true, loaded: 0, failed: 0, views: 0, frames: 0 };

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(1);
    renderer.setSize(1920, 1080, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false;
  } catch {
    debug.available = false;
    canvas.hidden = true;
  }

  // El servidor devuelve los nombres de los GLB disponibles en draft/models.
  async function loadCatalog() {
    try {
      const response = await fetch('/postgame/api/models');
      const data = await response.json();
      modelFiles = Array.isArray(data.files) ? data.files : [];
    } catch {
      modelFiles = [];
    }
  }
  const catalogReady = loadCatalog();

  // Busca el GLB del campeón. Aurora solo sustituye modelos dentro de la demo.
  function modelUrl(player, demo) {
    const candidates = [player.champion, player.championAlias].map(normalizedName).filter(Boolean);
    const file = modelFiles.find((filename) =>
      candidates.includes(normalizedName(filename.replace(/\.glb$/i, '')))
    );
    if (file) return `/models/${encodeURIComponent(file)}`;
    // La demo siempre puede enseñar el funcionamiento 3D aunque no se haya copiado la biblioteca completa.
    return demo ? './assets/models/Aurora.glb' : null;
  }

  // La caché evita descargar y decodificar varias veces el mismo archivo GLB.
  function loadCached(url) {
    if (!cache.has(url)) {
      const promise = loader.loadAsync(url).catch((error) => {
        cache.delete(url);
        throw error;
      });
      cache.set(url, promise);
    }
    return cache.get(url);
  }

  // ==========================================================================
  // 3. ESCENA DE CADA CAMPEÓN
  // Cada vista tiene cámara, luces, modelo y animación propios.
  // ==========================================================================
  function createView(target, player, side) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 198 / 214, 0.1, 100);
    camera.position.set(0, 1.35, 5.2);
    camera.lookAt(0, 1.25, 0);
    scene.add(new THREE.AmbientLight(0xaabbd4, 2.1));
    const key = new THREE.DirectionalLight(0xfff3df, 3.0);
    key.position.set(-3, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(side === 'blue' ? 0x65baff : 0xff7c87, 2.2);
    rim.position.set(3, 3, -4);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xd7e5ff, 1.2);
    fill.position.set(2, 2, 5);
    scene.add(fill);
    return {
      element: target.element,
      player,
      side,
      scene,
      camera,
      model: null,
      mixer: null,
      ready: false
    };
  }

  // ==========================================================================
  // 4. CARGA, ANIMACIÓN, ESCALA Y ENCUADRE
  // El token descarta cargas antiguas si el operador cambió de resumen.
  // SkeletonUtils.clone permite animar copias independientes de un mismo GLB.
  // ==========================================================================
  // ==========================================================================
  // 3b. MEDIDA DEL MODELO
  // Dos problemas típicos de los GLB de campeón: unos traen el arma o un efecto
  // muy por encima de la cabeza (la caja completa los hace diminutos) y otros
  // son muy anchos (acaban recortados). Aquí se mide el ESQUELETO para saber
  // cuánto mide el cuerpo, y solo si no hay huesos se usa la caja completa.
  // ==========================================================================
  async function attachModel(view, url, token) {
    try {
      const gltf = await loadCached(url);
      if (token !== generation) return;
      const model = cloneSkeleton(gltf.scene);
      model.traverse((node) => {
        if (node.isMesh || node.isSkinnedMesh) {
          node.frustumCulled = false;
          if (node.material) node.material.needsUpdate = true;
        }
      });
      let mixer = null;
      if (gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        const clip =
          gltf.animations.find((animation) => /idle/i.test(animation.name)) || gltf.animations[0];
        mixer.clipAction(clip).play();
        mixer.update(1.2);
      }
      // Se gira primero: el encuadre se calcula sobre el modelo ya orientado.
      model.rotation.y = view.side === 'blue' ? 0.32 : -0.32;
      model.updateMatrixWorld(true);

      // Tamaño por campeón (tabla real) × ajuste fino del borrador × ajuste manual.
      const rect = view.element.getBoundingClientRect();
      const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 226 / 214;
      const ajusteBorrador = Math.min(1.05, Math.max(0.95, SCALE_FIX[view.player.champion] || 1));
      const fix = tamanoRelativo(view.player.champion) * ajusteBorrador;

      const body = measureBody(model);
      const size = body.size;
      if (size.y > 0.0001 && size.x > 0.0001) {
        const cajaTotal = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        const { fit } = computeFit(size, aspect, fix, cajaTotal.x, cajaTotal.y);
        model.scale.multiplyScalar(fit);
        view.fit = Number(fit.toFixed(4));
        view.measure = body.source;
      }
      model.updateMatrixWorld(true);

      // Centro en horizontal y pies en el suelo del hueco. El suelo se toma de
      // los huesos (los pies reales), no de la caja completa: así una capa o un
      // efecto por debajo no deja al campeón flotando.
      const bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.updateMatrixWorld(true);
      model.position.y -= measureBody(model).base;
      view.scene.add(model);
      // Ajuste fino con lo que de verdad se ve en pantalla: es lo que hace que
      // todos los campeones queden del mismo tamaño aunque sus GLB sean muy
      // distintos (armas, efectos, escalas internas...).
      // Ajuste por campeón guardado por el operador (ajustar-modelos.html).
      // Es la última palabra: se aplica sobre el encuadre automático.
      const extra = escalaGuardada.get(normalizedName(view.player.champion)) || 1;
      // El ajuste manual es del operador: puede agrandar y recortarse arriba con
      // el borde de la tarjeta, y puede encoger hasta quedar pequeño. No se
      // limita por el hueco, porque para eso está precisamente.
      if (extra !== 1) {
        model.scale.multiplyScalar(extra);
        model.updateMatrixWorld(true);
        const cajaExtra = new THREE.Box3().setFromObject(model);
        const centroExtra = cajaExtra.getCenter(new THREE.Vector3());
        model.position.x -= centroExtra.x;
        model.position.z -= centroExtra.z;
        model.updateMatrixWorld(true);
        model.position.y -= new THREE.Box3().setFromObject(model).min.y;
        model.updateMatrixWorld(true);
      }
      view.model = model;
      view.mixer = mixer;
      view.ready = true;
      view.element.querySelector('.model-fallback').hidden = true;
      view.element.querySelector('.model-missing').hidden = true;
      debug.loaded += 1;
    } catch {
      if (token !== generation) return;
      debug.failed += 1;
      view.element.querySelector('.model-missing').hidden = false;
    }
  }

  // ==========================================================================
  // 5. SINCRONIZACIÓN CON LAS TARJETAS
  // Detiene animaciones anteriores y vincula cada tarjeta con una nueva escena.
  // ==========================================================================
  async function sync(summary, targets) {
    const token = ++generation;
    for (const view of views) if (view.mixer) view.mixer.stopAllAction();
    views = [];
    debug.loaded = 0;
    debug.failed = 0;
    debug.views = targets.length;
    active = Boolean(summary && targets.length);
    canvas.hidden = !active || !renderer;
    if (!active || !renderer) {
      renderer?.clear();
      return;
    }
    await catalogReady;
    if (token !== generation) return;
    views = targets.map((target) => createView(target, target.player, target.side));
    await Promise.all(
      views.map((view) => {
        const url = modelUrl(view.player, summary.demo === true);
        if (!url) {
          debug.failed += 1;
          view.element.querySelector('.model-missing').hidden = false;
          return Promise.resolve();
        }
        return attachModel(view, url, token);
      })
    );
  }

  // ==========================================================================
  // 6. BUCLE DE DIBUJO
  // Limita la animación a 30 fps. viewport + scissor recortan cada escena al
  // rectángulo .model3d de su tarjeta, sin tapar estadísticas ni otros campeones.
  // ==========================================================================
  function frame(now) {
    requestAnimationFrame(frame);
    if (!active || !renderer || document.hidden || now - lastFrame < 1000 / 30) return;
    const delta = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    const stageRect = stage.getBoundingClientRect();
    const scale = stageRect.width / 1920 || 1;
    for (const view of views) {
      if (!view.ready) continue;
      if (view.mixer) view.mixer.update(delta);
      const rect = view.element.getBoundingClientRect();
      const x = (rect.left - stageRect.left) / scale;
      const y = (rect.top - stageRect.top) / scale;
      const width = rect.width / scale;
      const height = rect.height / scale;
      const bottom = 1080 - y - height;
      view.camera.aspect = width / height;
      view.camera.updateProjectionMatrix();
      renderer.setViewport(x, bottom, width, height);
      renderer.setScissor(x, bottom, width, height);
      renderer.render(view.scene, view.camera);
    }
    renderer.setScissorTest(false);
    debug.frames += 1;
  }
  if (renderer) requestAnimationFrame(frame);

  return { sync, debug };
}
