import * as T from 'three';
import { mountDragonKeys } from './dragon-keys.js';
import { mountDragonHardware } from './dragon-hardware.js';
import { createPackGallery } from './dragon-pack-gallery.js';
import { createMarket, simulateWeek, ITEMS, EDITION_MATERIAL, sellPrice, buyPrice } from './economy/market.js';
import { connectChain, bridgeMarket } from './chain/bridge.js';
import { DRAGON_ART } from './dragon-art.js';
import { ITEM_ART } from './item-art.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import kilnBytes from '../outputs/dragon-link/kiln-multiview/kiln-magnific.glb';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const canvas = document.querySelector('#view');
const hint = document.querySelector('#hint');
const linkButton = document.querySelector('#link');
const titleScreen = document.querySelector('#title');
const muteButton = document.querySelector('#mute');
try { mount(); } catch (error) {
  console.error(error);
  document.querySelector('#fallback').hidden = false;
}

function mount() {
// ───────────────────────────── renderer / scene ─────────────────────────────
const renderer = new T.WebGLRenderer({canvas, antialias:true, alpha:true, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.setClearColor(0x000000,0);   // transparent: the CSS 'paper' shows through
renderer.toneMapping = T.NeutralToneMapping;   // keeps the toy's saturated plastic colours
renderer.toneMappingExposure = .92;
const scene = new T.Scene();
const environment = new RoomEnvironment();
const pmrem = new T.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(environment,.04).texture;
environment.dispose();
pmrem.dispose();
const camera = new T.PerspectiveCamera(34,1,.1,50);
camera.position.set(0,.1,9.7);
for (const [x,y,z,power,color] of [[-4,6,8,2.6,0xfff4ea],[5,2,5,1.4,0xf0e6ff],[0,5,-5,2.5,0xffffff]]) {
  const light = new T.DirectionalLight(color,power);
  light.position.set(x,y,z); scene.add(light);
}
scene.add(new T.HemisphereLight(0xfff6ff,0x8a6a90,.7));
// warm lamp on the left, cool glow on the right — same as the bedroom backdrop
const rim = new T.PointLight(0xffb070,2,10);rim.position.set(-3.6,1.5,2);scene.add(rim);
const rim2 = new T.PointLight(0xc8b0ff,2,10);rim2.position.set(3.6,1.2,2);scene.add(rim2);

// 90s anime bedroom backdrop (Magnific), fitted like CSS background-size:cover; gradient until it loads
let backdrop = null;
{
  const c=document.createElement('canvas');c.width=4;c.height=256;
  const g=c.getContext('2d'),gr=g.createLinearGradient(0,0,0,256);
  gr.addColorStop(0,'#2a1640');gr.addColorStop(.6,'#3d2152');gr.addColorStop(1,'#140c1f');
  g.fillStyle=gr;g.fillRect(0,0,4,256);
  // product-sheet look: the page itself is the backdrop
}

const composer=null,bloom=null; // no post-processing: cheaper and no bloom haze on the light paper page

// ───────────────────────────── materials / constants ─────────────────────────────
const mat = (color,opts={}) => new T.MeshStandardMaterial({color,roughness:.37,...opts});
function canvasTex(size,draw,repeat=1){
  const c=document.createElement('canvas');c.width=c.height=size;draw(c.getContext('2d'),size);
  const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(repeat,repeat);t.anisotropy=4;return t;
}
const plum = new T.MeshPhysicalMaterial({
  color:0x512650, roughness:.3, metalness:.12, clearcoat:.45, clearcoatRoughness:.26
});
const gasket = mat(0x171222,{roughness:.62});
function moldedPlastic(color) {
  return new T.MeshPhysicalMaterial({
    color, roughness:.43, clearcoat:.22, clearcoatRoughness:.41
  });
}
const black = mat(0x211b28);
const gold = mat(0xeabb55,{metalness:.85,roughness:.24});
const steel = mat(0xc7b6a4,{metalness:.7});
const linkCut = 1.40;
const pinOffset = .024;
const pinDepth = .018;
let dockSpacing = linkCut + pinOffset + pinDepth / 2;
// The front of the shell; the bezel cluster now sits *inside* a pocket cut into it.
const FRONT = .56, BEZEL_FACE = .535, POCKET_FLOOR = .40;
const keyLabels = ['◀','●','▶'];
const menu = ['CARE','PLAY','WALK','SHOP','LINK','STATUS'];
// While two units are linked, feeding and walks make no sense: both units show this menu instead.
const LINK_MENU = ['BOSS','TRADE','GIFT','UNLINK'];
const menuOf = () => docked ? LINK_MENU : menu;
// 商店街 market street: merchants, prices and the player's bag (see ./economy)
const market = createMarket();
// when the game server is there, the same market settles on NEAR testnet (see ./chain)
const chainReady = connectChain().then(chain => chain && bridgeMarket(market, chain)).catch(e => { console.warn('chain unavailable, playing offline', e); return null; });
const STALLS = ['kama','gen'];
market.on(snap => window.dispatchEvent(new CustomEvent('dragonlink:market', { detail: snap })));
const devices = [];
const targets = [];
const W = 720, H = 544;

function rounded(w,h,r) {
  const s = new T.Shape(), x=-w/2,y=-h/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
  s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);
  s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
}
function roundedPath(w,h,r,cx,cy){
  const s=new T.Path(),x=cx-w/2,y=cy-h/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
  s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);
  s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
}
function plate(w,h,r,depth,material,profile=rounded(w,h,r)) {
  return new T.Mesh(new T.ExtrudeGeometry(profile,{depth,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.028,bevelThickness:.025,curveSegments:12}),material);
}
function bezelProfile() {
  const s = new T.Shape();
  s.moveTo(-.68,-1.05);
  s.quadraticCurveTo(-.94,-1.03,-.98,-.82);
  s.lineTo(-.98,.77);
  s.quadraticCurveTo(-.98,.90,-.88,.96);
  s.lineTo(-.69,1.055);s.lineTo(-.28,1.005);s.lineTo(0,1.17);
  s.lineTo(.28,1.005);s.lineTo(.69,1.055);s.lineTo(.88,.96);
  s.quadraticCurveTo(.98,.90,.98,.77);
  s.lineTo(.98,-.82);
  s.quadraticCurveTo(.94,-1.03,.68,-1.05);
  s.closePath();
  return s;
}
function lineMesh(points,r,material) {
  return new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points),Math.max(12,points.length*4),r,7,false),material);
}

// Clip the outline against the mating plane, then round the front and rear in depth.
function outline(side) {
  const points = Array.from({length:180},(_,i)=>{
    const a=i*2*Math.PI/180, y=Math.sin(a);
    // chunkier egg (+12% wide, +8% tall) so a thick plastic rim frames the bezel, like the reference
    return new T.Vector2(Math.cos(a)*1.31*1.12*(1-.16*y),y*1.67*1.08);
  });
  const cut=linkCut, result=[];
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    const insideA=a.x*side<=cut,insideB=b.x*side<=cut;
    if(insideA) result.push(a);
    if(insideA!==insideB) result.push(new T.Vector2(cut*side,a.y+(b.y-a.y)*(cut*side-a.x)/(b.x-a.x)));
  }
  return result;
}
// Pocket outline: the bezel silhouette plus a small clearance, in shell space.
function pocketOutline() {
  const pts=bezelProfile().getSpacedPoints(96);pts.pop();
  return pts.map(p=>new T.Vector2(p.x*1.045,p.y*1.035+.06));
}
function shellGeo(side) {
  const p=outline(side), pos=[],idx=[],n=p.length;
  // A flatter, fuller front face (r .91) so the screen pocket has a real rim around it.
  // soft pebble profile: rounded back, full belly, gently domed front shoulder
  const rings=[[-.55,.74],[-.545,.82],[-.53,.875],[-.50,.92],[-.45,.955],[-.38,.98],[-.29,.995],[-.15,1],[.10,1],[.24,.994],[.34,.982],[.42,.965],[.48,.948],[.525,.93],[FRONT,.91]];
  for(const [z,r] of rings) for(const v of p) pos.push(v.x*r,v.y*r,z);
  for(let j=0;j<rings.length-1;j++) for(let i=0;i<n;i++){
    const a=j*n+i,b=j*n+(i+1)%n;idx.push(a,b,b+n,a,b+n,a+n);
  }
  // rear cap (solid)
  for(const [a,b,c] of T.ShapeUtils.triangulateShape(p,[])) idx.push(c,b,a);
  const frontOutline=p.map(v=>v.clone().multiplyScalar(rings.at(-1)[1]));
  const hole=pocketOutline(), m=hole.length, frontStart=(rings.length-1)*n;
  const wall=pos.length/3;
  const mouth=hole.map(v=>new T.Vector2(v.x*1.025,.06+(v.y-.06)*1.025));
  for(const [z,points] of [[FRONT,mouth],[FRONT-.035,hole],[POCKET_FLOOR,hole]]){
    for(const v of points)pos.push(v.x,v.y,z);
  }
  for(const [a,b,c] of T.ShapeUtils.triangulateShape(frontOutline,[mouth.slice()])){
    const map=i=>i<n?frontStart+i:wall+i-n;
    idx.push(map(a),map(b),map(c));
  }
  for(let j=0;j<2;j++)for(let i=0;i<m;i++){
    const a=wall+j*m+i,b=wall+j*m+(i+1)%m;
    idx.push(a,b+m,b,a,a+m,b+m);
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  const uv=[];for(let i=0;i<pos.length;i+=3)uv.push((pos[i]+1.4)/2.8+pos[i+2]*.21,(pos[i+1]+1.7)/3.4+pos[i+2]*.15);
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  g.setIndex(idx);g.computeVertexNormals();return g;
}
function add(group,mesh,x=0,y=0,z=0) {mesh.position.set(x,y,z);group.add(mesh);return mesh}
function screw(g,x,y,z,back=false) {
  const head=new T.Mesh(new T.CylinderGeometry(.048,.051,.028,20),steel);head.rotation.x=Math.PI/2;
  add(g,head,x,y,z);
  for(const a of [0,Math.PI/2]){const slot=new T.Mesh(new T.BoxGeometry(.061,.009,.009),black);slot.rotation.z=a;add(g,slot,x,y,z+(back?-.016:.016));}
}
function textTexture(label,size=128) {
  const c=document.createElement('canvas');c.width=c.height=size;
  const p=c.getContext('2d');p.fillStyle='#342138';p.font='bold '+(size*.67)+'px system-ui';p.textAlign='center';p.textBaseline='middle';p.fillText(label,size/2,size*.51);
  return new T.CanvasTexture(c);
}
function glowTexture(){
  const c=document.createElement('canvas');c.width=c.height=64;
  const g=c.getContext('2d'),r=g.createRadialGradient(32,32,0,32,32,32);
  r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.25,'rgba(255,255,255,.55)');r.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=r;g.fillRect(0,0,64,64);return new T.CanvasTexture(c);
}
const glow=glowTexture();

function make(side,name,color,keyColor) {
  const group=new T.Group();scene.add(group);
  const body=new T.Group();group.add(body);
  const d={side,name,group,body,selection:0,page:null,sub:0,mood:'idle',moodUntil:0,hatched:false,stage:0,xp:0,hunger:3,joy:3,energy:4,gems:0,
    rx:0,ry:side*-.22,keys:[],kick:0,game:null,toast:null,fx:{},found:null,lastDraw:0,attention:false};
  const geo=shellGeo(side);
  const shell=new T.Mesh(geo,moldedPlastic(color));add(body,shell);targets.push(shell);
  shell.userData={d,type:'shell'};
  const seamMaterial = mat(side===1?0x89654d:0x304c63,{metalness:.27,roughness:.22});
  const perimeter=outline(side).map(({x,y})=>new T.Vector3(x*1.001,y*1.001,-.075));
  add(body,new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(perimeter,true,'centripetal'),240,.011,6,true),seamMaterial));
  // Shallow relief on the solid shell evokes a dragon egg at actual toy scale.
  const relief=mat(side===1?0xb68b64:0x7d9bb0,{roughness:.49});
  const crownPattern=side===1
    ? [[-.56,1.22],[-.34,1.26],[-.18,1.20],[-.035,1.36],[.13,1.29],[.30,1.34],[.48,1.23]]
    : [[-.49,1.26],[-.35,1.18],[-.19,1.29],[0,1.19],[.19,1.29],[.35,1.18],[.49,1.26]];
  add(body,lineMesh(crownPattern.map(([x,y])=>new T.Vector3(x,y,FRONT+.006)),.012,relief));
  for(const x of [-.32,0,.32]){
    const profile=[[-.105,.048],[-.073,-.033],[0,-.081],[.073,-.033],[.105,.048]];
    add(body,lineMesh(profile.map(([dx,dy])=>new T.Vector3(x+dx,-1.20+dy,FRONT+.005)),.011,relief));
  }
  const back=plate(1.19,.90,.12,.045,mat(color,{metalness:.13,roughness:.28}));back.rotation.y=Math.PI;add(body,back,0,-.38,-.532);
  for(let i=0;i<3;i++) add(body,new T.Mesh(new T.BoxGeometry(.39,.021,.012),black),0,-.30-i*.075,-.605);
  for(const x of [-.72,.72]) for(const y of [-.79,.64]) screw(body,x,y,-.52,true);

  // The face insert sits below the shell mouth. Glass and LCD share its rounded aperture.
  const lcdWidth=1.76,lcdHeight=1.33,lcdY=.265;
  const bezelShape=bezelProfile();
  bezelShape.holes.push(roundedPath(lcdWidth+.085,lcdHeight+.085,.15,0,lcdY-.06));
  add(body,plate(1.94,1.79,.28,.085,plum,bezelShape),0,.06,BEZEL_FACE-.11);
  const gasketShape=rounded(lcdWidth+.13,lcdHeight+.13,.15);
  gasketShape.holes.push(roundedPath(lcdWidth,lcdHeight,.11,0,0));
  add(body,new T.Mesh(new T.ExtrudeGeometry(gasketShape,{
    depth:.045,bevelEnabled:false,curveSegments:16
  }),gasket),0,lcdY,BEZEL_FACE-.052);
  add(body,plate(lcdWidth+.04,lcdHeight+.04,.12,.012,black),0,lcdY,BEZEL_FACE-.11);
  const lcd=document.createElement('canvas');lcd.width=W;lcd.height=H;
  const texture=new T.CanvasTexture(lcd);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
  const lcdGeo=new T.ShapeGeometry(rounded(lcdWidth,lcdHeight,.105),16);
  const pos=lcdGeo.attributes.position, uv=lcdGeo.attributes.uv;
  for(let i=0;i<pos.count;i++)uv.setXY(i,pos.getX(i)/lcdWidth+.5,pos.getY(i)/lcdHeight+.5);
  d.screenMat=new T.MeshBasicMaterial({map:texture,toneMapped:false,color:0xffffff});
  const screen=new T.Mesh(lcdGeo,d.screenMat);
  add(body,screen,0,lcdY,BEZEL_FACE-.062);d.screen=screen;
  screen.userData={d,type:'shell'};targets.push(screen);
  add(body,new T.Mesh(lcdGeo,new T.MeshPhysicalMaterial({
    color:0xffffff,transparent:true,opacity:.055,roughness:.09,clearcoat:1,depthWrite:false
  })),0,lcdY,BEZEL_FACE-.022);
  d.ctx=lcd.getContext('2d');d.texture=texture;
  const keyMaterial = new T.MeshPhysicalMaterial({color:new T.Color(keyColor).multiplyScalar(.95),roughness:.38,clearcoat:.6,clearcoatRoughness:.25});
  d.keyZ=BEZEL_FACE-.065;
  for(let i=0;i<3;i++){
    const k=new T.Mesh(new T.ExtrudeGeometry(rounded(.40,.25,.125),{depth:.07,bevelEnabled:true,bevelSegments:6,bevelSize:.035,bevelThickness:.04,curveSegments:16}),keyMaterial);
    add(body,plate(.46,.30,.145,.012,gasket),(i-1)*.53,-.86,BEZEL_FACE-.026);
    add(body,k,(i-1)*.53,-.86,d.keyZ);
    k.userData={d,type:'key',index:i};targets.push(k);d.keys.push(k);
    add(k,new T.Mesh(new T.PlaneGeometry(.22,.22),new T.MeshBasicMaterial({map:textTexture(keyLabels[i]),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2})),0,0,.123);
  }
  for(const x of [-.85,.85]) for(const y of [-.87,.86]) screw(body,x,y,BEZEL_FACE+.005);
  d.lampMat=mat(0x716430,{emissive:0x000000});
  d.lamp=plate(.23,.10,.045,.018,d.lampMat);add(body,d.lamp,0,1.02,BEZEL_FACE-.02);
  const lampGlow=new T.Sprite(new T.SpriteMaterial({map:glow,color:0xb7ff3a,transparent:true,opacity:0,blending:T.AdditiveBlending,depthWrite:false}));
  lampGlow.scale.set(.6,.4,1);add(body,lampGlow,0,1.04,BEZEL_FACE+.08);d.lampGlow=lampGlow;
  const pad=plate(.25,.56,.11,.04,mat(0xc6cbd2,{metalness:.65,roughness:.32}));pad.rotation.y=side*Math.PI/2;
  add(body,pad,side*(linkCut-.051),-.15,-.03);d.pad=pad;pad.userData={d,type:'pad'};targets.push(pad);
  for(let i=-1;i<=1;i++){
    const pin=new T.Mesh(new T.CylinderGeometry(.039,.039,pinDepth,24),gold);pin.rotation.z=Math.PI/2;
    add(body,pin,side*(linkCut+pinOffset),-.15+i*.135,-.03);
  }
  devices.push(d);return d;
}

