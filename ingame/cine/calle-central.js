// Cinematica por la calle central de Abismo de los Lamentos.
//
// Que hace: pregunta al juego donde estan las dos bases y arma una secuencia de
// camara que va de la fuente azul a la fuente roja en linea recta, por la calle,
// SIN DAR LA VUELTA (el giro de la camara no cambia nunca de rumbo).
//
// r96 · EL RECORRIDO EN DOS TRAMOS, SOLO PARA EL 1 CONTRA 1
// El recorrido de una sola tirada se cambia por uno con un corte en medio:
//
//   1. Empieza un poco POR DELANTE de la fuente azul (antes empezaba detras) y
//      avanza derecho por la calle hasta la torre azul mas cercana al centro.
//   2. Corte instantaneo: la camara aparece sobre la fuente roja.
//   3. Avanza derecho hacia el centro del mapa.
//   4. Al llegar al centro se aleja hacia arriba mirando el centro durante dos
//      segundos y ahi se suelta: vuelve la camara automatica.
//
// Ninguno de los dos tramos gira: cada uno lleva su rumbo fijo y el cambio de
// rumbo ocurre en el corte, de un fotograma al siguiente.
//
// De donde salen las coordenadas: del propio juego, por la API del cliente
// (https://127.0.0.1:2999/liveclientdata/playerlist). Al empezar la partida los
// jugadores de cada equipo estan en su fuente, asi que la media de sus
// posiciones es la base. Se guardan en cine/bases-abismo.json para no tener que
// volver a leerlas: en Abismo las fuentes no se mueven de partida a partida.
// Las torres llegan en el GameInfo del sensor (game.Turrets).
//
// Todo es defensivo: si el juego no responde, devuelve null y quien llama se
// queda con la secuencia de siempre.

const fs = require('fs');
const path = require('path');
const https = require('https');

const CINE_DIR = path.join(__dirname);
const BASES_PATH = path.join(CINE_DIR, 'bases-abismo.json');

// ------------------------------------------------------------------ ajustes --
// Se pueden cambiar desde cinematica.json (bloque "calle") y se quedan aqui
// como valores por defecto.
const AJUSTES = {
  duracion: 25,        // segundos que dura la cinematica
  cada: 0.5,           // segundos entre fotogramas
  altura: 1600,        // altura de la camara sobre el suelo de la calle
  arco: 250,           // cuanto sube de mas por el medio (0 = plano)
  retroceso: 0.08,     // empieza un 8 % de la calle por detras de la fuente azul
  adelanto: 0.05,      // y acaba un 5 % por delante de la roja
  pitchInicio: 66,     // picado al empezar (mas a vista de pajaro)
  pitchFin: 48,        // y mas rasante al llegar
  fov: 54,

  // r96 · recorrido en dos tramos (1 contra 1)
  adelantoInicio: 0,     // 0 = justo donde aparece el campeon; >0 se adelanta
  fraccionTorre: 0.42,   // sin torres: el primer tramo acaba al 42 % de la calle
  duracionIda: 8,        // fuente azul → torre azul mas cercana al centro
  duracionVuelta: 8,     // fuente roja → centro del mapa
  duracionSubida: 2,     // se aleja hacia arriba en el centro, mirandolo
  corte: 0,              // 0 = los dos fotogramas del corte van en el mismo instante
  alturaSubida: 1300,    // cuanto sube de mas al final
  pitchSubida: 86,       // y cuanto se empina mirando al centro
  giroSubida: 90         // r96g · grados que gira mientras sube, para que los
                         // spawns queden a los lados y no delante y detras
};

