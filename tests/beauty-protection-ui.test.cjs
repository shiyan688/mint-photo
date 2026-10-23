'use strict';
// Real production UI and strict protection/people/mask modules in a controlled DOM.
// This is deterministic UI logic coverage, not browser, model, or device evidence.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assets=path.join(__dirname,'../app/src/main/assets');
const plain=value=>JSON.parse(JSON.stringify(value));
function mesh(cx=.25,cy=.45,rx=.1,ry=.2){return Array.from({length:478},(_,i)=>{const t=i*2*Math.PI/478;return{x:cx+Math.cos(t)*rx,y:cy+Math.sin(t)*ry,z:0};});}
function harness({phase='beauty',missingProtection=false}={}){
 const nodes={},notices=[],requests=[],confirmations=[],renders=[];
 let draft=null,revision=7,base={width:900,height:600},serial=0,manualCalls=0;
 function element(id,attrs={}){
  const classes=new Set((attrs.class||'').split(/\s+/).filter(Boolean)),children=[];
  const node={id,value:attrs.value||'',textContent:'',disabled:'disabled'in attrs,hidden:'hidden'in attrs,checked:'checked'in attrs,dataset:{},children,isConnected:true,
   focus(){env.document.activeElement=this;},classList:{contains:name=>classes.has(name),toggle(name,yes){if(yes)classes.add(name);else classes.delete(name);}},
   setAttribute(name,value){this[name]=value;},click(){assert(!this.disabled,'Clicked disabled #'+id);return this.onclick?.({target:this});}};
  Object.defineProperty(node,'innerHTML',{get(){return this.markup||'';},set(markup){this.markup=markup;for(const child of children)remove(child);children.length=0;
   for(const match of markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)){const attrs={};for(const a of match[2].matchAll(/([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]??'';children.push(element(match[3],attrs));}
  }});nodes[id]=node;return node;
 }
 function remove(node){node.isConnected=false;for(const child of node.children)remove(child);if(nodes[node.id]===node)delete nodes[node.id];}
 element('toolPanel');element('editLabel');element('faceSelectionPanel',{hidden:''});
 const env={console,Uint8Array,Uint8ClampedArray,Float32Array,ArrayBuffer,document:{getElementById:id=>nodes[id]||null}};env.window=env;vm.createContext(env);
 for(const file of ['portrait-people.js','mask-refine.js',...(missingProtection?[]:['beauty-protection.js']),'portrait-people-ui.js'])vm.runInContext(fs.readFileSync(path.join(assets,file),'utf8'),env,{filename:file});
 if(!missingProtection)vm.runInContext('protectionCore=MintBeautyProtection.createCore({people:MintPortraitPeople,maskRefine:MintMaskRefine})',env);
 const A={revision:()=>revision,getDraft:()=>draft,setDraft:value=>{draft=value;},getCanvas:()=>base,size:()=>({w:base.width,h:base.height}),
  render(){renders.push(true);},toast:text=>notices.push(text),hint(){},confirm(title,description,yes){confirmations.push({title,description,yes});},
  detectFaces(after,force=false){requests.push({after,force});},manualSkin(){manualCalls++;}};
 const ui=env.PortraitPeopleUI;ui.setup(A,phase);
 return{env,ui,A,nodes,notices,requests,confirmations,renders,get core(){return env.MintPortraitPeople;},get P(){return env.protectionCore;},get draft(){return draft;},set draft(v){draft=v;},get base(){return base;},get manualCalls(){return manualCalls;},
  changeRevision(v){revision=v;},changeCanvas(value={width:900,height:600}){base=value;},click(id){assert(nodes[id],'Missing #'+id);return nodes[id].click();},
  input(key,value){const node=nodes['p-'+key];assert(node,'Missing slider '+key);node.value=String(value);node.oninput({target:node});},
  batch(count=2,options={}){const value={sourceRevision:String(options.revision??revision),batchId:options.batchId||'detected-'+(++serial),landmarks:options.meshes||Array.from({length:count},(_,i)=>mesh(.25+i*.45))};env.__data=JSON.stringify(value);return vm.runInContext('MintPortraitPeople.createBatch({...JSON.parse(__data),detector:MintPortraitPeople.DEFAULT_DETECTOR,detectionSize:{width:900,height:600}})',env);},
  respond(batch,index=requests.length-1){requests[index].after(batch);},detect(batch=this.batch()){this.click('detectPortrait');this.respond(batch);return batch;},
  choose(id=1){this.click('person-face-'+id);},paint(id=1){this.choose(id);this.click('beautyProtect');},
  stroke(points=[{x:.25,y:.45}],cancelled=false){const d=draft,q=ui.start(d,points[0]);for(const p of points.slice(1,-1))ui.move(d,p,q);ui.finish(d,points.at(-1),q,cancelled);return q;}
 };
}
const params=h=>JSON.stringify(h.draft.batch.faces.map(f=>({beauty:f.beauty,reshape:f.reshape})));
const entry=(h,id=1)=>h.draft.protection?.faces.find(f=>f.faceId==='face-'+id);
const chosen=(h,id)=>h.nodes['person-face-'+id].classList.contains('selected');
function context(){const calls=[];return{calls,save(){},restore(){},setLineDash(){},beginPath(){},moveTo(...a){calls.push(['move',...a]);},lineTo(...a){calls.push(['line',...a]);},arc(...a){calls.push(['arc',...a]);},stroke(){calls.push(['stroke']);},strokeRect(...a){calls.push(['box',...a]);},fillRect(){},fillText(){}};}

test('production beauty uses v2/null and explicit honest protection controls, while reshape and missing module stay legacy',()=>{
 const h=harness();assert.deepEqual(Object.keys(h.draft).sort(),['batch','phase','protection','type','version']);assert.equal(h.draft.version,2);assert.equal(h.draft.protection,null);assert.equal(h.ui.changed(h.draft),false);
 for(const text of ['选择人脸','涂抹保护','擦除保护','本轮美颜前','不撤销更早历史','不恢复五官变形','非生效范围','松开后查看实际美颜效果','至少 20'])assert.match(h.nodes.toolPanel.innerHTML,new RegExp(text));
 assert(h.nodes.beautyProtect.disabled);assert(h.nodes.beautyRestore.disabled);assert(h.nodes.undoBeautyProtection.disabled);h.nodes.beautyProtect.onclick();assert.equal(h.draft.protection,null);assert.match(h.notices.at(-1),/先点/);
 for(const options of [{phase:'reshape'},{missingProtection:true}]){const old=harness(options);assert.deepEqual(Object.keys(old.draft).sort(),['batch','phase','type']);assert.equal(old.nodes.beautyProtect,undefined);old.detect(old.batch(1));old.input(options.phase==='reshape'?'slim':'smooth',17);assert(old.ui.changed(old.draft));if(options.missingProtection)assert.match(old.nodes.toolPanel.innerHTML,/保护核心未加载/);}
});

test('auto-selection and tap-selection do not enable painting until a numbered button is explicitly chosen',()=>{
 const h=harness();h.detect(h.batch(1));assert(chosen(h,1));assert(!h.nodes['p-smooth'].disabled);assert(h.nodes.beautyProtect.disabled);assert(h.nodes['p-protectionRadius'].disabled);h.nodes.beautyProtect.onclick();assert.equal(h.draft.protection,null);h.paint();assert(!h.nodes.beautyProtect.disabled);
 const multi=harness();multi.detect();multi.stroke([{x:.7,y:.45}]);assert(chosen(multi,2));assert(multi.nodes.beautyProtect.disabled);multi.paint(2);assert(!multi.nodes.beautyProtect.disabled);assert.equal(multi.nodes.beautyProtect['aria-pressed'],'true');
});

test('painting across another numbered face never switches person or modifies neutral beauty parameters',()=>{
 const h=harness();h.detect();h.paint(1);const before=params(h),batch=JSON.stringify(h.draft.batch);h.stroke([{x:.25,y:.45},{x:.5,y:.5},{x:.7,y:.45}]);
 assert(chosen(h,1));assert(!chosen(h,2));assert(entry(h,1));assert.equal(entry(h,2),undefined);assert.equal(params(h),before);assert.equal(JSON.stringify(h.draft.batch),batch);assert.equal(h.ui.changed(h.draft),true);assert.equal(h.ui.canApply(h.draft),false);assert.match(h.nodes.portraitStatus.textContent,/参数仍为零/);
 h.input('smooth',23);h.A.assess=d=>{assert.equal(d,h.draft);return{original:{allowed:true},working:{allowed:true}};};assert.equal(h.ui.canApply(h.draft),true);assert.equal(h.draft.batch.faces[1].beauty.smooth,0);assert.equal(h.draft.batch.faces[0].beauty.palette,'natural');
});

test('unreleased stroke is preview-only: serialization, cancelled gesture and repeated pointerup never add a partial mask',()=>{
 const h=harness();h.detect();h.paint();h.input('brighten',14);h.stroke();h.click('undoBeautyProtection');const before=JSON.stringify(h.draft),q=h.ui.start(h.draft,{x:.1,y:.2});h.ui.move(h.draft,{x:.4,y:.5},q);
 assert.equal(JSON.stringify(h.draft),before);assert.equal(h.ui.canApply(h.draft),false);const ctx=context();h.ui.overlay(ctx,900,600,h.draft);assert(ctx.calls.some(c=>c[0]==='arc'));assert.equal(h.nodes.redoBeautyProtection.disabled,false);
 h.ui.finish(h.draft,{x:.6,y:.4},q,true);h.ui.finish(h.draft,{x:.6,y:.4},q,false);assert.equal(JSON.stringify(h.draft),before);assert.equal(q.preview,null);assert.equal(q.brush,null);assert.equal(h.nodes.redoBeautyProtection.disabled,false);assert.equal(h.ui.canApply(h.draft),true);
 const after=context();h.ui.overlay(after,900,600,h.draft);assert(!after.calls.some(c=>c[0]==='arc'));
});

test('brush controls preserve normalized edges and soft continuous ranges; strength zero and erase-empty are exact no-ops',()=>{
 const h=harness();h.detect(h.batch(1));h.paint();h.input('protectionRadius',.2);h.input('protectionSoftness',20);h.input('protectionStrength',0);h.input('protectionFeather',.05);const before=JSON.stringify(h.draft);h.stroke([{x:0,y:0},{x:1,y:1}]);assert.equal(JSON.stringify(h.draft),before);assert(h.nodes.undoBeautyProtection.disabled);
 h.input('protectionStrength',100);h.click('beautyRestore');h.stroke();assert.equal(JSON.stringify(h.draft),before);h.click('beautyProtect');h.stroke([{x:0,y:0},{x:.5,y:.4},{x:1,y:1}]);const first=entry(h).strokes[0];assert.equal(first.radius,.002);assert.equal(first.hardness,.8);assert.equal(first.strength,1);assert.equal(entry(h).feather,.0005);assert.deepEqual(plain(first.points),[{x:0,y:0},{x:.5,y:.4},{x:1,y:1}]);
 h.input('protectionRadius',15);h.input('protectionSoftness',100);h.input('protectionFeather',1);h.click('beautyRestore');h.stroke([{x:.25,y:.45}]);assert.equal(entry(h).strokes[1].radius,.15);assert.equal(entry(h).strokes[1].hardness,0);assert.equal(entry(h).strokes[1].mode,'keep');assert.equal(entry(h).feather,.01);
 const committed=JSON.stringify(h.draft);for(const [key,value]of [['protectionRadius',15.1],['protectionSoftness',19],['protectionStrength',-1],['protectionFeather',0],['protectionRadius','NaN']])h.input(key,value);assert.equal(JSON.stringify(h.draft),committed);assert.match(h.notices.at(-1),/允许范围/);
});

test('mask-only undo/redo and clear preserve every beauty value and selected person across independent face recipes',()=>{
 const h=harness();h.detect();h.paint(1);h.input('smooth',23);h.input('warmth',-17);h.click('paletteRose');h.stroke();const one=JSON.stringify(h.draft.protection);h.paint(2);h.input('lip',31);h.stroke([{x:.7,y:.45}]);const two=JSON.stringify(h.draft.protection),p=params(h);
 h.click('undoBeautyProtection');assert.equal(JSON.stringify(h.draft.protection),one);assert.equal(params(h),p);assert(chosen(h,2));h.click('redoBeautyProtection');assert.equal(JSON.stringify(h.draft.protection),two);assert.equal(params(h),p);assert(chosen(h,2));
 h.click('clearBeautyProtection');assert(entry(h,1));assert.equal(entry(h,2),undefined);assert.equal(params(h),p);h.click('undoBeautyProtection');assert.equal(JSON.stringify(h.draft.protection),two);assert.equal(params(h),p);h.input('brighten',9);const newer=params(h);h.click('redoBeautyProtection');assert.equal(params(h),newer);assert(chosen(h,2));
 h.choose(1);h.click('resetPortrait');assert(entry(h,1));assert.equal(h.draft.batch.faces[0].beauty.smooth,0);h.click('resetAllPeople');assert(entry(h,1));assert.equal(h.ui.changed(h.draft),true);assert.equal(h.ui.canApply(h.draft),false);
});

test('feather edits belong only to current person and share bounded mask history, never parameter or selection history',()=>{
 const h=harness();h.detect();h.paint(1);h.stroke();h.paint(2);h.stroke([{x:.7,y:.45}]);const one=JSON.stringify(entry(h,1));h.input('protectionFeather',.6);assert.equal(entry(h,2).feather,.006);assert.equal(JSON.stringify(entry(h,1)),one);h.click('undoBeautyProtection');assert.equal(entry(h,2).feather,.002);assert.equal(h.nodes['p-protectionFeather'].value,'0.2');h.click('redoBeautyProtection');assert.equal(entry(h,2).feather,.006);
 h.input('underEye',8);const p=params(h);for(let i=0;i<40;i++)h.input('protectionFeather',i%2?.3:.4);let undone=0;while(!h.nodes.undoBeautyProtection.disabled){h.click('undoBeautyProtection');undone++;assert(undone<=32);}assert.equal(undone,32);assert.equal(params(h),p);assert(chosen(h,2));assert.equal(JSON.stringify(entry(h,1)),one);
 let redone=0;while(!h.nodes.redoBeautyProtection.disabled){h.click('redoBeautyProtection');redone++;assert(redone<=32);}assert.equal(redone,32);assert.equal(params(h),p);assert(chosen(h,2));
});

test('face, mode, parameter, brush, palette, preview and reset actions all cancel live strokes without leaving undo entries',()=>{
 const actions=[h=>h.choose(2),h=>h.click('beautyRestore'),h=>h.click('beautySelect'),h=>h.input('smooth',18),h=>h.input('protectionRadius',4),h=>h.input('protectionSoftness',90),h=>h.input('protectionStrength',50),h=>h.input('protectionFeather',.3),h=>h.click('palettePeach'),h=>h.click('resetPortrait'),h=>h.click('resetAllPeople'),h=>{h.nodes.showBeautyProtection.checked=false;h.nodes.showBeautyProtection.onchange({target:h.nodes.showBeautyProtection});}];
 for(const action of actions){const h=harness();h.detect();h.paint();h.input('smooth',12);const q=h.ui.start(h.draft,{x:.2,y:.4});h.ui.move(h.draft,{x:.3,y:.4},q);action(h);h.ui.finish(h.draft,{x:.4,y:.4},q);assert.equal(h.draft.protection,null);assert(h.nodes.undoBeautyProtection.disabled);assert.equal(q.preview,null);assert.equal(q.finished,true);}
});

test('second pointer, picker, release and stale source/canvas/batch/exact mesh boundaries discard transient protection safely',()=>{
 const mutations=[h=>h.changeRevision(8),h=>h.changeCanvas(),h=>{h.base.width=901;},h=>{h.draft.batch.batchId='other-batch';},h=>{h.draft.batch.faces[0].landmarks[0].x+=1e-9;},h=>{h.draft.batch.faces[1].landmarks[0].x+=1e-9;},h=>{h.draft.batch.detectionSize.width=899;},h=>{h.draft.batch.detector.modelSha256='a'.repeat(64);},h=>{h.draft.phase='reshape';},h=>h.ui.release()];
 for(const mutate of mutations){const h=harness();h.detect();h.paint();const d=h.draft,q=h.ui.start(d,{x:.25,y:.45});mutate(h);h.ui.finish(d,{x:.3,y:.45},q);assert.equal(d.protection,null);assert.equal(h.ui.canApply(d),false);assert.equal(q.preview,null);}
 const h=harness();h.detect();h.paint();const q=h.ui.start(h.draft,{x:.25,y:.45});assert.equal(h.ui.start(h.draft,{x:.6,y:.4}),null);h.ui.finish(h.draft,{x:.3,y:.45},q);assert.equal(h.draft.protection,null);
 const other=h.ui.start(h.draft,{x:.25,y:.45});h.ui.choose(h.batch(2),h.A,()=>{});h.ui.finish(h.draft,{x:.3,y:.45},other);assert.equal(h.draft.protection,null);assert.equal(other.preview,null);
});

test('redetection stages fresh geometry before confirmation and only accepted latest result clears parameters, masks and mask history',()=>{
 const h=harness();const old=h.detect();h.paint();h.stroke();const before=JSON.stringify(h.draft);h.click('detectPortrait');h.respond(old);assert.equal(h.confirmations.length,0);assert.equal(JSON.stringify(h.draft),before);
 h.click('detectPortrait');const malformed=h.batch();malformed.faces[0].id='face-9';h.respond(malformed);assert.equal(h.confirmations.length,0);assert.equal(JSON.stringify(h.draft),before);
 h.click('detectPortrait');const fresh=h.batch();h.respond(fresh);assert.equal(h.confirmations.length,1);assert.match(h.confirmations[0].description,/参数与保护/);assert.equal(JSON.stringify(h.draft),before);const stale=h.confirmations[0];h.click('detectPortrait');const latest=h.batch(1);h.respond(latest);stale.yes();assert.equal(JSON.stringify(h.draft),before);h.confirmations.at(-1).yes();assert.equal(h.draft.batch.batchId,latest.batchId);assert.equal(h.draft.protection,null);assert(h.nodes.undoBeautyProtection.disabled);assert(h.nodes.redoBeautyProtection.disabled);assert.equal(h.ui.changed(h.draft),false);assert(h.nodes.beautyProtect.disabled);
});

test('declined redetection and invalid protection remain recoverable without mutating committed work',()=>{
 const h=harness();h.detect();h.paint();h.input('redness',14);h.stroke();const before=JSON.stringify(h.draft);h.click('detectPortrait');h.respond(h.batch());assert.equal(JSON.stringify(h.draft),before);h.choose(2);h.input('smooth',21);assert(entry(h,1));
 h.draft.protection.batchId='wrong';const invalid=JSON.stringify(h.draft);assert.equal(h.ui.canApply(h.draft),false);assert.equal(h.ui.changed(h.draft),true);h.click('beautyProtect');assert.equal(h.ui.start(h.draft,{x:.7,y:.45}),null);assert.equal(JSON.stringify(h.draft),invalid);assert.match(h.notices.at(-1),/本笔未开始/);
});

test('previews show only selected face center-lines, never a fabricated filled mask; toggling is non-destructive',()=>{
 const h=harness();h.detect();h.paint(1);h.stroke([{x:.25,y:.45}]);h.paint(2);h.stroke([{x:.7,y:.45}]);const before=JSON.stringify(h.draft),ctx=context();h.ui.overlay(ctx,900,600,h.draft);const moves=ctx.calls.filter(c=>c[0]==='move');assert(moves.length);assert(moves.every(c=>c[1]>600));assert(!ctx.calls.some(c=>c[0]==='arc'),'only live pointer draws brush-size ring');
 h.nodes.showBeautyProtection.checked=false;h.nodes.showBeautyProtection.onchange({target:h.nodes.showBeautyProtection});const hidden=context();h.ui.overlay(hidden,900,600,h.draft);assert(!hidden.calls.some(c=>c[0]==='move'));assert.equal(hidden.calls.filter(c=>c[0]==='box').length,2);assert.equal(JSON.stringify(h.draft),before);
});

test('new stroke after undo clears redo but changing beauty parameters does not; out-of-image pointerup cancels',()=>{
 const h=harness();h.detect();h.paint();h.stroke();h.stroke([{x:.28,y:.46}]);h.click('undoBeautyProtection');assert(!h.nodes.redoBeautyProtection.disabled);h.input('smooth',8);assert(!h.nodes.redoBeautyProtection.disabled);const before=JSON.stringify(h.draft);const q=h.ui.start(h.draft,{x:.25,y:.45});h.ui.finish(h.draft,{x:1.01,y:.5},q);assert.equal(JSON.stringify(h.draft),before);assert(!h.nodes.redoBeautyProtection.disabled);h.stroke([{x:.21,y:.42}]);assert(h.nodes.redoBeautyProtection.disabled);assert.equal(entry(h).strokes.length,2);
});

test('protection details own all brush controls and collapse exits painting without changing completed strokes',()=>{
 const h=harness(),html=h.nodes.toolPanel.innerHTML,drawer=html.match(/<details id="beautyProtectionDetails">([\s\S]*?)<\/details>/);
 assert(drawer,'closed native details exists');assert.match(drawer[1],/^<summary>局部保护/);
 for(const id of ['beautySelect','beautyProtect','beautyRestore','p-protectionRadius','p-protectionSoftness','p-protectionStrength','p-protectionFeather','undoBeautyProtection','redoBeautyProtection','clearBeautyProtection','showBeautyProtection'])assert(drawer[1].includes('id="'+id+'"'),'brush nested in protection drawer '+id);
 h.detect();h.nodes.beautyProtectionDetails.open=true;h.paint();h.input('smooth',16);h.stroke();const before=JSON.stringify(h.draft),q=h.ui.start(h.draft,{x:.24,y:.44});h.ui.move(h.draft,{x:.3,y:.5},q);
 h.nodes.beautyProtectionDetails.open=false;h.nodes.beautyProtectionDetails.ontoggle();h.ui.finish(h.draft,{x:.3,y:.5},q);assert.equal(JSON.stringify(h.draft),before);assert.equal(h.nodes.beautySelect['aria-pressed'],'true');assert.equal(h.nodes.beautyProtect['aria-pressed'],'false');
 h.nodes.beautyProtectionDetails.open=true;h.nodes.beautyProtectionDetails.ontoggle();assert.equal(JSON.stringify(h.draft),before);h.stroke([{x:.7,y:.45}]);assert.equal(JSON.stringify(h.draft),before,'selecting a face after reopening does not paint');
});