// Fit the live LCD and controls to the sculpted KILN shell.
function fitKiln(d, model, edition) {
  const shell = new T.Group();
  model.rotation.y = -Math.PI / 2;
  shell.add(model);
  // All editions share the original model’s 0.15 m reference height and origin.
  model.scale.setScalar(EGG_H / .15);
  // The friend docks on the right, so its magnetic socket must face left: mirror only the
  // sculpted shell; the faceplate, LCD and keys are rebuilt on top of it unmirrored.
  if (d.side === -1) model.scale.z *= -1;
  shell.updateMatrixWorld(true);
  const mesh = shell.getObjectByProperty('isMesh', true);

  const {face,screen} = mountDragonHardware(shell,mesh,edition,d.screenMat);
  d.keys = mountDragonKeys(shell,face);

  for (let i = targets.length - 1; i >= 0; i--) {
    if (targets[i].userData.d === d) targets.splice(i, 1);
  }
  d.body.clear();
  d.body.add(shell);
  for (const surface of [mesh,face,screen]) {
    surface.userData={d,type:'shell'};
    targets.push(surface);
  }
  d.screen=screen;
  d.keys.forEach((key,index) => {
    Object.assign(key.userData,{d,type:'key',index});
    targets.push(key);
  });
  const hitMaterial = new T.MeshBasicMaterial({visible:false});
  // distance from the console centre to its flat LINK face
  const box = new T.Box3().setFromObject(mesh);
  d.dockHalf = (d.side === 1 ? box.max.x : -box.min.x) - .004;
  d.pad = add(d.body, new T.Mesh(new T.BoxGeometry(.36,.65,.36), hitMaterial),d.side*(d.dockHalf-.07),0,.09);
  d.pad.userData = {d, type:'pad'};
  targets.push(d.pad);
  d.label = editionNames[edition] || d.name;
  d.edition = edition;
}

let docked=false;
const ember=make(1,'Ember',0xe6cba4,0xcb502b);
const glacier=make(-1,'Glacier',0x456b87,0xd8b66e);
let selected=ember,drag=null,started=false,battle=null,shake=0,searchingUntil=0;
// Glacier is the friend's console: it is off-screen until a LINK is made.
glacier.hatched=true;glacier.stage=Math.max(1,glacier.stage);glacier.group.visible=false;glacier.human=false;

const EGG_H=3.6;
// soft contact shadow under each toy, like a product photo
const shadowTex=canvasTex(128,(g,S)=>{const r=g.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2);r.addColorStop(0,'rgba(60,20,70,.55)');r.addColorStop(1,'rgba(60,20,70,0)');g.fillStyle=r;g.fillRect(0,0,S,S)});
for(const d of devices){
  d.shadow=new T.Mesh(new T.PlaneGeometry(3.2,1.1),new T.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false,toneMapped:false}));
  d.shadow.rotation.x=-Math.PI/2;d.shadow.position.y=-EGG_H/2-.08;scene.add(d.shadow);
}
// ───────────────────────────── particles ─────────────────────────────
const PN=400;
const pGeo=new T.BufferGeometry();
const pPos=new Float32Array(PN*3),pCol=new Float32Array(PN*3),pVel=new Float32Array(PN*3),pLife=new Float32Array(PN),pMax=new Float32Array(PN);
pGeo.setAttribute('position',new T.BufferAttribute(pPos,3));pGeo.setAttribute('color',new T.BufferAttribute(pCol,3));
const points=new T.Points(pGeo,new T.PointsMaterial({size:.13,map:glow,vertexColors:true,transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false}));
points.frustumCulled=false;scene.add(points);
let pCursor=0;
const tmpC=new T.Color();
function emit(pos,count,color,speed=2,life=.9,spread=1){
  for(let n=0;n<count;n++){
    const i=pCursor=(pCursor+1)%PN;
    pPos[i*3]=pos.x+(Math.random()-.5)*.2*spread;pPos[i*3+1]=pos.y+(Math.random()-.5)*.2*spread;pPos[i*3+2]=pos.z;
    const a=Math.random()*Math.PI*2,b=Math.random()*2-1,s=speed*(.35+Math.random()*.65);
    pVel[i*3]=Math.cos(a)*Math.sqrt(1-b*b)*s;pVel[i*3+1]=b*s+speed*.25;pVel[i*3+2]=Math.abs(Math.sin(a))*s*.6;
    tmpC.set(Array.isArray(color)?color[n%color.length]:color);
    pCol[i*3]=tmpC.r;pCol[i*3+1]=tmpC.g;pCol[i*3+2]=tmpC.b;
    pLife[i]=pMax[i]=life*(.6+Math.random()*.6);
  }
}
for(let i=0;i<PN;i++)pPos[i*3+2]=-99;
// ambient motes drifting through the room
const MN=40,mGeo=new T.BufferGeometry(),mPos=new Float32Array(MN*3),mCol=new Float32Array(MN*3);
for(let i=0;i<MN;i++){
  mPos.set([(Math.random()-.5)*12,(Math.random()-.5)*7,-3+Math.random()*4],i*3);
  tmpC.set([0xff8a3d,0x52e6ff,0xff7ad9,0xfff1a8][i%4]);mCol.set([tmpC.r,tmpC.g,tmpC.b],i*3);
}
mGeo.setAttribute('position',new T.BufferAttribute(mPos,3));mGeo.setAttribute('color',new T.BufferAttribute(mCol,3));
const motes=new T.Points(mGeo,new T.PointsMaterial({size:.07,map:glow,vertexColors:true,transparent:true,opacity:.6,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false}));
motes.visible=false;scene.add(motes);
// link beam at the seam
const beam=new T.Sprite(new T.SpriteMaterial({map:glow,color:0xfff4c0,transparent:true,opacity:0,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false}));
beam.position.set(0,.2,.9);beam.scale.set(.8,5,1);scene.add(beam);
const ring=new T.Mesh(new T.TorusGeometry(1,.035,8,64),new T.MeshBasicMaterial({color:0xffe27a,transparent:true,opacity:0,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false}));
ring.position.set(0,.2,.9);scene.add(ring);
let beamPower=0,ringT=1;
const screenPos=d=>new T.Vector3(d.group.position.x,d.group.position.y+.3,.8);
const seamPos=()=>new T.Vector3(0,.25,.9);

// ───────────────────────────── audio: chiptune sequencer + sfx ─────────────────────────────
let audio=null,master=null,musicBus=null,sfxBus=null,noiseBuf=null,muted=false;
const mix={music:.34,sfx:.55};
try{Object.assign(mix,JSON.parse(localStorage.getItem('dragon-link-mix')||'{}'))}catch{}
const music={track:'calm',bpm:112,step:0,next:0,pendingBattle:false,beatFlash:0};
function initAudio(){
  try{
    audio??=new AudioContext();
    if(audio.state==='suspended')audio.resume().catch(()=>{});
    if(master)return;
    master=audio.createGain();master.gain.value=muted?0:.8;master.connect(audio.destination);
    musicBus=audio.createGain();musicBus.gain.value=mix.music;musicBus.connect(master);
    sfxBus=audio.createGain();sfxBus.gain.value=mix.sfx;sfxBus.connect(master);
    noiseBuf=audio.createBuffer(1,audio.sampleRate*.5,audio.sampleRate);
    const ch=noiseBuf.getChannelData(0);for(let i=0;i<ch.length;i++)ch[i]=Math.random()*2-1;
  }catch(e){console.warn(e)}
}
// Game time always runs on performance.now; audio events are converted to the AudioContext clock when scheduled.
const clock=()=>performance.now()/1000;
const at=t=>audio.currentTime+Math.max(0,t-clock());
const audioOK=()=>audio&&audio.state==='running'&&master;
const midi=n=>440*Math.pow(2,(n-69)/12);
function tone(freq,t,dur,type='square',vol=.1,bus=musicBus,slide=0){
  if(!audioOK())return;t=at(t);
  const o=audio.createOscillator(),g=audio.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*slide),t+dur);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+.005);g.gain.exponentialRampToValueAtTime(.0008,t+dur);
  o.connect(g).connect(bus);o.start(t);o.stop(t+dur+.02);
}
function noise(t,dur,vol=.08,hp=6000,bus=musicBus){
  if(!audioOK())return;t=at(t);
  const s=audio.createBufferSource(),f=audio.createBiquadFilter(),g=audio.createGain();
  s.buffer=noiseBuf;f.type='highpass';f.frequency.value=hp;
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.0008,t+dur);
  s.connect(f).connect(g).connect(bus);s.start(t);s.stop(t+dur+.02);
}
const CALM=[[57,60,64,67],[53,57,60,64],[48,52,55,59],[55,59,62,66]]; // Am7 Fmaj7 Cmaj7 G
const FIGHT=[[57,60,64],[57,60,64],[53,57,60],[55,59,62],[57,60,64],[57,60,64],[50,53,57],[52,56,59]];
function playStep(step,t){
  const s=step%16,bar=Math.floor(step/16);
  if(s%4===0)setTimeout(()=>{music.beatFlash=1},Math.max(0,(t-clock())*1000));
  if(music.track==='calm'){
    const ch=CALM[bar%4];
    if(s%2===0){const pat=[0,2,1,3,2,1,3,2];tone(midi(ch[pat[(s/2)%8]]+12),t,.32,'triangle',.07);}
    if(s===0||s===7||s===10)tone(midi(ch[0]-12),t,.35,'square',.05);
    if(s%4===2)noise(t,.04,.025);
    if(s===0&&bar%2===0)tone(midi(ch[3]+24),t,.9,'sine',.03);
  } else {
    const ch=FIGHT[bar%8];
    if(s%4===0)tone(150,t,.16,'sine',.32,musicBus,.25);              // kick
    if(s===4||s===12)noise(t,.14,.13,1600);                          // snare
    if(s%2===1)noise(t,.03,.035,8000);                               // hat
    tone(midi(ch[0]-12+(s%4===2?12:0)),t,.11,'square',.06);           // bass 16ths
    if(s%2===0){const pat=[0,1,2,1,2,0,1,2];tone(midi(ch[pat[(s/2)%8]]+12),t,.09,'square',.035);}
    if(s===0)tone(midi(ch[2]+24),t,.5,'sawtooth',.018);
  }
}
function scheduler(){
  const spb=()=>60/music.bpm/4,now=clock();
  if(music.next<now-.5)music.next=now+.05;
  while(music.next<now+.12){
    if(music.step%16===0&&music.pendingBattle){
      music.pendingBattle=false;music.track='battle';music.bpm=128;
      beginBattle(music.next);
    }
    playStep(music.step,music.next);
    music.next+=spb();music.step++;
  }
}
function sfx(kind){
  const t=clock()+.005;
  switch(kind){
    case 'key':tone(880,t,.05,'square',.06,sfxBus);break;
    case 'ok':tone(660,t,.06,'square',.07,sfxBus);tone(990,t+.06,.08,'square',.07,sfxBus);break;
    case 'back':tone(500,t,.06,'square',.06,sfxBus);tone(330,t+.06,.08,'square',.06,sfxBus);break;
    case 'jump':tone(380,t,.16,'square',.07,sfxBus,2.4);break;
    case 'fire':noise(t,.22,.12,900,sfxBus);tone(220,t,.2,'sawtooth',.05,sfxBus,.5);break;
    case 'hurt':tone(200,t,.3,'sawtooth',.09,sfxBus,.3);break;
    case 'coin':tone(988,t,.07,'square',.06,sfxBus);tone(1319,t+.07,.18,'square',.06,sfxBus);break;
    case 'hit':tone(1046,t,.07,'square',.07,sfxBus);noise(t,.05,.05,4000,sfxBus);break;
    case 'perfect':tone(1318,t,.06,'square',.07,sfxBus);tone(1760,t+.05,.1,'square',.06,sfxBus);break;
    case 'miss':tone(160,t,.12,'square',.05,sfxBus,.6);break;
    case 'duo':[0,4,7,12,16].forEach((n,i)=>tone(midi(69+n),t+i*.035,.35,'square',.06,sfxBus));noise(t,.4,.1,500,sfxBus);break;
    case 'link':[0,7,12].forEach((n,i)=>tone(midi(64+n),t+i*.07,.2,'triangle',.1,sfxBus));break;
    case 'unlink':[12,7,0].forEach((n,i)=>tone(midi(64+n),t+i*.07,.15,'triangle',.08,sfxBus));break;
    case 'hatch':[0,4,7,12,7,12,16,19].forEach((n,i)=>tone(midi(72+n),t+i*.06,.15,'square',.06,sfxBus));break;
    case 'evolve':[0,4,7,11,12,16,19,24].forEach((n,i)=>tone(midi(60+n),t+i*.08,.3,'square',.06,sfxBus));noise(t+.6,.5,.06,300,sfxBus);break;
    case 'win':[0,4,7,12,7,12,16,24].forEach((n,i)=>tone(midi(67+n),t+i*.1,.25,'square',.07,sfxBus));break;
    case 'lose':[7,5,3,0].forEach((n,i)=>tone(midi(57+n),t+i*.18,.3,'triangle',.08,sfxBus));break;
    case 'alert':tone(1200,t,.05,'square',.04,sfxBus);tone(1200,t+.1,.05,'square',.04,sfxBus);break;
  }
}
setInterval(scheduler,25);
function setTrack(name){music.track=name;music.bpm=name==='battle'?128:112}

