'use strict';
// Independent backup recovery audit. Production editor/codec/controller/storage
// with real installed NativeCanvas. DOM, IDB scheduling and system sink are injected.
// This is NOT browser IndexedDB, Android SAF, WebView or process-death evidence.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {harness}=require('../helpers/project-library-harness.cjs');
const N=require('../../quality/text-overlay-independent/native-canvas.cjs');
const D=require('../../app/src/main/assets/face-detection.js'),I=require('../../app/src/main/assets/image-overlay.js');
const detected=require('../fixtures/people-two-detection.json');
const plain=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(setImmediate),out=path.resolve(__dirname,'../../quality/project-backup-independent');
async function until(h,fn,yes=true){const deadline=Date.now()+15000;while(!fn()&&Date.now()<deadline){await h.flush(0);if(h.$('confirmDialog').open)h.$(yes?'confirmYes':'confirmNo').click();await tick();}assert(fn(),'independent audit deadline');}
async function settle(h,p,yes=true){let done=false,value,error;p.then(x=>{done=true;value=x},e=>{done=true;error=e});await until(h,()=>done,yes);if(error)throw error;return value;}
async function start(){const h=harness(N.canvas),picture=N.fixture(180,100),bytes=picture.toBuffer('image/png'),file=h.file('prior-original.png',180,100,{type:'image/png',bytes,image:await N.decode(bytes)});await h.load(file);assert(h.state.source);h.codec=vm.runInContext('MintProjectBackup.createCodec({projectCore:ProjectCore,projectLibrary:MintProjectLibrary})',h.env);return Object.assign(h,{bytes,file,picture});}
function portrait(){const batch=D.decode(structuredClone(detected),{sourceRevision:'audit:stage-1',batchId:'audit:batch-1',width:900,height:500});batch.faces[0].beauty.brighten=20;batch.faces[1].beauty.warmth=-10;return {type:'portrait-people',phase:'beauty',batch};}
function edit(h){assert(h.commit(h.realm(portrait())));assert(h.commit(h.realm({type:'image-overlay',action:'add',id:'img-independent',asset:{version:1,width:2,height:2,data:Buffer.from([255,0,0,255,0,255,0,100,0,0,255,255,255,255,0,0]).toString('base64')},recipe:{...I.defaults(),size:.25}})));assert(h.commit(h.realm({type:'filter',id:'cool'})));h.click('undoBtn');}
async function backup(h){let blob;await settle(h,h.library.exportBackup('独立检查',h.codec.encode,async b=>{blob=b;return {saved:true,message:'controlled sink'};}));assert(blob);return blob;}
async function exportedCanvas(h){h.env.__probe.setFormat('image/png');h.env.__probe.setExportMode('original');await h.save();assert(h.encodes.length);const encoded=h.encodes.at(-1),img=await N.decode(encoded.bytes),c=N.canvas(img.width,img.height);c.getContext('2d').drawImage(img,0,0);h.nativeResult(true,'controlled image sink');return c;}

test('complete independent source/face coordinates/asset/redo survive a fresh recovery and actual PNG export',async()=>{
 const a=await start();edit(a);const old={ops:plain(a.state.ops),redo:plain(a.state.redo),pixels:N.hash(a.state.committed)},blob=await backup(a),b=await start();
 assert(b.commit(b.realm({type:'filter',id:'warm'})),'the replaced draft contains applied work worth preserving');
 assert.equal(await settle(b,b.library.importBackup(blob,b.codec.decode)),true);
 assert.deepEqual(Buffer.from(await b.state.sourceBlob.arrayBuffer()),a.bytes);assert.deepEqual(plain(b.state.ops),old.ops);assert.deepEqual(plain(b.state.redo),old.redo);
 assert.equal(b.state.ops[0].batch.faces[0].landmarks.length,478);assert.equal(b.state.ops[0].batch.faces[1].beauty.warmth,-10);assert.equal(b.state.ops[1].asset.data,old.ops[1].asset.data);
 assert.equal(N.hash(b.state.committed),old.pixels);const exported=await exportedCanvas(b);assert.equal(N.hash(exported),old.pixels);b.click('redoBtn');assert.notEqual(N.hash(b.state.committed),old.pixels);b.click('undoBtn');assert.equal(N.hash(b.state.committed),old.pixels);
 assert.equal(b.library.state().dirty,true);assert.equal(b.library.state().currentId,null);
 const entries=await b.store.list({includeTrash:true});assert.equal(entries.length,1);const recovered=await b.store.get(entries[0].id);assert.deepEqual(Buffer.from(await recovered.record.source.blob.arrayBuffer()),b.bytes);assert.deepEqual(plain(recovered.record.ops),[{type:'filter',id:'warm'}]);
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'faces-assets-restored.png'),exported.toBuffer('image/png'));
 fs.writeFileSync(path.join(out,'faces-assets-roundtrip.json'),JSON.stringify({sourceBytesEqual:true,historyEqual:true,redoEqual:true,embeddedAssetEqual:true,faceCount:2,landmarksPerFace:478,rgbaSha256:old.pixels,sourceSha256:crypto.createHash('sha256').update(a.bytes).digest('hex'),scope:'Actual NativeCanvas PNG; production editor/codec/storage; injected DOM/IDB/file sink, not Android'},null,2)+'\n');
});

