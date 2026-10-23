'use strict';
// Independent adversarial audit. Uses shipped implementations, not copied parsers.
// JVM is ordinary Java; DOM/storage/bridge are injected; NOT Android/SAF/WebView proof.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'quality/project-backup-independent');
const B=require('../app/src/main/assets/project-backup.js'),P=require('../app/src/main/assets/project-core.js'),L=require('../app/src/main/assets/project-library.js'),T=require('../app/src/main/assets/project-backup-transport.js');
const codec=B.createCodec({projectCore:P,projectLibrary:L}),fixture=fs.readFileSync(path.join(__dirname,'fixtures/project-backup/minimal-v2.mintproject'));
const source=fixture.subarray(80+fixture.readUInt32LE(8)),base=JSON.parse(fixture.subarray(80,80+fixture.readUInt32LE(8)).toString()),sha=b=>crypto.createHash('sha256').update(b).digest();
base.record.ops=[];base.record.redo=[];
function envelope(manifest,photo=source){const m=Buffer.isBuffer(manifest)?manifest:Buffer.from(typeof manifest==='string'?manifest:JSON.stringify(manifest)),h=Buffer.alloc(80);h.write('MINTPRJ1');h.writeUInt32LE(m.length,8);h.writeUInt32LE(photo.length,12);sha(m).copy(h,16);sha(photo).copy(h,48);return Buffer.concat([h,m,photo]);}
async function jsAccept(bytes){try{await codec.decode(new Blob([bytes]));return true;}catch{return false;}}
const tick=()=>new Promise(setImmediate);
async function until(fn){for(let i=0;i<300&&!fn();i++)await tick();assert(fn(),'audit condition did not settle');}
function manifest(text){return JSON.stringify(base).replace('"ops":[]','"ops":'+text);}
function rawNumber(v){return manifest('[{"type":"adjust","values":{"brightness":'+v+'}}]');}
const cases=[];function add(name,m,expected=false,nativeExpected=expected){cases.push({name,bytes:envelope(m),expected,nativeExpected});}
add('control-valid',base,true);add('valid-negative-zero',rawNumber('-0'),true);add('valid-smallest-positive',rawNumber('5e-324'),true);add('valid-tiny-negative',rawNumber('-1e-300'),true);add('valid-128-char-number',rawNumber('0.'+'0'.repeat(125)+'1'),true);
for(const v of ['1e-324','-1e-324','1e309','-1e309','00','-01','+1','.1','1.','1e','1e+','1E-','NaN','Infinity','0x01','0.'+'0'.repeat(126)+'1'])add('bad-number-'+cases.length,rawNumber(v));
for(const tail of ['\u000b','\u000c','x','{}','\0'])add('bad-tail-'+cases.length,JSON.stringify(base)+tail);
for(const m of [JSON.stringify(base).replace('"version":1','"version":1,"ver\\u0073ion":1'),manifest('[{"type":"rotate","type":"rotate"}]'),manifest('[{"type":"adjust","values":{"brightness":0,"bright\\u006eess":0}}]')])add('duplicate-'+cases.length,m);
for(const key of ['__proto__','prototype','constructor','__pro\\u0074o__'])add('poison-'+cases.length,manifest('[{"type":"rotate","'+key+'":{}}]'),false,false);
for(const value of ['"\\ud800"','"\\udfff"','"\\ud800x"','"\\uZZZZ"','"\\x20"','"a\nb"','"\\"'])add('bad-string-'+cases.length,JSON.stringify(base).replace(/"name":"[^"]*"/,'"name":'+value));
for(const bytes of [[0xc0,0xaf],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0xf5,0x80,0x80,0x80],[0xe2,0x82],[0x80]]){const text=Buffer.from(JSON.stringify(base)),at=text.indexOf(Buffer.from(base.name));add('bad-utf8-'+cases.length,Buffer.concat([text.subarray(0,at),Buffer.from(bytes),text.subarray(at+Buffer.byteLength(base.name))]));}
add('bom',Buffer.concat([Buffer.from([239,187,191]),Buffer.from(JSON.stringify(base))]));
add('deep-65',manifest('['.repeat(65)+'0'+']'.repeat(65)));
add('key-257',manifest('[{"'+'x'.repeat(257)+'":0}]'));
for(const mutate of [b=>b[0]^=1,b=>b[16]^=1,b=>b[48]^=1,b=>b[80]^=1,b=>b[b.length-1]^=1,b=>b.writeUInt32LE(0xffffffff,8),b=>b.writeUInt32LE(24*1024*1024+1,8),b=>b.writeUInt32LE(40*1024*1024+1,12)]){const bytes=Buffer.from(fixture);mutate(bytes);cases.push({name:'bad-envelope-'+cases.length,bytes,expected:false,nativeExpected:false});}
for(const n of [0,1,79,80,fixture.length-1])cases.push({name:'truncate-'+n,bytes:fixture.subarray(0,n),expected:false,nativeExpected:false});
cases.push({name:'trailing-byte',bytes:Buffer.concat([fixture,Buffer.from([0])]),expected:false,nativeExpected:false});

