/* Project backup actions are separate from photo export and small parameter recipes. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MintProjectBackupUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const IDS=['projectBackupExport','projectBackupImport','projectBackupCancel','projectBackupCancelBusy','projectBackupInput','projectBackupStatus','projectLibraryName'];
 function create(host){
  const a=host||{},d=a.document;let live=true,n=null,bindings=[],job=null,notice='';
  function current(){return live&&n&&IDS.every(id=>n[id]&&d.getElementById(id)===n[id]);}
  function remove(){for(const b of bindings)b.node.removeEventListener(b.type,b.fn);bindings=[];}
  function state(){try{const s=a.getState();return s&&typeof s.loaded==='boolean'&&typeof s.busy==='boolean'?s:null;}catch(_){return null;}}
  function bind(node,type,fn){const nodes=n,handler=e=>{if(current()&&n===nodes)fn(e);};node.addEventListener(type,handler);bindings.push({node,type,fn:handler});}
  function mount(){
   if(current())return true;remove();if(!live||!d||!d.getElementById)return false;
   n={};for(const id of IDS)n[id]=d.getElementById(id);if(IDS.some(id=>!n[id])){for(const id of ['projectBackupExport','projectBackupImport','projectBackupCancel','projectBackupCancelBusy'])if(n[id])n[id].disabled=true;return false;}
   for(const id of ['projectBackupExport','projectBackupImport','projectBackupCancel','projectBackupCancelBusy'])n[id].type='button';
   n.projectBackupInput.accept='.mintproject,application/vnd.mint.photo-project';n.projectBackupInput.multiple=false;
   bind(n.projectBackupExport,'click',()=>{if(!n.projectBackupExport.disabled)void run('export',()=>a.onExport(n.projectLibraryName.value||'工程备份'));});
   bind(n.projectBackupImport,'click',()=>{const s=state();if(n.projectBackupImport.disabled||job||!s||s.busy)return;n.projectBackupInput.value='';n.projectBackupInput.click();});
   bind(n.projectBackupInput,'change',()=>{const files=n.projectBackupInput.files,file=files&&files[0];n.projectBackupInput.value='';if(!file)return;if(files.length!==1){notice='一次只能恢复一份工程备份。';sync();return;}const s=state();if(job||!s||s.busy){notice='当前处理尚未完成，未打开备份。';sync();return;}if(!Number.isSafeInteger(file.size)||file.size<80||file.size>64*1024*1024){notice='请选择有效且不超过 64 MiB 的 .mintproject 工程备份。';sync();return;}void run('import',()=>a.onImport(file));});
   for(const id of ['projectBackupCancel','projectBackupCancelBusy'])bind(n[id],'click',()=>{if(!n[id].disabled&&typeof a.onCancel==='function'){a.onCancel();sync();}});
   return true;
  }
  function sync(){
   if(!mount())return false;const s=state(),locked=!!job||!s||s.busy;
   n.projectBackupExport.disabled=locked||!s.loaded||typeof a.onExport!=='function';n.projectBackupImport.disabled=locked||typeof a.onImport!=='function';
   for(const id of ['projectBackupCancel','projectBackupCancelBusy']){n[id].hidden=!(s&&s.backupPending);n[id].disabled=!(s&&s.canCancelBackup);}
   n.projectBackupStatus.textContent=s&&s.backupPending?(s.canCancelBackup?'正在校验或传输工程，可取消。':'请完成当前确认或系统保存。已开始的原子存储不会被中途打断。'):notice;
   return true;
  }
  async function run(kind,action){
   if(!mount()||job)return false;const s=state();if(!s||s.busy)return false;const nodes=n,task={};job=task;notice='';sync();
   try{const result=await action();if(!current()||n!==nodes)return false;
    if(result===false){notice='本次工程备份操作已取消，当前照片未被替换。';return false;}
    if(kind==='import'){notice='工程已恢复为当前草稿。可命名保存为本机项目；备份文件未改变。';if(a.onImported)a.onImported();}
    else notice=result&&typeof result.message==='string'?result.message:'请确认系统是否完成保存。';
    if(a.toast)a.toast(notice);return result;
   }catch(error){if(current()&&n===nodes){notice=error&&typeof error.message==='string'?error.message:'工程备份失败，当前编辑保留。';if(a.toast)a.toast(notice);}return false;}
   finally{if(job===task)job=null;if(current()&&n===nodes)sync();}
  }
  function dispose(){live=false;remove();}
  sync();return Object.freeze({sync,dispose,get pending(){return!!job;}});
 }
 return Object.freeze({create});
});