// ───────────────────────────── save ─────────────────────────────
const SAVE='dragon-link-duo-save-v1';
const KEYS=['hatched','stage','xp','hunger','joy','energy','gems','species'];
try{const s=JSON.parse(localStorage.getItem(SAVE)||'null');if(s&&s[0])KEYS.forEach(k=>{if(k in s[0])ember[k]=s[0][k]})}catch{}
function save(){try{localStorage.setItem(SAVE,JSON.stringify(devices.map(d=>Object.fromEntries(KEYS.map(k=>[k,d[k]])))))}catch{}}
setInterval(save,4000);

// ───────────────────────────── LCD drawing ─────────────────────────────
function poly(p,points,fill){p.fillStyle=fill;p.beginPath();points.forEach(([x,y],i)=>i?p.lineTo(x,y):p.moveTo(x,y));p.closePath();p.fill()}
function path(p,shape,color){p.fillStyle=color;p.fill(new Path2D(shape),'evenodd')}
const SHAPES={
  egg:'M0 48C-58 48-71 0-46-43C-31-77-13-91 0-91C17-91 39-69 52-36C75 17 48 48 0 48Z',
  crack:'M-49-39l24 18 20-14 21 20 26-20 9 10-36 31-20-20-20 12-32-22z',
  Ember:['M-63-31C-85-30-100-49-84-61L-69-68Q-84-91-48-109Q-54-89-42-78L-32-95L-23-77L-6-84L-6-68L11-69L3-54L16-50L5-39Q0-23 14-10Q37-21 58-11Q78 2 68 23Q101 20 107-14Q86-21 98-44Q99-29 111-36Q118-43 119-62Q146-45 132-22Q130-9 119-6Q115 32 80 44L54 47Q47 60 19 54L-50 54Q-69 55-62 40L-51 28Q-63 9-50-12L-47-29Q-58-19-70-26Z M-62-60q10-13 19 0q-10-5-19 0z M-49-15q10 6 21 2l-4 9q-10 0-18-5z M-54 5q11 7 21 5l-1 8q-11 0-21-6z M-54 24q11 5 19 4l-1 8q-10 0-19-5z','M8-19Q20-59 51-48L73-30L52-32L44-15L33-27L22-12Z'],
  Glacier:['M-39-67Q-69-61-70-76L-58-91L-40-95Q-26-118 0-117L-25-96Q-11-110 17-105L-9-89Q10-82 12-64L-4-59L-18-71Q-29-49-14-25Q7 2 37 14Q55-1 73 8Q88 19 83 32Q103 34 111 20Q117 11 126 13Q142 16 138 31Q134 44 120 43Q112 42 110 34Q99 52 65 50L-30 52Q-47 53-40 39L-23 30Q-34 10-43-14Q-56-44-39-67Z M-53-82q7-6 13 0q-8 5-13 0z M120 23q12-4 10 6q-4 8-10 2z','M-30 10L-113-38L-147-64L-134-12L-121-27L-99 3L-81-11L-57 19Z M-37 5L-135-55L-129-27L-120-34L-99-7L-83-20L-55 11Z M-3 2L36-49L115-84L97-45L83-52L62-12L47-22L16 20Z M11 8L41-43L105-74L93-56L79-62L60-24L48-33Z'],
};
const p2d={};for(const k in SHAPES)p2d[k]=[].concat(SHAPES[k]).map(s=>new Path2D(s));
// Baby wings flap: wing path is drawn with a small vertical squash on alternate frames.
// The pet is drawn from the approved concept art (dragon-art.js): one silhouette per species and stage,
// tinted to the LCD ink. The species is the egg the player picked; a hatch or growth spurt flickers
// between the old and the new form, like the real toys did.
const STAGE_WORD=['EGG','BABY','YOUNG','ADULT'];
const SPECIES=['kiln','ryu','fossil','nocturne'];
const SPECIES_INFO={kiln:{jp:'火',name:'FIRE'},ryu:{jp:'水',name:'WATER'},fossil:{jp:'石',name:'STONE'},nocturne:{jp:'夜',name:'NIGHT'}};
// on-screen height of each stage, in the same units the old paths used (× the caller's scale)
const ART_HEIGHT=[143,150,178,209];
const artImages=Object.fromEntries(SPECIES.map(k=>[k,DRAGON_ART[k].map(src=>{const im=new Image();im.src=src;return im})]));
const artTints=new Map();
function tintedArt(im,color){
  const key=im.src.length+':'+im.src.slice(-24)+':'+color;
  let c=artTints.get(key);
  if(!c&&im.complete&&im.naturalWidth){
    c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;
    const g=c.getContext('2d');g.drawImage(im,0,0);g.globalCompositeOperation='source-in';g.fillStyle=color;g.fillRect(0,0,c.width,c.height);
    artTints.set(key,c);
  }
  return c;
}
const itemImages=Object.fromEntries(Object.entries(ITEM_ART).map(([k,src])=>{const im=new Image();im.src=src;return [k,im]}));
/** An item icon from the approved set, centred at (cx, cy), `size` px square, tinted to the LCD ink. */
function drawItem(p,item,cx,cy,size,color){const im=itemImages[item];const c=im&&tintedArt(im,color);if(c)p.drawImage(c,cx-size/2,cy-size/2,size,size)}
/** A price: the number and a small coin, right-aligned at x. */
function priceTag(p,n,x,y,size,color){drawItem(p,'scales',x-size*.45,y-size*.32,size*.85,color);txt(p,String(n),x-size,y,size,color,'right')}
const speciesOf=d=>SPECIES.includes(d.species)?d.species:SPECIES.includes(d.edition)?d.edition:(d.name==='Glacier'?'ryu':'kiln');
function petStage(d){
  let stage=d.hatched?Math.min(3,Math.max(1,d.stage||1)):0;
  const fx=d.evolveFx,now=clock();
  if(fx&&now<fx.until)stage=Math.floor(now*(now>fx.until-.5?2:9))%2?fx.from:fx.to;
  return stage;
}
/** Draw one species/stage silhouette with its feet at (x, bottom), `h` screen pixels tall. Returns its box. */
function drawArt(p,species,stage,x,bottom,h,flip,color,rot=0){
  const im=artImages[species][stage],c=tintedArt(im,color);
  if(!c)return null;
  const w=h*c.width/c.height;
  p.save();p.translate(x,bottom);
  if(rot){p.translate(0,-h/2);p.rotate(rot);p.translate(0,h/2)}
  if(flip)p.scale(-1,1);
  p.drawImage(c,-w/2,-h,w,h);
  p.restore();
  return {x,bottom,w,h,flip};
}
function dragon(p,d,x,y,s,flip,pal,t,wingUp){
  const stage=petStage(d),species=speciesOf(d);
  const bottom=y+54*s,h=ART_HEIGHT[stage]*s;
  // a little life: eggs rock, hatched dragons breathe (a slight squash), wings "flap" on the beat
  const rot=stage===0?(d.mood==='crack'?Math.sin(t*60)*.12:Math.sin(t*3)>.85?Math.sin(t*40)*.06:0):0;
  const breathe=stage>0?1+(wingUp?.025:0):1;
  d._art=drawArt(p,species,stage,x,bottom,h*breathe,flip,pal.ink,rot)||d._art;
  if(stage===0&&d.mood==='crack'&&d._art){       // the shell splits along a zigzag
    const w=d._art.w,yy=bottom-h*.55;
    p.save();p.translate(x,bottom);p.rotate(rot);p.translate(-x,-bottom);
    p.strokeStyle=pal.bg;p.lineWidth=Math.max(4,h*.04);p.lineJoin='round';p.beginPath();
    for(let i=0;i<=8;i++){const xx=x-w*.42+i*w*.84/8,dy=(i%2?-1:1)*h*.05;i?p.lineTo(xx,yy+dy):p.moveTo(xx,yy+dy)}
    p.stroke();p.restore();
  }
}
const nm=d=>d.label||d.name;
function mouthOf(d,x,y,s,flip){
  const a=d._art;if(!a)return [x,y];
  if(speciesOf(d)==='nocturne')return [a.x,a.bottom-a.h*.62];                 // faces you
  return [a.x+(a.flip?1:-1)*a.w*.4,a.bottom-a.h*.74];
}
function txt(p,s,x,y,size,color,align='center'){p.font=`bold ${size}px "DotGothic16","Courier New",monospace`;p.textAlign=align;p.fillStyle=color;p.fillText(s,x,y)}

