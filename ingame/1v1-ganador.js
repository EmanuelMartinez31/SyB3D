// ============================================================================
// 1 VS 1: QUIÉN GANA LA PARTIDA
//
// En la Grieta la partida termina cuando cae un nexo, y de eso ya se encarga
// detectGameWinner. En el Abismo no hay nexo: la partida se gana con la
// PRIMERA de las tres reglas (primera torre, primeros 100 CS, primera kill).
// Aquí se detecta esa primera regla y se reporta con el mismo endpoint que usa
// el nexo (POST /series/game-winner), así que la serie suma igual que en 5v5.
//
// Se usan los MISMOS tres criterios, en el mismo orden y con la misma forma de
// decidir que el overlay (ingame/overlay/src/render.js → renderUnoContraUno y
// decidirVictoria): no gana la primera que se ve, gana la que ocurrió ANTES en
// el reloj de la partida. Así el cartel que ve el espectador y el punto que se
// apunta no pueden discrepar.
//
// Este módulo no toca nada por su cuenta: todo lo que necesita se lo pasa
// server.js.
// ============================================================================

module.exports = function crearGanadorUnoContraUno(opciones) {
  const {
    httpRequestJson,
    draftOrigin,
    getRevision,
    reportedWinners,
    winnerReportsInFlight,
    finiteNumber,
    log = () => {}
  } = opciones;

  const NOMBRE_REGLA = { kill: 'primera kill', torre: 'primera torre', cs: 'primeros 100 CS' };

  // Espera, en segundos de partida, antes de dar el punto. Sirve para que
  // aparezcan las tres reglas del mismo fotograma (al encender el HUD con la
  // partida empezada) y se pueda elegir la más antigua sin equivocarse: un
  // punto ya reportado no se puede deshacer. No se nota en pantalla porque el
  // cartel de victoria sale al instante.
  const ESPERA_S = 8;

  let estado = nuevoEstado(null);
  function nuevoEstado(gameId) {
    return { gameId, anotadas: {}, vistaEn: null, regla: null, equipo: null, gameTime: null };
  }

  function reiniciar() {
    estado = nuevoEstado(null);
  }

  const instante = cuando => (finiteNumber(cuando) !== null ? cuando : Infinity);

  // Igual que decidirVictoria del overlay: la más antigua; a igualdad gana la
  // primera en el orden kill → torre → cs, que es el orden en que se apuntan.
  function elegir() {
    const reglas = ['kill', 'torre', 'cs'].filter(regla => estado.anotadas[regla]);
    if (!reglas.length) return null;
    let mejor = reglas[0];
    for (const regla of reglas) {
      if (instante(estado.anotadas[regla].cuando) < instante(estado.anotadas[mejor].cuando)) mejor = regla;
    }
    return { regla: mejor, ...estado.anotadas[mejor] };
  }

  // Primera muerte de campeón a manos de otro campeón, leída del GameInfo
  // crudo (GameEvents.DeathEvents). Solo se usa cuando el server.js no manda
  // el feed de asesinatos: es la única forma de tenerla.
  function primeraKillCruda(state, juego) {
    const eventos = Array.isArray(juego?.GameEvents?.DeathEvents) ? juego.GameEvents.DeathEvents : null;
    if (!eventos) return null;
    const porId = new Map();
    for (const jugador of Array.isArray(state?.players) ? state.players : []) {
      const id = finiteNumber(jugador?.id);
      if (id !== null) porId.set(id, jugador);
    }
    for (const evento of eventos) {
      const victima = finiteNumber(evento?.VictimNetworkId);
      const matador = finiteNumber(evento?.KillerNetworkId);
      if (victima === null || matador === null) continue;
      if (!porId.has(victima) || !porId.has(matador)) continue;
      const equipo = finiteNumber(porId.get(matador)?.team);
      if (equipo === 1 || equipo === 2) {
        return { equipo, cuando: finiteNumber(evento?.GameTime) ?? finiteNumber(state?.meta?.gameTime) };
      }
    }
    return null;
  }

  // Devuelve { regla, equipo, cuando, listo } o null mientras no haya nada.
  function analizar(state, juego = null) {
    if (String(state?.info?.modo || '') !== '1v1') return null;
    const gameId = state?.meta?.gameId;
    if (gameId === null || gameId === undefined) return null;
    const clave = String(gameId);
    if (estado.gameId !== clave) estado = nuevoEstado(clave);

    const gameTime = finiteNumber(state?.meta?.gameTime);
    const anotar = (regla, equipo, cuando) => {
      if (estado.anotadas[regla]) return;
      estado.anotadas[regla] = { equipo, cuando: finiteNumber(cuando) };
    };

    // 1) Primera kill. Dos fuentes, para que funcione con cualquier versión del
    //    server.js: el feed de asesinatos (lo mismo que lee el cartel del HUD)
    //    y, si esa versión no manda feed, las muertes crudas del GameInfo.
    const asesinatos = Array.isArray(state?.killFeed?.asesinatos) ? state.killFeed.asesinatos : [];
    const killDelFeed = asesinatos.find(asesinato => asesinato?.victim?.tipo === 'campeon');
    if (killDelFeed) {
      const equipo = finiteNumber(killDelFeed?.killer?.team);
      if (equipo === 1 || equipo === 2) anotar('kill', equipo, killDelFeed.gameTime);
    } else {
      const muerte = primeraKillCruda(state, juego);
      if (muerte) anotar('kill', muerte.equipo, muerte.cuando);
    }

    // 2) Primera torre: la del feed si ya está; si no, la primera que aparece
    //    caída (el punto es para el otro equipo, que es el que la tiró).
    const primeraTorreFeed = asesinatos.find(asesinato => asesinato?.victim?.tipo === 'torre');
    if (primeraTorreFeed) {
      const equipo = finiteNumber(primeraTorreFeed?.killer?.team);
      if (equipo === 1 || equipo === 2) anotar('torre', equipo, primeraTorreFeed.gameTime);
    } else if (gameTime !== null) {
      const torres = Array.isArray(state?.structures?.turrets) ? state.structures.turrets : [];
      const caida = torres.find(torre => torre?.alive === false
        && torre?.countsTowardTowers !== false
        && (finiteNumber(torre?.team) === 1 || finiteNumber(torre?.team) === 2));
      if (caida) anotar('torre', finiteNumber(caida.team) === 1 ? 2 : 1, gameTime);
    }

    // 3) Primeros 100 CS.
    if (gameTime !== null) {
      const jugadores = Array.isArray(state?.players) ? state.players : [];
      for (const equipo of [1, 2]) {
        const jugador = jugadores.find(item => finiteNumber(item?.team) === equipo) || null;
        const cs = finiteNumber(jugador?.cs?.total);
        if (cs !== null && cs >= 100) { anotar('cs', equipo, gameTime); break; }
      }
    }

    const elegida = elegir();
    if (!elegida) return null;

    // Reloj de referencia: si el juego aún no manda tiempo, no se decide nada.
    if (gameTime === null) return { ...elegida, listo: false };
    if (estado.vistaEn === null) estado.vistaEn = gameTime;
    const listo = gameTime - estado.vistaEn >= ESPERA_S;
    return { ...elegida, listo };
  }

  function detectar(state, juego = null) {
    const resultado = analizar(state, juego);
    if (!resultado || !resultado.listo) return null;
    return { gameId: estado.gameId, regla: resultado.regla, equipo: resultado.equipo, gameTime: resultado.cuando };
  }

  async function reportar(state, juego = null) {
    const resultado = detectar(state, juego);
    if (!resultado) return;
    const gameId = resultado.gameId;
    if (reportedWinners.has(gameId) || winnerReportsInFlight.has(gameId)) {
      if (!estado.regla) { estado.regla = resultado.regla; estado.equipo = resultado.equipo; estado.gameTime = resultado.gameTime; }
      return;
    }
    winnerReportsInFlight.add(gameId);
    const equipo = resultado.equipo;
    const ganador = equipo === 1 ? 'blue' : 'red';
    const jugador = (Array.isArray(state?.players) ? state.players : [])
      .find(item => finiteNumber(item?.team) === equipo) || null;
    try {
      const response = await httpRequestJson(`${draftOrigin}/series/game-winner`, 'POST', {
        gameId,
        winner: ganador,
        losingTeam: equipo === 1 ? 2 : 1,
        gameTime: resultado.gameTime,
        regla: resultado.regla,
        winnerPlayer: jugador?.player ?? null,
        revision: typeof getRevision === 'function' ? getRevision() : undefined
      });
      if (response?.ok) {
        reportedWinners.add(gameId);
        estado.regla = resultado.regla;
        estado.equipo = equipo;
        estado.gameTime = resultado.gameTime;
        const como = response.stale ? 'partida anterior descartada'
          : response.duplicate ? 'ya estaba registrada'
            : response.pending ? 'pendiente hasta Siguiente juego'
              : 'registrada';
        log(`1v1: victoria ${ganador} por ${NOMBRE_REGLA[resultado.regla]} | juego=${gameId} | t=${Math.round(resultado.gameTime ?? 0)} s | ${como}`);
      }
    } catch (error) {
      // Se reintenta en el siguiente GameInfo: no se marca como reportado.
      log(`1v1: no se pudo reportar la victoria; se reintentará (${error.message})`);
    } finally {
      winnerReportsInFlight.delete(gameId);
    }
  }

  function estadoActual() {
    return {
      gameId: estado.gameId,
      regla: estado.regla,
      equipo: estado.equipo,
      gameTime: estado.gameTime,
      anotadas: Object.keys(estado.anotadas)
    };
  }

  return { detectar, analizar, reportar, reiniciar, estadoActual };
};
