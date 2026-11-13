import * as T from 'three';
import { mountDragonKeys } from './dragon-keys.js';
import { mountDragonHardware } from './dragon-hardware.js';

import { editions, printCard } from './dragon-pack-print.js';

const ids = Object.keys(editions);
const width = 2.68, height = 5.08;

// Fit a convex cross section around the toy at each height. The flat edge
// of every section sits against the card, forming the blister's seal.
function fitBlister(toy, bounds) {
  const clearance=.036, base=.035, slices=76, steps=36;
  const min=bounds.min.y-.045, max=bounds.max.y+.045;
  const spacing=(max-min)/slices;
  const rows=Array.from({length:slices+1},()=>[]);
  const point=new T.Vector3();
  toy.updateMatrixWorld(true);
  toy.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const vertices=mesh.geometry.attributes.position;
    for(let i=0;i<vertices.count;i++){
      point.fromBufferAttribute(vertices,i).applyMatrix4(mesh.matrixWorld);
      const row=Math.round((point.y-min)/spacing);
      for(let j=Math.max(0,row-2);j<=Math.min(slices,row+2);j++){
        rows[j].push([point.x,point.z]);
      }
    }
  });

  const xyz=[],idx=[],left=[],right=[];
  for(const [row,points] of rows.entries()){
    const y=min+row*spacing;
    const lo=Math.min(...points.map(p=>p[0]))-clearance;
    const hi=Math.max(...points.map(p=>p[0]))+clearance;
    const center=(lo+hi)/2;
    const radius=[];
    // Intersect radial rays with support lines of the section. The small
    // allowance gives the clear plastic room around the buttons and socket.
    const lines=Array.from({length:steps+1},(_,i)=>{
      const angle=Math.PI*i/steps;
      const x=Math.cos(angle),z=Math.sin(angle);
      const support=Math.max((lo-center)*x,(hi-center)*x,
        ...points.map(p=>(p[0]-center)*x+(p[1]-base)*z+clearance));
      return {x,z,support};
    });
    for(const {x,z} of lines){
      let distance=Infinity;
      for(const line of lines){
        const dot=x*line.x+z*line.z;
        if(dot>1e-6)distance=Math.min(distance,line.support/dot);
      }
      radius.push(distance);
    }
    for(let i=0;i<=steps;i++){
      const {x,z}=lines[i];
      xyz.push(center+x*radius[i],y,base+z*radius[i]);
      if(row===slices||i===steps)continue;
      const a=row*(steps+1)+i,b=a+steps+1;
      idx.push(a,b,a+1,a+1,b,b+1);
    }
    left.push(new T.Vector3(lo,y,base));
    right.push(new T.Vector3(hi,y,base));
  }
  // Flat end faces close the narrow space above and below the housing.
  for(const row of [0,slices]){
    const first=row*(steps+1);
    for(let i=1;i<steps;i++){
      if(row===0)idx.push(first,first+i+1,first+i);
      else idx.push(first,first+i,first+i+1);
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(xyz,3));
  geometry.setIndex(idx);geometry.computeVertexNormals();
  const dome=new T.Mesh(geometry,new T.MeshPhysicalMaterial({
    color:0xe7f4ff,metalness:.14,roughness:.16,clearcoat:1,
    transparent:true,opacity:.10,depthWrite:false,side:T.DoubleSide,forceSinglePass:true
  }));
  dome.renderOrder=2;
  const rim=new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([...left,...right.reverse()],true),168,.015,7,true),
    new T.MeshStandardMaterial({color:0xe6edf4,metalness:.2,roughness:.24,transparent:true,opacity:.58,depthWrite:false}));
  rim.renderOrder=3;
  return [dome,rim];
}

