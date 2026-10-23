'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir='../app/src/main/assets/',B=require(dir+'project-backup.js'),P=require(dir+'project-core.js'),L=require(dir+'project-library.js'),I=require(dir+'image-overlay.js');
const codec=B.createCodec({projectCore:P,projectLibrary:L});
const fixtures={
 png:'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGOUnV7GwMDAwMDAxAADABTXAS7W8w7WAAAAAElFTkSuQmCC',
 jpeg:'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDOooorQ+LP/9k=',
 webp:'UklGRjQAAABXRUJQVlA4ICgAAABwAQCdASoDAAIAAUAmJaACdAGIQAD+6V4UV/6yv//mV//8yv93YAAA'
};
const source=(kind='png')=>new Blob([Buffer.from(fixtures[kind],'base64')],{type:'image/'+kind});
const record=(kind='png',ops=[],redo=[])=>P.makeProject({blob:source(kind),name:'私有照片.'+kind,width:3,height:2,mime:'image/'+kind,origin:'original'},ops,redo);
const clone=x=>structuredClone(x),digest=b=>crypto.createHash('sha256').update(b).digest();
function wire(r=record()){const o=clone(r);if(o.version===2)o.source.blob=null;else o.blob=null;return{format:'mint-photo-project',version:1,name:'项目测试',record:o};}
async function packed(manifest,photo=source()){
 const m=Buffer.isBuffer(manifest)?manifest:Buffer.from(typeof manifest==='string'?manifest:JSON.stringify(manifest)),s=Buffer.from(await photo.arrayBuffer()),h=Buffer.alloc(80);
 h.write('MINTPRJ1');h.writeUInt32LE(m.length,8);h.writeUInt32LE(s.length,12);digest(m).copy(h,16);digest(s).copy(h,48);return new Blob([h,m,s]);
}
async function altered(blob,change){const b=Buffer.from(await blob.arrayBuffer());change(b);return new Blob([b]);}
const reject=async(p,code)=>{await assert.rejects(p,e=>code?e.code===code:true);};

