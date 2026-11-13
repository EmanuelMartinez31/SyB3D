// POSTPARTIDA · VENTAJA DE ORO
// Dos cosas, con los tiempos acordados:
//   1. A los 15 s, en cada tarjeta aparece una franja ENCIMA del modelo (no lo
//      mueve) con el oro del jugador contra el rival de su misma línea.
//   2. A los 35 s las franjas se retiran y entra un panel central con la
//      ventaja entre los dos equipos; a los 55 s el panel se va.
// El eje se ajusta a la diferencia máxima de la gráfica, partida en tres tramos
// por lado (máximo 2500 → 3000: 1000 / 2000 / 3000).
// Si el resumen no trae serie de oro (partidas anteriores o sin grabación), no
// se dibuja nada: nunca se inventan valores.

const SVG_NS = 'http://www.w3.org/2000/svg';
const T_FRANJAS = 15000;
const T_PANEL = 35000;
const T_FUERA = 55000;
const ESCALON_TARJETA = 110;
const TRAZO_FRANJA = 1700;
const TRAZO_PANEL = 2600;
const ROLE_LABELS = { TOP: 'TOP', JUNGLE: 'JG', MIDDLE: 'MID', BOTTOM: 'ADC', UTILITY: 'SUP' };

const numberFormat = new Intl.NumberFormat('es-ES');