function makePackage(id) {
  const pack=new T.Group();
  const shape=new T.Shape();
  const w=width/2,h=height/2;
  shape.moveTo(-w+.12,-h);
  shape.lineTo(w-.12,-h);
  shape.quadraticCurveTo(w,-h,w,-h+.12);
  shape.lineTo(w,h-.23);
  shape.quadraticCurveTo(w,h,w-.23,h);
  shape.lineTo(-w+.23,h);
  shape.quadraticCurveTo(-w,h,-w,h-.23);
  shape.lineTo(-w,-h+.12);
  shape.quadraticCurveTo(-w,-h,-w+.12,-h);
  shape.closePath();
  const slot=new T.Path();
  slot.moveTo(-.28,2.11);
  slot.quadraticCurveTo(-.38,2.11,-.38,2.19);
  slot.quadraticCurveTo(-.38,2.25,-.27,2.25);
  slot.lineTo(-.12,2.25);
  slot.quadraticCurveTo(0,2.40,.12,2.25);
  slot.lineTo(.27,2.25);
  slot.quadraticCurveTo(.38,2.25,.38,2.19);
  slot.quadraticCurveTo(.38,2.11,.28,2.11);
  slot.closePath();
  shape.holes.push(slot);
  const board=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:.042,bevelEnabled:false,curveSegments:12}),
    new T.MeshStandardMaterial({color:0xc7ab89,roughness:.86}));
  board.position.z=-.021;
  pack.add(board);
  for(const back of [false,true]){
    const art=new T.ShapeGeometry(shape,12);
    const {position,uv}=art.attributes;
    for(let i=0;i<position.count;i++){
      const u=position.getX(i)/width+.5;
      uv.setXY(i,back?1-u:u,position.getY(i)/height+.5);
    }
    const printed=new T.Mesh(art,new T.MeshStandardMaterial({
      map:printCard(id,back),roughness:.83,side:back?T.BackSide:T.FrontSide
    }));
    printed.position.z=back?-.023:.023;
    pack.add(printed);
  }
  return pack;
}