test('SHA256 standard vectors and random block/chunk edges agree with Node crypto',async()=>{
 for(const s of ['', 'abc','abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq','a'.repeat(1000000)])assert.equal(await B.sha256Blob(new Blob([s])),digest(s).toString('hex'));
 for(const n of [1,55,56,57,63,64,65,127,128,129,65535,65536,1048575,1048576,1048577,2097161]){const b=crypto.randomBytes(n);assert.equal(await B.sha256Blob(new Blob([b])),digest(b).toString('hex'));}
});
test('v2 source bytes, ordered history and redo roundtrip with known binary layout',async()=>{
 const input=record('png',[{type:'crop',x:0,y:0,w:.5,h:1},{type:'rotate'}],[{type:'filter',id:'warm'}]),before=clone(input),file=await codec.encode(input,{name:'  薄荷🌿  '}),out=await codec.decode(file);
 assert.equal(file.type,B.MIME);assert.equal(B.EXTENSION,'.mintproject');assert.equal(out.name,'薄荷🌿');assert.deepEqual(out.record,input);assert.deepEqual(input,before);assert.notEqual(out.record,input);assert.notEqual(out.record.source.blob,input.source.blob);
 const raw=Buffer.from(await file.arrayBuffer()),head=B.inspectHeader(new Uint8Array(raw.subarray(0,80)),raw.length);assert.equal(raw.subarray(0,8).toString(),'MINTPRJ1');assert.equal(head.sourceSha256,digest(Buffer.from(await source().arrayBuffer())).toString('hex'));assert.equal(head.manifestSha256,out.manifestSha256);assert.equal(raw.readUInt32LE(8),head.manifestLength);assert.equal(JSON.parse(raw.subarray(80,80+head.manifestLength)).record.source.blob,null);
 out.record.ops[0].w=.75;assert.equal(input.ops[0].w,.5);
});
test('all supported image types roundtrip, with JPEG orientation swap only',async()=>{
 for(const kind of ['png','jpeg','webp']){const r=record(kind),out=await codec.decode(await codec.encode(r,{name:kind}));assert.deepEqual(Buffer.from(await out.record.source.blob.arrayBuffer()),Buffer.from(await r.source.blob.arrayBuffer()));assert.equal(out.record.source.blob.type,'image/'+kind);}
 const j=record('jpeg');Object.assign(j.source,{width:2,height:3});assert.deepEqual((await codec.decode(await codec.encode(j,{name:'旋转JPEG'}))).record.source.width,2);
 const p=record();Object.assign(p.source,{width:2,height:3});await reject(codec.encode(p,{name:'不匹配'}),'IMAGE_DIMENSIONS');
});
test('legacy v1 is preserved until actual image decode and never gains original provenance',async()=>{
 const r={version:1,blob:source(),name:'旧工作副本',ops:[{type:'rotate'}],redo:[{type:'flip',axis:'x'}]},out=await codec.decode(await codec.encode(r,{name:'旧版'}));assert.equal(out.record.version,1);assert.equal(out.record.source,undefined);assert.deepEqual(out.record,r);assert.equal(P.restoreProject(out.record,{width:3,height:2}).source.origin,'legacy-working-copy');
 const minimal={version:1,blob:source()},m=await codec.decode(await codec.encode(minimal,{name:'极旧'}));assert.equal(m.record.name,'照片');assert.deepEqual(m.record.ops,[]);assert.deepEqual(m.record.redo,[]);assert.deepEqual(Object.keys(minimal),['version','blob']);
});
test('real bundled photo preserves complete encoded original without re-encoding',async()=>{
 const bytes=fs.readFileSync(path.join(__dirname,dir,'demo/astronaut.png')),r=P.makeProject({blob:new Blob([bytes],{type:'image/png'}),name:'astronaut.png',width:512,height:512,mime:'image/png'}),out=await codec.decode(await codec.encode(r,{name:'演示照片'}));assert.deepEqual(Buffer.from(await out.record.source.blob.arrayBuffer()),bytes);
});
test('masks, embedded RGBA, mesh and per-person context remain in project history',async()=>{
 const asset=I.encodeAsset({width:2,height:2,data:new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,0,255,255,0,128])}),mesh=Array.from({length:478},()=>({x:.5,y:.5,z:0})),ops=[
 {type:'background',mask:{width:2,height:2,data:'AP9/gA=='},mode:'color',color:'#dcebf1',blur:18,feather:2,valid:true},
 {type:'beauty',values:{smooth:5},landmarks:mesh,region:null},
 {type:'image-overlay',action:'add',id:'img-a',asset,recipe:I.defaults()}];
 const detection=require('./fixtures/people-two-detection.json'),D=require(dir+'face-detection.js'),batch=D.decode(clone(detection),{sourceRevision:'snapshot:7',batchId:'batch:one',width:900,height:500});ops.push({type:'portrait-people',phase:'beauty',batch});
 const r=record('png',ops,[{type:'filter',id:'film'}]),out=await codec.decode(await codec.encode(r,{name:'含私有编辑数据'}));assert.deepEqual(out.record.ops,r.ops);assert.deepEqual(out.record.redo,r.redo);assert(out.record.ops[1].landmarks);assert.equal(out.record.ops[2].asset.data,asset.data);
});
test('synchronous snapshot prevents in-flight caller mutation of history/name/source',async()=>{
 const r=record('png',[{type:'adjust',values:{brightness:2}}]),p=codec.encode(r,{name:'快照'});r.ops[0].values.brightness=90;r.source.name='后来名字';r.source.blob=new Blob(['changed']);const out=await codec.decode(await p);assert.equal(out.record.ops[0].values.brightness,2);assert.equal(out.record.source.name,'私有照片.png');assert.equal(out.record.source.blob.size,source().size);
});
test('native Blob instance overrides cannot execute size/slice/arrayBuffer getters',async()=>{
 const r=record();let calls=0;for(const key of ['size','type','slice','arrayBuffer'])Object.defineProperty(r.source.blob,key,{get(){calls++;throw Error('must not execute');}});await codec.encode(r,{name:'本机读取'});assert.equal(calls,0);
});
test('export rejects own accessors, unsafe prototypes, hidden/symbol fields and cycles before reading',async()=>{
 let reads=0;const cases=[];const a=record();Object.defineProperty(a.source,'width',{enumerable:true,get(){reads++;return 3;}});cases.push(a);
 const b=record();Object.defineProperty(b,'hidden',{value:'secret'});cases.push(b);
 const c=record();c[Symbol('extra')]=1;cases.push(c);
 const d=record();d.ops=Object.assign([],{extra:1});cases.push(d);
 const e=record();e.ops=Array(1);cases.push(e);
 const f=record();f.source=Object.create(f.source);cases.push(f);
 const g=record();g.ops.push(g);cases.push(g);
 const h=record();h.ops=[{type:'adjust',values:{brightness:NaN}}];cases.push(h);
 const i=record();i.source.blob={size:10,type:'image/png'};cases.push(i);
 for(const r of cases)await reject(codec.encode(r,{name:'拒绝'}));assert.equal(reads,0);
});
test('unknown top/source/nested fields cannot be silently discarded by ProjectCore',async()=>{
 for(const change of [r=>r.when=42,r=>r.source.uri='file:///secret',r=>r.ops.push({type:'beauty',values:{},landmarks:null,region:{x:.5,y:.5,r:.1,secret:'x'}}),r=>r.ops.push({type:'crop',x:0,y:0,w:1,h:1,url:'https://example.com'})]){const r=record();change(r);await reject(codec.encode(r,{name:'隐藏字段'}));}
 const r={version:1,blob:source(),name:'旧',ops:[],redo:[],when:42};await reject(codec.encode(r,{name:'旧元数据'}));
});
test('header rejects bad magic, short/oversized lengths, extra and truncated bytes',async()=>{
 const file=await codec.encode(record(),{name:'头测试'});
 for(const change of [b=>b[0]=0,b=>b.writeUInt32LE(0,8),b=>b.writeUInt32LE(24*1024*1024+1,8),b=>b.writeUInt32LE(0,12),b=>b.writeUInt32LE(40*1024*1024+1,12),b=>b.writeUInt32LE(0xffffffff,12)])await reject(codec.decode(await altered(file,change)));
 for(const invalid of [file.slice(0,79),file.slice(0,file.size-1),new Blob([file,'x']),new Blob([new Uint8Array(64*1024*1024+1)])])await reject(codec.decode(invalid));
 assert.throws(()=>B.inspectHeader(new Uint8Array(79),100));assert.throws(()=>B.inspectHeader(new Uint8Array(80),NaN));
});
test('independent checksums detect source/header/manifest corruption',async()=>{
 const file=await codec.encode(record(),{name:'校验'});for(const pos of [16,48,80,file.size-1])await reject(codec.decode(await altered(file,b=>b[pos]^=1)),'CHECKSUM_MISMATCH');
});
test('strict UTF8 rejects invalid, overlong, surrogate, non-scalar, BOM and truncation',async()=>{
 for(const b of [Buffer.from([0xc0,0xaf]),Buffer.from([0xed,0xa0,0x80]),Buffer.from([0xf4,0x90,0x80,0x80]),Buffer.from([0xef,0xbb,0xbf,0x7b,0x7d]),Buffer.from([0xc2]),Buffer.from([0x80]),Buffer.from([0xe2,0x28,0xa1])])await reject(codec.decode(await packed(b)));
});
test('duplicate escaped keys, poison keys and malformed JSON cannot hide fields',async()=>{
 const good=JSON.stringify(wire());const cases=[good.replace('"name":"项目测试"','"name":"项目测试","\\u006eame":"other"'),good.replace('"format":','"__proto__":{},"format":'),good.replace('"width":3','"width":3,"width":4'),good.replace('"width":3','"constructor":{},"width":3'),good+'null',good.slice(0,-1)+',}',good.replace('"name":"项目测试"','"name":"\\ud800"'),good.replace('"name":"项目测试"','"name":"\\udfff"')];for(const t of cases)await reject(codec.decode(await packed(t)));
});
test('numeric overflow, nonzero underflow and non-JSON numbers reject',async()=>{
 for(const number of ['1e999','1e-999','-1e-999','NaN','Infinity','01','+1','.1','1.','1e','9'.repeat(129)])await reject(codec.decode(await packed(JSON.stringify(wire()).replace('"width":3','"width":'+number))));
});
test('unknown versions, exact-shell violations and dangling/unsafe source URIs reject',async()=>{
 for(const change of [m=>m.version=2,m=>m.format='mint-adjustment-preset',m=>m.extra=1,m=>m.record.version=3,m=>delete m.record.redo,m=>m.record.source.blob='file:///etc/passwd',m=>m.record.source.path='/private',m=>m.record.source.width=4,m=>m.record.source.mime='image/jpeg',m=>m.record.source.origin='fabricated',m=>m.record.ops=[{type:'future-magic'}]]){const w=wire();change(w);await reject(codec.decode(await packed(w)));}
});
test('names enforce codepoints/UTF8/control/NFC and preserve valid emoji',async()=>{
 for(const name of ['',' '.repeat(2),'x'.repeat(81),'\u202eabc','x\u0000','x\u0085','x\ud800','x\u061c','x\u2067'])await reject(codec.encode(record(),{name}));
 const name='🌿'.repeat(80);assert.equal((await codec.decode(await codec.encode(record(),{name}))).name,name);
 for(const name of [' é ','é','name\n']){const w=wire();w.name=name;await reject(codec.decode(await packed(w)));}
 assert.equal((await codec.decode(await codec.encode(record(),{name:' é '}))).name,'é');
});
test('PNG/JPEG/WebP structure and dimension preflight fail before host decode',async()=>{
 const mutations=[['png',b=>b.writeUInt32BE(80000001,16)],['png',b=>b.writeUInt32BE(0,20)],['png',b=>b.writeUInt32BE(0xffffffff,8)],['png',b=>b.write('acTL',37)],['webp',b=>b.writeUInt32LE(1,4)],['webp',b=>b.write('ANIM',12)],['jpeg',b=>b[b.length-1]=0]];
 for(const [kind,change]of mutations){const bytes=Buffer.from(fixtures[kind],'base64');change(bytes);const r=record(kind);r.source.blob=new Blob([bytes],{type:'image/'+kind});await reject(codec.encode(r,{name:'无效图片'}));}
 const r=record();r.source.blob=new Blob(['GIF89a..............'],{type:'image/png'});await reject(codec.encode(r,{name:'伪装'}),'INVALID_IMAGE');
});
test('oversized source and aggregate steps fail closed',async()=>{
 const r=record();r.source.blob=new Blob([new Uint8Array(40*1024*1024+1)]);await reject(codec.encode(r,{name:'过大'}),'SOURCE_TOO_LARGE');
 const s=record();s.ops=Array.from({length:31},()=>({type:'rotate'}));s.redo=Array.from({length:30},()=>({type:'rotate'}));await reject(codec.encode(s,{name:'61步'}));
});
test('depth and key bounds reject attacker structure before canonical validators',async()=>{
 const w=JSON.stringify(wire()),deep='['.repeat(65)+'0'+']'.repeat(65);await reject(codec.decode(await packed(w.replace('"ops":[]','"ops":'+deep))));await reject(codec.decode(await packed(w.replace('"width":3','"'+'x'.repeat(257)+'":0,"width":3'))));
});
test('cancellation is observed before reads and cooperatively during hashing, with no input mutation',async()=>{
 const r=record(),before=clone(r);await reject(codec.encode(r,{name:'取消',shouldCancel:()=>true}),'PROJECT_BACKUP_CANCELED');await reject(codec.decode(new Blob([]),{shouldCancel:()=>true}),'PROJECT_BACKUP_CANCELED');
 let cancel=false;const running=B.sha256Blob(new Blob([new Uint8Array(8*1024*1024)]),{shouldCancel:()=>cancel});setTimeout(()=>{cancel=true;},0);await reject(running,'PROJECT_BACKUP_CANCELED');assert.deepEqual(r,before);
});
test('file:// style UMD realm works with no crypto/TextEncoder/TextDecoder',async()=>{
 const env={Blob,Uint8Array,Uint32Array,DataView,setTimeout};vm.runInNewContext(fs.readFileSync(path.join(__dirname,dir,'project-backup.js'),'utf8'),env);assert.deepEqual(Object.keys(env.MintProjectBackup).sort(),Object.keys(B).sort());assert.equal(await env.MintProjectBackup.sha256Blob(new Blob(['abc'])),digest('abc').toString('hex'));
});
test('largest embedded working asset fits string cap without image/base64 source expansion',async()=>{
 const asset={version:1,width:1024,height:1024,data:Buffer.alloc(1024*1024*4,127).toString('base64')},r=record('png',[{type:'image-overlay',action:'add',id:'img-max',asset,recipe:I.defaults()}]);
 const file=await codec.encode(r,{name:'最大单素材'}),out=await codec.decode(file);assert.equal(out.record.ops[0].asset.data,asset.data);assert.equal(out.record.source.blob.size,source().size);assert(file.size>5*1024*1024&&file.size<6*1024*1024);
});
test('string and node caps stop over-budget manifests before canonical operations',async()=>{
 const good=JSON.stringify(wire()),bigString='"'+'x'.repeat(B.LIMITS.stringBytes+1)+'"';await reject(codec.decode(await packed(good.replace('"name":"项目测试"','"name":'+bigString))),'MANIFEST_TOO_LARGE');
 const bigNodes='['+'0,'.repeat(B.LIMITS.nodes)+'0]';await reject(codec.decode(await packed(good.replace('"ops":[]','"ops":'+bigNodes))));
});
test('v1 and v2 manifest fixed fixtures have independently verifiable digests',async()=>{
 for(const name of ['minimal-v2','legacy-v1']){const file=fs.readFileSync(path.join(__dirname,'fixtures/project-backup',name+'.mintproject')),info=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/project-backup',name+'.json'),'utf8')),decoded=await codec.decode(new Blob([file]));assert.equal(decoded.sourceSha256,info.sourceSha256);assert.equal(decoded.manifestSha256,info.manifestSha256);assert.equal(decoded.record.version,info.recordVersion);assert.equal(file.length,info.totalBytes);}
});
test('browser UMD can encode and decode full canonical project without crypto or encoder APIs',async()=>{
 const env={Blob,Uint8Array,Uint8ClampedArray,Uint32Array,DataView,setTimeout};vm.createContext(env);for(const f of ['project-core.js','project-library.js','project-backup.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,dir,f),'utf8'),env);env.photo=source();
 const result=await vm.runInContext(`(async()=>{const c=MintProjectBackup.createCodec({projectCore:ProjectCore,projectLibrary:MintProjectLibrary});const p=ProjectCore.makeProject({blob:photo,name:'浏览器',width:3,height:2,mime:'image/png'},[{type:'rotate'}],[{type:'flip',axis:'x'}]);return c.decode(await c.encode(p,{name:'完整测试'}));})()`,env);
 assert.equal(result.record.ops[0].type,'rotate');assert.equal(result.record.redo[0].axis,'x');assert.equal(result.name,'完整测试');
});
test('SHA reads at most1MiB per call and does not use instance read methods',async()=>{
 const reads=[],original=Blob.prototype.arrayBuffer,env={Blob,Uint8Array,Uint32Array,DataView,setTimeout};
 try{Blob.prototype.arrayBuffer=function(){reads.push(this.size);return original.call(this);};vm.runInNewContext(fs.readFileSync(path.join(__dirname,dir,'project-backup.js'),'utf8'),env);}finally{Blob.prototype.arrayBuffer=original;}
 const b=new Blob([new Uint8Array(3*1024*1024+7)]);Object.defineProperty(b,'arrayBuffer',{value(){throw Error('must not invoke instance');}});await env.MintProjectBackup.sha256Blob(b);assert.deepEqual(reads,[1048576,1048576,1048576,7]);
});
test('config and option descriptors reject accessors/inheritance/unknown fields without invocation',async()=>{
 let reads=0;const getter=()=>{reads++;throw Error('unsafe getter');};
 for(const key of ['projectCore','projectLibrary']){const config={projectCore:P};Object.defineProperty(config,key,{enumerable:true,get:getter});assert.throws(()=>B.createCodec(config));}
 const core={draftRecord:P.draftRecord};Object.defineProperty(core,'restoreProject',{enumerable:true,get:getter});assert.throws(()=>B.createCodec({projectCore:core}));
 const library={};Object.defineProperty(library,'normalizeName',{enumerable:true,get:getter});assert.throws(()=>B.createCodec({projectCore:P,projectLibrary:library}));
 assert.throws(()=>B.createCodec(Object.create({projectCore:P})));assert.throws(()=>B.createCodec({projectCore:P,network:()=>{}}));
 for(const key of ['name','shouldCancel']){const opts={name:'安全'};Object.defineProperty(opts,key,{enumerable:true,get:getter});await reject(codec.encode(record(),opts));}
 await reject(codec.encode(record(),Object.create({name:'继承',shouldCancel:getter})));await reject(codec.encode(record(),{name:'x',hidden:true}));await reject(codec.decode(source(),{name:'not allowed'}));await reject(B.sha256Blob(source(),{name:'not allowed'}));
 assert.equal(reads,0);
});
test('pending encode snapshots option values and function identity before await',async()=>{
 const opts={name:'原选项',shouldCancel:()=>false},pending=codec.encode(record(),opts);opts.name='后来';opts.shouldCancel=()=>true;assert.equal((await codec.decode(await pending)).name,'原选项');
});
test('isolated inherited-getter and prototype toJSON pollution cannot execute',async()=>{
 const env={Blob,Uint8Array,Uint32Array,DataView,setTimeout};vm.createContext(env);vm.runInContext(fs.readFileSync(path.join(__dirname,dir,'project-backup.js'),'utf8'),env);env.photo=source();
 const checks=await vm.runInContext(`(async()=>{
 let reads=0;const getter=()=>{reads++;throw Error('must never invoke');};
 Object.defineProperty(Object.prototype,'shouldCancel',{configurable:true,get:getter});
 const hash=await MintProjectBackup.sha256Blob(photo,{});delete Object.prototype.shouldCancel;
 Object.defineProperty(Object.prototype,'projectCore',{configurable:true,get:getter});let refused=false;try{MintProjectBackup.createCodec({});}catch(_){refused=true;}delete Object.prototype.projectCore;
 const core={restoreProject:r=>r,draftRecord:r=>r},c=MintProjectBackup.createCodec({projectCore:core});
 Object.defineProperty(Object.prototype,'name',{configurable:true,get:getter});let nameRefused=false;try{await c.encode({version:2},{name:'x'});}catch(_){nameRefused=true;}delete Object.prototype.name;
 Object.prototype.toJSON=()=>{reads++;return {};};let jsonRefused=false;try{await c.encode({version:2},{name:'x'});}catch(_){jsonRefused=true;}delete Object.prototype.toJSON;
 return {reads,refused,nameRefused,jsonRefused,hash};})()`,env);
 assert.equal(checks.reads,0);assert.equal(checks.refused,true);assert.equal(checks.nameRefused,true);assert.equal(checks.jsonRefused,true);assert.equal(checks.hash,digest(Buffer.from(await source().arrayBuffer())).toString('hex'));
});
