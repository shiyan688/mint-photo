/* Offline texture-patch repair. Classical, not learned inpainting.
 * Coordinates are normalized in the current full original-resolution replay space.
 * Each stroke reads an immutable raster snapshot; neither image nor command mutates.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RepairBrushCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MAX_PIXELS=16777216,MAX_POINTS=2048;
 const OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
 const FEATURES=[[33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],[263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466],[61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185],[70,63,105,66,107,55,65,52,53,46],[336,296,334,293,300,276,283,282,295,285]];
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function fail(message){throw new RangeError(message);}
 function number(n,a,b,label){if(typeof n!=='number'||!Number.isFinite(n)||n<a||n>b)fail(label+'超出范围');return n;}
 function fields(v,keys,label){
  if(!v||typeof v!=='object'||Array.isArray(v))fail(label+'格式无效');
  const proto=Object.getPrototypeOf(v),ctor=proto&&Object.getOwnPropertyDescriptor(proto,'constructor');
  if(proto!==null&&(Object.getPrototypeOf(proto)!==null||!ctor||typeof ctor.value!=='function'||Function.prototype.toString.call(ctor.value)!=='function Object() { [native code] }'))fail(label+'必须是普通数据对象');
  for(const key of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||!keys.includes(key)||!d.enumerable||!Object.prototype.hasOwnProperty.call(d,'value'))fail(label+'不能包含未知字段、访问器或隐藏字段');}
 }
 function arrayData(value,max,label){if(!Array.isArray(value)||!value.length||value.length>max)fail(label+'数量无效');for(const key of Reflect.ownKeys(value)){if(key==='length')continue;const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!/^\d+$/.test(key)||String(+key)!==key||+key>=value.length||!d.enumerable||!Object.prototype.hasOwnProperty.call(d,'value'))fail(label+'必须是普通数组数据');}for(let i=0;i<value.length;i++)if(!Object.prototype.hasOwnProperty.call(value,i))fail(label+'不允许空槽');}

 function pt(p){fields(p,['x','y'],'笔划坐标');return{x:number(p.x,0,1,'横坐标'),y:number(p.y,0,1,'纵坐标')};}
 function revision(v){if(typeof v==='string'&&v.length>0&&v.length<=160&&!/[\u0000-\u001f\u007f]/.test(v))return v;fail('原图版本标记无效');}
 function selectionRecipe(value,sourceRevision,manualTools){
  if(value==null)return null;
  let shared=manualTools||(typeof globalThis!=='undefined'&&globalThis.MintManualTools);
  if(!shared&&typeof require==='function'){for(const file of ['./manual-tools.js','./manual-tools.cjs']){try{shared=require(file);break;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}}}
  if(!shared||typeof shared.validateSelection!=='function')fail('选区核心缺失，不能忽略或猜测选区');
  return shared.validateSelection(value,{sourceRevision});
 }
 function validate(command,options={}){
  const allowUnresolved=options.allowUnresolved===true;
  fields(command,['version','type','mode','sourceRevision','radius','hardness','strength','points','source','sampleMode','selection','landmarks'],'修补笔划');
  if(command.version!==1||command.type!=='repair-stroke'||!['heal','clone'].includes(command.mode))fail('修补笔划版本或模式无效');
  if(!Array.isArray(command.points)||!command.points.length||command.points.length>MAX_POINTS)fail('每笔需要1–2048个点');arrayData(command.points,MAX_POINTS,'笔划点');
  const out={version:1,type:'repair-stroke',mode:command.mode,sourceRevision:revision(command.sourceRevision),radius:number(command.radius,.003,.08,'半径'),hardness:number(command.hardness,0,1,'硬度'),strength:number(command.strength,0,1,'强度'),points:Array.prototype.map.call(command.points,pt),sampleMode:command.sampleMode||'manual'};
  if(!['manual','automatic'].includes(out.sampleMode)||out.mode==='clone'&&out.sampleMode!=='manual')fail('仿制图章必须手动取样');
  if(command.source!==undefined&&command.source!==null)out.source=pt(command.source);else if(!allowUnresolved||out.mode==='clone'||out.sampleMode!=='automatic')fail('请先手动选择取样点');
  // Recipe validation belongs to the shared selection rasterizer. Never execute a recipe here.
  if(options.sourceRevision!==undefined&&options.sourceRevision!==out.sourceRevision)fail('笔划绑定的原图版本已变化');
  if(command.selection!==undefined)out.selection=selectionRecipe(command.selection,out.sourceRevision,options.manualTools);
  if(command.landmarks!==undefined){if(!Array.isArray(command.landmarks)||![468,478].includes(command.landmarks.length))fail('自动取样需要完整关键点');arrayData(command.landmarks,478,'人脸关键点');out.landmarks=Array.prototype.map.call(command.landmarks,p=>{fields(p,['x','y','z'],'人脸关键点');const q={x:number(p.x,-4,4,'关键点横坐标'),y:number(p.y,-4,4,'关键点纵坐标')};if(p.z!==undefined)q.z=number(p.z,-10,10,'关键点深度');return q;});}
  if(out.sampleMode==='automatic'&&!allowUnresolved&&!out.landmarks)fail('自动修补缺少保存的人脸保护范围');
  return out;
 }
 function validateImage(image){if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width*image.height>MAX_PIXELS||!(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray)||image.data.length!==image.width*image.height*4)fail('需要完整RGBA图像，最多1600万像素');}
 function selectionData(image,c,options){if(options.sourceRevision!==undefined&&options.sourceRevision!==c.sourceRevision)fail('笔划绑定的原图版本已变化');const s=options.selection;
  if(s==null){if(c.selection!=null)fail('保存的选区必须按输出尺寸重新栅格化');return null;}
  if(s.width!==image.width||s.height!==image.height||s.space!=='original-pixels'||s.sourceRevision!==c.sourceRevision||!(s.data instanceof Float32Array)||s.data.length!==image.width*image.height)fail('选区尺寸、坐标空间或原图版本不匹配');
  for(const v of s.data)if(!Number.isFinite(v)||v<0||v>1)fail('选区权重必须是有限的0–1');return s.data;
 }
 function copy(image){return{width:image.width,height:image.height,data:new Uint8ClampedArray(image.data)};}
 // Conservative continuous-space bounds do not depend on preview pixel count.
 // Fixed pixel floors below remain allocation safeguards, never extra editing scope.
 function normalizedBudget(image,c){
  const short=Math.min(image.width,image.height),w=image.width/short,h=image.height/short,r=c.radius;
  const p=c.points.map(q=>({x:q.x*w,y:q.y*h}));let length=0;
  for(let i=1;i<p.length;i++)length+=Math.hypot(p[i].x-p[i-1].x,p[i].y-p[i-1].y);
  if(length>r*12+1e-12)fail('本笔范围过大，请分成短笔');
  const xs=p.map(q=>q.x),ys=p.map(q=>q.y),area=w*h;
  const box=(Math.max(...xs)-Math.min(...xs)+2*r)*(Math.max(...ys)-Math.min(...ys)+2*r)/area;
  const swept=(2*r*length+Math.PI*r*r)/area;
  // Ignore overlap and selection reductions deliberately: preview acceptance must
  // not rely on low-resolution quantization or clipping that disappears at export.
  if(box>.08+1e-12||swept>.04+1e-12)fail('本笔面积过大，请缩小笔刷或分成短笔；预览与原图使用同一预算');
 }
 function geometry(image,c){normalizedBudget(image,c);const w=image.width,h=image.height,r=Math.max(.75,c.radius*Math.min(w,h)),raw=c.points.map(p=>({x:p.x*(w-1),y:p.y*(h-1)})),points=[raw[0]],spacing=Math.max(.5,r*.3);let length=0,next=spacing;
  // Uniform arc-length sampling, independent of pointer event density.
  for(let i=1;i<raw.length;i++){const a=raw[i-1],b=raw[i],d=Math.hypot(b.x-a.x,b.y-a.y);if(length+d>r*12)fail('本笔范围过大，请分成短笔');if(d>0){while(next<=length+d+1e-9){const t=clamp((next-length)/d,0,1);points.push({x:Math.round((a.x+(b.x-a.x)*t)*1e9)/1e9,y:Math.round((a.y+(b.y-a.y)*t)*1e9)/1e9});next+=spacing;}}length+=d;}
  const last=raw[raw.length-1];if(Math.hypot(last.x-points[points.length-1].x,last.y-points[points.length-1].y)>1e-6)points.push(last);
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),left=Math.max(0,Math.floor(Math.min(...xs)-r)),top=Math.max(0,Math.floor(Math.min(...ys)-r)),right=Math.min(w-1,Math.ceil(Math.max(...xs)+r)),bottom=Math.min(h-1,Math.ceil(Math.max(...ys)+r));
  const rw=right-left+1,rh=bottom-top+1;if(rw*rh>Math.max(4096,w*h*.085))fail('本笔面积过大；此工具不替代大块内容生成');
  return{w,h,r,points,left,top,right,bottom,rw,rh};
 }
 function coverage(g,hardness,selected){const weights=new Float32Array(g.rw*g.rh);let touched=0;
  for(const p of g.points){const x0=Math.max(g.left,Math.floor(p.x-g.r)),x1=Math.min(g.right,Math.ceil(p.x+g.r)),y0=Math.max(g.top,Math.floor(p.y-g.r)),y1=Math.min(g.bottom,Math.ceil(p.y+g.r));
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const d=Math.hypot(x-p.x,y-p.y)/g.r;if(d>=1)continue;const t=hardness>=1?1:clamp((1-d)/(1-hardness),0,1),weight=t*t*(3-2*t),k=(y-g.top)*g.rw+x-g.left;if(weight>weights[k])weights[k]=weight;}}
  for(let y=g.top;y<=g.bottom;y++)for(let x=g.left;x<=g.right;x++){const k=(y-g.top)*g.rw+x-g.left;if(selected)weights[k]*=selected[y*g.w+x];if(weights[k]>0)touched++;}
  if(touched>Math.max(1024,g.w*g.h*.045))fail('本笔覆盖超过照片4.5%，请分开修补小瑕疵');return{weights,touched};
 }
 function pixel(data,w,h,x,y,k){x=clamp(x,0,w-1);y=clamp(y,0,h-1);const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,j=(iy*w+ix)*4+k,jx=(iy*w+Math.min(w-1,ix+1))*4+k,jy=(Math.min(h-1,iy+1)*w+ix)*4+k,jxy=(Math.min(h-1,iy+1)*w+Math.min(w-1,ix+1))*4+k;return data[j]*(1-fx)*(1-fy)+data[jx]*fx*(1-fy)+data[jy]*(1-fx)*fy+data[jxy]*fx*fy;}
 function offset(g,c){return{dx:c.source.x*(g.w-1)-g.points[0].x,dy:c.source.y*(g.h-1)-g.points[0].y};}
 function activeAt(g,weights,x,y){const ix=Math.round(x),iy=Math.round(y);return ix>=g.left&&ix<=g.right&&iy>=g.top&&iy<=g.bottom?weights[(iy-g.top)*g.rw+ix-g.left]:0;}
 function ensureDonor(image,g,c,weights){const{dx,dy}=offset(g,c);let n=0;
  for(let y=g.top;y<=g.bottom;y++)for(let x=g.left;x<=g.right;x++){if(!weights[(y-g.top)*g.rw+x-g.left]||image.data[(y*g.w+x)*4+3]===0)continue;const sx=x+dx,sy=y+dy;
   if(sx<0||sx>g.w-1||sy<0||sy>g.h-1||pixel(image.data,g.w,g.h,sx,sy,3)<254.9)fail('整个取样区域必须位于照片内且不透明，请重新取样');
   if(c.mode==='heal'&&activeAt(g,weights,sx,sy)>0)fail('修复取样与待修区域重叠，请移动取样点');n++;}
  return{dx,dy,n};
 }
 function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
 function distanceToEdges(p,poly){let min=Infinity;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);min=Math.min(min,Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy));}return min;}
 function faceGeometry(lm,g){if(!Array.isArray(lm)||![468,478].includes(lm.length))fail('自动取样需要清晰人脸定位；也可手动选择取样点');const points=lm.map(p=>{if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))fail('人脸关键点无效');return{x:p.x*(g.w-1),y:p.y*(g.h-1)};});return{oval:OVAL.map(i=>points[i]),features:FEATURES.map(f=>f.map(i=>points[i]))};}
 function safeFace(p,face,pad){return inside(p,face.oval)&&distanceToEdges(p,face.oval)>pad&&!face.features.some(f=>inside(p,f)||distanceToEdges(p,f)<pad);}
 function checkFaceFootprint(g,c,face,withDonor){if(g.points.some(p=>!safeFace(p,face,g.r*1.6)))fail('自动修复不能覆盖眼眉唇、面部边界或其校准范围；请缩小笔刷或手动取样');if(withDonor){const{dx,dy}=offset(g,c);if(g.points.some(p=>!safeFace({x:p.x+dx,y:p.y+dy},face,g.r*1.6)))fail('自动取样覆盖受保护结构，请重新取样');}}
 function resolveSource(image,command,options={}){
  cancelled(options);validateImage(image);const c=validate(command,{...options,allowUnresolved:true}),selected=selectionData(image,c,options),g=geometry(image,c),{weights,touched}=coverage(g,c.hardness,selected);let face=null;if(c.sampleMode==='automatic'){const landmarks=c.landmarks||options.landmarks;face=faceGeometry(landmarks,g);c.landmarks=landmarks.map(p=>({x:p.x,y:p.y,...(p.z===undefined?{}:{z:p.z})}));checkFaceFootprint(g,c,face,!!c.source);}if(c.source){ensureDonor(image,g,c,weights);return validate(c,options);}
  if(!touched)fail('笔划不在选区内，没有可修复区域');let best=null,bestScore=Infinity;
  // The entire swept donor footprint, not just its center, stays inside face skin.
  for(const scale of [2.8,3.4,4.4,5.5])for(let angle=0;angle<16;angle++){cancelled(options);
   const dx=Math.cos(angle*Math.PI/8)*g.r*scale,dy=Math.sin(angle*Math.PI/8)*g.r*scale;
   if(g.points.some(p=>!safeFace({x:p.x+dx,y:p.y+dy},face,g.r*1.6)||g.points.some(q=>Math.hypot(p.x+dx-q.x,p.y+dy-q.y)<g.r*2.6)))continue;
   const candidate={...c,source:{x:(g.points[0].x+dx)/(g.w-1),y:(g.points[0].y+dy)/(g.h-1)}};if(candidate.source.x<0||candidate.source.x>1||candidate.source.y<0||candidate.source.y>1)continue;
   let score=0,n=0;for(const p of [g.points[0],g.points[Math.floor(g.points.length/2)],g.points[g.points.length-1]])for(let a=0;a<12;a++){const x=p.x+Math.cos(a*Math.PI/6)*g.r*1.4,y=p.y+Math.sin(a*Math.PI/6)*g.r*1.4;if(x<0||y<0||x>=g.w||y>=g.h)continue;for(let k=0;k<3;k++){const v=pixel(image.data,g.w,g.h,x,y,k)-pixel(image.data,g.w,g.h,x+dx,y+dy,k);score+=v*v;}n++;}
   score=score/Math.max(1,n)+scale*3;if(score<bestScore){try{ensureDonor(image,g,candidate,weights);best=candidate;bestScore=score;}catch(_){}}
  }
  if(!best||bestScore>9000)fail('未找到安全且颜色接近的皮肤纹理，请手动取样或缩小笔刷');return validate(best,options);
 }
 function solve3(matrix,vector){const m=matrix.map((r,i)=>[...r,vector[i]]);for(let col=0;col<3;col++){let pivot=col;for(let row=col+1;row<3;row++)if(Math.abs(m[row][col])>Math.abs(m[pivot][col]))pivot=row;if(Math.abs(m[pivot][col])<1e-8)return[vector[0]/Math.max(1,matrix[0][0]),0,0];[m[col],m[pivot]]=[m[pivot],m[col]];const d=m[col][col];for(let j=col;j<4;j++)m[col][j]/=d;for(let row=0;row<3;row++)if(row!==col){const f=m[row][col];for(let j=col;j<4;j++)m[row][j]-=f*m[col][j];}}return m.map(r=>r[3]);}
 function colorPlane(image,g,weights,dx,dy){const center=g.points[Math.floor(g.points.length/2)],matrix=[[0,0,0],[0,0,0],[0,0,0]],v=[[0,0,0],[0,0,0],[0,0,0]];let n=0;
  const stride=Math.max(1,Math.floor(g.points.length/20));for(let i=0;i<g.points.length;i+=stride){const p=g.points[i];for(let a=0;a<24;a++){const x=p.x+Math.cos(a*Math.PI/12)*g.r*1.45,y=p.y+Math.sin(a*Math.PI/12)*g.r*1.45,sx=x+dx,sy=y+dy;
   if(x<0||y<0||x>g.w-1||y>g.h-1||sx<0||sy<0||sx>g.w-1||sy>g.h-1||activeAt(g,weights,x,y)>0||activeAt(g,weights,sx,sy)>0||pixel(image.data,g.w,g.h,x,y,3)<254.9||pixel(image.data,g.w,g.h,sx,sy,3)<254.9)continue;
   const q=[1,(x-center.x)/g.r,(y-center.y)/g.r];for(let j=0;j<3;j++)for(let k=0;k<3;k++)matrix[j][k]+=q[j]*q[k];for(let channel=0;channel<3;channel++){const d=pixel(image.data,g.w,g.h,x,y,channel)-pixel(image.data,g.w,g.h,sx,sy,channel);for(let j=0;j<3;j++)v[channel][j]+=q[j]*d;}n++;}}
  if(n<12)fail('周边有效颜色不足，请缩小笔刷或改用仿制图章');const fit=v.map(x=>solve3(matrix,x));if(fit.some(x=>Math.abs(x[0])>70))fail('取样区色差过大，请重新选择相近皮肤');return{center,fit};
 }
 function cancelled(options){if(options.shouldCancel&&options.shouldCancel()){const error=new Error('修补已取消');error.name='AbortError';throw error;}}
 function apply(image,command,options={}){cancelled(options);validateImage(image);const c=validate(command,options),selected=selectionData(image,c,options),g=geometry(image,c),out=copy(image);if(c.strength===0)return out;const{weights,touched}=coverage(g,c.hardness,selected);if(!touched)return out;if(c.sampleMode==='automatic')checkFaceFootprint(g,c,faceGeometry(c.landmarks,g),true);
  const{dx,dy}=ensureDonor(image,g,c,weights),plane=c.mode==='heal'?colorPlane(image,g,weights,dx,dy):null;
  for(let y=g.top;y<=g.bottom;y++){cancelled(options);for(let x=g.left;x<=g.right;x++){const weight=weights[(y-g.top)*g.rw+x-g.left]*c.strength,j=(y*g.w+x)*4;if(!weight||image.data[j+3]===0)continue;
   for(let k=0;k<3;k++){let donor=pixel(image.data,g.w,g.h,x+dx,y+dy,k);if(plane){const f=plane.fit[k];donor+=clamp(f[0]+f[1]*(x-plane.center.x)/g.r+f[2]*(y-plane.center.y)/g.r,-70,70);}out.data[j+k]=clamp(Math.round(image.data[j+k]*(1-weight)+clamp(donor,0,255)*weight),0,255);}}}
  return out;
 }
 return Object.freeze({validate,resolveSource,apply,capabilities:Object.freeze({version:1,implementation:'immutable-texture-patch-v1',learned:false,modes:['heal','clone'],sourcePolicy:'snapshot-before-each-stroke',crossStrokeAlignment:'restart-at-sample',maxPixels:MAX_PIXELS,maxPoints:MAX_POINTS,strokeBudget:'resolution-independent-conservative-v2'})});
});
