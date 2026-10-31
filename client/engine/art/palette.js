// Единая палитра Kidburg: пожарная часть и центральный город берут цвета отсюда.
// Правила: тёплый солнечный свет, прохладные тени, приглушённая насыщенность фонов,
// яркие цвета оставлены для интерактивных предметов (красный, жёлтый, оранжевый).

export const PALETTE = Object.freeze({
  // Небо и атмосфера.
  skyTop: '#86bfe6',
  skyMid: '#c9e6e9',
  skyHorizon: '#f7eed6',
  fog: '#d6e8e0',
  sun: '#ffeac8',
  hemiSky: '#e3f2ff',
  hemiGround: '#8fa77a',
  rim: '#a8d2ff',

  // Земля и растения.
  grass: '#8dbd68',
  grassLight: '#a9d07b',
  grassDark: '#6b9f5a',
  hill: '#7eb067',
  hillFar: '#9dc2a2',
  leaf: ['#5f9a64', '#78b36c', '#93c470', '#4f8a5d'],
  leafPine: ['#3f7a5a', '#4d8c63'],
  flower: ['#f4b6c2', '#fff0b8', '#ffffff', '#ffc27a', '#c7b5f4'],
  bark: '#9a6b47',
  rock: ['#b8bdb4', '#a3a89f', '#c9ccbf'],

  // Постройки и покрытия.
  plaster: '#f4e6c8',
  plasterShade: '#e6d2ac',
  brick: '#d9694d',
  roof: '#c9533e',
  roofDark: '#a53f33',
  trim: '#fff6df',
  concrete: '#d9d4c3',
  asphalt: '#7d8584',
  paver: '#e7d3a1',
  curb: '#efe6d0',
  steel: '#8ea2a4',
  glass: '#7fb6bf',
  glassDark: '#3d5c66',
  wood: '#b98355',
  woodDark: '#8a5a3a',

  // Цвета «сигнала».
  red: '#d9482f',
  redDark: '#a63a2e',
  yellow: '#f4c94d',
  orange: '#f28b35',
  blue: '#5f9fb0',
  navy: '#36566a',
  green: '#3f8a68',
  greenDark: '#2b6350',
  charcoal: '#384546',
  white: '#fff7e2',
  ink: '#2a3636',

  // Люди.
  skin: ['#f4c8a2', '#e9ae83', '#c98b63', '#a96a49', '#f7d6b8'],
  hair: ['#4a3228', '#6b4631', '#2b2523', '#a96f3c', '#d1a15a'],
  outfit: ['#5f9fb0', '#e0925a', '#7aa86a', '#9b82c4', '#d6746f', '#e2b94f', '#5d86c4'],
});

/** Стабильный выбор элемента палитры по числу (id игрока), без случайности между клиентами. */
export function pick(list, seed) {
  return list[Math.abs(Math.trunc(seed)) % list.length];
}
