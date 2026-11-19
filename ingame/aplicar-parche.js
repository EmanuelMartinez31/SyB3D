// ============================================================================
// Aplica el parche del ganador del 1 vs 1 sobre el server.js del ingame.
//
//   node aplicar-parche.js            → parchea el server.js que encuentre
//   node aplicar-parche.js ruta.js    → parchea ese archivo
//
// No reescribe el archivo entero: inserta cuatro bloques cortos por anclas
// exactas. Si un ancla no aparece una sola vez, se para sin tocar nada.
// Guarda una copia en server.js.bak y comprueba la sintaxis al terminar.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MARCA = 'ganadorUnoContraUno';
const MODULO = '1v1-ganador.js';

function buscarServer() {
  const candidatos = [
    process.argv[2],
    path.join(__dirname, 'server.js'),
    path.join(__dirname, 'ingame', 'server.js'),
    path.join(__dirname, '..', 'ingame', 'server.js'),
    path.join(process.cwd(), 'server.js')
  ].filter(Boolean);
  for (const candidato of candidatos) {
    if (fs.existsSync(candidato)) return path.resolve(candidato);
  }
  return null;
}

const destino = buscarServer();
if (!destino) {
  console.error('No encuentro server.js. Copia este archivo a la carpeta ingame\\ y vuelve a ejecutarlo.');
  process.exit(1);
}
console.log('Archivo: ' + destino);

const original = fs.readFileSync(destino, 'utf8');
if (original.includes(MARCA)) {
  console.log('Ya estaba parcheado. No se toca nada.');
  process.exit(0);
}

const eol = original.includes('\r\n') ? '\r\n' : '\n';
const texto = original.split('\r\n').join('\n');

// Cada ancla: el texto que ya existe y lo que se mete justo después.
const inserciones = [
  {
    nombre: 'creación del detector',
    ancla: 'const winnerReportsInFlight = new Set();\n',
    añadir:
      '\n' +
      '// (r94) 1 vs 1: la partida se gana con la primera de las tres reglas. En el\n' +
      '// Abismo no hay nexo, así que la detección por nexo nunca dispara y la serie\n' +
      '// no sumaba. El detector vive aparte, en 1v1-ganador.js.\n' +
      'const ' + MARCA + " = require('./" + MODULO.replace('.js', '') + "')({\n" +
      '  httpRequestJson,\n' +
      '  draftOrigin: DRAFT_ORIGIN,\n' +
      '  getRevision: () => draftSync.revision,\n' +
      '  reportedWinners,\n' +
      '  winnerReportsInFlight,\n' +
      '  finiteNumber,\n' +
      '  log: mensaje => console.log(mensaje)\n' +
      '});\n'
  },
  {
    nombre: 'enganche en cada GameInfo',
    ancla: '  void maybeReportGameWinner(normalized);\n',
    añadir: '  void ' + MARCA + '.reportar(adapted, normalized);\n'
  },
  {
    nombre: 'reinicio al cambiar de partida',
    ancla: '  resetObjectiveTracking(null);\n',
    añadir: '  ' + MARCA + '.reiniciar();\n'
  },
  {
    nombre: 'estado en /status',
    ancla: '    winnersReported: reportedWinners.size,\n',
    añadir: '    unoContraUno: ' + MARCA + '.estadoActual(),\n'
  }
];

// Primero se comprueba todo: si algo no cuadra, no se escribe ni un byte.
const problemas = [];
for (const insercion of inserciones) {
  const veces = texto.split(insercion.ancla).length - 1;
  if (veces !== 1) {
    problemas.push(`«${insercion.nombre}»: se esperaba 1 vez y aparece ${veces}`);
  }
}
if (problemas.length) {
  console.error('\nNO se ha tocado nada. Tu server.js no es el que esperaba:');
  for (const problema of problemas) console.error('  - ' + problema);
  console.error('\nManda esta salida y lo ajusto.');
  process.exit(1);
}

// Si esta versión del server.js no manda el feed de asesinatos (killFeed), la
// primera kill se lee de las muertes del propio GameInfo. Funciona igual; se
// avisa solo para que se sepa.
if (!texto.includes('killFeed')) {
  console.log('');
  console.log('AVISO: este server.js no manda el feed de asesinatos (killFeed) al HUD.');
  console.log('El parche funciona igual: la primera kill se lee de las muertes del GameInfo.');
}

if (!fs.existsSync(path.join(path.dirname(destino), MODULO))) {
  console.error(`\nNO se ha tocado nada: falta ${MODULO} al lado de server.js.`);
  console.error('Copia también ese archivo a la misma carpeta.');
  process.exit(1);
}

let resultado = texto;
for (const insercion of inserciones) {
  resultado = resultado.replace(insercion.ancla, insercion.ancla + insercion.añadir);
}

const copia = destino + '.bak';
if (!fs.existsSync(copia)) fs.writeFileSync(copia, original);
fs.writeFileSync(destino, resultado.split('\n').join(eol));

const revision = spawnSync(process.execPath, ['--check', destino], { encoding: 'utf8' });
if (revision.status !== 0) {
  fs.writeFileSync(destino, original);
  console.error('\nEl resultado no compila; se ha restaurado el original.');
  console.error(revision.stderr || revision.stdout);
  process.exit(1);
}

console.log('\nParcheado y con la sintaxis comprobada.');
console.log('Copia del anterior: ' + path.basename(copia));
for (const insercion of inserciones) console.log('  + ' + insercion.nombre);
console.log('\nReinicia el servidor del ingame para que lo coja.');
