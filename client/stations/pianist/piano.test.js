import test from 'node:test';
import assert from 'node:assert/strict';
import { createPiano } from './piano.js';

test('модель содержит восемь белых и пять чёрных интерактивных клавиш', () => {
  const piano = createPiano();
  assert.equal(piano.keys.size, 13);
  assert.equal([...piano.keys.values()].filter((key) => !key.userData.black).length, 8);
  assert.equal([...piano.keys.values()].filter((key) => key.userData.black).length, 5);
  assert.ok(piano.keys.get('C#4').position.x > piano.keys.get('C4').position.x);
  assert.ok(piano.keys.get('C#4').position.x < piano.keys.get('D4').position.x);
  const c = piano.keys.get('C4');
  const y = c.position.y;
  const material = c.material;
  assert.equal(piano.press('C4', true), true);
  assert.ok(c.position.y < y);
  assert.notEqual(c.material, material);
  piano.press('C4', false);
  assert.equal(c.position.y, y);
  assert.equal(c.material, material);
  piano.dispose();
  assert.equal(piano.keys.size, 0);
  assert.equal(piano.root.children.length, 0);
});

test('клавиатура и верхний корпус пианино имеют непрерывные опоры', () => {
  const piano = createPiano();
  const boundsFor = (color) => {
    const mesh = piano.root.children.find((child) => child.isMesh && `#${child.material.color.getHexString()}` === color);
    assert.ok(mesh, `не найдена часть цвета ${color}`);
    mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox;
  };
  const body = boundsFor('#282b35');
  const backSupport = boundsFor('#30343e');
  const top = boundsFor('#3c404a');
  const keybed = boundsFor('#343743');
  const support = boundsFor('#343c4b');
  const score = boundsFor('#fff5d8');
  const whiteKeyBottom = Math.min(...[...piano.keys.values()].filter((key) => !key.userData.black).map((key) => key.position.y - 0.075 / 2));
  assert.ok(keybed.max.y >= whiteKeyBottom - 0.01, 'белые клавиши должны опираться на клавиатурную полку');
  assert.ok(backSupport.min.y <= body.max.y + 0.01, 'задняя стойка должна соединяться с корпусом');
  assert.ok(backSupport.max.y >= top.min.y - 0.01, 'верхняя крышка должна опираться на заднюю стойку');
  assert.ok(support.min.y <= top.max.y + 0.01, 'пюпитр должен опираться на крышку');
  assert.ok(support.max.y >= score.min.y - 0.01, 'ноты должны стоять на опоре пюпитра');
  piano.dispose();
});