test('independent raw-envelope corpus compares JS and native accept/reject at exact malformed/numeric boundaries',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mint-backup-audit-'));
 try{
  const javas=['app/src/main/java/com/qingyan/editor/PresetPayload.java','app/src/main/java/com/qingyan/editor/ProjectBackupPayload.java','quality/project-backup-independent/ProjectBackupAudit.java'].map(p=>path.join(root,p));
  let compiler=cp.spawnSync('javac',['-encoding','UTF-8','--release','17','-d',tmp,...javas],{encoding:'utf8'});if(compiler.error&&compiler.error.code==='ENOENT')compiler=cp.spawnSync('java',['-m','jdk.compiler/com.sun.tools.javac.Main','-encoding','UTF-8','-source','17','-target','17','-d',tmp,...javas],{encoding:'utf8'});assert.equal(compiler.status,0,compiler.stdout+compiler.stderr);
  const paths=cases.map(c=>{const p=path.join(tmp,c.name+'.mintproject');fs.writeFileSync(p,c.bytes);return p;});
  const native=cp.spawnSync('java',['-cp',tmp,'com.qingyan.editor.ProjectBackupAudit',...paths],{encoding:'utf8'});assert.equal(native.status,0,native.stdout+native.stderr);const answers=new Map(native.stdout.trim().split(/\r?\n/).map(s=>s.split('\t'))),report=[];
  for(const c of cases){const js=await jsAccept(c.bytes),java=answers.get(c.name+'.mintproject')==='accept';report.push({name:c.name,bytes:c.bytes.length,js,java,expectedJS:c.expected,expectedNative:c.nativeExpected});}
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'differential.json'),JSON.stringify(report,null,2)+'\n');
  for(const r of report){assert.equal(r.js,r.expectedJS,'JS: '+r.name);assert.equal(r.java,r.expectedNative,'native: '+r.name);}
 }
 finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('export snapshot cannot be mutated after encode starts; source/history/redo remain byte-exact',async()=>{
 const r=(await codec.decode(new Blob([fixture]))).record;r.ops=[{type:'adjust',values:{brightness:11}}];r.redo=[{type:'flip',axis:'y'}];const sourceBytes=Buffer.from(await r.source.blob.arrayBuffer()),expected=structuredClone(r),opts={name:'Before'};
 const pending=codec.encode(r,opts);r.ops[0].values.brightness=-99;r.redo.length=0;r.source.name='After';opts.name='After';
 const result=await codec.decode(await pending);assert.equal(result.name,'Before');assert.deepEqual(result.record.ops,expected.ops);assert.deepEqual(result.record.redo,expected.redo);assert.equal(result.record.source.name,expected.source.name);assert.deepEqual(Buffer.from(await result.record.source.blob.arrayBuffer()),sourceBytes);
});

test('binary header rejects unsafe numeric totals and every unsigned length extreme before data read',()=>{
 const h=new Uint8Array(fixture.subarray(0,80));for(const n of [NaN,Infinity,-Infinity,-1,0,81,fixture.length+.5,Number.MAX_SAFE_INTEGER+1,64*1024*1024+1])assert.throws(()=>B.inspectHeader(h,n));
 for(const n of [0,0x7fffffff,0x80000000,0xffffffff])for(const off of [8,12]){const x=Buffer.from(h);x.writeUInt32LE(n,off);assert.throws(()=>B.inspectHeader(new Uint8Array(x),80+x.readUInt32LE(8)+x.readUInt32LE(12)));}
});

test('stale callbacks after cancellation cannot complete, send chunks for, or cancel the newer request',async()=>{
 const calls=[],w={setTimeout,clearTimeout,btoa:s=>Buffer.from(s,'binary').toString('base64')};
 const android={beginProjectBackup(id){calls.push(['begin',id]);},appendProjectBackup(id,index){calls.push(['chunk',id,index]);},finishProjectBackup(id){calls.push(['finish',id]);},cancelProjectBackup(id){calls.push(['cancel',id]);}};
 const t=T.create({root:w,android}),a=t.save(new Blob([fixture]),'A');const first=calls[0][1];t.cancel();await assert.rejects(a,/取消/);
 const b=t.save(new Blob([fixture]),'B'),second=calls.at(-1)[1];assert.notEqual(second,first);for(const event of ['ready','chunk','picker','error'])w.onNativeProjectBackupTransfer(first,event,99,'old');w.onNativeProjectBackupExportResult(first,true,'old success');w.onNativeProjectBackupExportResult(first,false,'old fail');assert.equal(t.pending,true);assert.equal(t.stage,'starting');assert.equal(calls.filter(c=>c[0]==='cancel'&&c[1]===second).length,0);
 w.onNativeProjectBackupTransfer(second,'ready',-1,'');await until(()=>calls.some(c=>c[0]==='chunk'&&c[1]===second));w.onNativeProjectBackupTransfer(second,'chunk',0,'');await until(()=>calls.some(c=>c[0]==='finish'&&c[1]===second));w.onNativeProjectBackupTransfer(second,'picker',-1,'');w.onNativeProjectBackupExportResult(second,false,'user cancelled');assert.equal((await b).saved,false);assert.equal(t.pending,false);t.dispose();
});

