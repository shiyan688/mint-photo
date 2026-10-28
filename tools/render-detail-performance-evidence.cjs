'use strict';
// Real-photo evidence for a performance-only change. Crops keep one source pixel
// per output pixel; no enlarged detail or aesthetic ground truth is implied.
// node tools/render-detail-performance-evidence.cjs <inference-base> <output-dir> <baseline-dir>
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),base=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),baseline=path.resolve(process.argv[4]);
const D=require('../app/src/main/assets/portrait-detail-engine.js'),G=require('../app/src/main/assets/edge-refine.js'),E=require('../app/src/main/assets/portrait-engine.js'),M=require('../app/src/main/assets/mask-refine.js');
const beforeD=require(path.join(baseline,'portrait-detail-engine.js')),beforeG=require(path.join(baseline,'edge-refine.js'));
const hash=a=>crypto.createHash('sha256').update(a).digest('hex'),bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
function canvas(im){const c=createCanvas(im.width,im.height),ctx=c.getContext('2d'),data=ctx.createImageData(im.width,im.height);data.data.set(im.data);ctx.putImageData(data,0,0);return c;}
function delta(source,result,box){let changed=0,max=0,total=0;for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++){const i=(y*source.width+x)*4;let d=0;for(let k=0;k<3;k++)d=Math.max(d,Math.abs(result.data[i+k]-source.data[i+k]));if(d)changed++;max=Math.max(max,d);total++;}return{pixels:total,changedPixels:changed,maxChannelDelta:max};}
async function main(){
 fs.mkdirSync(out,{recursive:true});const metaBytes=fs.readFileSync(base+'.json'),meta=JSON.parse(metaBytes),encoded=fs.readFileSync(base+'.png'),img=await loadImage(encoded),src=createCanvas(img.width,img.height);src.getContext('2d').drawImage(img,0,0);
 const raw={width:img.width,height:img.height,data:src.getContext('2d').getImageData(0,0,img.width,img.height).data},sourceHash=hash(bytes(raw.data)),landmarks=meta.faces[0];assert(landmarks,'face required');
 const settings={smooth:65,brighten:0,warmth:0},classic=E.beauty(raw,settings,landmarks),old=beforeD.beauty(raw,settings,landmarks),updated=D.beauty(raw,settings,landmarks);assert(bytes(old.data).equals(bytes(updated.data)),'retouch pixels changed');
 const mask=M.rasterize({width:raw.width,height:raw.height},M.defaults('native-real-evidence',meta.mask)),oldMask=beforeG.refine(raw,mask),updatedMask=G.refine(raw,mask);assert(bytes(oldMask.data).equals(bytes(updatedMask.data)),'guided alpha bytes changed');
 const background=m=>E.background(raw,{mask:m,continuousAlpha:true,mode:'color',color:'#b6dada',blur:0,feather:0}),coarse=background(mask),oldCut=background(oldMask),newCut=background(updatedMask);assert(bytes(oldCut.data).equals(bytes(newCut.data)),'cutout pixels changed');
 const images={original:raw,'skin-classic-65':classic,'skin-detail-before':old,'skin-detail-after':updated,'cutout-coarse':coarse,'cutout-guided-before':oldCut,'cutout-guided-after':newCut},outputs={};
 const canvases={};for(const [name,im]of Object.entries(images)){const c=canvas(im),png=c.toBuffer('image/png');canvases[name]=c;fs.writeFileSync(path.join(out,name+'.png'),png);outputs[name]={rgbaSha256:hash(bytes(im.data)),pngSha256:hash(png),dimensions:[im.width,im.height]};}
 const xs=landmarks.map(p=>p.x*raw.width),ys=landmarks.map(p=>p.y*raw.height),l=Math.min(...xs),t=Math.min(...ys),r=Math.max(...xs),b=Math.max(...ys),fw=r-l,fh=b-t;
 function box(x,y,width,height){x=Math.max(0,Math.floor(x));y=Math.max(0,Math.floor(y));return{x,y,width:Math.max(1,Math.min(raw.width-x,Math.ceil(width))),height:Math.max(1,Math.min(raw.height-y,Math.ceil(height)))};}
 const crops={face:box(l-fw*.12,t-fh*.08,fw*1.24,fh*1.55),hair:box(l-fw*.20,t-fh*.35,fw*1.4,fh*.65)};
 const groups={face:['original','skin-classic-65','skin-detail-before','skin-detail-after'],hair:['original','cutout-coarse','cutout-guided-before','cutout-guided-after']};
 const cropFiles={};
 for(const [kind,rect]of Object.entries(crops)){
  const names=groups[kind],sheet=createCanvas(rect.width*names.length,rect.height+36),ctx=sheet.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,sheet.width,sheet.height);ctx.fillStyle='#222';ctx.font='16px sans-serif';
  for(let i=0;i<names.length;i++){const name=names[i],c=createCanvas(rect.width,rect.height);c.getContext('2d').drawImage(canvases[name],rect.x,rect.y,rect.width,rect.height,0,0,rect.width,rect.height);const png=c.toBuffer('image/png'),file=kind+'-100pct-'+name+'.png';fs.writeFileSync(path.join(out,file),png);cropFiles[file]=hash(png);ctx.fillText(name,i*rect.width+8,24);ctx.drawImage(c,i*rect.width,36);}
  fs.writeFileSync(path.join(out,kind+'-100pct-comparison.png'),sheet.toBuffer('image/png'));
 }
 const neck=box((l+r)/2-fw*.2,b+fh*.04,fw*.4,fh*.28);let alphaMismatch=0;for(let i=3;i<raw.data.length;i+=4)if(updated.data[i]!==raw.data[i])alphaMismatch++;
 assert.equal(alphaMismatch,0);assert.equal(hash(bytes(raw.data)),sourceHash);
 const report={source:{originalEncodedSha256:meta.sourceSha256,inferencePngSha256:hash(encoded),rgbaSha256:sourceHash,dimensions:[raw.width,raw.height],originalSize:meta.sourceSize},inference:{sha256:hash(metaBytes),runtime:meta.runtime,newInference:meta.newInference,faceCount:meta.faces.length,faceModelSha256:meta.faceModelSha256,segmentationModelSha256:meta.segmentationModelSha256,maskSize:[meta.mask.width,meta.mask.height]},settings,skinBeforeAfterByteExact:true,guidedBeforeAfterFloat32Exact:true,cutoutBeforeAfterByteExact:true,sourceUnchanged:true,alphaMismatch,crops,neckProbe:{rect:neck,...delta(raw,updated,neck)},faceProbe:delta(raw,updated,crops.face),outputs,cropFiles,
  scope:'Performance-only optimization. Baseline detail-v2 and optimized detail-v2 are pixel identical; no quality improvement claimed. 100% crops preserve source pixels. No alpha ground truth, skin-quality score, physical Android or provider test.'};
 report.coreSha256=Object.fromEntries(['portrait-detail-engine.js','edge-refine.js','portrait-engine.js','mask-refine.js'].map(n=>[n,hash(fs.readFileSync(path.join(root,'app/src/main/assets',n)))]));
 report.baselineCoreSha256=Object.fromEntries(['portrait-detail-engine.js','edge-refine.js'].map(n=>[n,hash(fs.readFileSync(path.join(baseline,n)))]));
 report.toolSha256=hash(fs.readFileSync(__filename));
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({source:report.source,inference:report.inference,neckProbe:report.neckProbe,faceProbe:report.faceProbe,exact:true},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
