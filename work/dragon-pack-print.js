import * as T from 'three';
import logoUrl from '../outputs/dragon-link/brand/dragon-link-kana.svg';
import nearLogoUrl from '../outputs/dragon-link/brand/near-protocol.svg';

export const editions = {
  kiln: ['KILN','窯火','#ffe4a3','#f57436','#b82449','#382040'],
  ryu: ['RYU','翡翠','#e4ffae','#54d6a4','#187e89','#103b43'],
  fossil: ['FOSSIL','化石','#fff1bd','#efa85a','#ac6248','#4d2c3c'],
  nocturne: ['NOCTURNE','夜光','#eee1ff','#a994fa','#5e4aac','#2c215d']
};
const printColors = {
  kiln: { field: [162, 35, 49], ink: '#772633' },
  ryu: { field: [22, 135, 106], ink: '#145748' },
  fossil: { field: [168, 106, 57], ink: '#754721' },
  nocturne: { field: [103, 67, 167], ink: '#4b3278' }
};

const logo = new Image();
const logoReady = new Promise(resolve => {
  logo.onload = () => resolve(true);
  logo.onerror = () => resolve(false);
});
logo.src = logoUrl;
const nearLogo = new Image();
nearLogo.src = nearLogoUrl;

function loadPrint(name) {
  const image = new Image();
  image.src = new URL('assets/packaging/' + name, location.href).href;
  return image;
}
const cover = loadPrint('dragon-link-cover.webp');
const guide = loadPrint('guide-panels.webp');
const isReady = image => image.complete && image.naturalWidth > 0;

function badge(g,x,y,w,h,r,fill,stroke) {
  g.beginPath();
  g.roundRect(x,y,w,h,r);
  g.fillStyle=fill;
  g.fill();
  if(stroke){g.strokeStyle=stroke;g.lineWidth=4;g.stroke();}
}

function colorCover(g, id) {
  const [red, green, blue] = printColors[id].field;
  const image = g.getImageData(0, 0, 640, 996);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], gr = pixels[i + 1], b = pixels[i + 2];
    // Re-ink the saturated cobalt print while preserving the paper, warm inks and dark outlines.
    const strength = Math.min(1, Math.max(0, Math.min(b - gr - 19, gr - r + 10, b - 46) / 30));
    if (strength === 0) continue;
    const grain = (b - 142) * .68 + (gr - 55) * .20;
    pixels[i] = r + (red + grain - r) * strength;
    pixels[i + 1] = gr + (green + grain - gr) * strength;
    pixels[i + 2] = b + (blue + grain - b) * strength;
  }
  g.putImageData(image, 0, 0);
}

function printFront(g,id,withLogo) {
  if (isReady(cover)) {
    g.drawImage(cover,0,0,640,996);
    colorCover(g,id);
    const number=Object.keys(editions).indexOf(id)+1;
    const name=editions[id][0];
    if(withLogo) {
      g.save();g.translate(320,181);g.rotate(-.135);
      g.drawImage(logo,-262,-55,524,110);
      g.restore();
    }
    g.fillStyle='#0d2653';g.textAlign='center';
    g.font='900 19px Rubik, sans-serif';
    if(isReady(nearLogo)) {
      g.drawImage(nearLogo,487,61,55,55*351/1440);
      g.fillText('DL–0'+number,571,75);
    } else {
      g.fillText('DL–0'+number,542,75);
    }
    g.font='900 italic 35px Rubik, sans-serif';
    g.fillText(name,315,898,158);
    return;
  }
  const [name,,paper,bright]=editions[id];
  const no=Object.keys(editions).indexOf(id)+1;
  const navy=printColors[id].ink, black='#28242b',cream='#f7e6b3',blue='#70c8df';
  const accent={kiln:'#ce6c90',ryu:'#80c7a4',fossil:'#e2a260',nocturne:'#aa8acc'}[id];
  function path(draw,fill,stroke=black,line=5){
    g.beginPath();draw();g.closePath();g.fillStyle=fill;g.fill();
    if(line){g.strokeStyle=stroke;g.lineWidth=line;g.lineJoin='round';g.stroke();}
  }
  function label(text,x,y,size,color=black,align='center'){
    g.textAlign=align;g.font=`900 ${size}px Rubik, sans-serif`;g.fillStyle=color;g.fillText(text,x,y);
  }
  function speech(text,x,y,w,angle){
    g.save();g.translate(x,y);g.rotate(angle);
    badge(g,0,0,w,45,14,'#fff5d5',black);
    path(()=>{g.moveTo(21,42);g.lineTo(12,58);g.lineTo(39,43);},'#fff5d5',black,3);
    label(text,w/2,29,17);g.restore();
  }
  function star(x,y,r,angle){
    g.save();g.translate(x,y);g.rotate(angle);
    path(()=>{for(let i=0;i<10;i++){
      const a=i*Math.PI/5-Math.PI/2,d=i%2?r*.36:r;
      if(i===0)g.moveTo(Math.cos(a)*d,Math.sin(a)*d);
      else g.lineTo(Math.cos(a)*d,Math.sin(a)*d);
    }},'#f5a48b',black,4);
    g.restore();
  }
  g.fillStyle=navy;g.fillRect(0,0,640,996);
  path(()=>{g.moveTo(0,247);g.quadraticCurveTo(344,341,640,238);g.lineTo(640,996);g.lineTo(0,996);},cream,black,6);
  const rays=[['#e8a48c',15,84],['#7bc5c5',98,165],['#efbba2',210,275],['#79a8c4',320,380],['#e6ae99',454,518],['#79c3c8',583,680]];
  for(const [color,left,right] of rays){
    path(()=>{g.moveTo(320,295);g.lineTo(left,1020);g.lineTo(right,1020);},color,black,0);
  }
  path(()=>{g.moveTo(25,208);g.bezierCurveTo(83,-15,515,-18,615,188);g.quadraticCurveTo(529,305,313,299);g.quadraticCurveTo(104,300,25,208);},accent,black,7);
  for(const [x,y,col] of [[146,149,'#ffe796'],[496,148,'#ffe796']]){
    path(()=>g.ellipse(x,y,48,39,-.16,0,Math.PI*2),col,black,5);
    badge(g,x-24,y-19,48,34,8,navy);
    g.fillStyle=cream;g.fillRect(x-15,y-11,9,9);g.fillRect(x+5,y-11,9,9);
    label('…',x,y+30,19);
  }
  badge(g,246,100,148,82,17,'#f5cc81',black);
  badge(g,270,115,100,44,7,'#b4c48b',black);
  label('• ᴗ •',319,146,25);
  speech('たまご！',86,63,104,-.15);
  speech('リンク！',450,62,105,.13);
  path(()=>{g.moveTo(0,179);g.quadraticCurveTo(311,350,640,185);g.lineTo(640,251);g.quadraticCurveTo(310,396,0,246);},blue,black,8);
  if(withLogo)g.drawImage(logo,69,223,506,116);
  else label('ドラゴンリンク',320,290,48,navy);

  // The name and comic marks occupy the free left column; the toy sits low right.
  const kana=[...'ドラゴンリンク'];
  kana.forEach((char,i)=>{
    g.save();g.translate(170+Math.sin(i*.8)*25,390+i*60);g.rotate((i-3)*.075);
    g.font='900 64px "Dela Gothic One", sans-serif';g.textAlign='center';g.lineJoin='round';
    g.strokeStyle='#d97071';g.lineWidth=12;g.strokeText(char,0,0);
    g.strokeStyle=black;g.lineWidth=6;g.strokeText(char,0,0);
    g.fillStyle=blue;g.fillText(char,0,0);g.restore();
  });
  path(()=>g.ellipse(458,696,153,166,-.20,0,Math.PI*2),navy,black,0);
  speech('Hatch a dragon!',23,529,137,-.15);
  speech('Care every day',16,765,151,.08);
  for(const [x,y,r,a] of [[57,429,21,.15],[84,666,19,-.32],[53,865,22,.20],[575,439,20,.36],[584,538,16,.21],[554,873,23,-.24],[280,886,21,.21]])star(x,y,r,a);
  badge(g,388,883,207,60,12,paper,black);
  label(name,490,911,26,navy);label('DL–0'+no,490,931,15,navy);
  label('EMBER CLUB  ·  POCKET DRAGON SERIES',29,968,16,navy,'left');
  g.fillStyle='#26234c1c';
  for(let y=7;y<996;y+=12)for(let x=7;x<640;x+=12)g.fillRect(x,y,1.6,1.6);
}

