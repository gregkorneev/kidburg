// Наружная пожарная часть. Один BufferGeometry с цветами вершин для InstancedMesh.
// Локальный фасад обращён к +Z; разворот задаёт серверный экземпляр в чанке.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildFireStationGeometry() {
  const parts = [];
  const C = {
    cream: 0xf5e9cd, pale: 0xfff4d9, red: 0xd65a42,
    darkRed: 0xa94436, roof: 0x88382c, navy: 0x345568,
    blue: 0x6ca4ac, green: 0x438266, gold: 0xf0c85f,
    charcoal: 0x374344, stone: 0xd6c9a8, grey: 0x526d70,
    white: 0xfff9e8, trim: 0xd9dfce,
  };
  function add(geo, color, x=0, y=0, z=0) {
    geo.translate(x, y, z);
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    // ExtrudeGeometry добавляет UV; убираем у всех UV для совместимости mergeGeometries.
    g.deleteAttribute('uv');
    const rgb = new THREE.Color(color);
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i=0; i<colors.length; i+=3) {
      colors[i]=rgb.r; colors[i+1]=rgb.g; colors[i+2]=rgb.b;
    }
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));
    parts.push(g);
  }
  const box=(w,h,d,x,y,z,c)=>add(new THREE.BoxGeometry(w,h,d),c,x,y,z);
  const cylinder=(top,bottom,h,sides,x,y,z,c,rotationX=0)=>{
    const g=new THREE.CylinderGeometry(top,bottom,h,sides);
    if(rotationX) g.rotateX(rotationX);
    add(g,c,x,y,z);
  };
  function roof(w,d,height,x,y,z,c) {
    const shape=new THREE.Shape();
    shape.moveTo(-w/2,0); shape.lineTo(0,height);
    shape.lineTo(w/2,0); shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:false});
    g.translate(0,0,-d/2);
    add(g,c,x,y,z);
  }
  function window(x,y,z,w=1.8,h=1.35) {
    box(w+0.2,h+0.2,0.16,x,y,z,C.white);
    box(w,h,0.18,x,y,z+0.11,C.blue);
    box(0.10,h,0.07,x,y,z+0.23,C.white);
    box(w,0.10,0.07,x,y,z+0.23,C.white);
    box(w+0.35,0.15,0.3,x,y-h/2-0.08,z+0.12,C.stone);
  }
  // Читаемый силуэт двухэтажной станции, ширина 24, глубина 16.
  box(22.4,0.45,14.4,0,0.225,0,C.stone);
  box(21.4,8.5,13.5,0,4.6,0,C.cream);
  // Кирпичный красный цоколь, угловые акценты, межэтажный пояс.
  box(21.8,0.50,13.9,0,0.46,0,C.darkRed);
  for (const x of [-10.3,10.3]) {
    box(0.75,8.5,0.55,x,4.65,6.77,C.red);
    box(0.75,8.5,0.55,x,4.65,-6.77,C.red);
  }
  box(22.1,0.33,14.1,0,5.05,0,C.red);
  box(22.6,0.28,14.45,0,8.91,0,C.darkRed);
  roof(23.5,15.5,2.65,0,9.04,0,C.red);
  // Коньковая линия и лицевая окантовка фронтона.
  box(0.35,0.38,15.4,0,11.7,0,C.darkRed);
  roof(22.8,0.30,2.45,0,9.08,7.05,C.darkRed);
  roof(21.95,0.35,2.28,0,9.10,7.25,C.cream);
  // Два гаража. Арки заменены широкими воротами с рельефными секциями.
  for (const x of [-5.5,1.15]) {
    box(5.6,4.15,0.24,x,2.86,6.91,C.darkRed);
    box(5.08,3.7,0.27,x,2.83,7.10,C.navy);
    box(4.74,3.35,0.12,x,2.8,7.28,C.grey);
    for (let j=0;j<5;j++) box(4.80,0.055,0.04,x,1.46+j*0.67,7.36,C.trim);
    for (const xx of [x-2.21,x+2.21]) box(0.09,3.46,0.06,xx,2.82,7.37,C.cream);
    // Окна на воротах.
    for (let k=-1;k<=1;k++) {
      box(1.15,0.50,0.06,x+k*1.43,3.8,7.38,C.blue);
      box(1.22,0.08,0.06,x+k*1.43,3.8,7.42,C.cream);
    }
    box(5.75,0.24,0.44,x,5.08,7.0,C.red);
  }
  // Отдельная боковая дверь справа с остеклением.
  box(2.55,3.55,0.28,7.72,2.66,6.94,C.green);
  box(2.18,3.23,0.20,7.72,2.69,7.13,C.navy);
  box(1.7,1.15,0.10,7.72,3.42,7.27,C.blue);
  box(0.10,1.16,0.08,7.72,3.42,7.34,C.white);
  box(1.8,0.10,0.08,7.72,3.42,7.34,C.white);
  box(0.09,0.20,0.14,8.42,2.2,7.33,C.gold);
  box(2.9,0.28,1.0,7.72,0.45,7.15,C.stone);
  // Окна второго этажа.
  for (const x of [-8.35,-5.3,-2.25,2.25,5.3,8.35]) window(x,6.65,6.84,1.9,1.6);
  // Парадная вывеска на полосе над воротами: надпись из объёмных линий.
  box(13.6,0.77,0.20,-1.5,8.13,7.02,C.white);
  box(13.8,0.08,0.26,-1.5,8.55,7.05,C.darkRed);
  box(13.8,0.08,0.26,-1.5,7.72,7.05,C.darkRed);
  // Скелетные кириллические глифы векторными штрихами: чёткие, без пиксельных блоков.
  const L={
    'П': [[[0,0],[0,1],[1,1],[1,0]]],
    'О': [[[0.12,0],[0.88,0],[1,0.18],[1,0.82],[0.88,1],[0.12,1],[0,0.82],[0,0.18],[0.12,0]]],
    'Ж': [[[0,0],[.5,.5],[0,1]],[[1,0],[.5,.5],[1,1]],[[.5,0],[.5,1]]],
    'А': [[[0,0],[.5,1],[1,0]],[[.2,.43],[.8,.43]]],
    'Р': [[[0,0],[0,1],[.75,1],[1,.82],[1,.65],[.75,.5],[0,.5]]],
    'Н': [[[0,0],[0,1]],[[0,.52],[1,.52]],[[1,0],[1,1]]],
    'Я': [[[1,0],[1,1],[.28,1],[0,.82],[0,.65],[.28,.5],[1,.5]],[[.47,.5],[0,0]]],
    'Ч': [[[0,1],[0,.55],[1,.55]],[[1,1],[1,0]]],
    'С': [[[1,.85],[.78,1],[.18,1],[0,.78],[0,.22],[.18,0],[.78,0],[1,.15]]],
    'Т': [[[0,1],[1,1]],[[.5,1],[.5,0]]],
    'Ь': [[[0,1],[0,0],[.73,0],[1,.15],[1,.37],[.73,.52],[0,.52]]],
  };
  const label='ПОЖАРНАЯ ЧАСТЬ';
  const letterW=.48, step=.70, height=.40;
  const full=(label.length-1)*step+letterW;
  let originX=-1.5-full/2;
  for (const char of label) {
    if (char===' ') {originX+=step*.58;continue;}
    for(const segment of L[char]??[]) {
      const points=segment.map(([x,y])=>new THREE.Vector3(originX+x*letterW,7.94+y*height,7.20));
      const curve=new THREE.CatmullRomCurve3(points,false,'centripetal');
      add(new THREE.TubeGeometry(curve,Math.max(12,points.length*6),.021,6,false),C.darkRed);
    }
    originX+=step;
  }
  // Круглый символ службы на фронтоне: красный щит с жёлтой звездой.
  cylinder(0.82,0.82,0.17,18,0,10.05,7.46,C.darkRed,Math.PI/2);
  cylinder(0.65,0.65,0.18,18,0,10.05,7.56,C.gold,Math.PI/2);
  for(let i=0;i<4;i++) {
    const angle=i*Math.PI/4;
    const g=new THREE.BoxGeometry(.14,.82,.06);g.rotateZ(angle);
    add(g,C.red,0,10.05,7.68);
  }
  // Сигнальные фонари над гаражами.
  for(const x of [-8.3,4.0]) {
    box(.38,.38,.37,x,5.37,7.05,C.darkRed);
    box(.26,.27,.40,x,5.39,7.12,C.gold);
  }
  const merged=mergeGeometries(parts,false);
  if(!merged) {for(const g of parts)g.dispose();throw new Error('Не удалось объединить геометрии пожарной части');}
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  for(const g of parts)g.dispose();
  return merged;
}
