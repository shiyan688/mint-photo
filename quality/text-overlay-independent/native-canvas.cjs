'use strict';
// Native Canvas adapter only, no production renderer is substituted.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createCanvas,Image,GlobalFonts}=require('@napi-rs/canvas');
const font=process.env.MINT_TEST_FONT || '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
// Pin generic sans only inside this native test process; browser font fallback
// is platform-dependent and is not emulated by this installed native engine.
assert(GlobalFonts.registerFromPath(font,'sans-serif'),'Installed CJK test font failed to register; set MINT_TEST_FONT to NotoSansCJK-Regular.ttc');
const allocated=[];
function canvas(width=1,height=1,io=null){
 const native=createCanvas(Math.max(1,width),Math.max(1,height)),target=native.getContext('2d'),resizes=[],draws=[];
 const c={_native:native,resizes,draws};
 for(const key of ['width','height'])Object.defineProperty(c,key,{enumerable:true,configurable:true,get(){return native[key];},set(value){resizes.push([key,value]);native[key]=value;}});
 // This installed Skia wrapper respects CTM in putImageData, unlike browsers.
 // Isolate that known library difference in test infrastructure, explicitly.
 const put=target.putImageData.bind(target),draw=target.drawImage.bind(target);
 const ctx=new Proxy(target,{get(object,key){if(key==='drawImage')return(source,...args)=>{draws.push([source,...args]);return draw(source._native||source.__native||source,...args);};if(key==='putImageData')return(...args)=>{object.save();object.resetTransform();try{return put(...args);}finally{object.restore();}};const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;},set(object,key,value){return Reflect.set(object,key,value,object);}});
 c.getContext=()=>ctx;c.toDataURL=(...args)=>native.toDataURL(...args);c.toBuffer=(...args)=>native.toBuffer(...args);
 c.toBlob=(callback,type='image/png',quality=.94)=>{const request={width:c.width,height:c.height,type,quality,pixels:Buffer.from(pixels(c))};if(io)io.encodes.push(request);const finish=async()=>{if(io?.settings.encodeFail)return callback(null);try{const bytes=native.toBuffer(type,type==='image/jpeg'?Math.round(quality*100):undefined);request.bytes=bytes;const blob=new Blob([bytes],{type});request.blob=blob;if(io)io.descriptors.set(blob,{width:request.width,height:request.height,image:await decode(bytes)});callback(blob);}catch(_){callback(null);}};if(io?.settings.deferEncode)io.pendingEncodes.push(finish);else queueMicrotask(finish);};
 allocated.push(c);return c;
}
function pixels(c){return c.getContext('2d').getImageData(0,0,c.width,c.height).data;}
function hash(c){return crypto.createHash('sha256').update(pixels(c)).digest('hex');}
async function decode(bytes){const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=bytes;});assert(image.width>0&&image.height>0,'Native PNG decode failed');return image;}
function fixture(width=384,height=288,alpha=false){const c=canvas(width,height),ctx=c.getContext('2d'),im=ctx.createImageData(width,height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=alpha?(x<width/4?0:x<width/2?128:255):255;im.data.set([35+Math.floor(100*x/width),55+Math.floor(60*y/height),65+((x+y)%39),a],(y*width+x)*4);}ctx.putImageData(im,0,0);return c;}
function copy(source){const c=canvas(source.width,source.height);c.getContext('2d').drawImage(source,0,0);return c;}
module.exports={canvas,pixels,hash,decode,fixture,copy,allocated,font};