// ------------------------------------------------------- peticiones al juego --
function pedirJuego(ruta) {
  return new Promise((resolve, reject) => {
    const peticion = https.request({
      hostname: '127.0.0.1',
      port: 2999,
      path: ruta,
      method: 'GET',
      rejectUnauthorized: false
    }, respuesta => {
      const trozos = [];
      respuesta.on('data', t => trozos.push(t));
      respuesta.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8');
        if (respuesta.statusCode !== 200) {
          reject(new Error(`HTTP ${respuesta.statusCode} en ${ruta}`));
          return;
        }
        try { resolve(JSON.parse(texto)); }
        catch (error) { reject(new Error(`respuesta no es JSON en ${ruta}`)); }
      });
    });
    // Corto a proposito: esta consulta nunca debe retrasar el envio de la
    // secuencia. Si el juego no contesta en poco mas de un segundo, se sigue
    // como si no fuera Abismo y la cinematica sale a su hora.
    peticion.setTimeout(1200, () => peticion.destroy(new Error('el juego no respondio a tiempo')));
    peticion.on('error', reject);
    peticion.end();
  });
}

// ------------------------------------------------------------ lo del mapa ----
// Abismo de los Lamentos es el mapa 12. Tambien se acepta por nombre o modo, por
// si algun dia cambia la numeracion.
function esAbismo(estadisticas) {
  if (!estadisticas) return false;
  const numero = Number(estadisticas.mapNumber);
  if (numero === 12) return true;
  const texto = `${estadisticas.mapName || ''} ${estadisticas.gameMode || ''}`.toLowerCase();
  return /abismo|abyss|aram/.test(texto);
}

async function leerPartida() {
  // Las dos consultas a la vez: asi lo peor que puede pasar es esperar el tope
  // de una sola (1,2 s), no el de las dos seguidas.
  const [estadisticas, jugadores] = await Promise.all([
    pedirJuego('/liveclientdata/gamestats').catch(() => null),
    pedirJuego('/liveclientdata/playerlist').catch(() => null)
  ]);
  // r89 · Si el juego no contesto, NO es que no sea Abismo: es que no se sabe.
  // Antes se devolvia "no es Abismo" y la cinematica de la Grieta se quedaba
  // pegada para toda la partida, aunque el juego hablara un segundo despues.
  if (!estadisticas) return null;
  return {
    abismo: esAbismo(estadisticas),
    mapa: estadisticas.mapName || estadisticas.mapNumber || '?',
    numeroMapa: Number(estadisticas.mapNumber),
    modo: estadisticas.gameMode || '?',
    jugadores: Array.isArray(jugadores) ? jugadores : []
  };
}

// Media de las posiciones de un equipo. Si no hay nadie, null.
function centroDe(jugadores, equipo) {
  const suyos = jugadores.filter(j => j && j.team === equipo && j.position &&
    Number.isFinite(Number(j.position.x)) && Number.isFinite(Number(j.position.z)));
  if (!suyos.length) return null;
  const suma = suyos.reduce((acc, j) => ({
    x: acc.x + Number(j.position.x),
    y: acc.y + Number(j.position.y || 0),
    z: acc.z + Number(j.position.z)
  }), { x: 0, y: 0, z: 0 });
  return { x: suma.x / suyos.length, y: suma.y / suyos.length, z: suma.z / suyos.length, cuantos: suyos.length };
}

// Lee las dos bases del juego. Devuelve null si no se puede.
async function leerBases(partidaPrevia) {
  return (await leerBasesDetallado(partidaPrevia)).bases;
}

// r96b · Lo mismo, pero diciendo por que no se pudo. El tope de distancia era de
// 6000 unidades y en Abismo la calle puede pasar de ahi: con el tope viejo la
// cinematica se caia a la de la Grieta sin decir nada. Ahora el margen es
// amplio y, si no cuadra, queda escrito el motivo.
async function leerBasesDetallado(partidaPrevia) {
  const partida = partidaPrevia || await leerPartida();
  if (!partida) return { bases: null, motivo: 'el juego no contesto (ni mapa ni jugadores)' };
  const azul = centroDe(partida.jugadores, 'ORDER');
  const rojo = centroDe(partida.jugadores, 'CHAOS');
  if (!azul || !rojo) return { bases: null, motivo: `no hay jugadores de los dos equipos en la lista (${partida.jugadores.length} jugadores)` };
  const distancia = Math.hypot(rojo.x - azul.x, rojo.z - azul.z);
  if (!(distancia > 100)) return { bases: null, motivo: `las dos fuentes salen a ${distancia.toFixed(0)} unidades: los jugadores no estan en la fuente` };
  if (distancia > 20000) return { bases: null, motivo: `las dos fuentes salen a ${distancia.toFixed(0)} unidades: parece otro mapa` };
  return { bases: { azul, rojo, distancia, mapa: partida.mapa, modo: partida.modo, origen: 'juego', cuando: new Date().toISOString() }, motivo: null };
}

