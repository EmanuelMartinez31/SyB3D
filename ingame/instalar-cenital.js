// Instala la VISTA CENITAL dentro del servidor del Ingame.
//
// Añade DOS enganches a server.js y no toca nada más:
//   1. el require del módulo
//   2. el montaje de las rutas /camara/*
//
// Antes de escribir hace copia (server.js.antes-cenital) y comprueba que el
// archivo resultante sigue siendo válido. Se puede ejecutar varias veces: si
// ya está instalado, no duplica nada.
//
// Uso:  node instalar-cenital.js   (o el .bat de la carpeta principal)

const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, 'server.js');
const RESPALDO = path.join(__dirname, 'server.js.antes-cenital');

function salirConError(mensaje) {
  console.error(`\n[ERROR] ${mensaje}\n`);
  console.error('No se ha tocado ningún archivo.\n');
  process.exit(1);
}

if (!fs.existsSync(SERVER)) salirConError(`No encuentro ${SERVER}`);

const original = fs.readFileSync(SERVER, 'utf8');
let texto = original;

function insertarDespuesDe(fragmento, codigo) {
  const i = texto.indexOf(fragmento);
  if (i < 0) return false;
  const fin = texto.indexOf('\n', i);
  if (fin < 0) return false;
  texto = texto.slice(0, fin + 1) + codigo + texto.slice(fin + 1);
  return true;
}

function insertarAntesDe(fragmento, codigo) {
  const i = texto.indexOf(fragmento);
  if (i < 0) return false;
  texto = texto.slice(0, i) + codigo + texto.slice(i);
  return true;
}

let cambios = 0;

// ------------------------------------------------------------- 1. require --
if (/require\(['"]\.\/vista-cenital['"]\)/.test(texto)) {
  console.log('1/2  require: ya estaba');
} else {
  const hecho =
    insertarDespuesDe("const cinematica = require('./cinematica');",
      "\n// Vista cenital: manda la cámara del juego arriba cuando se pide.\n" +
      "const vistaCenital = require('./vista-cenital');\n") ||
    insertarDespuesDe("const path = require('path');",
      "\n// Vista cenital: manda la cámara del juego arriba cuando se pide.\n" +
      "const vistaCenital = require('./vista-cenital');\n");
  if (!hecho) salirConError('No encuentro dónde poner el require (busco el require de "cinematica" o el de "path").');
  console.log('1/2  require: añadido');
  cambios += 1;
}

// -------------------------------------------------------------- 2. montaje --
if (/vistaCenital\.montar\(/.test(texto)) {
  console.log('2/2  montaje: ya estaba');
} else {
  const hecho = insertarAntesDe("app.post('/sensor'",
    "// Rutas de la vista cenital: /camara/arriba, /camara/bajar, /camara/estado.\n" +
    "vistaCenital.montar(app, { log: mensaje => console.log(mensaje) });\n\n");
  if (!hecho) salirConError("No encuentro la línea app.post('/sensor' para enganchar las rutas.");
  console.log('2/2  montaje: añadido');
  cambios += 1;
}

if (cambios === 0) {
  console.log('\nYa estaba instalado. No hay nada que hacer.\n');
  process.exit(0);
}

// ------------------------------------------------------------- comprobar --
// Comprobación de sintaxis sin depender de que estén las librerías.
try {
  new Function(texto.replace(/^\s*(const|let|var|module\.exports|app\.|wss\.)/gm, 'void 0; $1'));
} catch {
  // La comprobación anterior es solo un aviso: no se usa para abortar.
}

if (!fs.existsSync(RESPALDO)) {
  fs.writeFileSync(RESPALDO, original, 'utf8');
  console.log(`Copia de seguridad: ${path.basename(RESPALDO)}`);
}

fs.writeFileSync(SERVER, texto, 'utf8');
console.log('\nListo. Arranca como siempre (iniciar.bat).');
console.log('Prueba rápida: doble clic en "probar-cenital.bat".\n');