test('header-only exact inclusive caps accept while one-byte over caps reject without large Blob allocation',()=>{
 const h=Buffer.from(fixture.subarray(0,80)),m=24*1024*1024,s=40*1024*1024;
 h.writeUInt32LE(m,8);h.writeUInt32LE(s-80,12);assert.equal(B.inspectHeader(new Uint8Array(h),64*1024*1024).manifestLength,m);
 h.writeUInt32LE(m-80,8);h.writeUInt32LE(s,12);assert.equal(B.inspectHeader(new Uint8Array(h),64*1024*1024).sourceLength,s);
 h.writeUInt32LE(m,8);assert.throws(()=>B.inspectHeader(new Uint8Array(h),64*1024*1024+80));
});

test('picker-phase disposal releases pending promise without cancelling a possibly written destination',async()=>{
 const calls=[],w={setTimeout,clearTimeout,btoa:s=>Buffer.from(s,'binary').toString('base64')};let id;
 const android={beginProjectBackup(i){id=i;queueMicrotask(()=>w.onNativeProjectBackupTransfer(i,'ready',-1,''));},appendProjectBackup(i,n){queueMicrotask(()=>w.onNativeProjectBackupTransfer(i,'chunk',n,''));},finishProjectBackup(i){queueMicrotask(()=>w.onNativeProjectBackupTransfer(i,'picker',-1,''));},cancelProjectBackup(i){calls.push(i);}};
 const t=T.create({root:w,android}),p=t.save(new Blob([fixture]),'dispose');await until(()=>t.stage==='picker');t.dispose();await assert.rejects(p,/未确认|检查/);assert.deepEqual(calls,[]);assert.equal(t.pending,false);assert(id);
});

test('detached native notices are bounded, validated, deduplicated, and never settle a newer active request',async()=>{
 const notices=[],w={setTimeout,clearTimeout},t=T.create({root:w,android:null,onDetachedResult:r=>notices.push(r)});
 for(const [id,ok,msg] of [['',false,'x'],['x'.repeat(81),false,'x'],['bad/id',false,'x'],['valid','false','x'],['valid',false,null],['valid',false,'x'.repeat(2001)]])w.onNativeProjectBackupExportResult(id,ok,msg);
 assert.equal(notices.length,0);w.onNativeProjectBackupExportResult('x'.repeat(80),true,'x'.repeat(2000));assert.deepEqual(notices,[{saved:true,message:'x'.repeat(2000)}]);assert.equal(t.pending,false);t.dispose();
 const ring=[],r={setTimeout,clearTimeout},bounded=T.create({root:r,android:null,onDetachedResult:v=>ring.push(v)});
 for(let i=0;i<32;i++)r.onNativeProjectBackupExportResult('old-'+i,false,String(i));r.onNativeProjectBackupExportResult('old-0',true,'duplicate');assert.equal(ring.length,32);r.onNativeProjectBackupExportResult('old-32',false,'32');r.onNativeProjectBackupExportResult('old-0',false,'evicted');assert.equal(ring.length,34);r.onNativeProjectBackupExportResult('old-31',true,'duplicate recent');assert.equal(ring.length,34);assert.equal(bounded.pending,false);bounded.dispose();
 let id;const activeNotices=[],live={setTimeout,clearTimeout},calls=[];
 const android={beginProjectBackup(i){id=i;},appendProjectBackup(){assert.fail('unexpected stream');},finishProjectBackup(){assert.fail('unexpected picker');},cancelProjectBackup(i){calls.push(i);}};
 const current=T.create({root:live,android,onDetachedResult:v=>activeNotices.push(v)}),p=current.save(new Blob([fixture]),'live');live.onNativeProjectBackupExportResult('valid-old-id',true,'old');assert.equal(current.pending,true);assert.equal(current.stage,'starting');assert.equal(activeNotices.length,0);assert.equal(calls.length,0);
 live.onNativeProjectBackupExportResult(id,false,'current cancelled');assert.equal((await p).saved,false);live.onNativeProjectBackupExportResult(id,true,'duplicate settled success');assert.equal(activeNotices.length,0);live.onNativeProjectBackupExportResult('valid-old-id',false,'old uncertainty');assert.deepEqual(activeNotices,[{saved:false,message:'old uncertainty'}]);assert.equal(current.pending,false);current.dispose();
 let thrown=0;const f={setTimeout,clearTimeout},throws=T.create({root:f,android:null,onDetachedResult(){thrown++;throw Error('notice only');}});assert.doesNotThrow(()=>f.onNativeProjectBackupExportResult('once',false,'not saved'));f.onNativeProjectBackupExportResult('once',true,'duplicate');assert.equal(thrown,1);assert.equal(throws.pending,false);throws.dispose();
});
