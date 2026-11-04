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

// ============================================================================
// 2. RENDERER COMPARTIDO
// Se crea un único WebGLRenderer. Las diez escenas se dibujan en distintas
// regiones del mismo canvas en lugar de crear diez contextos WebGL.
// ============================================================================
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
      model.updateMatrixWorld(true);
      let bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      if (size.y > 0.0001) {
        const targetHeight = 2.5 * (SCALE_FIX[view.player.champion] || 1);
        model.scale.multiplyScalar(targetHeight / size.y);
      }
      // Primero se gira y después se calcula el centro final: así los modelos
      // anchos no quedan desplazados ni recortados a la derecha.
      model.rotation.y = view.side === 'blue' ? 0.32 : -0.32;
      model.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= bounds.min.y;
      view.scene.add(model);
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
