// Бенчмарк города для консоли браузера (страница открыта с ?debug=1). Использование:
//   await __bench([{name, x, z, yaw, pitch}], 6000)  -> массив результатов по ракурсам.
// Измеряются интервалы rAF, вызовы отрисовки, треугольники, геометрии, JS heap и время world.update.
window.__bench = async function bench(views, ms = 6000) {
  const d = window.__cityDebug;
  const out = [];
  const original = d.world.update;
  let updateTotal = 0;
  let updateCount = 0;
  d.world.update = (...args) => { const t = performance.now(); original.apply(d.world, args); updateTotal += performance.now() - t; updateCount += 1; };
  try {
  for (const view of views) {
    d.player.x = view.x; d.player.z = view.z; d.player.yaw = view.yaw; if (view.pitch !== undefined) d.player.pitch = view.pitch;
    await new Promise((r) => setTimeout(r, 2500));
    const distance = () => Math.hypot(d.player.x - view.x, d.player.z - view.z);
    if (distance() > 1) throw new Error(`Ракурс ${view.name} недоступен: сервер вернул игрока (${d.player.x.toFixed(1)}, ${d.player.z.toFixed(1)}); измерение отменено`);
    const startPosition = { x: d.player.x, z: d.player.z };
    updateTotal = 0; updateCount = 0;
    const deltas = [];
    await new Promise((resolve) => {
      let last = performance.now();
      const start = last;
      const tick = (now) => {
        deltas.push(now - last); last = now;
        if (now - start < ms) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    if (distance() > 1) throw new Error(`Позиция изменилась при замере ${view.name}; результат недостоверен`);
    deltas.shift();
    if (!deltas.length) throw new Error(`Нет кадров для ракурса ${view.name}`);
    const sorted = [...deltas].sort((a, b) => a - b);
    const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const info = d.renderer.info;
    out.push({
      view: view.name, position: startPosition, quality: new URLSearchParams(location.search).get('quality') ?? 'medium',
      fps: +(1000 / mean).toFixed(1), p50: +pick(0.5).toFixed(2), p95: +pick(0.95).toFixed(2), p99: +pick(0.99).toFixed(2), frames: deltas.length,
      calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      updateMs: updateCount ? +(updateTotal / updateCount).toFixed(3) : null,
    });
  }
  return out;
  } finally { d.world.update = original; }
};
