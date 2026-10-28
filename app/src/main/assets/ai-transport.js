/* One ephemeral request owner across native and loopback transports. */
(function(root){'use strict';let pending=null,serial=0;
 function receive(id,image,error){if(!pending||pending.id!==id)return;const p=pending;pending=null;p.cleanup();if(error)p.reject(Error(error));else p.resolve({image});}
 async function send(data,signal){if(signal.aborted)throw new DOMException('Cancelled','AbortError');if(root.Android){if(typeof root.Android.editImage!=='function')throw Error('此安卓安装包尚无AI桥接，请更新');if(pending)throw Error('已有AI请求');return new Promise((resolve,reject)=>{const id='ai_'+Date.now()+'_'+(++serial),abort=()=>{try{root.Android.cancelAiEdit(id);}finally{if(pending&&pending.id===id){pending=null;cleanup();reject(new DOMException('Cancelled','AbortError'));}}},timer=setTimeout(abort,190000),cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};pending={id,resolve,reject,cleanup};signal.addEventListener('abort',abort,{once:true});try{root.Android.editImage(JSON.stringify(data),id);}catch(e){pending=null;cleanup();reject(Error('安卓AI桥接调用失败'));}});}
  const response=await fetch('/api/image-edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal});if(!String(response.headers.get('content-type')).includes('application/json'))throw Error('请启动本地AI服务：node tools/ai-preview-server.cjs');const result=await response.json();if(!response.ok)throw Error(result.error||'AI服务失败');return result;
 }
 root.MintAiTransport=Object.freeze({send,receive});
})(typeof window==='object'?window:globalThis);
