'use strict';
// Independent integration contract tests. All IndexedDB/DOM/timers here are
// fault-injected models, not browser, Android, WebView or physical persistence.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const L = require('../app/src/main/assets/project-library.js');
const C = require('../app/src/main/assets/project-library-controller.js');
const P = require('../app/src/main/assets/project-core.js');
const I = require('../app/src/main/assets/image-overlay.js');
const Layout = require('../app/src/main/assets/collage-layout.js');
const { makeIDB } = require('../docs/quality/project-library-independent/fault-idb.cjs');
const tick = () => new Promise(setImmediate), clone = x => structuredClone(x), id = n => 'project-' + n.toString(16).padStart(32, '0');
const editor = fs.readFileSync(require.resolve('../app/src/main/assets/editor.js'), 'utf8');
function extract(from, to) { const a=editor.indexOf(from),b=editor.indexOf(to,a); assert(a>=0 && b>a,'editor extraction anchors'); return editor.slice(a,b); }
function record(name = 'original.png', rich = false) {
  const asset=I.encodeAsset({width:2,height:1,data:new Uint8ClampedArray([1,55,200,255,254,90,7,128])});
  const add={type:'image-overlay',action:'add',id:'img-original',asset,recipe:I.defaults()};
  const collage={type:'collage',recipe:Layout.defaults(2),assets:[asset]};
  return P.makeProject({blob:new Blob([new Uint8Array([0,1,255,42,0,91])],{type:'image/png'}),name,width:64,height:48,origin:'original'},rich?[{type:'rotate'},add,{type:'image-overlay',action:'replace',id:'img-original',recipe:{...I.defaults(),x:.3}}]:[{type:'rotate'}],rich?[{type:'flip',axis:'y'},collage]:[{type:'flip',axis:'x'}]);
}
function validate(record) { const p=P.restoreProject(record,{width:1,height:1}); return record.version===1?{version:1,blob:p.source.blob,name:p.source.name,ops:p.ops,redo:p.redo}:p; }
function storage(options={}) { const backend=makeIDB(options);let n=0;return {...backend,store:L.create({indexedDB:backend.indexedDB,validateRecord:validate,makeId:()=>id(++n),now:()=>1000})}; }
async function until(fn) { for(let i=0;i<200;i++){if(fn())return;await tick();}throw Error('Independent model did not reach checkpoint'); }
async function errorCode(promise,code){await assert.rejects(promise,e=>{assert.equal(e.code,code);return true;});}
function controller(h=storage()) {
  let current=record('current.png',true),revision=1,key={},previewDirty=false,busy=false,confirm=true;
  const events=[], gates={},host={store:h.store,capture:()=>({project:current&&clone(current),revision,sourceKey:key,previewDirty,busy}),busy:value=>{busy=value;},changed(){},confirm:async(...args)=>{events.push(['confirm',...args]);return typeof confirm==='function'?confirm():confirm;},prepare:async(input,kind)=>{events.push(['prepare']);if(gates.prepare)await gates.prepare;return{project:clone(kind==='file'?input:input)};},install:prepared=>{events.push(['install']);if(gates.failInstall)throw Error('install failed');current=clone(prepared.project);key={};revision++;previewDirty=false;},release:()=>events.push(['release']),draftStored:()=>events.push(['draftStored'])};
  const api=C.create(host);
  return{...h,host,api,events,gates,get current(){return current;},get revision(){return revision;},set answer(v){confirm=v;},set preview(v){previewDirty=v;},edit(){current.ops.push({type:'flip',axis:'x'});revision++;},blank(){current=null;key=null;revision++;},gate(name){let resolve;gates[name]=new Promise(r=>resolve=r);return resolve;}};
}
function confirmationHarness() {
  const queue=[],listeners=new Map(),dialog={open:false,showModal(){this.open=true;},close(){if(!this.open)return;this.open=false;queue.push(()=>{for(const fn of [...listeners.get('close')||[]])fn({type:'close'});});},addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},emit(type){const event={type,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const fn of [...listeners.get(type)||[]])fn(event);return event;}};
  const nodes={confirmDialog:dialog,confirmTitle:{},confirmText:{},confirmYes:{},confirmNo:{}};
  const context=vm.createContext({$:id=>nodes[id]});
  vm.runInContext('let projectConfirmation=null;'+extract('function askProjectConfirmation(', 'async function prepareNamedProject(')+';globalThis.api={ask:askProjectConfirmation,back:()=>projectConfirmation&&projectConfirmation(false)};',context);
  return {...context.api,dialog,nodes,queue,listeners};
}
test('independent storage + controller saves exact original bytes, embedded overlay/collage and redo order',async()=>{
 const h=controller(),input=clone(h.current),a=await h.api.save('富素材');
 const got=await h.store.get(a.id);assert.deepEqual(got.record,input);assert.deepEqual(new Uint8Array(await got.record.source.blob.arrayBuffer()),new Uint8Array([0,1,255,42,0,91]));
 assert.deepEqual(got.record.redo.map(x=>x.type),['flip','collage']);assert.equal(got.record.ops[1].asset.data,input.ops[1].asset.data);
 h.edit();await h.api.refresh();const copy=await h.api.copy(a.id,'保存版本副本');assert.deepEqual((await h.store.get(copy.id)).record,input);
 const updated=await h.api.save('富素材更新');assert.equal(updated.id,a.id);assert.equal((await h.store.get(copy.id)).record.ops.length,input.ops.length);
 await h.api.refresh();await h.api.trash(copy.id);await h.api.restore(copy.id);assert.deepEqual((await h.store.get(copy.id)).record,input);
});
test('dirty switch with real storage module archives latest memory including redo then opens named snapshot',async()=>{
 const h=controller();await h.store.writeDraft(record('obsolete-autosave'));const target=await h.store.save({name:'目标',record:record('target.png')});h.edit();const before=clone(h.current);
 assert.equal(await h.api.open(target.id),true);assert.equal(h.current.source.name,'target.png');assert.equal(h.api.state().dirty,false);
 const trash=(await h.store.list({includeTrash:true})).filter(x=>x.trashedAt!==null);assert.equal(trash.length,1);assert.deepEqual((await h.store.get(trash[0].id)).record,before);assert.deepEqual(await h.store.readDraft(),h.current);
});
test('canceling dirty switch leaves exact memory, draft, named entries and preview intact',async()=>{
 const h=controller();await h.store.writeDraft(h.current);const target=await h.store.save({name:'目标',record:record('target.png')});const before=clone(h.current);h.preview=true;h.answer=false;
 assert.equal(await h.api.open(target.id),false);assert.deepEqual(h.current,before);assert.deepEqual(await h.store.readDraft(),before);assert.equal((await h.store.usage()).count,1);assert.equal(h.api.state().previewDirty,true);assert.equal(h.api.pending,false);assert.equal(h.events.filter(x=>x[0]==='release').length,1);
});
test('late source or revision during prepare invalidates the prepared target before any write',async()=>{
 const h=controller(),target=await h.store.save({name:'目标',record:record('target.png')});await h.store.writeDraft(h.current);const previous=await h.store.readDraft(),resume=h.gate('prepare');const task=h.api.open(target.id);await until(()=>h.events.some(x=>x[0]==='prepare'));h.edit();resume();await assert.rejects(task,/变化/);assert.deepEqual(await h.store.readDraft(),previous);assert.equal(h.current.ops.length,4);assert(!h.events.some(x=>x[0]==='install'));
});
test('late confirmation approval after an edit does not adopt old target or archive a stale snapshot',async()=>{
 const h=controller(),target=await h.store.save({name:'目标',record:record('target.png')});let answer;h.answer=()=>new Promise(r=>answer=r);const task=h.api.open(target.id);await until(()=>answer);h.edit();answer(true);await assert.rejects(task,/变化/);assert.equal((await h.store.usage()).count,1);assert(!h.events.some(x=>x[0]==='install'));
});
test('refresh does not silently rebase active revision over an external overwrite',async()=>{
 const h=controller(),a=await h.api.save('A');await h.store.save({id:a.id,name:'external',record:record('external.png'),expectedRevision:1});await h.api.refresh();h.edit();await errorCode(h.api.save('A overwritten?'),'REVISION_CONFLICT');assert.equal((await h.store.get(a.id)).record.source.name,'external.png');assert.equal(h.api.state().dirty,true);
});
test('stale stored-copy/trash/restore revisions are enforced by production controller + storage',async()=>{
 const h=controller(),a=await h.api.save('A');await h.api.refresh();await h.store.save({id:a.id,name:'new',record:record(),expectedRevision:1});await errorCode(h.api.copy(a.id,'stale'),'REVISION_CONFLICT');await errorCode(h.api.trash(a.id),'REVISION_CONFLICT');await h.api.refresh();await h.api.trash(a.id);await h.store.restore(a.id,3);await errorCode(h.api.restore(a.id),'REVISION_CONFLICT');assert.equal((await h.store.get(a.id)).metadata.trashedAt,null);
});
test('failed final commit is not controller save success and leaves identity detached',async()=>{
 const h=controller();await h.store.list();h.state.holdCommit=true;let settled=false;const pending=h.api.save('A').finally(()=>settled=true);await until(()=>h.state.held.length);assert.equal(settled,false);assert.equal(h.api.state().currentId,null);assert.equal(h.api.pending,true);h.state.failCommit=true;h.state.release();await errorCode(pending,'STORAGE_QUOTA');assert.equal(h.api.state().currentId,null);assert.equal((await h.store.usage()).count,0);assert.equal(h.api.pending,false);
});
test('all atomic switch writes and final commit rollback preserve authoritative old draft plus library',async()=>{
 for(const fault of [1,2,3,'commit']){const h=storage(),old=record('old.png',true);await h.store.writeDraft(old);if(fault==='commit')h.state.failCommit=true;else h.state.faultWrite=fault;await errorCode(h.store.replaceDraft(record('new.png'),{archiveName:'恢复'}),'STORAGE_QUOTA');assert.deepEqual(await h.store.readDraft(),old);assert.equal((await h.store.usage()).count,0);}
});
test('install failure restores old draft and keeps a recoverable archive without deleting either named target',async()=>{
 const h=controller();await h.store.writeDraft(h.current);const old=clone(h.current),target=await h.store.save({name:'目标',record:record('target.png')});h.gates.failInstall=true;await assert.rejects(h.api.open(target.id),/install failed/);assert.deepEqual(h.current,old);assert.deepEqual(await h.store.readDraft(),old);const all=await h.store.list({includeTrash:true});assert.equal(all.length,2);assert.equal(all.filter(x=>x.trashedAt!==null).length,1);assert.equal((await h.store.get(target.id)).metadata.trashedAt,null);
});
test('invalid unopened draft prevents an import from silently replacing its old bytes',async()=>{
 const old={...record('bad.png'),ops:[{type:'future-format'}]},h=controller(storage({version:1,draft:old}));h.blank();await errorCode(h.api.importFile(record('new.png')),'INVALID_RECORD');assert.deepEqual(h.state.raw().get('drafts').get('current'),old);assert.equal(h.current,null);
});
test('v1 migration retains exact raw legacy input and never persists the 1x1 validation dimensions',async()=>{
 const legacy={version:1,blob:new Blob(['legacy working bytes'],{type:'image/png'}),name:'legacy',ops:[{type:'rotate'}],redo:[{type:'flip',axis:'x'}]},h=storage({version:1,draft:legacy});assert.deepEqual(await h.store.readDraft(),legacy);assert.deepEqual(h.state.raw().get('drafts').get('current'),legacy);const archived=await h.store.archiveDraftToTrash('旧草稿');const stored=(await h.store.get(archived.id)).record;assert.deepEqual(stored,legacy);assert.equal(stored.source,undefined);assert.equal(stored.width,undefined);const restored=P.restoreProject(stored,{width:13,height:9});assert.equal(restored.source.width,13);assert.equal(restored.source.origin,'legacy-working-copy');
});
test('v2 database migration retains known real dimensions, provenance and binary payload without rewrite',async()=>{
 const old=record('v2.png',true);old.source.origin='legacy-working-copy';const h=storage({version:1,draft:old});assert.deepEqual(await h.store.readDraft(),old);assert.deepEqual(h.state.raw().get('drafts').get('current'),old);assert.deepEqual([old.source.width,old.source.height],[64,48]);
});
test('corrupt source, snapshot revision, orphan and target byte mismatch reject without repair or deletion',async()=>{
 for(const mutate of [h=>h.state.raw().get('projectSnapshots').get(id(1)).record.source.width=0,h=>h.state.raw().get('projectSnapshots').get(id(1)).revision++,h=>h.state.raw().get('projectSnapshots').set(id(99),{}),h=>h.state.raw().get('projectMetadata').get(id(1)).bytes++]){const h=storage(),a=await h.store.save({name:'A',record:record()});mutate(h);const before=clone(h.state.raw());await errorCode(h.store.get(a.id),'CORRUPT_STORAGE');await errorCode(h.store.trash(a.id,1),'CORRUPT_STORAGE');assert.deepEqual(h.state.raw(),before);}
});
test('all-trash capacity can be reclaimed explicitly without deleting restored work',async()=>{
 const h=storage();for(let i=0;i<24;i++){const a=await h.store.save({name:'A'+i,record:record()});await h.store.trash(a.id,1);}const before=clone(h.state.raw());await errorCode(h.store.save({name:'25th',record:record()}),'COLLECTION_FULL');assert.deepEqual(h.state.raw(),before);await h.store.restore(id(1),2);assert.equal((await h.store.list()).length,1);assert.equal((await h.store.usage()).count,24);const trash=(await h.store.list({includeTrash:true})).filter(m=>m.trashedAt!==null);await h.store.emptyTrash(trash.map(m=>({id:m.id,revision:m.revision})));assert.equal((await h.store.usage()).count,1);assert((await h.store.get(id(1)))!==null);await h.store.save({name:'new',record:record()});assert.equal((await h.store.usage()).count,2);for(const name of ['delete','clear'])assert.equal(h.store[name],undefined);
});
for(const action of ['no','back','cancel','close'])test('editor project confirmation '+action+' settles false exactly once',async()=>{
 const h=confirmationHarness(),p=h.ask('Replace?','Recover before replacing'),oldYes=h.nodes.confirmYes.onclick;
 if(action==='no')h.nodes.confirmNo.onclick();if(action==='back')h.back();if(action==='cancel')h.dialog.emit('cancel');if(action==='close'){h.dialog.close();h.queue.shift()();}
 assert.equal(await p,false);assert.equal(h.dialog.open,false);oldYes();assert.equal(await p,false);assert.equal(h.listeners.get('close').size,0);assert.equal(h.listeners.get('cancel').size,0);
});
test('editor project confirmation Yes resolves true and a retained old Yes cannot affect a later prompt',async()=>{
 const h=confirmationHarness(),p=h.ask('First',''),oldYes=h.nodes.confirmYes.onclick;oldYes();assert.equal(await p,true);while(h.queue.length)h.queue.shift()();const p2=h.ask('Second','');oldYes();assert.equal(h.dialog.open,true);h.nodes.confirmNo.onclick();assert.equal(await p2,false);
});
test('regression: queued native close from a superseded confirmation must not cancel a newer opening',async()=>{
 const h=confirmationHarness(),a=h.ask('First',''),b=h.ask('Second','');assert.equal(await a,false);assert.equal(h.dialog.open,true);h.queue.shift()();assert.equal(h.dialog.open,true,'old close event canceled the newer confirmation');h.nodes.confirmYes.onclick();assert.equal(await b,true);
});

