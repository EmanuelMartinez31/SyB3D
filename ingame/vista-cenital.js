/* Vista cenital del mapa usando la CÁMARA DEL PROPIO JUEGO.
   ------------------------------------------------------------------------
   Esto no dibuja ningún mapa: manda la cámara del juego a una posición muy
   alta mirando hacia abajo y apaga la interfaz y las capas de contenido, para
   que se vea solo el terreno de verdad. Al volver, restaura todo como estaba.

   Va por el mismo canal que ya usa el sistema para ocultar el HUD nativo:
   el endpoint local del juego en 127.0.0.1:2999 (/replay/render). Si el juego
   no contesta, no se rompe nada: devuelve el error y se sigue igual.

   Ajustes en: ingame/cine/vista-cenital.json
*/

const fs = require('fs');
const path = require('path');
const https = require('https');

const AJUSTES = path.join(__dirname, 'cine', 'vista-cenital.json');
const MEMORIA = path.join(__dirname, 'cine', 'vista-cenital-estado.json');

const POR_DEFECTO = {
  modoCamara: 'free',            // sin esto la cámara sigue al campeón y la posición se ignora
  posicion: { x: 7500, y: 20000, z: 7500 },
  rotacion: { x: -90, y: 0, z: 0 },
  campoVista: 45,
  quitarInterfaz: true,
  quitarPersonajes: true,
  quitarMinions: true,
  quitarParticulas: true,
  quitarBarras: true,
  quitarTextos: true,
  quitarNiebla: true
};

// Propiedades de cámara que se guardan y se devuelven tal cual al volver.
const CAMPOS_DE_VUELTA = [
  'cameraPosition', 'cameraRotation', 'fieldOfView',
  'nearClip', 'farClip', 'cameraMode'
];

// Capas de contenido que se apagan mientras está arriba.
/* Nombres sacados del codigo de League Director, la herramienta oficial de
   Riot para repeticiones. Son estos y no otros: "healthBar" a secas no existe,
   existen healthBarChampions, healthBarMinions, etc.
   Las barras de los campeones NO se van con "interfaceAll": son otra cosa. */
const CAPAS = [
  ['quitarPersonajes', ['characters', 'champions']],
  ['quitarMinions', ['minions']],
  ['quitarParticulas', ['particles']],
  ['quitarBarras', [
    'healthBarChampions',
    'healthBarMinions',
    'healthBarStructures',
    'healthBarWards',
    'healthBarPets',
    'floatingText'
  ]]
];

/* Paneles que en el HUD normal estan OCULTOS. Al devolver la interfaz con
   "interfaceAll: true" el juego los vuelve a enseñar, asi que hay que
   apagarlos aparte: la barra del marcador, la tabla y la linea de tiempo. */
const INTERFAZ_OCULTA = [
  'interfaceScore',        // barra del marcador
  'interfaceScoreboard',   // tabla
  'interfaceFrames',       // marco de equipos
  'interfaceTimeline',     // linea de tiempo
  'interfaceKillCallouts', // avisos de "X mato a Y"
  'interfaceAnnounce'      // anuncios del narrador
];

/* Resto de la interfaz que tambien se quita cuando se pide. */
const INTERFAZ_EXTRA = [
  'interfaceMinimap', 'interfaceScore', 'interfaceScoreboard', 'interfaceReplay',
  'interfaceFrames', 'interfaceTimeline', 'interfaceChat', 'interfaceTarget',
  'interfaceQuests', 'interfaceAnnounce', 'interfaceKillCallouts',
  'interfaceNeutralTimers', 'banners', 'outlineSelect', 'outlineHover'
];

let guardado = null;          // cómo estaba el juego antes de subir
let arriba = false;

function leerAjustes() {
  try {
    const texto = fs.readFileSync(AJUSTES, 'utf8');
    return { ...POR_DEFECTO, ...JSON.parse(texto) };
  } catch (error) {
    console.log(`[cenital] No puedo leer ${AJUSTES} (${error.message}); uso los valores por defecto`);
    return { ...POR_DEFECTO };
  }
}

