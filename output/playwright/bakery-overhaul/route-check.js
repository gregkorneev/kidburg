async page => {
  await page.goto('http://127.0.0.1:5188/bakery-preview.html?debug=1&quality=low');
  await page.waitForFunction(() => window.__bakery?.renderer.info.render.frame > 1);
  await page.evaluate(() => window.__bakery.setCameraLook(0));
  const position = () => page.evaluate(() => ({ x: window.__bakery.player.position.x, z: window.__bakery.player.position.z }));
  async function move(axis, dest) {
    let p = await position();
    const key = axis === 'x' ? (dest > p.x ? 'KeyD' : 'KeyA') : (dest > p.z ? 'KeyS' : 'KeyW');
    const sign = dest > p[axis] ? 1 : -1;
    await page.keyboard.down(key);
    let moved = false;
    for (let i = 0; i < 220; i++) {
      await page.waitForTimeout(25);
      p = await position();
      if ((dest - p[axis]) * sign <= 0.12) { moved = true; break; }
    }
    await page.keyboard.up(key);
    if (!moved) throw Error(`не удалось пройти к ${axis}=${dest}, позиция ${JSON.stringify(p)}`);
  }
  async function action(expected) {
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(140);
    const title = await page.locator('.objective-card h1').innerText();
    if (!title.includes(expected)) throw Error(`ожидалось ${expected}, получено ${title}, позиция ${JSON.stringify(await position())}`);
    return title;
  }
  const stages = [];
  await move('x', -5.25); stages.push(await action('ингредиенты'));
  await move('x', -4.0); await move('z', 0.5); stages.push(await action('Сформуй'));
  await page.screenshot({path:'output/playwright/bakery-overhaul/after-order.png'});
  await move('x', 0); await move('z', -2.55); stages.push(await action('печь'));
  await move('x', 2.6); await move('z', 0.45); await move('x', 5); stages.push(await action('Забери'));
  await move('x', 3); await move('z', 3.7); stages.push(await action('Передай'));
  await move('x', -2.2); stages.push(await action('Заказ готов'));
  return { stages, position: await position() };
}
