// Repeticiones en el directo con el bufer de OBS.
//
// Un boton hace todo:
//   1. OBS guarda el bufer de repeticion (los ultimos N segundos).
//   2. Se carga ese archivo en la fuente de medios REPLAY.
//   3. Se adelanta el cursor para que empiece exactamente N segundos antes
//      del final: asi el mismo bufer de 120 s sirve para 10, 30, 60 y 90.
//   4. La repeticion se queda preparada y EN PAUSA, sin mostrarse. No aparece
//      sola: la ensenas tu con el ojito de la fuente REPLAY en OBS. En ese
//      mismo momento el juego se va a su espacio y el HUD desaparece (el
//      acomodo aprendido).
//   5. Al acabar (o al esconderla otra vez), todo vuelve a su sitio.
//
// No hace falta ffmpeg ni recortar archivos: el recorte es el cursor del
// reproductor de OBS (SetMediaInputCursor), que es instantaneo.
//
//   GET|POST /replay/10 | /30 | /60 | /90     lanza una repeticion
//   POST     /replay/parar                    corta y devuelve todo a su sitio
//   GET      /replay/estado                   que esta pasando ahora mismo
//   GET      /replay/highlights               mira que hay en la lista del VLC
//   GET|POST /replay/config                   ver o cambiar el guion
//
// Todo se configura en ingame/cine/replay.json, que se crea solo la primera vez.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const zlib = require('zlib');
const WebSocket = require('ws');

const CONFIG_PATH = path.join(__dirname, 'cine', 'replay.json');
// Lista de repeticiones guardadas, en orden. Es lo que se le pasa a la fuente
// VLC de HIGHLIGHTS. Vive al lado de replay.json para que no se pierda al
// reiniciar el servidor.
const HIGHLIGHTS_PATH = path.join(__dirname, 'cine', 'highlights.json');

const POR_DEFECTO = {
  // obs-websocket viene incluido en OBS. Se enciende en
  // Herramientas > Ajustes del servidor WebSocket.
  obs: { url: 'ws://127.0.0.1:4455', password: '' },

  // Escena donde estan el juego, el HUD y la repeticion (la misma).
  escena: 'Partida',

  // Fuente de medios donde se reproduce la repeticion.
  fuenteReplay: 'REPLAY',

  // Fuentes que se acomodan distinto durante la repeticion. El acomodo NO se
  // calcula: se aprende del que tu tengas puesto en OBS con /replay/aprender.
  fuentesEscena: ['Juego', 'HUD', 'REPLAY'],

  // Los dos acomodos aprendidos: { fuente: { transform, enabled } }.
  // Se rellenan con /replay/aprender/partida y /replay/aprender/replay.
  posiciones: { partida: {}, replay: {} },

  // EL SITIO EXACTO DEL JUEGO CUANDO SE HACE PEQUENO.
  // Estas tres cifras son fracciones del lienzo de OBS (0 = borde izquierdo o
  // de arriba, 1 = borde derecho o de abajo), medidas sobre la captura del
  // usuario. No se recorta nada: solo se encoge y se coloca.
  //   x      -> donde empieza por la izquierda     (0.0570)
  //   y      -> donde empieza por arriba           (0.5342)
  //   ancho  -> cuanto ocupa de ancho              (0.2389)
  // El alto sale solo, con la proporcion de la fuente (16:9): nunca se deforma.
  // En un lienzo de 1920x1080 esto es x=104, y=572, ancho=459 (alto 258).
  // (r54) Subido 5 px y 5 px mas a la izquierda, como se pidio: 104,572 en
  // vez de 109,577 sobre 1920x1080.
  cuadroJuego: { x: 0.0542, y: 0.5296, ancho: 0.2389 },

  // (r56) El marco del juego pequeno, al estilo del del minimapa del HUD: una
  // banda OSCURA y, pegada al juego, una linea fina clara. El del minimapa
  // lleva 26 px de banda + 7 px de linea; este es mucho mas recortado.
  //
  // Es UNA sola fuente (una imagen PNG que el programa se hace el mismo) con
  // el CENTRO TRANSPARENTE: solo se ve el borde. Asi, este por delante o por
  // detras del juego, NUNCA lo tapa, y no hay que pelearse con el orden de la
  // lista de fuentes.
  marco: {
    activo: true,
    fuente: 'REPLAY_MARCO',
    grosor: 7,         // px de banda oscura (por fuera del juego)
    linea: 2,          // px de linea clara pegada al juego
    color: '#EAF0FF',  // color de la linea
    opacidad: 100,
    fondo: '#101116',  // color de la banda
    opacidadFondo: 98
  },

  // Que fuente es "el juego" para ese cuadro. Si se deja vacio se usa la
  // primera de "encoger".
  fuenteJuego: '',

  // El movimiento: el juego NO salta, se hace pequeno con una transicion, y al
  // terminar la repeticion vuelve a crecer igual (y hasta que termina de
  // crecer no se apaga el ojito). 0 milisegundos = de golpe, como antes.
  transicion: { activa: true, milisegundos: 340 },

  // Modo antiguo, solo si todavia no has aprendido los acomodos: lo que se
  // hace pequeno a la esquina mientras corre la repeticion.
  encoger: ['Juego'],

  // Lo que desaparece mientras corre la repeticion y vuelve al terminar.
  ocultar: ['HUD'],

  // Esquina donde se pone el juego: superior-izquierda, superior-derecha,
  // inferior-izquierda o inferior-derecha.
  esquina: 'inferior-derecha',
  anchoPip: 480,     // ancho en pixeles del juego pequeno
  margen: 24,        // separacion al borde

  // Botones disponibles. Todas salen del mismo bufer.
  duraciones: [10, 30, 60, 90],

  // Lo que dura el bufer de OBS; debe ser mayor que la repeticion mas larga.
  buferSegundos: 120,

  // Al final de la partida: carpeta de repeticiones guardadas y fuente VLC
  // que las reproduce seguidas.
  highlights: {
    // Los highlights viven en su propia escena, separada de la de partida.
    escena: 'Highlights',
    fuenteVlc: 'HIGHLIGHTS'
  }
};

// Solo estos campos se pueden devolver a OBS en SetSceneItemTransform; el resto
// (sourceWidth, width, height...) son de solo lectura.
const CAMPOS_TRANSFORM = [
  'positionX', 'positionY', 'rotation', 'scaleX', 'scaleY', 'alignment',
  'boundsType', 'boundsAlignment', 'boundsWidth', 'boundsHeight',
  'cropLeft', 'cropRight', 'cropTop', 'cropBottom'
];

function soloTransform(transform) {
  const salida = {};
  for (const campo of CAMPOS_TRANSFORM) {
    if (transform && transform[campo] !== undefined) salida[campo] = transform[campo];
  }
  return salida;
}

function leerConfig() {
  try {
    const datos = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ...POR_DEFECTO, ...datos, obs: { ...POR_DEFECTO.obs, ...(datos.obs || {}) },
      highlights: { ...POR_DEFECTO.highlights, ...(datos.highlights || {}) } };
  } catch {
    return { ...POR_DEFECTO, highlights: { ...POR_DEFECTO.highlights } };
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
    console.error(`[replay] No se pudo guardar la configuracion: ${error.message}`);
    return false;
  }
}

// ------------------------------------------------------------------
// Cliente minimo de obs-websocket (protocolo 5). No hace falta instalar
// nada: se habla con el servidor que ya trae OBS.
// ------------------------------------------------------------------
function autenticacion(password, salt, challenge) {
  const secreto = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secreto + challenge).digest('base64');
}

class Obs {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.identificado = false;
    this.pedidos = new Map();
    this.esperas = new Map();   // eventType -> [resolver]
    this.oyentes = new Map();   // eventType -> Set(fn)  (avisos que se escuchan siempre)
    this.numero = 0;
  }

  conectar(password, timeoutMs = 4000) {
    if (this.identificado && this.ws && this.ws.readyState === this.ws.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      let resuelto = false;
      const terminar = (error) => {
        if (resuelto) return;
        resuelto = true;
        clearTimeout(reloj);
        reject(error);
      };
      const reloj = setTimeout(() => {
        try { ws.terminate(); } catch { /* nada */ }
        terminar(new Error(`OBS no contesto en ${timeoutMs} ms (${this.url}). ` +
          '¿Esta abierto OBS y encendido el servidor WebSocket?'));
      }, timeoutMs);

      ws.on('message', (bruto) => {
        let mensaje;
        try { mensaje = JSON.parse(bruto.toString()); } catch { return; }
        const { op, d } = mensaje;
        if (op === 0) {                                   // Hello
          const aviso = d.authentication;
          const datos = { rpcVersion: 1 };
          if (aviso) {
            if (!password) {
              clearTimeout(reloj);
              reject(new Error('OBS pide contrasena de obs-websocket y no hay ninguna configurada'));
              return;
            }
            datos.authentication = autenticacion(password, aviso.salt, aviso.challenge);
          }
          ws.send(JSON.stringify({ op: 1, d: datos }));    // Identify
        } else if (op === 2) {                            // Identified
          clearTimeout(reloj);
          resuelto = true;
          this.ws = ws;
          this.identificado = true;
          resolve();
        } else if (op === 7) {                            // respuesta a un pedido
          if (d.requestType === 'Identify') {
            terminar(new Error('La contraseña de obs-websocket no es correcta'));
            try { ws.close(); } catch { /* nada */ }
            return;
          }
          const pendiente = this.pedidos.get(d.requestId);
          if (!pendiente) return;
          this.pedidos.delete(d.requestId);
          if (d.requestStatus && d.requestStatus.result) pendiente.resolver(d.responseData || {});
          else pendiente.rechazar(new Error(`${pendiente.tipo}: ${d.requestStatus?.comment || 'error'}`));
        } else if (op === 5) {                            // evento
          const lista = this.esperas.get(d.eventType);
          if (lista && lista.length) {
            const resolver = lista.shift();
            resolver(d.eventData || {});
          }
          // Ademas de las esperas de una sola vez, los avisos que se escuchan
          // siempre (el del ojito de la REPLAY).
          const oyentes = this.oyentes.get(d.eventType);
          if (oyentes) {
            for (const fn of [...oyentes]) {
              try { fn(d.eventData || {}); } catch { /* un oyente roto no corta nada */ }
            }
          }
        }
      });

      ws.on('close', () => {
        if (!this.identificado) {
          terminar(new Error('OBS corto la conexion. Casi siempre es la contraseña ' +
            'de obs-websocket mal puesta (Herramientas > Ajustes del servidor WebSocket).'));
        }
        this.identificado = false;
        this.ws = null;
        for (const pendiente of this.pedidos.values()) {
          pendiente.rechazar(new Error('Se corto la conexion con OBS'));
        }
        this.pedidos.clear();
      });

      ws.on('error', (error) => {
        clearTimeout(reloj);
        reject(new Error(`No se pudo hablar con OBS (${this.url}): ${error.message}`));
      });
    });
  }

  enviar(tipo, datos = {}, timeoutMs = 5000) {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      return Promise.reject(new Error('No hay conexion con OBS'));
    }
    const requestId = `r${++this.numero}`;
    return new Promise((resolver, rechazar) => {
      const reloj = setTimeout(() => {
        this.pedidos.delete(requestId);
        rechazar(new Error(`${tipo}: OBS no contesto en ${timeoutMs} ms`));
      }, timeoutMs);
      this.pedidos.set(requestId, {
        tipo,
        resolver: (valor) => { clearTimeout(reloj); resolver(valor); },
        rechazar: (error) => { clearTimeout(reloj); rechazar(error); }
      });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType: tipo, requestId, requestData: datos } }));
    });
  }

  // Espera a un evento de OBS (por ejemplo, que el archivo ya este escrito).
  esperar(evento, timeoutMs = 5000) {
    return new Promise((resolver, rechazar) => {
      const reloj = setTimeout(() => {
        const lista = (this.esperas.get(evento) || []).filter((fn) => fn !== alRecibir);
        this.esperas.set(evento, lista);
        rechazar(new Error(`OBS no aviso "${evento}" en ${timeoutMs} ms`));
      }, timeoutMs);
      const alRecibir = (datos) => { clearTimeout(reloj); resolver(datos); };
      const lista = this.esperas.get(evento) || [];
      lista.push(alRecibir);
      this.esperas.set(evento, lista);
    });
  }

  // Aviso que se escucha siempre (no se gasta). Devuelve como quitarlo.
  alEvento(evento, fn) {
    const lista = this.oyentes.get(evento) || new Set();
    lista.add(fn);
    this.oyentes.set(evento, lista);
    return () => lista.delete(fn);
  }

  cerrar() {
    try { this.ws?.close(); } catch { /* nada */ }
    this.ws = null;
    this.identificado = false;
  }
}

// ------------------------------------------------------------------
// La lista de los highlights (lo que reproduce la fuente VLC).
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// ffmpeg (opcional): para que en HIGHLIGHTS vaya SOLO el trozo de la
// repeticion y no los 120 s del bufer.
//
// OBS guarda el bufer entero y no hay forma de pedirle un trozo por
// websocket, asi que el trozo hay que cortarlo del archivo. Eso lo hace
// ffmpeg. Si no esta, todo sigue funcionando: en HIGHLIGHTS va el bufer
// completo y se avisa en la ventana negra.
// ------------------------------------------------------------------
let ffmpegEncontrado = null;   // ruta del ejecutable, o null si no hay
let ffmpegProbadoEn = 0;
let ffmpegAvisado = false;

