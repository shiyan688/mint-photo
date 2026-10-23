/* Deterministic non-resampling geometry. Crop -> clockwise quarter turns -> output-axis flips. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MintGeometry=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const LIMITS=Object.freeze({maxEdge:32768,maxPixels:67108864,maxMetadataPixels:80000000});
 const typed=Object.getPrototypeOf(Uint8Array.prototype),tagOf=Object.getOwnPropertyDescriptor(typed,Symbol.toStringTag).get,bufferOf=Object.getOwnPropertyDescriptor(typed,'buffer').get,bytesOf=Object.getOwnPropertyDescriptor(typed,'byteLength').get;
 const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k),fail=m=>{throw Error(m);};
 function record(v,keys,label,required=keys){if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail(label+' must be plain data');for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!keys.includes(k)||!d.enumerable||!own(d,'value'))fail(label+' has unsupported fields');}for(const k of required)if(!own(v,k))fail(label+' missing required field '+k);return v;}
 function number(n,a,b,label){if(typeof n!=='number'||!Number.isFinite(n)||n<a||n>b)fail(label+' out of range');return n===0?0:n;}
 function bool(v,label){if(typeof v!=='boolean')fail(label+' must be boolean');return v;}
 function defaults(){return{version:1,crop:{x:0,y:0,w:1,h:1},quarterTurns:0,flipX:false,flipY:false};}
 function validate(value){if(value==null)return defaults();const r=record(value,['version','crop','quarterTurns','flipX','flipY'],'geometry');if(r.version!==1)fail('Unsupported geometry version');const c=record(r.crop,['x','y','w','h'],'crop'),x=number(c.x,0,1,'crop.x'),y=number(c.y,0,1,'crop.y');let w=number(c.w,Number.MIN_VALUE,1,'crop.w'),h=number(c.h,Number.MIN_VALUE,1,'crop.h');if(x>=1||y>=1||x+w>1+1e-12||y+h>1+1e-12)fail('Crop extends beyond source');w=Math.min(w,1-x);h=Math.min(h,1-y);const q=number(r.quarterTurns,0,3,'quarterTurns');if(!Number.isInteger(q))fail('quarterTurns must be integer');return{version:1,crop:{x,y,w,h},quarterTurns:q,flipX:bool(r.flipX,'flipX'),flipY:bool(r.flipY,'flipY')};}
 function isActive(r){r=validate(r);return r.crop.x!==0||r.crop.y!==0||r.crop.w!==1||r.crop.h!==1||r.quarterTurns!==0||r.flipX||r.flipY;}
 function dimensions(width,height,maxPixels=LIMITS.maxMetadataPixels){for(const v of [width,height])if(!Number.isInteger(v)||v<1||v>LIMITS.maxEdge)fail('Geometry dimensions out of range');if(width*height>maxPixels)fail('Geometry pixel budget exceeded');}
 function plan(width,height,recipe){dimensions(width,height);const r=validate(recipe),c=r.crop;
  // Quantize both edges once. Never independently round extent or interpolate fractional pixels.
  const x=Math.max(0,Math.min(width-1,Math.round(c.x*width))),y=Math.max(0,Math.min(height-1,Math.round(c.y*height)));
  const right=Math.max(x+1,Math.min(width,Math.round((c.x+c.w)*width))),bottom=Math.max(y+1,Math.min(height,Math.round((c.y+c.h)*height)));
  const w=right-x,h=bottom-y,odd=r.quarterTurns%2;
  return{sourceSize:{width,height},crop:{x,y,width:w,height:h},outputSize:{width:odd?h:w,height:odd?w:h},quarterTurns:r.quarterTurns,flipX:r.flipX,flipY:r.flipY};
 }
 function cancelled(options){if(options.shouldCancel&&options.shouldCancel())fail('Geometry operation cancelled');}
 function options(value){const o=record(value==null?{}:value,['shouldCancel'],'geometry options',[]);if(own(o,'shouldCancel')&&typeof o.shouldCancel!=='function')fail('shouldCancel must be function');return {shouldCancel:own(o,'shouldCancel')?o.shouldCancel:null};}
 function image(value){record(value,['width','height','data'],'image');dimensions(value.width,value.height,LIMITS.maxPixels);const d=value.data;let tag,buffer,bytes;try{tag=tagOf.call(d);buffer=bufferOf.call(d);bytes=bytesOf.call(d);}catch{}if(!ArrayBuffer.isView(d)||!['Uint8Array','Uint8ClampedArray'].includes(tag)||!(buffer instanceof ArrayBuffer)||bytes!==value.width*value.height*4)fail('Geometry requires exact RGBA8 data');return value;}
 function inverse(p,x,y,edge=false){const c=p.crop,o=p.outputSize,k=edge?0:1;if(p.flipX)x=o.width-k-x;if(p.flipY)y=o.height-k-y;let sx=x,sy=y;switch(p.quarterTurns){case 1:sx=y;sy=c.height-k-x;break;case 2:sx=c.width-k-x;sy=c.height-k-y;break;case 3:sx=c.width-k-y;sy=x;break;}return{x:sx+c.x,y:sy+c.y};}
 function apply(value,recipe,opts){const opt=options(opts);cancelled(opt);const im=image(value),p=plan(im.width,im.height,recipe),w=p.outputSize.width,h=p.outputSize.height,out=new Uint8ClampedArray(w*h*4),source=im.data;
  const first=inverse(p,0,0),next=inverse(p,1,0),step=((next.y-first.y)*im.width+next.x-first.x)*4;
  for(let y=0;y<h;y++){if(y%16===0)cancelled(opt);const s=inverse(p,0,y);let a=(s.y*im.width+s.x)*4,b=y*w*4;for(let x=0;x<w;x++,a+=step,b+=4){out[b]=source[a];out[b+1]=source[a+1];out[b+2]=source[a+2];out[b+3]=source[a+3];}}cancelled(opt);return{width:w,height:h,data:out};
 }
 function mapped(width,height,recipe,point,direction,edge){const p=plan(width,height,recipe),k=edge?0:1;record(point,['x','y'],'point');const x=number(point.x,-LIMITS.maxEdge,LIMITS.maxEdge,'point.x'),y=number(point.y,-LIMITS.maxEdge,LIMITS.maxEdge,'point.y');if(direction==='inverse'){if(x<0||y<0||x>p.outputSize.width-k||y>p.outputSize.height-k)return null;return inverse(p,x,y,edge);}if(direction!=='forward')fail('Unknown point direction');const c=p.crop;let sx=x-c.x,sy=y-c.y;if(sx<0||sy<0||sx>c.width-k||sy>c.height-k)return null;let dx=sx,dy=sy;switch(p.quarterTurns){case 1:dx=c.height-k-sy;dy=sx;break;case 2:dx=c.width-k-sx;dy=c.height-k-sy;break;case 3:dx=sy;dy=c.width-k-sx;break;}if(p.flipX)dx=p.outputSize.width-k-dx;if(p.flipY)dy=p.outputSize.height-k-dy;return{x:dx,y:dy};}
 function mapPoint(width,height,recipe,point,direction='forward'){return mapped(width,height,recipe,point,direction,false);}
 function mapEdgePoint(width,height,recipe,point,direction='forward'){return mapped(width,height,recipe,point,direction,true);}

 return Object.freeze({version:'1.0.0',LIMITS,defaults,validate,isActive,plan,apply,mapPoint,mapEdgePoint});
});
