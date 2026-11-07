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
      v.fromBufferAttribute(m.attr, i);
      // En una malla con esqueleto el vértice guardado NO es el que se dibuja:
      // los huesos lo mueven y lo escalan (Xbot: vértices de 0,018 para un
      // modelo de 1,81). applyBoneTransform devuelve el vértice ya deformado.
      if (m.node.isSkinnedMesh && m.node.applyBoneTransform) {
        m.node.applyBoneTransform(i, v);
      }
      v.applyMatrix4(m.node.matrixWorld);
      puntos.push(v.x, v.y, v.z);
    }
  }
  return puntos.length >= 90 ? puntos : null;
}

// CAJA DE REFERENCIA
// Caja envolvente del modelo que sirve de medida "segura" cuando la nube de
// vértices no es de fiar. Dos reglas aprendidas midiendo modelos reales:
//
//   · Las mallas CON ESQUELETO no se pueden medir por sus vértices: muchos GLB
//     guardan la geometría en un espacio diminuto y son los HUESOS los que la
//     escalan al dibujarla (Xbot: sus vértices miden 0,018 y el modelo real
//     1,81). Para esas mallas se usa la caja que calcula three, que sí aplica
//     el esqueleto.
//   · Las mallas ANECDÓTICAS (una partícula suelta, un adorno de cuatro
//     vértices) se descartan, para que un vértice perdido no infle la caja y
//     encoja al campeón.
function referenceBox(model) {
  let total = 0;
  model.traverse((node) => {
    const attr = node.geometry?.attributes?.position;
    if (node.isMesh && attr) total += attr.count;
  });
  const caja = new THREE.Box3();
  const trozo = new THREE.Box3();
  model.traverse((node) => {
    const attr = node.geometry?.attributes?.position;
    if (!node.isMesh || !attr) return;
    if (!node.isSkinnedMesh && total && attr.count < total * PESO_MINIMO_MALLA) return;
    trozo.setFromObject(node);
    caja.union(trozo);
  });
  return caja.isEmpty() ? new THREE.Box3().setFromObject(model) : caja;
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

// EXTREMOS DEL MODELO COMPLETO, SIN VALORES ATÍPICOS
// El encuadre necesita saber cuánto ocupa el modelo ENTERO (con alas o armas)
// para no recortarlo. Pero algunos GLB traen un vértice o una partícula suelta
// muy lejos del cuerpo: si eso cuenta, el campeón se encoge hasta desaparecer.
// Por eso se miden los extremos por densidad (0,5 % - 99,5 % de los vértices):
// un ala o un arma tienen miles de vértices y siguen contando; una partícula de
// cuatro vértices se ignora.
function measureExtent(model) {
  const puntos = vertexCloud(model);
  if (!puntos) {
    const caja = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    return { x: caja.x, y: caja.y, source: 'caja' };
  }
  const xs = [];
  const ys = [];
  for (let i = 0; i < puntos.length; i += 3) {
    xs.push(puntos[i]);
    ys.push(puntos[i + 1]);
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  return {
    x: percentile(xs, 0.995) - percentile(xs, 0.005),
    y: percentile(ys, 0.995) - percentile(ys, 0.005),
    source: 'extremos'
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
  const full = referenceBox(model);
  const fullSize = full.getSize(new THREE.Vector3());
  const cloud = measureCloud(model);

  // CONTROL DE CORdura: la medida del cuerpo tiene que ser coherente con el
  // modelo completo. Si el cuerpo sale muchísimo más pequeño que la caja (o
  // muchísimo más ancho que alto), la medida por vértices se ha ido y se usa
  // el respaldo por huesos o la caja. Sin esto, algunos GLB daban un cuerpo de
  // 0,0016 unidades y el campeón acababa diminuto.
  const cloudValida = cloud
    && cloud.size.y > fullSize.y * 0.25
    && cloud.size.x < Math.max(fullSize.x * 1.6, cloud.size.y * 4);
  if (cloudValida) return cloud;
  const bones = [];
  model.traverse((node) => {
    if (node.isBone) bones.push(node);
  });
  if (bones.length) return measureBones(model, full, bones);
  // Sin nube creíble ni huesos, la caja completa es la única medida segura.
  void fullSize;
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
const DENSIDAD_FILA = 0.1; // una fila es "cuerpo" si llega al 10 % del máximo (un arma fina no)

function measureSilhouette(renderer, view, ancho, alto) {
  if (globalThis.__contarMedidas) globalThis.__contarMedidas();
  const target = new THREE.WebGLRenderTarget(ancho, alto, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat
  });
  const previo = new THREE.Color();
  renderer.getClearColor(previo);
  const previoAlpha = renderer.getClearAlpha();
  const anterior = renderer.getRenderTarget();
  // El viewport se cambia para medir y HAY que devolverlo: si se queda en el
  // tamaño de la medida, el dibujo de después sale desplazado y más grande de
  // lo medido (el campeón se recortaba por arriba al agrandarlo).
  const viewportPrevio = renderer.getViewport(new THREE.Vector4());
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
    let maxCol = 0;
    for (let x = 0; x < ancho; x += 1) if (columnas[x] > maxCol) maxCol = columnas[x];
    const umbralCol = Math.max(2, maxCol * 0.3);
    let cuerpoIzq = -1;
    let cuerpoDer = -1;
    for (let x = 0; x < ancho; x += 1) {
      if (!columnas[x]) continue;
      if (izq < 0) izq = x;
      der = x;
      // Columnas del CUERPO: las que están llenas de figura. Un brazo abierto o
      // el filo de un arma dejan pocos píxeles por columna y no cuentan.
      if (columnas[x] >= umbralCol) {
        if (cuerpoIzq < 0) cuerpoIzq = x;
        cuerpoDer = x;
      }
    }
    if (cuerpoIzq < 0) {
      cuerpoIzq = izq;
      cuerpoDer = der;
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
      tocaArriba: visibleArriba >= alto - 2,
      tocaLados: izq <= 1 || der >= ancho - 2,
      tocaBorde: visibleArriba >= alto - 2,
      altoCuerpo: arriba - abajo + 1,
      altoVisible: visibleAbajo < 0 ? 0 : visibleArriba - visibleAbajo + 1,
      anchoCuerpo: der - izq + 1,
      izq, der, cuerpoIzq, cuerpoDer, abajo, arriba, visibleAbajo, visibleArriba,
      altoTotal: alto,
      anchoTotal: ancho
    };
  } finally {
    renderer.setRenderTarget(anterior);
    renderer.setViewport(viewportPrevio.x, viewportPrevio.y, viewportPrevio.z, viewportPrevio.w);
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
// Un accesorio grande puede encoger al campeón hasta este porcentaje de su
// tamaño, nunca más.
const SUELO_ACCESORIO = 0.85;

// Devuelve dos números:
//   fit    → escala con la que se dibuja ahora
//   fitMax → la mayor escala posible sin que nada se salga del recuadro
// La diferencia entre ambos es el margen que tiene el operador para agrandar.
function computeFit(body, aspect, fix, extent) {
  const altoObjetivo = WORLD_HEIGHT * SIN_RECORTE;
  const anchoObjetivo = WORLD_HEIGHT * aspect * 0.96;

  // 1) Tamaño deseado: alto del CUERPO corregido por el tamaño propio del
  //    campeón (tabla TAMANO_CAMPEON).
  let fit = (altoObjetivo * (fix || 1)) / body.y;
  // 2) El cuerpo no puede ser más ancho que el hueco.
  fit = Math.min(fit, anchoObjetivo / body.x);

  // 3) Tope duro del recuadro: ni el cuerpo ni el modelo entero pueden salirse.
  //    El alto del modelo completo admite el aire del accesorio; el ancho no,
  //    porque es lo que recortaba las alas de los voladores.
  const altoTotal = extent?.y > 0 ? extent.y : body.y;
  const anchoTotal = extent?.x > 0 ? extent.x : body.x;

  // Límites del CUERPO: son intocables, el cuerpo nunca se recorta.
  const cuerpoMax = Math.min(altoObjetivo / body.y, anchoObjetivo / body.x);
  // Límites del ACCESORIO (alas, arma, tótem): pueden recortarse un poco.
  const accesorioAlto = (altoObjetivo * AIRE_ACCESORIO) / altoTotal;
  const accesorioAncho = (WORLD_HEIGHT * aspect * 0.98) / anchoTotal;
  const accesorioMax = Math.min(accesorioAlto, accesorioAncho);

  // Suelo de seguridad: un accesorio enorme puede reducir al campeón, pero
  // nunca por debajo del 85 % del tamaño que le toca. Sin esto, un ala o una
  // partícula grande dejaba al campeón diminuto y sin margen para crecer.
  const minimo = Math.min(fit, cuerpoMax) * SUELO_ACCESORIO;
  fit = Math.min(fit, Math.max(accesorioMax, minimo));
  fit = Math.min(fit, cuerpoMax);

  // Tope del operador: lo que el cuerpo admite. Al agrandar puede recortarse
  // el accesorio, pero el cuerpo siempre cabe entero.
  const fitMax = cuerpoMax;
  return { fit, fitMax, componentes: { deseado: (altoObjetivo * (fix || 1)) / body.y, cuerpoMax, accesorioAlto, accesorioAncho } };
}

// ============================================================================
// 1d. COLOCACIÓN: pies en el suelo y cuerpo centrado
// Aquí estaba el fallo del "se va hacia arriba y a la derecha".
//
// El modelo se escalaba alrededor del origen del GLB, no de sus pies. Si el GLB
// tiene ese origen desplazado (muchos modelos de campeón lo tienen), al crecer
// el modelo se aleja de ese origen: sube y se va de lado. Además se centraba
// con la caja COMPLETA, que incluye el arma: por eso muchos campeones salían
// corriendo un poco a la derecha.
//
// Ahora: se centra y se apoya usando siempre la medida del CUERPO, y el ajuste
// manual se aplica sobre un punto fijo (el centro de los pies), de modo que
// crecer es crecer hacia arriba y hacia los lados por igual, sin desplazarse.
// ============================================================================
const ORIGEN = new THREE.Vector3(0, 0, 0);

// Escalar un modelo alrededor del origen es lineal: al multiplicar la escala
// por F, todas sus coordenadas del mundo se multiplican por F. Por eso basta
// medir UNA vez y reutilizar la medida, en lugar de remirar el modelo entero
// después de cada paso (eran cinco recorridos de todos los vértices por
// campeón). Si algún día se escalara con un pivote distinto del origen, esta
// cuenta dejaría de valer: el pivote es siempre los pies, en el origen.
function recentrarYApoyar(model, cuerpo) {
  const medida = cuerpo || measureBody(model);
  const centro = medida.box.getCenter(new THREE.Vector3());
  model.position.x -= centro.x;
  model.position.z -= centro.z;
  model.position.y -= medida.base;
  model.updateMatrixWorld(true);
  return medida;
}

// Escala el modelo alrededor de un punto del mundo que se queda quieto.
function escalarSobrePunto(model, factor, punto) {
  model.scale.multiplyScalar(factor);
  model.position.sub(punto).multiplyScalar(factor).add(punto);
  model.updateMatrixWorld(true);
}

// MEDIDA REAL EN PANTALLA
// La geometría engaña más de lo que parece: hay GLB con mallas que no se
// dibujan (ocultas, transparentes) o con figuras gigantes que no son el
// campeón. En esos casos la cuenta por vértices da un cuerpo enorme, el
// campeón se encoge para que "quepa" y sale diminuto. Ninguna medida de
// archivo puede arreglar eso.
//
// La única medida que no puede equivocarse es la que se DIBUJA: se pinta el
// modelo en un recuadro pequeño y se cuentan los píxeles. Todo el encuadre se
// apoya en esa imagen; la geometría solo sirve para colocar el modelo la
// primera vez, cerca de donde tiene que ir.
const MEDIDA_PX = 240; // resolución de la medida (proporcional: da igual el tamaño real)
// Fracción del alto del lienzo que debe ocupar el cuerpo DIBUJADO. Los pies se
// apoyan a unos píxeles del borde inferior, así que 0,88 llena el hueco sin
// recortar. Este valor se multiplica por el tamaño propio del campeón.
const OBJETIVO_CUERPO = 0.88;

const MARGEN_SUELO_PX = 6;

function medirDibujo(vista, aspect) {
  const { renderer, scene, camera } = vista || {};
  if (!renderer || !scene || !camera) return null;
  const alto = MEDIDA_PX;
  const ancho = Math.max(80, Math.round(alto * Math.max(0.3, aspect)));
  const previo = camera.aspect;
  try {
    const m = measureSilhouette(renderer, { scene, camera }, ancho, alto);
    // El hueco libre del lienzo (lo que no tapa el panel de runas) se informa
    // en la propia medida para que el bucle de ajuste pueda respetarlo.
    if (m && Number.isFinite(vista.anchoUtil)) m.anchoUtil = vista.anchoUtil;
    if (m && Number.isFinite(vista.centroX)) m.centroX = vista.centroX;
    return m;
  } catch {
    return null;
  } finally {
    camera.aspect = previo;
    camera.updateProjectionMatrix();
  }
}

// Unidades de mundo por píxel en el plano del modelo, con la cámara real.
function mundoPorPixel(vista, alto) {
  const { camera } = vista || {};
  if (!camera) return 0.01;
  const adelante = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const foco = new THREE.Vector3(0, 1.25, 0);
  const distancia = Math.max(0.2, new THREE.Vector3().subVectors(foco, camera.position).dot(adelante));
  const altoMundo = 2 * distancia * Math.tan((camera.fov * Math.PI) / 360);
  return altoMundo / Math.max(1, alto);
}

// Apoya los pies DIBUJADOS a una altura fija del borde inferior.
function apoyarDibujo(model, vista, aspecto, medida) {
  const m = medida || medirDibujo(vista, aspecto);
  if (!m) return;
  const desfase = m.visibleAbajo - MARGEN_SUELO_PX;
  if (Math.abs(desfase) < 1) return;
  model.position.y -= desfase * mundoPorPixel(vista, m.altoTotal);
  model.updateMatrixWorld(true);
}

// Centra en horizontal lo DIBUJADO (no la caja del archivo). `centroX` es la
// fracción del ancho donde debe quedar: 0,5 es el centro del lienzo, y menos de
// 0,5 cuando el panel de runas tapa la derecha y el campeón tiene que quedar
// centrado en el hueco que se ve.
function centrarDibujo(model, vista, aspecto, medida, centroX) {
  const m = medida || medirDibujo(vista, aspecto);
  if (!m) return;
  const centro = Number.isFinite(centroX) ? centroX : 0.5;
  // Se centra el cuerpo, no el ancho visible: los brazos abiertos o un arma
  // pueden asomarse sin que el campeón quede corrido.
  const cuerpoMedio = (m.cuerpoIzq + m.cuerpoDer) / 2;
  const desfase = cuerpoMedio - m.anchoTotal * centro;
  if (Math.abs(desfase) < 1) return;
  model.position.x -= desfase * mundoPorPixel(vista, m.altoTotal);
  model.updateMatrixWorld(true);
}

// MEDIDA CON LA CÁMARA RETIRADA
// Para saber cuánto sobresale un arma o un ala hay que verla entera, y dentro
// del recuadro no cabe. Se retira la cámara k veces y se mide: al alejarse k,
// lo dibujado se encoge k, así que los píxeles medidos se devuelven a su
// tamaño "real" multiplicando por k. Con eso se sabe cuántas veces el cuerpo
// cabe en lo que se ve, sin depender de la geometría del archivo.
const FONDO = new THREE.Vector3(0, 1.25, 0);
function medirConCamaraAmplia(vista, aspecto) {
  const { camera } = vista || {};
  if (!camera) return null;
  const original = camera.position.clone();
  let k = 1;
  let m = null;
  for (let intento = 0; intento < 5; intento += 1) {
    const alejado = new THREE.Vector3().subVectors(original, FONDO).multiplyScalar(k).add(FONDO);
    camera.position.copy(alejado);
    camera.updateMatrixWorld(true);
    m = medirDibujo(vista, aspecto);
    if (m && !m.tocaArriba && !m.tocaLados) break;
    k *= 1.8;
  }
  camera.position.copy(original);
  camera.updateMatrixWorld(true);
  if (!m) return null;
  return {
    cuerpo: m.altoCuerpo * k,
    visible: m.altoVisible * k,
    marco: m.altoTotal,
    alta: m.tocaArriba || m.tocaLados
  };
}

// Reparte el objetivo: el cuerpo manda, pero un accesorio alto (una lanza, un
// tótem) puede quedarse fuera hasta AIRE_ACCESORIO. Así un arma grande no
// encoge al campeón, que era el problema de Illaoi, Zac o Alistar.
const AIRE_ACCESORIO_DIBUJO = 1.3;
function objetivoCuerpo(amplia, marco, tamano) {
  const ideal = marco * OBJETIVO_CUERPO * tamano;
  if (!amplia || !(amplia.cuerpo > 1)) return ideal;
  const veces = Math.max(1, amplia.visible / amplia.cuerpo);
  const tope = (marco * AIRE_ACCESORIO_DIBUJO) / veces;
  return Math.min(ideal, tope);
}

// Ajusta tamaño, apoyo y centrado mirando lo que se dibuja, hasta que el
// cuerpo visible ocupa la fracción pedida.
function ajustarAlDibujo(model, vista, aspecto, objetivoFraccion, centroX) {
  const objetivo = Math.max(0.12, Math.min(0.97, objetivoFraccion));
  let ultima = null;
  let sinImagen = 0;
  for (let intento = 0; intento < 10; intento += 1) {
    const m = medirDibujo(vista, aspecto);
    if (!m) {
      sinImagen += 1;
      if (sinImagen >= 3 && rescatarPorCaja(model, objetivo)) continue;
      escalarSobrePunto(model, 0.6, ORIGEN);
      continue;
    }
    sinImagen = 0;
    ultima = m;
    const metaCuerpo = m.altoTotal * objetivo;
    let factor = 1;
    if (m.tocaArriba) {
      factor = 0.9;
    } else if (Math.abs(m.altoCuerpo - metaCuerpo) > metaCuerpo * 0.02) {
      factor = metaCuerpo / m.altoCuerpo;
    }
    // Y el cuerpo tiene que caber a lo ancho en el hueco que se ve.
    const anchoCuerpo = Math.max(1, m.cuerpoDer - m.cuerpoIzq);
    if (m.anchoUtil && anchoCuerpo > m.anchoTotal * m.anchoUtil * 0.97) {
      factor = Math.min(factor, (m.anchoTotal * m.anchoUtil * 0.97) / anchoCuerpo);
    }
    factor = Math.min(2.0, Math.max(0.5, factor));
    if (Math.abs(factor - 1) >= 0.02) escalarSobrePunto(model, factor, ORIGEN);
    apoyarDibujo(model, vista, aspecto, m);
    centrarDibujo(model, vista, aspecto, m, centroX);
    if (Math.abs(factor - 1) < 0.02) break;
  }
  return medirDibujo(vista, aspecto) || ultima;
}

// Si el modelo quedó fuera del recuadro no hay imagen que medir. Se devuelve a
// un tamaño razonable usando la caja completa, que para recolocar sí sirve.
function rescatarPorCaja(model, objetivoFraccion) {
  const caja = referenceBox(model);
  const alto = caja.getSize(new THREE.Vector3()).y;
  if (!(alto > 0.0001)) return false;
  const altoDeseado = 3.2 * Math.max(0.25, Math.min(1, objetivoFraccion));
  const factor = altoDeseado / alto;
  if (!Number.isFinite(factor) || factor <= 0) return false;
  const centro = caja.getCenter(new THREE.Vector3());
  model.position.x -= centro.x;
  model.position.z -= centro.z;
  model.position.y -= caja.min.y;
  escalarSobrePunto(model, Math.min(50, Math.max(0.001, factor)), ORIGEN);
  model.position.y = 0;
  model.updateMatrixWorld(true);
  return true;
}

// Cuánto puede crecer sin que NADA se recorte. Se calcula sobre la imagen: el
// modelo crece desde los pies, así que el borde de arriba sube en proporción a
// su distancia al suelo. Antes se estimaba con fracciones del alto y dejaba
// crecer de más: al 112 % la cabeza ya se salía.
function limiteReal(m) {
  const marco = m.altoTotal;
  const suelo = m.visibleAbajo;
  const margen = 8; // aire de seguridad para que ningún borde quede al ras
  const creceHasta = (borde) => {
    const alto = borde - suelo;
    if (!(alto > 1)) return 4;
    return (marco - margen - suelo) / alto;
  };
  const centro = m.anchoTotal * (Number.isFinite(m.centroX) ? m.centroX : 0.5);
  const creceLado = (borde, hueco) => {
    const ancho = Math.abs(borde - centro);
    if (!(ancho > 1)) return 4;
    return (hueco - margen) / ancho;
  };
  const calculado = Math.min(
    creceHasta(m.visibleArriba),
    creceHasta(m.arriba),
    creceLado(m.izq, centro),
    creceLado(m.der, m.anchoTotal - centro),
    4
  );
  return Number.isFinite(calculado) && calculado > 1 ? calculado : 1;
}

// Encuadra el modelo completo. `vista` ({ renderer, scene, camera }) es
// opcional: cuando se pasa, el encuadre se corrige con la imagen dibujada y el
// tope del ajuste manual es el de verdad (el modelo no puede salirse).
function encuadrarModelo(model, aspect, fix, extra, vista) {
  const tamano = Math.max(0.3, Math.min(1.5, Number.isFinite(fix) && fix > 0 ? fix : 1));
  const cuerpo = measureBody(model);
  const extent = measureExtent(model);
  const { fit } = computeFit(cuerpo.size, aspect, tamano, extent);

  // 1) Colocación inicial por geometría: deja el modelo cerca de su sitio.
  if (cuerpo.size.y > 0.0001 && cuerpo.size.x > 0.0001 && Number.isFinite(fit) && fit > 0) {
    const centro = cuerpo.box.getCenter(new THREE.Vector3());
    model.scale.multiplyScalar(fit);
    model.position.multiplyScalar(fit);
    model.position.x -= centro.x * fit;
    model.position.z -= centro.z * fit;
    model.position.y -= cuerpo.base * fit;
    model.updateMatrixWorld(true);
  }

  // 2) El tamaño final lo decide lo que se ve. El tamaño propio del campeón se
  //    aplica aquí, sobre la fracción del recuadro (así Kog'Maw sigue pequeño y
  //    Zac grande aunque su archivo mienta).
  let visible = null;
  if (vista) {
    // Primero se mira el modelo entero (con la cámara retirada) para saber si
    // trae un arma o un ala que no debe encogerlo.
    const amplia = medirConCamaraAmplia(vista, aspect);
    const marco = amplia?.marco || MEDIDA_PX;
    const meta = objetivoCuerpo(amplia, marco, tamano) / marco;
    visible = ajustarAlDibujo(model, vista, aspect, meta, vista.centroX);
  }

  // 3) Tope del ajuste manual, calculado con la medida que ya se tiene: hasta
  //    dónde puede crecer sin que el cuerpo se recorte (y sin que el accesorio
  //    se salga más de la cuenta). Sin mediciones extra.
  let limite = 1;
  if (visible) limite = limiteReal(visible);

  const pedido = Number.isFinite(extra) && extra > 0 ? extra : 1;
  const aplicado = Math.min(pedido, Math.max(1, limite));
  if (aplicado !== 1) {
    escalarSobrePunto(model, aplicado, ORIGEN);
    if (vista) {
      apoyarDibujo(model, vista, aspect);
      centrarDibujo(model, vista, aspect, null, vista.centroX);
      visible = medirDibujo(vista, aspect) || visible;
    }
  }
  if (globalThis.__depurarEncuadre) {
    globalThis.__depurarEncuadre({ visible, limite, pedido: extra, tamano });
  }
  return {
    fit,
    fitMax: limite,
    aplicado,
    tope: pedido > limite + 0.0001,
    limite,
    measure: vista && visible ? 'dibujo' : cuerpo.source,
    componentes: { tamano, cuerpo: cuerpo.size.y },
    visible: visible
      ? {
        altoCuerpo: visible.altoCuerpo,
        altoVisible: visible.altoVisible,
        altoTotal: visible.altoTotal,
        tocaArriba: visible.tocaArriba,
        tocaLados: visible.tocaLados
      }
      : null
  };
}

// ============================================================================
// 2. RENDERER COMPARTIDO
// Se crea un único WebGLRenderer. Las diez escenas se dibujan en distintas
// regiones del mismo canvas en lugar de crear diez contextos WebGL.
// ============================================================================
export { measureBody, computeFit, calibrateToView, measureSilhouette, tamanoRelativo, measureExtent, encuadrarModelo };

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
  // Fracción del ancho del lienzo donde debe quedar centrado el campeón: la
  // mitad del hueco que deja libre el panel de runas. Si no hay panel, 0,5.
  function huecoVisible(element, rect) {
    const tarjeta = element.closest('.card, .jugador, li, article') || element.parentElement;
    const runas = tarjeta?.querySelector('.runepage, .runas, .runes');
    if (!runas || !rect.width) return { centroX: 0.5, anchoUtil: 1 };
    const cajaRunas = runas.getBoundingClientRect();
    const fin = Math.min(rect.right, cajaRunas.left);
    const libre = Math.max(0.25 * rect.width, fin - rect.left);
    // El campeón se centra en la mitad de ese hueco y su cuerpo no puede ser
    // más ancho que él.
    return { centroX: Math.min(0.5, (libre / 2) / rect.width), anchoUtil: Math.min(1, libre / rect.width) };
  }

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

      // Tamaño por campeón (tabla real) × ajuste fino del borrador, y encima el
      // ajuste manual del operador. Todo el encuadre vive en encuadrarModelo:
      // así el HUD y la página del ajustador aplican exactamente lo mismo.
      const rect = view.element.getBoundingClientRect();
      const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 226 / 214;
      const ajusteBorrador = Math.min(1.05, Math.max(0.95, SCALE_FIX[view.player.champion] || 1));
      const fix = tamanoRelativo(view.player.champion) * ajusteBorrador;
      const extra = escalaGuardada.get(normalizedName(view.player.champion)) || 1;

      // El encuadre se hace ya con el modelo dentro de su escena: solo así se
      // puede medir lo que de verdad se dibuja (ver encuadrarModelo).
      view.scene.add(model);
      const encuadre = encuadrarModelo(model, aspect, fix, extra, {
        renderer,
        scene: view.scene,
        camera: view.camera,
        // El panel de runas tapa la derecha del lienzo: el campeón se centra en
        // el hueco que se ve, no en el centro del lienzo (si no, queda corrido
        // a la derecha y su brazo se mete debajo de las runas).
        ...huecoVisible(view.element, rect)
      });
      view.fit = Number(encuadre.fit.toFixed(4));
      view.measure = encuadre.measure;
      view.extra = Number(encuadre.aplicado.toFixed(3));
      view.tope = encuadre.tope;
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