export function createPackGallery(canvas, environment, loadModel, onSelect) {
  const renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.toneMapping=T.NeutralToneMapping;
  renderer.toneMappingExposure=1;
  const scene=new T.Scene();
  scene.environment=environment;
  scene.add(new T.HemisphereLight(0xffffff,0xcda5bf,1.65));
  for(const [x,y,z,intensity] of [[-4,7,9,2.3],[6,3,-6,1.8]]){
    const light=new T.DirectionalLight(0xfff1e3,intensity);
    light.position.set(x,y,z);scene.add(light);
  }
  const camera=new T.PerspectiveCamera(35,1,.1,60);
  const kilnPrint=new T.TextureLoader().loadAsync(
    new URL('assets/packaging/kiln-shell.webp',location.href).href
  ).then(texture=>{
    texture.flipY=false;
    texture.colorSpace=T.SRGBColorSpace;
    texture.needsUpdate=true;
    return texture;
  }).catch(()=>null);
  const items=ids.map((id,index)=>{
    const pack=makePackage(id);
    pack.userData.index=index;
    scene.add(pack);
    pack.userData.ready=loadModel(id).then(async model=>{
      const toy=new T.Group();
      const shell=model.clone(true);
      shell.rotation.y=-Math.PI/2;
      shell.scale.setScalar(24);
      toy.add(shell);
      toy.updateMatrixWorld(true);
      const mesh=shell.getObjectByProperty('isMesh',true);
      if(id==='kiln'){
        const texture=await kilnPrint;
        if(texture){
          mesh.material=mesh.material.clone();
          mesh.material.map=texture;
          mesh.material.needsUpdate=true;
        }
      }
      const {face}=mountDragonHardware(toy,mesh,id);
      mountDragonKeys(toy,face);
      toy.rotation.z=0;
      const bounds=new T.Box3().setFromObject(toy,true);
      const size=bounds.getSize(new T.Vector3());
      const center=bounds.getCenter(new T.Vector3());
      const scale=Math.min(2.12/size.y,1.80/size.x);
      toy.scale.setScalar(scale);
      toy.position.set(.02-center.x*scale,-.73-center.y*scale,.066-bounds.min.z*scale);
      const fittedBounds=new T.Box3().setFromObject(toy,true);
      const hinge=new T.Group();
      hinge.position.set(width/2,0,.035);
      for(const piece of fitBlister(toy,fittedBounds)){
        piece.position.sub(hinge.position);
        hinge.add(piece);
      }
      pack.add(toy,hinge);
      return {toy,hinge};
    }).catch(error=>{
      console.warn('Packaging preview:',id,error);
      return null;
    });
    return pack;
  });
  const ray=new T.Raycaster(), pointer=new T.Vector2();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dragHint=canvas.parentElement.querySelector('.pack-drag-hint');
  const loader=canvas.parentElement.querySelector('#pack-loader');
  const loginCover=document.querySelector('#login');
  const hintKey='dragon-link.pack-drag-hint-seen';
  let hintPending=Boolean(dragHint), hintReadyAt=null, hintStartedAt=null;
  try { if(localStorage.getItem(hintKey))hintPending=false; } catch {}
  function rememberHint(){
    hintPending=false;
    try { localStorage.setItem(hintKey,'1'); } catch {}
  }
  function dismissHint(){
    if(hintPending)rememberHint();
    if(hintStartedAt===null)return;
    hintStartedAt=null;
    dragHint.hidden=true;
  }
  function hintAngle(now){
    if(hintPending&&(!loginCover||loginCover.hidden)&&(!loader||loader.hidden)){
      hintReadyAt??=now+300;
      if(now>=hintReadyAt){
        rememberHint();
        hintStartedAt=now;
        dragHint.hidden=false;
      }
    }
    if(hintStartedAt===null)return 0;
    const phase=(now-hintStartedAt)/3000;
    if(phase>=1){dismissHint();return 0;}
    if(reduced)return 0;
    const poses=[0,-.24,.34,-.24,0];
    const step=Math.floor(phase*4);
    const blend=T.MathUtils.smoothstep(phase*4-step,0,1);
    return T.MathUtils.lerp(poses[step],poses[step+1],blend);
  }
  if(hintPending){
    const shelf=canvas.closest('#shelf');
    shelf.addEventListener('pointerdown',event=>{
      if(event.target===canvas||event.target.closest('button'))dismissHint();
    },true);
    shelf.addEventListener('keydown',event=>{
      if(['ArrowLeft','ArrowRight',' ','Enter'].includes(event.key))dismissHint();
    });
  }
  let active=0,yaw=-.23,pitch=.075,zoom=1,back=false,drag=null;
  let reveal=null;
  let lastWidth=0,lastHeight=0;
  const targetScale=new T.Vector3();
  const ready=id=>items[ids.indexOf(id)]?.userData.ready;
  async function unbox(id){
    dismissHint();
    const parts=await ready(id);
    if(!parts||reduced)return;
    select(id);
    yaw=T.MathUtils.euclideanModulo(yaw+Math.PI,2*Math.PI)-Math.PI;
    items[active].rotation.y=yaw;
    yaw=0;pitch=0;zoom=1;drag=null;
    return new Promise(resolve=>{
      reveal={...parts,origin:parts.toy.position.clone(),start:null,resolve};
    });
  }

  function hit(event){
    const r=canvas.getBoundingClientRect();
    pointer.set((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2);
    ray.setFromCamera(pointer,camera);
    let object=ray.intersectObjects(items.filter(item=>item.visible),true)[0]?.object;
    while(object && object.userData.index===undefined) object=object.parent;
    return object?.userData.index;
  }
  function select(id){
    const index=ids.indexOf(id);
    if(index===active) return;
    active=index;yaw=-.23;pitch=.075;zoom=1;back=false;
  }
  function flip(){
    back=!back;yaw=back?Math.PI:0;pitch=0;
  }
  function step(direction){onSelect(ids[(active+direction+ids.length)%ids.length]);}
  canvas.addEventListener('pointerdown',event=>{
    if(reveal||event.button!==0)return;
    canvas.focus({preventScroll:true});
    canvas.setPointerCapture(event.pointerId);
    drag={id:event.pointerId,hit:hit(event),startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,moved:false};
  });
  canvas.addEventListener('pointermove',event=>{
    if(drag?.id!==event.pointerId)return;
    drag.moved ||= Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>5;
    if(drag.moved&&drag.hit===active){
      yaw+=(event.clientX-drag.x)*.012;
      pitch=T.MathUtils.clamp(pitch+(event.clientY-drag.y)*.010,-1.2,1.2);
    }
    drag.x=event.clientX;drag.y=event.clientY;
  });
  canvas.addEventListener('pointerup',event=>{
    if(drag?.id!==event.pointerId)return;
    if(!drag.moved && drag.hit===active)flip();
    else if(!drag.moved && drag.hit!==undefined)onSelect(ids[drag.hit]);
    else if(drag.moved && drag.hit!==active && Math.abs(event.clientX-drag.startX)>45)step(event.clientX<drag.startX?1:-1);
    drag=null;
  });
  for(const event of ['pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>drag=null);
  canvas.addEventListener('wheel',event=>{
    event.preventDefault();
    if(reveal)return;
    zoom=T.MathUtils.clamp(zoom*Math.exp(-event.deltaY*.001),.78,1.12);
  },{passive:false});
  function draw(){
    const w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h)return;
    if(w!==lastWidth||h!==lastHeight){
      lastWidth=w;lastHeight=h;renderer.setSize(w,h,false);
      camera.aspect=w/h;camera.updateProjectionMatrix();
    }
    camera.position.z=Math.max(9.35,7.05/camera.aspect);
    const spread=Math.min(3.18,2.45*camera.aspect);
    const ease=reduced?1:.15;
    const previewYaw=hintAngle(performance.now());
    for(const [index,pack] of items.entries()){
      let relative=(index-active+ids.length)%ids.length;
      if(relative>ids.length/2)relative-=ids.length;
      const distance=Math.abs(relative),front=distance===0;
      pack.visible=!reveal||front;
      pack.position.x=T.MathUtils.lerp(pack.position.x,relative*spread,ease);
      pack.position.y=T.MathUtils.lerp(pack.position.y,front?0:-.15,ease);
      pack.position.z=T.MathUtils.lerp(pack.position.z,front?0:-2.15*distance,ease);
      pack.scale.lerp(targetScale.setScalar(front?zoom:distance===1?.84:.66),ease);
      pack.rotation.x=T.MathUtils.lerp(pack.rotation.x,front?pitch:0,ease);
      // Keep rotations continuous during drag and wrap only when switching items.
      if(!front)pack.rotation.y=T.MathUtils.euclideanModulo(pack.rotation.y+Math.PI,Math.PI*2)-Math.PI;
      pack.rotation.y=T.MathUtils.lerp(pack.rotation.y,front?yaw+previewYaw:-Math.sign(relative)*.28,ease);
    }
    if(reveal){
      const now=performance.now();
      reveal.start??=now;
      const elapsed=now-reveal.start;
      const peel=T.MathUtils.smoothstep(elapsed,260,820);
      const pull=T.MathUtils.smoothstep(elapsed,640,1290);
      const {hinge,toy,origin}=reveal;
      hinge.rotation.y=peel*1.66;
      hinge.visible=elapsed<960;
      toy.position.set(origin.x-.08*pull,origin.y+.72*pull,origin.z+1.65*pull);
      toy.rotation.y=-.17*Math.sin(Math.PI*pull);
      if(elapsed>=1410)reveal.resolve();
    }
    renderer.render(scene,camera);
  }
  return {draw,select,step,flip,ready,unbox,dispose:()=>renderer.dispose()};
}