test('delayed earlier autosave followed by backup exports and persists latest revision, not stale draft',async()=>{
 const h=await start();assert(h.commit(h.realm({type:'filter',id:'warm'})));h.backend.state.deferCommit=true;const earlier=h.env.__probe.saveDraftNow();await until(h,()=>h.backend.state.commits.length===1);
 assert(h.commit(h.realm({type:'filter',id:'cool'})));const latest=plain(h.state.ops),currentRevision=h.state.projectRevision;let delivered=null;
 const running=h.library.exportBackup('latest',h.codec.encode,async blob=>{delivered=blob;return {saved:true,message:'controlled sink'};});
 await until(h,()=>h.backend.state.queue.length>0);assert.equal(delivered,null);h.emit('pagehide');await h.flush(350);assert.equal(delivered,null);
 h.backend.state.releaseCommits();await earlier;await settle(h,running);assert(delivered);assert.deepEqual(plain((await h.store.readDraft()).ops),latest);assert.equal(h.env.__probe.savedDraftRevision,currentRevision);
 const archived=await settle(h,h.codec.decode(delivered));assert.deepEqual(plain(archived.record.ops),latest);assert.equal(h.library.state().dirty,true);
});

test('autosave failure does not block rescue backup or mark stale local revision durably saved',async()=>{
 const h=await start();const old=await h.store.readDraft(),oldRevision=h.env.__probe.savedDraftRevision;assert(h.commit(h.realm({type:'filter',id:'cool'})));const latest=plain(h.state.ops);h.backend.state.failAtWrite=1;let blob;
 const result=await settle(h,h.library.exportBackup('rescue',h.codec.encode,async b=>{blob=b;return{saved:true,message:'controlled sink'};}));
 assert.equal(result.saved,true);assert.match(result.message,/自动草稿未保存/);assert.equal(h.env.__probe.savedDraftRevision,oldRevision);assert.deepEqual(plain((await h.store.readDraft()).ops),plain(old.ops));assert.equal(h.library.state().dirty,true);
 const b=await start();assert.equal(await settle(b,b.library.importBackup(blob,b.codec.decode)),true);assert.deepEqual(plain(b.state.ops),latest);
});

test('failure at every atomic switch write preserves previous pixels/source/history/preview and both draft stores',async()=>{
 const a=await start();edit(a);const file=await backup(a);
 for(const failAtWrite of [1,2,3]){
  const h=await start();assert(h.commit(h.realm({type:'filter',id:'warm'})));await h.env.__probe.saveDraftNow();h.env.__probe.setDraft(h.realm({type:'filter',id:'cool'}));const before={source:h.state.sourceBlob,pixels:N.hash(h.state.committed),ops:plain(h.state.ops),draft:plain(h.state.draft),stored:plain((await h.store.readDraft()).ops)};
  h.backend.state.failAtWrite=failAtWrite;await assert.rejects(settle(h,h.library.importBackup(file,h.codec.decode)),/空间|未完成/);
  assert.equal(h.state.sourceBlob,before.source);assert.equal(N.hash(h.state.committed),before.pixels);assert.deepEqual(plain(h.state.ops),before.ops);assert.deepEqual(plain(h.state.draft),before.draft);assert.deepEqual(plain((await h.store.readDraft()).ops),before.stored);assert.equal((await h.store.list({includeTrash:true})).length,0);assert.equal(h.library.state().backupPending,false);
 }
});

test('cancel while an older autosave is committing leaves latest editor intact and skips encode/delivery',async()=>{
 const h=await start();assert(h.commit(h.realm({type:'filter',id:'warm'})));h.backend.state.deferCommit=true;const older=h.env.__probe.saveDraftNow();await until(h,()=>h.backend.state.commits.length===1);assert(h.commit(h.realm({type:'filter',id:'cool'})));const pixels=N.hash(h.state.committed),source=h.state.sourceBlob;let called=0;
 const p=h.library.exportBackup('cancel',()=>{called++;},()=>{called++;});await until(h,()=>h.backend.state.queue.length>0);assert.equal(h.library.cancelBackup(),true);h.backend.state.releaseCommits();await older;await assert.rejects(settle(h,p),/取消/);
 assert.equal(called,0);assert.equal(h.state.sourceBlob,source);assert.equal(N.hash(h.state.committed),pixels);assert.equal(h.library.pending,false);assert.deepEqual(plain((await h.store.readDraft()).ops),plain(h.state.ops));
});

