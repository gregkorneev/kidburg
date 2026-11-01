// Расстановка подвижной мебели в учебной части (локальные координаты сцены): два шкафа экипировки и тумба с тремя
// ящиками стоят у передней стены здания лицом к игроку (+Z). Здание заканчивается на z = 1.1, мебель прижата к стене.
// Отсюда же берутся блокировки движения, чтобы игрок не проходил сквозь корпуса.
export const FURNITURE = Object.freeze({
  /** Дальность подсказки E (м) до центра шкафа или ящика. */
  reach: 2.1,
  cabinets: Object.freeze([
    Object.freeze({ id: 'fire-cabinet-0', x: -13.7, z: 1.4, width: 1.1, height: 2.1, depth: 0.6, hinge: 'left', variant: 'gear' }),
    Object.freeze({ id: 'fire-cabinet-1', x: -12.4, z: 1.4, width: 1.1, height: 2.1, depth: 0.6, hinge: 'right', variant: 'tools' }),
  ]),
  chest: Object.freeze({ id: 'fire-chest', x: -10.1, z: 1.45, width: 2.2, height: 0.95, depth: 0.65, drawers: 3 }),
});

/** Прямоугольники столкновений корпусов (закрытые дверцы и ящики; открытые не перекрывают проход вплотную к стене). */
export function furnitureBlockers() {
  const box = ({ x, z, width, depth }) => ({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });
  return [...FURNITURE.cabinets, FURNITURE.chest].map(box);
}