function pedirJuego(metodo, propiedades, ruta = '/replay/render') {
  return new Promise((resolve, reject) => {
    const cuerpo = propiedades ? JSON.stringify(propiedades) : null;
    const peticion = https.request({
      hostname: '127.0.0.1',
      port: 2999,
      path: ruta,
      method: metodo,
      // Certificado propio del juego. Solo se relaja para 127.0.0.1:2999.
      rejectUnauthorized: false,
      headers: cuerpo ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(cuerpo)
      } : {}
    }, respuesta => {
      const trozos = [];
      respuesta.on('data', t => trozos.push(t));
      respuesta.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8');
        let datos = texto;
        try { datos = JSON.parse(texto); } catch { /* se deja el texto tal cual */ }
        resolve({ estado: respuesta.statusCode || 0, datos });
      });
    });
    peticion.setTimeout(3000, () => peticion.destroy(new Error('el juego no respondió a tiempo')));
    peticion.on('error', reject);
    if (cuerpo) peticion.write(cuerpo);
    peticion.end();
  });
}

/* La cámara se mueve con una SECUENCIA (/replay/sequence): es el mismo camino
   que usa la cinemática de inicio, y es el único que el juego obedece de
   verdad. /replay/render acepta la orden y la ignora.

   Convención de la rotación, comprobada en la cinemática que ya funcionó:
       x = giro horizontal (yaw), puede pasar de 180
       y = inclinación: 56 es como el modo top, 90 es mirando al suelo
*/
/* OJO: el juego NO cuenta los tiempos desde cero, sino en segundos desde que
   empezo la partida. Mandar time:0 en un minuto 2:05 es mandar una orden al
   pasado, y el juego hace lo que le parece. Por eso hay que sumar el segundo
   actual. Es lo mismo que hace la cinematica de inicio. */
function secuenciaDeCamara(ajustes, desde = 0, actual = null) {
  const base = Number.isFinite(desde) && desde >= 0 ? desde : 0;
  const dur = Number(ajustes.duracionSegundos) || 1;

  /* Se manda el recorrido entero, fotograma a fotograma, con una curva suave
     al empezar y al acabar. Si solo se mandan dos claves, el juego lo hace de
     golpe y se ve feo. */
  const queda = (v, porDefecto) => (Number.isFinite(Number(v)) ? Number(v) : porDefecto);
  const desde3 = (o, alt) => ({
    x: queda(o && o.x, alt.x), y: queda(o && o.y, alt.y), z: queda(o && o.z, alt.z)
  });

  const posA = desde3(actual && actual.cameraPosition, ajustes.posicion);
  const rotA = desde3(actual && actual.cameraRotation, ajustes.rotacion);
  const fovA = queda(actual && actual.fieldOfView, Number(ajustes.campoVista));
  const posB = desde3(ajustes.posicion, posA);
  const rotB = desde3(ajustes.rotacion, rotA);
  const fovB = queda(ajustes.campoVista, fovA);

  const pasos = Math.max(2, Math.round(dur * 30));
  const suave = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const entre = (a, b, e) => a + (b - a) * e;
  /* El giro va por el lado corto: nunca da una vuelta entera de mas. */
  const giro = (a, b, e) => {
    let d = ((b - a) % 360 + 540) % 360 - 180;
    return a + d * e;
  };

  const cameraPosition = [];
  const cameraRotation = [];
  const fieldOfView = [];
  const clave = (t, value) => ({ blend: ajustes.transicion || 'linear', time: t, value });

  for (let i = 0; i <= pasos; i += 1) {
    const k = i / pasos;
    const e = suave(k);
    const t = Number((base + dur * k).toFixed(3));
    cameraPosition.push(clave(t, {
      x: entre(posA.x, posB.x, e), y: entre(posA.y, posB.y, e), z: entre(posA.z, posB.z, e)
    }));
    cameraRotation.push(clave(t, {
      x: giro(rotA.x, rotB.x, e), y: entre(rotA.y, rotB.y, e), z: entre(rotA.z, rotB.z, e)
    }));
    fieldOfView.push(clave(t, entre(fovA, fovB, e)));
  }

  return { cameraPosition, cameraRotation, fieldOfView };
}

/* El segundo de partida: primero el que nos diga el HUD; si no, se pregunta
   al juego. */
