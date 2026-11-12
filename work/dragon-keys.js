import * as T from 'three';

const centers = [[-.50,-.936],[0,-1.02],[.50,-.936]];
function ovalProfile(profile, width, height) {
  const geometry = new T.LatheGeometry(profile.map(([r,z]) => new T.Vector2(r,z)),48);
  geometry.rotateX(Math.PI/2);
  geometry.scale(width,height,1);
  return geometry;
}
const cap = ovalProfile([[0,-.055],[.84,-.055],[.95,-.038],[1,-.01],[1,.035],
  [.98,.058],[.93,.080],[.84,.095],[.72,.100],[0,.100]],.195,.134);
const seat = ovalProfile([[0,-.070],[.93,-.070],[1,-.045],[1,-.010],[.96,.003],[0,.003]],.215,.149);
const amber = new T.MeshPhysicalMaterial({color:0xffac34,roughness:.36,clearcoat:.32,clearcoatRoughness:.27});
const shadow = new T.MeshStandardMaterial({color:0x49332b,roughness:.63});
const ink = new T.MeshStandardMaterial({color:0x9e5011,roughness:.48});
const glyphs = centers.map((_,index) => {
  if (index===1) return new T.CircleGeometry(.037,32);
  const sign=index===0?-1:1;
  const shape=new T.Shape();
  shape.moveTo(sign*.049,0);
  shape.lineTo(-sign*.035,.045);
  shape.lineTo(-sign*.035,-.045);
  shape.closePath();
  return new T.ShapeGeometry(shape);
});

// The seat stays on the faceplate. Only the molded cap travels when pressed.
export function mountDragonKeys(parent, face) {
  const ray=new T.Raycaster(), origin=new T.Vector3(), inward=new T.Vector3(0,0,-1);
  function depth(x,y) {
    ray.set(origin.set(x,y,3),inward);
    return ray.intersectObject(face,false)[0]?.point.z ?? .954;
  }
  return centers.map(([x,y],index)=>{
    const z=depth(x,y);
    const slopeX=(depth(x+.07,y)-depth(x-.07,y))/.14;
    const slopeY=(depth(x,y+.06)-depth(x,y-.06))/.12;
    const tilt=new T.Euler(Math.atan(slopeY),-Math.atan(slopeX),0);
    const well=new T.Mesh(seat,shadow);
    well.position.set(x,y,z+.003);
    well.rotation.copy(tilt);
    parent.add(well);
    const key=new T.Mesh(cap,amber);
    key.position.set(x,y,z+.014);
    key.rotation.copy(tilt);
    key.userData.restZ=key.position.z;
    const icon=new T.Mesh(glyphs[index],ink);
    icon.position.z=.101;
    key.add(icon);
    parent.add(key);
    return key;
  });
}