// 1. 2345 → 2,3k (para los ejes, donde no cabe el número completo)
function compacto(valor) {
  const absoluto = Math.abs(valor);
  if (absoluto < 1000) return String(Math.round(absoluto));
  const miles = absoluto / 1000;
  return `${miles.toFixed(miles % 1 === 0 ? 0 : 1).replace('.', ',')}k`;
}
function conSigno(valor) {
  const redondeado = Math.round(valor);
  const signo = redondeado > 0 ? '+' : redondeado < 0 ? '−' : '';
  return `${signo}${compacto(redondeado)}`;
}
function reloj(segundos) {
  const total = Math.max(0, Math.round(segundos));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function nodo(tipo, atributos = {}, texto = null) {
  const elemento = document.createElementNS(SVG_NS, tipo);
  for (const [clave, valor] of Object.entries(atributos)) {
    elemento.setAttribute(clave, String(valor));
  }
  if (texto !== null) elemento.textContent = texto;
  return elemento;
}

// ============================================================================
// 1. ESCALA
// El techo sale de la diferencia MÁXIMA de esa gráfica, redondeado a un número
// redondo y partido en tres tramos por lado.
// ============================================================================
function techoDe(maximo) {
  const objetivo = Math.max(1, maximo) / 3;
  const escalones = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const decada = 10 ** Math.floor(Math.log10(objetivo));
  let paso = decada * 10;
  for (const escalon of escalones) {
    if (decada * escalon >= objetivo) {
      paso = decada * escalon;
      break;
    }
  }
  return { paso, techo: paso * 3 };
}

// ============================================================================
// 2. DIBUJO DE UNA GRÁFICA DE DIFERENCIA
// Azul por encima del cero y rojo por debajo, con línea fina y puntos: el estilo
// de la referencia. Devuelve las escalas para poder colocar marcas después.
// ============================================================================
function dibujarDiferencia(svg, opciones) {
  const {
    serie, techo, duracion, ancho, alto, izq, der, arr, aba,
    colorPos, colorNeg, colorLinea, ejeY = 3, ejeXtics = 6, puntosCada = 60,
    idBase, tamEje = 11, radio = 2.6
  } = opciones;
  const X = (t) => izq + (t / Math.max(1, duracion)) * (ancho - izq - der);
  const medio = arr + (alto - aba - arr) / 2;
  const Y = (v) => medio - (v / techo) * ((alto - aba - arr) / 2);
  svg.replaceChildren();

  // Rejilla horizontal y etiquetas del eje vertical.
  for (let i = -ejeY; i <= ejeY; i += 1) {
    const valor = (techo / ejeY) * i;
    const cero = i === 0;
    svg.appendChild(
      nodo('line', {
        x1: izq, y1: Y(valor).toFixed(1), x2: ancho - der, y2: Y(valor).toFixed(1),
        stroke: cero ? '#3a4d64' : '#1e2937', 'stroke-width': cero ? 1.3 : 1
      })
    );
    svg.appendChild(
      nodo(
        'text',
        {
          x: izq - 10, y: (Y(valor) + 3.5).toFixed(1), fill: '#8b9bb0',
          'font-size': tamEje, 'text-anchor': 'end'
        },
        cero ? '0' : conSigno(valor)
      )
    );
  }
  // Tiempo bajo el eje (en las tarjetas no cabe: van en la línea de abajo).
  for (let n = 0; n < ejeXtics; n += 1) {
    const t = (duracion / Math.max(1, ejeXtics - 1)) * n;
    svg.appendChild(
      nodo(
        'text',
        {
          x: X(t).toFixed(1), y: alto - 6, fill: '#8b9bb0', 'font-size': tamEje,
          'text-anchor': n === 0 ? 'start' : n === ejeXtics - 1 ? 'end' : 'middle'
        },
        reloj(t)
      )
    );
  }

  const linea = serie
    .map((punto, indice) => `${indice ? 'L' : 'M'}${X(punto.t).toFixed(1)} ${Y(punto.v).toFixed(1)}`)
    .join(' ');
  const area = `${linea} L${X(duracion).toFixed(1)} ${Y(0).toFixed(1)} L${izq} ${Y(0).toFixed(1)} Z`;

  // Recortes por encima y por debajo del cero: la misma área se pinta con los dos
  // colores y solo se ve la mitad que corresponde.
  const defs = nodo('defs');
  const recorteArriba = nodo('clipPath', { id: `arriba-${idBase}` });
  recorteArriba.appendChild(nodo('rect', { x: 0, y: 0, width: ancho, height: Y(0).toFixed(1) }));
  const recorteAbajo = nodo('clipPath', { id: `abajo-${idBase}` });
  recorteAbajo.appendChild(
    nodo('rect', { x: 0, y: Y(0).toFixed(1), width: ancho, height: alto - Y(0).toFixed(1) })
  );
  const degradadoPos = nodo('linearGradient', { id: `gp-${idBase}`, x1: 0, y1: 0, x2: 0, y2: 1 });
  degradadoPos.appendChild(nodo('stop', { offset: 0, 'stop-color': colorPos, 'stop-opacity': 0.55 }));
  degradadoPos.appendChild(nodo('stop', { offset: 1, 'stop-color': colorPos, 'stop-opacity': 0.1 }));
  const degradadoNeg = nodo('linearGradient', { id: `gn-${idBase}`, x1: 0, y1: 0, x2: 0, y2: 1 });
  degradadoNeg.appendChild(nodo('stop', { offset: 0, 'stop-color': colorNeg, 'stop-opacity': 0.1 }));
  degradadoNeg.appendChild(nodo('stop', { offset: 1, 'stop-color': colorNeg, 'stop-opacity': 0.55 }));
  defs.append(recorteArriba, recorteAbajo, degradadoPos, degradadoNeg);
  svg.appendChild(defs);

  svg.appendChild(
    nodo('path', { d: area, fill: `url(#gp-${idBase})`, 'clip-path': `url(#arriba-${idBase})` })
  );
  svg.appendChild(
    nodo('path', { d: area, fill: `url(#gn-${idBase})`, 'clip-path': `url(#abajo-${idBase})` })
  );
  const trazo = nodo('path', {
    d: linea, fill: 'none', stroke: colorLinea, 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round'
  });
  trazo.setAttribute('data-line', '');
  svg.appendChild(trazo);

  for (const punto of serie) {
    if (punto.t % puntosCada !== 0 && punto.t !== duracion) continue;
    svg.appendChild(
      nodo('circle', {
        cx: X(punto.t).toFixed(1), cy: Y(punto.v).toFixed(1), r: radio,
        fill: punto.v >= 0 ? colorPos : colorNeg, stroke: '#0a1018', 'stroke-width': 0.9,
        'data-dot': ''
      })
    );
  }
  return { X, Y, trazo };
}

// ============================================================================
// 3. SERIE DE CADA TARJETA
// El rival es el de su misma línea. La diferencia es la del jugador contra ese
// rival: positiva cuando va por delante, sin importar el lado.
// ============================================================================
// El rival de la misma línea; si los roles no coinciden, el de su misma posición.
function indiceRival(jugador, contrarios, indice) {
  const rol = jugador?.role;
  if (rol) {
    const encontrado = contrarios.findIndex(
      (otro) => otro?.role === rol && Array.isArray(otro?.total)
    );
    if (encontrado >= 0) return encontrado;
  }
  return Array.isArray(contrarios[indice]?.total) ? indice : -1;
}

function diferencia(jugador, rival) {
  const salida = [];
  for (let i = 0; i < jugador.total.length; i += 1) {
    salida.push({ t: jugador.times[i], v: jugador.total[i] - rival.total[i] });
  }
  return salida;
}

// ============================================================================
// 4. MONTAJE: franjas de las tarjetas y panel central
// ============================================================================
let estado = null;
const temporizadores = new Set();

function programar(fn, retraso) {
  const id = setTimeout(() => {
    temporizadores.delete(id);
    fn();
  }, retraso);
  temporizadores.add(id);
  return id;
}
function limpiarTemporizadores() {
  for (const id of temporizadores) clearTimeout(id);
  temporizadores.clear();
}

function datosDeOro(summary) {
  const serie = summary?.goldSeries;
  if (!serie || !Array.isArray(serie.times) || serie.times.length < 2) return null;
  const times = serie.times;
  const duracion = Number.isFinite(serie.duration) ? serie.duration : times[times.length - 1];
  const lados = {};
  for (const side of ['blue', 'red']) {
    lados[side] = (serie[side] || []).map((entrada) => ({
      champion: entrada?.champion ?? null,
      role: entrada?.role ?? null,
      times,
      total: Array.isArray(entrada?.total) ? entrada.total : null
    }));
  }
  const hayDatos = ['blue', 'red'].some((side) => lados[side].some((j) => j.total));
  if (!hayDatos) return null;
  return { times, duracion, lados };
}

function construirFranja(entrada) {
  const { card, propio, rival, jugador } = entrada;
  const franja = document.createElement('div');
  franja.className = 'goldband';
  franja.innerHTML = `
    <div class="gb-head">
      <b>ORO VS SU RIVAL</b>
      <span class="gb-value">0</span>
    </div>
    <svg class="gb-chart" viewBox="0 0 335 118" preserveAspectRatio="none" aria-hidden="true"></svg>
    <div class="gb-axis"><span>0:00</span><span class="gb-ceil"></span><span class="gb-end"></span></div>
    <div class="gb-foot">
      <span class="gb-rival"><i></i>vs <b></b></span>
      <span class="gb-max">máx. <b>—</b></span>
    </div>`;
  const svg = franja.querySelector('.gb-chart');
  const lado = propio === 'blue' ? { pos: '#35a7ff', neg: '#f05262', luz: '#a9dcff' }
    : { pos: '#f05262', neg: '#35a7ff', luz: '#ffc3c6' };
  const escala = techoDe(Math.max(...entrada.diff.map((punto) => Math.abs(punto.v))));
  const dibujo = dibujarDiferencia(svg, {
    serie: entrada.diff, techo: escala.techo, duracion: entrada.duracion,
    ancho: 335, alto: 118, izq: 22, der: 6, arr: 4, aba: 10,
    colorPos: lado.pos, colorNeg: lado.neg, colorLinea: lado.luz,
    ejeY: 1, ejeXtics: 0, puntosCada: 120, idBase: `tarjeta-${entrada.indice}-${propio}`,
    tamEje: 7, radio: 1.9
  });
  const pico = entrada.diff.reduce(
    (mejor, punto) => (Math.abs(punto.v) > Math.abs(mejor.v) ? punto : mejor),
    entrada.diff[0]
  );
  franja.querySelector('.gb-ceil').textContent = `±${compacto(escala.techo)}`;
  franja.querySelector('.gb-end').textContent = reloj(entrada.duracion);
  const rivalNombre = franja.querySelector('.gb-rival b');
  rivalNombre.textContent = rival?.champion || ROLE_LABELS[jugador?.role] || 'rival';
  rivalNombre.title = rivalNombre.textContent;
  franja.querySelector('.gb-max b').textContent = `${conSigno(pico.v)} · ${reloj(pico.t)}`;
  card.appendChild(franja);
  entrada.franja = franja;
  entrada.dibujo = dibujo;
  entrada.escala = escala;
  entrada.valor = franja.querySelector('.gb-value');
  entrada.valorFinal = entrada.diff[entrada.diff.length - 1].v;
  entrada.colorValor = lado.luz;
}

function animarFranja(entrada) {
  const { franja, dibujo, diff, valor, duracion } = entrada;
  franja.classList.add('on');
  const trazo = dibujo.trazo;
  let largo = 0;
  try {
    largo = trazo.getTotalLength();
  } catch {
    largo = 0;
  }
  if (!largo) return;
  trazo.style.strokeDasharray = String(largo);
  trazo.style.strokeDashoffset = String(largo);
  const inicio = performance.now();
  const paso = (ahora) => {
    const fraccion = Math.min(1, (ahora - inicio) / TRAZO_FRANJA);
    const suave = 1 - (1 - fraccion) ** 3;
    trazo.style.strokeDashoffset = String(largo * (1 - suave));
    // El número sube con la línea, hasta el valor final de la partida.
    const t = suave * duracion;
    let indice = diff.findIndex((punto) => punto.t >= t);
    if (indice <= 0) indice = 1;
    if (indice >= diff.length) indice = diff.length - 1;
    const anterior = diff[indice - 1];
    const siguiente = diff[indice];
    const porcion = (t - anterior.t) / Math.max(1, siguiente.t - anterior.t);
    const actual = anterior.v + (siguiente.v - anterior.v) * porcion;
    valor.textContent = conSigno(actual);
    valor.style.color = actual >= 0 ? entrada.colorValor : (entrada.propio === 'blue' ? '#ff9b9e' : '#87d4ff');
    if (fraccion < 1) requestAnimationFrame(paso);
    else {
      valor.textContent = conSigno(entrada.valorFinal);
      valor.style.color = entrada.valorFinal >= 0
        ? entrada.colorValor
        : entrada.propio === 'blue' ? '#ff9b9e' : '#87d4ff';
    }
  };
  requestAnimationFrame(paso);
}

function mostrarFranjas() {
  if (!estado) return;
  estado.franjas.forEach((entrada, indice) =>
    programar(() => animarFranja(entrada), indice * ESCALON_TARJETA)
  );
  estado.hecho = 'franjas';
}

function esconderFranjas() {
  if (!estado) return;
  for (const entrada of estado.franjas) {
    if (!entrada.franja) continue;
    entrada.franja.classList.remove('on');
    entrada.valor.textContent = '0';
  }
}

function construirPanel() {
  const panel = document.getElementById('gold-panel');
  if (!panel || !estado?.equipos) return;
  const { times, duracion, azul, rojo, dif } = estado.equipos;
  const escala = techoDe(Math.max(...dif.map((punto) => Math.abs(punto.v))));
  const svg = panel.querySelector('.gp-chart');
  const dibujo = dibujarDiferencia(svg, {
    serie: dif, techo: escala.techo, duracion, ancho: 1232, alto: 378,
    izq: 52, der: 12, arr: 12, aba: 26,
    colorPos: '#35a7ff', colorNeg: '#e03a4b', colorLinea: '#dbe8f6',
    ejeY: 3, ejeXtics: 6, puntosCada: 60, idBase: 'equipos', tamEje: 11, radio: 3
  });
  // Marca del momento de mayor ventaja.
  const pico = dif.reduce(
    (mejor, punto) => (Math.abs(punto.v) > Math.abs(mejor.v) ? punto : mejor),
    dif[0]
  );
  const xPico = dibujo.X(pico.t);
  const aLaDerecha = pico.t <= duracion * 0.75;
  const marca = nodo('g');
  marca.appendChild(
    nodo('line', {
      x1: xPico.toFixed(1), y1: 12, x2: xPico.toFixed(1), y2: 352,
      stroke: '#4a5d75', 'stroke-width': 1, 'stroke-dasharray': '3 4'
    })
  );
  marca.appendChild(
    nodo('circle', {
      cx: xPico.toFixed(1), cy: dibujo.Y(pico.v).toFixed(1), r: 4.6, fill: 'none',
      stroke: pico.v >= 0 ? '#87d4ff' : '#ff9b9e', 'stroke-width': 1.6
    })
  );
  marca.appendChild(
    nodo(
      'text',
      {
        x: (aLaDerecha ? xPico + 10 : xPico - 10).toFixed(1),
        y: (dibujo.Y(pico.v) - 10).toFixed(1),
        fill: '#c9d6e6', 'font-size': 11.5, 'font-weight': 700,
        'text-anchor': aLaDerecha ? 'start' : 'end'
      },
      `máx. ${conSigno(pico.v)} · ${reloj(pico.t)}`
    )
  );
  svg.appendChild(marca);

  const finalDif = dif[dif.length - 1].v;
  panel.querySelector('.gp-total.b').textContent = numberFormat.format(
    Math.round(azul[azul.length - 1])
  );
  panel.querySelector('.gp-total.r').textContent = numberFormat.format(
    Math.round(rojo[rojo.length - 1])
  );
  panel.querySelector('.gp-final').innerHTML = `POR DELANTE AL FINAL: <b style="color:${
    finalDif >= 0 ? '#87d4ff' : '#ff9b9e'
  }">${finalDif >= 0 ? 'AZUL' : 'ROJO'}</b> (${conSigno(finalDif)})`;
  panel.querySelector('.gp-scale').textContent =
    `escala ±${compacto(escala.techo)} · tramos de ${compacto(escala.paso)}`;
  // El momento más flojo del equipo; el primer punto (0 a 0) no cuenta.
  const conJuego = dif.slice(1);
  const peor = (conJuego.length ? conJuego : dif).reduce(
    (minimo, punto) => (punto.v < minimo.v ? punto : minimo),
    (conJuego.length ? conJuego : dif)[0]
  );
  panel.querySelector('.gp-worst').textContent =
    `peor momento: ${conSigno(peor.v)} · ${reloj(peor.t)}`;
  estado.panel = { panel, dibujo, escala };
}

function mostrarPanel() {
  if (!estado?.equipos) return;
  esconderFranjas();
  construirPanel();
  if (!estado.panel) return;
  const { panel, dibujo } = estado.panel;
  panel.hidden = false;
  // Un fotograma con el panel ya colocado para que la línea pueda animarse.
  requestAnimationFrame(() => {
    panel.classList.add('on');
    const trazo = dibujo.trazo;
    let largo = 0;
    try {
      largo = trazo.getTotalLength();
    } catch {
      largo = 0;
    }
    if (!largo) return;
    trazo.style.strokeDasharray = String(largo);
    trazo.style.strokeDashoffset = String(largo);
    void trazo.getBoundingClientRect();
    trazo.style.transition = `stroke-dashoffset ${TRAZO_PANEL}ms cubic-bezier(.25,.6,.25,1)`;
    requestAnimationFrame(() => {
      trazo.style.strokeDashoffset = '0';
    });
    panel.querySelectorAll('[data-dot]').forEach((punto, indice) => {
      punto.style.opacity = '0';
      punto.style.transition = 'opacity 260ms ease';
      programar(() => {
        punto.style.opacity = '1';
      }, 400 + indice * 45);
    });
  });
}

function retirarPanel() {
  if (!estado?.panel) return;
  estado.panel.panel.classList.remove('on');
  programar(() => {
    if (estado?.panel) estado.panel.panel.hidden = true;
  }, 460);
}

// ============================================================================
// 5. INTERFAZ PARA main.js
// montar() prepara las diez franjas; iniciar() arranca los tres tiempos;
// parar() lo deja todo como estaba para que la próxima vez vuelva a empezar.
// ============================================================================
export const goldSeries = {
  montar(summary, views) {
    this.parar();
    const panel = document.getElementById('gold-panel');
    if (panel) {
      panel.hidden = true;
      panel.classList.remove('on');
    }
    const datos = datosDeOro(summary);
    if (!datos || !Array.isArray(views) || views.length === 0) return false;
    // views llega en el orden de las tarjetas: cinco del azul y cinco del rojo.
    // La serie se busca por campeón y, si el nombre no coincide, por posición:
    // así un cambio de orden en el resumen no cruza las curvas.
    const porLado = { blue: [], red: [] };
    const usadosSerie = new Set();
    for (const vista of views) {
      if (!porLado[vista.side]) continue;
      const indice = porLado[vista.side].length;
      const delLado = datos.lados[vista.side] || [];
      const clave = String(vista.player?.champion || vista.player?.championAlias || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      let jugador = clave
        ? delLado.find(
            (entrada, posicion) =>
              !usadosSerie.has(`${vista.side}:${posicion}`) &&
              String(entrada.champion || '')
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '') === clave
          )
        : null;
      let posicion = jugador ? delLado.indexOf(jugador) : -1;
      if (!jugador && delLado[indice] && !usadosSerie.has(`${vista.side}:${indice}`)) {
        jugador = delLado[indice];
        posicion = indice;
      }
      if (jugador) usadosSerie.add(`${vista.side}:${posicion}`);
      porLado[vista.side].push({
        card: vista.element?.closest?.('.card') || null,
        jugador: jugador || null,
        indice,
        side: vista.side
      });
    }
    const franjas = [];
    for (const side of ['blue', 'red']) {
      const contrario = side === 'blue' ? 'red' : 'blue';
      porLado[side].forEach((slot, indice) => {
        const propio = slot.jugador;
        if (!slot.card || !propio?.total) return;
        const cual = indiceRival(propio, datos.lados[contrario] || [], indice);
        const rival = cual >= 0 ? datos.lados[contrario][cual] : null;
        if (!rival?.total) return;
        const entrada = {
          card: slot.card,
          side,
          propio: side,
          indice,
          duracion: datos.duracion,
          jugador: propio,
          rival,
          diff: diferencia(propio, rival)
        };
        construirFranja(entrada);
        franjas.push(entrada);
      });
    }
    // Serie de los dos equipos: suma de las cinco curvas de cada lado.
    const equipos = datos.lados.blue.length && datos.lados.red.length
      ? {
          times: datos.times,
          duracion: datos.duracion,
          azul: datos.times.map((_, i) =>
            datos.lados.blue.reduce((suma, jugador) => suma + (jugador.total?.[i] ?? 0), 0)
          ),
          rojo: datos.times.map((_, i) =>
            datos.lados.red.reduce((suma, jugador) => suma + (jugador.total?.[i] ?? 0), 0)
          ),
          dif: []
        }
      : null;
    if (equipos) {
      equipos.dif = datos.times.map((t, i) => ({ t, v: equipos.azul[i] - equipos.rojo[i] }));
      const nombres = summary?.info || {};
      const etiquetas = panel?.querySelectorAll('.gp-tag') || [];
      if (etiquetas[0]) etiquetas[0].textContent = String(nombres.blue || 'AZUL').toUpperCase();
      if (etiquetas[1]) etiquetas[1].textContent = String(nombres.red || 'ROJO').toUpperCase();
    }
    estado = { franjas, equipos, hecho: '' };
    return franjas.length > 0 || Boolean(equipos);
  },

  iniciar() {
    limpiarTemporizadores();
    if (!estado) return;
    estado.hecho = '';
    programar(mostrarFranjas, T_FRANJAS);
    programar(mostrarPanel, T_PANEL);
    programar(retirarPanel, T_FUERA);
  },

  parar() {
    limpiarTemporizadores();
    if (estado) {
      for (const entrada of estado.franjas) {
        if (!entrada.franja) continue;
        entrada.franja.classList.remove('on');
        entrada.valor.textContent = '0';
        const trazo = entrada.dibujo?.trazo;
        if (trazo) trazo.style.strokeDashoffset = '0';
      }
      if (estado.panel) {
        estado.panel.panel.classList.remove('on');
        estado.panel.panel.hidden = true;
      }
    }
    const panel = document.getElementById('gold-panel');
    if (panel) {
      panel.hidden = true;
      panel.classList.remove('on');
    }
    estado = null;
  },
};