async function segundoDePartida(dado) {
  const n = Number(dado);
  if (Number.isFinite(n) && n >= 0) return n;
  try {
    const r = await pedirJuego('GET', null, '/liveclientdata/gamestats');
    const t = Number(r && r.datos && r.datos.gameTime);
    if (Number.isFinite(t) && t >= 0) return t;
  } catch { /* se sigue abajo */ }
  return 0;
}

function pedirSecuencia(cuerpo) {
  return new Promise((resolve, reject) => {
    const texto = JSON.stringify(cuerpo);
    const peticion = https.request({
      hostname: '127.0.0.1', port: 2999, path: '/replay/sequence', method: 'POST',
      rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(texto) }
    }, respuesta => {
      const trozos = [];
      respuesta.on('data', t => trozos.push(t));
      respuesta.on('end', () => resolve({ estado: respuesta.statusCode || 0,
        datos: Buffer.concat(trozos).toString('utf8') }));
    });
    peticion.setTimeout(4000, () => peticion.destroy(new Error('el juego no respondió a tiempo')));
    peticion.on('error', reject);
    peticion.write(texto);
    peticion.end();
  });
}

async function leerEstadoDelJuego() {
  const r = await pedirJuego('GET');
  if (r.estado < 200 || r.estado >= 300) {
    throw new Error(`El juego respondió HTTP ${r.estado} al leer el estado`);
  }
  return r.datos;
}

function recordar(estado, apagados) {
  const copia = {};
  if (estado && typeof estado === 'object') {
    /* Se guardan TODOS los interruptores que publique el juego (interfaz,
       barras, niebla...), no solo los de la camara. Asi al volver se deja
       todo exactamente como estaba, y no se enciende lo que estaba apagado. */
    for (const [clave, valor] of Object.entries(estado)) {
      if (typeof valor === 'boolean') copia[clave] = valor;
    }
    for (const campo of CAMPOS_DE_VUELTA) {
      if (estado[campo] !== undefined) copia[campo] = estado[campo];
    }
  }
  copia._apagados = Array.isArray(apagados) ? apagados : [];
  guardado = copia;
  try {
    fs.writeFileSync(MEMORIA, JSON.stringify(copia, null, 1), 'utf8');
  } catch { /* si no se puede escribir, se queda solo en memoria */ }
}

function recordadoDelDisco() {
  if (guardado) return guardado;
  try {
    guardado = JSON.parse(fs.readFileSync(MEMORIA, 'utf8'));
  } catch {
    guardado = null;
  }
  return guardado;
}

// POST con reintento: el endpoint del juego tarda un par de segundos en
// aceptar escrituras al empezar la partida (404/405).
async function escribir(propiedades) {
  let ultimo = null;
  for (let intento = 1; intento <= 6; intento += 1) {
    ultimo = await pedirJuego('POST', propiedades);
    if (ultimo.estado >= 200 && ultimo.estado < 300) return ultimo;
    if (ultimo.estado !== 404 && ultimo.estado !== 405) break;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`El juego rechazó la orden (HTTP ${ultimo ? ultimo.estado : '?'})`);
}

