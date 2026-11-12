import * as T from 'three';

const finish = {kiln:0xe7c095,ryu:0xb8d9b0,fossil:0xe7bd8e,nocturne:0xbda8e1};
const gasket = new T.MeshStandardMaterial({color:0x252228,roughness:.56});
const blankLCD = new T.MeshStandardMaterial({color:0x83965d,roughness:.52});
const screwMetal = new T.MeshStandardMaterial({color:0xc8cbd0,metalness:.57,roughness:.34});
const screwSlot = new T.MeshStandardMaterial({color:0x303239,roughness:.58});
const lcdWidth=1.70,lcdHeight=1.20,lcdRadius=.105;
const sealWidth=.034;

function roundedRadius(angle,width,height,radius){
  const x=Math.abs(Math.cos(angle)),y=Math.abs(Math.sin(angle));
  const a=width/2,b=height/2;
  const box=Math.min(a/(x||1e-9),b/(y||1e-9));
  const cx=a-radius,cy=b-radius;
  if(box*x<=cx || box*y<=cy)return box;
  const p=x*cx+y*cy;
  return p+Math.sqrt(Math.max(0,p*p-cx*cx-cy*cy+radius*radius));
}

const steps=144;
const angles=Array.from({length:steps},(_,i)=>i/steps*Math.PI*2);
const screenEdge=angles.map(a=>roundedRadius(a,lcdWidth,lcdHeight,lcdRadius));
const sealEdge=angles.map(a=>roundedRadius(a,lcdWidth+2*sealWidth,lcdHeight+2*sealWidth,lcdRadius+sealWidth));
const plateOutline=new T.CatmullRomCurve3([
  [1.289,0],[1.25,.30],[1.115,.59],[.89,.84],[.65,.924],
  [.37,.828],[0,.744],[-.37,.828],[-.65,.924],[-.89,.84],[-1.115,.59],
  [-1.25,.30],[-1.289,0],[-1.233,-.44],[-1.055,-.81],[-.79,-1.075],
  [-.43,-1.276],[0,-1.348],[.43,-1.276],[.79,-1.075],[1.055,-.81],[1.233,-.44]
].map(([x,y])=>new T.Vector3(x,y,0)),true,'centripetal');
const outline=plateOutline.getPoints(264).slice(0,-1);
const plateEdge=angles.map(a=>{
  const x=Math.cos(a),y=Math.sin(a);
  for(let i=0;i<outline.length;i++){
    const p=outline[i],q=outline[(i+1)%outline.length],dx=q.x-p.x,dy=q.y-p.y;
    const cross=x*dy-y*dx;
    if(Math.abs(cross)<1e-8)continue;
    const t=(p.x*y-p.y*x)/cross;
    const r=(p.x*dy-p.y*dx)/cross;
    if(t>=0&&t<=1&&r>0)return r;
  }
  return 1.15;
});