// Draw LCD segments directly so the OS cannot substitute colorful emoji.
function lcdArrow(p,x,y,direction,color){
  const cell=4;
  p.fillStyle=color;
  for(let column=0;column<4;column++){
    const rows=column*2+1;
    const dx=direction*(6-column*cell);
    p.fillRect(x+dx-cell/2,y-rows*cell/2,cell,rows*cell);
  }
}
function heart(p,x,y,r,c){p.fillStyle=c;p.beginPath();p.moveTo(x,y+r*.9);p.bezierCurveTo(x-r*1.6,y-r*.2,x-r*.6,y-r*1.4,x,y-r*.4);p.bezierCurveTo(x+r*.6,y-r*1.4,x+r*1.6,y-r*.2,x,y+r*.9);p.fill()}
function palette(d){
  if(battle||d.game){
    return d.side===1?{bg:'#ffc78a',bg2:'#ffaf66',mid:'#f08c3e',ink:'#120612',muted:'#9a4e2e',hi:'#fff1d6'}:{bg:'#a6f4ea',bg2:'#7cdcd6',mid:'#4fb6bc',ink:'#050d1c',muted:'#2f6d7a',hi:'#effffb'};
  }
  if(d.mood==='sleep')return {bg:'#7c7e5d',bg2:'#717356',mid:'#686a4e',ink:'#0b0d06',muted:'#4c4e37',hi:'#8d8f6b'};
  return {bg:'#c4c58e',bg2:'#b0b17c',mid:'#999b6c',ink:'#0b0d06',muted:'#6f7249',hi:'#d4d5a2'};
}
function scenery(p,pal,scroll=0,pond=true){
  p.fillStyle=pal.bg;p.fillRect(0,0,W,H);
  p.fillStyle=pal.bg2;p.fillRect(0,73,W,348);
  const a=((scroll*.35)%W+W)%W,b=((scroll)%W+W)%W;
  for(const off of [0,W]){
    poly(p,[[off-a,254],[off-a+113,155],[off-a+174,213],[off-a+289,133],[off-a+444,240],[off-a+553,163],[off-a+720,254],[off-a+720,410],[off-a,410]],pal.mid);
  }
  for(const off of [0,W]){
    poly(p,[[off-b,287],[off-b+100,236],[off-b+182,276],[off-b+273,219],[off-b+402,285],[off-b+540,223],[off-b+720,287],[off-b+720,419],[off-b,419]],pal.bg2);
  }
  if(pond){p.strokeStyle=pal.mid;p.lineWidth=9;for(let i=0;i<5;i++){p.beginPath();p.ellipse(359,365,206-i*24,34-i*3,0,.06,Math.PI*1.94);p.stroke()}}
  else{p.fillStyle=pal.mid;for(let x=-(b%60);x<W;x+=60)p.fillRect(x,395,30,6)}
}
function frame(p,pal){p.fillStyle=pal.ink;p.fillRect(28,78,664,3);p.fillRect(28,420,664,3)}
function pips(p,x,y,n,max,pal,kind){
  for(let i=0;i<max;i++){
    const c=i<n?pal.ink:pal.muted;
    if(kind==='heart')heart(p,x+i*26,y,8,c);
    else{p.fillStyle=c;p.beginPath();p.arc(x+i*26,y+2,8,Math.PI,0);p.fill();p.fillRect(x+i*26-10,y+2,20,3)}
  }
}
// Top bar, kept quiet: the dragon's name on the left, and on the right one big icon only when food or joy runs out.
// Stage, growth, food, joy and the wallet live on the STATUS screen (last menu icon).
function bowl(p,x,y,r,c){p.fillStyle=c;p.beginPath();p.arc(x,y,r,Math.PI,0);p.fill();p.fillRect(x-r*1.2,y,r*2.4,r*.35)}
// A bold "!" that hops and squashes, so a need is impossible to miss. (x, baseline y, height)
function bang(p,x,y,h,c,t){
  const ph=(t*2.2)%1,hop=ph<.5?Math.sin(ph*2*Math.PI)*h*.22:0,sq=ph>=.5&&ph<.62?.82:1;
  p.save();p.translate(x,y);p.scale(2-sq,sq);p.translate(0,-hop);
  const w=h*.26,bar=h*.62;
  p.fillStyle=c;p.beginPath();p.moveTo(-w/2,-h);p.lineTo(w/2,-h);p.lineTo(w*.32,-h+bar);p.lineTo(-w*.32,-h+bar);p.closePath();p.fill();
  p.fillRect(-w*.36,-w*.72,w*.72,w*.72);
  p.restore();
}
function header(p,d,pal,t){
  const ink=pal.ink;
  txt(p,nm(d).toUpperCase(),150,60,34,ink,'left');
  if(!d.hatched){txt(p,docked?'∞ LINK':(d===ember&&!d.species?'CHOOSE':'WARM'),592,58,24,ink,'right');return}
  const need=d.hunger===0?'food':d.joy===0?'joy':null;
  if(!need)return;
  const c=Math.floor(t*3)%2?ink:pal.muted;
  if(need==='food')bowl(p,548,54,18,c);else heart(p,548,48,17,c);
  bang(p,580,64,46,ink,t);
}
// STATUS: one big thing per page, ◀ ▶ to turn the page, ● to close.
const STATUS_PAGES=['DRAGON','FOOD & JOY','WALLET'];
function statusPages(d){return d===ember?3:2}
function drawStatus(p,d,pal,t,now){
  const ink=pal.ink,pg=d.status,st=Math.min(3,d.stage||1);
  p.fillStyle=pal.bg;p.fillRect(0,0,W,H);p.fillStyle=ink;p.fillRect(28,420,664,3);
  if(pg===0){
    const sp=SPECIES_INFO[speciesOf(d)]||SPECIES_INFO.kiln;
    txt(p,nm(d).toUpperCase(),360,118,48,ink);
    txt(p,`${sp.name} · ${STAGE_WORD[st]}`,360,180,30,ink);
    const hasPearl=d===ember&&market.count('pearl')>0;
    const f=st===1?Math.min(1,d.xp/30):st===2?(hasPearl?1:Math.min(.9,(d.xp-30)/80)):1;
    p.fillStyle=pal.muted;p.fillRect(170,236,380,26);p.fillStyle=ink;p.fillRect(170,236,380*Math.max(0,f),26);
    const next=st===1?`→ YOUNG  ${Math.min(30,d.xp)} / 30 XP`:st===2?(hasPearl?'EVOLVE: CARE → EVOLVE':'→ ADULT: FEED A DRAGON PEARL'):'★ FULLY GROWN';
    txt(p,next,360,318,st===2?24:26,st===2&&hasPearl&&Math.floor(t*3)%2?pal.muted:ink);
  } else if(pg===1){
    txt(p,'FOOD',150,138,34,ink,'left');for(let i=0;i<4;i++)bowl(p,330+i*84,124,26,i<d.hunger?ink:pal.muted);
    txt(p,'JOY',150,288,34,ink,'left');for(let i=0;i<3;i++)heart(p,340+i*84,262,26,i<d.joy?ink:pal.muted);
  } else {
    const bag=market.state.bag;
    drawItem(p,'scales',282,124,70,ink);txt(p,String(bag.scales),330,150,64,ink,'left');
    ['grilled','pearl','ore'].forEach((k,i)=>{const x=200+160*i,n=bag[k]||0,c=n?ink:pal.muted;drawItem(p,k,x,262,70,c);txt(p,'x'+n,x,356,30,c)});
  }
  const n=statusPages(d);
  lcdArrow(p,95,482,-1,ink);lcdArrow(p,625,482,1,ink);txt(p,STATUS_PAGES[pg],360,492,30,ink);
  for(let i=0;i<n;i++){p.fillStyle=i===pg?ink:pal.muted;p.fillRect(360-n*14+i*28,512,16,6)}
  toast(p,d,pal,now);
}
function statusHint(d){
  updateHint(['Who your dragon is, its stage, and what it needs to grow next.','How full and how happy your dragon is. Feed it in CARE, play with it in PLAY.','Your coins and what is in your bag.'][d.status]+' ◀ ▶ turn the page, ● close.');
}
// First screen of a new game: pick the egg — it decides which dragon hatches.
function eggHint(d){
  const k=SPECIES[d.pick||0],info=SPECIES_INFO[k];
  updateHint(`Choose your egg: ◀ ▶ to look, ● to take it. This is the ${info.name.toLowerCase()} egg — a ${editionNames[k]} dragon hatches from it.`);
}
function drawEggPick(p,d,pal,t,now){
  scenery(p,pal,0,true);frame(p,pal);header(p,d,pal,t);
  const sel=d.pick||0;
  SPECIES.forEach((k,i)=>{
    const x=132+152*i,on=i===sel,bob=on?Math.abs(Math.sin(t*4))*10:0;
    drawArt(p,k,0,x,330-bob,on?150:112,false,on?pal.ink:pal.muted);
    txt(p,SPECIES_INFO[k].name,x,372,on?26:20,on?pal.ink:pal.muted);
    if(on){const b=Math.floor(t*4)%2*4;poly(p,[[x-12,150+b],[x+12,150+b],[x,166+b]],pal.ink)}
  });
  const k=SPECIES[sel];
  lcdArrow(p,95,482,-1,pal.ink);lcdArrow(p,625,482,1,pal.ink);
  txt(p,`${SPECIES_INFO[k].name} EGG`,360,480,26,pal.ink);
  txt(p,'● CHOOSE',360,516,20,pal.ink);
  toast(p,d,pal,now);
}
function bottomMenu(p,d,pal,t){
  if(!d.hatched){
    txt(p,d.mood==='crack'?'CRACK…':(Math.floor(t*2)%2?'● HATCH':'  HATCH'),360,492,30,pal.ink);
    return;
  }
  if(d.page!==null){
    const opts=submenuOf(d);
    txt(p,opts[d.sub],360,492,30,pal.ink);
    lcdArrow(p,95,482,-1,pal.ink);lcdArrow(p,625,482,1,pal.ink);
    for(let i=0;i<opts.length;i++){p.fillStyle=i===d.sub?pal.ink:pal.muted;p.fillRect(360-opts.length*14+i*28,512,16,6)}
    return;
  }
  if(docked){
    const li=['M-20-6q0-20 20-20t20 20v10l-6 4v8h-28v-8l-6-4z M-10-4a5 5 0 1 0 .1 0z M10-4a5 5 0 1 0 .1 0z M-26-22l8 8-4 4z M26-22l-8 8 4 4z',
      'M-24-8h30v-8l16 13-16 13v-8h-30z M24 10h-30v-8l-16 13 16 13v-8h30z',
      'M-22-6h44v10h-44z M-19 4h38v20h-38z M-3-6h6v30h-6z M0-6q-14-18-18-6t18 6z M0-6q14-18 18-6t-18 6z',
      'M-28 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0z M-23 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0z M8 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0z M13 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0z M-3-12l6 0-2 8h-2z M-3 12l6 0-2-8h-2z'];
    const sel=Math.min(d.selection,LINK_MENU.length-1),lx=i=>135+150*i;
    li.forEach((shape,i)=>{p.save();p.translate(lx(i),458);path(p,shape,i===sel?pal.ink:pal.muted);p.restore()});
    const x=lx(sel),bob=Math.floor(t*4)%2*3;
    poly(p,[[x,482+bob],[x-8,495+bob],[x+8,495+bob]],pal.ink);
    txt(p,LINK_MENU[sel],360,530,26,pal.ink);
    return;
  }
  const icons=['M-22-10h44q-3 20-22 20t-22-20z','M0-24l7 15 17 3-12 12 3 17-15-8-15 8 3-17-12-12 17-3z','M-27 13l18-25 10 12 10-20 17 33z','M-26-6l6-16h40l6 16z M-22-3h44v25h-10v-15h-24v15h-10z','M-26 0a15 15 0 1 0 30 0a15 15 0 1 0-30 0z M-4 0a15 15 0 1 0 30 0a15 15 0 1 0-30 0z','M-24 18h12v-14h-12z M-6 18h12v-26h-12z M12 18h12v-40h-12z'];
  const ix=i=>80+112*i;
  icons.forEach((shape,i)=>{p.save();p.translate(ix(i),458);path(p,shape,i===d.selection?pal.ink:pal.muted);p.restore()});
  // when the dragon needs something, the icon to press blinks in a frame: CARE when hungry, PLAY when lonely
  if(d.attention&&d.hatched){
    const need=d.hunger===0?0:1,nx=ix(need);
    if(Math.floor(t*3)%2===0){p.strokeStyle=pal.ink;p.lineWidth=5;p.strokeRect(nx-34,432,68,52)}
    txt(p,'PRESS',nx,410,18,pal.ink);
  }
  const x=ix(d.selection),bob=Math.floor(t*4)%2*3;
  poly(p,[[x,482+bob],[x-8,495+bob],[x+8,495+bob]],pal.ink);
  txt(p,menu[d.selection],360,530,26,pal.ink);
}
function toast(p,d,pal,now){
  if(!d.toast||now>d.toast.until)return;
  const life=d.toast.until-now,pop=Math.min(1,(1.6-life)*8);
  p.save();p.translate(360,140);p.scale(pop,pop);
  p.font='bold 40px "DotGothic16",monospace';const w=p.measureText(d.toast.text).width+40;
  p.fillStyle=pal.ink;p.fillRect(-w/2,-34,w,52);p.fillStyle=pal.bg;p.fillRect(-w/2+4,-30,w-8,44);
  txt(p,d.toast.text,0,4,40,pal.ink);
  p.restore();
}
function say(d,text,ms=1600){d.toast={text,until:clock()+ms/1000}}
let lcdOverlay=null;
function lcdGrid(p){
  if(!lcdOverlay){
    lcdOverlay=document.createElement('canvas');lcdOverlay.width=W;lcdOverlay.height=H;
    const g=lcdOverlay.getContext('2d');g.fillStyle='rgba(0,0,0,.075)';
    for(let x=5;x<W;x+=6)g.fillRect(x,0,1,H);for(let y=5;y<H;y+=6)g.fillRect(0,y,W,1);
    const v=g.createRadialGradient(360,272,200,360,272,470);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,.18)');g.fillStyle=v;g.fillRect(0,0,W,H);
  }
  p.drawImage(lcdOverlay,0,0);
}

// virtual 1440-wide canvas spanning both docked screens: Ember (left) = 0..720, Glacier = 720..1440
const vx=d=>d.side===1?0:W;

function drawPet(p,d,pal,t,now){
  const walking=d.mood==='walk';
  scenery(p,pal,walking?(now-d.moodStart)*260:0,!walking);
  frame(p,pal);header(p,d,pal,t);
  const bob=Math.floor(t*(walking?8:2.5))%2*6;
  const wing=Math.floor(t*(walking?8:3))%2===0;
  if(docked){
    // each dragon faces the seam; hearts / sparks travel across the gap between the two LCDs
    p.save();p.translate(-vx(d),0);
    for(const o of devices){
      const x=o.side===1?400:1040, s=o.hatched?(o.stage>=2?1.15:.9):.95;
      dragon(p,o,x,300-bob,s,o.side===1,pal,t,wing);
    }
    for(let i=0;i<4;i++){
      const k=((t*.35+i/4)%1),x=520+k*400,y=200-Math.sin(k*Math.PI)*90;
      heart(p,x,y,10+Math.sin(t*6+i)*2,pal.ink);
    }
    p.restore();
  } else {
    const s=!d.hatched?1.05:d.stage>=2?1.22:.95;
    const x=walking?300:355+(d.mood==='play'?Math.sin(t*6)*60:0);
    const y=(d.mood==='play'?292-Math.abs(Math.sin(t*6))*44:304)-bob;
    dragon(p,d,x,y,s,walking,pal,t,wing);
    if(d.hatched)moodFx(p,d,pal,t,now,x,y,s,walking);
  }
  if(d.found&&now<d.found.until){
    const k=1-(d.found.until-now)/1.8;
    drawItem(p,d.found.item,560,220-k*40,80,pal.ink);txt(p,d.found.label,560,300-k*40,22,pal.ink);
  }
  bottomMenu(p,d,pal,t);toast(p,d,pal,now);
}
function moodFx(p,d,pal,t,now,x,y,s,flip){
  const m=d.mood,ink=pal.ink;
  if(m==='eat'){
    const left=Math.max(0,1-(now-d.moodStart)/1.6);
    path(p,'M140 380h90q-6 36-45 36t-45-36z',ink);
    if(left>0){p.fillStyle=ink;p.beginPath();p.arc(185,368,26*left+4,Math.PI,0);p.fill()}
    if(d.ate)drawItem(p,d.ate,185,318,56,ink);
    for(let i=0;i<3;i++)if(Math.floor(t*8+i)%3===0)p.fillRect(150+i*24,330-i*10,8,8);
  }
  if(m==='sleep')for(let i=0;i<3;i++){const k=(t*.5+i/3)%1;txt(p,'Z',x+80+k*60,y-90-k*90,24+i*8,ink)}
  if(m==='happy'||m==='play')for(let i=0;i<4;i++){const k=(t*.8+i/4)%1;heart(p,x-120+i*80,y-60-k*120,9,ink)}
  // a need: a big blinking "!" beside the dragon (the menu shows what to press)
  if(m==='sad'||(m==='idle'&&d.attention)){
    {const side=flip?-1:1;bang(p,x+side*150,y-30,96,ink,t)}
  }
  // idle breath: a puff of fire / frost every few seconds
  if(m==='idle'&&!d.attention&&(t%4.5)<.8){
    const [mx,my]=mouthOf(d,x,y,s,flip),k=(t%4.5)/.8,dir=flip?1:-1;
    for(let i=0;i<6;i++){
      const px=mx+dir*(20+i*18*k*2),py=my+Math.sin(i*2+t*20)*8;
      if(d.name==='Ember')poly(p,[[px,py-12+i],[px+dir*14,py],[px,py+12-i],[px-dir*6,py]],ink);
      else txt(p,'✻',px,py+8,22-i*2,ink);
    }
  }
}