async function subir(opciones = {}) {
  const ajustes = leerAjustes();

  // 1. Guardar cómo estaba antes de tocar nada (y de dónde arranca la animación).
  let actual = null;
  try {
    actual = await leerEstadoDelJuego();
  } catch (error) {
    console.log(`[cenital] No pude leer la cámara de partida: ${error.message}`);
  }
  /* Cada cosa va en SU PROPIO envio, con nombres que el juego reconoce.
     Si se mezclan campos inventados, el juego puede rechazar el paquete
     entero y entonces no se apaga nada de nada. */
  const orden = {};
  for (const [bandera, nombres] of CAPAS) {
    if (!ajustes[bandera]) continue;
    for (const nombre of nombres) orden[nombre] = false;
  }
  /* Ya se sabe que se va a apagar: ahora si se puede guardar el estado. */
  if (!arriba) {
    if (actual) recordar(actual, Object.keys(orden));
    else recordar(recordadoDelDisco());
  }

  const lejano = Number(ajustes.campoLejano);
  const envios = [];
  /* Las barras y el texto flotante van en SU PROPIO envio: si el juego no
     conociera alguno de estos nombres, solo se perderia este, no todo. */
  if (Object.keys(orden).length) envios.push(orden);
  /* Solo la orden general. Los paneles NO se tocan uno a uno: si se encienden
     todos al volver, aparece la tabla de puntuacion que normalmente esta
     escondida. El juego ya guarda cual estaba visible. */
  if (ajustes.quitarInterfaz) {
    envios.push({ interfaceAll: false });
    const ocultos = {};
    for (const nombre of INTERFAZ_OCULTA) ocultos[nombre] = false;
    envios.push(ocultos);
  }
  if (Number.isFinite(lejano) && lejano > 0) envios.push({ farClip: lejano });
  if (ajustes.quitarNiebla) envios.push({ fogOfWar: false });

  /* Quitar cualquier secuencia que hubiera y poner la nuestra. */
  try { await pedirSecuencia({}); } catch { /* da igual */ }

  const desde = await segundoDePartida(opciones.gameTime);
  const secuencia = secuenciaDeCamara(ajustes, desde, actual);
  const r = await pedirSecuencia(secuencia);
  if (r.estado < 200 || r.estado >= 300) {
    throw new Error(`El juego rechazó la secuencia (HTTP ${r.estado})`);
  }

  // Lo que se apaga (capas, interfaz) va por /replay/render, que sí obedece.
  const resultados = [];
  for (const cuerpo of envios) {
    try {
      const rr = await escribir(cuerpo);
      resultados.push({ enviado: cuerpo, estado: rr && rr.estado });
    } catch (e) {
      resultados.push({ enviado: cuerpo, error: e.message });
      console.log(`[cenital] no pude aplicar ${JSON.stringify(cuerpo)}: ${e.message}`);
    }
  }

  arriba = true;

  /* Comprobar si el juego ha hecho caso DE VERDAD. El juego puede contestar
     "vale" y aun así no mover la cámara: en partida en vivo no deja, solo en
     repeticiones. Así no nos llevamos a engaño. */
  let camaraMovida = null;
  try {
    const después = await leerEstadoDelJuego();
    const p = después && después.cameraPosition;
    if (p && typeof p.x === 'number') {
      const d = Math.abs(p.x - ajustes.posicion.x)
        + Math.abs(p.y - ajustes.posicion.y)
        + Math.abs(p.z - ajustes.posicion.z);
      camaraMovida = d < 200;
    }
  } catch { /* si no se puede comprobar, se deja en null */ }

  const aviso = camaraMovida === false
    ? 'El juego aceptó la orden pero NO movió la cámara. Prueba el ajuste fino en /camara/ajustar'
    : undefined;

  return { ok: true, arriba, camaraMovida, aviso, desde, enviado: orden, resultados };
}

