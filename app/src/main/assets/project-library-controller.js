/* Named projects are separate durable snapshots, not exported photos. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MintProjectLibraryController=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function create(host){
  if(!host||!host.store||typeof host.capture!=='function'||typeof host.confirm!=='function'||typeof host.prepare!=='function'||typeof host.install!=='function')throw Error('工程库连接不完整');
  const store=host.store;let active=null,savedRevision=-1,pending=false,entries=new Map(),backupTask=null,suggestedName='',untouchedImport=null;
  const notify=()=>{if(typeof host.changed==='function')host.changed();};
  function capture(){const s=host.capture();if(!s||!Number.isSafeInteger(s.revision)||s.revision<0||typeof s.previewDirty!=='boolean'||typeof s.busy!=='boolean')throw Error('当前编辑状态无效');return s;}
  function same(s){const n=capture();return n.revision===s.revision&&n.sourceKey===s.sourceKey;}
  function unchanged(s){if(!same(s))throw Error('照片或编辑已变化，本次操作已停止，请重新打开工程库');}
  function state(){const s=capture();return{loaded:!!s.project,currentId:active?active.id:null,currentName:active?active.name:suggestedName,backupPending:!!backupTask,canCancelBackup:!!(backupTask&&backupTask.cancellable),dirty:!!s.project&&(!active||savedRevision!==s.revision),previewDirty:s.previewDirty,busy:pending||s.busy};}
  async function run(label,fn){if(pending)throw Error('工程库正在处理，请稍候');const s=capture();if(s.busy)throw Error('请先等待当前处理或系统保存完成');pending=true;if(host.busy)host.busy(true,label);notify();try{return await fn(s);}finally{pending=false;if(host.busy)host.busy(false);notify();}}
  function header(id){const m=entries.get(id);if(!m)throw Error('工程列表已变化，请先刷新');return m;}
  async function refresh(){const list=await store.list({includeTrash:true}),usage=await store.usage();const next=new Map();for(const m of list){if(next.has(m.id))throw Error('工程索引重复，未替换列表');next.set(m.id,m);}entries=next;return{entries:list.filter(m=>m.trashedAt===null),trash:list.filter(m=>m.trashedAt!==null),usage};}
  async function save(name,options){return run('保存原图与工程…',async s=>{if(!s.project)throw Error('请先选择照片');if(s.previewDirty&&!await host.confirm('只保存已应用的编辑？','当前预览尚未应用，不会写入命名工程。它会继续留在编辑器中。'))return false;unchanged(s);const copying=!!(options&&options.asCopy),args={name,record:s.project};if(active&&!copying){args.id=active.id;args.expectedRevision=active.revision;}const result=await store.save(args);entries.set(result.id,result);if(same(s)){active=result;savedRevision=s.revision;untouchedImport=null;}else if(host.toast)host.toast('已保存刚才的快照，当前后续编辑尚未保存');return result;});}
  async function switchPrepared(s,prepared,metadata,openingBackup=false){
   let archived=null,oldDraft=null,stored=false;
   try{
    unchanged(s);
    // Only a fresh file imported in this session can be disposable. Restored
    // drafts/backups and any undo/redo history still receive recovery snapshots.
    const disposable=!!s.project&&!active&&untouchedImport===s.sourceKey&&Array.isArray(s.project.ops)&&s.project.ops.length===0&&Array.isArray(s.project.redo)&&s.project.redo.length===0;
    const dirty=!!s.project&&(!active||savedRevision!==s.revision)&&!disposable;
    if(dirty||s.previewDirty){const message=(dirty?'当前已应用的编辑会先作为可恢复副本保留在回收区，占用工程名额和空间。':disposable?'当前照片还没有已应用的修改。':'当前命名工程已保存。')+(s.previewDirty?' 尚未应用的预览将放弃。':'')+' 是否继续？';if(!await host.confirm(openingBackup?'恢复工程备份？':metadata?'打开另一份工程？':'换一张照片？',message))return false;unchanged(s);}
    if(s.project){await store.writeDraft(s.project);unchanged(s);} // Flush this exact snapshot before the atomic switch.
    oldDraft=await store.readDraft();unchanged(s);
    const shouldArchive=dirty||(!s.project&&!!oldDraft);
    if(!s.project&&oldDraft){if(!await host.confirm('保留上次草稿后继续？','发现尚未打开的自动草稿。会先把它放进可恢复回收区，再打开目标照片；空间不足时不会覆盖。'))return false;unchanged(s);}
    const title=((active&&active.name)||(s.project&&s.project.source&&s.project.source.name)||'上次草稿').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g,' ');
    const name=shouldArchive?Array.from('切换前 · '+title).slice(0,48).join(''):null;
    const result=await store.replaceDraft(prepared.project,{archiveName:name});stored=true;archived=result&&result.archived;
    unchanged(s);host.install(prepared);active=metadata||null;suggestedName='';untouchedImport=null;savedRevision=metadata?capture().revision:-1;if(archived)entries.set(archived.id,archived);if(metadata)entries.set(metadata.id,metadata);
    if(typeof host.draftStored==='function')host.draftStored();return true;
   }catch(error){
    // If rendering/install fails after storage commit, restore the previous
    // autosave when possible; its recovery snapshot is never purged.
    if(stored&&oldDraft){try{await store.writeDraft(oldDraft);}catch{throw Error('切换未完成，自动草稿回滚失败；旧作品仍在命名工程或回收区，请勿清除应用数据');}}
    throw error;
   }finally{if(host.release)host.release(prepared);}
  }
  async function open(id){return run('检查并准备工程…',async s=>{const found=await store.get(id);if(!found||found.metadata.trashedAt!==null)throw Error('工程不存在或在回收区，请刷新后重试');unchanged(s);const prepared=await host.prepare(found.record,'record');return switchPrepared(s,prepared,found.metadata);});}
  async function importFile(file){return run('保留原图，准备新作品…',async s=>{const prepared=await host.prepare(file,'file');const opened=await switchPrepared(s,prepared,null);if(opened)untouchedImport=capture().sourceKey;return opened;});}
  // A backup is an explicit, portable snapshot, not a named-library save.
  // During hashing it can be cancelled; once an atomic draft switch or system
  // picker owns the operation, cancellation stays with that operation's UI.
  function cancelBackup(){if(!backupTask||!backupTask.cancellable)return false;backupTask.cancelled=true;backupTask.cancellable=false;if(backupTask.cancelTransfer)backupTask.cancelTransfer();notify();return true;}
  function backupGuard(task,s){if(task.cancelled)throw Error('工程备份操作已取消');unchanged(s);}
  async function exportBackup(name,encode,deliver,cancelTransfer){return run('生成工程备份，保留原文件…',async s=>{
   if(!s.project)throw Error('请先打开照片或工程');
   if(typeof encode!=='function'||typeof deliver!=='function')throw Error('工程备份模块未加载');
   const task={cancelled:false,cancellable:true,cancelTransfer};backupTask=task;notify();
   try{
    const warning='这是未加密的完整工程，包含原照片、撤销/重做历史、内嵌素材及已有的人脸坐标。遮盖后的原图仍在备份中，不适合作为已脱敏照片分享。请选可信的本机保存位置；系统提供商可能自行云同步。'+(s.previewDirty?' 当前未应用的预览不包含在备份中，会继续留在编辑器。':' 仅包含已应用的编辑。')+' 是否继续？';
    if(!await host.confirm('导出含原照片的工程备份？',warning))return false;
    backupGuard(task,s);
    // Best-effort durability before handing off to a system picker. A full or
    // unavailable local database must NOT prevent rescuing work to a backup.
    let draftWarning=false;
    try{await store.writeDraft(s.project);backupGuard(task,s);if(host.draftStored)host.draftStored();}
    catch(error){backupGuard(task,s);draftWarning=true;if(host.toast)host.toast('自动草稿未能保存；仍可备份，请完成文件保存后再退出。');}
    const blob=await encode(s.project,{name,shouldCancel:()=>task.cancelled||!same(s)});backupGuard(task,s);
    const result=await deliver(blob,name,{shouldCancel:()=>task.cancelled||!same(s),onPicker:()=>{task.cancellable=false;notify();}});
    // Export never changes active, savedRevision, source or any history.
    if(draftWarning&&result&&typeof result==='object')return{...result,message:(result.message||'')+' 本机自动草稿未保存，请完成并确认工程备份后再退出。'};
    return result;
   }finally{if(backupTask===task)backupTask=null;notify();}
  });}
  async function importBackup(file,decode){return run('校验工程备份与原图…',async s=>{
   if(typeof decode!=='function')throw Error('工程备份模块未加载');
   const task={cancelled:false,cancellable:true};backupTask=task;notify();let prepared=null,handedOff=false;
   try{
    const found=await decode(file,{shouldCancel:()=>task.cancelled||!same(s)});backupGuard(task,s);
    if(!found||!found.record||typeof found.name!=='string')throw Error('工程备份内容无效');
    prepared=await host.prepare(found.record,'record',{shouldCancel:()=>task.cancelled||!same(s)});backupGuard(task,s);
    // Do not allow a late hash/read cancellation to interrupt an atomic IDB
    // commit. The normal dirty-work confirmation still has its own Cancel.
    task.cancellable=false;notify();handedOff=true;
    const opened=await switchPrepared(s,prepared,null,true);
    if(opened){suggestedName=found.name;notify();}
    return opened;
   }finally{if(prepared&&!handedOff&&host.release)host.release(prepared);if(backupTask===task)backupTask=null;notify();}
  });}
  async function copy(id,name){return run('复制独立工程…',async()=>{const m=header(id);const out=await store.copy(id,{name,expectedRevision:m.revision});entries.set(out.id,out);return out;});}
  async function trash(id){return run('移入可恢复回收区…',async()=>{const m=header(id);if(!await host.confirm('移入回收区？','这份工程可以恢复；不会永久删除，也不影响编辑器中已经打开的照片。'))return false;const out=await store.trash(id,m.revision);entries.set(id,out);if(active&&active.id===id){active=null;savedRevision=-1;}return out;});}
  async function restore(id){return run('恢复工程…',async()=>{const m=header(id),out=await store.restore(id,m.revision);entries.set(id,out);return out;});}
  function checkDeletable(items){if(items.some(m=>m.trashedAt===null))throw Error('仅能永久删除回收站中的项目');if(active&&items.some(m=>m.id===active.id))throw Error('请先关闭当前工程，再删除它的回收站版本');}
  async function purge(id){return run('删除回收站项目…',async s=>{const m={...header(id)};checkDeletable([m]);if(!await host.confirm('永久删除「'+m.name+'」？','此回收站项目的原图和编辑记录将从作品库移除，无法恢复。已导出的文件和当前编辑中的照片不受影响。'))return false;unchanged(s);checkDeletable([m]);const out=await store.purge(m.id,m.revision);for(const key of out.deleted)entries.delete(key);return out;});}
  async function emptyTrash(){return run('清空回收站…',async s=>{const items=Array.from(entries.values()).filter(m=>m.trashedAt!==null).map(m=>({...m}));if(!items.length)return false;checkDeletable(items);if(!await host.confirm('永久删除回收站的 '+items.length+' 个项目？','这些项目的原图和编辑记录将从作品库移除，无法恢复。已保存作品、已导出的文件和当前编辑中的照片不受影响。'))return false;unchanged(s);checkDeletable(items);const out=await store.emptyTrash(items.map(m=>({id:m.id,revision:m.revision})));for(const key of out.deleted)entries.delete(key);return out;});}
  function detach(){active=null;savedRevision=-1;suggestedName='';untouchedImport=null;notify();}
  return Object.freeze({state,refresh,save,open,importFile,exportBackup,importBackup,cancelBackup,copy,trash,restore,purge,emptyTrash,detach,get pending(){return pending;}});
 }
 return Object.freeze({create});
});
