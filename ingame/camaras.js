// Camaras de los jugadores en el Ingame.
//
// Guarda los enlaces de emision (uno por equipo y linea), los genera si no
// existen y los regenera cuando se pide desde el panel. El overlay y el panel
// piden la misma lista, asi que siempre coinciden.
//
//   GET  /camaras/enlaces?azul=NAME&rojo=NAME   -> los 10 enlaces
//   POST /camaras/regenerar  {azul, rojo}       -> enlaces nuevos
//
// Los enlaces son de VDO.Ninja: cada jugador abre el suyo y emite. El nombre
// del jugador NO va en el enlace (nadie tiene que escribir nada); el enlace ya
// esta atado a su equipo y a su linea.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, 'cine', 'camaras.json');

const LINEAS = ['top', 'jungle', 'mid', 'bot', 'support'];

const POR_DEFECTO = {
  activo: true,
  desdeSegundo: 30,
  cadaSegundos: 20,
  orden: LINEAS,
  // Parametros del enlace de vision (el del HUD).
  // NO poner "novideo": en VDO.Ninja cualquier valor --tambien novideo=0-- hace
  // que se descarte la pista de video y la camara se queda en negro.
  // "cover" llena la caja 198x196 recortando lo que sobra: sin el, el video
  // conserva su 16:9 y deja dos franjas negras arriba y abajo.
  ver: 'solo&cleanoutput&noaudio&codec=h264&quality=2&fps=30&cover',
  // Parametros del enlace de emision (el del jugador).
  emitir: 'quality=1&maxframerate=30&noaudio',
  equipos: {}
};

// Quita del enlace de vision cualquier parametro "novideo": si una version
// anterior lo dejo guardado en camaras.json, se corrige sola al arrancar.
function limpiarVer(texto) {
  return String(texto || '')
    .split('&')
    .filter(parte => parte && !/^novideo(=|$)/i.test(parte))
    .join('&');
}

// Si un camaras.json viejo se guardo sin "cover", se le pone: asi el video
// llena la caja 198x196 en vez de dejar franjas negras arriba y abajo.
function asegurarCover(texto) {
  const limpio = limpiarVer(texto);
  if (!limpio) return POR_DEFECTO.ver;
  return /(^|&)cover(=|&|$)/i.test(limpio) ? limpio : `${limpio}&cover`;
}

function leerConfig() {
  try {
    const texto = fs.readFileSync(CONFIG_PATH, 'utf8');
    const datos = JSON.parse(texto);
    const config = { ...POR_DEFECTO, ...datos, equipos: { ...(datos.equipos || {}) } };
    config.ver = asegurarCover(config.ver);
    return config;
  } catch {
    return { ...POR_DEFECTO, equipos: {} };
  }
}