// r96b · Las dos bases sacadas del GameInfo del sensor, sin preguntar al juego.
// En el 1 contra 1 cada equipo tiene un campeon y su posicion llega en cada
// GameInfo: la media por equipo da la fuente (o, si ya han salido, dos puntos
// sobre la calle, que para el rumbo sirven igual).
function basesDelGameInfo(game) {
  const heroes = Array.isArray(game?.Heroes) ? game.Heroes : [];
  const deEquipo = equipo => heroes.filter(heroe => {
    const team = Number(heroe?.Info?.Team);
    const posicion = heroe?.Info?.Position;
    return team === equipo && posicion
      && Number.isFinite(Number(posicion.x)) && Number.isFinite(Number(posicion.z));
  });
  const calcular = lista => {
    if (!lista.length) return null;
    const suma = lista.reduce((acc, heroe) => ({
      x: acc.x + Number(heroe.Info.Position.x),
      y: acc.y + Number(heroe.Info.Position.y || 0),
      z: acc.z + Number(heroe.Info.Position.z)
    }), { x: 0, y: 0, z: 0 });
    return { x: suma.x / lista.length, y: suma.y / lista.length, z: suma.z / lista.length, cuantos: lista.length };
  };
  const azul = calcular(deEquipo(1));
  const rojo = calcular(deEquipo(2));
  if (!azul || !rojo) return { bases: null, motivo: `en el GameInfo no estan los dos equipos (${heroes.length} campeones)` };
  const distancia = Math.hypot(rojo.x - azul.x, rojo.z - azul.z);
  if (!(distancia > 100)) return { bases: null, motivo: `los dos campeones estan a ${distancia.toFixed(0)} unidades: no sirve para la calle` };
  if (distancia > 20000) return { bases: null, motivo: `los dos campeones estan a ${distancia.toFixed(0)} unidades: parece otro mapa` };
  return { bases: { azul, rojo, distancia, origen: 'GameInfo', cuando: new Date().toISOString() }, motivo: null };
}

function guardarBases(bases) {
  try {
    fs.writeFileSync(BASES_PATH, JSON.stringify(bases, null, 2));
    return true;
  } catch { return false; }
}

function basesGuardadas() {
  try {
    const datos = JSON.parse(fs.readFileSync(BASES_PATH, 'utf8'));
    if (datos && datos.azul && datos.rojo) return datos;
  } catch { /* nada */ }
  return null;
}

