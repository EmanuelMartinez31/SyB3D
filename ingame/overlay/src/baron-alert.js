import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { crearEscenario, PALETAS } from './objective-stage.js';

const MODEL_URL = './assets/models/baron.glb';
const VISIBLE_MS = 10000;
const EXIT_MS = 420;
const SPAWN_CLIP = 'SRU_Baron_spawn.anm';
const IDLE_CLIP = 'SRU_Baron_idle1_aggro.anm';

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

export function createBaronAlert(element) {
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
    element.querySelector('.baron-models').replaceChildren(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 200 / 135, 0.1, 40);
    camera.position.set(0, 1.9, 5.0);
    camera.lookAt(0, 1.2, 0);
    scene.add(new THREE.HemisphereLight(0xeee7ff, 0x241b35, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-3, 5, 4);
    scene.add(key);
    const escenario = crearEscenario(scene, { camara: camera, nivel: -0.5, paleta: PALETAS.comun, ancho: 7, pilares: 8 });

    const source = gltf.scene;
    const spawnClip = gltf.animations.find(animation => animation.name === SPAWN_CLIP) || null;
    const idleClip = gltf.animations.find(animation => animation.name === IDLE_CLIP)
      || gltf.animations.find(animation => /idle/i.test(animation.name))
      || null;

    // Una misma escala y un mismo anclaje durante Spawn e Idle evitan saltos
    // artificiales de tamaño o posición en el fundido entre ambos clips.
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
    const groundY = -0.47;
    const scale = 3.0 / Math.max(size.y, 0.001);
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
      new THREE.PlaneGeometry(2.6, 1.5),
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.80 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = groundY + 0.006;
    anchor.add(shadow);

    const mixer = new THREE.AnimationMixer(model);
    const spawnAction = spawnClip ? mixer.clipAction(spawnClip) : null;
    const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
    const actor = { phase: 'idle', elapsed: 0 };
    if (spawnAction) {
      spawnAction.setLoop(THREE.LoopOnce, 1);
      spawnAction.clampWhenFinished = true;
    }
    if (idleAction) idleAction.setLoop(THREE.LoopRepeat, Infinity);
    mixer.addEventListener('finished', event => {
      if (event.action !== spawnAction || actor.phase !== 'spawn') return;
      actor.phase = 'idle';
      idleAction.reset().play();
      spawnAction.crossFadeTo(idleAction, 0.25, false);
    });

    function resize() {
      const host = element.querySelector('.baron-models');
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element.querySelector('.baron-models'));

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
        escenario?.dispose();
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
        console.warn('Aviso de Barón no disponible:', error.message);
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
