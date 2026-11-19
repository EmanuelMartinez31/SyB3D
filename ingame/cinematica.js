// Cinematica de inicio integrada en el Ingame.
// Se dispara sola al segundo configurado de la partida, sin ningun .bat.
//
// No toca la interfaz: de eso ya se encarga autoHideNativeHud del servidor.
// Solo hace tres cosas:
//   1. Enviar la secuencia de camara al juego (/replay/sequence).
//   2. Pulsar la tecla de barras de vida del juego para ocultarlas.
//   3. Al terminar: soltar la secuencia, devolver las barras y poner la
//      camara dirigida.
//
// Todo es defensivo: si el juego no responde, se avisa por consola y el
// servidor sigue funcionando igual.
//
// ---------------------------------------------------------------------------
// r88 · LA CINEMATICA POR LA CALLE CENTRAL DE ABISMO
// La secuencia de siempre (secuencia-inicio.json) cruza la Grieta en diagonal y
// a mitad de camino gira la camara 180 grados: en Abismo de los Lamentos eso no
// sirve. Ahora, si la partida es de Abismo (mapa 12), se usa otra secuencia,
// secuencia-inicio-calle.json, que va de la fuente azul a la fuente roja en
// linea recta por la calle y sin dar la vuelta nunca.
//
// Las coordenadas de las dos fuentes no estan escritas a mano: se leen del
// propio juego (las posiciones de los jugadores al empezar) con
// cine/calle-central.js, y se guardan en cine/bases-abismo.json. Si el juego no
// contesta, se usa lo guardado y, si tampoco hay nada, se cae a la secuencia de
// siempre para no dejar el directo sin nada.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
// Si el archivo de la calle no esta (copia a medias), el servidor tiene que
// arrancar igual: se avisa y se sigue con la secuencia de siempre.
let calle = null;
try {
  calle = require('./cine/calle-central');
} catch (error) {
  console.log(`[cinematica] Falta ingame/cine/calle-central.js (${error.message}); la cinematica va con la secuencia de siempre`);
}

const CINE_DIR = path.join(__dirname, 'cine');
const CONFIG_PATH = path.join(CINE_DIR, 'cinematica.json');
const TECLA_PS1 = path.join(CINE_DIR, 'tecla.ps1');

const DEFAULTS = {
  activa: true,
  inicioSegundo: 3,          // segundo de partida en el que arranca
  ventanaSegundos: 20,       // solo automatico si estamos dentro de este margen
  ocultarBarras: true,       // pulsar la tecla de barras al empezar y al acabar
  volverDirigida: true,      // pulsar D al terminar
  secuencia: 'secuencia-inicio.json',
  // r88 · calle central de Abismo
  usarCalleCentral: true,    // en Abismo, usar la secuencia de la calle
  secuenciaCalle: 'secuencia-inicio-calle.json',
  calle: {},                 // ajustes finos (ver cine/calle-central.js)
  // r96 · en el 1 contra 1 de Abismo, recorrido en dos tramos: fuente azul →
  // torre azul mas cercana al centro, corte sobre la fuente roja, fuente roja
  // → centro y se aleja hacia arriba. En 2 contra 2 se queda el de una tirada.
  usarRelevo1v1: true,
  relevo: {}                 // ajustes finos del recorrido en dos tramos
};

function leerConfig() {
  try {
    const texto = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(texto) };
  } catch (error) {
    console.log(`[cinematica] No puedo leer ${CONFIG_PATH} (${error.message}); uso los valores por defecto`);
    return { ...DEFAULTS };
  }
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

// --- peticiones al juego (certificado propio, solo 127.0.0.1:2999) ----------
function pedirJuego(ruta, cuerpo) {
  return new Promise((resolve, reject) => {
    const body = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const peticion = https.request({
      hostname: '127.0.0.1',
      port: 2999,
      path: ruta,
      method: 'POST',
      rejectUnauthorized: false,
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      } : {}
    }, respuesta => {
      const trozos = [];
      respuesta.on('data', t => trozos.push(t));
      respuesta.on('end', () => resolve({
        estado: respuesta.statusCode || 0,
        texto: Buffer.concat(trozos).toString('utf8')
      }));
    });
    peticion.setTimeout(4000, () => peticion.destroy(new Error('el juego no respondio a tiempo')));
    peticion.on('error', reject);
    if (body) peticion.write(body);
    peticion.end();
  });
}