// ── single-device minigame: Flame Hop / Frost Hop ──
function startGame(d){
  if(d.energy<=0){say(d,'TIRED…');sfx('back');return}
  d.energy--;
  d.game={t0:clock(),last:clock(),score:0,lives:3,y:0,vy:0,obs:[],shots:[],next:1.2,cool:0,over:0,inv:0};
  say(d,'START!',900);sfx('ok');
  updateHint(`${nm(d)}: ● Jump over rocks. ▶ Use ${d.name==='Ember'?'fire':'ice'} breath on bats. ◀ Exit.`);
}
function tickGame(d,now,dt){
  const g=d.game;if(g.over){if(now>g.over)endGame(d);return}
  const el=now-g.t0,speed=330+el*14;
  g.vy+=2600*dt;g.y=Math.min(0,g.y+g.vy*dt);if(g.y===0)g.vy=0;
  g.cool-=dt;g.inv-=dt;
  g.next-=dt;
  if(g.next<=0){g.obs.push({x:760,type:Math.random()<.42&&el>3?'bat':'rock',ph:Math.random()*6});g.next=.75+Math.random()*.9-Math.min(.3,el*.01)}
  for(const o of g.obs)o.x-=speed*dt;
  for(const s of g.shots)s.x+=950*dt;
  for(const s of g.shots)for(const o of g.obs)if(o.type==='bat'&&!o.dead&&Math.abs(o.x-s.x)<40){o.dead=true;s.dead=true;g.score+=2;sfx('coin');emit(screenPos(d),10,d.side===1?[0xffb347,0xff5a1f]:[0x9ff6ff,0x3ad0ff],1.6,.6)}
  const dy=390+g.y;
  for(const o of g.obs){
    if(o.dead||o.passed)continue;
    const hitX=Math.abs(o.x-150)<46;
    const hitY=o.type==='rock'?dy>352:dy-80<340&&dy>300;
    if(hitX&&hitY&&g.inv<=0){g.lives--;g.inv=1;o.dead=true;sfx('hurt');shake=.12;d.kick=1;
      if(g.lives<=0){g.over=now+1.4;say(d,'OUCH!',1300)}}
    if(o.x<100&&!o.dead){o.passed=true;if(o.type==='rock'){g.score++;}}
  }
  g.obs=g.obs.filter(o=>o.x>-60&&!(o.dead&&o.type==='rock'));g.shots=g.shots.filter(s=>!s.dead&&s.x<760);
  if(el>30&&!g.over){g.over=now+1.4;say(d,'TIME UP!',1300)}
}
function gameKey(d,i){
  const g=d.game;if(g.over)return;
  if(i===1&&g.y===0){g.vy=-980;sfx('jump')}
  if(i===2&&g.cool<=0){g.shots.push({x:215});g.cool=.32;sfx('fire')}
  if(i===0){g.over=clock()+.2}
}
function endGame(d){
  const g=d.game;d.game=null;
  addXP(d,g.score);d.joy=Math.min(3,d.joy+(g.score>=8?2:1));
  if(d===ember&&g.score>0)market.reward('game','scales',g.score);
  say(d,`+${g.score} COINS`,1800);sfx('coin');setMood(d,'happy',1.8);
  updateHint(`${nm(d)} scored ${g.score} points and earned ${g.score} coins. Energy: ${d.energy}/4.`);
}
function drawGame(p,d,pal,t,now){
  const g=d.game;
  scenery(p,pal,(now-g.t0)*(330+(now-g.t0)*7),false);frame(p,pal);
  txt(p,'SCORE '+String(g.score).padStart(3,'0'),150,60,26,pal.ink,'left');
  pips(p,530,52,g.lives,3,pal,'heart');
  p.fillStyle=pal.ink;p.fillRect(150,68,440*Math.max(0,1-(now-g.t0)/30),5);
  const blink=g.inv>0&&Math.floor(t*16)%2;
  if(!blink)dragon(p,d,150,390+g.y-6,.62,true,pal,t,Math.floor(t*10)%2);
  for(const o of g.obs){
    if(o.type==='rock')poly(p,[[o.x-26,398],[o.x-14,360],[o.x+6,352],[o.x+24,372],[o.x+26,398]],pal.ink);
    else if(!o.dead){const up=Math.floor(t*10+o.ph)%2;p.fillStyle=pal.ink;
      poly(p,[[o.x-34,312-(up?16:0)],[o.x-8,322],[o.x,312],[o.x+8,322],[o.x+34,312-(up?16:0)],[o.x+14,336],[o.x-14,336]],pal.ink);
      p.fillStyle=pal.bg;p.fillRect(o.x-6,322,4,4);p.fillRect(o.x+3,322,4,4);}
  }
  for(const s of g.shots){
    if(d.name==='Ember')poly(p,[[s.x-30,330],[s.x+10,318],[s.x+26,330],[s.x+10,342]],pal.ink);
    else txt(p,'✻',s.x,342,38,pal.ink);
  }
  lcdArrow(p,82,482,-1,pal.muted);txt(p,'EXIT',129,492,24,pal.muted);txt(p,'● JUMP',360,492,26,pal.ink);lcdArrow(p,541,482,1,pal.ink);txt(p,'BREATH',605,492,24,pal.ink);
  toast(p,d,pal,now);
}

// ── co-op LINK battle: rhythm duel against a shadow wyrm that spans both screens ──
function requestBattle(){
  if(!devices.every(d=>d.hatched)){devices.forEach(d=>say(d,'HATCH BOTH!'));sfx('back');return}
  if(!audio){initAudio()}
  battle={state:'wait',notes:[],start:Infinity};
  for(const d of devices){d.page=null;d.game=null;d.mood='idle';say(d,'SHADOW INCOMING',1800)}
  music.pendingBattle=true;
  updateHint(`LINK BATTLE! Play ${nm(ember)} with A S D. A friend can play ${nm(glacier)} with J K L, or you can control both. Hit notes in the ring. Hit ★ together for a DUO breath attack.`);
}
function beginBattle(t0){
  const beat=60/128;let seed=1337;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const notes=[];
  for(let bar=1;bar<=8;bar++)for(let e=0;e<8;e++){
    const t=t0+(bar*8+e)*beat/2;
    if((e===0&&bar%2===0)||(bar===8&&e===4)){for(const dev of [0,1])notes.push({t,dev,key:1,duo:true});continue}
    for(const dev of [0,1]){
      const dens=.18+bar*.06;
      if(e%2===0?rnd()<dens+.25:rnd()<dens*.45)notes.push({t,dev,key:Math.floor(rnd()*3),duo:false});
    }
  }
  const potential=notes.filter(n=>!n.duo).length*2+notes.filter(n=>n.duo).length/2*10;
  battle={state:'fight',start:t0,notes,end:t0+9*8*beat/2+.4,maxHP:Math.round(potential*.6),hp:0,team:6,combo:[0,0],best:0,judge:[null,null],bolt:[0,0],duoFlash:0,hurt:0};
  battle.hp=battle.maxHP;
}
function battleKey(d,i){
  const b=battle,now=clock(),dev=devices.indexOf(d);
  if(b.state==='win'||b.state==='lose'){if(now>b.doneAt+1)endBattle();return}
  if(b.state!=='fight')return;
  let best=null;
  for(const n of b.notes)if(n.dev===dev&&!n.judged&&Math.abs(n.t-now)<.17&&(!best||Math.abs(n.t-now)<Math.abs(best.t-now)))best=n;
  if(!best)return;
  if(best.key!==i){best.judged='miss';miss(dev);return}
  const perfect=Math.abs(best.t-now)<.07;
  best.judged=perfect?'perfect':'good';
  b.combo[dev]++;b.best=Math.max(b.best,b.combo[dev]);
  b.judge[dev]={text:perfect?'PERFECT':'GOOD',until:now+.45};
  b.bolt[dev]=now+.14;
  sfx(perfect?'perfect':'hit');
  emit(screenPos(d),perfect?8:4,d.side===1?[0xffd27a,0xff6a1f]:[0xbaf7ff,0x34c8ff],1.4,.5);
  if(best.duo){
    const mate=b.notes.find(n=>n.duo&&n.t===best.t&&n.dev!==dev);
    if(mate&&mate.judged&&mate.judged!=='miss'){
      b.hp-=10;b.duoFlash=now+.5;b.hurt=now+.35;beamPower=1;ringT=0;shake=.25;sfx('duo');
      emit(seamPos(),60,[0xff7a2a,0x2ad8ff,0xfff1a8,0xff7ad9],3.4,1.2,2);
      for(const o of devices){b.judge[devices.indexOf(o)]={text:'DUO!!',until:now+.7};o.kick=1}
    }
  } else {b.hp-=perfect?3:2;b.hurt=now+.12}
  if(b.hp<=0)finishBattle(true);
}
function miss(dev){
  const b=battle;b.combo[dev]=0;b.team--;b.judge[dev]={text:'MISS',until:clock()+.45};sfx('miss');shake=.08;devices[dev].kick=.6;
  if(b.team<=0)finishBattle(false);
}
function tickBattle(now){
  const b=battle;
  if(b.state==='win'||b.state==='lose'){if(now>b.doneAt+5)endBattle();return}
  if(b.state!=='fight')return;
  if(!glacier.human)for(const n of b.notes)if(n.dev===1&&!n.judged){
    if(n.botT===undefined){n.botT=n.t+(Math.random()-.5)*.09;n.botMiss=Math.random()<.07}
    if(!n.botMiss&&now>=n.botT){glacier.keys[n.key].userData.pressedUntil=performance.now()+120;battleKey(glacier,n.key);if(b.state!=='fight')return}
  }
  for(const n of b.notes)if(!n.judged&&now>n.t+.17){n.judged='miss';miss(n.dev);if(b.state!=='fight')return}
  if(now>b.end)finishBattle(b.hp<=0);
}
function finishBattle(won){
  const b=battle;if(b.state!=='fight')return;
  b.state=won?'win':'lose';b.doneAt=clock();
  if(won){
    sfx('win');for(const d of devices){addXP(d,15);d.joy=3;say(d,'VICTORY!',2600)}
    for(let i=0;i<4;i++)setTimeout(()=>emit(seamPos(),70,[0xff7a2a,0x2ad8ff,0xfff1a8,0xff7ad9,0xb7ff3a],3.8,1.4,3),i*280);
    beamPower=1;ringT=0;
    const {pearl}=market.reward('battle');
    updateHint(`The Shadow Wyrm is gone! +30 coins${pearl?' and a Pearl':''}. Best combo: ${b.best}. Press any button to continue.`);
  } else {
    sfx('lose');for(const d of devices)say(d,'SHADOW ESCAPED…',2600);
    updateHint('The Shadow Wyrm escaped. Try again via LINK → BATTLE.');
  }
}
function endBattle(){battle=null;setTrack('calm');for(const d of devices){d.page=null;d.selection=0;setMood(d,'happy',1.5)}}
function wyrm(p,cx,cy,t,pal,hurt,dying){
  p.save();
  const jx=hurt?Math.sin(t*90)*10:0;p.translate(cx+jx,cy+Math.sin(t*2.2)*7);
  if(dying)p.globalAlpha=Math.max(0,1-dying);
  p.fillStyle=pal.ink;p.beginPath();p.moveTo(-300,170);
  for(let i=0;i<=48;i++){
    const a=Math.PI+i/48*Math.PI,spike=i%6===3?1.22:1,r=(150+Math.sin(t*4+i*.7)*5)*spike;
    p.lineTo(Math.cos(a)*r*1.55,Math.sin(a)*r*.95+70);
  }
  p.lineTo(300,170);p.closePath();p.fill();
  poly(p,[[-120,-40],[-250,-190],[-80,-80]],pal.ink);poly(p,[[120,-40],[250,-190],[80,-80]],pal.ink);
  const open=.5+.5*Math.sin(t*5);
  p.fillStyle=pal.bg;
  for(const s of [-1,1]){p.save();p.translate(s*92,8);p.rotate(s*.25);p.beginPath();p.ellipse(0,0,38,hurt?6:15,0,0,7);p.fill();p.restore()}
  p.fillStyle=pal.ink;for(const s of [-1,1]){p.fillRect(s*92-5+Math.sin(t*3)*12,2,10,12)}
  p.fillStyle=pal.bg;p.beginPath();p.moveTo(-110,70);
  for(let i=0;i<=10;i++)p.lineTo(-110+i*22,70+(i%2?22:0)+open*10);
  for(let i=10;i>=0;i--)p.lineTo(-110+i*22,104+open*24-(i%2?20:0));
  p.closePath();p.fill();
  p.restore();
}
function drawBattle(p,d,pal,t,now){
  const b=battle,dev=devices.indexOf(d),ox=vx(d);
  const flash=b.duoFlash>now&&Math.floor(t*20)%2;
  const P=flash?{...pal,bg:pal.ink,bg2:pal.ink,mid:pal.muted,ink:pal.bg}:pal;
  p.fillStyle=P.bg;p.fillRect(0,0,W,H);
  // speed lines toward the seam
  p.fillStyle=P.bg2;for(let i=0;i<14;i++){const y=90+i*24,k=((t*1.4+i*.37)%1);const x=d.side===1?k*W:W-k*W;p.fillRect(x-60,y,120,6)}
  frame(p,P);
  p.save();p.translate(-ox,0);
  const dying=b.state==='win'?Math.min(1,(now-b.doneAt)/1.4):0;
  wyrm(p,720,215,t,P,b.hurt>now,dying);
  // boss HP bar across both screens
  p.fillStyle=P.ink;p.fillRect(110,30,1220,26);p.fillStyle=P.bg;p.fillRect(114,34,1212,18);
  p.fillStyle=P.ink;p.fillRect(116,36,1208*Math.max(0,b.hp/b.maxHP||0),14);
  txt(p,'SHADOW WYRM',720,68,26,P.ink);
  // bolts from each dragon to the wyrm
  devices.forEach((o,i)=>{if(b.bolt[i]>now||b.duoFlash>now){
    const sx=o.side===1?230:1210;p.strokeStyle=P.ink;p.lineWidth=b.duoFlash>now?16:7;p.beginPath();p.moveTo(sx,250);
    for(let k=1;k<=6;k++)p.lineTo(sx+(720-sx)*k/6,250+(k<6?(Math.random()-.5)*50:-20));p.stroke();
  }});
  p.restore();
  // own dragon, facing the wyrm
  dragon(p,d,d.side===1?120:600,330,.72,d.side===1,P,t,Math.floor(t*6)%2);
  // team hearts and combo
  pips(p,d.side===1?50:500,100,Math.ceil(b.team/2),3,P,'heart');
  if(b.combo[dev]>2)txt(p,b.combo[dev]+' COMBO',d.side===1?120:600,212,24,P.ink);
  // note lane
  const hitX=d.side===1?610:110,dir=d.side===1?1:-1,speed=430;
  p.fillStyle=P.ink;p.fillRect(30,448,660,4);p.fillRect(30,512,660,4);
  const pulse=1+music.beatFlash*.15;
  p.strokeStyle=P.ink;p.lineWidth=5;p.beginPath();p.arc(hitX,482,34*pulse,0,7);p.stroke();
  for(const n of b.notes){
    if(n.dev!==dev||(n.judged&&n.judged!=='miss'))continue;
    const dt=n.t-now;if(dt>1.7||dt<-.3)continue;
    const x=hitX-dir*dt*speed;if(n.judged==='miss'&&dt<-.05)continue;
    p.fillStyle=P.ink;p.beginPath();p.arc(x,482,26,0,7);p.fill();
    if(n.duo){p.strokeStyle=P.ink;p.lineWidth=4;p.beginPath();p.arc(x,482,36+Math.sin(t*20)*3,0,7);p.stroke();txt(p,'★',x,494,32,P.bg)}
    else if(n.key===1)txt(p,keyLabels[1],x,494,30,P.bg);
    else lcdArrow(p,x,484,n.key===0?-1:1,P.bg);
  }
  const j=b.judge[dev];
  if(j&&now<j.until){const k=(j.until-now);txt(p,j.text,hitX+(d.side===1?-170:170),420-k*30,j.text==='DUO!!'?54:34,P.ink)}
  if(now<b.start)txt(p,'READY…',360,300,60,P.ink);
  else if(now<b.start+60/128*4&&b.state==='fight'){const n=4-Math.floor((now-b.start)/(60/128));txt(p,n>1?String(n-1):'GO!',360,300,80,P.ink)}
  toast(p,d,pal,now);
}
function drawWait(p,d,pal,t,now){
  p.fillStyle=pal.bg;p.fillRect(0,0,W,H);frame(p,pal);
  p.save();p.translate(-vx(d),0);
  p.globalAlpha=.25+.25*Math.sin(t*8);wyrm(p,720,215,t,pal,false,0);p.globalAlpha=1;p.restore();
  txt(p,'!! WARNING !!',360,140,48,pal.ink);txt(p,'READY…',360,490,34,pal.ink);
  dragon(p,d,d.side===1?120:600,330,.72,d.side===1,pal,t,Math.floor(t*6)%2);
}
function drawLCD(d,t,now){
  if(d.attention&&d.hunger>0&&d.joy>0)d.attention=false;   // the need was met: stop asking
  const p=d.ctx,pal=palette(d);
  if(battle&&docked){if(battle.state==='wait')drawWait(p,d,pal,t,now);else drawBattle(p,d,pal,t,now)}
  else if(d.game)drawGame(p,d,pal,t,now);
  else if(d===ember&&!d.hatched&&!d.species)drawEggPick(p,d,pal,t,now);
  else if(d.shop)drawShop(p,d,pal,t,now);
  else if(d.bag)drawBag(p,d,pal,t,now);
  else if(d.status!=null)drawStatus(p,d,pal,t,now);
  else drawPet(p,d,pal,t,now);
  lcdGrid(p);
  d.texture.needsUpdate=true;
}