function ringGeometry(rows){
  const positions=[],indices=[];
  for(const [j,row] of rows.entries())for(const [i,a] of angles.entries()){
    const [radius,z]=row(i,a);
    positions.push(radius*Math.cos(a),radius*Math.sin(a),z);
    if(j===rows.length-1)continue;
    const q=j*steps+i,n=j*steps+(i+1)%steps;
    indices.push(q,q+steps,n,n,q+steps,n+steps);
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function lcdDepth(x,y){
  return .980-.175*x*x-.057*y*y-.024*y;
}

// Index projected triangles so fitting several editions does not require
// scanning the entire model for each point on the insert.
function frontDepth(shell){
  const source=shell.geometry.attributes.position;
  const indices=shell.geometry.index.array;
  const vertices=new Float32Array(source.count*3);
  const v=new T.Vector3();
  for(let i=0;i<source.count;i++){
    v.fromBufferAttribute(source,i).applyMatrix4(shell.matrixWorld);
    vertices.set([v.x,v.y,v.z],3*i);
  }
  const size=28,cell=value=>Math.max(0,Math.min(size-1,Math.floor((value+2)*size/4)));
  const bins=Array.from({length:size*size},()=>[]);
  for(let i=0;i<indices.length;i+=3){
    const a=3*indices[i],b=3*indices[i+1],c=3*indices[i+2];
    if(Math.max(vertices[a+2],vertices[b+2],vertices[c+2])<.45)continue;
    const left=cell(Math.min(vertices[a],vertices[b],vertices[c]));
    const right=cell(Math.max(vertices[a],vertices[b],vertices[c]));
    const bottom=cell(Math.min(vertices[a+1],vertices[b+1],vertices[c+1]));
    const top=cell(Math.max(vertices[a+1],vertices[b+1],vertices[c+1]));
    for(let y=bottom;y<=top;y++)for(let x=left;x<=right;x++)bins[y*size+x].push(i);
  }
  return (x,y)=>{
    let depth=-Infinity;
    for(const i of bins[cell(y)*size+cell(x)]){
      const a=3*indices[i],b=3*indices[i+1],c=3*indices[i+2];
      const bx=vertices[b]-vertices[a],by=vertices[b+1]-vertices[a+1];
      const cx=vertices[c]-vertices[a],cy=vertices[c+1]-vertices[a+1];
      const px=x-vertices[a],py=y-vertices[a+1];
      const det=bx*cy-by*cx;
      if(Math.abs(det)<1e-10)continue;
      const u=(px*cy-py*cx)/det,w=(bx*py-by*px)/det;
      if(u<0||w<0||u+w>1)continue;
      depth=Math.max(depth,vertices[a+2]*(1-u-w)+vertices[b+2]*u+vertices[c+2]*w);
    }
    return Number.isFinite(depth)?depth:lcdDepth(x,y);
  };
}

function makeFront(shell){
  const depth=frontDepth(shell);
  const radii=Array.from({length:8},(_,row)=>angles.map((_,i)=>
    T.MathUtils.lerp(sealEdge[i]-.001,plateEdge[i]-.009,row/7)));
  const raw=radii.map(row=>row.map((r,i)=>depth(r*Math.cos(angles[i]),r*Math.sin(angles[i]))));
  const fitted=raw.map((row,j)=>row.map((z,i)=>{
    const at=offset=>row[(i+offset+steps)%steps];
    const smooth=(at(-2)+4*at(-1)+6*z+4*at(1)+at(2))/16;
    return Math.max(z+.007,smooth+.011)+(j===0?.003:0);
  }));
  const faceGeometry=ringGeometry(radii.map((row,j)=>
    i=>[row[i],fitted[j][i]]
  ).concat([
    i=>[plateEdge[i],raw.at(-1)[i]-.006],
    i=>[plateEdge[i]-.003,raw.at(-1)[i]-.025]
  ]));

  const edgeDepth=angles.map((a,i)=>{
    const r=screenEdge[i],x=r*Math.cos(a),y=r*Math.sin(a);
    return Math.max(lcdDepth(x,y),depth(x,y)+.006);
  });
  const sealGeometry=ringGeometry([
    i=>[screenEdge[i]-.001,edgeDepth[i]],
    i=>[screenEdge[i]+.006,edgeDepth[i]+.009],
    i=>[sealEdge[i]-.006,fitted[0][i]+.009],
    i=>[sealEdge[i],fitted[0][i]+.003]
  ]);

  // The display follows the shallow curve of the original LCD well.
  const screenGeometry=ringGeometry(Array.from({length:14},(_,j)=>(i,a)=>{
    const t=Math.max(.0001,j/13);
    const r=screenEdge[i]*t;
    const x=r*Math.cos(a),y=r*Math.sin(a);
    const edgeX=screenEdge[i]*Math.cos(a),edgeY=screenEdge[i]*Math.sin(a);
    return [r,lcdDepth(x,y)+t**8*(edgeDepth[i]-lcdDepth(edgeX,edgeY))+.001];
  }));
  const positions=screenGeometry.attributes.position;
  const uv=new Float32Array(positions.count*2);
  for(let i=0;i<positions.count;i++){
    uv[2*i]=positions.getX(i)/lcdWidth+.5;
    uv[2*i+1]=positions.getY(i)/lcdHeight+.5;
  }
  screenGeometry.setAttribute('uv',new T.BufferAttribute(uv,2));
  return {faceGeometry,sealGeometry,screenGeometry};
}

const screwProfile=[[0,-.031],[.92,-.031],[1,-.016],[1,.002],[.96,.012],[.85,.022],[.70,.025],[0,.025]];
const screwGeometry=new T.LatheGeometry(screwProfile.map(([r,z])=>new T.Vector2(r*.101,z)),64);
screwGeometry.rotateX(Math.PI/2);
const slotShape=new T.Shape();
const cross=[[-.014,-.043],[.014,-.043],[.014,-.014],[.043,-.014],[.043,.014],[.014,.014],[.014,.043],[-.014,.043],[-.014,.014],[-.043,.014],[-.043,-.014],[-.014,-.014]];
cross.forEach(([x,y],i)=>i===0?slotShape.moveTo(x,y):slotShape.lineTo(x,y));
slotShape.closePath();
const slotGeometry=new T.ShapeGeometry(slotShape);

export function mountDragonHardware(parent,shell,edition,screenMaterial=blankLCD){
  const {faceGeometry,sealGeometry,screenGeometry}=makeFront(shell);
  const face=new T.Mesh(faceGeometry,new T.MeshPhysicalMaterial({
    color:finish[edition]??finish.kiln,roughness:.46,clearcoat:.2,clearcoatRoughness:.43
  }));
  face.name='Molded LCD faceplate';
  const seal=new T.Mesh(sealGeometry,gasket);
  seal.name='Thin LCD gasket';
  const screen=new T.Mesh(screenGeometry,screenMaterial);
  parent.add(face,seal,screen);

  const ray=new T.Raycaster(),origin=new T.Vector3(),reverse=new T.Vector3(0,0,1);
  const depth=(x,y)=>{
    ray.set(origin.set(x,y,-3),reverse);
    return ray.intersectObject(shell,false)[0]?.point.z??-.91;
  };
  const centers=edition==='fossil'?[[-.879,-.078],[.899,-.070]]:[[-.792,-.078],[.805,-.070]];
  for(const [x,y] of centers){
    const z=depth(x,y);
    const tiltX=(depth(x+.045,y)-depth(x-.045,y))/.09;
    const tiltY=(depth(x,y+.045)-depth(x,y-.045))/.09;
    const head=new T.Mesh(screwGeometry,screwMetal);
    head.name='Rear screw';
    head.position.set(x,y,z+.010);
    head.rotation.set(Math.atan(tiltY),Math.PI-Math.atan(tiltX),0,'YXZ');
    const slot=new T.Mesh(slotGeometry,screwSlot);
    slot.position.z=.026;
    slot.rotation.z=x<0?.24:-.28;
    head.add(slot);
    parent.add(head);
  }
  parent.updateMatrixWorld(true);
  return {face,screen};
}