// --- teclado del juego (una sola pulsacion, con foco forzado) --------------
function pulsarTecla(accion) {
  return new Promise(resolve => {
    let salida = '';
    let proceso;
    try {
      proceso = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', TECLA_PS1, '-Accion', accion
      ], { windowsHide: true });
    } catch (error) {
      console.log(`[cinematica] No pude abrir PowerShell: ${error.message}`);
      resolve('');
      return;
    }
    const limite = setTimeout(() => {
      try { proceso.kill(); } catch { /* nada */ }
      resolve(salida);
    }, 12000);
    proceso.stdout.on('data', trozo => { salida += trozo.toString(); });
    proceso.stderr.on('data', trozo => { salida += trozo.toString(); });
    proceso.on('close', () => { clearTimeout(limite); resolve(salida); });
    proceso.on('error', error => {
      clearTimeout(limite);
      console.log(`[cinematica] Error al pulsar la tecla ${accion}: ${error.message}`);
      resolve('');
    });
  });
}

module.exports = function crearCinematica({ app, log = console.log } = {}) {
  const aviso = texto => log(`[cinematica] ${texto}`);

  // r96d · El puerto de este servidor, sin tocar server.js. Se apunta del primer
  // paquete que pase y sirve para preguntarle al panel en que modo esta. Tiene
  // que ir aqui arriba: en server.js esta funcion se llama antes de declarar
  // /sensor, asi que el middleware queda antes en la pila y ve todas las
  // peticiones (si se pusiera al final no veria ninguna).
  let puertoPropio = null;
  if (app && typeof app.use === 'function') {
    app.use((req, res, next) => {
      if (puertoPropio === null && req.socket && req.socket.localPort) puertoPropio = req.socket.localPort;
      next();
    });
  }

  let config = leerConfig();
  let plantilla = null;          // secuencia original (0..duracion)
  let duracion = 0;
  let plantillaCalle = null;     // r88 · secuencia por la calle de Abismo
  let duracionCalle = 0;
  let usando = 'normal';         // normal | calle | (para el /cinematica de control)
  let esAbismoAhora = null;      // se pregunta una vez por partida
  let torresPartida = null;      // r96 · torres de la partida, para la torre del corte
  let heroesPartida = null;      // r96 · cuantos campeones hay (2 = 1 contra 1)
  let ultimoGameInfo = null;     // r96b · el ultimo GameInfo, para sacar las bases sin el juego
  // r96e · donde aparece cada campeon (el spawn, que esta detras del nexo). Se
  // apunta al principio de la partida, que es cuando estan en la fuente.
  let spawnAzul = null;
  let spawnRojo = null;
  let modoPanel = null;          // r96c · lo que dice el panel: '1v1' | '2v2' | '5v5'
  let modoCache = { valor: null, cuando: 0 };
  // r96b · lo que ha pasado en la ultima cinematica, para poder mirarlo despues.
  let diagnostico = { cuando: null, mapa: null, modo: null, abismo: null, heroes: null,
    bases: null, torres: null, secuencia: null, motivo: null };
  let estado = 'en espera';      // en espera | volando | terminada | no disponible
  let lanzadaEn = null;
  let finEnSegundo = null;
  let partidaActual = null;
  let ultimaPartidaLanzada = null;
  let ultimaMuestraGameTime = null;
  const MAX_INTENTOS = 3;        // intentos automaticos como mucho
  let intentos = 0;              // reintentos si el juego aun no responde
  let cola = Promise.resolve();  // evita dos lanzamientos a la vez

  // Lee una secuencia del disco. Devuelve { datos, duracion } o null.
  function leerSecuencia(nombre) {
    const ruta = path.join(CINE_DIR, nombre);
    try {
      const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      const posiciones = datos.cameraPosition || [];
      if (!posiciones.length) throw new Error('la secuencia no tiene fotogramas');
      return { datos, duracion: Number(posiciones[posiciones.length - 1].time) || 0 };
    } catch (error) {
      return null;
    }
  }

  function cargarSecuencia() {
    const principal = leerSecuencia(config.secuencia);
    if (!principal) {
      aviso(`No pude cargar la secuencia ${config.secuencia}`);
      plantilla = null;
      duracion = 0;
    } else {
      plantilla = principal.datos;
      duracion = principal.duracion;
      aviso(`Secuencia cargada: ${plantilla.cameraPosition.length} fotogramas, ${duracion.toFixed(1)} s`);
    }
    // La de la calle es opcional: si no esta, se arma cuando haga falta.
    const deCalle = leerSecuencia(config.secuenciaCalle);
    if (deCalle) {
      plantillaCalle = deCalle.datos;
      duracionCalle = deCalle.duracion;
      aviso(`Secuencia de la calle central cargada: ${plantillaCalle.cameraPosition.length} fotogramas, ${duracionCalle.toFixed(1)} s`);
    } else {
      plantillaCalle = null;
      duracionCalle = 0;
    }
    return !!plantilla;
  }

  function guardarSecuenciaCalle(datos) {
    try {
      fs.writeFileSync(path.join(CINE_DIR, config.secuenciaCalle), JSON.stringify(datos));
      return true;
    } catch (error) {
      aviso(`No pude guardar ${config.secuenciaCalle} (${error.message})`);
      return false;
    }
  }

  // r88 · Arma la secuencia de la calle con las posiciones reales del juego.
  // Si el juego no las da, prueba con las que se guardaron la ultima vez.
  async function armarCalle(partidaConocida) {
    if (!calle) { aviso('No esta cine/calle-central.js: no puedo armar la secuencia de la calle'); return false; }
    // r96b · tres fuentes, en este orden: el juego, el GameInfo del sensor y lo
    // que quedo guardado. Antes solo habia dos (juego y guardado) y, si el juego
    // no contestaba a tiempo, la cinematica caia a la de la Grieta sin avisar.
    let bases = null;
    let origen = null;
    let motivo = null;
    if (typeof calle.leerBasesDetallado === 'function') {
      const detalle = await calle.leerBasesDetallado(partidaConocida || null).catch(error => ({ bases: null, motivo: `error al preguntar al juego: ${error.message}` }));
      bases = detalle.bases;
      motivo = detalle.motivo;
      if (bases) origen = 'juego';
    } else {
      try { bases = await calle.leerBases(partidaConocida || null); } catch { bases = null; }
      if (bases) origen = 'juego';
    }
    if (bases) {
      calle.guardarBases(bases);
      aviso(`Bases leidas del juego: azul (${bases.azul.x.toFixed(0)}, ${bases.azul.z.toFixed(0)}) y rojo (${bases.rojo.x.toFixed(0)}, ${bases.rojo.z.toFixed(0)}); calle de ${bases.distancia.toFixed(0)} unidades`);
    }
    if (!bases && typeof calle.basesDelGameInfo === 'function') {
      const detalle = calle.basesDelGameInfo(ultimoGameInfo);
      if (detalle.bases) {
        bases = detalle.bases;
        origen = 'GameInfo';
        aviso(`El juego no dio las fuentes; las saco del GameInfo: calle de ${bases.distancia.toFixed(0)} unidades (${motivo || 'sin dato del juego'})`);
      } else {
        motivo = `${motivo || 'el juego no contesto'}; y del GameInfo tampoco: ${detalle.motivo}`;
      }
    }
    if (!bases) {
      const guardadas = calle.basesGuardadas();
      if (guardadas) {
        bases = guardadas;
        origen = 'guardadas';
        aviso('No pude leer las bases del juego; uso las guardadas en cine/bases-abismo.json');
      }
    }
    if (!bases) {
      aviso(`No tengo las coordenadas de las fuentes de Abismo (${motivo || 'sin datos'}): se queda la secuencia de siempre`);
      diagnostico.motivo = `sin bases: ${motivo || 'sin datos'}`;
      diagnostico.bases = null;
      return false;
    }
    diagnostico.bases = { origen, distancia: Number(bases.distancia.toFixed(0)) };
    diagnostico.motivo = null;
    // r96 · en el 1 contra 1 se arma el recorrido en dos tramos (con corte). Si
    // algo falta, se cae al de una tirada, que sigue existiendo igual.
    // r96c · el recorrido en dos tramos es el del 1 contra 1. Con el panel
    // mandando: 1 vs 1 → dos tramos; 2 vs 2 → calle de una tirada. Si no hay
    // modo (server sin parchear), se decide por el numero de campeones.
    const quiereRelevo = modoPanel ? modoPanel === '1v1' : heroesPartida === 2;
    if (config.usarRelevo1v1 && quiereRelevo) {
      const relevo = calle.construirSecuenciaRelevo(bases, torresPartida, config.relevo || {}, plantilla,
        { azul: spawnAzul, rojo: spawnRojo });
      if (relevo) {
        plantillaCalle = relevo.secuencia;
        duracionCalle = relevo.duracion;
        guardarSecuenciaCalle(relevo.secuencia);
        aviso(`Recorrido en dos tramos armado: ${relevo.fotogramas} fotogramas, ${relevo.duracion} s; ` +
          `corte en el segundo ${relevo.corteEn} sobre ${relevo.desdeSpawn.rojo ? 'el campeon rojo' : 'la fuente roja'}` +
          '; los dos tramos llegan al centro del mapa' +
          `; arranca ${relevo.desdeSpawn.azul ? 'donde aparece el campeon azul' : 'en la fuente azul'}`);
        return 'relevo';
      }
      aviso('No pude armar el recorrido en dos tramos; se queda el de una tirada');
    }
    const armada = calle.construirSecuencia(bases, config.calle || {}, plantilla);
    if (!armada) return false;
    plantillaCalle = armada.secuencia;
    duracionCalle = armada.duracion;
    guardarSecuenciaCalle(armada.secuencia);
    aviso(`Secuencia de la calle central armada: ${armada.fotogramas} fotogramas, ${armada.duracion} s, rumbo fijo ${armada.yaw.toFixed(1)} grados`);
    return 'calle';
  }

  // r88 · Cual se manda: la de la calle si la partida es de Abismo.
  // r89 · Devuelve 'calle', 'normal' o 'desconocido'. 'desconocido' es que el
  // juego no contesto: no se manda nada y se vuelve a preguntar, para no
  // quedarse con la cinematica de la Grieta sin saber el mapa.
  async function elegirSecuencia() {
    usando = 'normal';
    if (!calle) { diagnostico.motivo = 'no esta ingame/cine/calle-central.js'; return 'normal'; }
    if (!config.usarCalleCentral) { diagnostico.motivo = 'usarCalleCentral esta en false en cine/cinematica.json'; return 'normal'; }
    // r96d · el modo se pregunta al panel en el momento de lanzar; si el
    // server.js ya lo manda por parametro, ese manda.
    const modoPedido = modoPanel || await modoDelPanel();
    if (modoPedido && !modoPanel) modoPanel = modoPedido;
    diagnostico.modoPanel = modoPanel;

    // r96c · Manda el panel de control.
    //   5 vs 5            → la secuencia de siempre (Grieta)
    //   1 vs 1 y 2 vs 2   → la calle de Abismo (y en 1 vs 1, el recorrido en dos
    //                       tramos). No se pregunta el mapa: si el panel dice
    //                       1 contra 1, es Abismo aunque sea una partida de
    //                       prueba con diez jugadores.
    if (modoPanel === '5v5') {
      esAbismoAhora = false;
      diagnostico.motivo = 'el panel esta en 5 vs 5: cinematica de la Grieta';
      return 'normal';
    }
    if (modoPanel === '1v1' || modoPanel === '2v2') {
      esAbismoAhora = true;
      const armado = await armarCalle(null);
      if (!armado) {
        diagnostico.motivo = `el panel esta en ${modoPanel} pero no pude armar la calle de Abismo`;
        aviso('El panel dice Abismo pero no pude armar la calle: se queda la secuencia de siempre');
        return 'normal';
      }
      usando = armado;
      return armado;
    }

    // Sin modo en el panel (server.js sin el parche nuevo): se mira el mapa.
    let partida = null;
    if (esAbismoAhora === null) {
      try { partida = await calle.leerPartida(); } catch { partida = null; }
      if (!partida) {
        // r96b · si no se sabe el mapa pero hay dos campeones, es un 1 contra
        // 1, y el 1 contra 1 se juega en Abismo: se da por Abismo en vez de
        // rendirse y mandar la cinematica de la Grieta.
        if (heroesPartida === 2) {
          esAbismoAhora = true;
          aviso('El juego no dijo el mapa, pero hay 2 campeones: es un 1 contra 1, se da por Abismo');
          diagnostico.mapa = 'desconocido';
          diagnostico.motivo = 'el juego no dio el mapa; se asumio Abismo por los 2 campeones';
        } else {
          aviso('El juego no dijo de que mapa es la partida; lo pregunto otra vez antes de mandar la cinematica');
          return 'desconocido';
        }
      } else {
        esAbismoAhora = !!partida.abismo;
        diagnostico.mapa = partida.mapa;
        diagnostico.modo = partida.modo;
        aviso(`Mapa de la partida: ${partida.mapa} (${partida.modo}) → ${esAbismoAhora ? 'Abismo, cinematica por la calle central' : 'no es Abismo, cinematica de siempre'}`);
      }
    }
    if (!esAbismoAhora) return 'normal';
    // r89 · En Abismo la calle se arma siempre con las bases que da el juego en
    // ese momento; solo si no las da se usa la que quedo guardada. Asi no se
    // repite una calle vieja armada con coordenadas de otro momento.
    const armado = await armarCalle(partida);
    if (!armado) {
      aviso('Es Abismo pero no tengo las dos fuentes: se queda la secuencia de siempre');
      return 'normal';
    }
    usando = armado;
    return armado;
  }

  // r96d · Pregunta al panel en que modo esta (1 vs 1, 2 vs 2 o 5 vs 5).
  // Se pregunta al propio servidor por HTTP, sin tocar server.js: el panel vive
  // en la misma aplicacion, asi que el puerto es el de la peticion que acaba de
  // llegar. Se guarda un segundo en cache para no preguntar en cada GameInfo.
  function pedirJson(url) {
    return new Promise((resolve, reject) => {
      const peticion = http.request(url, { method: 'GET' }, respuesta => {
        const trozos = [];
        respuesta.on('data', t => trozos.push(t));
        respuesta.on('end', () => {
          if (respuesta.statusCode !== 200) { reject(new Error(`HTTP ${respuesta.statusCode}`)); return; }
          try { resolve(JSON.parse(Buffer.concat(trozos).toString('utf8'))); }
          catch { reject(new Error('la respuesta no es JSON')); }
        });
      });
      peticion.setTimeout(800, () => peticion.destroy(new Error('el panel no respondio a tiempo')));
      peticion.on('error', reject);
      peticion.end();
    });
  }

  async function modoDelPanel() {
    const ahora = Date.now();
    if (ahora - modoCache.cuando < 1000) return modoCache.valor;
    const origen = process.env.SYB_DRAFT_URL || (puertoPropio ? `http://127.0.0.1:${puertoPropio}` : null);
    if (!origen) return modoCache.valor;
    let modo = null;
    try {
      const datos = await pedirJson(`${origen}/series-state`);
      const bruto = String(datos?.info?.modo || '').toLowerCase();
      if (bruto) modo = bruto;
    } catch { modo = modoCache.valor; }
    modoCache = { valor: modo, cuando: ahora };
    if (modo) modoPanel = modo;
    return modo;
  }

  // Copia la secuencia desplazando todos los tiempos al segundo indicado.
  function secuenciaDesplazada(base, inicio) {
    const copia = JSON.parse(JSON.stringify(base));
    for (const clave of Object.keys(copia)) {
      const lista = copia[clave];
      if (!Array.isArray(lista)) continue;
      for (const fotograma of lista) {
        if (fotograma && typeof fotograma.time === 'number') {
          fotograma.time = Number((fotograma.time + inicio).toFixed(3));
        }
      }
    }
    return copia;
  }

  // r96b · Deja escrito, en texto llano, que ha pasado con la ultima cinematica.
  // Asi, si algo sale mal, hay un archivo que mirar en vez de adivinar.
  function escribirDiagnostico() {
    const d = diagnostico;
    const lineas = [
      'ULTIMA CINEMATICA',
      `cuando: ${d.cuando || '-'}`,
      `mapa: ${d.mapa ?? '-'} (${d.modo ?? '-'})`,
      `abismo: ${d.abismo === null ? '-' : d.abismo ? 'si' : 'no'}`,
      `modo en el panel: ${d.modoPanel || '-'}`,
      `campeones: ${d.heroes ?? '-'}`,
      `torres en el GameInfo: ${d.torres ?? '-'}`,
      `bases: ${d.bases ? `${d.bases.origen}, calle de ${d.bases.distancia} unidades` : 'no se pudieron leer'}`,
      `spawn del campeon: azul ${d.spawn?.azul ? 'si' : 'no'}, rojo ${d.spawn?.rojo ? 'si' : 'no'}`,
      `secuencia usada: ${d.secuencia || '-'}`,
      `duracion: ${d.duracion ?? '-'} s`,
      `arranca en el segundo: ${d.inicio ?? '-'}`,
      `motivo / avisos: ${d.motivo || 'ninguno'}`,
      '',
      'relevo = recorrido nuevo en dos tramos (solo 1 contra 1)',
      'calle  = calle de una tirada (Abismo, r89)',
      'normal = secuencia de siempre (la de la Grieta)'
    ];
    try {
      fs.writeFileSync(path.join(CINE_DIR, 'ultima-cinematica.txt'), lineas.join('\r\n'));
    } catch { /* no es grave */ }
  }

  async function lanzar(motivo, reintentable = false) {
    if (!plantilla) {
      aviso('No hay secuencia que enviar');
      return false;
    }
    if (estado === 'volando') {
      aviso('Ya esta volando; no se lanza otra vez');
      return false;
    }

    // El juego solo entiende segundos absolutos: se parte del ultimo conocido.
    const t = numero(ultimaMuestraGameTime);
    if (t === null) {
      aviso('Todavia no se sabe el segundo de partida');
      return false;
    }

    // r88 · se elige la secuencia justo antes de enviarla (Abismo → la calle).
    // r89 · si el juego no contesto de que mapa es, no se manda nada y se deja
    // para el siguiente intento automatico (hasta MAX_INTENTOS). En el ultimo
    // intento, y siempre que se lanze a mano, se manda la de siempre para no
    // quedarse sin cinematica.
    const eleccion = await elegirSecuencia();
    if (eleccion === 'desconocido' && reintentable && intentos < MAX_INTENTOS) {
      aviso('Sin saber el mapa todavia; se reintenta en el proximo aviso del juego');
      estado = 'en espera';
      return false;
    }
    const usaCalle = usando !== 'normal' && !!plantillaCalle;
    const base = usaCalle ? plantillaCalle : plantilla;
    const dur = usaCalle ? duracionCalle : duracion;

    const inicio = t;
    const datos = secuenciaDesplazada(base, inicio);
    try {
      const respuesta = await pedirJuego('/replay/sequence', datos);
      if (respuesta.estado < 200 || respuesta.estado >= 300) {
        aviso(`El juego rechazo la secuencia (HTTP ${respuesta.estado}) ${motivo || ''}`);
        estado = 'en espera';       // se reintentara mientras estemos en la ventana
        return false;
      }
    } catch (error) {
      aviso(`El juego no responde todavia: ${error.message} ${motivo || ''}`);
      estado = 'en espera';
      return false;
    }

    estado = 'volando';
    intentos = 0;
    diagnostico.cuando = new Date().toISOString();
    diagnostico.heroes = heroesPartida;
    diagnostico.torres = Array.isArray(torresPartida) ? torresPartida.length : 0;
    diagnostico.abismo = esAbismoAhora;
    diagnostico.secuencia = usando;
    diagnostico.duracion = dur;
    diagnostico.spawn = { azul: !!spawnAzul, rojo: !!spawnRojo };
    diagnostico.inicio = inicio;
    escribirDiagnostico();
    ultimaPartidaLanzada = partidaActual;
    lanzadaEn = inicio;
    finEnSegundo = inicio + dur;
    const etiqueta = usando === 'relevo' ? 'en dos tramos (1 contra 1) ' : usando === 'calle' ? 'de la calle central ' : '';
    aviso(`Cinematica ${etiqueta}lanzada en el segundo ${inicio.toFixed(1)} y termina en el ${finEnSegundo.toFixed(1)} ${motivo || ''}`);

    if (config.ocultarBarras) {
      pulsarTecla('barras').then(salida => {
        if (salida.trim()) aviso(`Barras de vida: ${salida.trim()}`);
      });
    }
    return true;
  }

  async function terminar(motivo) {
    if (estado !== 'volando') return false;
    estado = 'terminada';

    try {
      const respuesta = await pedirJuego('/replay/sequence', {});
      if (respuesta.estado < 200 || respuesta.estado >= 300) {
        aviso(`Aviso: el juego respondio HTTP ${respuesta.estado} al soltar la camara`);
      }
    } catch (error) {
      aviso(`Aviso: no pude soltar la camara (${error.message})`);
    }

    if (config.ocultarBarras) {
      await pulsarTecla('barras');
    }
    if (config.volverDirigida) {
      await pulsarTecla('dirigida');
    }
    aviso(`Cinematica terminada en el segundo ${(finEnSegundo ?? 0).toFixed(1)} ${motivo || ''}`);
    return true;
  }

  function reiniciarPartida(gameId, gameTime) {
    partidaActual = gameId;
    estado = 'en espera';
    lanzadaEn = null;
    finEnSegundo = null;
    intentos = 0;
    ultimaMuestraGameTime = gameTime;
    esAbismoAhora = null;      // r88 · el mapa se vuelve a mirar en cada partida
    torresPartida = null;      // r96 · se vuelven a leer en cada partida
    heroesPartida = null;
    spawnAzul = null;
    spawnRojo = null;
    diagnostico = { cuando: null, mapa: null, modo: null, abismo: null, heroes: null,
      bases: null, torres: null, secuencia: null, motivo: null };
    usando = 'normal';
  }

  // Se llama con cada GameInfo del sensor.
  function actualizar(game, info = null) {
    if (!game || typeof game !== 'object') return;
    // r96c · el panel manda: 1 contra 1 y 2 contra 2 van a Abismo, 5 contra 5 a
    // la Grieta. Es lo que se eligio en el draft, no lo que diga el mapa ni
    // cuantos jugadores haya (se puede probar la cinematica del 1 contra 1 en
    // una partida de ARAM normal).
    if (info && typeof info === 'object') {
      const modo = String(info.modo || '').toLowerCase();
      if (modo) modoPanel = modo;
    }
    const gameTime = numero(game.GameTime ?? game.gameTime);
    if (gameTime === null || gameTime < 0) return;
    ultimaMuestraGameTime = gameTime;

    // r96 · las torres y el numero de campeones llegan en el propio GameInfo.
    ultimoGameInfo = game;
    // r96e · el sitio de aparicion: la posicion de cada campeon en los primeros
    // segundos, que es cuando sigue en la fuente.
    if (gameTime <= 10) {
      for (const heroe of Array.isArray(game.Heroes) ? game.Heroes : []) {
        const equipo = Number(heroe?.Info?.Team);
        const posicion = heroe?.Info?.Position;
        if (!posicion || !Number.isFinite(Number(posicion.x)) || !Number.isFinite(Number(posicion.z))) continue;
        const punto = { x: Number(posicion.x), y: Number(posicion.y || 0), z: Number(posicion.z) };
        if (equipo === 1 && !spawnAzul) spawnAzul = punto;
        if (equipo === 2 && !spawnRojo) spawnRojo = punto;
      }
    }
    if (Array.isArray(game.Turrets) && game.Turrets.length) torresPartida = game.Turrets;
    if (Array.isArray(game.Heroes)) heroesPartida = game.Heroes.length;

    const gameId = String(game.GameId ?? game.gameId ?? 'sin-id');
    if (gameId !== partidaActual) {
      const nueva = partidaActual !== null;
      reiniciarPartida(gameId, gameTime);
      if (nueva) aviso(`Partida nueva detectada (${gameId}); cinematica armada`);
    }

    if (!config.activa) return;

    // Fin por reloj de partida: si se pausa, la cinematica tambien espera.
    if (estado === 'volando' && finEnSegundo !== null && gameTime >= finEnSegundo - 0.05) {
      cola = cola.then(() => terminar('(por reloj de partida)')).catch(() => {});
      return;
    }

    if (estado !== 'en espera') return;
    if (ultimaPartidaLanzada === gameId) return;
    if (gameTime < config.inicioSegundo) return;
    if (gameTime > config.inicioSegundo + config.ventanaSegundos) return;   // llegamos tarde
    if (intentos >= MAX_INTENTOS) return;                                  // ya lo intentamos

    intentos += 1;
    cola = cola.then(() => lanzar(intentos === 1 ? '(automatica)' : `(reintento ${intentos - 1})`, true))
               .catch(() => {});
  }

  // --- rutas para poder probarla sin .bat -----------------------------------
  // Se registran en iniciar(): en server.js el express.json() se declara mas
  // abajo, y si las rutas fueran antes los POST llegarian sin cuerpo.
  let rutasPuestas = false;
  function registrarRutas() {
    if (rutasPuestas) return;
    rutasPuestas = true;
    if (!app || typeof app.get !== 'function') return;

    app.get('/cinematica', (req, res) => {
      res.json({
        activa: config.activa,
        inicioSegundo: config.inicioSegundo,
        duracion,
        duracionCalle,
        secuenciaEnUso: usando,
        abismo: esAbismoAhora,
        estado,
        lanzadaEn,
        finEnSegundo,
        partida: partidaActual,
        config
      });
    });

    // r88 · para rearmar la secuencia de la calle a mano (por ejemplo si moviste
    // los ajustes y quieres verlo sin esperar a la siguiente partida).
    // r96b · todo lo de la ultima cinematica en JSON, para mirarlo sin consola.
    app.get('/cinematica/diagnostico', (req, res) => {
      res.json({
        ...diagnostico,
        heroesAhora: heroesPartida,
        torresAhora: Array.isArray(torresPartida) ? torresPartida.length : 0,
        archivo: path.join(CINE_DIR, 'ultima-cinematica.txt'),
        calleDisponible: !!calle,
        usarCalleCentral: config.usarCalleCentral,
        usarRelevo1v1: config.usarRelevo1v1,
        config
      });
    });

    app.post('/cinematica/calle', async (req, res) => {
      plantillaCalle = null;
      const ok = await armarCalle();
      res.status(ok ? 200 : 409).json({ ok, duracionCalle, fotogramas: plantillaCalle ? plantillaCalle.cameraPosition.length : 0 });
    });

    app.post('/cinematica/lanzar', async (req, res) => {
      const ok = await lanzar('(manual)');
      res.status(ok ? 200 : 409).json({ ok, estado, secuenciaEnUso: usando, lanzadaEn, finEnSegundo });
    });

    app.post('/cinematica/soltar', async (req, res) => {
      if (estado !== 'volando') {
        // aunque no este volando, se deja la camara libre y las barras como estaban
        await pedirJuego('/replay/sequence', {}).catch(() => {});
        if (config.ocultarBarras) await pulsarTecla('barras');
        if (config.volverDirigida) await pulsarTecla('dirigida');
        estado = 'terminada';
        return res.json({ ok: true, estado });
      }
      const ok = await terminar('(manual)');
      res.json({ ok, estado });
    });

    app.post('/cinematica/config', (req, res) => {
      const cambios = req.body && typeof req.body === 'object' ? req.body : {};
      config = { ...config, ...cambios };
      try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      } catch (error) {
        aviso(`No pude guardar la configuracion (${error.message})`);
      }
      res.json({ ok: true, config });
    });
  }

  return {
    iniciar() {
      registrarRutas();
      if (!cargarSecuencia()) return;
      aviso(config.activa
        ? `Armada: arrancara sola en el segundo ${config.inicioSegundo} de cada partida` +
          (config.usarCalleCentral ? ' (en Abismo, por la calle central)' : '')
        : 'Desactivada en cinematica.json (activa: false)');
    },
    actualizar,
    lanzar,
    terminar,
    estado: () => ({ estado, lanzadaEn, finEnSegundo, duracion, duracionCalle, secuenciaEnUso: usando, modoPanel, puerto: puertoPropio })
  };
};