// ───────────────────────────── 商店街 market street ─────────────────────────────
function openShop(d){
  d.shop={view:'street',stall:0,row:0};sfx('ok');
  updateHint('Market street. ◀ ▶ choose a stall, ● to go in. Prices change every market hour.');
}
function shopRows(d){
  const m=market.state.merchants[STALLS[d.shop.stall]];
  return [...m.sells.map(item=>({act:'buy',item})),...m.buys.map(item=>({act:'sell',item})),{act:'back'}];
}
function shopHint(d){
  const sh=d.shop;
  if(sh.view==='street'){
    if(sh.stall===STALLS.length)return updateHint('Leave the market street.');
    const id=STALLS[sh.stall],m=market.state.merchants[id];
    return updateHint(market.quote(id,m.sells[0]).why);
  }
  const r=shopRows(d)[sh.row];
  if(r.act!=='back')updateHint(market.quote(STALLS[sh.stall],r.item).why);
}
function shopKey(d,i){
  const sh=d.shop;
  if(sh.view==='street'){
    if(i!==1){sh.stall=(sh.stall+(i===0?-1:1)+STALLS.length+1)%(STALLS.length+1);sfx('key');shopHint(d);return}
    if(sh.stall===STALLS.length){d.shop=null;sfx('back');return}
    const m=market.state.merchants[STALLS[sh.stall]];
    if(!m.open){say(d,'CLOSED');sfx('back');shopHint(d);return}
    sh.view='stall';sh.row=0;sfx('ok');shopHint(d);return;
  }
  const rows=shopRows(d);
  if(i!==1){sh.row=(sh.row+(i===0?-1:1)+rows.length)%rows.length;sfx('key');shopHint(d);return}
  const r=rows[sh.row],id=STALLS[sh.stall];
  if(r.act==='back'){sh.view='street';sfx('back');shopHint(d);return}
  const res=r.act==='buy'?market.buy(id,r.item):market.sell(id,r.item);
  if(res.ok){sfx('coin');say(d,(r.act==='buy'?'−':'+')+res.price,900);shopHint(d)}
  else{sfx('back');say(d,res.reason,1100)}
}
function drawStall(p,m,x,sel,pal,t){
  const y0=136,ink=sel?pal.ink:pal.muted;
  poly(p,[[x-90,y0],[x+90,y0],[x+78,y0-18],[x-78,y0-18]],ink);
  for(let k=0;k<5;k++){p.fillStyle=k%2?pal.bg2:ink;p.fillRect(x-80+k*32,y0,32,30)}
  p.fillStyle=ink;p.fillRect(x-78,y0+30,8,160);p.fillRect(x+70,y0+30,8,160);
  p.fillRect(x-86,y0+140,172,12);p.fillRect(x-78,y0+152,156,40);
  txt(p,m.name.toUpperCase(),x,y0+70,28,ink);
  if(!m.open){for(let yy=y0+36;yy<y0+140;yy+=14)p.fillRect(x-66,yy,132,8);txt(p,'CLOSED',x,y0+180,24,pal.bg);}
  else{
    const item=m.sells[0];
    drawItem(p,item,x,y0+108,58,ink);
    priceTag(p,sellPrice(m,item),x+28,y0+182,26,pal.bg);
  }
  if(sel){const b=Math.floor(t*4)%2*4;poly(p,[[x-12,y0-46+b],[x+12,y0-46+b],[x,y0-30+b]],pal.ink)}
}
function drawShop(p,d,pal,t,now){
  const sh=d.shop,ms=market.state.merchants,bag=market.state.bag;
  p.fillStyle=pal.bg;p.fillRect(0,0,W,H);p.fillStyle=pal.bg2;p.fillRect(0,330,W,90);
  frame(p,pal);
  priceTag(p,bag.scales,592,60,26,pal.ink);
  if(sh.view==='street'){
    txt(p,'SHOP',150,60,26,pal.ink,'left');
    STALLS.forEach((id,i)=>drawStall(p,ms[id],220+280*i,sh.stall===i,pal,t));
    const m=ms[STALLS[sh.stall]];
    const label=sh.stall===STALLS.length?'EXIT':(m.name.toUpperCase()+(m.open?'':' · CLOSED'));
    lcdArrow(p,95,482,-1,pal.ink);lcdArrow(p,625,482,1,pal.ink);txt(p,label,360,492,30,pal.ink);
    for(let i=0;i<=STALLS.length;i++){p.fillStyle=i===sh.stall?pal.ink:pal.muted;p.fillRect(318+i*28,512,16,6)}
  } else {
    const m=ms[STALLS[sh.stall]],rows=shopRows(d);
    txt(p,m.name.toUpperCase(),150,60,26,pal.ink,'left');
    rows.forEach((r,i)=>{
      const y=128+i*64,sel=i===sh.row;
      if(sel){p.fillStyle=pal.ink;p.fillRect(56,y-38,608,54)}
      const c=sel?pal.bg:pal.ink;
      if(r.act==='back'){txt(p,'BACK',360,y,30,c);return}
      const it=ITEMS[r.item];
      drawItem(p,r.item,104,y-10,42,c);
      if(r.act==='buy'){txt(p,'BUY',140,y,30,c,'left');txt(p,'x'+m.stock[r.item],470,y,24,c,'right');priceTag(p,sellPrice(m,r.item),650,y,30,c)}
      else{const pr=buyPrice(m,r.item);txt(p,'SELL',140,y,30,c,'left');txt(p,'you '+(bag[r.item]||0),470,y,24,c,'right');if(pr)priceTag(p,pr,650,y,30,c);else txt(p,'--',644,y,30,c,'right')}
    });
    const r=rows[sh.row];
    lcdArrow(p,95,482,-1,pal.ink);lcdArrow(p,625,482,1,pal.ink);
    txt(p,r.act==='back'?'● BACK':r.act==='buy'?'● BUY':'● SELL',360,492,30,pal.ink);
  }
  toast(p,d,pal,now);
}

function drawBag(p,d,pal,t,now){
  const bag=market.state.bag;
  p.fillStyle=pal.bg;p.fillRect(0,0,W,H);frame(p,pal);
  txt(p,'BAG',150,60,26,pal.ink,'left');
  priceTag(p,bag.scales,592,60,26,pal.ink);
  ['grilled','pearl','ore'].forEach((k,i)=>{
    const x=200+160*i,n=bag[k]||0,c=n?pal.ink:pal.muted;
    drawItem(p,k,x,240,96,c);
    txt(p,'x'+n,x,340,30,c);
  });
  txt(p,'● CLOSE',360,492,30,pal.ink);
  toast(p,d,pal,now);
}

