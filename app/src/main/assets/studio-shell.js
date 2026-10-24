/* Product navigation only. Pixel operations and project ownership stay in editor.js. */
(function (root) {
  'use strict';
  const groups = [
    { id: 'color', name: '调色', first: 'adjust', tools: ['adjust','filters','light-balance','advanced-tone','levels','local-tone','sharpness','presets'] },
    { id: 'portrait', name: '人像', first: 'portrait', tools: ['portrait','reshape','retouch','background','idphoto'] },
    { id: 'compose', name: '构图', first: 'crop', tools: ['crop','straighten','perspective','canvas-padding'] },
    { id: 'create', name: '创作', first: 'text', tools: ['text','collage','image-overlay','sticker','redact','draw'] }
  ];
  const paths = {
    filters:'M12 3a9 9 0 1 0 0 18V3Z M12 3a9 9 0 0 1 0 18',
    adjust:'M4 7h16M4 17h16M8 4v6M16 14v6',
    'light-balance':'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    'advanced-tone':'M4 4v16h16M6 17c7 0 3-10 12-10', levels:'M5 18V9m5 9V4m5 14v-7m5 7V6',
    'local-tone':'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    sharpness:'m12 3 9 17H3L12 3Zm0 5v7', presets:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z',
    portrait:'M8 3h8l3 5v6l-4 7H9l-4-7V8l3-5ZM8 10h1m6 0h1m-7 6c2 1 4 1 6 0',
    reshape:'M7 3C1 8 4 19 12 21c8-2 11-13 5-18M8 11h1m6 0h1m-6 5h4',
    retouch:'m15 3 6 6-11 11H4v-6L15 3Zm-8 9 6 6M3 3l3 3m0-3L3 6',
    background:'M4 4h16v16H4V4Zm0 12 5-5 4 4 3-3 4 4M15 8h.01',
    idphoto:'M4 3h16v18H4V3Zm5 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0Zm-2 9c0-5 10-5 10 0',
    crop:'M7 3v14h14M3 7h14v14', straighten:'M3 18h18M6 13l14-7M7 18v-3',
    perspective:'m6 4 12 2 3 14H3L6 4Zm1 7h12M9 5l-2 15m8-15 2 15',
    'canvas-padding':'M3 3h18v18H3V3Zm4 4h10v10H7V7Z',
    text:'M4 5h16M12 5v15M8 20h8M4 5v3m16-3v3',
    collage:'M3 3h18v18H3V3Zm8 0v18m0-10h10',
    'image-overlay':'M9 3h12v12H9V3ZM3 9h3m-3 0v12h12v-3',
    sticker:'M12 3a9 9 0 1 0 9 9l-9 9V12h9M8 8h.01m7 0h.01',
    redact:'M3 3h6v6H3V3Zm12 0h6v6h-6V3ZM9 9h6v6H9V9ZM3 15h6v6H3v-6Zm12 0h6v6h-6v-6Z',
    draw:'m16 3 5 5-10 10-7 2 2-7L16 3Zm-9 9 5 5',
    arrow:'M5 12h14m-5-5 5 5-5 5', plus:'M12 4v16M4 12h16',
    leaf:'M4 19C1 7 11 3 21 3c0 10-4 20-17 16Zm0 0L16 8',
    grid:'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
    back:'m14 5-7 7 7 7', history:'M3 5v6h6M4 10a8 8 0 1 1 1 8m7-12v6l4 2',
    compare:'M12 3v18M8 5H3v14h5M16 5h5v14h-5', check:'m5 12 4 4L19 6',
    undo:'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 6 6', redo:'m15 5 5 5-5 5m5-5h-9a6 6 0 0 0-6 6', more:'M5 12h.01M12 12h.01M19 12h.01', zoom:'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5M7 10.5h7m-3.5-3.5v7',
    folder:'M3 7V4h7l2 3h9v13H3V7Zm0 0h7l2 3h9', ai:'M4 5h8M4 5v15h16v-9M17 3v6m-3-3h6M4 16l4-4 5 5 3-3 4 4',
    download:'M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5',
    image:'M3 4h18v16H3V4Zm0 12 5-5 5 5 3-3 5 4M15 8h.01'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="'+(paths[name]||paths.image)+'"/></svg>'; }
  let host=null, currentSource=null, loaded=false, home=true, selectedTool='filters', pendingTool=null, remembered={}, pendingAi=false, actionEpoch=0;
  const $=id=>document.getElementById(id);
  function renderState() {
    if(!$('welcome'))return;
    $('welcome').hidden=!home;
    if(home&&$('viewControls')){$('viewControls').hidden=true;if($('viewToggle'))$('viewToggle').setAttribute('aria-expanded','false');}
    document.body.classList.toggle('is-home',home);
    document.body.classList.toggle('is-editing',!home);
    if($('resumeBtn'))$('resumeBtn').hidden=!loaded;
    for(const id of ['portraitDemoBtn','demoBtn'])if($(id))$(id).addEventListener('click',cancelPendingAi);
    if($('homeBack'))$('homeBack').hidden=home;
    if($('editorTitle'))$('editorTitle').textContent=groups.find(g=>g.tools.includes(selectedTool))?.name||'编辑照片';
  }
  function setTool(tool) {
    selectedTool=tool;document.body.dataset.activeTool=tool;
    const group=groups.find(g=>g.tools.includes(tool))||groups[0];
    remembered[group.id]=tool;
    document.querySelectorAll('[data-category]').forEach(b=>{
      b.classList.toggle('active',b.dataset.category===group.id);
      b.setAttribute('aria-selected',String(b.dataset.category===group.id));
    });
    document.querySelectorAll('.tool[data-tool]').forEach(b=>{b.hidden=!group.tools.includes(b.dataset.tool);});
    const active=document.querySelector('.tool[data-tool="'+tool+'"]');
    if(active){const rail=active.parentElement;if(rail){const left=active.offsetLeft-rail.offsetLeft;if(left<rail.scrollLeft)rail.scrollLeft=left;else if(left+active.offsetWidth>rail.scrollLeft+rail.clientWidth)rail.scrollLeft=left+active.offsetWidth-rail.clientWidth;}}
    if($('currentToolName'))$('currentToolName').textContent=(document.querySelector('.tool[data-tool="'+tool+'"]')?.textContent||'编辑照片').trim();
    renderState();
  }
  function cancelPendingAi(){pendingAi=false;actionEpoch++;}
  function openHomeAi(){
    if(!host||host.busy())return;
    cancelPendingAi();pendingTool=null;
    if(loaded){home=false;renderState();host.fit();$('aiBtn').click();}
    else{pendingAi=true;host.requestImport();}
  }
  function openPendingAi(){
    if(!pendingAi||!loaded||!host||host.busy())return;
    const epoch=actionEpoch;pendingAi=false;
    requestAnimationFrame(()=>{if(epoch!==actionEpoch)return;if(host.busy()){pendingAi=true;return;}home=false;renderState();host.fit();$('aiBtn').click();});
  }
  function update(nextLoaded,tool,source) {
    if(nextLoaded&&source!==currentSource){home=false;currentSource=source;}
    loaded=nextLoaded;
    if(!loaded)home=true;
    if(tool)selectedTool=tool;
    renderState();openPendingAi();
    if(loaded&&pendingTool&&host){const next=pendingTool;pendingTool=null;requestAnimationFrame(()=>host.setTool(next));}
  }
  function showHome(){ if(!host||host.busy())return; home=true;renderState(); }
  function init(adapter){
    host=adapter;
    const toolRail=document.querySelector('.tool-tabs');
    if(toolRail)groups.forEach(group=>group.tools.forEach(tool=>{const button=document.querySelector('.tool[data-tool="'+tool+'"]');if(button)toolRail.appendChild(button);}));
    document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
    document.querySelectorAll('.tool[data-tool]').forEach(el=>{const span=el.querySelector('span');if(span)span.innerHTML=icon(el.dataset.tool);});
    document.querySelectorAll('[data-category]').forEach(el=>el.addEventListener('click',()=>{const group=groups.find(g=>g.id===el.dataset.category);if(group)host.setTool(remembered[group.id]||group.first);}));
    document.querySelectorAll('[data-start-tool]').forEach(el=>el.addEventListener('click',()=>{cancelPendingAi();const tool=el.dataset.startTool;if(loaded){home=false;renderState();host.setTool(tool);}else{pendingTool=tool;host.requestImport();}}));
    document.querySelectorAll('[data-sample-filter]').forEach(el=>el.addEventListener('click',()=>{pendingTool=null;host.loadStudioDemo(el.dataset.sampleFilter);}));
    for(const id of ['portraitDemoBtn','demoBtn'])if($(id))$(id).addEventListener('click',cancelPendingAi);
    if($('homeBack'))$('homeBack').addEventListener('click',showHome);
    if($('viewToggle'))$('viewToggle').addEventListener('click',()=>{const drawer=$('viewControls');drawer.hidden=!drawer.hidden;$('viewToggle').setAttribute('aria-expanded',String(!drawer.hidden));host.fit();});
    if($('resumeBtn'))$('resumeBtn').addEventListener('click',()=>{home=false;renderState();host.fit();});
    document.querySelectorAll('.header-menu-items button').forEach(b=>b.addEventListener('click',()=>{if($('headerMenu'))$('headerMenu').open=false;}));
    if($('homeLibrary'))$('homeLibrary').addEventListener('click',()=>{cancelPendingAi();$('projectLibraryBtn').click();});
    if($('homeAiBtn'))$('homeAiBtn').addEventListener('click',openHomeAi);
    for(const id of ['importBtn','openTop'])if($(id))$(id).addEventListener('click',cancelPendingAi);
    if($('busy')&&typeof MutationObserver==='function')new MutationObserver(()=>{if(pendingAi&&!loaded&&$('busy').hidden){cancelPendingAi();return;}openPendingAi();}).observe($('busy'),{attributes:true,attributeFilter:['hidden']});
    if($('studioDemoBtn'))$('studioDemoBtn').addEventListener('click',()=>{cancelPendingAi();pendingTool=null;host.loadStudioDemo('original');});
    if($('fileInput'))$('fileInput').addEventListener('cancel',()=>{pendingTool=null;cancelPendingAi();});
    if($('homeImport'))$('homeImport').addEventListener('click',()=>host.requestImport());
    if($('saveProjectQuick'))$('saveProjectQuick').addEventListener('click',()=>$('projectLibraryBtn').click());
    // Explanatory copy is kept accessible, without dominating the first screen.
    const panel=$('toolPanel');
    if(panel&&typeof MutationObserver==='function'){
      new MutationObserver(()=>{
        if(panel.querySelector('.tool-help'))return;
        const notes=Array.from(panel.querySelectorAll('p.portrait-copy.subtle,p.panel-note')).filter(n=>n.textContent.length>110);
        if(!notes.length)return;
        const help=document.createElement('details');help.className='tool-help';
        const summary=document.createElement('summary');summary.textContent='使用说明与范围';help.appendChild(summary);
        notes.forEach(n=>help.appendChild(n));panel.appendChild(help);
      }).observe(panel,{childList:true,subtree:true});
    }
    setTool(selectedTool);renderState();
  }
  root.MintStudio={init,update,setTool,icon};
})(typeof window==='undefined'?globalThis:window);