// Complete production editor for timing interleavings. This reuses the parent's
// editor/DOM fixture and its explicitly fault-injected storage adapter. Image
// decode below is intentionally a 24x18 controlled fake; no pixel claim here.
async function editorTiming() {
 const {harness}=require('./helpers/project-library-harness.cjs'),h=harness();
 h.env.Image=class {set src(url){if(!url)return;queueMicrotask(()=>{this.naturalWidth=24;this.naturalHeight=18;this.onload?.();});}};
 const file=h.file('editor-current.png',24,18);await h.load(file);assert(h.state.sourceAsset,h.$('toast').textContent);
 const targetProject=h.env.ProjectCore.makeProject({...h.state.sourceAsset,name:'editor-target.png'},[],[]);
 const target=await h.store.save({name:'目标',record:targetProject});
 return Object.assign(h,{target});
}
test('complete editor: autosave timer firing during open cannot overwrite the just-opened named snapshot',async()=>{
 const h=await editorTiming();h.commit(h.realm({type:'rotate'}));const oldTimer=[...h.timers.values()].find(x=>x.delay===350);assert(oldTimer);
 const opening=h.library.open(h.target.id);await until(()=>h.$('confirmDialog').open);await h.flush(350);assert.equal(h.library.pending,true);
 h.$('confirmYes').click();assert.equal(await opening,true);assert.equal(h.state.sourceAsset.name,'editor-target.png');assert.equal((await h.store.readDraft()).source.name,'editor-target.png');
 // Even an already-dispatched callback that clearTimeout cannot remove reads
 // current editor state rather than closing over the previous photograph.
 await oldTimer.fn();assert.equal((await h.store.readDraft()).source.name,'editor-target.png');assert.equal(h.env.__probe.savedDraftRevision,h.state.projectRevision);
});
test('complete editor: cancelling a switch reschedules the autosave skipped while confirmation was pending',async()=>{
 const h=await editorTiming();h.commit(h.realm({type:'rotate'}));const expected=JSON.stringify(h.state.ops),opening=h.library.open(h.target.id);await until(()=>h.$('confirmDialog').open);
 await h.flush(350);h.$('confirmNo').click();assert.equal(await opening,false);assert([...h.timers.values()].some(x=>x.delay===350));await h.flush(350);
 const draft=await h.store.readDraft();assert.equal(draft.source.name,'editor-current.png');assert.equal(JSON.stringify(draft.ops),expected);assert.equal(h.env.__probe.savedDraftRevision,h.state.projectRevision);
});
test('complete editor: a pre-existing in-flight autosave commits before replacement and cannot win afterward',async()=>{
 const h=await editorTiming();h.commit(h.realm({type:'rotate'}));h.backend.state.deferCommit=true;const saving=h.env.__probe.saveDraftNow();await until(()=>h.backend.state.commits.length===1);
 const opening=h.library.open(h.target.id);assert.equal(h.library.pending,true);h.backend.state.releaseCommits();await saving;await until(()=>h.$('confirmDialog').open);h.$('confirmYes').click();assert.equal(await opening,true);
 await h.flush(350);assert.equal((await h.store.readDraft()).source.name,'editor-target.png');assert.equal(h.state.sourceAsset.name,'editor-target.png');const all=await h.store.list({includeTrash:true}),recovery=all.find(x=>x.trashedAt!==null);assert(recovery);assert.equal((await h.store.get(recovery.id)).record.ops.length,1);
});
test('complete editor: Back during project confirmation resolves open false, releases busy and leaves edit usable',async()=>{
 const h=await editorTiming();h.commit(h.realm({type:'rotate'}));const opening=h.library.open(h.target.id);await until(()=>h.$('confirmDialog').open);assert.equal(h.env.requestClose(),true);assert.equal(await opening,false);assert.equal(h.library.pending,false);assert.equal(h.$('busy').hidden,true);assert.equal(h.state.sourceAsset.name,'editor-current.png');assert.equal(h.commit(h.realm({type:'flip',axis:'x'})),true);
});

test('regression: 30 untouched imports do not fill the 24 project slots with production storage',async()=>{
 const h=controller();h.blank();for(let n=1;n<=30;n++){const p=record('photo-'+n);p.ops=[];p.redo=[];await h.api.importFile(p);}
 assert.equal(h.current.source.name,'photo-30');assert.equal((await h.store.usage()).count,0);assert.equal(h.events.filter(x=>x[0]==='confirm').length,0);
 h.edit();const p=record('next');p.ops=[];p.redo=[];await h.api.importFile(p);assert.equal((await h.store.usage()).count,1);
 const trash=(await h.api.refresh()).trash;assert.equal((await h.store.get(trash[0].id)).record.ops.length,1);
 await h.api.emptyTrash();assert.equal((await h.store.usage()).count,0);assert.equal(h.current.source.name,'next');assert.equal((await h.store.readDraft()).source.name,'next');
});
