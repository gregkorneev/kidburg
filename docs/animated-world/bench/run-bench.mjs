// Бенчмарк города: node run-bench.mjs <baseUrl> <room> <quality> <outJson>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, login, sleep } from './cdp.mjs';

const [base, room, quality = 'medium', out] = process.argv.slice(2);
const benchSource = readFileSync(fileURLToPath(new URL('./city-bench.js', import.meta.url)), 'utf8');
const views = [
  { name: 'plaza', x: 416, z: 424, yaw: 0, pitch: 0.25 },
  { name: 'fire_station', x: 396, z: 414, yaw: Math.PI / 2, pitch: 0.15 },
  { name: 'radio', x: 438, z: 439, yaw: -2.37, pitch: 0.15 },
];
const browser = await launch();
try {
  await login(browser, base, `Bench${Date.now() % 1000}`, room);
  await browser.goto(`${base}/?debug=1&quality=${quality}`);
  for (let i = 0; i < 40 && !(await browser.eval('Boolean(window.__cityDebug && window.__cityDebug.world.size > 3)')); i++) await sleep(500);
  await browser.eval(benchSource);
  const gl = await browser.eval(`(() => { const g = window.__cityDebug.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); })()`);
  const result = await browser.eval(`__bench(${JSON.stringify(views)}, 6000)`);
  const report = { gl, quality, base, date: new Date().toISOString(), result, console: browser.consoleLog.slice(-10) };
  console.log(JSON.stringify(report, null, 1));
  if (out) writeFileSync(out, JSON.stringify(report, null, 1));
} finally { await browser.close(); }
