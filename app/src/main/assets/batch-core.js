/* Sequential, bounded batch processing; ZIP STORE with CRC32, UTF8 names. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MintBatch=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';const MAX_BYTES=64*1024*1024,encoder=new TextEncoder();
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function header(size){const b=new Uint8Array(size),v=new DataView(b.buffer);return{b,u16:(p,n)=>v.setUint16(p,n,true),u32:(p,n)=>v.setUint32(p,n,true)};}
function zip(entries){if(!Array.isArray(entries)||!entries.length||entries.length>20)throw Error('批量导出需要1–20份结果');let offset=0,size=0;const chunks=[],central=[];
 for(let i=0;i<entries.length;i++){const e=entries[i];if(!e||!(e.bytes instanceof Uint8Array)||e.bytes.length===0)throw Error('批量输出字节无效');size+=e.bytes.length;if(size>MAX_BYTES)throw Error('批量输出超过64MiB，请减少照片或输出尺寸');const name=encoder.encode(String(i+1).padStart(2,'0')+'-'+String(e.name||'photo.jpg').replace(/[\\/\x00-\x1f:]/g,'_').slice(0,120)),crc=crc32(e.bytes),h=header(30);h.u32(0,0x04034b50);h.u16(4,20);h.u16(6,0x800);h.u16(12,33);h.u32(14,crc);h.u32(18,e.bytes.length);h.u32(22,e.bytes.length);h.u16(26,name.length);chunks.push(h.b,name,e.bytes);
 const c=header(46);c.u32(0,0x02014b50);c.u16(4,20);c.u16(6,20);c.u16(8,0x800);c.u16(14,33);c.u32(16,crc);c.u32(20,e.bytes.length);c.u32(24,e.bytes.length);c.u16(28,name.length);c.u32(42,offset);central.push(c.b,name);offset+=30+name.length+e.bytes.length;
 }const end=header(22),centralSize=central.reduce((n,b)=>n+b.length,0);end.u32(0,0x06054b50);end.u16(8,entries.length);end.u16(10,entries.length);end.u32(12,centralSize);end.u32(16,offset);return new Blob([...chunks,...central,end.b],{type:'application/zip'});
}
async function run(files,process,options={}){if(!Array.isArray(files)||!files.length||files.length>20)throw Error('请选择1–20张照片');if(typeof process!=='function')throw TypeError('批量处理器缺失');let bytes=0;for(const f of files){if(!f||!Number.isSafeInteger(f.size)||f.size<1||f.size>20*1024*1024)throw Error('每张输入需在20MiB以内');bytes+=f.size;}if(bytes>80*1024*1024)throw Error('输入合计最多80MiB');const entries=[],failures=[];let outputBytes=0;
 for(let i=0;i<files.length;i++){if(options.cancelled&&options.cancelled())return{entries:[],failures,cancelled:true};try{const result=await process(files[i],i);if(!(result.bytes instanceof Uint8Array)||!result.bytes.length)throw Error('没有生成有效输出');outputBytes+=result.bytes.length;if(outputBytes>MAX_BYTES)throw Error('批量输出超过64MiB');entries.push(result);}catch(e){failures.push({index:i,name:String(files[i].name),error:String(e.message||e)});if(outputBytes>MAX_BYTES)throw Error('批量输出超过64MiB，请减少照片或输出尺寸');}if(options.progress)options.progress(i+1,files.length);}
 if(options.cancelled&&options.cancelled())return{entries:[],failures,cancelled:true};return{entries,failures,cancelled:false};
}
return Object.freeze({run,zip,crc32});
});