// ───────────────────────────── pet logic ─────────────────────────────
function updateHint(message){hint.textContent=message}
function setMood(d,m,secs){d.mood=m;d.moodStart=clock();d.moodUntil=secs?clock()+secs:0}
function addXP(d,n){
  d.xp+=n;
  if(d.stage===1&&d.xp>=30){
    d.stage=2;d.evolveFx={from:1,to:2,until:clock()+3.2};setTimeout(()=>{say(d,'EVOLUTION!',2400);sfx('evolve');shake=.2;d.kick=1;
      for(let i=0;i<3;i++)setTimeout(()=>emit(screenPos(d),50,d.side===1?[0xffd27a,0xff6a1f,0xfff1a8]:[0xbaf7ff,0x34c8ff,0xfff1a8],3,1.2,2),i*250);
      updateHint(`${nm(d)} grew into a young dragon! Find a Pearl to grow it up all the way.`)},900);
  }
}
function submenuOf(d){
  switch(d.page){
    case 0:return [...(d===ember&&d.stage===2&&market.count('pearl')?['EVOLVE']:[]),'FEED',...(d===ember?['BAG']:[]),'REST','BACK'];
    case 1:return [d.name==='Ember'?'FIRE JUMP':'ICE JUMP','BACK'];
    case 2:return ['GO WALK','BACK'];
    default:return docked?['BATTLE','TRADE','UNLINK','BACK']:['LINK UP','BACK'];
  }
}
function face(){for(const d of devices){d.rx=0;d.ry=0}}
let friendReady=null;
// who is on the other end of LINK: a friend online, Robo the club bot, or (offline) the next edition in the series
let friendInfo=null;
function friendEdition(){if(friendInfo?.edition)return friendInfo.edition;const keys=Object.keys(editionNames);return keys[(keys.indexOf(ember.edition||edition||'kiln')+1)%keys.length]}
function prepareFriend(){
  const choice=friendEdition();
  const nameFriend=()=>{glacier.label=friendInfo?.name?friendInfo.name.toUpperCase().slice(0,10):editionNames[choice]};
  if(glacier.edition===choice){nameFriend();return Promise.resolve()}
  return loadEdition(choice).then(model=>{
    glacier.group.visible=false;
    fitKiln(glacier,model.clone(true),choice);
    nameFriend();
    return renderer.compileAsync?renderer.compileAsync(scene,camera).catch(()=>{}):null;
  }).catch(e=>console.warn('friend console failed to load, using the fallback body',e));
}
function startLink(friend){
  if(docked||searchingUntil)return;
  friendInfo=friend||null;
  searchingUntil=clock()+1.7;ember.page=null;
  friendReady=false;prepareFriend().then(()=>{friendReady=true});
  say(ember,'FINDING FRIEND…',1700);sfx('alert');
  updateHint('Looking for a nearby friend… Hold your console steady.');
}
const mobileLink=document.querySelector('.mobile-link');
const mobileLCD=mobileLink?.querySelector('canvas');
const mobileLinkScreen=mobileLCD?.getContext('2d');
const mobileLCDToggle=mobileLink?.querySelector('[data-mobile-lcd]');
let enlargedLCD=false;
mobileLCDToggle?.addEventListener('click',()=>{enlargedLCD=!enlargedLCD;});
const mobileViewport=matchMedia('(max-width:900px)');
const rotatePrompt=document.querySelector('#link-rotate');
const portraitPhone=matchMedia('(max-width:900px) and (orientation:portrait) and (pointer:coarse)');
let rotatePromptPending=false;
portraitPhone.addEventListener('change',()=>{
  if(!portraitPhone.matches){
    rotatePromptPending=false;
    if(rotatePrompt?.open)rotatePrompt.close();
  }
});
let mobileLinkAt=0;
function showMobileLink(show){
  if(!mobileLink||mobileLink.hidden===!show)return;
  mobileLink.hidden=!show;
  document.body.classList.toggle('mobile-linked',show);
  if(show)glacier.human=false;
}
mobileLink?.querySelectorAll('[data-mobile-key]').forEach(button=>{
  button.addEventListener('click',()=>{if(docked)press(ember,Number(button.dataset.mobileKey));});
});
mobileLink?.querySelector('[data-mobile-battle]').addEventListener('click',()=>{
  if(!docked||battle)return;
  if(!ember.hatched){
    mobileLink.querySelector('.mobile-link-hint').textContent='Hatch your dragon with the middle button to battle.';
    mobileLink.querySelector('.mobile-link-hint').hidden=false;
    return;
  }
  requestBattle();
});
mobileLink?.querySelector('[data-mobile-unlink]').addEventListener('click',()=>linkButton.click());
function setDocked(value){
  if(value===docked)return;
  if(!value){glacier.human=false;if(battle)battle=null,setTrack('calm')}
  else{glacier.group.visible=true;glacier.group.position.x=7;glacier.page=null;glacier.selection=0}
  face();docked=value;sfx(value?'link':'unlink');
  if(value)zoomed=true;
  for(const d of devices){
    d.selection=0;
    d.page=null;d.shop=null;d.bag=false;d.status=null;if(d.game)d.game=null;setMood(d,value?'happy':'idle',value?1.5:0);
  }
  if(value){beamPower=.8;ringT=0;setTimeout(()=>emit(seamPos(),40,[0xff7a2a,0x2ad8ff,0xb7ff3a],2.4,.9,2),180)}
  mobileLinkAt=performance.now()+750;
  rotatePromptPending=Boolean(value&&rotatePrompt&&portraitPhone.matches);
  if(!value&&rotatePrompt?.open)rotatePrompt.close();
  if(!value){
    enlargedLCD=false;
    showMobileLink(false);
    document.body.removeAttribute('data-link-lcd');
  }
  if(value&&mobileLink){
    mobileLink.querySelector('[data-mobile-link-status]').textContent='Linked with '+nm(glacier);
    mobileLink.querySelector('.mobile-link-hint').hidden=true;
  }
  linkButton.textContent=value?'Unlink':'Link with a friend';
  window.dispatchEvent(new CustomEvent('dragonlink:link',{detail:{linked:value,friend:nm(glacier),edition:glacier.edition}}));
  if(!value)selected=ember;
  updateHint(value?(friendInfo&&!friendInfo.bot?`${nm(glacier)} is linked from another device! LINK → TRADE to swap items. In LINK → BATTLE, ${nm(glacier)}’s unit fights on its own here.`:`${nm(glacier)} is linked! LINK → TRADE to swap items, LINK → BATTLE for a co-op rhythm battle against the Shadow Wyrm. A friend next to you can play ${nm(glacier)} with J K L.`):'Your friend unlinked. You’re back with your dragon.');
}
function press(d,i){
  if(!started)return start();
  selected=d;d.kick=Math.max(d.kick,.5);
  const k=d.keys[i];k.userData.pressedUntil=performance.now()+125;
  if(battle&&docked){battleKey(d,i);return}
  if(d.game){gameKey(d,i);return}
  if(d.shop){shopKey(d,i);return}
  if(d.bag){d.bag=false;sfx('back');return}
  if(d.status!=null){
    if(i===1){d.status=null;sfx('back');return}
    const n=statusPages(d);d.status=(d.status+(i===0?-1:1)+n)%n;sfx('key');statusHint(d);return;
  }
  sfx('key');
  const now=clock();
  if(d.moodUntil&&now<d.moodUntil&&['eat','sleep','walk','crack'].includes(d.mood))return;
  if(!d.hatched){
    if(d===ember&&!d.species){                       // a new game starts by choosing the egg
      if(i!==1){d.pick=((d.pick||0)+(i===0?-1:1)+SPECIES.length)%SPECIES.length;sfx('key');eggHint(d);return}
      d.species=SPECIES[d.pick||0];sfx('ok');save();say(d,SPECIES_INFO[d.species].name+' EGG!',1400);
      updateHint(`You took the ${SPECIES_INFO[d.species].name.toLowerCase()} egg. Press ● to hatch it.`);return;
    }
    if(i!==1)return;
    setMood(d,'crack');
    setTimeout(()=>{d.hatched=true;d.stage=1;d.evolveFx={from:0,to:1,until:clock()+1.4};d.hunger=3;d.joy=3;d.energy=4;setMood(d,'happy',2);sfx('hatch');shake=.15;
      emit(screenPos(d),60,d.side===1?[0xffd27a,0xff6a1f,0xfff1a8]:[0xbaf7ff,0x34c8ff,0xfff1a8],3,1.1,2);
      say(d,'HELLO!',1800);updateHint(nm(d)+' hatched! ◀ ▶ Browse the menu. ● Confirm. Feed your dragon, play, go for walks, and use LINK to find a friend.');save()},900);
    return;
  }
  if(i!==1){
    const step=i===0?-1:1;
    if(d.page===null){const n=menuOf().length;d.selection=(Math.min(d.selection,n-1)+step+n)%n}
    else{const n=submenuOf(d).length;d.sub=(d.sub+step+n)%n}
    return;
  }
  if(d.page===null&&docked){linkAction(d,LINK_MENU[Math.min(d.selection,LINK_MENU.length-1)]);return}
  if(d.page===null){
    if(menu[d.selection]==='SHOP'){if(d!==ember){say(d,'FRIEND’S UNIT');return}openShop(d);return}
    if(menu[d.selection]==='STATUS'){d.status=0;sfx('ok');statusHint(d);return}
    d.page=d.selection;d.sub=0;sfx('ok');return}
  const option=submenuOf(d)[d.sub],page=d.page;d.page=null;
  if(option==='BACK'){sfx('back');return}
  sfx('ok');
  if(page===0){
    if(option==='FEED'){
      if(d.hunger>=4){say(d,'FULL!');return}
      if(d!==ember){d.hunger=Math.min(4,d.hunger+2);setMood(d,'eat',1.6);return}   // the friend brings its own food
      if(market.take('grilled')){d.ate='grilled';d.hunger=Math.min(4,d.hunger+2);addXP(d,1);setMood(d,'eat',1.6);updateHint(`${nm(d)} ate a Fish. ${market.count('grilled')} left in your bag.`)}
      else if(market.claimRice()&&market.take('grilled')){d.ate='grilled';d.hunger=Math.min(4,d.hunger+2);setMood(d,'eat',1.6);updateHint(`${nm(d)} ate the club’s free fish for today. Buy more at Kama’s grill in SHOP.`)}
      else{say(d,'NO FOOD');sfx('back');updateHint('No food in your bag. Open SHOP → Kama and buy Fish. The club gives one free fish each market day.')}
    } else if(option==='BAG'){
      d.bag=true;updateHint('Your bag: Fish to eat, Pearls to grow, and embers from walks to sell. Press any button to close.');
    } else if(option==='EVOLVE'){
      if(!market.take('pearl'))return;
      d.stage=3;d.evolveFx={from:2,to:3,until:clock()+3.2};setMood(d,'happy',2.4);say(d,'GROWN UP!',2400);sfx('evolve');shake=.25;d.kick=1;
      for(let i=0;i<4;i++)setTimeout(()=>emit(screenPos(d),60,[0xfff1a8,0xffd27a,0xbaf7ff],3.2,1.3,2),i*250);
      updateHint(`${nm(d)} swallowed the Pearl and grew into a full adult dragon!`);save();
    } else {d.energy=4;setMood(d,'sleep',3);updateHint(nm(d)+' is napping. Energy restored.')}
  } else if(page===1){startGame(d)}
  else if(page===2){
    setMood(d,'walk',2.6);updateHint(nm(d)+' is exploring the mountains…');
    setTimeout(()=>{
      const item='ore',n=1+(Math.random()<.4?1:0);
      addXP(d,1);d.gems++;
      if(d===ember){market.reward('walk',item,n);updateHint(`${nm(d)} found ${n} ${ITEMS[item].name}${n>1?'s':''}. Kama and Gen both buy embers in SHOP. Check who pays more.`)}
      d.found={item,icon:ITEMS[item].lcd,label:`+${n} ${ITEMS[item].name.toUpperCase()}${n>1?'S':''}`,until:clock()+1.8};sfx('coin');setMood(d,'happy',1.6);
      emit(screenPos(d),16,[0xfff1a8,0xb7ff3a],1.6,.7);
    },2600);
  } else {
    if(option==='LINK UP')startLink();
    else if(option==='UNLINK')setDocked(false);
    else if(option==='BATTLE')requestBattle();
    else if(option==='TRADE'){if(window.DragonLinkUI?.openTrade)window.DragonLinkUI.openTrade();else say(d,'TRADE: OPEN THE GAME SERVER')}
  }
}
// the four things two linked units can do together
function linkAction(d,act){
  sfx('ok');
  if(act==='BOSS')return requestBattle();
  if(act==='UNLINK')return setDocked(false);
  if(act==='TRADE'){if(window.DragonLinkUI?.openTrade)window.DragonLinkUI.openTrade();else say(d,'TRADE: OPEN THE GAME SERVER');return}
  // GIFT: one fish from your bag feeds the other dragon right away
  const to=d===ember?glacier:ember;
  if(to.hunger>=4){say(d,'FRIEND IS FULL');return}
  const gave=d!==ember||(market.gift?market.gift(friendInfo?.account,'grilled',1):market.take('grilled'));
  if(!gave){say(d,'NO FISH');sfx('back');updateHint('No fish to give. Unlink and buy Fish from Kama in SHOP.');return}
  to.hunger=Math.min(4,to.hunger+2);setMood(to,'eat',1.6);say(d,'GIFT SENT!',1400);d.kick=1;
  emit(screenPos(to),18,[0xfff1a8,0xff6a1f],1.4,.7);
  updateHint(d===ember?`You gave ${nm(to)} a fish. ${market.count('grilled')} left in your bag.`:`${nm(d)} gave ${nm(to)} a fish.`);
}
// slow stat decay so the pets ask for care during a demo
setInterval(()=>{
  if(!started)return;
  for(const d of devices){
    if(!d.hatched||d.game||battle||!d.group.visible)continue;
    if(Math.random()<.5)d.hunger=Math.max(0,d.hunger-1);else d.joy=Math.max(0,d.joy-1);
    const need=d.hunger===0||d.joy===0;
    if(need&&!d.attention){sfx('alert');say(d,d.hunger===0?'HUNGRY!':'LONELY…')}
    d.attention=need;
  }
},28000);

// ───────────────────────────── input ─────────────────────────────
const ray = new T.Raycaster();
// Auto-zoom: any press on a console brings its screen up close; a click anywhere else goes back to the overview.
// While linked, the zoom frames both screens side by side, so the battle and the trade stay readable.
let zoomed=false;
function zoomIn(){if(!zoomed){zoomed=true;face()}}
function zoomOut(){zoomed=false}
// the zoomed frame holds the LCD and the three buttons under it (measured in world units from the model)
const ZOOM_FILL=.88,LCD_W=1.8,FRAME_H=1.82,FRAME_Z=1.0,FRAME_Y=-.31;
function zoomTarget(){
  const halfTan=Math.tan(T.MathUtils.degToRad(camera.fov/2));
  let x=0,w=LCD_W;
  if(docked){const a=-((ember.dockHalf??dockSpacing)-.06),b=(glacier.dockHalf??dockSpacing)-.06;x=(a+b)/2;w=b-a+LCD_W}
  // screen height to fit: the LCD's own height, or its width squeezed into the view's aspect
  const h=Math.max(FRAME_H,w/camera.aspect)/ZOOM_FILL;
  return {x,y:ember.group.position.y+FRAME_Y,z:FRAME_Z+h/2/halfTan};
}
function hit(e){
  const r=canvas.getBoundingClientRect();
  ray.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);
  return ray.intersectObjects(targets,false)[0]?.object.userData;
}
canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  if(!started){start();return}
  const h=hit(e);if(!h){zoomOut();return}
  canvas.focus({preventScroll:true});
  zoomIn();
  if(h.type==='key'){if(h.d===glacier)glacier.human=true;press(h.d,h.index);return}
  if(h.type==='pad'){docked?setDocked(false):startLink();return}
  selected=h.d;
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,d:h.d,moved:0};
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove',e=>{
  if(drag?.id!==e.pointerId)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(!dx&&!dy)return;
  drag.moved+=Math.abs(dx)+Math.abs(dy);
  if(drag.moved<6)return;
  zoomOut();
  if(docked&&!battle)setDocked(false);
  if(battle)return;
  drag.d.ry+=dx*.012;drag.d.rx=T.MathUtils.clamp(drag.d.rx+dy*.012,-1.3,1.3);
  drag.x=e.clientX;drag.y=e.clientY;
});
for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>{if(drag?.id===e.pointerId)drag=null});
canvas.addEventListener('dblclick',face);
document.addEventListener('pointerdown',e=>{if(e.target!==canvas)zoomOut()},true);
document.querySelector('#front').addEventListener('click',face);
const unlinkDialog=document.querySelector('#unlink-confirm');
unlinkDialog?.addEventListener('close',()=>{
  if(unlinkDialog.returnValue==='unlink'&&docked)setDocked(false);
});
linkButton.addEventListener('click',()=>{
  if(!started)start();
  if(docked){
    if(!unlinkDialog)return setDocked(false);
    unlinkDialog.returnValue='';
    unlinkDialog.showModal();
    return;
  }
  if(window.DragonLinkUI?.openLinkMenu)return window.DragonLinkUI.openLinkMenu();startLink()});
muteButton?.addEventListener('click',toggleMute);
function toggleMute(){muted=!muted;if(master)master.gain.value=muted?0:.8;if(muteButton)muteButton.textContent=muted?'♪ OFF':'♪ ON';
  window.dispatchEvent(new CustomEvent('dragonlink:mute',{detail:{muted}}))}
const KEYMAP={a:[0,0],s:[0,1],d:[0,2],j:[1,0],k:[1,1],l:[1,2]};
window.addEventListener('keydown',e=>{
  if(e.target instanceof HTMLButtonElement&&(e.key==='Enter'||e.key===' '))return;
  if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||document.querySelector('dialog[open]'))return;
  if(!started)return;
  const key=e.key.toLowerCase();
  if(e.repeat)return;
  if(key==='r'&&e.shiftKey){try{localStorage.removeItem(SAVE)}catch{}location.reload();return}
  if(key==='m'){toggleMute();return}
  if(key==='f'){face();return}
  if(key==='1'||key==='2'){if(key==='2'&&!docked)return;selected=devices[Number(key)-1];updateHint('Arrow keys and Enter now control '+nm(selected)+'.');return}
  if(KEYMAP[key]){const [dv,i]=KEYMAP[key];if(dv===1){if(!docked)return;glacier.human=true}zoomIn();press(devices[dv],i);return}
  if(key==='escape'){selected.page=null;selected.status=null;zoomOut();return}
  const i=['arrowleft','enter','arrowright'].indexOf(key);
  const j=key===' '?1:i;
  if(j>=0){e.preventDefault();zoomIn();press(selected,j)}
});
const editionKey = 'dragon-link-housing-v1';
const editionNames = {kiln:'KILN',ryu:'RYU',fossil:'FOSSIL',nocturne:'NOCTURNE'};
const editionBlurbs = {
  kiln:'Ember-red shell with layered scales. The classic first egg.',
  ryu:'Jade shell with little horns. Cool to the touch, calm on the shelf.',
  fossil:'Ribbed amber shell, like something dug out of a museum drawer.',
  nocturne:'Violet night shell with a single crest. Looks best after dark.'};
