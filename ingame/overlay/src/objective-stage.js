import * as THREE from 'three';

/* ------------------------------------------------------------------
   LA FOSA DE LOS AVISOS DE OBJETIVO
   El monstruo sale del agua, como en el juego. La escena se compone en tres
   franjas, de abajo arriba:

     1. el AGUA, que llena la parte baja del cuadro con su remolino;
     2. el BORDE de piedra, bajo y plano, que separa el agua del resto;
     3. los PILARES de roca, altos y angulosos, con huecos entre ellos, y algo
        de vegetación oscura al fondo.

   Son dos fosas distintas:
     · dragón                    -> agua turquesa, piedra azulada, brillo frío
     · barón / heraldo / vacularbas -> agua azul-violácea, brillo morado

   Toda la fosa se dibuja UNA vez al salir el aviso y se guarda como imagen.
   Así cada fotograma cuesta un solo cuadro de textura.
   ------------------------------------------------------------------ */

const RUTA_AGUA = './assets/objectives/stage-water.webp';
const RUTA_PIEDRA = './assets/objectives/stage-floor.webp';

let promesa = null;

function cargarTexturas() {
  if (promesa) return promesa;
  const cargador = new THREE.TextureLoader();
  promesa = Promise.all([
    cargador.loadAsync(RUTA_AGUA),
    cargador.loadAsync(RUTA_PIEDRA)
  ]).then(([agua, piedra]) => {
    agua.colorSpace = THREE.SRGBColorSpace;
    agua.wrapS = agua.wrapT = THREE.RepeatWrapping;
    piedra.colorSpace = THREE.SRGBColorSpace;
    piedra.wrapS = piedra.wrapT = THREE.RepeatWrapping;
    return { agua, piedra };
  }).catch(() => {
    promesa = null;
    return null;
  });
  return promesa;
}

export function prepararEscenario() {
  return cargarTexturas();
}

export const PALETAS = {
  dragon: {
    agua: 0x2f7f8c, aguaHondo: 0x0d3a44,
    piedra: 0xb9c6cf, piedraOsc: 0x5b6b78,
    roca: 0x8fa1ad, rocaOsc: 0x2b3a46,
    brillo: 0x6fe3d8, vegetacion: 0x1d3d33
  },
  comun: {
    agua: 0x3a5f96, aguaHondo: 0x142a52,
    piedra: 0xc2c8d4, piedraOsc: 0x606878,
    roca: 0x93a1b4, rocaOsc: 0x2d3448,
    brillo: 0xb06bff, vegetacion: 0x22303f
  }
};

/**
 * Coloca la fosa alrededor del monstruo.
 *
 * @param {THREE.Scene} scene
 * @param {object} opciones
 *   camara    la cámara real del aviso (obligatoria: se copia su encuadre)
 *   nivel     altura a la que está el agua (el monstruo se apoya ahí)
 *   paleta    PALETAS.dragon o PALETAS.comun
 *   ancho     media anchura del agua
 *   pilares   cuántos pilares de roca al fondo
 */
