// (r90) Qué gasta cada campeón.
//
// No todos usan maná: hay energía (Lee Sin, Zed…), furia (Gnar, Tryndamere…),
// flujo (Yasuo, Yone), y unos cuantos que no gastan nada (Garen, Katarina…).
// La lista sale de Data Dragon 16.23.1, no de memoria: son los 173 campeones
// del parche, y solo los 28 que NO usan maná aparecen aquí. Todo lo que no
// esté en la tabla es maná.
//
// Los nombres van sin tildes, sin espacios y en minúsculas para que dé igual
// que el cliente mande el identificador (LeeSin, RekSai, DrMundo) o el nombre
// visible (Lee Sin, Rek'Sai, Dr. Mundo).

const POR_CAMPEON = {
  aatrox: 'sangre',
  akali: 'energia',
  ambessa: 'energia',
  belveth: 'nada',
  briar: 'furia',
  drmundo: 'nada',
  garen: 'nada',
  gnar: 'furia',
  katarina: 'nada',
  kennen: 'energia',
  kled: 'coraje',
  leesin: 'energia',
  mordekaiser: 'escudo',
  reksai: 'furia',
  renekton: 'furia',
  rengar: 'ferocidad',
  riven: 'nada',
  rumble: 'calor',
  sett: 'coraje',
  shen: 'energia',
  shyvana: 'furia',
  tryndamere: 'furia',
  viego: 'nada',
  vladimir: 'carmesi',
  yasuo: 'flujo',
  yone: 'flujo',
  zac: 'nada',
  zed: 'energia',
};

const NOMBRES = {
  mana: 'Maná',
  energia: 'Energía',
  furia: 'Furia',
  flujo: 'Flujo',
  sangre: 'Pozo sangriento',
  escudo: 'Escudo',
  ferocidad: 'Ferocidad',
  calor: 'Calor',
  coraje: 'Coraje',
  carmesi: 'Ráfaga carmesí',
  nada: 'Sin recurso'
};

function clave(valor) {
  return String(valor == null ? '' : valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Tipo de recurso del campeón. Lo que no esté en la tabla gasta maná.
export function recursoDe(champion) {
  return POR_CAMPEON[clave(champion)] || 'mana';
}

// Nombre para el rótulo y el tooltip.
export function nombreDeRecurso(tipo) {
  return NOMBRES[tipo] || NOMBRES.mana;
}

// Los que no gastan nada no llevan barra.
export const SIN_RECURSO = 'nada';
