import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_URL = './assets/models/voidgrub.glb';
const VISIBLE_MS = 10000;
const EXIT_MS = 420;
const ENTRY_STAGGER = 0.14;
const instances = [
  { x: -0.73, z: 0.10, yaw: 0.18 },
  { x: 0, z: -0.20, yaw: 0 },
  { x: 0.73, z: 0.10, yaw: -0.18 }
];

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

export function createVoidGrubAlert(element) {
  let currentId = null;
  let requestedNotice = null;
  let hideTimer = null;
  let removeTimer = null;
  let loadPromise = null;
  let sceneState = null;
  let disposed = false;

  function setSceneState(value) {
    sceneState = value;
    element.dataset.ready = value ? 'true' : 'false';
  }

  function buildScene(gltf) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    element.querySelector('.voidgrub-models').replaceChildren(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
    camera.position.set(0, 1.75, 4.05);
    camera.lookAt(0, 0.73, 0);
    scene.add(new THREE.HemisphereLight(0xe7e2ff, 0x271c38, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-3, 5, 4);
    scene.add(key);

    const source = gltf.scene;
    source.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(source);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const normalizedScale = 1.36 / Math.max(size.y, 0.001);
    const spawnClip = gltf.animations.find(animation => animation.name === 'SpawnIn') || null;
    const idleClip = gltf.animations.find(animation => animation.name === 'IdleVar1')
      || gltf.animations.find(animation => /idle/i.test(animation.name))
      || gltf.animations[0];
    const shadowTexture = createShadowTexture();
    const actors = instances.map((placement, index) => {
      const anchor = new THREE.Group();
      anchor.position.set(placement.x, 0, placement.z);
      anchor.rotation.y = placement.yaw;

      const model = cloneSkinned(source);
      model.scale.setScalar(normalizedScale);
      model.position.set(-center.x * normalizedScale, -bounds.min.y * normalizedScale, -center.z * normalizedScale);
      anchor.add(model);

      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.22, 0.82),
        new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.82 })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.006;
      anchor.add(shadow);
      scene.add(anchor);

      const mixer = idleClip ? new THREE.AnimationMixer(model) : null;
      const spawnAction = mixer && spawnClip ? mixer.clipAction(spawnClip) : null;
      const idleAction = mixer && idleClip ? mixer.clipAction(idleClip) : null;
      if (spawnAction) {
        spawnAction.setLoop(THREE.LoopOnce, 1);
        spawnAction.clampWhenFinished = true;
        spawnAction.timeScale = 2;
      }
      if (idleAction) idleAction.setLoop(THREE.LoopRepeat, Infinity);
      const actor = { anchor, mixer, spawnAction, idleAction, normalizedScale, index, phase: 'idle' };
      mixer?.addEventListener('finished', event => {
        if (event.action !== spawnAction || actor.phase !== 'spawn') return;
        actor.phase = 'idle';
        idleAction.reset().play();
        spawnAction.crossFadeTo(idleAction, 0.25, false);
      });
      return actor;
    });

    function resize() {
      const host = element.querySelector('.voidgrub-models');
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element.querySelector('.voidgrub-models'));

    let startTime = null;
    function frame(timestamp) {
      if (disposed || element.hidden) return;
      if (startTime === null) startTime = timestamp;
      const elapsed = (timestamp - startTime) / 1000;

      for (const actor of actors) {
        const local = Math.max(0, elapsed - actor.index * ENTRY_STAGGER);
        actor.anchor.visible = local > 0;
        // Tiempo absoluto: una caída de FPS no retrasa el cambio SpawnIn → IdleVar1.
        if (local > 0) actor.mixer?.setTime(local);
      }
      renderer.render(scene, camera);
      element.dataset.animation = actors.every(actor => actor.phase === 'idle') ? 'idle' : 'spawn';
      element.dataset.drawCalls = String(renderer.info.render.calls);
      element.dataset.triangles = String(renderer.info.render.triangles);
    }

    return {
      start() {
        startTime = null;
        for (const actor of actors) {
          actor.mixer?.stopAllAction();
          actor.anchor.visible = false;
          if (actor.spawnAction) {
            actor.phase = 'spawn';
            actor.spawnAction.reset().play();
          } else if (actor.idleAction) {
            actor.phase = 'idle';
            actor.idleAction.reset().play();
          }
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
      loadPromise = new GLTFLoader().loadAsync(MODEL_URL).then(gltf => {
        if (disposed) return null;
        const value = buildScene(gltf);
        setSceneState(value);
        return value;
      }).catch(error => {
        loadPromise = null;
        element.dataset.error = 'No se pudo cargar el modelo 3D';
        console.warn('Aviso de vacularbas no disponible:', error.message);
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
    const scene = await prepare();
    if (!scene || disposed || requestedNotice?.id !== notice.id) return;
    element.dataset.noticeId = notice.id;
    element.hidden = false;
    // Reinicia la transición incluso si dos avisos llegan muy seguidos.
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
      setSceneState(null);
    }
  };
}
