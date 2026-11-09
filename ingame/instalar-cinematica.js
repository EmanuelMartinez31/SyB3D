// Instala la cinematica de inicio dentro del servidor del Ingame.
//
// Anade TRES enganches a server.js y NO toca nada mas:
//   1. require del modulo
//   2. aviso a la cinematica con cada GameInfo que llega del sensor
//   3. arranque del modulo (carga la secuencia) al iniciar el servidor
//
// Antes de escribir hace copia (server.js.antes-cinematica) y comprueba que el
// archivo resultante sigue siendo valido. Se puede ejecutar las veces que haga
// falta: si ya esta instalado, no duplica nada.
//
// Uso:  node instalar-cinematica.js   (o el .bat de la carpeta principal)

const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, 'server.js');
const RESPALDO = path.join(__dirname, 'server.js.antes-cinematica');

function salirConError(mensaje) {
  console.error(`\n[ERROR] ${mensaje}\n`);
  console.error('No se ha tocado ningun archivo.\n');
  process.exit(1);
}

if (!fs.existsSync(SERVER)) salirConError(`No encuentro ${SERVER}`);

const original = fs.readFileSync(SERVER, 'utf8');
let texto = original;

// Devuelve la posicion del final de la primera linea que contenga el texto.
function finDeLineaCon(fragmento, desde = 0) {
  const i = texto.indexOf(fragmento, desde);
  if (i < 0) return -1;
  return texto.indexOf('\n', i) + 1;
}

function insertarEnLinea(fragmento, codigo) {
  const pos = finDeLineaCon(fragmento);
  if (pos <= 0) return false;
  texto = texto.slice(0, pos) + codigo + texto.slice(pos);
  return true;
}

// ---------------------------------------------------------- 1. require ----
let cambios = 0;
if (/require\(['"]\.\/cinematica['"]\)/.test(texto)) {
  console.log('1/3  require: ya estaba');
} else {
  const hecho = insertarEnLinea(
    "const { WebSocketServer } = require('ws');",
    "\n// Cinematica de inicio: se lanza sola al segundo configurado de la partida.\n" +
    "const crearCinematica = require('./cinematica');\n"
  ) || insertarEnLinea(
    "const path = require('path');",
    "\n// Cinematica de inicio: se lanza sola al segundo configurado de la partida.\n" +
    "const crearCinematica = require('./cinematica');\n"
  );
  if (!hecho) salirConError('No encuentro donde poner el require (busco la linea de "ws" o de "path").');
  console.log('1/3  require: añadido');
  cambios += 1;
}

// ------------------------------------------------- 2. instancia del modulo
if (/const cinematica = crearCinematica/.test(texto)) {
  console.log('2/3  instancia: ya estaba');
} else {
  let hecho = insertarEnLinea(
    'module.exports = function setupIngame',
    "// Cinematica de inicio (una sola instancia por servidor).\n" +
    "const cinematica = crearCinematica({ app, log: mensaje => console.log(mensaje) });\n"
  );
  if (!hecho) {
    hecho = insertarEnLinea('function emptyObjectiveScores()',
      "// Cinematica de inicio (una sola instancia por servidor).\n" +
      "const cinematica = crearCinematica({ app, log: mensaje => console.log(mensaje) });\n\n");
  }
  if (!hecho) salirConError('No encuentro donde crear la instancia dentro del modulo.');
  console.log('2/3  instancia: añadida');
  cambios += 1;
}

// -------------------------------------------------- 3. aviso desde /sensor
if (/cinematica\.actualizar\(/.test(texto)) {
  console.log('3/3  aviso al sensor: ya estaba');
} else {
  const hecho = insertarEnLinea('  latest = normalized;', '  cinematica.actualizar(normalized);\n')
    || insertarEnLinea('  latestState = adapted;', '  cinematica.actualizar(normalized);\n');
  if (!hecho) salirConError('No encuentro el POST /sensor (busco "latest = normalized").');
  console.log('3/3  aviso al sensor: añadido');
  cambios += 1;
}

// ------------------------------------------------ 4. arranque en start()
if (/cinematica\.iniciar\(\)/.test(texto)) {
  console.log('     arranque: ya estaba');
} else {
  const hecho = insertarEnLinea('  start() {', '    cinematica.iniciar();\n');
  if (!hecho) salirConError('No encuentro la funcion start() del modulo.');
  console.log('     arranque: añadido');
  cambios += 1;
}

if (cambios === 0) {
  console.log('\nYa estaba todo instalado. No se ha tocado nada.\n');
  process.exit(0);
}

// -------------------------------------------------------- comprobaciones --
const marcas = [
  "require('./cinematica')",
  'const cinematica = crearCinematica',
  'cinematica.actualizar(normalized)',
  'cinematica.iniciar()'
];
const faltan = marcas.filter(marca => !texto.includes(marca));
if (faltan.length) salirConError(`El archivo quedaria incompleto; falta: ${faltan.join(', ')}`);

const abre = (texto.match(/{/g) || []).length;
const cierra = (texto.match(/}/g) || []).length;
if (abre !== cierra) salirConError(`El archivo quedaria mal (${abre} llaves abiertas, ${cierra} cerradas).`);

fs.writeFileSync(RESPALDO, original);
fs.writeFileSync(SERVER, texto);

console.log(`\nListo. ${path.basename(SERVER)} actualizado (copia del original en ${path.basename(RESPALDO)}).`);
console.log('Arranca el sistema como siempre (iniciar.bat). La cinematica queda armada.\n');
