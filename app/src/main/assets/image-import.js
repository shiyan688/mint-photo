/* Bounded local still-image importer. No caller-supplied URI, network fetch or metadata persistence. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MintImageImport=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';
const LIMITS=Object.freeze({fileBytes:12*1024*1024,sourcePixels:8000000,sourceEdge:4096,assetPixels:1048576,assetEdge:1024,chunks:4096});
const mimeTypes=Object.freeze(['image/png','image/jpeg','image/webp']);
function check(ok,msg){if(!ok)throw new TypeError(msg);}
function dims(width,height){check(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width<=LIMITS.sourceEdge&&height<=LIMITS.sourceEdge&&width*height<=LIMITS.sourcePixels,'贴图源尺寸超限：最多800万像素、最长边4096');return{width,height};}
function inspect(bytes,mime){
 check(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=LIMITS.fileBytes,'请选择12MiB以内的本地图片');
 check(mimeTypes.includes(mime),'贴图仅支持PNG、JPEG、WebP静态图片');
 const n=bytes.length,u16=p=>bytes[p]*256+bytes[p+1],u32=p=>bytes[p]*16777216+bytes[p+1]*65536+bytes[p+2]*256+bytes[p+3],le16=p=>bytes[p]+256*bytes[p+1],le24=p=>bytes[p]+256*bytes[p+1]+65536*bytes[p+2],le32=p=>bytes[p]+256*bytes[p+1]+65536*bytes[p+2]+16777216*bytes[p+3],tag=p=>String.fromCharCode(bytes[p],bytes[p+1],bytes[p+2],bytes[p+3]);
 let actual,width,height;
 if(n>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)){
  actual='image/png';let p=8,count=0,header=false,idat=false,end=false;
  while(p<n){check(++count<=LIMITS.chunks&&p+12<=n,'PNG块结构无效');const len=u32(p),kind=tag(p+4);check(len<=n-p-12,'PNG块长度无效');const q=p+8;
   check(/^[A-Za-z]{4}$/.test(kind),'PNG块名称无效');
   if(kind==='acTL'||kind==='fcTL'||kind==='fdAT')throw Error('不支持动画PNG，请导出静态PNG后添加');
   if(kind==='IHDR'){check(!header&&p===8&&len===13,'PNG图片头无效');width=u32(q);height=u32(q+4);dims(width,height);check(bytes[q+10]===0&&bytes[q+11]===0&&bytes[q+12]<=1,'PNG图片头参数无效');header=true;}
   else check(header,'PNG缺少图片头');
   if(kind==='IDAT')idat=true;
   if(kind==='IEND'){check(len===0&&idat&&p+12===n,'PNG结束块无效');end=true;}
   if(kind[0]===kind[0].toUpperCase())check(['IHDR','PLTE','IDAT','IEND'].includes(kind),'PNG包含不支持的关键块');
   p+=12+len;
  }
  check(header&&idat&&end,'PNG图片不完整');
 }else if(n>=4&&bytes[0]===255&&bytes[1]===216){
  actual='image/jpeg';let p=2,count=0,frame=false,scan=false,end=false;
  while(p<n){check(++count<=LIMITS.chunks&&bytes[p++]===255,'JPEG标记结构无效');while(p<n&&bytes[p]===255)p++;check(p<n,'JPEG标记截断');const marker=bytes[p++];
   if(marker===217){check(frame&&scan&&p===n,'JPEG结束标记无效或含尾随数据');end=true;break;}
   check(marker!==0&&marker!==216&&marker!==1&&!(marker>=208&&marker<=215),'JPEG图片头标记无效');
   check(p+2<=n,'JPEG块截断');const len=u16(p);check(len>=2&&p+len<=n,'JPEG块长度无效');
   if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
    check([192,193,194].includes(marker)&&!frame&&len>=11,'只支持常见8位静态JPEG');const components=bytes[p+7];check(bytes[p+2]===8&&[1,3,4].includes(components)&&len===8+3*components,'JPEG尺寸头无效');height=u16(p+3);width=u16(p+5);dims(width,height);frame=true;
   }
   if(marker===218){check(frame&&len>=8&&len===6+2*bytes[p+2]&&bytes[p+2]>=1&&bytes[p+2]<=4&&p+len<n,'JPEG缺少有效图像数据');scan=true;p+=len;let terminated=false;
    while(p<n){if(bytes[p]!==255){p++;continue;}const markStart=p;while(p<n&&bytes[p]===255)p++;check(p<n,'JPEG扫描数据截断');const code=bytes[p];if(code===0||(code>=208&&code<=215)){p++;continue;}p=markStart;terminated=true;break;}
    check(terminated,'JPEG扫描数据不完整');
   }else p+=len;
  }
  check(frame&&scan&&end,'JPEG图片不完整');
 }else if(n>=12&&tag(0)==='RIFF'&&tag(8)==='WEBP'){
  actual='image/webp';check(le32(4)+8===n,'WebP容器长度无效');let p=12,count=0,extended=null,frame=null;
  while(p<n){check(++count<=LIMITS.chunks&&p+8<=n,'WebP块结构无效');const kind=tag(p),len=le32(p+4),q=p+8;check(len<=n-q&&q+len+(len%2)<=n,'WebP块长度无效');if(len%2)check(bytes[q+len]===0,'WebP填充无效');
   if(kind==='ANIM'||kind==='ANMF')throw Error('不支持动画WebP，请使用静态图片');
   if(kind==='VP8X'){check(p===12&&len===10&&!extended,'WebP扩展头无效');const flags=bytes[q];check((flags&193)===0&&bytes[q+1]===0&&bytes[q+2]===0&&bytes[q+3]===0,'WebP扩展参数无效');check(!(flags&2),'不支持动画WebP');extended=dims(le24(q+4)+1,le24(q+7)+1);}
   if(kind==='VP8 '){check(!frame&&len>=10&&(bytes[q]&1)===0&&bytes[q+3]===157&&bytes[q+4]===1&&bytes[q+5]===42,'WebP VP8图片头无效');frame=dims(le16(q+6)&16383,le16(q+8)&16383);}
   if(kind==='VP8L'){check(!frame&&len>=5&&bytes[q]===47&&(bytes[q+4]>>5)===0,'WebP无损图片头无效');frame=dims(1+bytes[q+1]+((bytes[q+2]&63)<<8),1+(bytes[q+2]>>6)+(bytes[q+3]<<2)+((bytes[q+4]&15)<<10));}
   p=q+len+(len%2);
  }
  check(frame,'WebP缺少静态图片');if(extended)check(extended.width===frame.width&&extended.height===frame.height,'WebP图片与画布尺寸不一致');({width,height}=frame);
 }else throw Error('文件内容不是支持的PNG、JPEG或WebP图片');
 check(actual===mime,'文件声明格式与内容不一致');return Object.freeze({mime:actual,...dims(width,height),byteLength:n});
}
function canceled(options){if(options.shouldCancel&&options.shouldCancel()){const e=new Error('贴图导入已取消');e.code='IMAGE_IMPORT_CANCELED';throw e;}}
async function importFile(file,options={}){
 check(options&&typeof options==='object','贴图导入选项无效');const B=options.Blob||root.Blob;check(B&&B.prototype,'本机Blob接口不可用');const size=Object.getOwnPropertyDescriptor(B.prototype,'size').get.call(file),mime=Object.getOwnPropertyDescriptor(B.prototype,'type').get.call(file);
 check(size>0&&size<=LIMITS.fileBytes,'请选择12MiB以内的本地图片');check(mimeTypes.includes(mime),'贴图仅支持PNG、JPEG、WebP静态图片');
 const core=options.core||root.MintImageOverlay;check(core&&typeof core.encodeAsset==='function','贴图像素核心未加载');
 const createImage=options.createImage||(()=>new root.Image()),createCanvas=options.createCanvas||((w,h)=>{const c=root.document.createElement('canvas');c.width=w;c.height=h;return c;}),createURL=options.createObjectURL||(b=>root.URL.createObjectURL(b)),revokeURL=options.revokeObjectURL||(u=>root.URL.revokeObjectURL(u));
 let url=null,img=null,c=null;try{
  canceled(options);const ab=await B.prototype.arrayBuffer.call(file);canceled(options);check(ab.byteLength===size,'贴图读取长度发生变化');const preflight=inspect(new Uint8Array(ab),mime);canceled(options);
  url=createURL(file);check(typeof url==='string'&&url.startsWith('blob:'),'贴图仅允许本机Blob地址');img=createImage();check(img&&typeof img==='object','图片解码器不可用');
  await new Promise((resolve,reject)=>{let settled=false;const started=Date.now(),finish=(error)=>{if(settled)return;settled=true;root.clearInterval(timer);error?reject(error):resolve();};const timer=root.setInterval(()=>{try{canceled(options);if(Date.now()-started>15000)throw Error('贴图解码超时，请换一张图片');}catch(error){finish(error);}},50);img.onload=()=>finish();img.onerror=()=>finish(Error('无法解码这张贴图'));try{img.src=url;}catch(error){finish(error);}});canceled(options);
  const width=img.naturalWidth,height=img.naturalHeight;dims(width,height);check(width===preflight.width&&height===preflight.height||mime==='image/jpeg'&&width===preflight.height&&height===preflight.width,'贴图解码尺寸与图片头不一致');
  const scale=Math.min(1,LIMITS.assetEdge/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));check(w*h<=LIMITS.assetPixels,'贴图工作副本超限');canceled(options);
  c=createCanvas(w,h);check(c&&c.width===w&&c.height===h,'贴图画布分配失败');const context=c.getContext('2d',{willReadFrequently:true});check(context,'贴图绘图接口不可用');context.imageSmoothingEnabled=w!==width||h!==height;context.imageSmoothingQuality='high';context.drawImage(img,0,0,w,h);canceled(options);
  const im=context.getImageData(0,0,w,h),asset=core.encodeAsset({width:w,height:h,data:im.data});canceled(options);return {asset,source:{width,height,mime,byteLength:size},resized:w!==width||h!==height};
 }finally{if(img){img.onload=null;img.onerror=null;try{img.src='';}catch(_){}}if(url)revokeURL(url);if(c){c.width=1;c.height=1;}}
}
return Object.freeze({LIMITS,inspect,importFile});
});