function guardarConfig(config) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    const temporal = `${CONFIG_PATH}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify(config, null, 2));
    fs.renameSync(temporal, CONFIG_PATH);
    return true;
  } catch (error) {
    console.error(`[camaras] No se pudo guardar la configuracion: ${error.message}`);
    return false;
  }
}

// Identificador corto, en minusculas y sin caracteres que rompan una URL.
function nuevoId(equipo, linea) {
  const prefijo = String(equipo || 'eq')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 6) || 'eq';
  const corto = linea === 'jungle' ? 'jg' : linea === 'bot' ? 'adc' : linea === 'support' ? 'sup' : linea;
  const azar = crypto.randomBytes(3).toString('hex');
  return `${prefijo}${corto}${azar}`;
}

function idsDeEquipo(config, equipo) {
  const clave = String(equipo || '').trim();
  if (!clave) return null;
  const actual = config.equipos[clave];
  if (actual && LINEAS.every(linea => typeof actual[linea] === 'string' && actual[linea])) {
    return actual;
  }
  const nuevo = {};
  for (const linea of LINEAS) nuevo[linea] = nuevoId(clave, linea);
  config.equipos[clave] = nuevo;
  return nuevo;
}

function baseVdo(config) {
  return 'https://vdo.ninja/?';
}

function enlaceEmitir(config, id) {
  return `${baseVdo(config)}push=${id}${config.emitir ? `&${config.emitir}` : ''}`;
}

function enlaceVer(config, id) {
  const extra = limpiarVer(config.ver);
  return `${baseVdo(config)}view=${id}${extra ? `&${extra}` : ''}`;
}

// Devuelve lo que necesitan el HUD y el panel. Si los equipos son nuevos, sus
// enlaces se crean en ese momento y quedan guardados.
function enlaces(config, azul, rojo) {
  const salida = { lados: { blue: azul || null, red: rojo || null }, equipos: {} };
  let cambios = false;
  for (const equipo of [azul, rojo]) {
    if (!equipo) continue;
    const antes = config.equipos[String(equipo).trim()];
    const ids = idsDeEquipo(config, equipo);
    if (!antes || antes !== ids) cambios = true;
    salida.equipos[equipo] = {};
    for (const linea of LINEAS) {
      salida.equipos[equipo][linea] = {
        id: ids[linea],
        emitir: enlaceEmitir(config, ids[linea]),
        ver: enlaceVer(config, ids[linea])
      };
    }
  }
  if (cambios) guardarConfig(config);
  return salida;
}

function crearCamaras({ app, log = () => {} } = {}) {
  const estado = { config: leerConfig(), rutasPuestas: false };

  const cuantas = () => Object.keys(estado.config.equipos || {}).length;
  log(`[camaras] Configuracion cargada: ${cuantas()} equipo(s) con enlaces`);

  function responder(req, res) {
    const azul = String(req.query.azul || req.body?.azul || '').trim();
    const rojo = String(req.query.rojo || req.body?.rojo || '').trim();
    const datos = enlaces(estado.config, azul, rojo);
    res.json({
      activo: estado.config.activo !== false,
      desdeSegundo: Number(estado.config.desdeSegundo) || 30,
      cadaSegundos: Number(estado.config.cadaSegundos) || 20,
      orden: Array.isArray(estado.config.orden) && estado.config.orden.length
        ? estado.config.orden
        : LINEAS,
      ...datos
    });
  }

  // Las rutas se registran al arrancar el servidor: el cuerpo JSON (express.json)
  // se monta mas tarde que los modulos, y desde aqui ya esta disponible.
  function registrarRutas() {
    if (estado.rutasPuestas) return;
    estado.rutasPuestas = true;
    if (typeof app.get === 'function') {
      app.get('/camaras/enlaces', (req, res) => responder(req, res));
    }
    if (typeof app.post === 'function') {
      app.post('/camaras/regenerar', (req, res) => {
        const azul = String(req.body?.azul || '').trim();
        const rojo = String(req.body?.rojo || '').trim();
        const equipos = [azul, rojo].filter(Boolean);
        // Si no dicen los equipos, se regeneran todos los que haya guardados.
        const lista = equipos.length ? equipos : Object.keys(estado.config.equipos || {});
        for (const equipo of lista) delete estado.config.equipos[String(equipo).trim()];
        guardarConfig(estado.config);
        log(`[camaras] Enlaces regenerados (${lista.length} equipo(s))`);
        responder(req, res);
      });
      app.post('/camaras/equipos', (req, res) => {
        // Limpia equipos que ya no juegan (cambio de serie).
        const vivos = new Set([String(req.body?.azul || '').trim(), String(req.body?.rojo || '').trim()].filter(Boolean));
        if (vivos.size) {
          for (const equipo of Object.keys(estado.config.equipos)) {
            if (!vivos.has(equipo)) delete estado.config.equipos[equipo];
          }
          guardarConfig(estado.config);
        }
        responder(req, res);
      });
    }
    log('[camaras] Rutas listas: /camaras/enlaces, /camaras/regenerar');
  }

  return {
    registrarRutas,
    // Por si en algun momento se quiere consultar desde el servidor.
    enlaces: (azul, rojo) => enlaces(estado.config, azul, rojo)
  };
}

module.exports = crearCamaras;
module.exports.LINEAS = LINEAS;
