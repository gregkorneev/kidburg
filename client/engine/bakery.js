// Наружная модель пекарни в центре города. Положительное Z — сторона входа.
// Каждая деталь объединяется в одну цветную геометрию для InstancedMesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildBakeryGeometry() {
  const pieces = [];
  const C = {
    cream: 0xf5e9cd, peach: 0xe8b491, trim: 0xfff1d8,
    cocoa: 0x805143, roof: 0xb65a4b, dark: 0x843c38,
    window: 0x77b0b8, frame: 0xfff4dc, awning: 0xc96156,
    gold: 0xedbc61, wood: 0x9b6748, pastry: 0xdca45e,
    bread: 0xb87939, shadow: 0x9c7762, green: 0x668a5c,
  };
  function add(geometry, color, x=0, y=0, z=0, rx=0, ry=0, rz=0) {
    if (rx) geometry.rotateX(rx);
    if (ry) geometry.rotateY(ry);
    if (rz) geometry.rotateZ(rz);
    geometry.translate(x,y,z);
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    // Only position/normal/color attributes, all non-indexed.
    const col = new THREE.Color(color);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i=0; i<arr.length; i+=3) {arr[i]=col.r;arr[i+1]=col.g;arr[i+2]=col.b;}
    g.setAttribute('color',new THREE.BufferAttribute(arr,3));
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    pieces.push(g);
  }
  const box=(w,h,d,x,y,z,c)=>add(new THREE.BoxGeometry(w,h,d),c,x,y,z);
  const cyl=(r,h,x,y,z,c,n=12,rx=0)=>add(new THREE.CylinderGeometry(r,r,h,n),c,x,y,z,rx);
  const sphere=(r,x,y,z,c)=>add(new THREE.SphereGeometry(r,10,6),c,x,y,z);
  const roofSlope=(x,rz)=>add(new THREE.BoxGeometry(9.55,0.25,15.4),C.roof,x,10.24,0,0,0,rz);

  // Цоколь, двухэтажный корпус, уголки и межэтажный пояс.
  box(17.6,0.38,13.4,0,0.19,0,C.shadow);
  box(17.2,8.6,13,0,4.55,0,C.cream);
  box(17.5,0.28,13.25,0,4.45,0,C.peach);
  box(17.8,0.38,13.55,0,8.78,0,C.trim);
  for (const x of [-8.35,8.35]) {
    box(0.55,8.35,0.42,x,4.5,6.48,C.peach);
    box(0.42,8.35,0.55,x,4.5,-6.35,C.peach);
  }
  // Цельная двускатная крыша без щели между скатами.
  const roofProfile = new THREE.Shape();
  roofProfile.moveTo(-9.45, 8.99);
  roofProfile.lineTo(0, 12.15);
  roofProfile.lineTo(9.45, 8.99);
  roofProfile.closePath();

  const roofGeometry = new THREE.ExtrudeGeometry(roofProfile, {
    depth: 15.4,
    bevelEnabled: false,
    steps: 1,
  });
  roofGeometry.translate(0, 0, -7.7);
  add(roofGeometry, C.roof);

  // Карниз вдоль передней стороны здания.
  box(19.2, 0.22, 0.35, 0, 8.99, 7.68, C.dark);
  // Витрины на первом этаже — стекло, вертикальные переплёты, подоконники.
  function window(x,y,w,h,z=6.57) {
    box(w+0.32,h+0.27,0.2,x,y,z,C.frame);
    box(w,h,0.24,x,y,z+0.08,C.window);
    box(0.13,h,0.28,x,y,z+0.23,C.frame);
    box(w,0.13,0.28,x,y,z+0.23,C.frame);
    box(w+0.54,0.18,0.42,x,y-h/2-0.08,z+0.16,C.peach);
  }
  for (const x of [-5.15,5.15]) window(x,2.34,4.65,3.35);
  for (const x of [-5.85,-2.1,2.1,5.85]) window(x,6.63,2.55,1.95);
  // Дверь посередине, рамка, дверные стёкла и ручка.
  box(2.45,3.55,0.24,0,2.3,6.62,C.wood);
  box(1.96,2.7,0.28,0,2.58,6.78,C.window);
  box(0.13,2.7,0.30,0,2.58,6.95,C.frame);
  box(0.15,0.25,0.16,0.76,2.2,7.01,C.gold);
  box(3.2,0.24,1.15,0,0.42,6.8,C.peach);
  // Два полосатых навеса над витринами.
  for (const xc of [-5.15,5.15]) {
    box(5.6,0.15,2.1,xc,4.19,7.28,C.cream);
    for(let k=0;k<10;k++) {
      const x=xc-2.52+k*0.56;
      box(0.55,0.085,2.13,x,4.27,7.28,k%2?C.cream:C.awning);
      box(0.55,0.35,0.16,x,4.03,8.32,k%2?C.cream:C.awning);
    }
  }
  // Главная вывеска — объёмная табличка с символами выпечки.
  box(7.6,1.05,0.22,0,8.18,6.77,C.cocoa);
  box(7.32,0.82,0.25,0,8.18,6.94,C.cream);
  // Золотистый батон по центру вывески.
  const loaf = new THREE.SphereGeometry(1, 20, 12);
  loaf.scale(1.15, 0.33, 0.20);
  add(loaf, C.bread, 0, 8.16, 7.27);

  // Светлые диагональные надрезы на хлебе.
  for (const x of [-0.49, 0, 0.49]) {
    add(
      new THREE.BoxGeometry(0.09, 0.39, 0.045),
      C.cream, x, 8.20, 7.465, 0, 0, -0.48
    );
  }
  // Булочки на полках в витринах — хорошо различимые с площади силуэты.
  for(const xc of [-5.15,5.15]) {
    box(4.0,0.17,0.28,xc,1.5,6.88,C.wood);
    for(let j=0;j<5;j++) {
      sphere(0.28,xc-1.55+j*0.78,1.82,7.03,j%2?C.pastry:C.bread);
    }
  }
  // Боковые деревянные панели и лампы около входа.
  for(const x of [-1.75,1.75]) {
    box(0.18,0.65,0.2,x,3.48,6.88,C.dark);
    sphere(0.22,x,3.13,6.95,C.gold);
  }
  // Небольшие растения у входа.
  for(const x of [-1.8,1.8]) {
    box(0.54,0.6,0.54,x,0.54,7.02,C.wood);
    cyl(0.32,0.6,x,1.04,7.02,C.green,7);
  }
  const geometry=mergeGeometries(pieces,false);
  for(const g of pieces) g.dispose();
  if(!geometry) throw new Error('Не удалось объединить геометрии пекарни');
  geometry.computeVertexNormals();
  return geometry;
}
