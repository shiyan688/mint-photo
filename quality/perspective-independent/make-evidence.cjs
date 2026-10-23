'use strict';
// Deterministic synthetic fixtures only. Real native Canvas draws/encodes, but
// this is host evidence, not Android/WebView or camera-image acceptance.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),target=process.env.PERSPECTIVE_CORE||path.join(root,'app/src/main/assets/perspective.js'),C=require(target),Q=require('./oracle.cjs'),N=require('../text-overlay-independent/native-canvas.cjs');
const r=(w=1,h=1,q=[[0,0],[1,0],[1,1],[0,1]])=>({version:1,quad:q.map(([x,y])=>({x,y})),outputFraction:{width:w,height:h}});
function data(c){return{width:c.width,height:c.height,data:N.pixels(c)}}
function from(im){const c=N.canvas(im.width,im.height),ctx=c.getContext('2d'),d=ctx.createImageData(im.width,im.height);d.data.set(im.data);ctx.putImageData(d,0,0);return c;}
function save(name,c){fs.writeFileSync(path.join(__dirname,name),c.toBuffer('image/png'));}
function sha(d){return crypto.createHash('sha256').update(d).digest('hex');}
function compare(a,b){assert.equal(a.length,b.length);let max=0,sum=0,sq=0;for(let i=0;i<a.length;i++)if(i%4!==3){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);sum+=d;sq+=d*d;}return{maxByteDelta:max,meanAbsoluteRgbDelta:sum/(a.length*.75),rootMeanSquareRgbDelta:Math.sqrt(sq/(a.length*.75))};}
function stats(im){let min=255,max=0,sum=0;for(let i=0;i<im.data.length;i+=4){min=Math.min(min,im.data[i]);max=Math.max(max,im.data[i]);sum+=im.data[i];}return{minRed:min,maxRed:max,meanRed:sum/(im.width*im.height)};}
function exactArea(im,w,h){
  // Exact source-cell box integration in linear light, independent of the
  // shipped bilinear kernel; intended only for axis-aligned opaque minify.
  const out={width:w,height:h,data:new Uint8ClampedArray(w*h*4)};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const l=x*im.width/w,rr=(x+1)*im.width/w,t=y*im.height/h,b=(y+1)*im.height/h,c=[0,0,0];let area=0;
    for(let sy=Math.floor(t);sy<Math.ceil(b);sy++)for(let sx=Math.floor(l);sx<Math.ceil(rr);sx++){
      const k=Math.max(0,Math.min(sx+1,rr)-Math.max(sx,l))*Math.max(0,Math.min(sy+1,b)-Math.max(sy,t)),i=4*(sy*im.width+sx);area+=k;for(let j=0;j<3;j++)c[j]+=k*Q.linear(im.data[i+j]);
    }
    out.data.set([...c.map(v=>Q.encode(v/area)),255],4*(y*w+x));
  }
  return out;
}
const planar=N.canvas(320,220),pc=planar.getContext('2d');pc.fillStyle='#faf9f2';pc.fillRect(0,0,320,220);
for(let y=0;y<220;y+=20)for(let x=0;x<320;x+=20){pc.fillStyle=(x/20+y/20)%2?'#b9d8d2':'#ecf2e9';pc.fillRect(x,y,20,20);}
pc.fillStyle='#fdfdfb';pc.fillRect(23,58,274,105);pc.fillStyle='#133637';pc.font='bold 29px sans-serif';pc.fillText('MINT 012345',35,95);pc.font='16px sans-serif';pc.fillText('Synthetic planar reference',35,124);pc.font='14px sans-serif';pc.fillText('TL → TR → BR → BL',35,148);pc.strokeStyle='#d51e38';pc.lineWidth=3;pc.strokeRect(4.5,4.5,311,211);pc.fillStyle='#ee263a';pc.fillRect(14,14,10,10);pc.fillStyle='#1f66ed';pc.fillRect(296,196,10,10);
const quad=[[.17,.10],[.88,.18],[.96,.88],[.06,.95]],recipe=r(320/420,220/320,quad),m=Q.matrices(recipe).forward,original=data(planar),photo={width:420,height:320,data:new Uint8ClampedArray(420*320*4)};
for(let y=0;y<320;y++)for(let x=0;x<420;x++){const q=Q.map(m,(x+.5)/420,(y+.5)/320),i=(y*420+x)*4;photo.data.set([38,51,61,255],i);if(q.x>=0&&q.y>=0&&q.x<1&&q.y<1){const sx=Math.min(319,Math.floor(q.x*320)),sy=Math.min(219,Math.floor(q.y*220));photo.data.set(original.data.subarray(4*(sy*320+sx),4*(sy*320+sx+1)),i);}}
const before=sha(photo.data),fixed=C.apply(photo,recipe);assert.equal(sha(photo.data),before);assert.deepEqual([fixed.width,fixed.height],[320,220]);save('planar-reference.png',planar);save('synthetic-perspective-input.png',from(photo));save('synthetic-perspective-corrected.png',from(fixed));
const sheet=N.canvas(1120,430),sc=sheet.getContext('2d');sc.fillStyle='#fff';sc.fillRect(0,0,1120,430);sc.fillStyle='#122';sc.font='18px sans-serif';sc.fillText('Synthetic reference 320 × 220',15,30);sc.fillText('Synthetic photographed plane 420 × 320',350,30);sc.fillText('Production correction 320 × 220',790,30);sc.drawImage(planar,15,65);sc.drawImage(from(photo),350,65);sc.drawImage(from(fixed),790,65);sc.font='14px sans-serif';sc.fillText('Host NativeCanvas PNG evidence. Source bytes preserved. No real photograph or phone/WebView claim.',15,408);save('planar-contact-sheet.png',sheet);
const checker={width:256,height:256,data:new Uint8ClampedArray(256*256*4)};for(let y=0;y<256;y++)for(let x=0;x<256;x++){const v=(x+y)%2?255:0;checker.data.set([v,v,v,255],4*(y*256+x));}
const checkerOut=C.apply(checker,r(17/256,17/256)),checkerRef=exactArea(checker,17,17);save('minify-checker-source.png',from(checker));save('minify-checker-production.png',from(checkerOut));save('minify-checker-area-reference.png',from(checkerRef));
const sharp=N.canvas(577,289),tc=sharp.getContext('2d');tc.fillStyle='#fff';tc.fillRect(0,0,577,289);tc.fillStyle='#000';tc.font='16px sans-serif';for(let y=22;y<110;y+=21)tc.fillText('Sharp text 0123456789 Il1 O0 MINT thin strokes',7,y);tc.font='bold 32px sans-serif';tc.fillText('SHARP TEXT 012345',7,158);tc.font='bold 48px sans-serif';tc.fillText('MINT',7,220);for(let x=240;x<570;x+=3)tc.fillRect(x,180,1,90);tc.fillRect(7,243,220,1);tc.fillRect(7,249,220,2);tc.fillRect(7,258,220,4);
const sharpInput=data(sharp),sharpOut=C.apply(sharpInput,r(97/577,49/289)),sharpRef=exactArea(sharpInput,97,49);save('minify-sharp-text-source.png',sharp);save('minify-sharp-text-production.png',from(sharpOut));save('minify-sharp-text-area-reference.png',from(sharpRef));
const alias=N.canvas(1050,680),ac=alias.getContext('2d');ac.fillStyle='#fff';ac.fillRect(0,0,1050,680);ac.fillStyle='#111';ac.font='18px sans-serif';ac.fillText('Current bounded prefilter vs independent source-area reference',20,30);ac.font='16px sans-serif';ac.fillText('256² checker → 17², production bounded filter',20,65);ac.fillText('Independent linear-light area reference',380,65);ac.imageSmoothingEnabled=false;ac.drawImage(from(checkerOut),20,80,272,272);ac.drawImage(from(checkerRef),380,80,272,272);ac.fillText('577 × 289 text → 97 × 49, production bounded filter',20,395);ac.fillText('Independent area reference',545,395);ac.drawImage(from(sharpOut),20,415,485,245);ac.drawImage(from(sharpRef),545,415,485,245);save('minification-contact-sheet.png',alias);
const result={runtime:process.version,scope:'Synthetic host-side Canvas fixtures; no private inputs, models, network, phone or WebView',sourceInputRgbaSha256:before,sourceAfterRgbaSha256:sha(photo.data),correctedRgbaSha256:sha(fixed.data),recipe,independentReferenceSolver:'8 correspondence equations with partial pivoting; photo generated by nearest sampling the independent inverse map',checker:{input:[256,256],output:[17,17],production:stats(checkerOut),exactLinearLightArea:stats(checkerRef),comparison:compare(checkerOut.data,checkerRef.data)},sharpText:{input:[577,289],output:[97,49],comparison:compare(sharpOut.data,sharpRef.data)},limitation:'Bounded linear-premultiplied anisotropic mip filtering suppresses severe minification aliasing; it is an approximation rather than exact area/EWA integration. Anisotropy above16 is deliberately softened to maintain bounded work; output magnification does not add detail.',files:{}};
for(const name of fs.readdirSync(__dirname).filter(x=>/\.png$/.test(x)))result.files[name]=sha(fs.readFileSync(path.join(__dirname,name)));result.productionCoreSha256=sha(fs.readFileSync(target));result.productionKernel=C.plan(256,256,r(17/256,17/256)).sampling||{filter:'bilinear-baseline'};fs.writeFileSync(path.join(__dirname,'visual-quality-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
