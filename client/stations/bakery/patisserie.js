// Статичные кондитерские изделия: все детали попадают в общий меш интерьера.
const P = {
  crust: 0xc98743, pastry: 0xe5ad65, vanilla: 0xfff0da, chocolate: 0x724535,
  pink: 0xe99aab, berry: 0xc7505b, mint: 0xa8cdb3, gold: 0xf2c76e,
};

export function addPastry(k, type, x, y, z, color = P.pink) {
  k.at([x, y, z], 0, () => {
    if (type === 'croissant') {
      k.torus(0.15, 0.065, 0, 0.09, 0, P.crust, { radial: 5, tubular: 12, arc: Math.PI * 1.32 });
      for (const dx of [-0.07, 0, 0.07]) k.box(0.022, 0.025, 0.09, dx, 0.153, 0.12, P.pastry);
    } else if (type === 'donut') {
      k.torus(0.13, 0.065, 0, 0.085, 0, P.crust, { radial: 6, tubular: 12 });
      k.torus(0.13, 0.04, 0, 0.122, 0, color, { radial: 5, tubular: 12 });
      for (const [dx, dz] of [[-0.1, -0.08], [0.09, -0.09], [0.12, 0.04], [-0.05, 0.13]]) {
        k.box(0.045, 0.012, 0.018, dx, 0.158, dz, P.vanilla);
      }
    } else if (type === 'cupcake') {
      k.cyl(0.13, 0.095, 0.19, 9, 0, 0.095, 0, color);
      k.sphere(0.135, 0, 0.23, 0, P.vanilla, { s: [1, 0.75, 1], w: 8, h: 5 });
      k.sphere(0.065, 0, 0.325, 0, P.berry, { w: 7, h: 4 });
    } else if (type === 'cake') {
      k.cyl(0.17, 0.17, 0.12, 10, 0, 0.07, 0, P.chocolate);
      k.cyl(0.175, 0.175, 0.035, 10, 0, 0.145, 0, P.vanilla);
      k.cyl(0.17, 0.17, 0.1, 10, 0, 0.21, 0, color);
      k.cyl(0.18, 0.18, 0.035, 10, 0, 0.28, 0, P.vanilla);
      for (const dx of [-0.075, 0, 0.075]) k.sphere(0.035, dx, 0.32, 0, P.berry, { w: 6, h: 4 });
    } else if (type === 'macaron') {
      for (const dy of [0.045, 0.11]) k.cyl(0.115, 0.115, 0.055, 9, 0, dy, 0, color);
      k.cyl(0.11, 0.11, 0.025, 9, 0, 0.078, 0, P.vanilla);
    } else if (type === 'baguette') {
      k.sphere(0.15, 0, 0.095, 0, P.crust, { s: [1.8, 0.62, 0.75], w: 8, h: 5 });
      for (const dx of [-0.13, 0, 0.13]) k.box(0.035, 0.015, 0.1, dx, 0.19, 0, P.vanilla, { ry: 0.45 });
    } else if (type === 'roll') {
      k.cyl(0.14, 0.14, 0.11, 10, 0, 0.065, 0, P.pastry);
      k.torus(0.065, 0.025, 0, 0.128, 0, P.chocolate, { radial: 4, tubular: 10, arc: Math.PI * 1.6 });
    } else if (type === 'brownie') {
      k.box(0.27, 0.13, 0.24, 0, 0.075, 0, P.chocolate, { r: 0.025 });
      k.box(0.25, 0.025, 0.22, 0, 0.15, 0, P.vanilla, { r: 0.01 });
      k.sphere(0.045, 0, 0.19, 0, P.berry, { w: 6, h: 4 });
    }
  });
}

export function addPastryDisplays(k) {
  // Полки охлаждения и существующая витрина: декор не выходит за габариты мебели.
  const rows = [
    { y: 0.92, z: 4.72, types: ['baguette', 'roll', 'baguette'] },
    { y: 1.72, z: 4.72, types: [null, null, null] },
    { y: 2.52, z: 4.72, types: ['cupcake', 'cake', 'cupcake'] },
  ];
  for (const { y, z, types } of rows) {
    types.forEach((type, i) => {
      if (!type) return;
      const x = 4.55 + i * 0.55;
      k.box(0.46, 0.035, 0.56, x, y, z, P.vanilla);
      addPastry(k, type, x, y + 0.02, z, i === 2 ? P.mint : P.pink);
      k.box(0.18, 0.09, 0.025, x, y + 0.06, 4.38, P.vanilla);
    });
  }
  for (const [x, type, color] of [[-4.1, 'cupcake', P.mint], [-3.55, 'cake', P.pink]]) {
    addPastry(k, type, x, 1.48, 5.53, color);
  }
  // Неглубокая пристенная полка остаётся читаемой на всех пресетах.
  for (const [y, types] of [[1.62, ['roll', 'macaron', 'brownie']], [2.62, ['donut', 'cupcake', 'donut']], [3.62, ['baguette', 'croissant', 'baguette']]]) {
    types.forEach((type, i) => addPastry(k, type, 7.82, y, 0.32 + i * 0.68, i === 1 ? P.mint : P.pink));
  }
  // Дополнительный ряд макарон и рулетов на задней настенной полке.
  for (const [x, type, color] of [[-2.6, 'macaron', P.mint], [-2.1, 'macaron', P.pink], [-1.6, 'roll', P.gold], [-1.1, 'croissant', P.gold], [1.1, 'donut', P.pink], [1.6, 'brownie', P.pink], [2.1, 'macaron', P.gold], [2.6, 'macaron', P.pink]]) {
    addPastry(k, type, x, 2.87, -5.99, color);
  }
}