// Donde puede estar ffmpeg en un Windows normal, en orden. Lo que devuelve
// "where" va primero porque es lo que ve el propio sistema.
function candidatosDeFfmpeg() {
  const { spawnSync } = require('child_process');
  const candidatos = [];
  for (const orden of ['where', 'which']) {
    try {
      const r = spawnSync(orden, ['ffmpeg'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      const primera = String(r.stdout || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0];
      if (!r.error && r.status === 0 && primera) candidatos.push(primera);
    } catch { /* en Windows "which" no existe: se sigue */ }
  }
  candidatos.push('ffmpeg');
  candidatos.push(path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
  candidatos.push(path.join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin', 'ffmpeg.exe'));
  candidatos.push(path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'ffmpeg.exe'));
  candidatos.push('C:\\ffmpeg\\bin\\ffmpeg.exe');
  candidatos.push('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe');
  // Los paquetes de winget: ...\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget...\<version>\bin
  try {
    const paquetes = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    for (const carpeta of fs.readdirSync(paquetes)) {
      if (!/ffmpeg/i.test(carpeta)) continue;
      const base = path.join(paquetes, carpeta);
      for (const dentro of fs.readdirSync(base)) {
        const ruta = path.join(base, dentro, 'bin', 'ffmpeg.exe');
        if (fs.existsSync(ruta)) candidatos.push(ruta);
      }
    }
  } catch { /* sin winget: nada */ }
  return candidatos;
}

// Busca ffmpeg. Si lo encuentra lo recuerda para siempre; si no, lo vuelve a
// mirar cada 8 s (asi, si lo instalas con el servidor abierto, empieza a
// funcionar solo, sin reiniciar).
function buscarFfmpeg() {
  if (ffmpegEncontrado) return ffmpegEncontrado;
  if (ffmpegProbadoEn && Date.now() - ffmpegProbadoEn < 8000) return null;
  ffmpegProbadoEn = Date.now();
  const { spawnSync } = require('child_process');
  ffmpegEncontrado = null;
  for (const ruta of candidatosDeFfmpeg()) {
    if (!ruta) continue;
    try {
      if (ruta.includes('/') || ruta.includes('\\')) {
        if (fs.existsSync(ruta)) { ffmpegEncontrado = ruta; break; }
      } else {
        // Es solo el nombre: se pregunta al sistema si existe.
        const prueba = spawnSync(ruta, ['-version'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
        if (!prueba.error && prueba.status === 0) { ffmpegEncontrado = ruta; break; }
      }
    } catch { /* siguiente candidato */ }
  }
  if (ffmpegEncontrado && !ffmpegAvisado) {
    ffmpegAvisado = true;
    console.log(`[replay] ffmpeg: encontrado en ${ffmpegEncontrado}`);
  }
  return ffmpegEncontrado;
}

// Copia los ULTIMOS `segundos` del bufer a un archivo aparte, sin recodificar.
// Devuelve { ruta, comando } si salio, o { ruta: null, error } con lo que dijo
// ffmpeg. Asi, cuando no sale, la ventana negra dice por que en vez de callarse.
//
// Se corta desde el FINAL (-sseof): asi el trozo siempre acaba donde acaba la
// repeticion que viste, que es donde esta la jugada. Sin recodificar el corte
// cae en el fotograma clave anterior, o sea que puede empezar 1-2 s antes: se
// ve un pelo mas de bufer, nunca menos de repeticion.
function recortarRepeticion(archivo, desdeMs, segundos) {
  return new Promise((resolver) => {
    const ff = buscarFfmpeg();
    if (!ff) return resolver({ ruta: null, error: 'no hay ffmpeg' });
    try {
      const carpeta = path.join(__dirname, 'cine', 'recortes');
      fs.mkdirSync(carpeta, { recursive: true });
      const base = path.basename(archivo).replace(/\.[^.]+$/, '');
      // .mkv de salida: como el bufer. Copiar sin recodificar a .mkv vale con
      // cualquier codec (H.264, HEVC, AV1, audio Opus...); a .mp4 fallaria con
      // algunos y entonces no habria trozo. VLC lo lee igual.
      const salida = path.join(carpeta, `${base} - ${segundos}s.mkv`);
      if (fs.existsSync(salida)) {
        try { fs.unlinkSync(salida); } catch { /* se sobrescribe igual */ }
      }
      // -sseof -N: empieza N segundos antes del final. -c copy: sin recodificar.
      const argumentos = ['-hide_banner', '-loglevel', 'error', '-y',
        '-sseof', `-${segundos}`,
        '-i', archivo,
        '-c', 'copy', '-avoid_negative_ts', 'make_zero',
        '-map', '0:v:0', '-map', '0:a:0?',
        salida];
      execFile(ff, argumentos, { windowsHide: true, timeout: 180000 },
        (error, stdout, stderr) => {
          if (error) {
            return resolver({ ruta: null, comando: [ff, ...argumentos].join(' '),
              error: `ffmpeg fallo: ${String(stderr || error.message).trim().split('\n').slice(-3).join(' ').slice(0, 400)}` });
          }
          if (!fs.existsSync(salida)) {
            return resolver({ ruta: null, comando: [ff, ...argumentos].join(' '),
              error: 'ffmpeg termino pero no dejo el archivo' });
          }
          let mb = 0;
          try { mb = Math.round((fs.statSync(salida).size / (1024 * 1024)) * 10) / 10; } catch { /* nada */ }
          resolver({ ruta: salida, megabytes: mb, comando: [ff, ...argumentos].join(' ') });
        });
    } catch (error) {
      resolver({ ruta: null, error: error.message });
    }
  });
}

function leerHighlights() {
  try {
    const datos = JSON.parse(fs.readFileSync(HIGHLIGHTS_PATH, 'utf8'));
    const lista = Array.isArray(datos) ? datos : datos.lista;
    if (!Array.isArray(lista)) return [];
    // Los archivos que ya no esten en disco no se pasan: darian error en VLC.
    return lista.filter((x) => x && x.archivo && fs.existsSync(x.archivo));
  } catch {
    return [];
  }
}

function guardarHighlights(lista) {
  try {
    fs.mkdirSync(path.dirname(HIGHLIGHTS_PATH), { recursive: true });
    const temporal = `${HIGHLIGHTS_PATH}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify({ lista }, null, 2));
    fs.renameSync(temporal, HIGHLIGHTS_PATH);
  } catch { /* si no se puede escribir, la lista vive solo en memoria */ }
}

// ------------------------------------------------------------------
// El guion de una repeticion.
// ------------------------------------------------------------------
function crearReplay({ app, log = () => {} } = {}) {
  if (!fs.existsSync(CONFIG_PATH)) guardarConfig(leerConfig());   // para poder editarla
  // Si la config viene de una version anterior, se le anaden las opciones
  // nuevas (sin tocar nada de lo suyo) para que se puedan ver y cambiar.
  try {
    const crudo = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const faltan = ['cuadroJuego', 'fuenteJuego', 'transicion', 'marco'].filter((k) => !(k in crudo));
    // (r54) El sitio del juego subio 5 px y se corrio 5 px a la izquierda. Si la
    // config trae EXACTAMENTE el de la r52/r53, se cambia sola; si trae otras
    // cifras, son tuyas y no se tocan.
    const viejo = crudo.cuadroJuego || {};
    const esElViejo = Math.abs(Number(viejo.x) - 0.057) < 0.0002
      && Math.abs(Number(viejo.y) - 0.5342) < 0.0002
      && Math.abs(Number(viejo.ancho) - 0.2389) < 0.0002;
    // (r55) El marco de la r54 (2 px blancos, una sola pieza) pasa al de ahora:
    // banda oscura + linea clara, como el del minimapa. Solo si es exactamente
    // el de la r54: si lo cambiaste tu, se respeta.
    const marcoCrudo = crudo.marco || {};
    const esMarcoViejo = Number(marcoCrudo.grosor) === 2
      && String(marcoCrudo.color || '').toUpperCase() === '#FFFFFF'
      && Number(marcoCrudo.opacidad) === 70 && !('linea' in marcoCrudo);
    const marcoNuevo = esMarcoViejo ? { ...POR_DEFECTO.marco }
      : { ...POR_DEFECTO.marco, ...marcoCrudo };
    const marcoCambia = esMarcoViejo
      || Object.keys(POR_DEFECTO.marco).some((k) => !(k in marcoCrudo));
    if (faltan.length || esElViejo || marcoCambia) {
      if (esElViejo) {
        log('[replay] El sitio del juego pequeno se actualiza al de la r54: ' +
          'x=0.0542, y=0.5296 (104,572 en 1920x1080, 5 px mas arriba y 5 a la izquierda)');
      }
      if (esMarcoViejo) {
        log('[replay] El marco del juego pequeno se actualiza al de la r55: banda oscura de ' +
          `${POR_DEFECTO.marco.grosor} px + linea clara de ${POR_DEFECTO.marco.linea} px ` +
          '(como el del minimapa, pero mucho mas fino)');
      }
      guardarConfig({
        ...crudo,
        cuadroJuego: esElViejo || !crudo.cuadroJuego
          ? { ...POR_DEFECTO.cuadroJuego }
          : crudo.cuadroJuego,
        fuenteJuego: crudo.fuenteJuego || POR_DEFECTO.fuenteJuego,
        transicion: { ...POR_DEFECTO.transicion, ...(crudo.transicion || {}) },
        marco: marcoNuevo
      });
    }
  } catch { /* si no se puede, se sigue con los valores por defecto */ }

  const estado = {
    config: leerConfig(),
    obs: null,
    ocupado: false,
    corriendo: false,
    segundos: 0,
    terminaEn: 0,
    temporizador: null,
    respaldo: new Map(),   // nombre de fuente -> { posicion, escala, visible }
    movimiento: null,      // nombre de la fuente que se encogio

    // El ojito manda: la REPLAY no se muestra sola nunca.
    armado: false,         // hay una repeticion preparada, en pausa, esperando el ojito
    enElAire: false,       // el ojito ya la mostro y el video va corriendo
    ojoVisible: null,      // como esta ahora mismo el ojito de la fuente REPLAY
    recorteDesde: null,    // segundo del bufer en el que empieza
    duracionBufer: 0,      // lo que dura el archivo guardado
    ultimoArchivo: null,   // { ruta, existe, megabytes, cuando } del ultimo guardado
    duracionReal: 0,       // lo que se ve de verdad (si el bufer era mas corto)
    // El recorte se deja puesto ANTES del ojito: al darle, solo hay que darle
    // al PLAY y arranca de golpe (sin la pausita de recortar en ese momento).
    recorteListo: null,    // { desde, total, duracionReal, archivo, cuando }
    // El movimiento del juego: quien manda ahora mismo. Si se pide otro, el
    // anterior se corta en el fotograma en el que este (asi nunca se pelean
    // dos animaciones por la misma fuente).
    animacion: 0,
    juegoGrande: null,     // como estaba el juego a pantalla completa
    // Las repeticiones que se han hecho con los botones, en orden: es la lista
    // que se le pasa a la fuente VLC de HIGHLIGHTS.
    highlights: [],        // [{ archivo, segundos, cuando }]
    ojoEnganchado: false,  // ya se esta escuchando el aviso del ojito
    nombresDeItem: new Map()   // "Escena|id" -> nombre de la fuente
  };
  estado.highlights = leerHighlights();
  // (r56) La carpeta de highlights ya no se usa: la lista se va llenando sola,
  // repeticion a repeticion, y no se rehace. Si estaba puesta, se avisa.
  if (estado.config.highlights && estado.config.highlights.carpeta) {
    log('[replay] Aviso: la carpeta de highlights de replay.json ya no se usa. Antes se volvian ' +
      'a poner TODOS los videos de esa carpeta en cada repeticion (y por eso reaparecian los que ' +
      'quitabas en OBS). Ahora cada repeticion se añade sola al final de la lista. Puedes borrar ' +
      '"carpeta" de replay.json.');
  }

  function obs() {
    if (!estado.obs) estado.obs = new Obs(estado.config.obs.url);
    return estado.obs;
  }

  async function conectar() {
    const cliente = obs();
    await cliente.conectar(estado.config.obs.password);
    engancharOjo(cliente);
    return cliente;
  }

  // Guarda como estaba una fuente para poder devolverla tal cual.
  async function recordarFuente(cliente, nombre) {
    if (estado.respaldo.has(nombre)) return;
    const escena = estado.config.escena;
    const { sceneItemId } = await cliente.enviar('GetSceneItemId', { sceneName: escena, sourceName: nombre });
    const { sceneItemTransform } = await cliente.enviar('GetSceneItemTransform', { sceneName: escena, sceneItemId });
    const { sceneItemEnabled } = await cliente.enviar('GetSceneItemEnabled', { sceneName: escena, sceneItemId });
    estado.respaldo.set(nombre, { sceneItemId, sceneItemTransform, sceneItemEnabled });
  }

  function posicionPip(transform, config) {
    const ancho = Number(transform.sourceWidth) || 1920;
    const escala = config.anchoPip / ancho;
    const alto = (Number(transform.sourceHeight) || 1080) * escala;
    const { margen } = config;
    const lienzo = 1920;      // ancho de la escena del directo
    const altoLienzo = 1080;
    const posiciones = {
      'superior-izquierda': { positionX: margen, positionY: margen },
      'superior-derecha': { positionX: lienzo - config.anchoPip - margen, positionY: margen },
      'inferior-izquierda': { positionX: margen, positionY: altoLienzo - alto - margen },
      'inferior-derecha': { positionX: lienzo - config.anchoPip - margen, positionY: altoLienzo - alto - margen }
    };
    return { ...(posiciones[config.esquina] || posiciones['inferior-derecha']), scaleX: escala, scaleY: escala };
  }

  // ------------------------------------------------------------------
  // El ojito de la fuente REPLAY. OBS avisa cuando una fuente de una escena
  // se muestra u oculta (SceneItemEnableStateChanged). Ese aviso es el mando:
  //   · ojito puesto  -> se pone el acomodo "replay" y arranca el video
  //   · ojito quitado -> se pone el acomodo "partida"
  // La REPLAY no se muestra sola nunca: la ensenas tu.
  // ------------------------------------------------------------------
  async function nombreDeItem(cliente, escena, sceneItemId) {
    const llave = `${escena}|${sceneItemId}`;
    if (estado.nombresDeItem.has(llave)) return estado.nombresDeItem.get(llave);
    try {
      const { sceneItems = [] } = await cliente.enviar('GetSceneItemList', { sceneName: escena });
      for (const item of sceneItems) {
        if (item.sceneItemId !== undefined && item.sourceName) {
          estado.nombresDeItem.set(`${escena}|${item.sceneItemId}`, item.sourceName);
        }
      }
      if (estado.nombresDeItem.has(llave)) return estado.nombresDeItem.get(llave);
    } catch { /* si la lista no trae ids, se pregunta fuente por fuente */ }
    const config = estado.config;
    for (const nombre of [config.fuenteReplay, ...(config.fuentesEscena || [])]) {
      try {
        const datos = await cliente.enviar('GetSceneItemId', { sceneName: escena, sourceName: nombre });
        estado.nombresDeItem.set(`${escena}|${datos.sceneItemId}`, nombre);
        if (datos.sceneItemId === sceneItemId) return nombre;
      } catch { /* esa fuente no esta en la escena */ }
    }
    return null;
  }

  // Pregunta a OBS como esta el ojito ahora mismo (sin tocar nada).
  async function leerOjo(cliente) {
    try {
      const { sceneItemId } = await cliente.enviar('GetSceneItemId', {
        sceneName: estado.config.escena, sourceName: estado.config.fuenteReplay
      });
      const { sceneItemEnabled } = await cliente.enviar('GetSceneItemEnabled', {
        sceneName: estado.config.escena, sceneItemId
      });
      estado.ojoVisible = Boolean(sceneItemEnabled);
    } catch { /* si la REPLAY no aparece, se sabra cuando la muevan */ }
    return estado.ojoVisible;
  }

  // Igual, pero solo la primera vez (despues manda el aviso de OBS).
  async function sincronizarOjo(cliente) {
    if (estado.ojoVisible !== null) return estado.ojoVisible;
    return leerOjo(cliente);
  }

  function engancharOjo(cliente) {
    if (estado.ojoEnganchado) return;
    estado.ojoEnganchado = true;
    // Los avisos del ojito se atienden de uno en uno. Si le das dos veces
    // seguidas, el segundo espera a que termine el primero: asi no se
    // solapan dos arranques (que era otra forma de que se viera desordenado).
    let cola = Promise.resolve();
    cliente.alEvento('SceneItemEnableStateChanged', (datos) => {
      cola = cola.then(() => cambioDeOjo(datos))
        .catch((error) => log(`[replay] Aviso del ojito: ${error.message}`));
    });
    void sincronizarOjo(cliente).catch(() => {});
  }

  async function cambioDeOjo(datos) {
    const config = estado.config;
    if (!datos || !datos.sceneName) return;
    // Se mira la escena que dice el aviso, no solo la de partida: si la REPLAY
    // esta dentro de un GRUPO, OBS avisa con el nombre del grupo y asi tambien
    // se reconoce.
    const cliente = await conectar();
    const nombre = await nombreDeItem(cliente, datos.sceneName, datos.sceneItemId);
    if (nombre !== config.fuenteReplay) return;
    const visible = Boolean(datos.sceneItemEnabled);
    if (visible === estado.ojoVisible) return;   // cambio hecho por este mismo codigo
    estado.ojoVisible = visible;
    log(`[replay] Ojito de "${config.fuenteReplay}": ${visible ? 'puesto (se ve)' : 'quitado (oculta)'}`);
    if (estado.ocupado) return;                  // se ajusta al final de lanzar()
    await reaccionarAlOjo(cliente, visible);
  }

  // Pone el acomodo que toca segun el ojito y arranca o reinicia la repeticion.
  //
  //   ojito puesto  -> acomodo "replay" y el video empieza SIEMPRE desde el
  //                    recorte, aunque ya se hubiera visto antes.
  //   ojito quitado -> acomodo "partida" (juego y HUD como estaban) y el video
  //                    vuelve al recorte: si lo vuelves a mostrar, empieza de
  //                    nuevo, nunca continua donde se quedo.
  async function reaccionarAlOjo(cliente, visible) {
    const config = estado.config;
    // Sin ninguna repeticion preparada, el ojito es tuyo y no se toca nada.
    if (!estado.armado && !estado.enElAire) return;
    const cual = visible ? 'replay' : 'partida';
    // El juego no se toca en el acomodo: se mueve aparte, con su transicion.
    const juego = nombreDelJuego();
    const ocultar = config.ocultar || [];
    // (r55) El HUD NO se toca aqui. Antes el acomodo de repeticion lo apagaba
    // en el acto —en cuanto dabas el ojito— y el juego seguia grande "en vivo"
    // un rato: el HUD desaparecia antes de tiempo. Ahora se apaga en el mismo
    // fotograma en que el juego empieza a encogerse (gancho de abajo).
    const opciones = { sinCambiarVisibilidad: ocultar };
    if (juego) opciones.sin = [juego];
    if (Object.keys(config.posiciones?.[cual] || {}).length) {
      await aplicarAcomodo(cliente, cual, opciones);
    } else if (visible) {
      await modoAntiguoEncoger(cliente, opciones);   // todavia sin acomodo aprendido
    } else {
      await modoAntiguoDevolver(cliente, opciones);
    }
    // El juego va al cuadro exacto (el de tu captura), haciendose pequeno con
    // movimiento. Esto manda sobre cualquier acomodo guardado.
    if (visible) {
      // PRIMERO el video y DESPUES el encogido. Al reves se veian los saltos:
      // si OBS no tenia el archivo cargado, habia que reiniciar y buscar el
      // recorte (hasta 4 veces) con la REPLAY ya a la vista, y eso son los
      // "clicks" de adelante-atras. Ahora el juego sigue grande —tapando la
      // REPLAY, que esta debajo en la lista de fuentes— mientras se hace ese
      // trabajo, y solo cuando el video ya va se encoge.
      if (estado.armado) await arrancar(cliente);   // desde el recorte, no donde iba
      void aplicarCuadroJuego(cliente, {
        // Se apaga el HUD en el mismo fotograma en que empieza a encoger.
        alEmpezar: () => cambiarVisibilidad(cliente, ocultar, false)
      }).catch((error) => log(`[replay] Aviso: ${error.message}`));
      if (!juego) await cambiarVisibilidad(cliente, ocultar, false);   // modo antiguo sin juego
    } else {
      // Y al volver, el HUD reaparece en el mismo fotograma en que el juego
      // empieza a crecer (no al final, para no ver el hueco).
      await devolverJuegoConTransicion(cliente, {
        alEmpezar: () => cambiarVisibilidad(cliente, ocultar, true)
      });
      if (!juego) await cambiarVisibilidad(cliente, ocultar, true);
    }
    if (visible) {
      // (el arranque ya se hizo arriba, antes de encoger el juego)
    } else if (estado.enElAire) {
      // Se esta viendo y la quitas (porque pasa algo en el en vivo): el video se
      // para y vuelve al principio del recorte. La sesion sigue armada: si la
      // vuelves a mostrar, repite esos mismos segundos desde el inicio.
      if (estado.temporizador) {
        clearTimeout(estado.temporizador);
        estado.temporizador = null;
      }
      estado.enElAire = false;
      estado.terminaEn = 0;
      // El video se queda parado EN EL RECORTE (no solo parado): asi, si
      // vuelves a darle al ojito, arranca de golpe sin la pausita de recortar.
      try {
        await dejarListoElRecorte(cliente, 8);
      } catch {
        await reposarVideo(cliente);
      }
      log('[replay] REPLAY oculta: juego y HUD de vuelta, y el video listo para empezar de nuevo');
    }
  }

  // Deja el video parado y el cursor en el recorte, listo para empezar de cero.
  async function reposarVideo(cliente) {
    const config = estado.config;
    try {
      await cliente.enviar('TriggerMediaInputAction', {
        inputName: config.fuenteReplay, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
      });
    } catch { /* nada */ }
    if (estado.recorteDesde !== null) {
      try {
        await cliente.enviar('SetMediaInputCursor', {
          inputName: config.fuenteReplay, mediaCursor: estado.recorteDesde
        });
      } catch { /* nada */ }
    }
  }

  // El video empieza justo al darle al ojito, y siempre desde el recorte.
  //
  // OJO CON OBS (esto es lo que hacia que las repeticiones salieran raras):
  //   · PLAY despues de STOP deja la fuente diciendo "reproduciendo" con el
  //     tiempo congelado y sin imagen (obs-studio#4252, obs-websocket#1046).
  //     Por eso se arranca con RESTART.
  //   · SetMediaInputCursor a veces se PIERDE si se manda con el reproductor
  //     recien arrancado. Antes se mandaba y no se comprobaba nada: si se
  //     perdia, la repeticion empezaba por el PRINCIPIO del bufer (o sea, por
  //     lo viejo) y parecia que el tiempo no era el que pediste.
  //     Ahora se pausa, se adelanta, SE COMPRUEBA, y si no quedo se reintenta.
  async function arrancar(cliente) {
    const config = estado.config;

    // 0) CAMINO CORTO. En /replay/N el video se dejo pausado justo en el
    //    recorte (dejarListoElRecorte). Si sigue ahi, lo unico que falta es
    //    darle al PLAY: arranca de golpe, sin la pausita de recortar delante
    //    de la gente.
    if (estado.recorteListo) {
      const d = await cliente.enviar('GetMediaInputStatus', { inputName: config.fuenteReplay })
        .catch(() => ({}));
      const cursor = Number(d.mediaCursor) || 0;
      const medio = d.mediaState || null;
      const sigueAhi = medio !== 'OBS_MEDIA_STATE_STOPPED'
        && Math.abs(cursor - estado.recorteListo.desde) <= 1500;
      if (sigueAhi) {
        const comienzo = Date.now();
        await cliente.enviar('TriggerMediaInputAction', {
          inputName: config.fuenteReplay, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY'
        });
        estado.duracionBufer = estado.recorteListo.total;
        estado.recorteDesde = estado.recorteListo.desde;
        estado.duracionReal = estado.recorteListo.duracionReal;
        ponerEnElAire();
        log(`[replay] Arranca sin pausa: ya estaba listo en el segundo ` +
          `${(estado.recorteDesde / 1000).toFixed(1)} (${Date.now() - comienzo} ms). ` +
          'Ahora el juego se hace pequeno');
        void verificarAvance(cliente, estado.recorteDesde, estado.duracionBufer);
        return;
      }
      log('[replay] OBS tenia el archivo sin cargar (se cerro o se reinicio). Se recarga y se ' +
        'busca el recorte ANTES de encoger el juego: como el juego todavia esta grande y ' +
        'encima, esto no se ve. Si lo vieras, es que el juego no tapa a la REPLAY ' +
        '(sube la REPLAY o pon el juego por encima en la lista de fuentes).');
    }

    // 1) Arrancar de verdad.
    await cliente.enviar('TriggerMediaInputAction', {
      inputName: config.fuenteReplay, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
    });

    // 2) Esperar a que OBS tenga el archivo cargado (duracion y reproduciendo).
    //    Si la duracion ya se midio al guardar el bufer (/replay/N la midio en
    //    el archivo nuevo, que es el mismo), no hay que esperar 1,5 s a que OBS
    //    la vuelva a decir: se prueba un par de veces y se sigue con la medida.
    //    Eso acorta el arranque de ~2 s a menos de 1 s, y el juego grande tapa
    //    menos rato.
    const listo = await esperarMedioListo(cliente, estado.duracionBufer > 500 ? 2 : 10);
    const total = listo.total > 500 ? listo.total : (estado.duracionBufer || 0);
    if (total > 500) estado.duracionBufer = total;

    // 3) Recorte: pausa, adelantar, comprobar, y si no quedo, reintentar.
    let desde = null;
    let aplicado = { bien: false, cursor: 0 };
    if (total > 500) {
      desde = Math.max(0, total - estado.segundos * 1000);
      aplicado = await aplicarRecorte(cliente, desde);
      log(aplicado.bien
        ? `[replay] Recorte puesto en el segundo ${(desde / 1000).toFixed(1)} de ${(total / 1000).toFixed(1)} s (comprobado)`
        : `[replay] AVISO: OBS no acepto el recorte. El video arranca en el segundo ` +
          `${((aplicado.cursor || 0) / 1000).toFixed(1)} en vez de ${(desde / 1000).toFixed(1)}. ` +
          'Se va a ver un trozo del bufer que no es el que pediste.');
    } else {
      log('[replay] AVISO: OBS no dio la duracion del archivo; no se puede recortar. ' +
        'Se vera el bufer entero desde el principio.');
    }
    estado.recorteDesde = desde;

    // 4) Seguir desde el recorte. PLAY despues de PAUSE si reanuda donde esta.
    await cliente.enviar('TriggerMediaInputAction', {
      inputName: config.fuenteReplay, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY'
    });

    // 5) Cuanto va a durar DE VERDAD: si el bufer tiene menos que lo pedido, se
    //    respeta lo que hay (y se dice), en vez de dejar el video congelado al
    //    final esperando unos segundos que no existen.
    const disponible = desde === null || total <= 500 ? estado.segundos * 1000
      : Math.max(0, total - desde);
    const duracionReal = Math.min(estado.segundos * 1000, disponible);
    estado.duracionReal = duracionReal;
    if (total > 500 && duracionReal < estado.segundos * 1000 - 250) {
      log(`[replay] El bufer solo tenia ${(total / 1000).toFixed(1)} s y pediste ` +
        `${estado.segundos} s: se veran ${(duracionReal / 1000).toFixed(1)} s ` +
        '(el bufer estaba recien encendido o no estaba lleno).');
    }

    // El contador de la repeticion empieza aqui, con el video ya andando.
    ponerEnElAire();
    log(`[replay] Ojito puesto: va la repeticion de ${estado.segundos} s` +
      (desde !== null ? ` (desde el segundo ${Math.round(desde / 1000)})` : '') +
      (duracionReal < estado.segundos * 1000 ? `, en la practica ${(duracionReal / 1000).toFixed(1)} s` : ''));

    // 6) Y se comprueba que de verdad avanza desde el recorte.
    void verificarAvance(cliente, desde, total);
  }

  // Deja el contador andando con la duracion que se va a ver de verdad.
  function ponerEnElAire() {
    estado.enElAire = true;
    estado.terminaEn = Date.now() + (estado.duracionReal || 0);
    if (estado.temporizador) clearTimeout(estado.temporizador);
    estado.temporizador = setTimeout(() => { void restaurar(); }, estado.duracionReal || 0);
    estado.temporizador.unref?.();
    estado.recorteListo = null;   // ya se consumio: si se vuelve a armar, se recorta otra vez
  }

  // Apaga en la fuente REPLAY los dos ajustes de OBS que se comen el recorte:
  //   · "reiniciar al activarse" (viene marcado): cada vez que le das al ojito
  //     la fuente vuelve al segundo 0, asi que el recorte se perdia justo en
  //     el momento de mostrarla.
  //   · "cerrar el archivo cuando no esta activa": al ocultarla se cerraba el
  //     archivo y al volver a mostrarla empezaba de cero.
  async function asegurarSinReinicio(cliente) {
    const config = estado.config;
    let ajustes;
    try {
      ajustes = (await cliente.enviar('GetInputSettings', { inputName: config.fuenteReplay })).inputSettings || {};
    } catch { return; }
    const querer = {};
    if (ajustes.restart_on_activate !== false) querer.restart_on_activate = false;
    if (ajustes.close_when_inactive === true) querer.close_when_inactive = false;
    if (!Object.keys(querer).length) return;
    try {
      await cliente.enviar('SetInputSettings', {
        inputName: config.fuenteReplay, inputSettings: querer, overlay: true
      });
      log(`[replay] En "${config.fuenteReplay}" se quito ` +
        `${Object.keys(querer).join(' y ')}: asi el video no se reinicia al darle al ojito`);
    } catch (error) {
      log(`[replay] Aviso: no se pudo ajustar "${config.fuenteReplay}": ${error.message}`);
    }
  }

  // Deja el video PAUSADO en el segundo del recorte, listo para que el ojito
  // solo tenga que darle al PLAY. Esto es lo que quita la pausita.
  async function dejarListoElRecorte(cliente, intentosDeEspera = 20) {
    const config = estado.config;
    const total = estado.duracionBufer > 500 ? estado.duracionBufer : 0;
    if (!total) { estado.recorteListo = null; return null; }
    const desde = Math.max(0, total - estado.segundos * 1000);
    await asegurarSinReinicio(cliente);
    await cliente.enviar('TriggerMediaInputAction', {
      inputName: config.fuenteReplay, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
    }).catch(() => {});
    const listo = await esperarMedioListo(cliente, intentosDeEspera);
    if (listo.total > 500) estado.duracionBufer = listo.total;
    const totalBueno = estado.duracionBufer || total;
    const aplicado = await aplicarRecorte(cliente, desde);
    const duracionReal = Math.min(estado.segundos * 1000, Math.max(0, totalBueno - desde));
    estado.recorteDesde = desde;
    estado.duracionReal = duracionReal;
    estado.recorteListo = {
      desde, total: totalBueno, duracionReal,
      archivo: estado.ultimoArchivo?.ruta || null, cuando: Date.now()
    };
    if (aplicado.bien) {
      log(`[replay] Recorte puesto en el segundo ${(desde / 1000).toFixed(1)} de ` +
        `${(totalBueno / 1000).toFixed(1)} s (comprobado). Queda parado ahi: al ojito arranca sin pausa`);
    } else {
      log(`[replay] AVISO: OBS no acepto el recorte. El video arranca en el segundo ` +
        `${((aplicado.cursor || 0) / 1000).toFixed(1)} en vez de ${(desde / 1000).toFixed(1)}. ` +
        'Se va a ver un trozo del bufer que no es el que pediste.');
      estado.recorteListo = null;   // mejor recortar al ojito (camino largo) que arrancar mal
    }
    if (totalBueno > 500 && duracionReal < estado.segundos * 1000 - 250) {
      log(`[replay] El bufer solo tenia ${(totalBueno / 1000).toFixed(1)} s y pediste ` +
        `${estado.segundos} s: se veran ${(duracionReal / 1000).toFixed(1)} s ` +
        '(el bufer estaba recien encendido o no estaba lleno).');
    }
    return estado.recorteListo;
  }

  // Espera a que OBS tenga el archivo cargado y reproduciendo.
  async function esperarMedioListo(cliente, intentos = 20) {
    let ultimo = { estado: null, total: 0 };
    for (let intento = 0; intento < Math.max(1, intentos); intento += 1) {
      const d = await cliente.enviar('GetMediaInputStatus', { inputName: estado.config.fuenteReplay })
        .catch(() => ({}));
      ultimo = { estado: d.mediaState || null, total: Number(d.mediaDuration) || 0 };
      if (ultimo.total > 500 && ultimo.estado !== 'OBS_MEDIA_STATE_STOPPED') return ultimo;
      await new Promise((r) => setTimeout(r, 150));
    }
    return ultimo;
  }

  // Pausa, adelanta el cursor y COMPRUEBA que quedo. Si no quedo, reintenta.
  // Devuelve donde se quedo de verdad.
  async function aplicarRecorte(cliente, desde) {
    const config = estado.config;
    await cliente.enviar('TriggerMediaInputAction', {
      inputName: config.fuenteReplay, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE'
    }).catch(() => {});
    let cursor = 0;
    // 3 intentos: cada intento es un salto del cursor. Con el juego grande
    // tapando la REPLAY no se ve, pero cuantos menos, mejor.
    for (let intento = 1; intento <= 3; intento += 1) {
      await cliente.enviar('SetMediaInputCursor', { inputName: config.fuenteReplay, mediaCursor: desde })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
      const d = await cliente.enviar('GetMediaInputStatus', { inputName: config.fuenteReplay })
        .catch(() => ({}));
      cursor = Number(d.mediaCursor) || 0;
      if (Math.abs(cursor - desde) <= 500) return { bien: true, cursor, intento };
    }
    return { bien: false, cursor };
  }

  async function verificarAvance(cliente, desde, total) {
    const config = estado.config;
    const antes = await cliente.enviar('GetMediaInputStatus', { inputName: config.fuenteReplay })
      .catch(() => null);
    if (!antes) return;
    await new Promise((r) => setTimeout(r, 500));
    const despues = await cliente.enviar('GetMediaInputStatus', { inputName: config.fuenteReplay })
      .catch(() => null);
    if (!despues) return;
    // Si mientras tanto le quitaste el ojito (o termino), no hay nada que
    // avisar: el video esta parado porque tu lo mandaste.
    if (!estado.enElAire) return;
    const a = Number(antes.mediaCursor) || 0;
    const b = Number(despues.mediaCursor) || 0;
    if (b <= a + 50) {
      log(`[replay] AVISO: el video no avanza (${despues.mediaState || 'sin estado'}, en ${Math.round(a)} ms). ` +
        'Si la fuente REPLAY se ve en OBS y aun asi no hay imagen, el archivo no se pudo leer. ' +
        'Si no se ve, el ojito no esta puesto.');
      return;
    }
    if (desde !== null && total > 500) {
      const esperado = desde + (b - a);
      if (Math.abs(b - esperado) > 1500) {
        log(`[replay] AVISO: esta corriendo en el segundo ${(b / 1000).toFixed(1)} y deberia ir por ` +
          `${(esperado / 1000).toFixed(1)}. El recorte no quedo donde tocaba.`);
        return;
      }
    }
    log(`[replay] Comprobado: el video avanza (segundo ${(a / 1000).toFixed(1)} → ${(b / 1000).toFixed(1)})`);
  }

  // Estado del reproductor ahora mismo (para /replay/estado).
  async function estadoDelMedio(cliente) {
    try {
      const d = await cliente.enviar('GetMediaInputStatus', { inputName: estado.config.fuenteReplay });
      return {
        estado: d.mediaState || 'sin estado',
        segundo: Math.round((Number(d.mediaCursor) || 0) / 100) / 10,
        duracion: Math.round((Number(d.mediaDuration) || 0) / 100) / 10
      };
    } catch {
      return null;
    }
  }

  // Pone el juego, pequeno, EXACTAMENTE en el sitio medido en la captura del
  // usuario (config.cuadroJuego). No recorta nada: solo mueve y encoge.
  //
  // Dos cosas que se hacian mal antes y por eso "no se acomodaba solo":
  //   · se calculaba la posicion a ojo (esquina + margen) en vez de usar un
  //     sitio fijo medido;
  //   · se mandaba solo la escala. Si la fuente tiene "Ajustar a la pantalla"
  //     (boundsType), OBS IGNORA la escala y el juego no encoge: hay que
  //     devolverla a "sin marco" (OBS_BOUNDS_NONE) en la misma orden.
  // El nombre de la fuente que es "el juego".
  function nombreDelJuego() {
    const config = estado.config;
    return config.fuenteJuego || (config.encoger || [])[0] || null;
  }

  // El lienzo de verdad, preguntado a OBS (1920x1080, 2560x1440, lo que sea).
  async function lienzoDe(cliente) {
    try {
      const video = await cliente.enviar('GetVideoSettings');
      return {
        baseWidth: Number(video.baseWidth) || 1920,
        baseHeight: Number(video.baseHeight) || 1080
      };
    } catch {
      return { baseWidth: 1920, baseHeight: 1080 };
    }
  }

  // A donde tiene que ir el juego: el cuadro fijo de la captura.
  function cuadroDelJuego(item, cuadro, lienzo) {
    const anchoFuente = Number(item.transform.sourceWidth) || lienzo.baseWidth;
    const anchoPx = Math.round(Number(cuadro.ancho) * lienzo.baseWidth);
    const escala = anchoPx / anchoFuente;
    return {
      positionX: Math.round(Number(cuadro.x) * lienzo.baseWidth),
      positionY: Math.round(Number(cuadro.y) * lienzo.baseHeight),
      scaleX: escala,
      scaleY: escala,
      boundsType: 'OBS_BOUNDS_NONE',
      anchoPx,
      altoPx: Math.round((Number(item.transform.sourceHeight) || lienzo.baseHeight) * escala)
    };
  }

  // A donde tiene que volver: a la foto de partida si la hay, si no a como
  // estaba justo antes de encogerse.
  function sitioGrande(item) {
    const config = estado.config;
    const nombre = nombreDelJuego();
    const guardado = config.posiciones?.partida?.[nombre]?.transform;
    const base = guardado || estado.juegoGrande
      || { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, boundsType: 'OBS_BOUNDS_NONE' };
    return {
      positionX: Number(base.positionX ?? 0),
      positionY: Number(base.positionY ?? 0),
      scaleX: Number(base.scaleX ?? 1),
      scaleY: Number(base.scaleY ?? 1),
      boundsType: base.boundsType || 'OBS_BOUNDS_NONE',
      boundsWidth: Number(base.boundsWidth ?? 0),
      boundsHeight: Number(base.boundsHeight ?? 0),
      boundsAlignment: Number(base.boundsAlignment ?? 0)
    };
  }

  // ------------------------------------------------------------------
  // El marco del juego pequeno: un PNG con el centro transparente.
  // ------------------------------------------------------------------
  // (r56) Antes eran dos fuentes de COLOR, o sea dos rectangulos macizos: solo
  // parecian un marco si quedaban justo DETRAS del juego. Cuando OBS las dejaba
  // por delante, tapaban el juego entero (eso es lo que se veia en la
  // captura), y habia que pelear con el orden de la lista en cada repeticion.
  //
  // Ahora es una sola imagen PNG con el aro pintado y el CENTRO TRANSPARENTE:
  // se vea por delante o por detras del juego, solo se ve el borde. El archivo
  // se genera aqui mismo (con "zlib", que ya viene con Node), asi que no hay
  // que instalar nada ni copiar ninguna imagen a mano.
  const TABLA_CRC = (() => {
    const tabla = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      tabla[n] = c;
    }
    return tabla;
  })();

  function crc32(buffer) {
    let c = -1;
    for (let i = 0; i < buffer.length; i += 1) c = TABLA_CRC[(c ^ buffer[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function trozoPng(tipo, datos) {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length, 0);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo), 0);
    return Buffer.concat([largo, cuerpo, crc]);
  }

  // '#RRGGBB' + opacidad (0-100) -> [r, g, b, a]
  function colorRgba(hex, opacidad) {
    const limpio = String(hex || '#FFFFFF').replace('#', '');
    const r = parseInt(limpio.slice(0, 2), 16) || 255;
    const g = parseInt(limpio.slice(2, 4), 16) || 255;
    const b = parseInt(limpio.slice(4, 6), 16) || 255;
    const a = Math.round(Math.max(0, Math.min(100, Number(opacidad ?? 100))) * 2.55);
    return [r, g, b, a];
  }

  // El PNG: "banda" px oscuros por fuera, "linea" px claros pegados al juego y
  // el centro transparente (es lo que hace que no tape nada).
  function pngDeMarco(ancho, alto, banda, linea, deBanda, deLinea) {
    const filas = Buffer.alloc((ancho * 4 + 1) * alto);
    let i = 0;
    for (let y = 0; y < alto; y += 1) {
      filas[i] = 0;    // filtro: ninguno
      i += 1;
      for (let x = 0; x < ancho; x += 1) {
        const d = Math.min(x, y, ancho - 1 - x, alto - 1 - y);
        const c = d < banda ? deBanda : (d < banda + linea ? deLinea : [0, 0, 0, 0]);
        filas[i] = c[0]; filas[i + 1] = c[1]; filas[i + 2] = c[2]; filas[i + 3] = c[3];
        i += 4;
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(ancho, 0);
    ihdr.writeUInt32BE(alto, 4);
    ihdr[8] = 8;    // 8 bits por canal
    ihdr[9] = 6;    // RGBA
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      trozoPng('IHDR', ihdr),
      trozoPng('IDAT', zlib.deflateSync(filas)),
      trozoPng('IEND', Buffer.alloc(0))
    ]);
  }

  const MARCO_PNG = path.join(__dirname, 'cine', 'marco.png');

  // Escribe el PNG del marco para un juego de este tamano (solo si cambio) y
  // dice como quedo: ruta, tamano y cuanto mide el borde.
  function escribirMarcoPng(anchoJuego, altoJuego) {
    const cfg = estado.config.marco || {};
    const banda = Math.max(1, Number(cfg.grosor) || 7);
    const linea = Math.max(0, Math.min(banda, Number(cfg.linea ?? 2)));
    const borde = banda + linea;
    const ancho = Math.round(anchoJuego) + borde * 2;
    const alto = Math.round(altoJuego) + borde * 2;
    const datos = pngDeMarco(ancho, alto, banda, linea,
      colorRgba(cfg.fondo || '#101116', cfg.opacidadFondo ?? 98),
      colorRgba(cfg.color || '#EAF0FF', cfg.opacidad ?? 100));
    try {
      fs.mkdirSync(path.dirname(MARCO_PNG), { recursive: true });
      const antes = fs.existsSync(MARCO_PNG) ? fs.readFileSync(MARCO_PNG) : null;
      if (!antes || !antes.equals(datos)) fs.writeFileSync(MARCO_PNG, datos);
    } catch (error) {
      log(`[replay] Aviso: no se pudo escribir el PNG del marco (${error.message}). ` +
        'Se sigue sin marco.');
      return null;
    }
    return { ruta: MARCO_PNG, ancho, alto, borde, banda, linea };
  }

  function nombreDelMarco() {
    return (estado.config.marco || {}).fuente || 'REPLAY_MARCO';
  }

  // Quita una fuente de la escena y de la lista de fuentes. Se usa para
  // limpiar las dos de COLOR de la r55, que eran las que tapaban el juego.
  async function quitarFuente(cliente, nombre) {
    const escena = estado.config.escena;
    let sceneItemId = null;
    try {
      ({ sceneItemId } = await cliente.enviar('GetSceneItemId', { sceneName: escena, sourceName: nombre }));
    } catch { return false; }
    try { await cliente.enviar('RemoveSceneItem', { sceneName: escena, sceneItemId }); } catch { /* nada */ }
    try { await cliente.enviar('RemoveInput', { inputName: nombre }); } catch { /* nada */ }
    log(`[replay] Marco: se quito la fuente "${nombre}" (era una de las de color de la r55, ` +
      'las que se veian como un cuadro encima del juego)');
    return true;
  }

  // Deja el marco listo y ENCENDIDO, con el tamano de ESTA repeticion.
  // Devuelve la pieza con su sceneItemId (lista vacia si no hay marco).
  async function asegurarMarco(cliente, sceneItemIdJuego, destino) {
    const cfg = estado.config.marco || {};
    if (cfg.activo === false) return [];
    const escena = estado.config.escena;
    const nombre = nombreDelMarco();
    const png = escribirMarcoPng(Number(destino && destino.anchoPx) || 459,
      Number(destino && destino.altoPx) || 258);
    if (!png) return [];
    // La linea de la r55 ya no existe: fuera si quedo por ahi.
    await quitarFuente(cliente, cfg.fuenteLinea || 'REPLAY_MARCO_LINEA');
    let sceneItemId = null;
    try {
      ({ sceneItemId } = await cliente.enviar('GetSceneItemId', { sceneName: escena, sourceName: nombre }));
    } catch { sceneItemId = null; }
    if (sceneItemId !== null) {
      // Si la que hay es la de color de la r55, se cambia por la imagen.
      let tipo = null;
      try { tipo = (await cliente.enviar('GetInputKind', { inputName: nombre })).inputKind; }
      catch { /* si no contesta, se intenta igual */ }
      if (tipo && tipo !== 'image_source') {
        await quitarFuente(cliente, nombre);
        sceneItemId = null;
      }
    }
    if (sceneItemId === null) {
      try {
        await cliente.enviar('CreateInput', {
          sceneName: escena, inputName: nombre, inputKind: 'image_source',
          inputSettings: { file: png.ruta }, sceneItemEnabled: true
        });
        ({ sceneItemId } = await cliente.enviar('GetSceneItemId', { sceneName: escena, sourceName: nombre }));
        // Debajo del juego, y SOLO esta vez: a partir de aqui el orden no se
        // vuelve a tocar (si lo mueves tu, se queda donde lo pongas).
        try {
          const { sceneItemIndex } = await cliente.enviar('GetSceneItemIndex', {
            sceneName: escena, sceneItemId: sceneItemIdJuego
          });
          await cliente.enviar('SetSceneItemIndex', { sceneName: escena, sceneItemId, sceneItemIndex });
        } catch { /* da igual: como es un aro, no tapa nada */ }
        log(`[replay] Marco: se creo la fuente "${nombre}" (imagen ${png.ancho}x${png.alto} px, ` +
          `${png.banda} px de banda + ${png.linea} px de linea, centro transparente) en la escena "${escena}"`);
      } catch (error) {
        log(`[replay] Aviso: no se pudo crear el marco "${nombre}": ${error.message}. ` +
          'Se sigue sin marco.');
        return [];
      }
    } else {
      // Ya estaba: se le vuelve a poner el archivo (y el tamano, si cambio).
      await cliente.enviar('SetInputSettings', {
        inputName: nombre, inputSettings: { file: png.ruta }, overlay: true
      }).catch(() => {});
    }
    await cliente.enviar('SetSceneItemEnabled', {
      sceneName: escena, sceneItemId, sceneItemEnabled: true
    }).catch(() => {});
    estado.marcoTamano = { ancho: png.ancho, alto: png.alto, borde: png.borde };
    return [{ nombre, sceneItemId, borde: png.borde }];
  }

  // El marco, si YA existe en la escena (para la vuelta a pantalla completa:
  // ahi no se crea nada, solo se mueve y se apaga).
  async function marcoPuesto(cliente) {
    const cfg = estado.config.marco || {};
    if (cfg.activo === false) return [];
    const nombre = nombreDelMarco();
    try {
      const { sceneItemId } = await cliente.enviar('GetSceneItemId', {
        sceneName: estado.config.escena, sourceName: nombre
      });
      const tam = estado.marcoTamano || {};
      const borde = Number(tam.borde) || (Number(cfg.grosor) || 7) + Number(cfg.linea ?? 2);
      return [{ nombre, sceneItemId, borde }];
    } catch { return []; }   // no esta en la escena: nada
  }

  // Cuadro del marco para un instante del movimiento del juego: el juego mas
  // el borde por los cuatro lados, corrido el borde a la izquierda y arriba.
  function cuadroDelMarco(t, base, pieza) {
    const borde = Math.max(1, Number(pieza && pieza.borde) || 9);
    const tam = estado.marcoTamano || { ancho: 477, alto: 276 };
    const anchoPx = Number(base.sourceWidth || 1920) * Number(t.scaleX || 1);
    const altoPx = Number(base.sourceHeight || 1080) * Number(t.scaleY || 1);
    return {
      positionX: Number(t.positionX) - borde,
      positionY: Number(t.positionY) - borde,
      scaleX: (anchoPx + borde * 2) / tam.ancho,
      scaleY: (altoPx + borde * 2) / tam.alto
    };
  }

  // Mueve y encoge la fuente poco a poco, en vez de dar el salto de golpe.
  // Cada fotograma se manda a OBS como un cambio de posicion y tamano; el
  // ultimo es EXACTAMENTE el del destino, para acabar justo donde toca.
  async function moverConTransicion(cliente, sceneItemId, desde, hasta, marco, gancho, tamano) {
    const config = estado.config;
    const ms = Number(config.transicion?.milisegundos) || 0;
    const encender = config.transicion?.activa !== false && ms > 0;
    // Durante el movimiento se va "sin marco" (si no, OBS ignora la escala).
    // En el ULTIMO fotograma se devuelve el marco que toque: al volver a
    // pantalla completa, el que tenia la fuente (por ejemplo "Ajustar a la
    // pantalla"), que si no se perderia.
    const enviar = (t, tipoMarco, base) => {
      const pedidos = [cliente.enviar('SetSceneItemTransform', {
        sceneName: config.escena, sceneItemId,
        sceneItemTransform: {
          positionX: t.positionX, positionY: t.positionY,
          scaleX: t.scaleX, scaleY: t.scaleY,
          boundsType: tipoMarco || 'OBS_BOUNDS_NONE',
          ...(tipoMarco && tipoMarco !== 'OBS_BOUNDS_NONE' ? {
            boundsWidth: Number(hasta.boundsWidth) || 0,
            boundsHeight: Number(hasta.boundsHeight) || 0,
            boundsAlignment: Number(hasta.boundsAlignment) || 0
          } : {})
        }
      }).catch(() => {})];
      // El marco, si lo hay, va con el juego: mismo fotograma, un poco mas
      // grande (para que asome el borde). Se mide con el tamano de VERDAD de
      // la fuente del juego, no con un 1920x1080 supuesto.
      for (const pieza of marco || []) {
        if (!pieza || !pieza.sceneItemId) continue;
        pedidos.push(cliente.enviar('SetSceneItemTransform', {
          sceneName: config.escena, sceneItemId: pieza.sceneItemId,
          sceneItemTransform: cuadroDelMarco(t, tamano || base || { sourceWidth: 1920, sourceHeight: 1080 },
            pieza)
        }).catch(() => {}));
      }
      return Promise.all(pedidos);
    };
    const tipoMarco = hasta.boundsType || 'OBS_BOUNDS_NONE';
    // (r55) El gancho va AL FINAL del movimiento: asi el HUD desaparece cuando
    // el juego YA se ha hecho pequeno (y vuelve cuando ya esta grande), en vez
    // de hacerlo al darle al ojito con el juego todavia "en vivo" a tamano
    // completo.
    const alFinal = async () => { if (gancho) { try { await gancho(); } catch { /* se sigue */ } } };
    if (!encender) { await enviar(hasta, tipoMarco); await alFinal(); return 1; }
    const token = (estado.animacion += 1);
    // Cuantos fotogramas: uno cada ~16 ms (unos 60 por segundo), con un
    // minimo para que el movimiento se vea aunque el equipo vaya justo.
    // Un paso cada ~24 ms (unas 40 imagenes por segundo): se ve suave y no se
    // llena OBS de peticiones (cada paso son dos: el juego y su marco).
    const pasos = Math.max(6, Math.round(ms / 24));
    const comienzo = Date.now();
    const suave = (x) => (x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2);
    let hechos = 0;
    let cortado = false;
    for (let i = 1; i <= pasos; i += 1) {
      if (estado.animacion !== token) { cortado = true; break; }   // otro movimiento manda ahora
      const t = Math.min(1, (Date.now() - comienzo) / ms);
      const k = suave(i === pasos ? 1 : t);
      await enviar({
        positionX: desde.positionX + (hasta.positionX - desde.positionX) * k,
        positionY: desde.positionY + (hasta.positionY - desde.positionY) * k,
        scaleX: desde.scaleX + (hasta.scaleX - desde.scaleX) * k,
        scaleY: desde.scaleY + (hasta.scaleY - desde.scaleY) * k
      }, i === pasos ? tipoMarco : 'OBS_BOUNDS_NONE', desde);
      hechos += 1;
      if (i === pasos) break;
      const falta = comienzo + (ms * i) / pasos - Date.now();
      if (falta > 0) await new Promise((r) => setTimeout(r, falta));
    }
    if (estado.animacion === token) await enviar(hasta, tipoMarco, desde);   // el ultimo, exacto
    // Si lo corto otro movimiento (quitastes el ojito a mitad), el que manda es
    // ese otro y este no toca la visibilidad de nada.
    if (!cortado) await alFinal();
    return hechos;
  }

  // Encoge el juego hasta el cuadro de la captura, con movimiento.
  async function aplicarCuadroJuego(cliente, opciones = {}) {
    const config = estado.config;
    const cuadro = config.cuadroJuego;
    if (!cuadro || typeof cuadro !== 'object') return false;
    const nombre = nombreDelJuego();
    if (!nombre) {
      log('[replay] AVISO: hay "cuadroJuego" pero no se sabe que fuente es el juego. ' +
        'Pon "fuenteJuego": "LOL GAME" (o el nombre de tu captura) en replay.json');
      return false;
    }
    let item;
    try {
      const { sceneItemId } = await cliente.enviar('GetSceneItemId', {
        sceneName: config.escena, sourceName: nombre
      });
      const { sceneItemTransform } = await cliente.enviar('GetSceneItemTransform', {
        sceneName: config.escena, sceneItemId
      });
      item = { sceneItemId, transform: sceneItemTransform };
    } catch (error) {
      log(`[replay] AVISO: no se encontro la fuente del juego "${nombre}" en la escena ` +
        `"${config.escena}" (${error.message}). Pon "fuenteJuego" con el nombre exacto en replay.json`);
      return false;
    }
    const lienzo = await lienzoDe(cliente);
    const destino = cuadroDelJuego(item, cuadro, lienzo);
    const desde = soloTransform(item.transform);
    // Si venia de grande, se apunta como estaba: es a donde vuelve al final.
    if (Number(desde.scaleX || 1) > destino.scaleX * 1.05) {
      estado.juegoGrande = { ...desde };
    }
    // El marco: se crea la primera vez y se queda justo debajo del juego.
    const marco = await asegurarMarco(cliente, item.sceneItemId, destino).catch(() => []);
    estado.marcoListo = marco.length ? marco.map((p) => p.nombre).join(' + ') : null;
    const hechos = await moverConTransicion(cliente, item.sceneItemId, desde, destino, marco,
      opciones.alEmpezar,
      { sourceWidth: item.transform.sourceWidth, sourceHeight: item.transform.sourceHeight });
    // Y se comprueba leyendo como quedo, en vez de suponerlo.
    const despues = await cliente.enviar('GetSceneItemTransform', {
      sceneName: config.escena, sceneItemId: item.sceneItemId
    }).catch(() => null);
    const t = (despues && despues.sceneItemTransform) || {};
    const bien = Math.abs(Number(t.positionX) - destino.positionX) <= 2
      && Math.abs(Number(t.positionY) - destino.positionY) <= 2
      && Math.abs(Number(t.scaleX) - destino.scaleX) <= 0.01;
    log(bien
      ? `[replay] El juego se hace pequeno con movimiento hasta x=${destino.positionX}, ` +
        `y=${destino.positionY}, ${destino.anchoPx}x${destino.altoPx} px ` +
        `(lienzo ${lienzo.baseWidth}x${lienzo.baseHeight}, ${hechos} pasos): ` +
        'el sitio de tu captura, sin recortarlo'
      : `[replay] AVISO: el juego no quedo donde tocaba. Se pidio x=${destino.positionX}, ` +
        `y=${destino.positionY}, escala ${destino.scaleX.toFixed(3)} y OBS dice ` +
        `x=${Math.round(Number(t.positionX))}, y=${Math.round(Number(t.positionY))}, ` +
        `escala ${Number(t.scaleX).toFixed(3)}, marco "${t.boundsType}". Si la fuente esta ` +
        'BLOQUEADA en OBS (el candado de la lista de fuentes), quitaselo; si tiene marco ' +
        '("Ajustar a la pantalla"), ponlo en "Ninguno"');
    return bien;
  }

  // Devuelve el juego a pantalla completa, tambien con movimiento. Se usa al
  // terminar la repeticion: primero crece (y se comprueba), y solo despues se
  // apaga el ojito, para que no haya ni un instante de fondo vacio.
  async function devolverJuegoConTransicion(cliente, opciones = {}) {
    const config = estado.config;
    const nombre = nombreDelJuego();
    if (!nombre) return false;
    try {
      const { sceneItemId } = await cliente.enviar('GetSceneItemId', {
        sceneName: config.escena, sourceName: nombre
      });
      const { sceneItemTransform } = await cliente.enviar('GetSceneItemTransform', {
        sceneName: config.escena, sceneItemId
      });
      const destino = sitioGrande({ transform: sceneItemTransform });
      const desde = soloTransform(sceneItemTransform);
      // El marco, si existe, crece con el juego y se apaga al terminar.
      const marco = await marcoPuesto(cliente).catch(() => []);
      const pasos = await moverConTransicion(cliente, sceneItemId, desde, destino, marco,
        opciones.alEmpezar,
        { sourceWidth: sceneItemTransform.sourceWidth, sourceHeight: sceneItemTransform.sourceHeight });
      for (const pieza of marco) {
        await cliente.enviar('SetSceneItemEnabled', {
          sceneName: config.escena, sceneItemId: pieza.sceneItemId, sceneItemEnabled: false
        }).catch(() => {});
      }
      const despues = await cliente.enviar('GetSceneItemTransform', {
        sceneName: config.escena, sceneItemId
      }).catch(() => null);
      const t = (despues && despues.sceneItemTransform) || {};
      const bien = Math.abs(Number(t.positionX) - destino.positionX) <= 2
        && Math.abs(Number(t.positionY) - destino.positionY) <= 2
        && Math.abs(Number(t.scaleX) - destino.scaleX) <= 0.01;
      log(bien
        ? `[replay] El juego vuelve a pantalla completa con movimiento (${pasos} pasos, ` +
          `${config.transicion?.milisegundos || 0} ms): ahora si, se apaga el ojito`
        : '[replay] AVISO: el juego no volvio a su sitio; se apaga el ojito igual (si se ve ' +
          'un hueco, mira que la fuente no este bloqueada en OBS)');
      return bien;
    } catch (error) {
      log(`[replay] AVISO: no se pudo devolver el juego (${error.message})`);
      return false;
    }
  }

  async function modoAntiguoEncoger(cliente, opciones = {}) {
    const config = estado.config;
    const sinTocar = opciones.sin || [];
    for (const nombre of [...(config.encoger || []), ...(config.ocultar || [])]) {
      try { await recordarFuente(cliente, nombre); }
      catch (error) { log(`[replay] Aviso: no se encontro "${nombre}" (${error.message})`); }
    }
    for (const nombre of config.ocultar || []) {
      // (r55) Si el HUD se apaga con el gancho (cuando el juego empieza a
      // encoger), aqui no se toca.
      if ((opciones.sinCambiarVisibilidad || []).includes(nombre)) continue;
      await mostrarEnEscena(cliente, nombre, false);
    }
    for (const nombre of config.encoger || []) {
      // El juego no: se va con su cuadro y su movimiento (aplicarCuadroJuego).
      if (sinTocar.includes(nombre)) continue;
      const guardado = estado.respaldo.get(nombre);
      if (!guardado) continue;
      const destino = posicionPip(guardado.sceneItemTransform, config);
      await cliente.enviar('SetSceneItemTransform', {
        sceneName: config.escena, sceneItemId: guardado.sceneItemId, sceneItemTransform: destino
      });
    }
  }

  async function modoAntiguoDevolver(cliente, opciones = {}) {
    const config = estado.config;
    const sinTocar = opciones.sin || [];
    for (const [nombre, guardado] of estado.respaldo) {
      if (sinTocar.includes(nombre)) continue;
      try {
        await cliente.enviar('SetSceneItemTransform', {
          sceneName: config.escena,
          sceneItemId: guardado.sceneItemId,
          sceneItemTransform: {
            positionX: guardado.sceneItemTransform.positionX,
            positionY: guardado.sceneItemTransform.positionY,
            scaleX: guardado.sceneItemTransform.scaleX,
            scaleY: guardado.sceneItemTransform.scaleY,
            // El marco tambien: si el juego se puso "sin marco" para encogerlo,
            // al volver se le devuelve el que tuviera.
            boundsType: guardado.sceneItemTransform.boundsType,
            boundsWidth: guardado.sceneItemTransform.boundsWidth,
            boundsHeight: guardado.sceneItemTransform.boundsHeight,
            boundsAlignment: guardado.sceneItemTransform.boundsAlignment
          }
        });
        if (!guardado.sceneItemEnabled) {
          await cliente.enviar('SetSceneItemEnabled', {
            sceneName: config.escena, sceneItemId: guardado.sceneItemId, sceneItemEnabled: false
          });
        }
      } catch (error) {
        log(`[replay] No se pudo devolver "${nombre}": ${error.message}`);
      }
    }
    for (const nombre of config.ocultar || []) {
      try { await mostrarEnEscena(cliente, nombre, true); } catch { /* nada */ }
    }
  }

  async function prepararRepeticion(cliente, archivo) {
    const config = estado.config;
    // La fuente de medios tiene que poder adelantarse y no cerrarse sola.
    await cliente.enviar('SetInputSettings', {
      inputName: config.fuenteReplay,
      inputSettings: {
        is_local_file: true,
        local_file: archivo,
        looping: false,
        restart_on_activate: false,
        close_when_inactive: false
      },
      overlay: true
    });
    // Y se COMPRUEBA que OBS se quedo con el archivo nuevo: si se quedara con
    // el anterior, se veria la repeticion de antes ("se sobreponen").
    const iguales = (a, b) => String(a || '').replace(/\\/g, '/') === String(b || '').replace(/\\/g, '/');
    for (let intento = 1; intento <= 3; intento += 1) {
      const { inputSettings } = await cliente.enviar('GetInputSettings', { inputName: config.fuenteReplay })
        .catch(() => ({ inputSettings: null }));
      const puesto = inputSettings && inputSettings.local_file;
      if (iguales(puesto, archivo)) return true;
      if (intento === 3) {
        log(`[replay] AVISO: OBS no se quedo con el archivo nuevo. Dice que tiene ` +
          `"${puesto || '(nada)'}" y se le pidio "${archivo}".`);
        return false;
      }
      await cliente.enviar('SetInputSettings', {
        inputName: config.fuenteReplay,
        inputSettings: { is_local_file: true, local_file: archivo, looping: false },
        overlay: true
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  // Espera a que OBS termine de leer el archivo y devuelve su duracion.
  async function duracionDe(cliente, intentos = 30) {
    for (let intento = 0; intento < intentos; intento += 1) {
      const datos = await cliente.enviar('GetMediaInputStatus', { inputName: estado.config.fuenteReplay });
      const duracion = Number(datos.mediaDuration) || 0;
      if (duracion > 500) return duracion;
      await new Promise((r) => setTimeout(r, 150));
    }
    return 0;
  }

  // Enciende o apaga una lista de fuentes (el HUD), sin fallar si alguna no
  // esta: se avisa y se sigue.
  async function cambiarVisibilidad(cliente, nombres, visible) {
    for (const nombre of nombres || []) {
      try {
        await mostrarEnEscena(cliente, nombre, visible);
      } catch (error) {
        log(`[replay] Aviso: no se pudo ${visible ? 'mostrar' : 'ocultar'} "${nombre}": ${error.message}`);
      }
    }
  }

  async function mostrarEnEscena(cliente, nombre, visible) {
    const { sceneItemId } = await cliente.enviar('GetSceneItemId', { sceneName: estado.config.escena, sourceName: nombre });
    // Si el que la mueve es este codigo, se apunta antes para no confundir el
    // aviso que devuelve OBS con un clic tuyo en el ojito.
    if (nombre === estado.config.fuenteReplay) estado.ojoVisible = Boolean(visible);
    await cliente.enviar('SetSceneItemEnabled', { sceneName: estado.config.escena, sceneItemId, sceneItemEnabled: visible });
  }

  // Copia el acomodo que tenga ahora mismo la escena: posicion, tamano, recorte
  // y si cada fuente esta visible. Asi el juego va donde tu lo pongas y la
  // REPLAY dentro de su marco, sin numeros inventados.
  async function aprender(cual) {
    if (!['partida', 'replay'].includes(cual)) {
      throw new Error('Di "partida" o "replay": /replay/aprender/partida o /replay/aprender/replay');
    }
    const config = estado.config;
    const cliente = await conectar();
    const guardado = {};
    const faltan = [];
    for (const nombre of config.fuentesEscena || []) {
      try {
        const { sceneItemId } = await cliente.enviar('GetSceneItemId', { sceneName: config.escena, sourceName: nombre });
        const { sceneItemTransform } = await cliente.enviar('GetSceneItemTransform', { sceneName: config.escena, sceneItemId });
        const { sceneItemEnabled } = await cliente.enviar('GetSceneItemEnabled', { sceneName: config.escena, sceneItemId });
        guardado[nombre] = { transform: soloTransform(sceneItemTransform), enabled: sceneItemEnabled };
      } catch {
        faltan.push(nombre);
      }
    }
    if (!Object.keys(guardado).length) {
      throw new Error(`No se encontro ninguna de estas fuentes en la escena "${config.escena}": ${(config.fuentesEscena || []).join(', ')}`);
    }
    config.posiciones = config.posiciones || { partida: {}, replay: {} };
    config.posiciones[cual === 'partida' ? 'partida' : 'replay'] = guardado;
    guardarConfig(config);
    // Si se aprende "partida" con el HUD oculto, se avisa: al terminar la
    // repeticion se mostrara igual (esta en "ocultar"), pero conviene saberlo.
    const avisos = [];
    if (cual === 'partida') {
      for (const nombre of config.ocultar || []) {
        if (guardado[nombre] && guardado[nombre].enabled === false) {
          avisos.push(`"${nombre}" estaba OCULTO al aprender partida. Al terminar la ` +
            'repeticion se mostrara igual, porque esta en "ocultar", pero esa foto no es la de partida');
        }
      }
    }
    log(`[replay] Acomodo "${cual}" aprendido: ${Object.keys(guardado).join(', ')}`);
    return {
      estado: `acomodo de ${cual} guardado`,
      fuentes: Object.entries(guardado).map(([nombre, datos]) => ({
        fuente: nombre,
        x: Math.round(datos.transform.positionX || 0),
        y: Math.round(datos.transform.positionY || 0),
        anchoEscena: Math.round(1920 * (datos.transform.scaleX ?? 1)),
        escala: Number((datos.transform.scaleX ?? 1).toFixed(3)),
        visible: datos.enabled
      })),
      noEncontradas: faltan,
      avisos
    };
  }

  // Pone la escena tal como estaba en uno de los dos acomodos guardados.
  async function aplicarAcomodo(cliente, cual, opciones = {}) {
    const config = estado.config;
    const guardado = config.posiciones?.[cual];
    if (!guardado || !Object.keys(guardado).length) return false;
    // Nombres cuya visibilidad NO se toca en este paso (se encienden despues,
    // cuando la REPLAY ya no esta encima).
    const sinVisibilidad = opciones.sinCambiarVisibilidad || [];
    // Nombres que NO se tocan aqui porque los mueve otro (el juego, que va con
    // su transicion aparte).
    const sinTocar = opciones.sin || [];
    for (const [nombre, datos] of Object.entries(guardado)) {
      if (sinTocar.includes(nombre)) continue;
      try {
        const { sceneItemId } = await cliente.enviar('GetSceneItemId', { sceneName: config.escena, sourceName: nombre });
        // EL OJITO DE LA REPLAY ES TUYO: el acomodo aprendido NO lo toca. Si
        // lo tocara, al mostrarla se volveria a ocultar sola (se quedo oculta
        // en la foto) y no se podria volver a dar al ojito. Solo se cambia su
        // posicion y su tamano.
        if (nombre !== config.fuenteReplay && !sinVisibilidad.includes(nombre)) {
          await cliente.enviar('SetSceneItemEnabled', {
            sceneName: config.escena, sceneItemId, sceneItemEnabled: Boolean(datos.enabled)
          });
        }
        await cliente.enviar('SetSceneItemTransform', {
          sceneName: config.escena, sceneItemId, sceneItemTransform: soloTransform(datos.transform)
        });
      } catch (error) {
        log(`[replay] No se pudo acomodar "${nombre}": ${error.message}`);
      }
    }
    return true;
  }

  // Pregunta a OBS si el acomodo ya esta puesto de verdad (posicion, tamano y
  // visibilidad), en vez de suponer que si. Devuelve true si coincide.
  async function esperarAcomodo(cliente, cual, opciones = {}, topeMs = 1000) {
    const config = estado.config;
    const guardado = config.posiciones?.[cual] || {};
    const sinVisibilidad = opciones.sinCambiarVisibilidad || [];
    const sinTocar = opciones.sin || [];
    const nombres = Object.keys(guardado).filter((n) => !sinTocar.includes(n));
    if (!nombres.length) return true;
    const comienzo = Date.now();
    let ultimo = null;
    while (Date.now() - comienzo <= topeMs) {
      let todo = true;
      for (const nombre of nombres) {
        const esperado = guardado[nombre] || {};
        try {
          const { sceneItemId } = await cliente.enviar('GetSceneItemId', {
            sceneName: config.escena, sourceName: nombre
          });
          const { sceneItemTransform } = await cliente.enviar('GetSceneItemTransform', {
            sceneName: config.escena, sceneItemId
          });
          const t = esperado.transform || {};
          for (const campo of ['positionX', 'positionY', 'scaleX', 'scaleY']) {
            if (t[campo] === undefined) continue;
            if (Math.abs(Number(sceneItemTransform[campo]) - Number(t[campo])) > 1) {
              todo = false;
              ultimo = `${nombre}.${campo}: ${sceneItemTransform[campo]} en vez de ${t[campo]}`;
            }
          }
          if (nombre !== config.fuenteReplay && !sinVisibilidad.includes(nombre)) {
            const { sceneItemEnabled } = await cliente.enviar('GetSceneItemEnabled', {
              sceneName: config.escena, sceneItemId
            });
            if (Boolean(sceneItemEnabled) !== Boolean(esperado.enabled)) {
              todo = false;
              ultimo = `${nombre} visible=${sceneItemEnabled} en vez de ${esperado.enabled}`;
            }
          }
        } catch (error) {
          todo = false;
          ultimo = `${nombre}: ${error.message}`;
        }
      }
      if (todo) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    if (ultimo) log(`[replay] (lo que no cuadro: ${ultimo})`);
    return false;
  }

  async function nombresDeEscena(cliente, escena) {
    const { sceneItems = [] } = await cliente.enviar('GetSceneItemList', { sceneName: escena });
    return [...new Set(sceneItems.map((item) => item.sourceName).filter(Boolean))];
  }

  // Revisa la configuracion contra el OBS de verdad y devuelve una lista de
  // comprobaciones en castellano: sirve para no adivinar nombres de escenas ni
  // de fuentes.
  async function comprobar() {
    const config = estado.config;
    const revisiones = [];
    let cliente;
    try {
      cliente = await conectar();
      revisiones.push({ que: 'Conexión con OBS', bien: true, detalle: config.obs.url });
    } catch (error) {
      return { revisiones: [{ que: 'Conexión con OBS', bien: false, detalle: error.message }] };
    }

    const { scenes = [], currentProgramSceneName } = await cliente.enviar('GetSceneList');
    const escenas = scenes.map((s) => s.sceneName);
    revisiones.push({ que: 'Escenas que tiene OBS', bien: true, detalle: `${escenas.join(' · ')} (al aire ahora: ${currentProgramSceneName})` });

    // Escena de partida y sus fuentes
    const tieneEscena = escenas.includes(config.escena);
    revisiones.push({ que: `Escena de partida "${config.escena}"`, bien: tieneEscena,
      detalle: tieneEscena ? 'existe' : `no existe. Las que hay: ${escenas.join(', ')}` });
    if (tieneEscena) {
      const nombres = await nombresDeEscena(cliente, config.escena);
      revisiones.push({ que: 'Fuentes de esa escena', bien: true, detalle: nombres.join(' · ') });
      const buscar = (nombre) => nombres.includes(nombre)
        || nombres.some((n) => n.toLowerCase() === String(nombre).toLowerCase());
      revisiones.push({ que: `Fuente de repetición "${config.fuenteReplay}"`, bien: buscar(config.fuenteReplay),
        detalle: buscar(config.fuenteReplay) ? 'encontrada' : 'NO está en esa escena' });
      // La REPLAY tiene que ser una fuente de Medios: es la unica a la que se
      // le puede cargar un archivo y adelantarle el cursor.
      if (buscar(config.fuenteReplay)) {
        try {
          const { inputKind } = await cliente.enviar('GetInputSettings', { inputName: config.fuenteReplay });
          const vale = inputKind === 'ffmpeg_source';
          const nombres = {
            ffmpeg_source: 'Fuente de Medios (la buena)',
            vlc_source: 'fuente de VLC: no sirve para esto, tiene que ser de Medios',
            browser_source: 'fuente de Navegador: tiene que ser de Medios',
            image_source: 'imagen: tiene que ser de Medios',
            slideshow: 'presentación: tiene que ser de Medios'
          };
          revisiones.push({ que: `Tipo de la fuente "${config.fuenteReplay}"`, bien: vale,
            detalle: `${inputKind} — ${nombres[inputKind] || 'tiene que ser una Fuente de Medios'}` });
        } catch (error) {
          revisiones.push({ que: `Tipo de la fuente "${config.fuenteReplay}"`, bien: false,
            detalle: `no se pudo leer: ${error.message}` });
        }
      }
      for (const nombre of config.encoger || []) {
        revisiones.push({ que: `Para encoger "${nombre}"`, bien: buscar(nombre),
          detalle: buscar(nombre) ? 'encontrada' : 'NO está en esa escena' });
      }
      for (const nombre of config.ocultar || []) {
        revisiones.push({ que: `Para ocultar "${nombre}"`, bien: buscar(nombre),
          detalle: buscar(nombre) ? 'encontrada' : 'NO está en esa escena' });
      }
      // Las fuentes cuyo acomodo se aprende: si una no existe, al aprender se
      // queda fuera y luego no se moveria. Mejor verlo aqui.
      for (const nombre of config.fuentesEscena || []) {
        revisiones.push({ que: `Para el acomodo "${nombre}"`, bien: buscar(nombre),
          detalle: buscar(nombre) ? 'encontrada'
            : `NO está en esa escena. Pon el nombre exacto de tu fuente (${nombres.join(', ')})` });
      }
    }

    // Escena de highlights
    const escenaHigh = config.highlights.escena;
    const tieneHigh = escenas.includes(escenaHigh);
    revisiones.push({ que: `Escena de highlights "${escenaHigh}"`, bien: tieneHigh,
      detalle: tieneHigh ? 'existe' : `no existe. Las que hay: ${escenas.join(', ')}` });
    if (tieneHigh) {
      const nombres = await nombresDeEscena(cliente, escenaHigh);
      const fuente = config.highlights.fuenteVlc;
      const esta = nombres.includes(fuente);
      let detalle = esta ? 'encontrada' : `NO está. En esa escena hay: ${nombres.join(', ') || '(nada)'}`;
      // El tipo de la fuente es lo que decide si se le puede poner la lista.
      // Una fuente de medios normal (ffmpeg_source) no tiene lista y se ignora
      // en silencio: eso es lo que dejaba a HIGHLIGHTS sin nada.
      if (esta) {
        try {
          const info = await cliente.enviar('GetInputKind', { inputName: fuente });
          const tipo = info.inputKind;
          if (tipo === 'vlc_source') detalle += ' (tipo VLC: bien)';
          else detalle += ` — es de tipo "${tipo}", NO es VLC: no admite lista de reproducción. ` +
            'Cámbiala por una fuente de tipo "Fuente de VLC"';
        } catch { /* sin dato */ }
      }
      revisiones.push({ que: `Fuente VLC "${fuente}"`, bien: esta, detalle });
    }

    // ffmpeg: solo para que los highlights lleven el trozo y no el bufer entero
    const ff = buscarFfmpeg();
    revisiones.push({ que: 'ffmpeg (para que HIGHLIGHTS lleve solo el trozo)', bien: true,
      detalle: ff
        ? `encontrado en ${ff}. Cada repeticion se corta con sus segundos (los trozos van a ` +
          'ingame\\cine\\recortes)'
        : 'NO encontrado en este equipo: por eso el highlight dura el bufer entero (120 s). ' +
          'Instalalo con "winget install Gyan.FFmpeg" y reinicia el servidor; para comprobarlo, ' +
          'en una consola: ffmpeg -version' });

    // Lo que hay en la lista de HIGHLIGHTS, leido de OBS (r56: la lista ya no
    // se rehace; solo se añade cada repeticion nueva al final).
    let enLaLista = null;
    try { enLaLista = await leerListaHighlights(cliente); } catch { enLaLista = null; }
    revisiones.push({ que: 'Repeticiones en la lista de HIGHLIGHTS',
      bien: Boolean(enLaLista && enLaLista.length),
      detalle: enLaLista === null
        ? 'no se pudo leer la lista de esa fuente VLC'
        : enLaLista.length
          ? `${enLaLista.length} en la lista; la última es ${path.basename(enLaLista[enLaLista.length - 1])}`
          : 'todavía no hay ninguna: cada repetición se añade sola al final (lo que quites tú en OBS se queda quitado)' });

    // Búfer
    try {
      const { outputActive } = await cliente.enviar('GetReplayBufferStatus');
      revisiones.push({ que: 'Búfer de repetición', bien: true,
        detalle: outputActive ? 'encendido' : 'apagado (se enciende solo al pulsar un botón)' });
    } catch (error) {
      revisiones.push({ que: 'Búfer de repetición', bien: false, detalle: error.message });
    }

    // Donde escribe OBS el archivo del bufer (es la ruta de Grabación).
    try {
      const { recordDirectory } = await cliente.enviar('GetRecordDirectory');
      revisiones.push({ que: 'Carpeta donde OBS guarda el búfer', bien: true,
        detalle: recordDirectory ? `${recordDirectory} (es la Ruta de grabación)` :
          'OBS no tiene ruta puesta: usa la de Vídeos' });
    } catch (error) {
      revisiones.push({ que: 'Carpeta donde OBS guarda el búfer', bien: false, detalle: error.message });
    }

    // Quien tapa a quien: indice de cada fuente en la lista de OBS
    // (0 = la de mas abajo). Sirve para el caso tipico de "le doy al ojito y
    // no se ve nada": la REPLAY esta debajo del juego.
    if (tieneEscena) {
      const capas = [];
      for (const nombre of [...new Set([config.fuenteReplay, ...(config.fuentesEscena || [])])]) {
        try {
          const { sceneItemId } = await cliente.enviar('GetSceneItemId', { sceneName: config.escena, sourceName: nombre });
          const { sceneItemIndex } = await cliente.enviar('GetSceneItemIndex', { sceneName: config.escena, sceneItemId });
          capas.push({ nombre, indice: sceneItemIndex });
        } catch { /* esa fuente no esta */ }
      }
      capas.sort((a, b) => a.indice - b.indice);
      if (capas.length) {
        const arriba = capas[capas.length - 1].nombre;
        const deReplay = capas.find((c) => c.nombre === config.fuenteReplay);
        const juego = (config.fuentesEscena || []).find((n) => n !== config.fuenteReplay && n !== 'HUD');
        const deJuego = juego ? capas.find((c) => c.nombre === juego) : null;
        const tapada = deReplay && deJuego && deReplay.indice < deJuego.indice;
        revisiones.push({ que: 'Orden de capas (de abajo a arriba)', bien: true,
          detalle: capas.map((c) => `${c.nombre}:${c.indice}`).join(' · ') + ` (la de arriba: ${arriba})` });
        revisiones.push({ que: 'Que nada tape la REPLAY', bien: true,
          detalle: tapada
            ? `"${config.fuenteReplay}" esta DEBAJO de "${juego}": mientras el juego no se encoja, la tapa. Se arregla aprendiendo el acomodo (/replay/aprender/replay) o subiendo la REPLAY en la lista de fuentes`
            : 'la REPLAY esta por encima del juego: no la tapa nada' });
      }
    }

    const partida = Object.keys(config.posiciones?.partida || {}).length;
    const replayPos = Object.keys(config.posiciones?.replay || {}).length;
    revisiones.push({ que: 'Acomodo de partida aprendido', bien: partida > 0,
      detalle: partida ? `${partida} fuente(s)` : 'falta: pon la escena como en partida y abre /replay/aprender/partida' });
    // Si la foto de partida se aprendio con el HUD oculto, se dice: al
    // terminar se muestra igual (esta en "ocultar"), pero esa foto no es la
    // de partida y conviene volver a aprenderla.
    if (partida > 0) {
      for (const nombre of config.ocultar || []) {
        const foto = config.posiciones.partida[nombre];
        if (foto && foto.enabled === false) {
          revisiones.push({ que: `Foto de partida y "${nombre}"`, bien: false,
            detalle: `se aprendio la partida con "${nombre}" OCULTO. Al terminar la repeticion ` +
              'se muestra igual (esta en "ocultar"), pero lo suyo es volver a aprenderla con el visible' });
        }
      }
    }

    const dondeReplay = config.posiciones?.replay?.[config.fuenteReplay];
    const textoReplay = dondeReplay
      ? `${replayPos} fuente(s). La REPLAY quedo en (${Math.round(dondeReplay.transform.positionX || 0)},${Math.round(dondeReplay.transform.positionY || 0)}) escala ${Number((dondeReplay.transform.scaleX ?? 1).toFixed(3))}`
      : null;
    revisiones.push({ que: 'Acomodo de repeticion aprendido', bien: replayPos > 0,
      detalle: textoReplay || 'falta: acomoda el juego y la REPLAY como quieras y abre /replay/aprender/replay' });

    // El sitio del juego durante la repeticion (el cuadro fijo de la captura).
    const cuadro = config.cuadroJuego;
    if (cuadro && typeof cuadro === 'object') {
      const nombreJuego = config.fuenteJuego || (config.encoger || [])[0];
      let baseWidth = 1920;
      let baseHeight = 1080;
      try {
        const video = await cliente.enviar('GetVideoSettings');
        baseWidth = Number(video.baseWidth) || 1920;
        baseHeight = Number(video.baseHeight) || 1080;
      } catch { /* se supone 1920x1080 */ }
      const anchoPx = Math.round(Number(cuadro.ancho) * baseWidth);
      const x = Math.round(Number(cuadro.x) * baseWidth);
      const y = Math.round(Number(cuadro.y) * baseHeight);
      let real = null;
      try {
        const { sceneItemId } = await cliente.enviar('GetSceneItemId', {
          sceneName: config.escena, sourceName: nombreJuego
        });
        const { sceneItemTransform } = await cliente.enviar('GetSceneItemTransform', {
          sceneName: config.escena, sceneItemId
        });
        const alto = Math.round((Number(sceneItemTransform.sourceHeight) || baseHeight)
          * (anchoPx / (Number(sceneItemTransform.sourceWidth) || baseWidth)));
        real = `${anchoPx}x${alto}`;
      } catch { /* si no esta, ya lo dice la revision de arriba */ }
      const tr = config.transicion || {};
      revisiones.push({ que: 'Movimiento del juego', bien: true,
        detalle: tr.activa === false || !(Number(tr.milisegundos) > 0)
          ? 'APAGADO: el juego salta de golpe (pon transicion.activa en true)'
          : `${Number(tr.milisegundos)} ms al hacerse pequeno y al volver a pantalla completa` });
      revisiones.push({ que: `Sitio del juego en la repeticion ("${nombreJuego}")`, bien: true,
        detalle: `x=${x}, y=${y}, ${real || anchoPx + ' px de ancho'} de ${baseWidth}x${baseHeight} ` +
          `(fracciones ${cuadro.x} / ${cuadro.y} / ${cuadro.ancho}). Se pone al darle al ojito` });
      // El marco del juego pequeno: una imagen PNG con el centro transparente.
      const mar = config.marco || {};
      if (mar.activo === false) {
        revisiones.push({ que: 'Marco del juego pequeno', bien: true, detalle: 'APAGADO (marco.activo)' });
      } else {
        const nombreMarco = mar.fuente || 'REPLAY_MARCO';
        const banda = Number(mar.grosor) || 7;
        const linea = Number(mar.linea ?? 2);
        let idMarco = null;
        let tipoMarco = null;
        try {
          ({ sceneItemId: idMarco } = await cliente.enviar('GetSceneItemId', {
            sceneName: config.escena, sourceName: nombreMarco
          }));
          try { tipoMarco = (await cliente.enviar('GetInputKind', { inputName: nombreMarco })).inputKind; }
          catch { /* nada */ }
        } catch { idMarco = null; }
        let orden = '';
        if (idMarco !== null) {
          try {
            const { sceneItemIndex: indiceMarco } = await cliente.enviar('GetSceneItemIndex', {
              sceneName: config.escena, sceneItemId: idMarco
            });
            const { sceneItemId: idJuego } = await cliente.enviar('GetSceneItemId', {
              sceneName: config.escena, sourceName: nombreJuego
            });
            const { sceneItemIndex: indiceJuego } = await cliente.enviar('GetSceneItemIndex', {
              sceneName: config.escena, sceneItemId: idJuego
            });
            orden = `. En la lista: marco ${indiceMarco}, juego ${indiceJuego} (0 = abajo)`;
          } catch { /* nada */ }
        }
        revisiones.push({ que: 'Marco del juego pequeno', bien: tipoMarco === null || tipoMarco === 'image_source',
          detalle: idMarco === null
            ? `Todavia no esta: se crea sola la primera vez que le des al ojito ("${nombreMarco}", ` +
              `una imagen con el centro transparente: ${banda} px de banda + ${linea} px de linea)`
            : tipoMarco === 'image_source'
              ? `"${nombreMarco}": imagen con el centro transparente (${banda} px de banda + ${linea} px de linea)${orden}`
              : `"${nombreMarco}" es de tipo ${tipoMarco}, no una imagen: al darle al ojito se cambia sola ` +
                'por el marco nuevo (una imagen con el centro transparente)' });
      }
    }

    // El ojito: no es un fallo, es para que se vea como esta ahora mismo.
    await sincronizarOjo(cliente);
    revisiones.push({ que: `Ojito de "${config.fuenteReplay}"`, bien: true,
      detalle: estado.ojoVisible === null ? 'no se pudo leer (¿esta la fuente en la escena?)'
        : estado.ojoVisible ? 'puesto: la REPLAY se ve y el juego esta en su espacio'
          : 'quitado: la REPLAY no se ve; se muestra con su ojito' });

    const todoBien = revisiones.every((r) => r.bien);
    return { todoBien, revisiones };
  }

  // Todo vuelve a como estaba en partida: se oculta la REPLAY, se para el
  // video y se pone el acomodo "partida" (o el que habia antes).
  async function restaurar() {
    if (estado.temporizador) {
      clearTimeout(estado.temporizador);
      estado.temporizador = null;
    }
    if (!estado.corriendo) return { estado: 'no habia nada corriendo' };
    let cliente;
    try {
      cliente = await conectar();
    } catch (error) {
      estado.corriendo = false;
      estado.armado = false;
      estado.enElAire = false;
      return { estado: 'sin conexion con OBS', error: error.message };
    }
    const config = estado.config;
    const comienzo = Date.now();
    const ocultarAlFinal = config.ocultar || [];
    // ORDEN IMPORTANTE (esto era el fondo vacio del final): primero el juego
    // vuelve a su sitio y despues se apaga el ojito. Al reves —como estaba—
    // la REPLAY desaparecia un instante antes de que el juego creciera, y en
    // ese hueco se veia la escena sin nada. Ahora siempre hay imagen: mientras
    // el juego se agranda, la REPLAY sigue puesta.
    //
    // 1) El juego (todo menos lo que va en "ocultar") vuelve al acomodo de
    //    partida. El HUD se deja como esta aqui a proposito: se enciende
    //    despues de apagar el ojito, para que no aparezca encima del video.
    // El juego se mueve aparte, con su transicion: primero crece y se
    // comprueba que ya esta grande; solo despues se apaga el ojito.
    const juego = nombreDelJuego();
    const opciones = juego ? { sin: [juego] } : {};
    if (Object.keys(config.posiciones?.partida || {}).length > 0) {
      await aplicarAcomodo(cliente, 'partida',
        { ...opciones, sinCambiarVisibilidad: ocultarAlFinal });
    } else {
      await modoAntiguoDevolver(cliente, opciones);
    }
    if (juego) {
      await devolverJuegoConTransicion(cliente, {
        alEmpezar: () => cambiarVisibilidad(cliente, ocultarAlFinal, true)
      });
    }
    // 2) Y se comprueba en OBS que de verdad ya esta en su sitio antes de
    //    apagar nada.
    const confirmado = await esperarAcomodo(cliente, 'partida',
      { sinCambiarVisibilidad: ocultarAlFinal, ...opciones });
    if (juego) {
      // La comprobacion de arriba no mira al juego (lo acabamos de dejar con
      // su movimiento y ya se verifico alli); se dice en la ventana negra.
      log(`[replay] El juego ya esta a pantalla completa (${Date.now() - comienzo} ms). ` +
        'Ahora se apaga el ojito');
    } else {
      log(confirmado
        ? `[replay] Escena de vuelta (${Date.now() - comienzo} ms). Ahora se apaga el ojito`
        : '[replay] AVISO: OBS no confirmo el acomodo de partida en 1 s; se apaga el ojito igual ' +
          '(si ves un hueco, mira que las fuentes no esten bloqueadas en OBS)');
    }
    // 3) AHORA se apaga el ojito y se para el video. Ya hay juego detras.
    try { await mostrarEnEscena(cliente, config.fuenteReplay, false); } catch { /* nada */ }
    try {
      await cliente.enviar('TriggerMediaInputAction', {
        inputName: config.fuenteReplay,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
      });
    } catch { /* nada */ }
    // 4) Lo que hay en "ocultar" (tu HUD) vuelve SIEMPRE, ya sin la REPLAY
    //    encima. Aunque la foto de partida se hubiera aprendido con el HUD
    //    oculto, al terminar la repeticion tiene que estar otra vez.
    for (const nombre of ocultarAlFinal) {
      try { await mostrarEnEscena(cliente, nombre, true); }
      catch (error) { log(`[replay] Aviso: no se pudo volver a mostrar "${nombre}": ${error.message}`); }
    }
    estado.respaldo.clear();
    estado.corriendo = false;
    estado.armado = false;
    estado.enElAire = false;
    estado.movimiento = null;
    estado.recorteDesde = null;
    estado.recorteListo = null;
    log(`[replay] Repeticion terminada, escena como estaba (${Date.now() - comienzo} ms)`);
    return { estado: 'repeticion terminada',
      milisegundosDeVuelta: Date.now() - comienzo };
  }

  // Guarda el bufer y devuelve el archivo. Si OBS enciende el bufer pero no
  // escribe nada, el error lo dice claro en vez de quedarse callado.
  async function guardarBufer(cliente) {
    const antes = await cliente.enviar('GetReplayBufferStatus');
    if (!antes.outputActive) {
      log('[replay] El bufer estaba apagado: se enciende ahora');
      await cliente.enviar('StartReplayBuffer');
      await new Promise((r) => setTimeout(r, 400));
    }
    log('[replay] Guardando el bufer de OBS...');
    const aviso = cliente.esperar('ReplayBufferSaved', 12000);
    await cliente.enviar('SaveReplayBuffer');
    let archivo = null;
    try {
      ({ savedReplayPath: archivo } = await aviso);
    } catch {
      throw new Error('OBS no confirmo el guardado del bufer en 12 s. ' +
        'Casi siempre es la ruta: Ajustes > Salida > Grabación > Ruta de grabación. ' +
        'Prueba a pulsar "Guardar repetición" a mano en OBS y mira si aparece el archivo.');
    }
    if (!archivo) throw new Error('OBS guardo el bufer pero no dijo donde');
    let existe = false;
    let megabytes = 0;
    try {
      const datos = fs.statSync(archivo);
      existe = true;
      megabytes = Math.round((datos.size / (1024 * 1024)) * 10) / 10;
    } catch { /* si el archivo no aparece, se dice en la respuesta */ }
    estado.ultimoArchivo = { ruta: archivo, existe, megabytes, cuando: new Date().toISOString() };
    log(`[replay] OBS guardo el bufer: ${archivo}` +
      (existe ? ` (${megabytes} MB)` : ' — pero no aparece en disco: revisa la ruta de grabación'));
    return archivo;
  }

  // Solo el bufer: sirve para saber si OBS guarda o no, sin nada mas de por medio.
  async function probarBufer() {
    const cliente = await conectar();
    const archivo = await guardarBufer(cliente);
    const info = estado.ultimoArchivo || {};
    return {
      estado: info.existe ? 'guardado' : 'OBS dijo que guardo, pero el archivo no aparece',
      archivo,
      existe: Boolean(info.existe),
      megabytes: info.megabytes || 0,
      carpeta: path.dirname(archivo),
      pista: info.existe
        ? 'OBS guarda bien. El archivo esta en esa carpeta.'
        : 'Revisa Ajustes > Salida > Grabación > Ruta de grabación: ahi es donde cae el bufer.'
    };
  }

  async function lanzar(segundos) {
    const config = estado.config;
    const duracion = Number(segundos);
    if (!Array.isArray(config.duraciones) || !config.duraciones.includes(duracion)) {
      throw new Error(`Duracion no valida: ${segundos}. Las que hay: ${config.duraciones.join(', ')}`);
    }
    if (estado.ocupado) throw new Error('Todavia se esta preparando la repeticion anterior');
    estado.ocupado = true;
    const comienzo = Date.now();
    try {
      // Si habia otra repeticion (mostrada o solo preparada), se tira entera:
      // su archivo, su recorte y su acomodo. Asi la anterior no puede salir.
      if (estado.corriendo) await restaurar();
      estado.recorteDesde = null;
      estado.duracionBufer = 0;
      estado.duracionReal = 0;
      const cliente = await conectar();
      await sincronizarOjo(cliente);

      // 0 y 1) El bufer se enciende si hace falta y se guarda. OBS avisa
      // cuando el archivo ya esta escrito.
      const archivo = await guardarBufer(cliente);


      // 2) Se recuerda como esta la escena (solo hace falta en el modo antiguo,
      //    el de la esquina). La REPLAY NO se toca: sigue como la tengas.
      // Si un nombre de "encoger"/"ocultar" esta mal, no se hunde la
      // repeticion: se avisa y se sigue (esas dos listas son del modo antiguo).
      for (const nombre of [...(config.encoger || []), ...(config.ocultar || [])]) {
        try { await recordarFuente(cliente, nombre); }
        catch (error) { log(`[replay] Aviso: no se encontro "${nombre}" para el modo antiguo (${error.message})`); }
      }

      // 3) Cargar SOLO la repeticion nueva en la fuente REPLAY. Antes se para
      //    lo que hubiera y se limpia el cursor, para que no quede ni un
      //    fotograma de la repeticion anterior.
      await reposarVideo(cliente);
      estado.recorteDesde = null;
      await prepararRepeticion(cliente, archivo);
      log(`[replay] En la fuente REPLAY va solo la repeticion nueva: ${path.basename(archivo)}`);
      // Se pregunta por la duracion sin quedarse colgado: si OBS no la da con
      // la fuente oculta, se mide otra vez al darle al ojito (arrancar()).
      const total = await duracionDe(cliente, 12);
      estado.duracionBufer = total;
      estado.recorteDesde = null;

      // Los segundos de ESTA repeticion, antes de recortar (si no, se
      // recortaba con la duracion de la anterior).
      estado.segundos = duracion;
      // 3b) La repeticion se apunta sola en HIGHLIGHTS, ya sabiendo cuanto dura
      //     el bufer: asi se puede dejar SOLO el trozo de la repeticion (los
      //     N segundos del boton) y no los 120 s del bufer. El corte se hace
      //     aparte para no retrasar nada.
      void anotarYRefrescar(archivo, duracion, total).catch((error) =>
        log(`[replay] Aviso: la lista de HIGHLIGHTS no se pudo actualizar: ${error.message}`));

      // 4) El recorte se deja PUESTO AHORA (pausado y comprobado), mientras
      //    esperas a darle al ojito. Antes se recortaba justo al darle, y ese
      //    trabajo (parar, adelantar, comprobar) era la pausita que se veia en
      //    directo entre el clic y el video. Ahora al ojito solo queda el PLAY.
      if (total > 0) {
        log(`[replay] El bufer dura ${(total / 1000).toFixed(1)} s. Si pides ${duracion} s, ` +
          `empezara en el segundo ${(Math.max(0, total - duracion * 1000) / 1000).toFixed(1)} ` +
          'cuando le des al ojito');
        await dejarListoElRecorte(cliente);
      } else {
        log('[replay] OBS todavia no dio la duracion (fuente oculta): se mide al darle al ojito');
        estado.recorteListo = null;
        await cliente.enviar('TriggerMediaInputAction', {
          inputName: config.fuenteReplay, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
        }).catch(() => {});
      }

      // 5) Queda preparada y en pausa. Nada de mostrarla sola: la ensenas tu
      //    con el ojito, y en ese momento se pone el acomodo y arranca.
      estado.corriendo = true;
      estado.armado = true;
      estado.enElAire = false;
      estado.segundos = duracion;
      estado.terminaEn = 0;

      // El ojito se mira de verdad ahora mismo: si lo dejaste puesto, la nueva
      // se pone al aire en su sitio; si no, espera a que se lo des.
      if (await leerOjo(cliente) === true) await reaccionarAlOjo(cliente, true);

      log(`[replay] Repeticion de ${duracion} s preparada (${Date.now() - comienzo} ms). ` +
        (estado.enElAire ? 'La REPLAY ya estaba visible: va al aire' : 'Esperando el ojito de la REPLAY'));
      return {
        estado: estado.enElAire ? 'reproduciendo' : 'preparada, esperando el ojito',
        esperandoElOjo: !estado.enElAire,
        segundos: duracion, archivo,
        recorteDesde: estado.recorteDesde === null ? null : estado.recorteDesde / 1000,
        // Donde va a empezar cuando le des al ojito. El salto se hace alli y
        // alli se comprueba; aqui solo se calcula para que lo veas.
        recortePrevisto: estado.duracionBufer > 0
          ? Math.round(Math.max(0, estado.duracionBufer - duracion * 1000) / 100) / 10 : null,
        duracionBufer: estado.duracionBufer / 1000,
        seVeran: Math.round(Math.min(duracion * 1000,
          Math.max(0, (estado.duracionBufer || 0))) / 100) / 10,
        milisegundosDePreparacion: Date.now() - comienzo,
        pista: estado.enElAire ? 'la REPLAY ya estaba visible' :
          `dale al ojito de la fuente "${config.fuenteReplay}" en OBS: se vera y el juego se va a su espacio`
      };
    } finally {
      estado.ocupado = false;
    }
  }

  // Anota la repeticion en HIGHLIGHTS. Si se puede, deja SOLO el trozo que se
  // ve en la repeticion (los N segundos del boton) en vez de los 120 s del
  // bufer; si no hay ffmpeg, va el bufer completo y se dice.
  async function anotarYRefrescar(archivo, segundos, totalMs) {
    let paraLaLista = archivo;
    const desdeMs = Math.max(0, (Number(totalMs) || 0) - segundos * 1000);
    if (Number(totalMs) > 500 && buscarFfmpeg()) {
      const corte = await recortarRepeticion(archivo, desdeMs, segundos);
      if (corte.ruta) {
        paraLaLista = corte.ruta;
        log(`[replay] HIGHLIGHTS: el trozo son los ultimos ${segundos} s del bufer ` +
          `(desde el segundo ${(desdeMs / 1000).toFixed(1)}) y pesa ${corte.megabytes} MB: ` +
          `${path.basename(corte.ruta)}`);
      } else {
        log(`[replay] HIGHLIGHTS: NO se pudo cortar el trozo (${corte.error}). ` +
          `Va el bufer completo (${path.basename(archivo)}).`);
        if (corte.comando) log(`[replay]   el comando era: ${corte.comando}`);
      }
    } else if (!buscarFfmpeg()) {
      log('[replay] HIGHLIGHTS: va el bufer COMPLETO porque no se encontro ffmpeg en este ' +
        'equipo. Por eso el highlight dura 120 s en vez de los segundos del boton. ' +
        'Instalalo una vez: abre una consola (Inicio > "cmd" > Enter), escribe ' +
        '"winget install Gyan.FFmpeg", espera a que acabe y reinicia el servidor. ' +
        'Para saber si ya lo tienes: en la misma consola, "ffmpeg -version" (si contesta con ' +
        'una version, esta). El resto funciona igual sin el.');
    }
    anotarHighlight(paraLaLista, segundos);
    let h;
    try {
      h = await agregarAHighlights(paraLaLista);
    } catch (error) {
      log(`[replay] HIGHLIGHTS: no se pudo añadir la repeticion a la lista (${error.message})`);
      return { estado: 'error', error: error.message };
    }
    if (h.estado === 'añadida') {
      log(`[replay] HIGHLIGHTS: "${path.basename(paraLaLista)}" añadida al final de la lista ` +
        `de "${estado.config.highlights.fuenteVlc}" (${h.archivos} en la lista). ` +
        'No se toca nada mas: lo que quites en OBS se queda quitado.');
    } else {
      log(`[replay] HIGHLIGHTS: ${h.estado}`);
    }
    return h;
  }

  // Apunta una repeticion recien guardada en la lista de los highlights.
  // Se llama sola cada vez que se guarda el bufer: asi la fuente VLC de
  // HIGHLIGHTS va teniendo todas las repeticiones segun se hacen, sin que
  // tengas que acordarte de nada.
  function anotarHighlight(archivo, segundos) {
    const ya = estado.highlights.find((x) => x.archivo === archivo);
    if (ya) { ya.segundos = segundos; ya.cuando = new Date().toISOString(); }
    else estado.highlights.push({ archivo, segundos, cuando: new Date().toISOString() });
    guardarHighlights(estado.highlights);
    return estado.highlights.length;
  }

  // Lo que hay AHORA MISMO en la lista de la fuente VLC. Se lee de OBS, no de
  // un archivo nuestro: asi la lista de verdad es la que tu ves en OBS.
  async function leerListaHighlights(cliente) {
    const fuente = estado.config.highlights.fuenteVlc;
    const { inputSettings } = await cliente.enviar('GetInputSettings', { inputName: fuente });
    const lista = Array.isArray(inputSettings && inputSettings.playlist) ? inputSettings.playlist : [];
    return lista.map((x) => (typeof x === 'string' ? x : x && x.value)).filter(Boolean);
  }

  // Añade UNA repeticion al FINAL de la lista de HIGHLIGHTS, sin tocar lo que
  // ya hay.
  //
  // (r56) Antes se rehacia la lista entera cada vez: se volvian a poner todas
  // las repeticiones de la carpeta (o todas las apuntadas), asi que lo que
  // quitabas tu desde OBS reaparecia en la siguiente repeticion. Ahora se lee
  // la lista que hay en OBS y solo se añade la nueva.
  async function agregarAHighlights(archivo) {
    const config = estado.config;
    const escena = config.highlights.escena;
    const fuente = config.highlights.fuenteVlc;
    const cliente = await conectar();
    // La fuente tiene que existir en la escena de highlights: si no, se dice
    // claro en vez de fallar en silencio.
    try {
      await cliente.enviar('GetSceneItemId', { sceneName: escena, sourceName: fuente });
    } catch {
      const nombres = await nombresDeEscena(cliente, escena).catch(() => []);
      throw new Error(`En la escena "${escena}" no hay ninguna fuente llamada "${fuente}"` +
        (nombres.length ? `. Ahí hay: ${nombres.join(', ')}` : ' (revisa también que la escena se llame así)'));
    }
    // Y tiene que ser de tipo VLC: una fuente de medios normal no tiene lista.
    let tipo = null;
    try { tipo = (await cliente.enviar('GetInputKind', { inputName: fuente })).inputKind || null; }
    catch { /* si no contesta, se intenta igual */ }
    if (tipo && tipo !== 'vlc_source') {
      throw new Error(`La fuente "${fuente}" es de tipo "${tipo}", no VLC. ` +
        'Una fuente de medios normal no tiene lista de reproducción: cambia esa fuente por ' +
        'una de tipo "Fuente de VLC" (o añade una VLC y ponle el nombre ' + fuente + ').');
    }
    // Si esta reproduciendo, no se toca la lista (recargarla cortaria el video).
    try {
      const medio = await cliente.enviar('GetMediaInputStatus', { inputName: fuente });
      if (medio.mediaState === 'OBS_MEDIA_STATE_PLAYING') {
        return { estado: 'la fuente esta reproduciendo: no se toca la lista ahora' };
      }
    } catch { /* nada */ }
    const { inputSettings } = await cliente.enviar('GetInputSettings', { inputName: fuente });
    const ajustes = { ...(inputSettings || {}) };
    const lista = Array.isArray(ajustes.playlist) ? ajustes.playlist.slice() : [];
    const valor = (x) => (typeof x === 'string' ? x : x && x.value);
    if (lista.some((x) => valor(x) === archivo)) {
      return { estado: 'esa repeticion ya estaba en la lista (no se repite)', archivos: lista.length };
    }
    lista.push({ value: archivo, hidden: false, selected: false });
    ajustes.playlist = lista;
    await cliente.enviar('SetInputSettings', { inputName: fuente, inputSettings: ajustes, overlay: true });
    return {
      estado: 'añadida',
      archivos: lista.length,
      ultima: path.basename(archivo),
      lista: lista.map((x) => path.basename(valor(x) || ''))
    };
  }

  // GET /replay/highlights: mira que hay en la lista. NO la rehace (r56).
  async function refrescarHighlights() {
    const config = estado.config;
    const cliente = await conectar();
    const fuente = config.highlights.fuenteVlc;
    let lista = [];
    try {
      lista = await leerListaHighlights(cliente);
    } catch (error) {
      return { estado: `no se pudo leer la lista de "${fuente}": ${error.message}`, archivos: 0 };
    }
    return {
      estado: 'lista leida (no se toca)',
      archivos: lista.length,
      lista: lista.map((archivo) => path.basename(archivo)),
      ultima: lista.length ? path.basename(lista[lista.length - 1]) : null,
      pista: 'cada repeticion se añade sola al final; lo que quites tu en OBS se queda quitado'
    };
  }

  async function estadoActual() {
    let medio = null;
    try { medio = await estadoDelMedio(await conectar()); } catch { /* sin OBS */ }
    return {
      medio,
      corriendo: estado.corriendo,
      armado: estado.armado,          // preparada, en pausa, esperando el ojito
      enElAire: estado.enElAire,      // el ojito puesto y el video corriendo
      ojoVisible: estado.ojoVisible,  // como esta el ojito de la REPLAY ahora mismo
      segundos: estado.segundos,
      quedan: estado.enElAire ? Math.max(0, Math.round((estado.terminaEn - Date.now()) / 1000)) : 0,
      duraciones: estado.config.duraciones,
      escena: estado.config.escena,
      fuenteReplay: estado.config.fuenteReplay,
      ultimoArchivo: estado.ultimoArchivo,
      duracionReal: Math.round((estado.duracionReal || 0) / 100) / 10,
      recorteDesde: estado.recorteDesde === null ? null : Math.round(estado.recorteDesde / 100) / 10,
      duracionBufer: Math.round((estado.duracionBufer || 0) / 100) / 10,
      // Repeticiones apuntadas para la fuente VLC de HIGHLIGHTS.
      highlights: estado.highlights.length,
      // Si el video ya esta parado en el recorte (al ojito arranca sin pausa).
      recorteListo: Boolean(estado.recorteListo),
      // Donde va a empezar cuando le des al ojito (null si no hay nada armado).
      recortePrevisto: estado.duracionBufer > 0 && estado.segundos > 0
        ? Math.round(Math.max(0, estado.duracionBufer - estado.segundos * 1000) / 100) / 10 : null
    };
  }

  function registrarRutas() {
    if (!app) return;
    // Todo lo que se pide queda escrito en la ventana negra, y si algo falla
    // tambien: asi no hay forma de que "no salga nada" sin saber por que.
    const responder = (fn, nombre, avisar = false) => async (req, res) => {
      if (avisar) log(`[replay] Piden ${nombre}`);
      try {
        const datos = await fn(req);
        res.json({ ok: true, ...datos });
      } catch (error) {
        log(`[replay] FALLA ${nombre}: ${error.message}`);
        res.status(500).json({ ok: false, error: error.message });
      }
    };
    app.get('/replay/config', (req, res) => res.json(estado.config));
    app.post('/replay/config', (req, res) => {
      if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'Se esperaba un objeto' });
      estado.config = { ...estado.config, ...req.body };
      guardarConfig(estado.config);
      res.json(estado.config);
    });

    // GET y POST con el mismo nombre: en el Stream Deck es mas facil un GET.
    for (const metodo of ['get', 'post']) {
      if (typeof app[metodo] !== 'function') continue;
      app[metodo]('/replay/estado', responder(async () => estadoActual(), '/replay/estado'));
      app[metodo]('/replay/parar', responder(async () => restaurar(), '/replay/parar', true));
      app[metodo]('/replay/highlights', responder(async () => refrescarHighlights(), '/replay/highlights', true));
      // Solo el bufer: para saber si OBS guarda, sin nada mas de por medio.
      app[metodo]('/replay/bufer', responder(async () => probarBufer(), '/replay/bufer', true));
      app[metodo]('/replay/comprobar', responder(async () => comprobar(), '/replay/comprobar', true));
      app[metodo]('/replay/aprender/:cual', responder(async (req) => aprender(String(req.params.cual)), '/replay/aprender', true));
      // Este va el ULTIMO: se come cualquier /replay/algo.
      app[metodo]('/replay/:segundos', responder(async (req) => {
        const segundos = Number(req.params.segundos);
        if (!Number.isFinite(segundos)) throw new Error(`Falta la duracion: /replay/10, /replay/30, /replay/60 o /replay/90`);
        return lanzar(segundos);
      }, '/replay/<segundos>', true));
    }
    log(`[replay] Rutas listas: /replay/${(estado.config.duraciones || []).join(' | /replay/')}`);
  }

  // El aviso del ojito se escucha desde que arranca el servidor: asi mostrar la
  // REPLAY funciona aunque todavia no se haya pulsado ningun boton. Si OBS esta
  // cerrado, se reintenta en silencio cada 20 s.
  setTimeout(() => { conectar().catch(() => {}); }, 1500).unref?.();
  const vigilante = setInterval(() => {
    if (estado.ojoEnganchado) { clearInterval(vigilante); return; }
    conectar().catch(() => {});
  }, 20000);
  vigilante.unref?.();

  return { registrarRutas, lanzar, restaurar, refrescarHighlights, comprobar, aprender, estado: estadoActual, obs };
}

module.exports = crearReplay;
module.exports.autenticacion = autenticacion;
module.exports.POR_DEFECTO = POR_DEFECTO;