// ------------------------------------------------------------- la secuencia --
function smootherstep(t) {
  // Arranca y frena suave: 6t^5 - 15t^4 + 10t^3
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Arma la secuencia completa a partir de las dos bases.
// plantilla: la secuencia vieja, para copiarle el ambiente (fov, niebla...).
function construirSecuencia(bases, ajustes = {}, plantilla = null) {
  if (!bases || !bases.azul || !bases.rojo) return null;
  const cfg = { ...AJUSTES, ...ajustes };
  const duracion = Math.max(3, Number(cfg.duracion) || 25);
  const cada = Math.max(0.1, Number(cfg.cada) || 0.5);

  const a = bases.azul, b = bases.rojo;
  const dx = b.x - a.x, dz = b.z - a.z;
  const distancia = Math.hypot(dx, dz) || 1;

  // Rumbo: el mismo que se sigue al ir de la fuente azul a la roja. No cambia
  // ni una vez en toda la toma: de ahi que no "de la vuelta".
  const yaw = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;

  const desde = {
    x: a.x - dx * cfg.retroceso,
    y: a.y,
    z: a.z - dz * cfg.retroceso
  };
  const hasta = {
    x: b.x + dx * cfg.adelanto,
    y: b.y,
    z: b.z + dz * cfg.adelanto
  };

  const posiciones = [];
  const rotaciones = [];
  const fovs = [];
  const total = Math.round(duracion / cada);
  for (let i = 0; i <= total; i++) {
    const t = Math.min(duracion, i * cada);
    const avance = total ? i / total : 1;
    const suave = smootherstep(avance);
    const x = desde.x + (hasta.x - desde.x) * suave;
    const z = desde.z + (hasta.z - desde.z) * suave;
    const y = desde.y + (hasta.y - desde.y) * suave +
      Number(cfg.altura) + Math.sin(Math.PI * avance) * Number(cfg.arco);
    const pitch = Number(cfg.pitchInicio) + (Number(cfg.pitchFin) - Number(cfg.pitchInicio)) * suave;
    posiciones.push({ blend: 'linear', time: Number(t.toFixed(3)), value: { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), z: Number(z.toFixed(2)) } });
    rotaciones.push({ blend: 'linear', time: Number(t.toFixed(3)), value: { x: Number(yaw.toFixed(2)), y: Number(pitch.toFixed(2)), z: 0 } });
    fovs.push({ blend: 'linear', time: Number(t.toFixed(3)), value: Number(cfg.fov) });
  }

  // Se parte de la plantilla vieja (para conservar todas las claves que espera
  // el juego) y se le cambian solo las tres pistas que usamos.
  let salida = plantilla ? JSON.parse(JSON.stringify(plantilla)) : {};
  salida.cameraPosition = posiciones;
  salida.cameraRotation = rotaciones;
  salida.fieldOfView = fovs;
  return { secuencia: salida, duracion, yaw, distancia, fotogramas: posiciones.length };
}

// --------------------------------------- el recorrido en dos tramos (r96) ----
function yawDe(dx, dz) {
  return ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
}

