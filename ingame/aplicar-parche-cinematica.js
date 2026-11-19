// ============================================================================
// Aplica el parche que le pasa el modo del panel a la cinematica.
//
//   node aplicar-parche-cinematica.js             → busca el server.js
//   node aplicar-parche-cinematica.js ruta.js     → parchea ese archivo
//
// Cambia una sola linea:
//   cinematica.actualizar(normalized);
//   cinematica.actualizar(normalized, draftSync.info);
//
// Asi la cinematica sabe si el panel esta en 1 vs 1, 2 vs 2 o 5 vs 5 y elige la
// secuencia por ahi, sin depender del mapa ni del numero de jugadores.
//
// No reescribe el archivo entero. Si el ancla no aparece una sola vez, se para
// sin tocar nada. Deja copia en server.js.bak y comprueba la sintaxis.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MARCA = 'cinematica.actualizar(normalized, draftSync.info)';
const ANCLA = 'cinematica.actualizar(normalized);';

function buscarServer() {
  const candidatos = [
    process.argv[2],
    path.join(__dirname, 'server.js'),
    path.join(__dirname, 'ingame', 'server.js'),
    path.join(__dirname, '..', 'ingame', 'server.js'),
    path.join(process.cwd(), 'server.js')
  ].filter(Boolean);
  for (const candidato of candidatos) if (fs.existsSync(candidato)) return path.resolve(candidato);
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
const veces = texto.split(ANCLA).length - 1;
if (veces !== 1) {
  console.error(`\nNO se ha tocado nada. En tu server.js la linea «${ANCLA}» aparece ${veces} veces y se esperaba 1.`);
  console.error('Manda esta salida y lo ajusto.');
  process.exit(1);
}

const resultado = texto.replace(ANCLA,
  '// (r96c) la cinematica sabe en que modo esta el panel (1v1, 2v2, 5v5)\n' +
  '  ' + MARCA + ';');

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
console.log('\nReinicia el servidor del ingame para que lo coja.');