async function bajar(opciones = {}) {
  const previo = recordadoDelDisco();

  /* Se separa en dos: lo de la INTERFAZ vuelve al instante (el minimapa tiene
     que aparecer en cuanto se pulsa regresar), y lo de la CAMARA (los limites
     de dibujo) se devuelve al final, cuando ya ha bajado. */
  /* NO se copia la lista de paneles que publica el juego: los publica TODOS
     como encendidos aunque en pantalla esten ocultos. Copiarla era lo que
     hacia aparecer la linea de tiempo, la barra, la tabla y demas cosas que
     antes no estaban.

     Solo se devuelve lo que apagamos nosotros, y nada mas:
        1. la interfaz entera (el juego ya sabe cual de sus paneles tenia
           visibles y los restaura el solo)
        2. las barras y el texto flotante
  */
  const ordenGeneral = { interfaceAll: true };
  /* "interfaceAll: true" enciende TAMBIEN la barra del marcador, la tabla y la
     linea de tiempo, que en el HUD normal estan ocultas. Se apagan justo
     despues, en su propio envio. */
  const ordenOcultos = {};
  for (const nombre of INTERFAZ_OCULTA) ordenOcultos[nombre] = false;
  const ordenBarras = {};
  const apagados = previo && Array.isArray(previo._apagados) ? previo._apagados : [];
  for (const nombre of apagados) ordenBarras[nombre] = true;

  /* Devolver la interfaz YA. Asi el minimapa y las barras del juego vuelven
     en el mismo momento en que se pulsa regresar, no al final. */
  try {
    await escribir(ordenGeneral);
    await escribir(ordenOcultos);
    if (Object.keys(ordenBarras).length) await escribir(ordenBarras);
  } catch (e) {
    console.log(`[cenital] no pude devolver la interfaz: ${e.message}`);
  }

  /* Los limites de dibujo con los que estaba el juego. */
  const ordenCamara = {};
  if (previo) {
    for (const campo of ['nearClip', 'farClip', 'cameraMode']) {
      if (previo[campo] !== undefined) ordenCamara[campo] = previo[campo];
    }
  }

  /* Esto se hace al final de todo, cuando la camara ya bajo. */
  const restaurar = async () => {
    if (!Object.keys(ordenCamara).length) return;
    try { await escribir(ordenCamara); } catch (e) {
      console.log(`[cenital] no pude devolver los limites: ${e.message}`);
    }
  };

  /* La bajada también se anima: se recorre el camino de vuelta desde donde
     esté ahora hasta donde estaba antes, y solo al terminar se retira la
     secuencia. Antes desaparecía de golpe. */
  const ajustesBajar = leerAjustes();
  const ahoraMismo = await leerEstadoDelJuego().catch(() => null);
  if (previo && previo.cameraPosition && ahoraMismo) {
    const vuelta = {
      posicion: previo.cameraPosition,
      rotacion: previo.cameraRotation || ajustesBajar.rotacion,
      campoVista: previo.fieldOfView !== undefined ? previo.fieldOfView : ajustesBajar.campoVista,
      duracionSegundos: ajustesBajar.duracionSegundos,
      transicion: ajustesBajar.transicion
    };
    try {
      /* Mientras la camara baja, el "campo lejano" se queda grande y el
         cercano pequeno. Si se devuelven a su valor antes de tiempo, el mapa
         se ve CORTADO por la mitad justo cuando empieza a bajar. */
      try {
        await escribir({ farClip: 60000, nearClip: 5 });
      } catch { /* si no se puede, se sigue igual */ }

      /* El mismo segundo de partida que al subir: sin esto la vuelta tambien
         se manda al pasado y el juego no la hace. */
      const desde2 = await segundoDePartida(opciones.gameTime);
      await pedirSecuencia(secuenciaDeCamara(vuelta, desde2, ahoraMismo));
      const espera = (Number(ajustesBajar.duracionSegundos) || 1) * 1000 + 500;
      setTimeout(() => {
        pedirSecuencia({}).catch(() => {}).then(restaurar);
      }, espera);
      arriba = false;
      guardado = null;
      try { fs.unlinkSync(MEMORIA); } catch { /* no estaba */ }
      return { ok: true, arriba, animando: true, enviado: ordenGeneral };
    } catch (e) {
      console.log(`[cenital] la bajada no se pudo animar: ${e.message}`);
      try { await pedirSecuencia({}); } catch { /* da igual */ }
    }
  } else {
    try { await pedirSecuencia({}); } catch (e) {
      console.log(`[cenital] no pude retirar la secuencia: ${e.message}`);
    }
  }

  await restaurar();
  arriba = false;
  guardado = null;
  try { fs.unlinkSync(MEMORIA); } catch { /* no estaba */ }
  return { ok: true, arriba, enviado: ordenGeneral };
}

function estado() {
  return { arriba, guardado: recordadoDelDisco(), ajustes: leerAjustes() };
}