// La torre del equipo indicado que esta mas cerca del centro de la calle.
// Acepta las torres tal y como llegan en el GameInfo (game.Turrets, con
// Info.Team e Info.Position) o ya recortadas por el servidor (team, position).
// Si hay alguna viva se prefiere una viva.
function torreMasCercanaAlCentro(torres, equipo, centro) {
  const lista = Array.isArray(torres) ? torres : [];
  const deEquipo = [];
  for (const torre of lista) {
    const bruto = torre?.Info?.Team ?? torre?.team;
    const team = Number(bruto);
    if (team !== equipo) continue;
    const posicion = torre?.Info?.Position || torre?.position || null;
    const x = Number(posicion?.x);
    const z = Number(posicion?.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const vivo = torre?.Common?.IsAlive ?? torre?.alive;
    deEquipo.push({ x, y: Number.isFinite(Number(posicion?.y)) ? Number(posicion.y) : null, z, vivo: vivo !== false });
  }
  if (!deEquipo.length) return null;
  const vivas = deEquipo.filter(torre => torre.vivo);
  const candidatas = vivas.length ? vivas : deEquipo;
  let mejor = candidatas[0];
  let mejorDistancia = Math.hypot(mejor.x - centro.x, mejor.z - centro.z);
  for (const torre of candidatas) {
    const distancia = Math.hypot(torre.x - centro.x, torre.z - centro.z);
    if (distancia < mejorDistancia) { mejor = torre; mejorDistancia = distancia; }
  }
  return mejor;
}

// Arma el recorrido en dos tramos: fuente azul → torre azul mas cercana al
// centro, corte, fuente roja → centro, y se aleja hacia arriba mirando el
// centro. Sin giros en ningun tramo: el unico cambio de rumbo es el corte.
// torres: game.Turrets del GameInfo (puede ser null: entonces el primer tramo
// acaba a una fraccion fija de la calle).
function construirSecuenciaRelevo(bases, torres, ajustes = {}, plantilla = null, origenes = null) {
  if (!bases || !bases.azul || !bases.rojo) return null;
  const cfg = { ...AJUSTES, ...ajustes };
  const a = bases.azul;
  const b = bases.rojo;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distancia = Math.hypot(dx, dz) || 1;
  const ux = dx / distancia;
  const uz = dz / distancia;
  const centro = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const altura = Number(cfg.altura) || 0;
  const arco = Number(cfg.arco) || 0;
  // r96f · Un solo nivel de referencia para TODO el recorrido. Antes la altura se
  // medía desde la y de cada punto, y la y del spawn y la de la torre no son
  // iguales: en el corte la cámara pegaba un salto vertical y se veía como si
  // saliera del suelo. Ahora la altura es la misma en los tres tramos y el corte
  // solo mueve la cámara de lado, nunca de arriba abajo.
  const nivel = (Number(a.y || 0) + Number(b.y || 0)) / 2;
  const adelanto = distancia * (Number(cfg.adelantoInicio) || 0);

  // Punto de salida: donde aparece el campeon (el spawn), que esta detras del
  // nexo. Si no se sabe, la fuente que se haya podido leer, un poco por delante.
  const spawnAzul = origenes?.azul || null;
  const spawnRojo = origenes?.rojo || null;
  const salidaAzul = spawnAzul
    ? { x: Number(spawnAzul.x) + ux * adelanto, y: nivel, z: Number(spawnAzul.z) + uz * adelanto }
    : { x: a.x + ux * adelanto, y: nivel, z: a.z + uz * adelanto };

  // r96f · El primer tramo va del spawn azul al CENTRO del mapa, derecho y sin
  // subir. Antes acababa en la torre azul mas cercana al centro; ahora llega
  // igual de lejos que el tramo rojo. Las torres ya no hacen falta para esto,
  // pero se siguen leyendo para el diagnostico.
  const torre = torreMasCercanaAlCentro(torres, 1, centro);
  const finIda = { x: centro.x, y: nivel, z: centro.z };

  // Corte: la camara aparece sobre la fuente roja, un poco por delante en el
  // sentido en el que va a avanzar (hacia el centro).
  const salidaRoja = spawnRojo
    ? { x: Number(spawnRojo.x) - ux * adelanto, y: nivel, z: Number(spawnRojo.z) - uz * adelanto }
    : { x: b.x - ux * adelanto, y: nivel, z: b.z - uz * adelanto };
  const llegadaCentro = { x: centro.x, y: nivel, z: centro.z };

  const yawIda = yawDe(ux, uz);
  const yawVuelta = yawDe(-ux, -uz);
  const pitchInicio = Number(cfg.pitchInicio);
  const pitchFin = Number(cfg.pitchFin);
  // r96e · El corte va en el MISMO instante que el ultimo fotograma del primer
  // tramo. Antes se separaban 0,02 s y el juego rellenaba ese hueco interpolando:
  // la camara cruzaba media calle en dos centesimas y se veia el suelo pasar a
  // ras, que es el efecto raro. Con el mismo instante no hay nada que interpolar.
  const corte = Math.max(0, Number(cfg.corte) || 0);

  const posiciones = [];
  const rotaciones = [];
  const fovs = [];
  const redondear = valor => Number(valor.toFixed(2));
  const empujar = (t, posicion, yaw, pitch) => {
    const tiempo = Number(t.toFixed(3));
    posiciones.push({ blend: 'linear', time: tiempo, value: { x: redondear(posicion.x), y: redondear(posicion.y), z: redondear(posicion.z) } });
    rotaciones.push({ blend: 'linear', time: tiempo, value: { x: redondear(yaw), y: redondear(pitch), z: 0 } });
    fovs.push({ blend: 'linear', time: tiempo, value: Number(cfg.fov) });
  };

  // Un tramo recto: misma direccion todo el rato, arranca y frena suave.
  function tramo(tInicio, duracion, desde, hasta, yaw, saltarPrimero) {
    const cada = Math.max(0.1, Number(cfg.cada) || 0.5);
    const pasos = Math.max(1, Math.round(duracion / cada));
    // El primer fotograma de un tramo que empieza donde acaba otro ya esta
    // puesto: repetirlo dejaria dos fotogramas con el mismo tiempo.
    for (let i = saltarPrimero ? 1 : 0; i <= pasos; i++) {
      const avance = i / pasos;
      const suave = smootherstep(avance);
      const x = desde.x + (hasta.x - desde.x) * suave;
      const z = desde.z + (hasta.z - desde.z) * suave;
      const y = desde.y + (hasta.y - desde.y) * suave + altura +
        Math.sin(Math.PI * avance) * arco;
      const pitch = pitchInicio + (pitchFin - pitchInicio) * suave;
      empujar(tInicio + duracion * avance, { x, y, z }, yaw, pitch);
    }
    return tInicio + duracion;
  }

  const duracionIda = Math.max(1, Number(cfg.duracionIda) || 8);
  const duracionVuelta = Math.max(1, Number(cfg.duracionVuelta) || 8);
  const duracionSubida = Math.max(0.5, Number(cfg.duracionSubida) || 2);

  // 1) Derecho por la calle: fuente azul → torre azul mas cercana al centro.
  const finIdaT = tramo(0, duracionIda, salidaAzul, finIda, yawIda, false);

  // 2) Corte instantaneo sobre el campeon rojo: dos fotogramas en el mismo
  //    instante (o separados lo que diga el ajuste "corte").
  const tCorte = finIdaT + corte;
  // r96f · Aquí estaba el fallo del "sale del suelo": este fotograma se empujaba
  // con la y del suelo, sin sumarle la altura de vuelo (los demás la suman
  // dentro de tramo()). Así la cámara caía 1600 unidades justo en el corte.
  empujar(tCorte, { x: salidaRoja.x, y: salidaRoja.y + altura, z: salidaRoja.z }, yawVuelta, pitchInicio);

  // 3) Derecho hacia el centro del mapa.
  const finVuelta = tramo(tCorte, duracionVuelta, salidaRoja, llegadaCentro, yawVuelta, true);

  // 4) Se aleja hacia arriba mirando al centro (misma x y z, mas alto, mas
  //    empinado) y ahi se acaba: el servidor suelta la secuencia y vuelve la
  //    camara automatica.
  const tSubida = finVuelta;
  const cadaSubida = Math.max(0.1, Number(cfg.cada) || 0.5);
  const pasosSubida = Math.max(1, Math.round(duracionSubida / cadaSubida));
  const alturaBase = llegadaCentro.y + altura;
  const alturaExtra = Number(cfg.alturaSubida) || 0;
  const pitchSubida = Number(cfg.pitchSubida);
  // r96g · Mientras sube, la camara gira 90 grados: asi la calle deja de estar
  // delante y detras y los dos spawns quedan a los lados de la imagen.
  const giroSubida = Number(cfg.giroSubida) || 0;
  const yawFinal = yawVuelta + giroSubida;
  for (let i = 1; i <= pasosSubida; i++) {
    const avance = i / pasosSubida;
    const suave = smootherstep(avance);
    empujar(
      tSubida + duracionSubida * avance,
      { x: llegadaCentro.x, y: alturaBase + alturaExtra * suave, z: llegadaCentro.z },
      yawVuelta + giroSubida * suave,
      pitchFin + (pitchSubida - pitchFin) * suave
    );
  }

  const duracionTotal = Number((tSubida + duracionSubida).toFixed(3));

  let salida = plantilla ? JSON.parse(JSON.stringify(plantilla)) : {};
  salida.cameraPosition = posiciones;
  salida.cameraRotation = rotaciones;
  salida.fieldOfView = fovs;
  return {
    secuencia: salida,
    duracion: duracionTotal,
    yaw: yawIda,
    yawVuelta,
    yawFinal,
    distancia,
    fotogramas: posiciones.length,
    corteEn: Number(tCorte.toFixed(3)),
    desdeSpawn: { azul: !!spawnAzul, rojo: !!spawnRojo },
    torre: torre ? { x: redondear(torre.x), z: redondear(torre.z) } : null,
    centro: { x: redondear(centro.x), z: redondear(centro.z) }
  };
}

module.exports = {
  AJUSTES,
  esAbismo,
  leerPartida,
  leerBases,
  leerBasesDetallado,
  basesDelGameInfo,
  guardarBases,
  basesGuardadas,
  construirSecuencia,
  construirSecuenciaRelevo,
  torreMasCercanaAlCentro,
  BASES_PATH
};
