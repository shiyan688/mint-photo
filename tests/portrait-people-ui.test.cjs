'use strict';
// Production UI + real strict core in a controlled DOM. Not a device/model test.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assets=path.join(__dirname,'../app/src/main/assets');
const shippedCore=path.join(assets,'portrait-people.js');
const corePath=fs.existsSync(shippedCore)?shippedCore:path.resolve(__dirname,'../../../portrait-people-candidate/portrait-people.js');
const coreSource=fs.readFileSync(corePath,'utf8'),uiSource=fs.readFileSync(path.join(assets,'portrait-people-ui.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function mesh(cx=.3,cy=.45,rx=.1,ry=.2){return Array.from({length:478},(_,i)=>{const t=i*2*Math.PI/478;return{x:cx+Math.cos(t)*rx,y:cy+Math.sin(t)*ry,z:0};});}
function harness({phase='beauty',missingCore=false,missingPanel=false}={}){
 const nodes={},notices=[],hints=[],requests=[],confirmations=[],renders=[];
 let draft=null,revision=7,base={width:900,height:600},serial=0,manualCalls=0,onRender=null;
 function element(id,attrs={}){
  const classes=new Set((attrs.class||'').split(/\s+/).filter(Boolean)),children=[];
  const node={id,value:attrs.value||'',textContent:'',disabled:'disabled'in attrs,hidden:'hidden'in attrs,dataset:{},children,isConnected:true,focus(){env.document.activeElement=this;},
   classList:{contains:name=>classes.has(name),toggle(name,yes){if(yes)classes.add(name);else classes.delete(name);}},
   setAttribute(name,value){this[name]=value;},click(){assert(!this.disabled,'Clicked disabled #'+id);return this.onclick?.({target:this});}};
  for(const [key,value]of Object.entries(attrs))if(key.startsWith('data-'))node.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  Object.defineProperty(node,'innerHTML',{get(){return this.markup||'';},set(markup){this.markup=markup;for(const child of children)remove(child);children.length=0;
   for(const match of markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)){
    const attrs={};for(const attr of match[2].matchAll(/([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g))attrs[attr[1]]=attr[2]??'';
    children.push(element(match[3],attrs));
   }
  }});nodes[id]=node;return node;
 }
 function remove(node){node.isConnected=false;for(const child of node.children)remove(child);if(nodes[node.id]===node)delete nodes[node.id];}
 element('toolPanel');element('editLabel');if(!missingPanel)element('faceSelectionPanel',{hidden:''});
 const env={console,Uint8Array,Uint8ClampedArray,ArrayBuffer,document:{getElementById:id=>nodes[id]||null}};env.window=env;vm.createContext(env);
 if(!missingCore)vm.runInContext(coreSource,env,{filename:path.basename(corePath)});
 vm.runInContext(uiSource,env,{filename:'portrait-people-ui.js'});
 const A={revision:()=>revision,getDraft:()=>draft,setDraft:value=>{draft=value;},getCanvas:()=>base,size:()=>({w:base.width,h:base.height}),
  render(){renders.push(true);onRender?.();},toast:text=>notices.push(text),hint:text=>hints.push(text),busy(){},
  confirm(title,description,yes){confirmations.push({title,description,yes});},
  detectFaces(after,force=false){requests.push({after,force});},manualSkin(){manualCalls++;}};
 const ui=env.PortraitPeopleUI;ui.setup(A,phase);
 const h={env,ui,A,nodes,notices,hints,requests,confirmations,renders,get core(){return env.MintPortraitPeople;},get draft(){return draft;},set draft(v){draft=v;},get base(){return base;},get manualCalls(){return manualCalls;},
  changeRevision(value){revision=value;},changeCanvas(value={width:900,height:600}){base=value;},onRender(fn){onRender=fn;},
  click(id){assert(nodes[id],'Missing #'+id);return nodes[id].click();},input(key,value){const node=nodes['p-'+key];assert(node,'Missing slider '+key);node.value=String(value);node.oninput({target:node});},
  respond(batch,index=requests.length-1){requests[index].after(batch);},
  batch(count=2,options={}){const value={sourceRevision:String(options.revision??revision),batchId:options.batchId||'detected-'+(++serial),landmarks:options.meshes||Array.from({length:count},(_,i)=>mesh(.2+i*.45,.45,.1,.2))};env.__data=JSON.stringify(value);return vm.runInContext('MintPortraitPeople.createBatch({...JSON.parse(__data),detector:MintPortraitPeople.DEFAULT_DETECTOR,detectionSize:{width:900,height:600}})',env);},
  detect(batch=this.batch()){this.click('detectPortrait');this.respond(batch);return batch;},snapshot(){env.__data=JSON.stringify(draft);return vm.runInContext('JSON.parse(__data)',env);},
  stroke(points,cancelled=false){const d=draft,q=ui.start(d,points[0]);for(const p of points.slice(1,-1))ui.move(d,p,q);ui.finish(d,points.at(-1),q,cancelled);return q;}
 };return h;
}
function face(h,id=1){return h.draft.batch.faces.find(f=>f.id==='face-'+id);}
function overlayContext(){const calls=[];return{calls,save(){},restore(){},setLineDash(){},strokeRect(...args){calls.push(['box',...args]);},fillRect(...args){calls.push(['label-box',...args]);},fillText(...args){calls.push(['text',...args]);}};}

test('both phases begin with a strict empty zero-effect batch, disabled controls and no selection metadata',()=>{
 for(const phase of ['beauty','reshape']){const h=harness({phase}),d=h.draft;assert.equal(d.type,'portrait-people');assert.equal(d.phase,phase);assert.equal(d.batch.sourceRevision,'7');assert.deepEqual(plain(d.batch.faces),[]);assert.equal(h.ui.changed(d),false);assert.deepEqual(Object.keys(d).sort(),['batch','phase','type']);assert(h.nodes[phase==='beauty'?'p-smooth':'p-slim'].disabled);assert.match(h.nodes.toolPanel.innerHTML,/900/);assert.match(h.nodes.toolPanel.innerHTML,/5 张脸/);assert.match(h.nodes.toolPanel.innerHTML,/不追踪身份/);h.core.validateBatch(d.batch);}
});
test('real core preserves every byte for neutral selected and unselected UI batches',()=>{
 const h=harness();h.detect(h.batch(2));h.click('person-face-2');h.env.__batch=h.draft.batch;
 const identity=vm.runInContext(`(()=>{const data=new Uint8ClampedArray([19,37,61,0,23,47,71,255]),im={width:2,height:1,data};const p=MintPortraitPeople.createProcessor({engine:{beauty(){throw Error('Must not run neutral beauty');},reshape(){throw Error('Must not run neutral reshape');}}});return ['beauty','reshape'].map(phase=>{const out=phase==='beauty'?p.applyBeauty(im,__batch,{sourceRevision:'7'}):p.applyReshape(im,__batch,{sourceRevision:'7'});return Array.from(out.data);});})()`,h.env);
 assert.deepEqual(plain(identity),[[19,37,61,0,23,47,71,255],[19,37,61,0,23,47,71,255]]);assert.equal(h.ui.changed(h.draft),false);
});
test('multiple faces require explicit selection; disabled-handler events cannot change any face',()=>{
 const h=harness();h.detect(h.batch(2));assert(h.nodes['p-smooth'].disabled);assert(!h.nodes['person-face-1'].classList.contains('selected'));assert(!h.nodes['person-face-2'].classList.contains('selected'));h.input('smooth',45);h.nodes.beautyPreset.onclick();assert.equal(h.ui.changed(h.draft),false);assert.match(h.nodes.portraitStatus.textContent,/不会默认/);
 for(const f of h.draft.batch.faces){assert.deepEqual(plain(f.beauty),plain(h.core.defaultsBeauty()));assert.deepEqual(plain(f.reshape),plain(h.core.defaultsReshape()));}
});
test('one face visibly auto-selects, but all values remain zero until the user changes a control',()=>{
 const h=harness();h.detect(h.batch(1));assert(h.nodes['person-face-1'].classList.contains('selected'));assert.equal(h.nodes['person-face-1']['aria-pressed'],'true');assert(!h.nodes['p-smooth'].disabled);assert.equal(h.ui.changed(h.draft),false);assert.match(h.nodes.portraitStatus.textContent,/第 1 人/);
});
test('two people preserve independent controls and palette while switching, without dropping inactive neighbors',()=>{
 const h=harness();h.detect(h.batch(2));h.click('person-face-1');h.input('smooth',27);h.input('warmth',-36);h.click('paletteRose');const snapshot=h.draft.batch;
 h.click('person-face-2');assert.equal(h.nodes['p-smooth'].value,'0');assert.equal(h.nodes['pv-smooth'].textContent,'0');h.input('brighten',16);h.input('lip',21);h.click('palettePeach');
 assert.equal(face(h,1).beauty.smooth,27);assert.equal(face(h,1).beauty.palette,'rose');assert.equal(face(h,2).beauty.smooth,0);assert.equal(face(h,2).beauty.brighten,16);assert.equal(h.draft.batch.faces.length,2);
 h.click('person-face-1');assert.equal(h.nodes['p-smooth'].value,'27');assert.equal(h.nodes['p-brighten'].value,'0');assert.equal(h.nodes['p-warmth'].value,'-36');assert(h.nodes.paletteRose.classList.contains('active'));assert(!h.nodes.palettePeach.classList.contains('active'));
 assert.equal(snapshot.faces[1].beauty.brighten,0,'previous complete batch snapshot remains immutable');assert.equal(h.ui.changed(h.draft),true);assert.deepEqual(Object.keys(h.draft).sort(),['batch','phase','type']);
});
test('presets and per-person reset affect only the selected face; all reset clears this phase',()=>{
 const h=harness();h.detect(h.batch(2));h.click('person-face-1');h.input('brighten',50);h.click('person-face-2');h.click('beautyPreset');assert.equal(face(h,1).beauty.brighten,50);assert.equal(face(h,1).beauty.lip,0);assert.equal(face(h,2).beauty.lip,18);assert.equal(face(h,2).beauty.palette,'peach');h.click('resetPortrait');assert.equal(face(h,1).beauty.brighten,50);assert.deepEqual(plain(face(h,2).beauty),plain(h.core.defaultsBeauty()));h.click('resetAllPeople');assert.equal(h.ui.changed(h.draft),false);assert(h.nodes.resetAllPeople.disabled);
});
test('reshape uses independent strict ranges, and invalid programmatic values are rejected',()=>{
 const h=harness({phase:'reshape'});h.detect(h.batch(2));h.click('person-face-1');h.input('slim',60);h.input('nose',-50);h.click('person-face-2');h.input('eyes',31);h.input('jaw',50);assert.equal(face(h,1).reshape.slim,60);assert.equal(face(h,2).reshape.slim,0);assert.equal(face(h,1).reshape.nose,-50);assert.equal(face(h,2).reshape.jaw,50);
 const before=JSON.stringify(h.draft);for(const [key,value]of [['slim',61],['nose',-51],['eyes','NaN'],['jaw','Infinity']])h.input(key,value);assert.equal(JSON.stringify(h.draft),before);assert.equal(h.nodes['p-slim'].value,'0');assert.equal(h.nodes['p-jaw'].value,'50');assert.match(h.notices.at(-1),/范围/);assert.equal(h.nodes.manualSkin,undefined);
});
test('beauty range matches the strict core including warmth ±100',()=>{
 const h=harness();h.detect(h.batch(1));h.input('warmth',-100);assert.equal(face(h).beauty.warmth,-100);h.input('warmth',100);assert.equal(face(h).beauty.warmth,100);h.input('smooth',101);assert.equal(face(h).beauty.smooth,0);h.input('lip',-1);assert.equal(face(h).beauty.lip,0);assert.equal(h.nodes['p-warmth'].value,'100');
});
test('redetection is staged, declines preserve edits, and explicit acceptance installs an entirely neutral fresh batch',()=>{
 const h=harness();h.detect(h.batch(2));h.click('person-face-2');h.input('smooth',41);const before=JSON.stringify(h.draft);h.click('detectPortrait');assert.equal(h.requests.at(-1).force,true);assert.equal(JSON.stringify(h.draft),before);
 const fresh=h.batch(2,{meshes:[mesh(.65),mesh(.2)]});fresh.faces[0].beauty.smooth=77;fresh.faces[1].reshape.eyes=12;h.respond(fresh);assert.equal(h.confirmations.length,1);assert.equal(JSON.stringify(h.draft),before,'staging does not discard current settings');h.respond(fresh);assert.equal(h.confirmations.length,1,'duplicate callback cannot duplicate confirmation');
 h.confirmations[0].yes();assert.equal(h.draft.batch.batchId,fresh.batchId);assert.equal(h.ui.changed(h.draft),false);assert.equal(h.core.hasEffect(h.draft.batch,'reshape'),false);assert(h.nodes['p-smooth'].disabled);assert(!h.nodes['person-face-1'].classList.contains('selected'));assert(!h.nodes['person-face-2'].classList.contains('selected'));h.confirmations[0].yes();assert.equal(h.ui.changed(h.draft),false);
 for(const f of h.draft.batch.faces){assert.deepEqual(plain(f.beauty),plain(h.core.defaultsBeauty()));assert.deepEqual(plain(f.reshape),plain(h.core.defaultsReshape()));}
});
test('redetection never accepts reused batch ID or invalid detection, and keeps old controls unchanged',()=>{
 const h=harness();const original=h.detect(h.batch(1));h.input('smooth',19);const before=JSON.stringify(h.draft);h.click('detectPortrait');h.respond(original);assert.equal(JSON.stringify(h.draft),before);assert.match(h.notices.at(-1),/新批次/);assert.equal(h.confirmations.length,0);
 h.click('detectPortrait');const malformed=h.batch(1);malformed.faces[0].id='face-9';h.respond(malformed);assert.equal(JSON.stringify(h.draft),before);assert.equal(h.confirmations.length,0);
});
test('only the latest asynchronous detection can install, and a later request invalidates an old reset confirmation',()=>{
 const h=harness();h.click('detectPortrait');const first=h.batch(1);h.click('detectPortrait');const second=h.batch(2);h.respond(second,1);h.respond(first,0);assert.equal(h.draft.batch.batchId,second.batchId);
 h.click('person-face-1');h.input('smooth',25);h.click('detectPortrait');const third=h.batch(1);h.respond(third);const oldConfirm=h.confirmations.at(-1);h.click('detectPortrait');const fourth=h.batch(2);h.respond(fourth);oldConfirm.yes();assert.equal(h.draft.batch.batchId,second.batchId);h.confirmations.at(-1).yes();assert.equal(h.draft.batch.batchId,fourth.batchId);
});
test('stale detection callbacks cannot cross draft, phase, canvas, revision or release boundaries',()=>{
 for(const change of [h=>{h.draft={type:'other'};},h=>{h.draft.phase='reshape';},h=>h.changeCanvas(),h=>h.changeRevision(8),h=>h.ui.release()]){
  const h=harness();h.click('detectPortrait');const batch=h.batch(2),old=h.draft;change(h);h.respond(batch);assert.equal(old.batch.faces.length,0);assert.equal(h.confirmations.length,0);
 }
 const h=harness();h.click('detectPortrait');const batch=h.batch(1);h.ui.setup(h.A,'reshape');const before=JSON.stringify(h.draft);h.respond(batch);assert.equal(JSON.stringify(h.draft),before);
});
test('reset confirmation is also stale-guarded and zero-face results stay non-effective',()=>{
 for(const change of [h=>h.changeCanvas(),h=>h.changeRevision(8),h=>{h.draft={type:'other'};},h=>h.ui.release()]){const h=harness();h.detect(h.batch(1));h.input('smooth',24);const old=h.draft,before=JSON.stringify(old);h.click('detectPortrait');h.respond(h.batch(0));change(h);h.confirmations.at(-1).yes();assert.equal(JSON.stringify(old),before);}
 const h=harness();h.detect(h.batch(0));assert.equal(h.ui.changed(h.draft),false);assert(h.nodes['p-smooth'].disabled);assert.match(h.nodes.portraitStatus.textContent,/未识别到/);h.click('detectPortrait');assert.equal(h.requests.at(-1).force,true);
});
test('generic multi-face picker preserves the live draft and requires one explicit number, exactly once',()=>{
 const h=harness();h.detect(h.batch(2));h.click('person-face-1');h.input('brighten',18);const before=JSON.stringify(h.draft),calls=[],batch=h.batch(2);assert(h.ui.choose(batch,h.A,(...args)=>calls.push(args)));assert.equal(calls.length,0);assert(h.ui.selectionActive());assert.equal(h.nodes.faceSelectionPanel.hidden,false);assert.equal(JSON.stringify(h.draft),before);
 const click=h.nodes['choose-face-2'].onclick;batch.faces[1].landmarks[0].x=.99;h.click('choose-face-2');assert.equal(calls.length,1);assert.equal(calls[0][1].faceId,'face-2');assert.notEqual(calls[0][0][0].x,.99);assert.equal(calls[0][1].batch.faces.length,2);assert.equal(JSON.stringify(h.draft),before);assert.equal(h.ui.selectionActive(),false);assert.equal(h.nodes.faceSelectionPanel.hidden,true);click();assert.equal(calls.length,1);
 calls[0][1].batch.faces[0].beauty.smooth=99;assert.equal(batch.faces[0].beauty.smooth,0,'callback snapshot is detached');assert.equal(face(h,1).beauty.smooth,0,'live controls are separate');
});
test('generic single face may return directly, but no-face and stale batches never call back',()=>{
 const h=harness(),calls=[];const b=h.batch(1);h.ui.choose(b,h.A,(...args)=>calls.push(args));assert.equal(calls.length,1);assert.equal(calls[0][1].faceId,'face-1');assert.equal(h.ui.selectionActive(),false);h.ui.choose(h.batch(0),h.A,(...args)=>calls.push(args));h.ui.choose(h.batch(1,{revision:6}),h.A,(...args)=>calls.push(args));assert.equal(calls.length,1);
});
test('generic cancel, replacement and release clear pending callbacks and visible overlays',()=>{
 const h=harness(),calls=[];h.ui.choose(h.batch(2),h.A,()=>calls.push('old'));const old=h.nodes['choose-face-1'].onclick;h.click('cancelFaceSelection');old();assert.deepEqual(calls,[]);assert.equal(h.ui.selectionActive(),false);const ctx=overlayContext();h.ui.overlaySelection(ctx,900,600);assert.deepEqual(ctx.calls,[]);
 h.ui.choose(h.batch(2),h.A,()=>calls.push('old'));const stale=h.nodes['choose-face-2'].onclick;h.ui.choose(h.batch(2),h.A,()=>calls.push('new'));stale();assert.deepEqual(calls,[]);h.click('choose-face-1');assert.deepEqual(calls,['new']);
 h.ui.choose(h.batch(2),h.A,()=>calls.push('released'));const released=h.nodes['choose-face-1'].onclick;h.ui.release();released();assert.deepEqual(calls,['new']);assert.equal(h.nodes.faceSelectionPanel.hidden,true);
});
test('generic selection refuses stale canvas, revision and draft references, even if canvas dimensions match',()=>{
 for(const change of [h=>h.changeCanvas(),h=>h.changeRevision(8),h=>{h.draft={...h.draft};}]){const h=harness(),calls=[];h.ui.choose(h.batch(2),h.A,()=>calls.push(true));const click=h.nodes['choose-face-1'].onclick;change(h);click();assert.deepEqual(calls,[]);assert.equal(h.ui.selectionActive(),false);assert.equal(h.nodes.faceSelectionPanel.hidden,true);}
 const h=harness(),calls=[];h.onRender(()=>{h.draft={type:'changed-during-cleanup'};});h.ui.choose(h.batch(1),h.A,()=>calls.push(true));assert.deepEqual(calls,[]);
});
test('missing generic selector panel fails closed rather than picking index zero',()=>{
 const h=harness({missingPanel:true}),calls=[];assert.equal(h.ui.choose(h.batch(2),h.A,()=>calls.push(true)),false);assert.deepEqual(calls,[]);assert.equal(h.ui.selectionActive(),false);assert.match(h.notices.at(-1),/未默认选择/);
});
test('tap selection is deferred until pointerup; cancellation, movement and repeated finish do not select',()=>{
 const h=harness();h.detect(h.batch(2));const before=JSON.stringify(h.draft),d=h.draft,q=h.ui.start(d,{x:.2,y:.45});assert(!h.nodes['person-face-1'].classList.contains('selected'));assert.equal(JSON.stringify(d),before);h.ui.finish(d,{x:.2,y:.45},q,true);h.ui.finish(d,{x:.2,y:.45},q,false);assert(!h.nodes['person-face-1'].classList.contains('selected'));
 h.stroke([{x:.2,y:.45},{x:.24,y:.45},{x:.2,y:.45}]);assert(!h.nodes['person-face-1'].classList.contains('selected'));h.stroke([{x:.2,y:.45}]);assert(h.nodes['person-face-1'].classList.contains('selected'));assert.equal(JSON.stringify(d),before);assert.equal(h.ui.changed(d),false);
 const q2=h.ui.start(d,{x:.65,y:.45});h.click('person-face-1');h.ui.finish(d,{x:.65,y:.45},q2,false);assert(h.nodes['person-face-1'].classList.contains('selected'),'a new explicit selection invalidates retained gesture');
});
test('overlapping bounding boxes never silently choose the first face; numbered buttons remain available',()=>{
 const h=harness();h.detect(h.batch(2,{meshes:[mesh(.45,.45,.2,.2),mesh(.55,.45,.2,.2)]}));h.stroke([{x:.5,y:.45}]);assert(!h.nodes['person-face-1'].classList.contains('selected'));assert(!h.nodes['person-face-2'].classList.contains('selected'));assert.match(h.nodes.portraitStatus.textContent,/重叠/);h.click('person-face-2');h.input('smooth',13);assert.equal(face(h,1).beauty.smooth,0);assert.equal(face(h,2).beauty.smooth,13);
});
test('retained gestures and handlers cannot change released or redetected sessions',()=>{
 const h=harness();h.detect(h.batch(2));const d=h.draft,q=h.ui.start(d,{x:.2,y:.45}),click=h.nodes['person-face-1'].onclick,input=h.nodes['p-smooth'].oninput;h.ui.release();click();input({target:{value:'30'}});h.ui.finish(d,{x:.2,y:.45},q);assert.equal(h.ui.changed(d),false);h.ui.setup(h.A,'beauty');click();input({target:{value:'30'}});assert.equal(h.draft.batch.faces.length,0);
 h.detect(h.batch(2));const q2=h.ui.start(h.draft,{x:.2,y:.45});h.detect(h.batch(2));h.ui.finish(h.draft,{x:.2,y:.45},q2);assert(!h.nodes['person-face-1'].classList.contains('selected'));
});
test('overlays show all batch-local numbers, hide during generic selection, and never alter operations',()=>{
 const h=harness();h.detect(h.batch(2));h.click('person-face-2');const before=JSON.stringify(h.draft),ctx=overlayContext();h.ui.overlay(ctx,900,600,h.draft);assert.equal(ctx.calls.filter(c=>c[0]==='box').length,2);assert.deepEqual(ctx.calls.filter(c=>c[0]==='text').map(c=>c[1]),['1','2']);assert.equal(JSON.stringify(h.draft),before);
 h.ui.choose(h.batch(2),h.A,()=>{});const group=overlayContext();h.ui.overlay(group,900,600,h.draft);assert.equal(group.calls.length,0);const picker=overlayContext();h.ui.overlaySelection(picker,900,600);assert.equal(picker.calls.filter(c=>c[0]==='box').length,2);assert.equal(h.ui.start(h.draft,{x:.2,y:.45}),null);h.ui.cancelSelection();h.ui.overlaySelection(picker,900,600);assert.equal(picker.calls.filter(c=>c[0]==='box').length,2);
});
test('manual fallback delegates confirmation and switching, without itself clearing edited group data',()=>{
 const h=harness();h.detect(h.batch(1));h.input('smooth',32);const before=JSON.stringify(h.draft);h.click('manualSkin');assert.equal(h.manualCalls,1);assert.equal(JSON.stringify(h.draft),before);assert.equal(h.confirmations.length,0);
});
test('missing core fails closed and stale-source detection does not install or ask to discard',()=>{
 const missing=harness({missingCore:true});assert.equal(missing.draft,null);assert.match(missing.notices.at(-1),/未加载/);
 const h=harness();h.detect(h.batch(1));h.input('smooth',18);const before=JSON.stringify(h.draft);h.click('detectPortrait');h.respond(h.batch(1,{revision:8}));assert.equal(JSON.stringify(h.draft),before);assert.equal(h.confirmations.length,0);assert.match(h.notices.at(-1),/different source revision/);
});
test('export assessment blocks Apply if both dimensions fail, preserving all per-face parameters',()=>{
 const h=harness();h.detect(h.batch(2));h.click('person-face-2');h.input('smooth',41);const before=JSON.stringify(h.draft);let calls=0;
 h.A.assess=d=>{calls++;assert.equal(d,h.draft);return{original:{allowed:false,error:'原尺寸内存超限'},working:{allowed:false,error:'工作尺寸分配超限'}};};
 assert.equal(h.ui.canApply(h.draft),false);assert.match(h.nodes.portraitStatus.textContent,/原尺寸和工作尺寸/);assert.match(h.nodes.portraitStatus.textContent,/减少同时调整的人数/);assert.match(h.nodes.portraitStatus.textContent,/工作尺寸分配超限/);assert.equal(JSON.stringify(h.draft),before);
 h.nodes.portraitStatus.textContent='当前预览的具体失败原因';assert.equal(h.ui.canApply(h.draft),false);assert.equal(h.nodes.portraitStatus.textContent,'当前预览的具体失败原因','unchanged assessment must not erase a more specific status on every render');assert.equal(calls,2);
 h.click('person-face-1');assert.match(h.nodes.portraitStatus.textContent,/原尺寸和工作尺寸/);assert.equal(JSON.stringify(h.draft),before);
});
test('working-only export is explicit, original-only remains allowed, and successful recovery clears budget warning',()=>{
 const h=harness();h.detect(h.batch(1));h.input('smooth',20);const before=JSON.stringify(h.draft);
 h.A.assess=()=>({original:{allowed:false,error:'原尺寸受限'},working:{allowed:true}});assert.equal(h.ui.canApply(h.draft),true);assert.match(h.nodes.portraitStatus.textContent,/原尺寸受限，可用工作尺寸/);assert.match(h.nodes.portraitStatus.textContent,/不会自动缩小/);assert.equal(JSON.stringify(h.draft),before);
 h.A.assess=()=>({original:{allowed:true},working:{allowed:false}});assert.equal(h.ui.canApply(h.draft),true);assert.doesNotMatch(h.nodes.portraitStatus.textContent,/原尺寸受限/);assert.match(h.nodes.portraitStatus.textContent,/第 1 人/);
 h.A.assess=()=>({original:{allowed:true},working:{allowed:true}});assert.equal(h.ui.canApply(h.draft),true);assert.equal(JSON.stringify(h.draft),before);
});
test('assessment exceptions or malformed results fail closed; no assessor preserves default UI allowance',()=>{
 const h=harness();assert.equal(h.ui.canApply(h.draft),true);h.A.assess=()=>{throw Error('导出计划不可用');};assert.equal(h.ui.canApply(h.draft),false);assert.match(h.nodes.portraitStatus.textContent,/检查失败/);assert.match(h.nodes.portraitStatus.textContent,/导出计划不可用/);
 for(const result of [null,{}, {original:{allowed:'yes'},working:{allowed:1}}]){h.A.assess=()=>result;assert.equal(h.ui.canApply(h.draft),false);}
 const d=h.draft;h.ui.release();assert.equal(h.ui.canApply(d),false);
});
test('generic picker announces required choice, focuses a numbered control without choosing it, and restores trigger focus',()=>{
 const h=harness(),calls=[],trigger=h.nodes.detectPortrait;trigger.focus();h.ui.choose(h.batch(2),h.A,()=>calls.push(true));assert.equal(h.env.document.activeElement,h.nodes['choose-face-1']);assert.equal(calls.length,0);assert.match(h.nodes.faceSelectionPanel.innerHTML,/aria-live="polite"/);assert.match(h.nodes.faceSelectionPanel.innerHTML,/aria-describedby="faceSelectionStatus"/);h.click('cancelFaceSelection');assert.equal(h.env.document.activeElement,trigger);assert.equal(calls.length,0);
 h.ui.choose(h.batch(2),h.A,()=>calls.push(true));h.click('choose-face-2');assert.equal(h.env.document.activeElement,trigger);assert.equal(calls.length,1);
});
test('picker cancels unfinished gestures before binding its preserved draft reference',()=>{
 const h=harness(),calls=[];const original=h.draft;h.A.cancelPointer=()=>{h.draft={type:'idphoto',selected:true,x:.2,y:.1,w:.5,h:.7};};h.ui.choose(h.batch(2),h.A,(lm,context)=>calls.push(context));const preserved=h.draft;assert.notEqual(preserved,original);assert.equal(calls.length,0);h.click('choose-face-2');assert.equal(calls.length,1);assert.equal(h.draft,preserved);assert.equal(h.draft.x,.2);
 h.A.cancelPointer=()=>{throw Error('rollback failed');};assert.equal(h.ui.choose(h.batch(2),h.A,()=>calls.push(true)),false);assert.equal(h.ui.selectionActive(),false);assert.equal(calls.length,1);assert.match(h.notices.at(-1),/未完成手势/);
});

// Inspect actual generated nesting separately from the deliberately flat DOM
// adapter above. A misplaced closing tag/wrapper must not be hidden by that fake.
function markupShape(markup){
 const stack=[],ids=new Map(),details=[],voids=new Set(['input','br','hr','img','meta','link']);
 for(const match of markup.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)){
  const tag=match[2].toLowerCase();
  if(match[1]){assert.equal(stack.at(-1)?.tag,tag,'balanced closing '+tag);stack.pop();continue;}
  const attrs={};for(const a of match[3].matchAll(/([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]??'';
  const node={tag,attrs,parents:stack.slice(),children:[]};if(stack.length)stack.at(-1).children.push(node);
  if(attrs.id){assert(!ids.has(attrs.id),'duplicate #'+attrs.id);ids.set(attrs.id,node);}if(tag==='details')details.push(node);
  if(!voids.has(tag)&&!match[3].endsWith('/'))stack.push(node);
 }
 assert.equal(stack.length,0,'all generated containers close');return{ids,details};
}

test('generated portrait markup puts basic controls outside closed advanced sections with valid nesting',()=>{
 const h=harness(),shape=markupShape(h.nodes.toolPanel.innerHTML);
 for(const id of ['detectPortrait','manualSkin','portraitStatus','portraitPeople','naturalPreset','beautyPreset','p-smooth','p-brighten','p-warmth','resetPortrait','resetAllPeople']){
  assert(shape.ids.has(id),'retained '+id);assert(!shape.ids.get(id).parents.some(p=>p.tag==='details'),'immediately available '+id);
 }
 for(const [id,parent]of [['p-redness','portraitComplexionDetails'],['p-underEye','portraitComplexionDetails'],['p-lip','portraitMakeupDetails'],['p-blush','portraitMakeupDetails'],['paletteNatural','portraitMakeupDetails'],['palettePeach','portraitMakeupDetails'],['paletteRose','portraitMakeupDetails']])assert(shape.ids.get(id).parents.some(p=>p.attrs.id===parent),'correct drawer '+id);
 assert.equal(shape.details.length,4);for(const detail of shape.details){assert(!('open'in detail.attrs));assert.equal(detail.children[0]?.tag,'summary');assert(detail.parents.some(p=>(p.attrs.class||'').split(' ').includes('tool-help')));}
 const html=h.nodes.toolPanel.innerHTML;assert(html.indexOf('id="portraitPeople"')<html.indexOf('id="naturalPreset"'));assert(html.indexOf('id="p-warmth"')<html.indexOf('id="portraitMakeupDetails"'));
 const reshape=markupShape(harness({phase:'reshape'}).nodes.toolPanel.innerHTML);assert.equal(reshape.details.length,1);for(const id of ['p-slim','p-eyes','p-nose','p-jaw'])assert(!reshape.ids.get(id).parents.some(p=>p.tag==='details'));
});

test('browser hint is short and its visible manual entry still delegates real work',()=>{
 const h=harness();assert.match(h.nodes.portraitStatus.textContent,/浏览器.*手动圈定/);assert(h.nodes.portraitStatus.textContent.length<50);assert(!h.nodes.manualSkin.disabled);h.click('manualSkin');assert.equal(h.manualCalls,1);
 h.click('detectPortrait');assert.match(h.nodes.portraitStatus.textContent,/安卓应用/);assert(h.nodes.portraitStatus.textContent.length<50);
 h.env.Android={analyzePortrait(){}};h.ui.setup(h.A,'beauty');assert.match(h.nodes.portraitStatus.textContent,/先识别人脸/);h.detect(h.batch(1));assert.equal(h.nodes.detectPortrait.textContent,'↻ 重新识别');
});

test('collapsed makeup retains active preset values, face switching and the same recipe',()=>{
 const h=harness();h.detect(h.batch(2));h.click('person-face-1');h.click('beautyPreset');const before=JSON.stringify(h.draft);
 h.nodes.portraitMakeupDetails.open=true;assert.equal(JSON.stringify(h.draft),before);assert.equal(h.nodes['p-lip'].value,'18');h.input('lip',24);h.nodes.portraitMakeupDetails.open=false;
 h.click('person-face-2');assert.equal(face(h,2).beauty.lip,0);h.click('person-face-1');assert.equal(h.nodes['p-lip'].value,'24');assert.equal(face(h,1).beauty.palette,'peach');
});