function montar(app, { log = console.log } = {}) {
  app.post('/camara/arriba', async (req, res) => {
    try {
      const r = await subir();
      log('[cenital] cámara arriba');
      res.json(r);
    } catch (error) {
      log(`[cenital] no pude subir la cámara: ${error.message}`);
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  app.post('/camara/bajar', async (req, res) => {
    try {
      const r = await bajar();
      log('[cenital] cámara devuelta');
      res.json(r);
    } catch (error) {
      log(`[cenital] no pude devolver la cámara: ${error.message}`);
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  // Volcado completo de lo que dice el juego: sirve para ver los nombres
  // exactos de los campos de cámara que acepta esta versión.
  app.get('/camara/leer', async (req, res) => {
    try {
      const estadoJuego = await leerEstadoDelJuego();
      res.json({ ok: true, juego: estadoJuego });
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  // Página para ajustar la cámara con deslizadores, viendo el resultado en vivo.
  app.get('/camara/ajustar', (req, res) => {
    res.sendFile(path.join(__dirname, 'ajustar-camara.html'));
  });

  // Manda al juego exactamente lo que le llegue, sin tocar nada.
  // Sirve para la prueba automática: así se compara qué forma de mandarlo funciona.
  app.post('/camara/bruto', async (req, res) => {
    try {
      const r = await escribir(req.body || {});
      res.json({ ok: true, estado: r.estado, datos: r.datos });
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  // Manda una secuencia tal cual (para la prueba automática de la página).
  app.post('/camara/secuencia', async (req, res) => {
    try {
      const r = await pedirSecuencia(req.body || {});
      res.json({ ok: r.estado >= 200 && r.estado < 300, estado: r.estado, datos: r.datos });
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  /* Prueba, contra el juego de verdad, que nombres acepta para apagar cosas.
     Se abre en el navegador y devuelve lo que contesto a cada uno. */
  /* Todo lo que el juego publica sobre lo que esta viendose. Sirve para
     comparar antes y despues. */
  app.get('/camara/hud', async (req, res) => {
    try {
      const e = await leerEstadoDelJuego();
      const soloBooleanos = {};
      for (const [k, v] of Object.entries(e || {})) {
        if (typeof v === 'boolean') soloBooleanos[k] = v;
      }
      res.json({ ok: true, interruptores: soloBooleanos });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/camara/probar-interfaz', async (req, res) => {
    const candidatos = [
      ['healthBarChampions', { healthBarChampions: false }],
      ['floatingText', { floatingText: false }],
      ['interfaceAll', { interfaceAll: false }],
      ['healthBarMinions', { healthBarMinions: false }],
      ['interfaceMinimap', { interfaceMinimap: false }]
    ];
    const salida = [];
    for (const [nombre, cuerpo] of candidatos) {
      const linea = { prueba: nombre };
      /* Se deja todo encendido antes de cada prueba, para que se vea de cual
         es el cambio de verdad. */
      const encendido = { interfaceAll: true };
      for (const c of candidatos) encendido[c[0]] = true;
      await pedirJuego('POST', encendido).catch(() => {});
      try {
        const r = await pedirJuego('POST', cuerpo);
        linea.estado = r.estado;
        const tras = await leerEstadoDelJuego().catch(() => null);
        linea.valorEnElJuego = tras ? tras[nombre] : null;
      } catch (e) {
        linea.error = e.message;
      }
      salida.push(linea);
    }
    await pedirJuego('POST', { interfaceAll: true }).catch(() => {});
    res.json({
      ok: true,
      nota: 'valorEnElJuego=false quiere decir que el juego SI lo apago',
      pruebas: salida
    });
  });

  app.get('/camara/estado', (req, res) => {
    res.json({ ok: true, ...estado() });
  });

  // Ajuste fino sin tocar archivos:
  //   POST /camara/probar  {"y":18000,"rx":-90,"fov":45}
  app.post('/camara/probar', async (req, res) => {
    try {
      const cuerpo = req.body || {};
      const ajustes = leerAjustes();
      const posicion = {
        x: Number(cuerpo.x ?? ajustes.posicion.x),
        y: Number(cuerpo.y ?? ajustes.posicion.y),
        z: Number(cuerpo.z ?? ajustes.posicion.z)
      };
      const rotacion = {
        x: Number(cuerpo.rx ?? ajustes.rotacion.x),
        y: Number(cuerpo.ry ?? ajustes.rotacion.y),
        z: Number(cuerpo.rz ?? ajustes.rotacion.z)
      };
      if (!arriba) {
        try { recordar(await leerEstadoDelJuego()); } catch { recordar(recordadoDelDisco()); }
      }
      const secuencia = secuenciaDeCamara({
        ...ajustes,
        posicion,
        rotacion,
        campoVista: Number(cuerpo.fov ?? ajustes.campoVista)
      });
      try { await pedirSecuencia({}); } catch { /* da igual */ }
      const r = await pedirSecuencia(secuencia);
      arriba = true;
      res.json({ ok: true, enviado: { posicion, rotacion, fov: Number(cuerpo.fov ?? ajustes.campoVista) }, juego: r });
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  log('[cenital] rutas listas: /camara/ajustar (página), /camara/arriba, /camara/bajar, /camara/leer, /camara/probar, /camara/bruto');
}

module.exports = { montar, subir, bajar, estado };