export function crearEscenario(scene, opciones = {}) {
  const {
    camara,
    nivel = 0,
    paleta = PALETAS.comun,
    ancho = 6,
    pilares = 7,
    aspecto = 200 / 135,   // forma de la zona del modelo en ESA casilla
    semilla = 7
  } = opciones;

  const grupo = new THREE.Group();
  grupo.name = 'objective-pit';
  let vivo = true;
  const desechables = [];

  if (!camara) return { dispose() {} };

  cargarTexturas().then(texturas => {
    if (!vivo || !texturas) return;

    /* ---- se dibuja la fosa en un lienzo aparte ---- */
    const anchoLienzo = 256;
    const altoLienzo = Math.round(anchoLienzo / aspecto);
    const lienzo = document.createElement('canvas');
    lienzo.width = anchoLienzo;
    lienzo.height = altoLienzo;

    const render = new THREE.WebGLRenderer({
      canvas: lienzo, alpha: true, antialias: true, preserveDrawingBuffer: true
    });
    render.setSize(anchoLienzo, altoLienzo, false);
    render.outputColorSpace = THREE.SRGBColorSpace;
    render.setClearColor(0x000000, 0);

    const escena = new THREE.Scene();
    /* La fosa se mira desde un punto más bajo y más cerca que el monstruo:
       así el agua ocupa la franja de abajo y los pilares quedan de fondo,
       como en las capturas del juego. */
    const cam = new THREE.PerspectiveCamera(38, anchoLienzo / altoLienzo, 0.05, 80);
    cam.position.set(0, nivel + 1.05, 3.4);
    cam.lookAt(0, nivel + 0.55, -2.2);
    cam.updateProjectionMatrix();

    escena.add(new THREE.HemisphereLight(0xd8e8ff, 0x101a28, 2.1));
    const luzArriba = new THREE.DirectionalLight(0xffffff, 2.0);
    luzArriba.position.set(-2.5, 4.5, 4.5);
    escena.add(luzArriba);
    const luzFrente = new THREE.DirectionalLight(0xbfe0ff, 1.1);
    luzFrente.position.set(0, 1.2, 6);
    escena.add(luzFrente);

    const azarBase = semilla;
    let semillaActual = azarBase;
    const azar = () => ((semillaActual = semillaActual * 48271 % 2147483647) / 2147483647);

    /* ---------- 1. EL AGUA ---------- */
    const mapaAgua = texturas.agua.clone();
    mapaAgua.needsUpdate = true;
    mapaAgua.repeat.set(2.2, 1.6);
    mapaAgua.center.set(0.5, 0.5);
    const agua = new THREE.Mesh(
      new THREE.PlaneGeometry(ancho * 2.4, 10, 1, 1),
      new THREE.MeshBasicMaterial({ map: mapaAgua, color: 0xffffff })
    );
    agua.rotation.x = -Math.PI / 2;
    agua.position.set(0, nivel, 1.6);
    escena.add(agua);

    // el borde del agua se hunde: una franja oscura para dar profundidad
    const hondo = new THREE.Mesh(
      new THREE.PlaneGeometry(ancho * 2.4, 3.2, 1, 1),
      new THREE.MeshBasicMaterial({ color: paleta.aguaHondo })
    );
    hondo.rotation.x = -Math.PI / 2;
    hondo.position.set(0, nivel + 0.002, -1.4);
    escena.add(hondo);

    /* ---------- 2. EL BORDE DE PIEDRA ---------- */
    // franja horizontal baja, como el pretil que separa agua y roca
    const mapaPiedra = texturas.piedra.clone();
    mapaPiedra.needsUpdate = true;
    mapaPiedra.repeat.set(5, 1);
    const pretil = new THREE.Mesh(
      new THREE.BoxGeometry(ancho * 2.3, 0.34, 0.55),
      new THREE.MeshLambertMaterial({ map: mapaPiedra, color: paleta.piedra })
    );
    pretil.position.set(0, nivel + 0.17, -2.35);
    escena.add(pretil);

    // los bloques sueltos del borde, de distinto tamaño
    for (let i = 0; i < 12; i++) {
      const anchoBloque = 0.3 + azar() * 0.45;
      const bloque = new THREE.Mesh(
        new THREE.BoxGeometry(anchoBloque, 0.16 + azar() * 0.2, 0.4 + azar() * 0.2),
        new THREE.MeshLambertMaterial({
          color: azar() > 0.6 ? paleta.piedra : paleta.piedraOsc, flatShading: true
        })
      );
      bloque.position.set(
        (i / 11 - 0.5) * ancho * 2.1 + (azar() - 0.5) * 0.3,
        nivel + 0.06 + azar() * 0.05,
        -2.05 - azar() * 0.25
      );
      bloque.rotation.y = (azar() - 0.5) * 0.5;
      escena.add(bloque);
    }

    /* ---------- 3. LOS PILARES DE ROCA ---------- */
    const mapaPilar = texturas.piedra.clone();
    mapaPilar.needsUpdate = true;
    mapaPilar.repeat.set(1, 2.4);

    for (let i = 0; i < pilares; i++) {
      const t = pilares === 1 ? 0.5 : i / (pilares - 1);
      const x = (t - 0.5) * ancho * 1.9 + (azar() - 0.5) * 0.5;
      const alto = 1.35 + azar() * 2.1;
      const anchoPilar = 0.4 + azar() * 0.6;
      // prisma de 6 caras, no una caja: las rocas del foso son angulosas
      const pilar = new THREE.Mesh(
        new THREE.CylinderGeometry(
          anchoPilar * 0.5, anchoPilar * 0.62, alto, 5 + Math.floor(azar() * 3), 1
        ),
        new THREE.MeshLambertMaterial({
          map: mapaPilar, color: azar() > 0.5 ? paleta.roca : paleta.rocaOsc,
          emissive: paleta.rocaOsc, emissiveIntensity: 0.22, flatShading: true
        })
      );
      pilar.position.set(x, nivel + alto / 2 - 0.15, -2.9 - azar() * 1.9);
      pilar.rotation.set((azar() - 0.5) * 0.14, azar() * 0.7, (azar() - 0.5) * 0.18);
      escena.add(pilar);

      // una losa ladeada encima, para que no parezcan cajas
      if (azar() > 0.45) {
        const losa = new THREE.Mesh(
          new THREE.BoxGeometry(anchoPilar * 1.25, 0.14, anchoPilar * 0.9),
          new THREE.MeshLambertMaterial({ color: paleta.roca, flatShading: true })
        );
        losa.position.set(x + (azar() - 0.5) * 0.2, nivel + alto - 0.12, pilar.position.z);
        losa.rotation.set((azar() - 0.5) * 0.35, azar() * 0.9, (azar() - 0.5) * 0.3);
        escena.add(losa);
      }
    }

    /* ---------- 4. VEGETACIÓN Y FONDO ---------- */
    for (let i = 0; i < 16; i++) {
      const alto = 0.45 + azar() * 1.15;
      const mata = new THREE.Mesh(
        new THREE.ConeGeometry(0.16 + azar() * 0.26, alto, 5),
        new THREE.MeshLambertMaterial({ color: paleta.vegetacion, flatShading: true })
      );
      mata.position.set(
        (azar() - 0.5) * ancho * 2.3,
        nivel + alto / 2 - 0.08,
        -2.6 - azar() * 2.8
      );
      mata.rotation.set((azar() - 0.5) * 0.3, azar() * 3, (azar() - 0.5) * 0.3);
      escena.add(mata);
    }

    // matas colgando por delante del pretil, como en las capturas
    for (let i = 0; i < 7; i++) {
      const alto = 0.3 + azar() * 0.45;
      const mata = new THREE.Mesh(
        new THREE.ConeGeometry(0.12 + azar() * 0.18, alto, 4),
        new THREE.MeshLambertMaterial({ color: paleta.vegetacion, flatShading: true })
      );
      mata.position.set(
        (azar() - 0.5) * ancho * 2.0,
        nivel + 0.2 + azar() * 0.1,
        -2.0 - azar() * 0.3
      );
      mata.rotation.set(Math.PI * 0.42, azar() * 3, (azar() - 0.5) * 0.4);
      escena.add(mata);
    }

    // rocas sueltas sobre el pretil
    for (let i = 0; i < 8; i++) {
      const tam = 0.07 + azar() * 0.12;
      const piedra = new THREE.Mesh(
        new THREE.IcosahedronGeometry(tam, 0),
        new THREE.MeshLambertMaterial({
          color: azar() > 0.5 ? paleta.piedra : paleta.piedraOsc, flatShading: true
        })
      );
      piedra.position.set(
        (azar() - 0.5) * ancho * 2.0,
        nivel + 0.36 + azar() * 0.06,
        -2.3 - azar() * 0.3
      );
      piedra.scale.y = 0.6 + azar() * 0.4;
      escena.add(piedra);
    }

    // pared de fondo: cierra el cuadro para que no se vea el vacío
    const fondo = new THREE.Mesh(
      new THREE.PlaneGeometry(ancho * 5, 6),
      new THREE.MeshBasicMaterial({ color: paleta.rocaOsc })
    );
    fondo.position.set(0, nivel + 2.4, -6.5);
    escena.add(fondo);

    /* ---------- 5. EL BRILLO ---------- */
    // luz tenue que sale del agua y tiñe la piedra, como en tus capturas
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(ancho * 2.0, 0.8),
      new THREE.MeshBasicMaterial({
        color: paleta.brillo, transparent: true, opacity: 0.55, depthWrite: false
      })
    );
    halo.position.set(0, nivel + 0.05, -2.1);
    halo.rotation.x = -Math.PI / 2;
    escena.add(halo);

    const resplandor = new THREE.PointLight(paleta.brillo, 9, 9, 2);
    resplandor.position.set(0, nivel + 0.25, -1.4);
    escena.add(resplandor);

    render.render(escena, cam);

    /* ---- la imagen resultante se cuelga detrás del monstruo ---- */
    const imagen = new THREE.CanvasTexture(lienzo);
    imagen.colorSpace = THREE.SRGBColorSpace;
    imagen.needsUpdate = true;

    render.dispose();
    escena.traverse(o => {
      o.geometry?.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { m.map?.dispose(); m.dispose(); });
      }
    });

    if (!vivo) { imagen.dispose(); return; }

    /* La imagen se horneó con esta misma cámara, así que sirve a cualquier
       distancia: se escala al tamaño del encuadre y se manda al fondo, donde
       no puede tapar al monstruo. */
    const distancia = 24;
    const alto = 2 * distancia * Math.tan((camara.fov * Math.PI / 180) / 2);
    const anchoPlano = alto * aspecto;

    const plano = new THREE.Mesh(
      new THREE.PlaneGeometry(anchoPlano, alto),
      new THREE.MeshBasicMaterial({ map: imagen, transparent: true, depthWrite: false })
    );
    const frente = new THREE.Vector3(0, 0, -1).applyQuaternion(camara.quaternion);
    plano.position.copy(camara.position).addScaledVector(frente, distancia);
    plano.quaternion.copy(camara.quaternion);
    plano.renderOrder = -50;
    grupo.add(plano);
    desechables.push(plano.geometry, imagen, plano.material);

    scene.add(grupo);
  });

  return {
    dispose() {
      vivo = false;
      scene.remove(grupo);
      desechables.forEach(cosa => cosa?.dispose?.());
      desechables.length = 0;
    }
  };
}
