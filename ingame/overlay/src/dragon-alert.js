import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const VISIBLE_MS = 10000;
const EXIT_MS = 420;
const SPAWN_SPEED = 1;
const DRAGON_ANIMATION = {
  spawn: 'SRU_Dragon_Spawn.anm',
  spawnTrimStart: 6.5,
  spawnTrimEnd: 8.5,
  idle: 'SRU_dragon_idle_ag2al.anm',
  idleLoop: false
};
const DRAGONS = {
  Cloud: { ...DRAGON_ANIMATION, model: './assets/models/dragon-air.glb', title: 'DRAGÓN DE AIRE' },
  Infernal: { ...DRAGON_ANIMATION, model: './assets/models/dragon-infernal.glb', title: 'DRAGÓN INFERNAL' },
  Mountain: { ...DRAGON_ANIMATION, model: './assets/models/dragon-mountain.glb', title: 'DRAGÓN DE MONTAÑA' },
  Ocean: { ...DRAGON_ANIMATION, model: './assets/models/dragon-ocean.glb', title: 'DRAGÓN DE OCÉANO' },
  Hextech: { ...DRAGON_ANIMATION, model: './assets/models/dragon-hextech.glb', title: 'DRAGÓN HEXTECH' },
  Chemtech: { ...DRAGON_ANIMATION, model: './assets/models/dragon-chemtech.glb', title: 'DRAGÓN QUIMTECH' },
  Elder: {
    ...DRAGON_ANIMATION,
    model: './assets/models/dragon-elder.glb',
    title: 'DRAGÓN ANCESTRAL',
    spawn: 'SRU_Dragon_elder_Spawn.anm',
    scale: 1.10
  }
};

function dragonKey(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('elder') || normalized.includes('ancestral')) return 'Elder';
  if (normalized.includes('cloud') || normalized.includes('air')) return 'Cloud';
  if (normalized.includes('infernal') || normalized.includes('fire')) return 'Infernal';
  if (normalized.includes('mountain') || normalized.includes('earth')) return 'Mountain';
  if (normalized.includes('ocean') || normalized.includes('water')) return 'Ocean';
  if (normalized.includes('hextech')) return 'Hextech';
  if (normalized.includes('chemtech') || normalized.includes('quimtech')) return 'Chemtech';
  return null;
}

function createShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(4, 3, 12, 0.72)');
  gradient.addColorStop(0.55, 'rgba(4, 3, 12, 0.35)');
  gradient.addColorStop(1, 'rgba(4, 3, 12, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function createDragonAlert(element) {
  let currentId = null;
  let requestedNotice = null;
  let hideTimer = null;
  let removeTimer = null;
  let loadPromise = null;
  let sceneState = null;
  let loadedUrl = null;
  let disposed = false;

  function buildScene(gltf, config) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    element.querySelector('.dragon-models').replaceChildren(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
    camera.position.set(0, 1.9, 5.0);
    camera.lookAt(0, 1.0, 0);
    scene.add(new THREE.HemisphereLight(0xe7f5ff, 0x182535, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-3, 5, 4);
    scene.add(key);

    const source = gltf.scene;
    source.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(source);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const sizeMultiplier = config.scale ?? 1;
    const normalizedScale = 1.85 * sizeMultiplier / Math.max(size.y, 0.001);
    const model = cloneSkinned(source);
    // El desplazamiento del esqueleto durante Spawn/Idle puede sacar de la cámara
    // el volumen calculado en la pose original; el modelo siempre está dentro del panel.
    model.traverse(object => {
      if (object.isMesh || object.isSkinnedMesh) object.frustumCulled = false;
    });
    model.scale.setScalar(normalizedScale);
    model.position.set(-center.x * normalizedScale, -bounds.min.y * normalizedScale - 0.18, -center.z * normalizedScale);
    let spawnScale = normalizedScale;
    const spawnPosition = model.position.clone();
    const anchor = new THREE.Group();
    anchor.add(model);
    scene.add(anchor);

    const shadowTexture = createShadowTexture();
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.7, 1.45),
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.76 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.006;
    shadow.scale.setScalar(sizeMultiplier);
    anchor.add(shadow);

    const spawnSource = gltf.animations.find(animation => animation.name === config.spawn) || null;
    const spawnClip = spawnSource && config.spawnTrimStart > 0
      ? THREE.AnimationUtils.subclip(
        spawnSource,
        `${spawnSource.name}-visible`,
        Math.round(config.spawnTrimStart * 30),
        Math.ceil((config.spawnTrimEnd ?? spawnSource.duration) * 30),
        30
      )
      : spawnSource;
    const idleClip = gltf.animations.find(animation => animation.name === config.idle)
      || gltf.animations.find(animation => /idle_alert/i.test(animation.name))
      || null;
    const mixer = idleClip ? new THREE.AnimationMixer(model) : null;
    const spawnAction = mixer && spawnClip ? mixer.clipAction(spawnClip) : null;
    const idleAction = mixer && idleClip ? mixer.clipAction(idleClip) : null;

    // Mide la postura de espera y utiliza esa misma referencia para ambos clips.
    // Spawn y ag2al comparten esqueleto: no se debe cambiar la escala ni el
    // anclaje durante el fundido, porque eso produce un salto visual artificial.
    let idleScale = spawnScale;
    let idlePosition = spawnPosition.clone();
    if (idleClip) {
      const measurementModel = cloneSkinned(source);
      const measurementMixer = new THREE.AnimationMixer(measurementModel);
      measurementMixer.clipAction(idleClip).play();
      measurementMixer.update(0);
      measurementModel.updateMatrixWorld(true);
      measurementModel.traverse(object => {
        if (object.isSkinnedMesh) {
          object.boundingBox = null;
          object.boundingSphere = null;
        }
      });
      const idleBounds = new THREE.Box3().setFromObject(measurementModel);
      const idleSize = idleBounds.getSize(new THREE.Vector3());
      const idleCenter = idleBounds.getCenter(new THREE.Vector3());
      idleScale = 1.35 * sizeMultiplier / Math.max(idleSize.y, 0.001);
      idlePosition = new THREE.Vector3(
        -idleCenter.x * idleScale,
        -idleBounds.min.y * idleScale + 0.55,
        -idleCenter.z * idleScale
      );
      measurementMixer.stopAllAction();
      spawnScale = idleScale;
      spawnPosition.copy(idlePosition);
    }
    const actor = { phase: 'idle', elapsed: 0, transformStartedAt: null };
    if (spawnAction) {
      spawnAction.setLoop(THREE.LoopOnce, 1);
      spawnAction.clampWhenFinished = true;
      spawnAction.timeScale = SPAWN_SPEED;
    }
    if (idleAction) {
      if (config.idleLoop === false) {
        idleAction.setLoop(THREE.LoopOnce, 1);
        idleAction.clampWhenFinished = true;
      } else {
        idleAction.setLoop(THREE.LoopRepeat, Infinity);
      }
    }
    mixer?.addEventListener('finished', event => {
      if (event.action !== spawnAction || actor.phase !== 'spawn') return;
      actor.phase = 'idle';
      actor.transformStartedAt = actor.elapsed;
      idleAction.reset().play();
      spawnAction.crossFadeTo(idleAction, 0.25, false);
    });

    function resize() {
      const host = element.querySelector('.dragon-models');
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element.querySelector('.dragon-models'));

    let startTime = null;
    let previousTimestamp = null;
    function frame(timestamp) {
      if (disposed || element.hidden) return;
      if (startTime === null) startTime = timestamp;
      const delta = previousTimestamp === null ? 0 : Math.max(0, (timestamp - previousTimestamp) / 1000);
      previousTimestamp = timestamp;
      const elapsed = (timestamp - startTime) / 1000;
      actor.elapsed = elapsed;
      anchor.visible = elapsed > 0;
      // Avanza cada clip con tiempo local: setTime(elapsed) reiniciaría ag2al
      // en cada fotograma y haría que comenzara a mitad de su transición.
      if (elapsed > 0) mixer?.update(delta);
      if (actor.transformStartedAt !== null) {
        const progress = Math.min(1, (elapsed - actor.transformStartedAt) / 0.25);
        const eased = progress * progress * (3 - 2 * progress);
        model.scale.setScalar(THREE.MathUtils.lerp(spawnScale, idleScale, eased));
        model.position.lerpVectors(spawnPosition, idlePosition, eased);
      }
      renderer.render(scene, camera);
      element.dataset.animation = actor.phase;
      element.dataset.drawCalls = String(renderer.info.render.calls);
      element.dataset.triangles = String(renderer.info.render.triangles);
    }

    return {
      start() {
        startTime = null;
        previousTimestamp = null;
        mixer?.stopAllAction();
        anchor.visible = false;
        actor.elapsed = 0;
        actor.transformStartedAt = null;
        model.scale.setScalar(spawnScale);
        model.position.copy(spawnPosition);
        if (spawnAction) {
          actor.phase = 'spawn';
          spawnAction.reset().play();
        } else if (idleAction) {
          actor.phase = 'idle';
          model.scale.setScalar(idleScale);
          model.position.copy(idlePosition);
          idleAction.reset().play();
        }
        resize();
        renderer.setAnimationLoop(frame);
      },
      stop() {
        renderer.setAnimationLoop(null);
      },
      dispose() {
        resizeObserver.disconnect();
        renderer.dispose();
        shadowTexture.dispose();
        scene.traverse(object => {
          object.geometry?.dispose();
          if (object.material) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(material => material.dispose());
          }
        });
      }
    };
  }

  async function prepare(config = DRAGONS.Cloud) {
    if (sceneState && loadedUrl === config.model) return sceneState;
    if (loadPromise && loadedUrl === config.model) return loadPromise;
    sceneState?.stop();
    sceneState?.dispose();
    sceneState = null;
    loadedUrl = config.model;
    element.dataset.ready = 'false';
    loadPromise = new GLTFLoader().loadAsync(config.model).then(gltf => {
      if (disposed || loadedUrl !== config.model) return null;
      sceneState = buildScene(gltf, config);
      element.dataset.ready = 'true';
      return sceneState;
    }).catch(error => {
      loadPromise = null;
      element.dataset.error = 'No se pudo cargar el modelo 3D';
      console.warn('Aviso de dragón no disponible:', error.message);
      return null;
    });
    return loadPromise;
  }

  async function show(notice) {
    if (!notice?.id || disposed) return;
    if (currentId === notice.id) return;
    currentId = notice.id;
    requestedNotice = notice;
    window.clearTimeout(hideTimer);
    window.clearTimeout(removeTimer);
    element.classList.remove('is-entering', 'is-leaving');
    element.hidden = true;
    sceneState?.stop();

    const key = dragonKey(notice.dragonType);
    const config = key ? DRAGONS[key] : null;
    if (!config) return;
    element.querySelector('.dragon-caption strong').textContent = config.title;
    const scene = await prepare(config);
    if (!scene || disposed || requestedNotice?.id !== notice.id) return;
    element.dataset.noticeId = notice.id;
    element.dataset.dragonType = key;
    element.hidden = false;
    void element.offsetWidth;
    element.classList.add('is-entering');
    scene.start();
    hideTimer = window.setTimeout(() => {
      element.classList.remove('is-entering');
      element.classList.add('is-leaving');
      removeTimer = window.setTimeout(() => {
        if (requestedNotice?.id !== notice.id) return;
        element.hidden = true;
        element.classList.remove('is-leaving');
        scene.stop();
      }, EXIT_MS);
    }, VISIBLE_MS);
  }

  function clear() {
    requestedNotice = null;
    currentId = null;
    window.clearTimeout(hideTimer);
    window.clearTimeout(removeTimer);
    element.hidden = true;
    element.classList.remove('is-entering', 'is-leaving');
    delete element.dataset.noticeId;
    sceneState?.stop();
  }

  return {
    prepare,
    show,
    sync(notice) {
      if (notice?.id) void show(notice);
      else clear();
    },
    clear,
    dispose() {
      disposed = true;
      clear();
      sceneState?.dispose();
      sceneState = null;
      element.dataset.ready = 'false';
    }
  };
}
