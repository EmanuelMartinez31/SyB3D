import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_URL = './assets/models/rift-herald.glb';
const VISIBLE_MS = 10000;
const EXIT_MS = 420;
const SPAWN_CLIP = 'Spawn';
const TRANSITION_CLIP = 'SRU_RiftHerald_angry_idle_transition.anm';
const IDLE_CLIP = 'Angry_Idle';
const SPAWN_TRIM_START = 1.35;

function createShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(4, 3, 12, 0.76)');
  gradient.addColorStop(0.55, 'rgba(4, 3, 12, 0.38)');
  gradient.addColorStop(1, 'rgba(4, 3, 12, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function createHeraldAlert(element) {
  let currentId = null;
  let requestedNotice = null;
  let hideTimer = null;
  let removeTimer = null;
  let loadPromise = null;
  let sceneState = null;
  let disposed = false;

  function buildScene(gltf) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    element.querySelector('.herald-models').replaceChildren(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
    camera.position.set(0, 1.9, 5.0);
    camera.lookAt(0, 1.15, 0);
    scene.add(new THREE.HemisphereLight(0xe9f3ff, 0x211b32, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-3, 5, 4);
    scene.add(key);

    const source = gltf.scene;
    const spawnSource = gltf.animations.find(animation => animation.name === SPAWN_CLIP) || null;
    const spawnClip = spawnSource
      ? THREE.AnimationUtils.subclip(
        spawnSource,
        `${spawnSource.name}-visible`,
        Math.round(SPAWN_TRIM_START * 30),
        Math.ceil(spawnSource.duration * 30),
        30
      )
      : null;
    const transitionClip = gltf.animations.find(animation => animation.name === TRANSITION_CLIP) || null;
    const idleClip = gltf.animations.find(animation => animation.name === IDLE_CLIP)
      || gltf.animations.find(animation => /idle/i.test(animation.name))
      || null;

    // Los tres clips comparten escala y anclaje para que los fundidos no cambien
    // artificialmente el tamaño ni la posición del Heraldo.
    const measurementModel = cloneSkinned(source);
    const measurementMixer = new THREE.AnimationMixer(measurementModel);
    if (idleClip) measurementMixer.clipAction(idleClip).play();
    measurementMixer.update(0);
    measurementModel.updateMatrixWorld(true);
    measurementModel.traverse(object => {
      if (object.isSkinnedMesh) {
        object.boundingBox = null;
        object.boundingSphere = null;
      }
    });
    const bounds = new THREE.Box3().setFromObject(measurementModel);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const groundY = -0.12;
    const scale = 2.10 / Math.max(size.y, 0.001);
    const position = new THREE.Vector3(
      -center.x * scale,
      -bounds.min.y * scale + groundY,
      -center.z * scale
    );
    measurementMixer.stopAllAction();

    const model = cloneSkinned(source);
    model.traverse(object => {
      if (object.isMesh || object.isSkinnedMesh) object.frustumCulled = false;
    });
    model.scale.setScalar(scale);
    model.position.copy(position);
    const anchor = new THREE.Group();
    anchor.add(model);
    scene.add(anchor);

    const shadowTexture = createShadowTexture();
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 1.6),
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.80 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = groundY + 0.006;
    anchor.add(shadow);

    const mixer = new THREE.AnimationMixer(model);
    const spawnAction = spawnClip ? mixer.clipAction(spawnClip) : null;
    const transitionAction = transitionClip ? mixer.clipAction(transitionClip) : null;
    const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
    const actor = { phase: 'idle', elapsed: 0 };
    for (const action of [spawnAction, transitionAction]) {
      if (!action) continue;
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    if (idleAction) idleAction.setLoop(THREE.LoopRepeat, Infinity);
    mixer.addEventListener('finished', event => {
      if (event.action === spawnAction && actor.phase === 'spawn') {
        actor.phase = 'transition';
        transitionAction.reset().play();
        spawnAction.crossFadeTo(transitionAction, 0.25, false);
        return;
      }
      if (event.action === transitionAction && actor.phase === 'transition') {
        actor.phase = 'idle';
        idleAction.reset().play();
        transitionAction.crossFadeTo(idleAction, 0.25, false);
      }
    });

    function resize() {
      const host = element.querySelector('.herald-models');
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element.querySelector('.herald-models'));

    let startTime = null;
    let previousTimestamp = null;
    function frame(timestamp) {
      if (disposed || element.hidden) return;
      if (startTime === null) startTime = timestamp;
      const delta = previousTimestamp === null ? 0 : Math.max(0, (timestamp - previousTimestamp) / 1000);
      previousTimestamp = timestamp;
      actor.elapsed = (timestamp - startTime) / 1000;
      mixer.update(delta);
      renderer.render(scene, camera);
      element.dataset.animation = actor.phase;
      element.dataset.drawCalls = String(renderer.info.render.calls);
      element.dataset.triangles = String(renderer.info.render.triangles);
    }

    return {
      start() {
        startTime = null;
        previousTimestamp = null;
        mixer.stopAllAction();
        actor.elapsed = 0;
        if (spawnAction) {
          actor.phase = 'spawn';
          spawnAction.reset().play();
        } else if (transitionAction) {
          actor.phase = 'transition';
          transitionAction.reset().play();
        } else if (idleAction) {
          actor.phase = 'idle';
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

  async function prepare() {
    if (sceneState) return sceneState;
    if (!loadPromise) {
      element.dataset.ready = 'false';
      loadPromise = new GLTFLoader().loadAsync(MODEL_URL).then(gltf => {
        if (disposed) return null;
        sceneState = buildScene(gltf);
        element.dataset.ready = 'true';
        return sceneState;
      }).catch(error => {
        loadPromise = null;
        element.dataset.error = 'No se pudo cargar el modelo 3D';
        console.warn('Aviso de Heraldo no disponible:', error.message);
        return null;
      });
    }
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

    const scene = await prepare();
    if (!scene || disposed || requestedNotice?.id !== notice.id) return;
    element.dataset.noticeId = notice.id;
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