test('runtime-invalid redo is rejected before replacing current project, rather than discovered only on Redo',async()=>{
 const h=await start();const op=portrait();op.batch.faces[1].landmarks=structuredClone(op.batch.faces[0].landmarks);h.env.__auditBad=h.realm(op);h.env.__auditSource=h.state.sourceBlob;
 const record=vm.runInContext('ProjectCore.makeProject({blob:__auditSource,name:"runtime-invalid-redo",width:180,height:100,mime:"image/png",origin:"original"},[],[__auditBad])',h.env);
 const blob=await settle(h,h.codec.encode(record,h.realm({name:'redo must preflight'}))),before={source:h.state.sourceBlob,pixels:N.hash(h.state.committed),draft:plain((await h.store.readDraft()).ops)};
 await assert.rejects(settle(h,h.library.importBackup(blob,h.codec.decode)),/人物|区域|overlap|历史|重做/i);
 assert.equal(h.state.sourceBlob,before.source);assert.equal(N.hash(h.state.committed),before.pixels);assert.deepEqual(plain((await h.store.readDraft()).ops),before.draft);assert.equal((await h.store.list({includeTrash:true})).length,0);
});

test('later empty text replacement cannot hide an earlier runtime-invalid undo/redo layer state',async()=>{
 for(const placement of ['committed','redo']){
  const h=await start(),T=require('../../app/src/main/assets/text-overlay.js');
  const bad={type:'text-overlay',action:'add',id:'audit-hidden-text',recipe:{...T.defaults(),text:'W'.repeat(500),size:.5,boxWidth:.05}};
  const cleared={type:'text-overlay',action:'replace',id:'audit-hidden-text',recipe:T.defaults()};
  // Structural validation succeeds; the real installed Canvas produces >128 wrapped lines.
  assert.doesNotThrow(()=>T.validate(bad.recipe));assert.throws(()=>T.layout(h.state.committed.getContext('2d'),180,100,bad.recipe),/wrapped line limit/);
  h.env.__auditLayers=h.realm([bad,cleared]);h.env.__auditSource=h.state.sourceBlob;
  const expr=placement==='committed'?'__auditLayers,[]':'[],__auditLayers.slice().reverse()';
  const record=vm.runInContext('ProjectCore.makeProject({blob:__auditSource,name:"hidden-invalid-layer",width:180,height:100,mime:"image/png",origin:"original"},'+expr+')',h.env);
  const blob=await settle(h,h.codec.encode(record,h.realm({name:'history layer must preflight'}))),before={source:h.state.sourceBlob,pixels:N.hash(h.state.committed),draft:plain((await h.store.readDraft()).ops)};
  await assert.rejects(settle(h,h.library.importBackup(blob,h.codec.decode)),/wrapped line limit/);
  assert.equal(h.state.sourceBlob,before.source);assert.equal(N.hash(h.state.committed),before.pixels);assert.deepEqual(plain((await h.store.readDraft()).ops),before.draft);assert.equal((await h.store.list({includeTrash:true})).length,0);
 }
});

test('cancel between hidden-layer prefix replays prevents installation and releases prepared pixels',async()=>{
 const h=await start(),T=require('../../app/src/main/assets/text-overlay.js');h.env.__auditSource=h.state.sourceBlob;h.env.__auditLayers=h.realm([{type:'text-overlay',action:'add',id:'audit-cancel-text',recipe:{...T.defaults(),text:'one'}},{type:'text-overlay',action:'replace',id:'audit-cancel-text',recipe:{...T.defaults(),text:'two'}}]);
 const record=vm.runInContext('ProjectCore.makeProject({blob:__auditSource,name:"cancel-prefix-replay",width:180,height:100,mime:"image/png",origin:"original"},__auditLayers,[])',h.env),blob=await settle(h,h.codec.encode(record,h.realm({name:'cancel replay'})));
 const before={source:h.state.sourceBlob,pixels:N.hash(h.state.committed),revision:h.state.projectRevision,draft:plain((await h.store.readDraft()).ops)},real=h.env.TextOverlayUI.apply;let renders=0;
 h.env.TextOverlayUI.apply=(...args)=>{renders++;return real(...args);};
 const pending=h.library.importBackup(blob,h.codec.decode);await until(h,()=>renders>0);assert.equal(h.library.cancelBackup(),true);await assert.rejects(settle(h,pending),/取消/);h.env.TextOverlayUI.apply=real;
 assert.equal(renders,1);assert.equal(h.state.sourceBlob,before.source);assert.equal(h.state.projectRevision,before.revision);assert.equal(N.hash(h.state.committed),before.pixels);assert.deepEqual(plain((await h.store.readDraft()).ops),before.draft);assert.equal((await h.store.list({includeTrash:true})).length,0);assert.equal(h.library.pending,false);
});
