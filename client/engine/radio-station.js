// Радиостанция городского хаба: один цветной префаб, фасад направлен к +Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildRadioStationGeometry() {
  const parts = [];
  const C = {
    wall: 0xf3e9d6, trim: 0xfff8e9, teal: 0x6ca4ac, dark: 0x345568,
    roof: 0xb65744, roofDark: 0x7e352e, window: 0x86b9ca, door: 0x3a6872,
    brass: 0xf0c85f, sign: 0xfff5df, darkSign: 0x315467,
    base: 0xbab6a5, aerial: 0x506875, red: 0xd65a42,
  };
  function add(g, hex, x=0, y=0, z=0, rx=0, ry=0, rz=0) {
    if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
    g.translate(x,y,z);
    if (g.index) { const expanded = g.toNonIndexed(); g.dispose(); g=expanded; }
    const c=new THREE.Color(hex), data=new Float32Array(g.attributes.position.count*3);
    for (let i=0;i<data.length;i+=3) {data[i]=c.r;data[i+1]=c.g;data[i+2]=c.b;}
    g.setAttribute('color',new THREE.BufferAttribute(data,3));
    parts.push(g);
  }
  const box=(w,h,d,x,y,z,c)=>add(new THREE.BoxGeometry(w,h,d),c,x,y,z);
  const cylinder=(rt,rb,h,n,x,y,z,c,rx=0)=>add(new THREE.CylinderGeometry(rt,rb,h,n),c,x,y,z,rx);
  const line=(pts,c,r=0.045)=> {
    const curve=new THREE.CatmullRomCurve3(pts.map(([x,y,z])=>new THREE.Vector3(x,y,z)),false,'centripetal');
    add(new THREE.TubeGeometry(curve,Math.max(12,pts.length*12),r,7,false),c);
  };
  function windowAt(x,y,w=2.15,h=1.95) {
    box(w,h,0.14,x,y,5.68,C.window);
    box(w+0.22,0.16,0.22,x,y+h/2,5.75,C.trim);
    box(w+0.22,0.16,0.22,x,y-h/2,5.75,C.trim);
    for(const side of [-1,1]) box(0.13,h,0.21,x+side*w/2,y,5.76,C.trim);
    box(0.12,h,0.22,x,y,5.79,C.trim);
    box(w,0.1,0.22,x,y,5.80,C.trim);
    box(w+0.3,0.13,0.35,x,y-h/2-0.15,5.82,C.teal);
  }
  // Корпус и фундамент в пределах отведённой станции 18x14 м.
  box(16.0,0.42,11.9,0,0.21,0,C.base);
  box(15.5,8.45,11.35,0,4.65,0,C.wall);
  box(15.8,0.26,11.6,0,4.45,0,C.teal);
  box(16.2,0.32,11.9,0,8.96,0,C.trim);
  for(const x of [-7.42,7.42]) {
    box(0.53,8.4,0.55,x,4.65,5.5,C.teal);
    box(0.69,0.52,0.8,x,8.58,5.53,C.trim);
  }
  // Цельная крыша с треугольным фронтоном.
  const shape=new THREE.Shape();
  shape.moveTo(-8.55,8.99);shape.lineTo(0,11.68);shape.lineTo(8.55,8.99);shape.closePath();
  const roof=new THREE.ExtrudeGeometry(shape,{depth:12.7,bevelEnabled:false});
  roof.translate(0,0,-6.35);add(roof,C.roof);
  box(17.2,0.2,0.28,0,8.99,6.39,C.roofDark);
  // Верхние окна и две широкие витрины радиостудии.
  for(const x of [-5.65,-3.05,3.05,5.65]) windowAt(x,6.52,2.08,1.92);
  windowAt(-4.72,2.48,3.3,2.8); windowAt(4.72,2.48,3.3,2.8);
  // Вход — симметричная двухстворчатая дверь.
  box(2.3,3.15,0.22,0,2.30,5.77,C.dark);
  box(1.0,2.82,0.14,-0.56,2.3,5.91,C.door);
  box(1.0,2.82,0.14,0.56,2.3,5.91,C.door);
  box(0.13,2.84,0.18,0,2.3,6.01,C.trim);
  for(const x of [-0.16,0.16]) box(0.10,0.13,0.08,x,2.23,6.06,C.brass);
  box(2.85,0.2,1.0,0,0.5,6.0,C.base);
  // Козырёк и контрастная вывеска с радиоволнами.
  box(4.6,0.24,1.23,0,4.14,6.03,C.teal);
  box(5.5,1.02,0.20,0,8.15,5.79,C.sign);
  box(5.62,0.11,0.25,0,8.70,5.82,C.brass);
  box(5.62,0.11,0.25,0,7.60,5.82,C.brass);
  // Круглая центральная эмблема: микрофон + три дуги радиосигнала.
  cylinder(0.29,0.29,0.16,24,0,8.15,5.96,C.dark,Math.PI/2);
  cylinder(0.19,0.19,0.20,24,0,8.15,6.09,C.brass,Math.PI/2);
  for(const side of [-1,1]) for(let k=0;k<2;k++) {
    const radius=0.66+k*0.29;
    const pts=[];
    for(let t=-0.84;t<=0.84+0.001;t+=0.14) {
      const xx=side*(0.48+Math.cos(t)*radius);
      const yy=8.15+Math.sin(t)*radius;
      pts.push([xx,yy,5.94]);
    }
    line(pts,C.darkSign,0.055);
  }
  // Антенна над крышей: центральная мачта с поперечинами и маячком.
  cylinder(0.10,0.16,4.6,8,3.8,13.4,-0.8,C.aerial);
  cylinder(0.19,0.19,0.24,8,3.8,15.78,-0.8,C.red);
  for(const y of [12.3,13.3,14.3]) {
    box(2.0,0.1,0.13,3.8,y,-0.8,C.aerial);
    for(const dx of [-0.88,0.88]) cylinder(0.04,0.04,0.43,6,3.8+dx,y+0.19,-0.8,C.aerial);
  }
  // Боковые фонари возле входа.
  for(const x of [-1.85,1.85]) {
    box(0.22,0.55,0.24,x,3.10,5.85,C.brass);
    box(0.30,0.14,0.30,x,3.43,5.85,C.dark);
  }
  const merged=mergeGeometries(parts,false);
  if(!merged) throw new Error('Не удалось объединить геометрии радиостанции');
  merged.computeVertexNormals();
  for(const g of parts) g.dispose();
  return merged;
}
