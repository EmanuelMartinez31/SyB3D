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

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const CINE_DIR = path.join(__dirname, 'cine');
const CONFIG_PATH = path.join(CINE_DIR, 'cinematica.json');
const TECLA_PS1 = path.join(CINE_DIR, 'tecla.ps1');

const DEFAULTS = {
  activa: true,
  inicioSegundo: 3,          // segundo de partida en el que arranca
  ventanaSegundos: 20,       // solo automatico si estamos dentro de este margen
  ocultarBarras: true,       // pulsar la tecla de barras al empezar y al acabar
  volverDirigida: true,      // pulsar D al terminar
  secuencia: 'secuencia-inicio.json'
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

  let config = leerConfig();
  let plantilla = null;          // secuencia original (0..duracion)
  let duracion = 0;
  let estado = 'en espera';      // en espera | volando | terminada | no disponible
  let lanzadaEn = null;
  let finEnSegundo = null;
  let partidaActual = null;
  let ultimaPartidaLanzada = null;
  let ultimaMuestraGameTime = null;
  let intentos = 0;              // reintentos si el juego aun no responde
  let cola = Promise.resolve();  // evita dos lanzamientos a la vez

  function cargarSecuencia() {
    const ruta = path.join(CINE_DIR, config.secuencia);
    try {
      const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      const posiciones = datos.cameraPosition || [];
      if (!posiciones.length) throw new Error('la secuencia no tiene fotogramas');
      plantilla = datos;
      duracion = Number(posiciones[posiciones.length - 1].time) || 0;
      aviso(`Secuencia cargada: ${posiciones.length} fotogramas, ${duracion.toFixed(1)} s`);
      return true;
    } catch (error) {
      aviso(`No pude cargar la secuencia (${error.message})`);
      plantilla = null;
      duracion = 0;
      return false;
    }
  }

  // Copia la secuencia desplazando todos los tiempos al segundo indicado.
  function secuenciaDesplazada(inicio) {
    const copia = JSON.parse(JSON.stringify(plantilla));
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

  async function lanzar(motivo) {
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

    const inicio = t;
    const datos = secuenciaDesplazada(inicio);
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
    ultimaPartidaLanzada = partidaActual;
    lanzadaEn = inicio;
    finEnSegundo = inicio + duracion;
    aviso(`Cinematica lanzada en el segundo ${inicio.toFixed(1)} y termina en el ${finEnSegundo.toFixed(1)} ${motivo || ''}`);

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
  }

  // Se llama con cada GameInfo del sensor.
  function actualizar(game) {
    if (!game || typeof game !== 'object') return;
    const gameTime = numero(game.GameTime ?? game.gameTime);
    if (gameTime === null || gameTime < 0) return;
    ultimaMuestraGameTime = gameTime;

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
    if (intentos >= 3) return;                                             // ya lo intentamos

    intentos += 1;
    cola = cola.then(() => lanzar(intentos === 1 ? '(automatica)' : `(reintento ${intentos - 1})`))
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
        estado,
        lanzadaEn,
        finEnSegundo,
        partida: partidaActual,
        config
      });
    });

    app.post('/cinematica/lanzar', async (req, res) => {
      const ok = await lanzar('(manual)');
      res.status(ok ? 200 : 409).json({ ok, estado, lanzadaEn, finEnSegundo });
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
        ? `Armada: arrancara sola en el segundo ${config.inicioSegundo} de cada partida`
        : 'Desactivada en cinematica.json (activa: false)');
    },
    actualizar,
    lanzar,
    terminar,
    estado: () => ({ estado, lanzadaEn, finEnSegundo, duracion })
  };
};
