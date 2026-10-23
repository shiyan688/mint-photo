/* User-initiated archive transfer. No fetch, upload, external URL or filesystem path. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MintProjectBackupTransport=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 const MAX_BYTES=64*1024*1024,CHUNK_BYTES=128*1024,TIMEOUT_MS=60000;
 const BlobType=root.Blob,blobSize=BlobType&&Object.getOwnPropertyDescriptor(BlobType.prototype,'size').get,blobSlice=BlobType&&BlobType.prototype.slice,blobRead=BlobType&&BlobType.prototype.arrayBuffer;
 let serial=0;
 function create(host){
  const a=host||{},w=a.root||root,android=a.android===undefined?w.Android:a.android,document=a.document||w.document;
  const timer=a.setTimeout||w.setTimeout.bind(w),untimer=a.clearTimeout||w.clearTimeout.bind(w);
  let active=null,live=true;const settledIds=[];
  function remember(id){if(!settledIds.includes(id)){settledIds.push(id);if(settledIds.length>32)settledIds.shift();}}
  function valid(){return android&&['beginProjectBackup','appendProjectBackup','finishProjectBackup','cancelProjectBackup'].every(k=>typeof android[k]==='function');}
  function cancelled(s){if(s.cancelled||(s.options.shouldCancel&&s.options.shouldCancel()))throw Error('工程备份已取消');}
  function clearWait(s){if(s.wait&&s.wait.timer!==null)untimer(s.wait.timer);const p=s.wait;s.wait=null;return p;}
  function fail(s,message,cancelNative=true){
   if(s.done)return;s.done=true;remember(s.id);s.cancelled=true;const e=message instanceof Error?message:Error(message||'工程备份未完成');
   const p=clearWait(s);if(p)p.reject(e);s.rejectFinal(e);
   if(cancelNative&&valid())try{android.cancelProjectBackup(s.id);}catch(_){}
  }
  function wait(s,event,index,action){
   if(s.done)return Promise.reject(Error('工程备份已结束'));if(s.wait)return Promise.reject(Error('备份传输状态错误'));
   return new Promise((resolve,reject)=>{const p={event,index,resolve,reject,timer:null};s.wait=p;
    p.timer=timer(()=>{if(s.wait===p)fail(s,'备份传输超时，未报告保存成功，请重试。');},TIMEOUT_MS);
    try{action();}catch(error){fail(s,error);}
   });
  }
  function transfer(id,event,index,message){
   const s=active;if(!s||s.id!==id||s.done)return;
   if(event==='error'){fail(s,typeof message==='string'?message:'工程备份传输失败',false);return;}
   const p=s.wait;
   // A duplicate acknowledgement must not terminate an unrelated newer stage.
   if(!p||event!==p.event)return;
   if(event==='chunk'&&index!==p.index){if(Number.isInteger(index)&&index<p.index)return;fail(s,'备份分块顺序不一致，已停止');return;}
   clearWait(s);
   if(event==='picker'){s.phase='picker';try{if(s.options.onPicker)s.options.onPicker();}catch(error){p.reject(error);fail(s,error,false);return;}}
   p.resolve();
  }
  function result(id,success,message){
   const s=active;
   if(!s){
    // A recreated page has no old Promise, but native interruption/uncertainty
    // still deserves a notice. Never install data or mark current work saved.
    if(typeof id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(id)&&typeof success==='boolean'&&typeof message==='string'&&message.length<=2000&&!settledIds.includes(id)){
     remember(id);if(typeof a.onDetachedResult==='function')try{a.onDetachedResult({saved:success,message});}catch(_){}
    }
    return;
   }
   if(s.id!==id||s.done)return;
   if(typeof success!=='boolean'){fail(s,'系统备份结果无效');return;}
   if(success&&s.phase!=='finishing'&&s.phase!=='picker'){fail(s,'备份尚未完成传输，不能报告保存成功');return;}
   s.done=true;remember(s.id);const p=clearWait(s);if(p)p.resolve();
   s.resolveFinal({saved:success,cancelled:!success,downloadStarted:false,message:typeof message==='string'?message:(success?'工程备份已保存。':'工程备份未保存。')});
  }
  const priorTransfer=w.onNativeProjectBackupTransfer,priorResult=w.onNativeProjectBackupExportResult;
  w.onNativeProjectBackupTransfer=transfer;w.onNativeProjectBackupExportResult=result;
  function name(value){
   if(typeof value!=='string')throw Error('备份名称无效');
   const base=Array.from(value.normalize('NFC').trim()).slice(0,48).join('').replace(/[^\p{L}\p{N} _().-]/gu,'_').replace(/^\.+/,'').trim();
   return(base||'薄荷工程')+'.mintproject';
  }
  function base64(bytes){
   const encode=a.btoa||w.btoa;if(typeof encode!=='function')throw Error('当前 WebView 不支持备份分块，请更新 WebView');
   let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(bytes.length,i+8192)));
   return encode(text);
  }
  async function save(blob,title,options){
   if(!live||active)throw Error('请先完成当前工程备份');
   let size;try{size=blobSize.call(blob);}catch(_){throw Error('备份文件无效或超过 64 MiB');}if(!Number.isSafeInteger(size)||size<80||size>MAX_BYTES)throw Error('备份文件无效或超过 64 MiB');
   options=options||{};if(options.shouldCancel!==undefined&&typeof options.shouldCancel!=='function')throw Error('取消回调无效');if(options.onPicker!==undefined&&typeof options.onPicker!=='function')throw Error('保存回调无效');
   const fileName=name(title);
   if(android&&!valid())throw Error('此安装包不支持工程备份，请更新应用；当前工程未改变');
   if(!android){
    if(options.shouldCancel&&options.shouldCancel())throw Error('工程备份已取消');
    if(!document||!document.createElement||!w.URL||typeof w.URL.createObjectURL!=='function')throw Error('浏览器无法生成本地备份下载');
    const url=w.URL.createObjectURL(blob),link=document.createElement('a');let invoked=false;
    try{link.href=url;link.download=fileName;link.rel='noopener';link.click();invoked=true;}
    finally{if(link.remove)link.remove();if(invoked)timer(()=>w.URL.revokeObjectURL(url),30000);else w.URL.revokeObjectURL(url);}
    return{saved:false,cancelled:false,downloadStarted:true,message:'备份下载已发起，请在浏览器中确认文件实际保存；尚未确认落盘。'};
   }
   const s={id:'backup-'+Date.now().toString(36)+'-'+(++serial).toString(36),options,phase:'starting',wait:null,done:false,cancelled:false};
   s.final=new Promise((resolve,reject)=>{s.resolveFinal=resolve;s.rejectFinal=reject;});s.final.catch(()=>{});active=s;
   try{
    cancelled(s);await wait(s,'ready',-1,()=>android.beginProjectBackup(s.id,fileName,size));if(s.done)return await s.final;
    for(let offset=0,index=0;offset<size;offset+=CHUNK_BYTES,index++){
     cancelled(s);s.phase='streaming';const end=Math.min(size,offset+CHUNK_BYTES),chunk=blobSlice.call(blob,offset,end);
     if(typeof blobRead!=='function')throw Error('当前 WebView 不支持安全分块读取，请更新 WebView');
     const bytes=new Uint8Array(await blobRead.call(chunk));cancelled(s);if(bytes.byteLength!==end-offset)throw Error('备份分块长度发生变化');
     const encoded=base64(bytes);await wait(s,'chunk',index,()=>android.appendProjectBackup(s.id,index,encoded));if(s.done)return await s.final;
    }
    cancelled(s);s.phase='finishing';await wait(s,'picker',-1,()=>android.finishProjectBackup(s.id));
    return await s.final;
   }catch(error){fail(s,error);throw error;}
   finally{clearWait(s);if(active===s)active=null;}
  }
  function cancel(){const s=active;if(!s)return true;if(s.phase==='picker')return false;fail(s,'工程备份已取消');return true;}
  function dispose(){if(!live)return;live=false;if(active&&active.phase==='picker')fail(active,'备份页面已关闭，保存结果未确认，请检查所选位置。',false);else cancel();if(w.onNativeProjectBackupTransfer===transfer)w.onNativeProjectBackupTransfer=priorTransfer;if(w.onNativeProjectBackupExportResult===result)w.onNativeProjectBackupExportResult=priorResult;}
  return Object.freeze({save,cancel,dispose,get pending(){return!!active;},get stage(){return active?active.phase:'idle';}});
 }
 return Object.freeze({create,MAX_BYTES,CHUNK_BYTES,TIMEOUT_MS});
});
