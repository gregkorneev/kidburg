import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Префаб 14: детализированная музыкальная школа, фасад смотрит в +Z.
// Единственная BufferGeometry, пригодная для InstancedMesh и выгрузки чанков.
export function buildMusicSchoolGeometry() {
  const parts = [];
  const C = {
    wall: 0xf1ebdc, blue: 0x91c7d2, blueDark: 0x427c91, blueDeep: 0x2d5367,
    roof: 0x9a5349, roofEdge: 0x6b302c, white: 0xfff9ed, glass: 0x84b8cf,
    wood: 0x98715d, gold: 0xe4bb5e, door: 0x466d86, shadow: 0xc4beb3,
    cream: 0xf9eccb, stone: 0xbeb6aa, notes: 0x28485d,
  };
  function add(geo, color, x = 0, y = 0, z = 0, rz = 0) {
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    const colorValue = new THREE.Color(color);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([colorValue.r, colorValue.g, colorValue.b], i * 3);
    // BufferGeometryUtils требует одинакового набора атрибутов у всех частей.
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }
  const box = (w,h,d,x,y,z,c,rz=0) => add(new THREE.BoxGeometry(w,h,d),c,x,y,z,rz);
  const ball = (r,x,y,z,c,sx=1,sy=1,sz=1) => {
    const g = new THREE.SphereGeometry(r,10,8);
    g.scale(sx,sy,sz); add(g,c,x,y,z);
  };
  function line(points, radius, color) {
    if (points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),false,'centripetal');
    add(new THREE.TubeGeometry(curve,Math.max(8,points.length*6),radius,5,false),color);
  }
  function window(x,y,z,w=1.9,h=2) {
    box(w,h,0.1,x,y,z,C.glass);
    box(w+0.22,0.14,0.2,x,y+h/2,z+0.04,C.white);
    box(w+0.22,0.14,0.2,x,y-h/2,z+0.04,C.white);
    for (const sx of [-1,1]) box(0.13,h+0.12,0.2,x+sx*w/2,y,z+0.04,C.white);
    box(0.1,h,0.22,x,y,z+0.055,C.white);
    box(w,0.09,0.22,x,y,z+0.06,C.white);
    box(w+0.35,0.16,0.3,x,y-h/2-0.15,z+0.07,C.blueDark);
  }
  function note(x,y,z,scale=1,c=C.notes) {
    ball(0.20*scale,x,y,z,c,1.35,0.72,0.35);
    box(0.07*scale,0.78*scale,0.08*scale,x+0.22*scale,y+0.4*scale,z,c);
    box(0.32*scale,0.09*scale,0.08*scale,x+0.35*scale,y+0.76*scale,z,c);
  }
  // Здание и межэтажные пояса.
  box(19.2,0.45,11.1,0,0.225,0,C.stone);
  box(18.2,8.55,10.2,0,4.75,0,C.wall);
  for(const x of [-8.8,8.8]) {
    box(0.6,8.8,0.42,x,4.8,5.12,C.blue);
    box(0.76,0.32,0.6,x,8.95,5.12,C.white);
  }
  box(18.8,0.25,10.65,0,4.4,0,C.blueDark);
  box(19,0.35,10.7,0,8.96,0,C.white);
  box(19.4,0.18,10.95,0,9.18,0,C.blueDark);
  // Цельная симметричная крыша — без щели в коньке.
  const roof = new THREE.Shape();
  roof.moveTo(-10.5,9.2); roof.lineTo(0,12.35); roof.lineTo(10.5,9.2); roof.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roof,{depth:12,bevelEnabled:false});
  roofGeo.translate(0,0,-6);
  add(roofGeo,C.roof);
  box(21.1,0.19,0.37,0,9.2,6.08,C.roofEdge);
  // Второй этаж: равномерные высокие окна.
  for(const x of [-6.7,-4.15,4.15,6.7]) window(x,6.55,5.16,1.95,2.05);
  // Нижний этаж: витрины музыкальных классов.
  for(const x of [-6.55,-4.0,4.0,6.55]) window(x,2.45,5.16,2.0,2.65);
  // Центральный вход с двойной дверью и козырьком.
  box(3.0,3.5,0.24,0,2.35,5.18,C.blueDark);
  box(2.55,3.18,0.12,0,2.37,5.35,C.door);
  box(0.13,3.15,0.17,0,2.37,5.45,C.white);
  box(0.95,1.25,0.18,-0.6,2.8,5.47,C.glass);
  box(0.95,1.25,0.18,0.6,2.8,5.47,C.glass);
  box(0.10,0.12,0.18,-0.22,1.92,5.49,C.gold);
  box(0.10,0.12,0.18,0.22,1.92,5.49,C.gold);
  box(4.4,0.19,1.3,0,0.55,5.6,C.stone);
  box(3.65,0.16,0.85,0,0.69,6.04,C.white);
  box(4.45,0.28,1.75,0,4.48,5.62,C.blueDark);
  box(4.65,0.13,1.9,0,4.72,5.62,C.white);
  // Большой классический скрипичный ключ без таблички.
  // Золотистый рельеф с тёмной окантовкой.
  const clefZ = 6.90;

  const clefStroke = (points, radius = 0.105) => {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y]) => new THREE.Vector3(x, y, clefZ)),
      false,
      'centripetal'
    );
    // Объёмный золотой штрих с тёмным контуром.
    add(new THREE.TubeGeometry(curve, 140, radius + 0.045, 10, false), C.blueDeep);
    const frontCurve = new THREE.CatmullRomCurve3(
      points.map(([x, y]) => new THREE.Vector3(x, y, clefZ + 0.09)),
      false,
      'centripetal'
    );
    add(new THREE.TubeGeometry(frontCurve, 140, radius, 10, false), C.gold);
  };

  // Основная вертикальная линия с плавным нижним крючком.
  clefStroke([
    [0.17, 11.90],
    [0.08, 10.70],
    [-0.02, 9.40],
    [-0.08, 8.10],
    [-0.10, 6.85],
    [-0.11, 5.70],
    [-0.17, 4.92],
    [-0.38, 4.70],
    [-0.66, 4.80],
    [-0.73, 5.08]
  ]);

  // Характерная вытянутая верхняя петля.
  clefStroke([
    [0.17, 11.90],
    [0.12, 12.65],
    [0.32, 13.22],
    [0.71, 13.32],
    [1.02, 13.05],
    [1.10, 12.48],
    [0.89, 11.91],
    [0.48, 11.45],
    [-0.06, 11.02],
    [-0.43, 10.52],
    [-0.42, 9.98],
    [-0.08, 9.61],
    [0.38, 9.65]
  ], 0.095);

  // Основной широкий завиток — характерный силуэт G-ключа.
  clefStroke([
    [-0.08, 9.55],
    [-0.77, 9.37],
    [-1.27, 8.88],
    [-1.47, 8.13],
    [-1.30, 7.37],
    [-0.78, 6.88],
    [-0.06, 6.72],
    [0.70, 6.91],
    [1.17, 7.39],
    [1.31, 8.06],
    [1.10, 8.66],
    [0.65, 8.95],
    [0.13, 8.92],
    [-0.26, 8.60],
    [-0.33, 8.16],
    [-0.09, 7.88],
    [0.26, 7.90]
  ], 0.115);
  // Скрипичный ключ стилизован нотами на декоративных панелях.
  for(const x of [-8.05,8.05]) {
    box(0.85,1.65,0.15,x,6.55,5.25,C.blue);
    note(x-0.13,6.12,5.38,0.75,C.gold);
  }
  // Нотный стан и две ноты на фронтальной части козырька.
  for(let i=0;i<3;i++) box(3.7,0.035,0.06,0,4.48+i*0.075,6.55,C.cream);
  note(-0.7,4.46,6.62,0.35,C.gold);
  note(0.7,4.42,6.62,0.35,C.gold);
  const merged=mergeGeometries(parts,false);
  if(!merged) { for(const g of parts)g.dispose(); throw new Error('Не удалось собрать геометрию музыкальной школы'); }
  merged.computeVertexNormals();
  for(const g of parts)g.dispose();
  return merged;
}