export function printCard(id,back) {
  const [name]=editions[id];
  const number=Object.keys(editions).indexOf(id)+1;
  const c=document.createElement('canvas');
  c.width=640;c.height=996;
  const g=c.getContext('2d');
  const map=new T.CanvasTexture(c);
  map.colorSpace=T.SRGBColorSpace;
  map.anisotropy=4;

  function draw() {
    const withLogo=isReady(logo);
    if (!back) {
      printFront(g,id,withLogo);
      map.needsUpdate=true;
      return;
    }
    const ink=printColors[id].ink, cream='#fff0d1', accent=`rgb(${printColors[id].field.join(' ')})`;
    g.fillStyle=cream;g.fillRect(0,0,640,996);
    g.fillStyle=ink;g.fillRect(0,0,640,103);
    if(isReady(nearLogo)) {
      badge(g,470,41,129,43,10,cream);
      g.drawImage(nearLogo,485,50,99,99*351/1440);
    }
    g.strokeStyle=ink;g.lineWidth=6;g.strokeRect(17,109,606,853);
    const label=(value,x,y,font,color=ink)=>{
      g.font=font;g.fillStyle=color;g.textAlign='center';g.fillText(value,x,y);
    };
    if(withLogo)g.drawImage(logo,112,117,416,95);
    else label('DRAGON LINK',320,176,'900 46px sans-serif');
    g.fillStyle=accent;g.fillRect(33,219,574,54);
    label('あそびかた  /  HOW TO PLAY',320,256,'900 28px sans-serif',cream);
    const steps=[
      ['Hatch your dragon','Start with the egg on the LCD.'],
      ['Care for your dragon','Feed and play with your dragon.'],
      ['Play together','Connect two consoles with LINK.']
    ];
    steps.forEach(([title,caption],i)=>{
      const y=288+i*184;
      badge(g,38,y,564,169,13,'#fff6df',ink);
      if(isReady(guide)) {
        const left=[16,233,447][i];
        g.drawImage(guide,left,74,174,108,52,y+21,168,118);
      }
      badge(g,221,y+24,42,42,21,ink);
      label(String(i+1),242,y+54,'900 24px sans-serif',cream);
      label(title,408,y+89,'900 27px sans-serif');
      label(caption,408,y+126,'600 19px sans-serif');
    });
    g.fillStyle=ink;g.fillRect(33,858,574,83);
    label(name+'  /  DL–0'+number,320,891,'900 25px sans-serif',cream);
    label('EMBER CLUB  ·  POCKET DRAGON SERIES',320,922,'700 17px monospace',cream);
    map.needsUpdate=true;
  }
  draw();
  logoReady.then(draw);
  nearLogo.addEventListener('load',draw,{once:true});
  (back?guide:cover).addEventListener('load',draw,{once:true});
  return map;
}
