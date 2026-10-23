/* Navigation is ephemeral UI state. It never writes image pixels or project recipes. */
(function(root){'use strict';
 function create(a){const V=root.MintViewport;if(!V)throw Error('缩放核心未加载');let view=V.defaults(),mode='edit',points=new Map(),gesture=null,blocked=false,overflow=false,overflowIds=new Set(),untrackedOverflow=false,key=null,sourceKey=null,live=true,cache=new WeakMap();
  const node=id=>a.node(id), finite=n=>typeof n==='number'&&Number.isFinite(n), controls=['viewZoom','viewFit','viewPan'];
  function geometry(){const g=a.geometry();if(!g||!g.enabled)return null;return g;}
  function ui(g){for(const id of controls)node(id).disabled=!g;node('viewZoom').value=String(view.zoom);node('viewZoom').setAttribute('aria-valuetext',view.zoom.toFixed(2)+'倍相对适配');node('viewZoomValue').textContent=view.zoom.toFixed(2)+'× 适配';node('viewPan').textContent=mode==='pan'?'平移：开':'平移：关';node('viewPan').setAttribute('aria-pressed',String(mode==='pan'));node('viewNote').textContent=untrackedOverflow?'触点异常，已停止编辑；请切到后台后返回，再重新操作':overflow?'触点过多，已停止编辑；请全部松手后点「适配」恢复':mode==='pan'?'平移模式，关闭后才能编辑；双指也可缩放':'图片上双指缩放 / 平移；单指编辑';node('viewScaleNote').textContent=g?`操作预览 ${g.image.width} × ${g.image.height}，非原图 100% 像素；导出尺寸不变`:'选照片后可缩放预览';a.cursor?.(mode==='pan'||blocked?'grab':'crosshair');}
  function cancel(forget=false){if(!live)return;a.cancelEditing();gesture=null;blocked=points.size>0;if(forget){points.clear();overflowIds.clear();untrackedOverflow=false;overflow=false;blocked=false;}ui(geometry());}
  function refresh(){if(!live)return false;const g=geometry();if(!g){cancel(true);key=null;sourceKey=null;view=V.defaults();ui(null);return false;}const nextKey=g.image.width+'x'+g.image.height;if(key!==null&&(key!==nextKey||sourceKey!==g.sourceKey)){cancel(false);view=V.defaults();}key=nextKey;sourceKey=g.sourceKey;const l=V.layout(view,g.image,g.pane);view=l.view;a.layout(l,g);ui(g);return true;}
  function reset(){if(!live)return;if(overflow&&(points.size||overflowIds.size||untrackedOverflow)){ui(geometry());return;}overflow=false;cancel(false);view=V.defaults();refresh();}
  function setZoom(z){if(!live)return;const g=geometry();if(!g)return;cancel(false);if(!finite(z)||z<1||z>V.LIMITS.maxZoom){ui(g);return;}view=V.zoomAt(view,z,{x:g.pane.width/2,y:g.pane.height/2},g.image,g.pane);refresh();}
  function setMode(next){if(!live)return;if(next!=='edit'&&next!=='pan')throw Error('Invalid navigation mode');cancel(false);mode=next;refresh();}
  function position(e,g){if(!finite(e.clientX)||!finite(e.clientY))return null;return {x:e.clientX-g.origin.x,y:e.clientY-g.origin.y};}
  function capture(id){try{a.capture?.(id);}catch{}}
  function pair(){return Array.from(points.values()).slice(0,2);}
  const midpoint=p=>({x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2}),distance=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
  function handle(e){if(!live||!e||typeof e!=='object')return false;if(cache.has(e))return cache.get(e);let used=false;const g=geometry(),id=e.pointerId,type=e.type;if(!g||!Number.isSafeInteger(id)||id<0){cache.set(e,false);return false;}const p=position(e,g);
   if(type==='pointerdown'){
    if(overflow){if(!points.has(id)&&!overflowIds.has(id)){if(overflowIds.size<56)overflowIds.add(id);else untrackedOverflow=true;}capture(id);used=true;ui(g);}
    else if(points.has(id))used=overflow||blocked||mode==='pan';
    else if(p&&(e.pointerType!=='mouse'||e.button===undefined||e.button===0)){
     if(points.size>=8){cancel(false);overflow=true;overflowIds.add(id);capture(id);used=true;ui(g);}
     else{points.set(id,p);capture(id);if(points.size>1){a.cancelEditing();blocked=true;if(points.size===2){const pairPoints=pair();gesture={kind:'pinch',view:V.validate(view),anchor:midpoint(pairPoints),distance:Math.max(1,distance(pairPoints))};}else gesture=null;used=true;}
      else if(blocked||mode==='pan'){a.cancelEditing();blocked=true;gesture={kind:'pan',view:V.validate(view),anchor:p};used=true;}}
    }
   }else if(type==='pointermove'){
    used=overflow||blocked||mode==='pan';if(points.has(id)&&p){points.set(id,p);if(gesture){if(gesture.kind==='pinch'&&points.size===2){const ps=pair();view=V.pinch(gesture.view,gesture.anchor,midpoint(ps),Math.max(.000001,distance(ps)/gesture.distance),g.image,g.pane);refresh();}else if(gesture.kind==='pan'&&points.size===1){view=V.pan(gesture.view,{x:p.x-gesture.anchor.x,y:p.y-gesture.anchor.y},g.image,g.pane);refresh();}}}
   }else if(type==='pointerup'||type==='pointercancel'||type==='lostpointercapture'){
    used=overflow||blocked||mode==='pan';const known=points.delete(id);overflowIds.delete(id);if(type!=='pointerup'&&known)a.cancelEditing();if(known&&gesture)gesture=null;if(!points.size)blocked=false;ui(g);
   }
   if(used)e.preventDefault?.();cache.set(e,used);return used;
  }
  node('viewZoom').oninput=e=>{const text=String(e.target.value);if(!/^(?:\d+)(?:\.\d+)?$/.test(text)){ui(geometry());return;}setZoom(Number(text));};
  node('viewFit').onclick=reset;node('viewPan').onclick=()=>setMode(mode==='pan'?'edit':'pan');
  ui(null);
  return Object.freeze({refresh,reset,cancel,handle,setZoom,setMode,get state(){return{view:V.validate(view),mode,blocked:blocked||overflow,overflow,untrackedOverflow,pointers:points.size+overflowIds.size,gesture:gesture?.kind||null};},release(){cancel(true);live=false;for(const id of controls){node(id).onclick=null;node(id).oninput=null;node(id).disabled=true;}}});
 }
 root.MintViewportUI=Object.freeze({create});
})(typeof globalThis!=='undefined'?globalThis:this);
