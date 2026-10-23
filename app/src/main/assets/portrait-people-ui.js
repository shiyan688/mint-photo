'use strict';
/* Batch-local portrait controls. Numbers identify this detection only, not people. */
(() => {
 const $=id=>document.getElementById(id), phases=new Set(['beauty','reshape']);
 const beauty=[['smooth','磨皮',0,100],['brighten','提亮',0,100],['warmth','冷暖',-100,100],['redness','匀红',0,100],['underEye','淡化眼下',0,100],['lip','唇色',0,100],['blush','气色',0,100]];
 const reshape=[['slim','瘦脸',0,60],['eyes','大眼',0,60],['nose','鼻翼',-50,50],['jaw','下颌',-50,50]];
 const palettes={natural:'paletteNatural',peach:'palettePeach',rose:'paletteRose'};
 const MASK_HISTORY_LIMIT=32;
 const brushControls=[['protectionRadius','笔刷半径 · 短边 %',.2,15,.1],['protectionSoftness','笔刷柔软度 % · 至少 20',20,100,1],['protectionStrength','笔刷强度 % · 0 不改变',0,100,1],['protectionFeather','当前人羽化 · 短边 %',.05,1,.05]];
 const copy=value=>value===null?null:JSON.parse(JSON.stringify(value));
 let protectionModule=null, protectionCore=null;
 function protection(){
  if(!window.MintBeautyProtection||!window.MintMaskRefine)return null;
  if(protectionModule!==window.MintBeautyProtection){protectionCore=window.MintBeautyProtection.createCore({people:core(),maskRefine:window.MintMaskRefine});protectionModule=window.MintBeautyProtection;}
  return protectionCore;
 }
 function geometry(batch){return JSON.stringify([batch.sourceRevision,batch.batchId,batch.detector,batch.detectionSize,batch.faces.map(f=>[f.id,f.landmarks])]);}
 function maskChanged(d){
  if(!d||d.phase!=='beauty'||d.protection==null)return false;
  try{const p=protection();return p? p.hasInstructions(d.protection,d.batch):true;}catch(error){return true;}
 }
 function faceProtection(s){return s.draft.protection&&s.draft.protection.faces.find(f=>f.faceId===s.selectedId)||null;}
 function stopStroke(s){if(!s||!s.stroke)return false;const q=s.stroke;s.stroke=null;q.finished=true;q.preview=null;q.brush=null;q.before=null;return true;}
 function cancelStroke(s){if(stopStroke(s))render(s.A);}
 function cleanProtection(s,value){const r=s.P.validate(value,s.draft.batch);return r&&r.faces.length?r:null;}
 function setProtection(s,value){
  const next=cleanProtection(s,value),before=cleanProtection(s,s.draft.protection);
  if(JSON.stringify(next)===JSON.stringify(before))return false;
  s.maskUndo.push(copy(before));if(s.maskUndo.length>MASK_HISTORY_LIMIT)s.maskUndo.shift();s.maskRedo=[];s.draft.protection=next;return true;
 }
 function maskAction(s,action){
  if(!live(s)||!s.P)return;cancelStroke(s);
  try{action();sync(s);selectionStatus(s);render(s.A);}catch(error){sync(s);notice(s.A,'保护未改变：'+error.message);}
 }
 function historyMask(s,redo){
  maskAction(s,()=>{const from=redo?s.maskRedo:s.maskUndo,to=redo?s.maskUndo:s.maskRedo;if(!from.length)return;
   const next=cleanProtection(s,from[from.length-1]);to.push(copy(s.draft.protection));if(to.length>MASK_HISTORY_LIMIT)to.shift();from.pop();s.draft.protection=next;});
 }
 function setMode(s,mode){
  if(!live(s)||!s.P||!['select','erase','keep'].includes(mode))return;
  if(mode!=='select'&&(!selected(s)||s.paintSelectedId!==s.selectedId)){notice(s.A,'涂抹前请先点下方人脸编号明确选人。');return;}
  cancelStroke(s);s.mode=mode;s.selectionVersion++;sync(s);selectionStatus(s);render(s.A);
 }
 function protectionMarkup(available){
  if(!available)return '<p class="portrait-copy subtle">保护核心未加载 · 仍可使用逐人美颜参数；本轮不能涂抹保护。</p>';
  return `<div class="portrait-section-label">本轮美颜保护 · 先点编号选人</div><div class="portrait-actions"><button class="small-button active" id="beautySelect" aria-pressed="true">选择人脸</button><button class="small-button" id="beautyProtect" aria-pressed="false" disabled>涂抹保护</button><button class="small-button" id="beautyRestore" aria-pressed="false" disabled>擦除保护</button></div><p class="portrait-copy">保护仅恢复「本轮美颜前」，不撤销更早历史，也不恢复五官变形。擦除保护会恢复当前人的本轮美颜效果。涂抹不切换人脸，双指操作取消未完成的一笔。</p><div class="sliders portrait-sliders">${brushControls.map(([key,label,min,max,step])=>`<div class="slider-row"><label for="p-${key}">${label}</label><input id="p-${key}" type="range" min="${min}" max="${max}" step="${step}" disabled><output id="pv-${key}"></output></div>`).join('')}</div><div class="portrait-actions"><button class="small-button" id="undoBeautyProtection" disabled>撤销保护</button><button class="small-button" id="redoBeautyProtection" disabled>重做保护</button><button class="small-button" id="clearBeautyProtection" disabled>清除当前人保护</button></div><label class="portrait-copy"><input id="showBeautyProtection" type="checkbox" checked> 显示当前人笔迹（非生效范围）</label><p class="portrait-copy subtle">细线和圆圈只标示笔迹与笔刷，松开后查看实际美颜效果；不会把邻人的效果混入当前人。绿色为保护，紫色为擦除保护。每人最多 32 笔；保护撤销/重做仅保存最近 32 次，不改变美颜参数。</p>`;
 }
 function syncProtection(s){
  if(!s.P||s.phase!=='beauty')return;
  const face=selected(s),ready=!!face&&s.paintSelectedId===s.selectedId,entry=faceProtection(s);
  for(const [id,mode]of [['beautySelect','select'],['beautyProtect','erase'],['beautyRestore','keep']]){const el=$(id);if(el){el.disabled=mode!=='select'&&!ready;el.classList.toggle('active',s.mode===mode);el.setAttribute('aria-pressed',String(s.mode===mode));}}
  const values={protectionRadius:s.radius*100,protectionSoftness:(1-s.hardness)*100,protectionStrength:s.strength*100,protectionFeather:(entry?entry.feather:s.feather)*100};
  for(const [key]of brushControls){const input=$('p-'+key),output=$('pv-'+key),value=Number(values[key].toFixed(4));if(input){input.value=String(value);input.disabled=!ready;}if(output)output.textContent=String(value);}
  if($('undoBeautyProtection'))$('undoBeautyProtection').disabled=!s.maskUndo.length;
  if($('redoBeautyProtection'))$('redoBeautyProtection').disabled=!s.maskRedo.length;
  if($('clearBeautyProtection'))$('clearBeautyProtection').disabled=!face||!entry;
  if($('showBeautyProtection'))$('showBeautyProtection').checked=s.showStrokes;
 }
 function bindProtection(s){
  if(!s.P)return;
  for(const [id,mode]of [['beautySelect','select'],['beautyProtect','erase'],['beautyRestore','keep']])$(id).onclick=()=>setMode(s,mode);
  for(const [key,,min,max]of brushControls)$('p-'+key).oninput=e=>{
   if(!live(s)||!selected(s)||s.paintSelectedId!==s.selectedId)return;
   cancelStroke(s);const value=Number(e.target.value);
   if(!Number.isFinite(value)||value<min||value>max){sync(s);notice(s.A,'笔刷参数超出允许范围，保护未改变。');return;}
   if(key==='protectionFeather')maskAction(s,()=>{const next=s.P.withFaceFeather(s.draft.protection,s.draft.batch,s.selectedId,value/100);setProtection(s,next);s.feather=value/100;});
   else{if(key==='protectionRadius')s.radius=value/100;else if(key==='protectionSoftness')s.hardness=(100-value)/100;else s.strength=value/100;sync(s);render(s.A);}
  };
  $('undoBeautyProtection').onclick=()=>historyMask(s,false);$('redoBeautyProtection').onclick=()=>historyMask(s,true);
  $('clearBeautyProtection').onclick=()=>maskAction(s,()=>{if(selected(s))setProtection(s,s.P.clearFace(s.draft.protection,s.draft.batch,s.selectedId));});
  $('showBeautyProtection').onchange=e=>{if(!live(s))return;cancelStroke(s);s.showStrokes=!!e.target.checked;sync(s);render(s.A);};
 }
 let state=null, selection=null, serial=0;
 const core=()=>window.MintPortraitPeople;
 const revision=A=>String(A.revision());
 const status=text=>{if($('portraitStatus'))$('portraitStatus').textContent=text;};
 const notice=(A,text)=>{status(text);if(A&&A.toast)A.toast(text);};
 const render=A=>{if(A&&A.render)A.render();};
 function bound(s){return !!(s&&s.A&&s.A.getDraft()===s.draft&&s.A.getCanvas()===s.ref&&revision(s.A)===s.revision&&(s.width===undefined||s.ref.width===s.width&&s.ref.height===s.height));}
 function live(s){try{return state===s&&bound(s)&&s.draft.type==='portrait-people'&&s.draft.phase===s.phase&&s.draft.batch.sourceRevision===s.revision&&(!s.P||geometry(s.draft.batch)===s.geometry);}catch(error){return false;}}
 function selected(s){return s.draft.batch.faces.find(face=>face.id===s.selectedId)||null;}
 function changed(d){return !!(d&&d.type==='portrait-people'&&phases.has(d.phase)&&core()&&(core().hasEffect(d.batch,d.phase)||maskChanged(d)));}
 const slider=([key,label,min,max])=>`<div class="slider-row"><label for="p-${key}">${label}</label><input id="p-${key}" type="range" min="${min}" max="${max}" value="0" disabled><output id="pv-${key}">0</output></div>`;
 const heading=(title,copy)=>`<div class="portrait-heading"><strong>${title}</strong><span>离线 · 不上传</span></div><p class="portrait-copy">${copy}</p>`;
 const nativeRecognition=()=>!!(window.Android&&typeof window.Android.analyzePortrait==='function');
 const browserHint=phase=>phase==='beauty'?'自动识别请使用安卓应用。浏览器可点「手动圈定」修肤。':'自动五官调整请使用安卓应用。浏览器可在「精修」中手动调整。';
 function sync(s){
  if(!live(s))return;
  if($('detectPortrait'))$('detectPortrait').textContent=s.detected?'↻ 重新识别':'◎ 识别人脸';
  const face=selected(s), values=face?face[s.phase]:s.phase==='beauty'?core().defaultsBeauty():core().defaultsReshape();
  for(const [key]of s.controls){const input=$('p-'+key),output=$('pv-'+key);if(input){input.value=String(values[key]);input.disabled=!face;}if(output)output.textContent=String(values[key]);}
  for(const f of s.draft.batch.faces){const button=$('person-'+f.id);if(button){button.classList.toggle('active',f.id===s.selectedId);button.classList.toggle('selected',f.id===s.selectedId);button.setAttribute('aria-pressed',String(f.id===s.selectedId));}}
  if($('resetPortrait'))$('resetPortrait').disabled=!face;
  if($('resetAllPeople'))$('resetAllPeople').disabled=!core().hasEffect(s.draft.batch,s.phase);
  for(const id of ['naturalPreset','beautyPreset'])if($(id))$(id).disabled=!face;
  if(s.phase==='beauty')for(const [name,id]of Object.entries(palettes)){const el=$(id);if(el){el.disabled=!face;el.classList.toggle('active',!!face&&values.palette===name);el.setAttribute('aria-pressed',String(!!face&&values.palette===name));}}
  syncProtection(s);
 }
 function selectionStatus(s){
  if(!live(s))return;
  let text;
  if(!s.draft.batch.faces.length)text=nativeRecognition()?'先识别人脸，再选择要调整的人。所有参数从零开始。':browserHint(s.phase);
  else if(!selected(s))text=`检测到 ${s.draft.batch.faces.length} 张脸 · 请明确选择照片中的编号，不会默认修改第 1 人。`;
  else text=`当前第 ${s.selectedId.slice(5)} 人 · 切换编号会保留各自参数；应用后保存本轮步骤。`;
  if(s.P&&selected(s)){if(s.paintSelectedId!==s.selectedId)text+=' 涂抹保护前请点人脸编号明确选人。';else if(s.mode!=='select')text+=s.mode==='erase'?' 现在仅涂抹当前人保护；松开后查看效果。':' 现在仅擦除当前人保护；松开后查看效果。';}
  status(s.budgetMessage?s.budgetMessage+' '+text:text);
 }
 function canApply(d){
  const s=state;if(!live(s)||s.draft!==d)return false;
  if(s.P){
   try{s.P.validate(d.protection,d.batch);}catch(error){status('保护与当前照片或人脸结果不匹配，暂不能应用：'+error.message);return false;}
   if(s.stroke)return false;
   if(maskChanged(d)&&!core().hasEffect(d.batch,'beauty')){status('已保留保护笔迹，但本轮美颜参数仍为零。请先明确调整参数，或清除保护；不会自动添加美颜。');return false;}
  }
  if(typeof s.A.assess!=='function')return true;
  let allowed=false,message='';
  try{
   const result=s.A.assess(d),original=!!(result&&result.original&&result.original.allowed===true),working=!!(result&&result.working&&result.working.allowed===true);
   allowed=original||working;
   if(!allowed){const errors=[result&&result.original&&result.original.error,result&&result.working&&result.working.error].filter(x=>typeof x==='string'&&x);message='暂不能应用：原尺寸和工作尺寸都不满足导出限制。请减小参数或减少同时调整的人数，也可取消本轮。'+([...new Set(errors)].length?' 原因：'+[...new Set(errors)].join('；'):'');}
   else if(!original)message='原尺寸受限，可用工作尺寸；不会自动缩小照片或更改参数。';
  }catch(error){message='导出可用性检查失败，暂不能应用；参数与原图未改变：'+error.message;}
  if(s.budgetMessage!==message){s.budgetMessage=message;if(message)status(message);else selectionStatus(s);}
  return allowed;
 }
 function selectFace(s,id,explicit=false){
  if(!live(s)||!s.draft.batch.faces.some(f=>f.id===id))return;
  cancelStroke(s);s.selectedId=id;s.paintSelectedId=explicit?id:null;s.selectionVersion++;if(s.P&&s.paintSelectedId!==id)s.mode='select';sync(s);selectionStatus(s);render(s.A);
 }
 function faceButtons(s){
  if(!live(s))return;
  const list=$('portraitPeople');if(!list)return;
  // IDs are strictly validated by the shared core before reaching this markup.
  list.innerHTML=s.draft.batch.faces.map(f=>`<button class="small-button" id="person-${f.id}" data-person-face="${f.id}" aria-pressed="false">第 ${f.id.slice(5)} 人</button>`).join('');
  for(const f of s.draft.batch.faces)$('person-'+f.id).onclick=()=>selectFace(s,f.id,true);
  sync(s);
 }
 function modify(s,edit){
  if(!live(s))return;
  cancelStroke(s);const current=selected(s);if(!current){sync(s);return;}
  try{const next=core().validateBatch(s.draft.batch,{sourceRevision:s.revision}),face=next.faces.find(f=>f.id===s.selectedId);edit(face[s.phase]);s.draft.batch=core().validateBatch(next,{sourceRevision:s.revision});sync(s);render(s.A);}
  catch(error){sync(s);notice(s.A,'参数未改变：'+error.message);}
 }
 function acceptDetection(s,value,request,force){
  if(!live(s)||request!==s.request||s.handledRequest===request)return;
  s.handledRequest=request;
  let batch;
  try{
   batch=core().validateBatch(value,{sourceRevision:s.revision});
   if(force&&batch.batchId===s.draft.batch.batchId)throw Error('重新识别必须生成新批次，请重试。');
   // Geometry caches must never be a route for inheriting somebody's old settings.
   for(const face of batch.faces){face.beauty=core().defaultsBeauty();face.reshape=core().defaultsReshape();}
   batch=core().validateBatch(batch,{sourceRevision:s.revision});
  }catch(error){notice(s.A,'没有替换本轮人像：'+error.message);return;}
  const install=()=>{
   if(!live(s)||request!==s.request)return;
   cancelStroke(s);s.request++;s.detected=true;s.draft.batch=core().validateBatch(batch,{sourceRevision:s.revision});s.geometry=geometry(s.draft.batch);s.selectedId=batch.faces.length===1?batch.faces[0].id:null;s.paintSelectedId=null;s.selectionVersion++;
   if(s.P){s.draft.protection=null;s.maskUndo=[];s.maskRedo=[];s.mode='select';}
   faceButtons(s);selectionStatus(s);
   if(!batch.faces.length)status('未识别到清晰人脸 · 本轮参数为零，可换清晰照片或使用手动圈定。');
   render(s.A);
  };
  if(changed(s.draft)){
   status('新识别结果已准备好 · 确认后才会清除本轮各人的参数与保护，编号不代表同一个人。');
   if(typeof s.A.confirm!=='function'){notice(s.A,'请先应用或取消本轮参数，再重新识别。');return;}
   s.A.confirm('重新识别并清零？','这会清除全部尚未应用的逐人参数与保护。新编号只属于这次识别，不会按编号继承旧设置；取消确认会保留原设置。',install);
  }else install();
 }
 function detect(s){
  if(!live(s))return;
  if(typeof s.A.detectFaces!=='function'){notice(s.A,'离线人脸识别未加载；可使用手动工具。');return;}
  cancelStroke(s);const previousRequest=s.request,request=++s.request,force=s.detected;
  status('正在离线识别人脸 · 现有参数暂不改变。');
  try{const accepted=s.A.detectFaces(value=>acceptDetection(s,value,request,force),force);if(accepted===false&&live(s)&&s.request===request)s.request=previousRequest;if(!nativeRecognition()&&live(s)&&!s.draft.batch.faces.length)status(browserHint(s.phase));}
  catch(error){if(live(s)&&request===s.request)notice(s.A,'识别未完成，现有参数保留：'+error.message);}
 }
 function setup(A,phase){
  release();
  const panel=$('toolPanel');
  if(!phases.has(phase))throw Error('逐人人像阶段必须是 beauty 或 reshape');
  try{
   if(!core())throw Error('逐人人像核心未加载，请重新打开应用');
   const ref=A.getCanvas(),sourceRevision=revision(A),batch=core().createBatch({sourceRevision,batchId:'pending-'+(++serial),detector:core().DEFAULT_DETECTOR,detectionSize:{width:ref.width,height:ref.height},landmarks:[]});
   const P=phase==='beauty'?protection():null,draft=P?{type:'portrait-people',version:2,phase,batch,protection:null}:{type:'portrait-people',phase,batch};A.setDraft(draft);
   const s=state={A,draft,phase,ref,revision:sourceRevision,selectedId:null,selectionVersion:0,request:0,handledRequest:null,detected:false,budgetMessage:'',controls:phase==='beauty'?beauty:reshape,P,geometry:geometry(batch),width:ref.width,height:ref.height,paintSelectedId:null,mode:'select',radius:.03,hardness:.35,strength:1,feather:.002,showStrokes:true,stroke:null,maskUndo:[],maskRedo:[]};
   const copy=phase==='beauty'?'选人后轻调肤感，也可一键试用自然风格。':'选人后小幅调整五官，每个人的参数单独保留。';
   panel.innerHTML=heading(phase==='beauty'?'自然人像':'五官微调',copy)+
    `<div class="portrait-actions"><button class="small-button accent" id="detectPortrait">◎ 识别人脸</button>${phase==='beauty'?'<button class="small-button" id="manualSkin">手动圈定</button>':''}</div><div class="portrait-status" id="portraitStatus" role="status" aria-live="polite"></div><div class="portrait-actions" id="portraitPeople" aria-label="选择本次识别的人脸"></div>`+
    (phase==='beauty'?`<div class="portrait-presets"><button class="portrait-preset" id="naturalPreset" disabled><strong>自然通透</strong><span>保留肤色 · 轻调肤感</span></button><button class="portrait-preset" id="beautyPreset" disabled><strong>柔和妆感</strong><span>暖桃唇颊 · 自然气色</span></button></div><div class="portrait-section-label">基础修肤</div><div class="sliders portrait-sliders">${beauty.slice(0,3).map(slider).join('')}</div><div class="tool-help"><details id="portraitComplexionDetails"><summary>匀净肤色 · 淡化眼下</summary><div class="sliders portrait-sliders">${beauty.slice(3,5).map(slider).join('')}</div></details><details id="portraitMakeupDetails"><summary>唇颊轻妆</summary><div class="portrait-actions palette-actions"><button class="small-button" id="paletteNatural" disabled>自然</button><button class="small-button" id="palettePeach" disabled>暖桃</button><button class="small-button" id="paletteRose" disabled>柔玫瑰</button></div><div class="sliders portrait-sliders">${beauty.slice(5).map(slider).join('')}</div></details><details id="beautyProtectionDetails"><summary>局部保护 · 保留细节</summary>${protectionMarkup(!!P)}</details></div>`:`<div class="sliders portrait-sliders">${reshape.map(slider).join('')}</div>`)+
    `<div class="portrait-actions"><button class="small-button" id="resetPortrait" disabled>此人归零</button><button class="small-button" id="resetAllPeople" disabled>全部归零</button></div><div class="tool-help"><details id="portraitHelpDetails"><summary>使用说明</summary><p class="portrait-copy subtle">每次最多识别 5 张脸，使用最长边 900 像素的预览定位，小脸或遮挡可能漏检。编号仅限本次识别，不追踪身份。不按族裔套用风格。靠得太近时可能拒绝调整，以保护邻近人脸。${phase==='reshape'?'透明图片暂不支持五官变形，请先在不透明原图调整。':'这是本地可控算法，不是学习型自动美颜，也不保证去除眼袋。预设只调整当前选中的人，可在折叠面板中继续微调。'}</p></details></div>`;
   $('detectPortrait').onclick=()=>detect(s);
   if($('manualSkin'))$('manualSkin').onclick=()=>{if(!live(s))return;cancelStroke(s);s.request++;if(typeof A.manualSkin==='function')A.manualSkin();else notice(A,'手动圈定暂未加载，请使用精修中的手动工具。');};
   for(const [key,,min,max]of s.controls)$('p-'+key).oninput=e=>{if(!live(s))return;cancelStroke(s);const value=Number(e.target.value);if(!Number.isFinite(value)||value<min||value>max){sync(s);notice(A,'参数超出允许范围，未改变照片。');return;}modify(s,values=>{values[key]=value;});};
   $('resetPortrait').onclick=()=>modify(s,values=>Object.assign(values,phase==='beauty'?core().defaultsBeauty():core().defaultsReshape()));
   $('resetAllPeople').onclick=()=>{if(!live(s))return;cancelStroke(s);const next=core().validateBatch(s.draft.batch,{sourceRevision:s.revision});for(const face of next.faces)face[phase]=phase==='beauty'?core().defaultsBeauty():core().defaultsReshape();s.draft.batch=next;sync(s);status(s.P?'本轮所有人的参数已归零 · 保护笔迹保留；已应用步骤仍可全局撤销。':'本轮所有人的参数已归零 · 已应用步骤仍可全局撤销。');render(A);};
   if(phase==='beauty'){
    bindProtection(s);
    // A hidden brush must not keep painting. Collapsing only changes UI mode;
    // completed protection strokes and all portrait parameters remain intact.
    $('beautyProtectionDetails').ontoggle=()=>{if(live(s)&&!$('beautyProtectionDetails').open&&s.P)setMode(s,'select');};
    for(const [name,id]of Object.entries(palettes))$(id).onclick=()=>modify(s,values=>{values.palette=name;});
    $('naturalPreset').onclick=()=>modify(s,values=>Object.assign(values,core().defaultsBeauty(),{smooth:16,underEye:12,redness:8}));
    $('beautyPreset').onclick=()=>modify(s,values=>Object.assign(values,core().defaultsBeauty(),{smooth:18,underEye:12,redness:8,lip:18,blush:12,palette:'peach'}));
   }
   sync(s);selectionStatus(s);if($('editLabel'))$('editLabel').textContent='逐人预览 · 应用后生效';if(A.hint)A.hint('先识别人脸，再选编号；编号只属于本次识别');render(A);return draft;
  }catch(error){state=null;A.setDraft(null);if(panel)panel.textContent=error.message;notice(A,error.message);return null;}
 }
 function cancelSelection(){
  const pending=selection;selection=null;
  const panel=$('faceSelectionPanel');if(panel){panel.hidden=true;panel.innerHTML='';}
  if(pending)render(pending.A);
  const target=pending&&pending.returnFocus;if(target&&target.isConnected!==false&&!target.disabled&&!target.hidden&&typeof target.focus==='function')target.focus();
  return !!pending;
 }
 function currentSelection(){if(selection&&!bound(selection))cancelSelection();return selection;}
 function selectionActive(){return !!currentSelection();}
 function choose(value,A,after){
  cancelStroke(state);cancelSelection();
  try{if(typeof A.cancelPointer==='function')A.cancelPointer();}catch(error){notice(A,'未能安全取消当前未完成手势，暂不选人：'+error.message);return false;}
  let batch;try{batch=core().validateBatch(value,{sourceRevision:revision(A)});}catch(error){notice(A,'人脸结果已失效，请重新识别：'+error.message);return false;}
  if(!batch.faces.length){notice(A,'未识别到清晰人脸，请使用手动工具。');return false;}
  if(typeof after!=='function')throw Error('选人后需要回调');
  const pending={A,after,batch,draft:A.getDraft(),ref:A.getCanvas(),revision:revision(A),returnFocus:document.activeElement};selection=pending;
  function pick(id){
   if(currentSelection()!==pending)return;
   const snapshot=core().validateBatch(pending.batch,{sourceRevision:pending.revision}),face=snapshot.faces.find(f=>f.id===id);if(!face)return;
   cancelSelection();
   // Rendering selection cleanup may itself change the current editor draft.
   if(bound(pending))after(face.landmarks,{batch:snapshot,faceId:face.id});
  }
  if(batch.faces.length===1){pick(batch.faces[0].id);return true;}
  const panel=$('faceSelectionPanel');
  if(!panel){cancelSelection();notice(A,'选择人脸面板未加载，未默认选择任何人。');return false;}
  panel.hidden=false;panel.setAttribute('aria-label','选择这次要处理的人');panel.innerHTML=heading('选择这次要处理的人','请对照照片编号明确选择；不会默认选择第 1 人，也不改变当前编辑参数。')+`<p class="portrait-copy" id="faceSelectionStatus" role="status" aria-live="polite">检测到 ${batch.faces.length} 张脸，请选择一个编号，或取消选人。</p><div class="portrait-actions">${batch.faces.map(f=>`<button class="small-button" id="choose-${f.id}" data-face-choice="${f.id}" aria-describedby="faceSelectionStatus">第 ${f.id.slice(5)} 人</button>`).join('')}<button class="small-button" id="cancelFaceSelection">取消选人</button></div>`;
  for(const face of batch.faces)$('choose-'+face.id).onclick=()=>pick(face.id);
  $('cancelFaceSelection').onclick=()=>{if(selection===pending)cancelSelection();};
  if(A.hint)A.hint('请先选照片中的人脸编号，或取消选人');render(A);const first=$('choose-'+batch.faces[0].id);if(selection===pending&&first&&typeof first.focus==='function')first.focus();return true;
 }
 function release(){const old=state;stopStroke(old);state=null;cancelSelection();if(old)render(old.A);}
 function point(p){return !!(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1);}
 function start(d,p){
  const s=state;if(!live(s)||s.draft!==d||!point(p)||selectionActive())return null;
  // A second start is never another brush owner: it cancels the first pointer.
  if(s.stroke){cancelStroke(s);return null;}
  const q={draft:d,state:s,batchId:d.batch.batchId,geometry:s.geometry,selectionVersion:s.selectionVersion,start:{x:p.x,y:p.y},moved:false,finished:false};
  if(s.P&&s.mode!=='select'){
   if(!selected(s)||s.paintSelectedId!==s.selectedId){notice(s.A,'涂抹前请先点人脸编号明确选人。');return null;}
   try{
    q.paint=true;q.faceId=s.selectedId;q.before=s.P.validate(d.protection,d.batch);const entry=faceProtection(s);q.feather=(entry||{feather:s.feather}).feather;
    q.brush={mode:s.mode,radius:s.radius,hardness:s.hardness,strength:s.strength,points:[{x:p.x,y:p.y}]};q.noop=s.strength===0||s.mode==='keep'&&(!entry||!entry.strokes.some(stroke=>stroke.mode==='erase'&&stroke.strength>0));
    if(!q.noop)q.preview=s.P.withFaceStroke(q.before,d.batch,q.faceId,q.brush,q.feather);
   }catch(error){notice(s.A,'本笔未开始：'+error.message);return null;}
   s.stroke=q;render(s.A);
  }
  return q;
 }
 function validGesture(d,q){return !!(q&&!q.finished&&q.state===state&&q.draft===d&&live(state)&&state.draft===d&&q.batchId===d.batch.batchId&&q.selectionVersion===state.selectionVersion&&(!q.paint||state.stroke===q&&q.faceId===state.selectedId&&q.geometry===geometry(d.batch)));}
 function move(d,p,q){
  if(!validGesture(d,q)){if(q&&q.paint&&q.state.stroke===q)cancelStroke(q.state);return;}
  if(!point(p))return;
  if(!q.paint){if(Math.hypot(p.x-q.start.x,p.y-q.start.y)>.015)q.moved=true;return;}
  if(q.noop)return;
  const last=q.brush.points[q.brush.points.length-1];if(last.x===p.x&&last.y===p.y)return;
  const points=q.brush.points.concat([{x:p.x,y:p.y}]),brush={...q.brush,points};
  try{q.preview=state.P.withFaceStroke(q.before,d.batch,q.faceId,brush,q.feather);q.brush=brush;render(state.A);}
  catch(error){cancelStroke(q.state);notice(q.state.A,'本笔未保留：'+error.message);}
 }
 function finish(d,p,q,cancelled=false){
  if(q&&q.paint){
   if(!validGesture(d,q)){if(q.state.stroke===q)cancelStroke(q.state);return;}
   const s=q.state;
   if(cancelled||!point(p)||selectionActive()){cancelStroke(s);return;}
   move(d,p,q);if(!validGesture(d,q))return;
   const preview=q.preview;stopStroke(s);
   if(!q.noop)try{setProtection(s,preview);}catch(error){notice(s.A,'本笔未保留：'+error.message);}
   sync(s);selectionStatus(s);render(s.A);return;
  }
  if(!validGesture(d,q))return;q.finished=true;
  if(cancelled||q.moved||!point(p)||Math.hypot(p.x-q.start.x,p.y-q.start.y)>.015||selectionActive())return;
  const s=state,hits=core().getFaceBounds(d.batch).filter(b=>p.x>=b.x&&p.x<=b.x+b.width&&p.y>=b.y&&p.y<=b.y+b.height);
  if(hits.length===1)selectFace(s,hits[0].id);
  else if(hits.length>1){status('这里的人脸框重叠，请点下方编号明确选人。');if(s.A.hint)s.A.hint('人脸框重叠，请使用编号按钮');}
 }
 function drawStrokes(ctx,w,h,s){
  if(!s.P||!s.showStrokes||!selected(s)||typeof ctx.beginPath!=='function')return;
  // These are visibly labelled center-lines/brush cursors, not a fake coverage mask.
  const entry=faceProtection(s),strokes=entry?entry.strokes:[],q=s.stroke;
  ctx.save();ctx.lineWidth=Math.max(1,w/600);ctx.setLineDash([3,3]);
  for(const stroke of strokes.concat(q&&!q.noop?[q.brush]:[])){
   ctx.strokeStyle=stroke.mode==='erase'?'#58e6be':'#c5a5ff';ctx.beginPath();
   stroke.points.forEach((p,i)=>{if(i===0)ctx.moveTo(p.x*w,p.y*h);else ctx.lineTo(p.x*w,p.y*h);});
   if(stroke.points.length===1){const p=stroke.points[0];ctx.moveTo(p.x*w-2,p.y*h);ctx.lineTo(p.x*w+2,p.y*h);ctx.moveTo(p.x*w,p.y*h-2);ctx.lineTo(p.x*w,p.y*h+2);}
   ctx.stroke();
  }
  if(q&&!q.noop){const p=q.brush.points[q.brush.points.length-1];ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(p.x*w,p.y*h,q.brush.radius*Math.min(w,h),0,Math.PI*2);ctx.stroke();}
  ctx.restore();
 }
 function drawBounds(ctx,w,h,batch,activeId){
  const bounds=core().getFaceBounds(batch);ctx.save();
  ctx.lineWidth=Math.max(1,w/450);ctx.font=`bold ${Math.max(12,Math.round(w/36))}px sans-serif`;ctx.textBaseline='top';
  for(const b of bounds){const x=b.x*w,y=b.y*h,bw=b.width*w,bh=b.height*h,label=b.id.slice(5),chosen=b.id===activeId,font=Math.max(12,Math.round(w/36));ctx.strokeStyle=chosen?'#d7f4ae':'#ffffff';ctx.lineWidth=Math.max(1,w/450)*(chosen?2:1);ctx.setLineDash(chosen?[]:[5,4]);ctx.strokeRect(x,y,bw,bh);const lx=Math.min(Math.max(0,x),Math.max(0,w-font-8)),ly=Math.max(0,y-font-6);ctx.fillStyle=chosen?'#d7f4ae':'#ffffff';ctx.fillRect(lx,ly,font+8,font+6);ctx.fillStyle='#15342d';ctx.fillText(label,lx+4,ly+3);}
  ctx.restore();
 }
 function overlay(ctx,w,h,d){if(!live(state)||state.draft!==d||selectionActive())return;drawStrokes(ctx,w,h,state);drawBounds(ctx,w,h,d.batch,state.selectedId);}
 function overlaySelection(ctx,w,h){const pending=currentSelection();if(pending)drawBounds(ctx,w,h,pending.batch,null);}
 window.PortraitPeopleUI={setup,release,changed,canApply,start,move,finish,overlay,choose,cancelSelection,selectionActive,overlaySelection};
})();