const shelf = document.querySelector('#shelf');
const unbox = document.querySelector('#unbox');
const startButton = document.querySelector('#start');
const modelCache = new Map();
function loadEdition(choice) {
  if (!modelCache.has(choice)) {
    const loader = new GLTFLoader();
    const pending = choice === 'kiln'
      ? loader.parseAsync(kilnBytes.buffer,'')
      : loader.loadAsync(new URL(`assets/series/${choice}.glb`,location.href).href);
    modelCache.set(choice,pending.then(({scene}) => scene).catch(error => {
      modelCache.delete(choice);
      throw error;
    }));
  }
  return modelCache.get(choice);
}
let edition, shelfChoice = 'kiln', gallery;
let opening = false, shelfLoad = 0;
const packLoader = document.querySelector('#pack-loader');
try {
  const saved = localStorage.getItem(editionKey);
  if (Object.hasOwn(editionNames,saved)) edition = saved;
} catch {}
function selectPack(choice) {
  if(opening)return;
  shelfChoice = choice;
  const name = editionNames[choice];
  const index = Object.keys(editionNames).indexOf(choice)+1;
  unbox.textContent = 'Unbox ' + name;
  document.querySelector('#pack-meta').textContent = `No.0${index}  ${name}`;
  document.documentElement.dataset.edition = choice;
  const blurb = document.querySelector('#pack-blurb'); if (blurb) blurb.textContent = editionBlurbs[choice];
  document.querySelector('#shelf-status').textContent = '';
  for(const tab of shelf.querySelectorAll('[data-edition]')){
    tab.setAttribute('aria-pressed',String(tab.dataset.edition===choice));
  }
  gallery?.select(choice);
  const load=++shelfLoad;
  const pending=gallery?.ready(choice);
  packLoader.hidden=!pending;
  pending?.then(()=>{
    if(load===shelfLoad&&!opening)packLoader.hidden=true;
  });
}
const packCanvas = document.querySelector('#pack-view');
function showShelf() {
  if (!gallery) {
    try { gallery=createPackGallery(packCanvas,scene.environment,loadEdition,selectPack); }
    catch (error) {
      console.warn(error);
      packCanvas.hidden=true;
      shelf.querySelector('.pack-stage').hidden=true;
      document.querySelector('#pack-flip').hidden=true;
    }
  }
  selectPack(edition || 'kiln');
}
startButton.hidden = !edition;
showShelf();
document.querySelector('#shop-guide-link').addEventListener('click',event=>{
  event.preventDefault();
  document.querySelector('#shop-guide').showModal();
});
for(const tab of shelf.querySelectorAll('[data-edition]')){
  tab.addEventListener('click',() => selectPack(tab.dataset.edition));
}
const stepPack = direction => { if(!opening)gallery?.step(direction); };
document.querySelector('#pack-prev').addEventListener('click',() => stepPack(-1));
document.querySelector('#pack-next').addEventListener('click',() => stepPack(1));
document.querySelector('#pack-flip').addEventListener('click',() => { if(!opening)gallery?.flip(); });
packCanvas.addEventListener('keydown',event=>{
  if(opening)return;
  const action = {ArrowLeft:()=>stepPack(-1),ArrowRight:()=>stepPack(1),' ':()=>gallery?.flip(),Enter:()=>gallery?.flip()}[event.key];
  if (!action) return;
  event.preventDefault();
  action();
});
// Rear / right / left product shots of the unboxed console, drawn with the main renderer.
function renderViews(d){
  const imgs=[...document.querySelectorAll('.views img')];if(imgs.length<3)return;
  const src=d.body.children[0];if(!src)return;
  const studio=new T.Scene();studio.environment=scene.environment;
  studio.add(new T.HemisphereLight(0xffffff,0x8a7a70,1.1));
  const key=new T.DirectionalLight(0xffffff,2.2);key.position.set(3,4,6);studio.add(key);
  // borrow the real housing for a moment (cloning would deep-copy cyclic userData)
  const parent=src.parent,keepPos=src.position.clone(),keepRot=src.rotation.clone();
  const obj=new T.Group();obj.add(src);studio.add(obj);src.rotation.set(0,0,0);src.updateMatrixWorld(true);
  const box=new T.Box3().setFromObject(src),c=box.getCenter(new T.Vector3());src.position.sub(c);
  const R=box.getSize(new T.Vector3()).length()*.5;
  const cam=new T.OrthographicCamera(-R,R,R,-R,.1,R*6);cam.position.set(0,0,R*3);
  const S=240,pr=renderer.getPixelRatio(),px=Math.round(S*pr);
  const out=document.createElement('canvas');out.width=out.height=S;const g=out.getContext('2d');
  const prevColor=renderer.getClearColor(new T.Color()),prevAlpha=renderer.getClearAlpha();
  renderer.setScissorTest(true);
  [[Math.PI,0],[-Math.PI/2,1],[Math.PI/2,2]].forEach(([ry,i])=>{
    obj.rotation.set(0,ry,0);
    renderer.setViewport(0,0,S,S);renderer.setScissor(0,0,S,S);
    renderer.setClearColor(0xffffff,1);renderer.clear();renderer.render(studio,cam);
    g.clearRect(0,0,S,S);g.drawImage(canvas,0,canvas.height-px,px,px,0,0,S,S);
    imgs[i].src=out.toDataURL('image/jpeg',.88);
  });
  src.position.copy(keepPos);src.rotation.copy(keepRot);parent.add(src);
  renderer.setScissorTest(false);renderer.setClearColor(prevColor,prevAlpha);
  renderer.setViewport(0,0,canvas.width/pr,canvas.height/pr);renderer.render(scene,camera);
}
async function start(choice = edition, reveal = false) {
  if (started || opening || !choice) return;
  opening = true;
  const controls=shelf.querySelectorAll('.pack-tools button, .pack-arrow, #pack-flip');
  controls.forEach(button=>button.disabled=true);
  packCanvas.inert=true;
  packLoader.hidden=false;
  initAudio();
  startButton.disabled = unbox.disabled = true;
  const status = document.querySelector('#shelf-status');
  status.textContent = 'Unboxing ' + editionNames[choice] + '…';
  try {
    const model = await loadEdition(choice);
    if(reveal)await gallery?.ready(choice);
    fitKiln(ember,model,choice);
    document.documentElement.dataset.edition=choice;
    if(renderer.compileAsync)await renderer.compileAsync(scene,camera).catch(()=>{});
    renderViews(ember);
    prepareFriend();
    packLoader.hidden=true;
    if(reveal)await gallery?.unbox(choice);
    edition = choice;
    try { localStorage.setItem(editionKey,edition); } catch {}
    started = true;
    gallery?.dispose();
    titleScreen.classList.add('gone');
    setTimeout(() => titleScreen.hidden = true,700);
    if (!ember.hatched) say(ember,'PRESS ●',2000);
    updateHint(ember.hatched ? (awayReport ? `While you were away: ${awayReport.join(' ')}` : `Welcome back! ${nm(ember)} missed you.`) : (ember.species?'Press ● (S, Enter, or Space) to hatch your dragon.':'Choose your egg: ◀ ▶ to look, ● to take it. It decides which dragon hatches.'));
    canvas.inert = document.querySelector('.side').inert = false;
    canvas.focus({preventScroll:true});
  } catch (error) {
    console.error(error);
    status.textContent = 'The console couldn’t load. Try again or choose another edition.';
  } finally {
    opening = false;
    packLoader.hidden=true;
    packCanvas.inert=false;
    controls.forEach(button=>button.disabled=false);
    startButton.disabled = unbox.disabled = false;
  }
}
startButton.addEventListener('click',() => start());
unbox.addEventListener('click',() => start(shelfChoice,true));

// ───────────────────────────── layout / loop ─────────────────────────────
let lastW=0,lastH=0;
function size(force){
  const w=canvas.clientWidth,h=canvas.clientHeight;
  if(!w||!h)return;
  if(!force&&w===lastW&&h===lastH)return;lastW=w;lastH=h;
  renderer.setSize(w,h,false);camera.aspect=w/h;
  camera.updateProjectionMatrix();
  // stretch the square gradient to cover the viewport
  if(backdrop?.image){
    const ia=backdrop.image.width/backdrop.image.height,va=w/h;
    if(va>ia){backdrop.repeat.set(1,ia/va);backdrop.offset.set(0,(1-ia/va)/2)}
    else{backdrop.repeat.set(va/ia,1);backdrop.offset.set((1-va/ia)/2,0)}
  }
}
new ResizeObserver(()=>size()).observe(canvas);size();
ember.group.position.x=0;ember.ry=0;glacier.group.position.x=7;
camera.position.z=Math.max(8.9,(camera.aspect<.9?8.1:10.2)/camera.aspect);
let last=performance.now();
const camBase={x:0,y:.1};
let avgMs=16,prScale=Math.min(devicePixelRatio,1.25),prCheck=0;
const frameFn=()=>{
  if (!started && !shelf.hidden && gallery) { gallery.draw(); return; }
  const nowMs=performance.now(),rawDt=nowMs-last,dt=Math.min(.05,rawDt/1000);last=nowMs;
  if(rawDt<200)avgMs=avgMs*.95+rawDt*.05;

  const t=nowMs/1000,now=clock();
  if(battle)tickBattle(now);
  const mobileFocused=Boolean(mobileLink&&mobileViewport.matches&&docked&&nowMs>=mobileLinkAt);
  showMobileLink(mobileFocused);
  if(rotatePromptPending&&mobileFocused&&!document.querySelector('dialog[open]')){
    rotatePromptPending=false;
    rotatePrompt.showModal();
  }
  const showLCD=mobileFocused&&(enlargedLCD||Boolean(battle));
  if(mobileLink && mobileLCD.hidden===showLCD){
    mobileLCD.hidden=!showLCD;
    mobileLCDToggle.setAttribute('aria-expanded',String(showLCD));
    mobileLCDToggle.textContent=showLCD?'Shrink LCD':'Enlarge LCD';
    document.body.toggleAttribute('data-link-lcd',showLCD);
  }
  if(mobileFocused){
    mobileLCDToggle.hidden=Boolean(battle);
    mobileLink.querySelector('.mobile-link-actions').hidden=Boolean(battle);
    mobileLink.querySelector('[data-mobile-unlink]').hidden=Boolean(battle);
    const battleHint=mobileLink.querySelector('.mobile-link-hint');
    if(battle){
      const message=battle.state==='win'||battle.state==='lose'
        ?'Press the middle button to return.'
        :'Match the arrows as they reach the ring. Your partner plays automatically.';
      if(battleHint.textContent!==message)battleHint.textContent=message;
      battleHint.hidden=false;
    }else if(ember.hatched)battleHint.hidden=true;
  }
  if(searchingUntil&&now>searchingUntil&&friendReady!==false){searchingUntil=0;setDocked(true)}
  const camZ=docked?Math.max(mobileFocused?8.1:10,13.6/camera.aspect):Math.max(8.9,(camera.aspect<.9?8.1:10.2)/camera.aspect);
  const zt=zoomed&&!mobileFocused?zoomTarget():null;
  camBase.x=T.MathUtils.lerp(camBase.x,zt?zt.x:0,.08);
  camBase.y=T.MathUtils.lerp(camBase.y,zt?zt.y:.1,.08);
  camera.position.z=T.MathUtils.lerp(camera.position.z,zt?zt.z:camZ,.08);
  music.beatFlash=Math.max(0,music.beatFlash-dt*4);
  for(const d of devices){
    if(!d.group.visible)continue;
    if(d.game)tickGame(d,now,dt);
    if(d.moodUntil&&now>d.moodUntil){d.moodUntil=0;d.mood='idle'}
    const DOCK_OVERLAP=.06;
    const target=d===ember?(docked?-((ember.dockHalf??dockSpacing)-DOCK_OVERLAP):0):(docked?(glacier.dockHalf??dockSpacing)-DOCK_OVERLAP:7.5);
    d.group.position.x=T.MathUtils.lerp(d.group.position.x,target,d===glacier?.09:.12);
    if(d===glacier&&!docked&&d.group.position.x>7){d.group.visible=false;continue}
    d.group.position.y=docked?Math.sin(t*1.3)*.05:Math.sin(t*1.3+d.side)*.07;
    d.group.rotation.x=T.MathUtils.lerp(d.group.rotation.x,d.rx,.18);
    d.group.rotation.y=T.MathUtils.lerp(d.group.rotation.y,d.ry+(docked?0:Math.sin(t*.7+d.side)*.05),.18);
    d.group.rotation.z=docked?0:Math.sin(t*.9+d.side*2)*.025;
    d.kick=Math.max(0,d.kick-dt*5);
    const sq=docked?1:1+Math.sin(d.kick*Math.PI)*.015;d.body.scale.set(sq,2-sq,1);
    for (const key of d.keys) {
      const rest = key.userData.restZ ?? d.keyZ;
      const target = key.userData.pressedUntil > nowMs ? rest-.05 : rest;
      key.position.z = T.MathUtils.lerp(key.position.z,target,.45);
    }
    // LCD backlight brightens in action modes; status lamp pulses on the beat
    const lit=(battle&&docked)||d.game;
    d.screenMat.color.setScalar(lit?1.12:1.0);
    const lampOn=docked||d.attention||lit||(d===ember&&searchingUntil&&Math.floor(t*6)%2);
    const lampCol=d.attention&&!docked?0xff4040:lit?(d.side===1?0xff9a2a:0x3ae0ff):0xb7ff3a;
    d.lampMat.color.setHex(lampOn?lampCol:0x716430);
    d.lampMat.emissive.setHex(lampOn?lampCol:0);
    d.lampMat.emissiveIntensity=lampOn?(.6+music.beatFlash*1.6+(d.attention?Math.max(0,Math.sin(t*8))*1.5:0)):0;
    d.lampGlow.material.color.setHex(lampCol);d.lampGlow.material.opacity=lampOn?.35+music.beatFlash*.5:0;
    if(nowMs-d.lastDraw>(mobileFocused&&battle?16:50)){
      d.lastDraw=nowMs;drawLCD(d,t,now);
      if(showLCD&&d===ember)mobileLinkScreen.drawImage(d.ctx.canvas,0,0);
    }
  }
  for(const d of devices){d.shadow.visible=d.group.visible;d.shadow.position.x=d.group.position.x;d.shadow.material.opacity=1-Math.min(.5,Math.abs(d.group.position.y)*2)}
  // particles
  for(let i=0;i<PN;i++){
    if(pLife[i]<=0)continue;
    pLife[i]-=dt;
    pVel[i*3+1]-=1.6*dt;
    for(let a=0;a<3;a++){pPos[i*3+a]+=pVel[i*3+a]*dt;pVel[i*3+a]*=.985}
    if(pLife[i]<=0)pPos[i*3+2]=-99;
  }
  pGeo.attributes.position.needsUpdate=true;pGeo.attributes.color.needsUpdate=true;
  for(let i=0;i<MN;i++){mPos[i*3+1]+=dt*(.08+(i%5)*.02);mPos[i*3]+=Math.sin(t*.4+i)*dt*.05;if(mPos[i*3+1]>3.6)mPos[i*3+1]=-3.6}
  mGeo.attributes.position.needsUpdate=true;
  motes.material.size=.07+music.beatFlash*.03;
  beamPower=Math.max(0,beamPower-dt*1.6);
  beam.material.opacity=docked?beamPower:0;beam.scale.set(.5+beamPower*1.2,5,1);
  ringT=Math.min(1,ringT+dt*1.5);
  ring.scale.setScalar(.2+ringT*3.4);ring.material.opacity=docked?(1-ringT)*.9:0;
  rim.intensity=2+music.beatFlash*1.5;rim2.intensity=2+music.beatFlash*1.5;
  shake=Math.max(0,shake-dt);
  camera.position.x=camBase.x+(Math.random()-.5)*shake*.6;camera.position.y=camBase.y+(Math.random()-.5)*shake*.6;
  renderer.render(scene,camera);
};
renderer.setAnimationLoop(frameFn);
// debug/automation hook (used for QA screenshots)
let awayReport=market.update();
setInterval(()=>market.update(),5000);
window.DLD={get zoomed(){return zoomed},zoom:v=>v?zoomIn():zoomOut(),market,simulateWeek,chainReady,submenu:d=>submenuOf(d),shopRows:d=>shopRows(d),link:friend=>startLink(friend),get friend(){return friendInfo},get docked(){return docked},get muted(){return muted},toggleMute:()=>toggleMute(),face:()=>face(),
  setMix:(k,v)=>{mix[k]=v;try{localStorage.setItem('dragon-link-mix',JSON.stringify(mix))}catch{};const bus=k==='music'?musicBus:sfxBus;if(bus)bus.gain.value=v},get mix(){return {...mix}},
  resetProgress:()=>{try{localStorage.removeItem(SAVE)}catch{};location.reload()},frame:(n=1)=>{for(let i=0;i<n;i++)frameFn()},press:(dv,i)=>press(devices[dv],i),dock:v=>setDocked(v),devices,get battle(){return battle},addXP,clock,scheduler,bloom,composer,renderer,scene,camera,get prScale(){return prScale}};
canvas.addEventListener('webglcontextlost',e=>{console.warn('webgl context lost');e.preventDefault()});
}
