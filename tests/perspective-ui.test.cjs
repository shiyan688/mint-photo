'use strict';
// Shipped UI, production operation adapter and genuine projective core in a controlled DOM.
// A small pixel-canvas fixture exercises delegation and ownership, not native
// Canvas interpolation. Native PNG/export rendering belongs to integration QA.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assets = path.join(__dirname, '../app/src/main/assets');
const plain = value => JSON.parse(JSON.stringify(value));
function harness(options = {}) {
  const nodes = {}, notices = [], hints = [], assessments = [], previews = [], canvases = [];
  let draft = null, revision = '1/1', renders = 0, assessmentOverride = null, renderFailures = 0;
  let renderHook = null;
  let full = { w: options.fullWidth || 1200, h: options.fullHeight || 800 };
  function canvas(width, height) {
    let w = width, h = height, bytes = new Uint8ClampedArray(w * h * 4);
    const c = { reads: 0, writes: 0, draws: 0, get bytes() { return bytes; }, getContext() {
      return { getImageData() { c.reads++; return { data: bytes.slice() }; }, createImageData(a, b) { return { data: new Uint8ClampedArray(a * b * 4) }; },
        putImageData(image) { bytes.set(image.data); c.writes++; }, drawImage(input, _x, _y, dw = w, dh = h) {
          c.draws++; const sw = input.width, sh = input.height;
          for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
            const from = (Math.min(sh - 1, Math.floor(y * sh / dh)) * sw + Math.min(sw - 1, Math.floor(x * sw / dw))) * 4;
            bytes.set(input.bytes.subarray(from, from + 4), (y * w + x) * 4);
          }
        } };
    } };
    Object.defineProperties(c, {
      width: { enumerable: true, get: () => w, set(value) { c.writes++; w = value; bytes = new Uint8ClampedArray(w * h * 4); } },
      height: { enumerable: true, get: () => h, set(value) { c.writes++; h = value; bytes = new Uint8ClampedArray(w * h * 4); } }
    });
    canvases.push(c); return c;
  }
  let source = canvas(options.width || 120, options.height || 80);
  for (let i = 0; i < source.bytes.length; i++) source.bytes[i] = i % 4 === 3 ? 255 : (i * 29 + 11) % 256;
  source.writes = 0;
  function element(id, attrs = '') {
    const node = { id, value: '', checked: false, disabled: false, isConnected: true, textContent: '',
      click() { if (!this.disabled && this.onclick) return this.onclick({ target: this }); } };
    for (const k of ['min', 'max', 'step', 'type']) node[k] = attrs.match(new RegExp('\\b' + k + '="([^"]+)"'))?.[1] || '';
    nodes[id] = node; return node;
  }
  const panel = element('toolPanel'); element('editLabel'); panel.querySelector = selector => nodes[selector.slice(1)] || null;
  Object.defineProperty(panel, 'innerHTML', { get: () => panel.markup, set(html) {
    panel.markup = html;
    for (const id of Object.keys(nodes)) if (!['toolPanel', 'editLabel'].includes(id)) { nodes[id].isConnected = false; delete nodes[id]; }
    for (const match of html.matchAll(/<[a-z]+\b([^>]*\bid="([^"]+)"[^>]*)>/g)) element(match[2], match[1]);
  } });
  const env = { console, Uint8Array, Uint8ClampedArray, ArrayBuffer, Float64Array, Float32Array,
    document: { getElementById: id => nodes[id] || null, createElement() { throw Error('The adapter must own preview allocation'); } } };
  vm.createContext(env);
  const load = name => vm.runInContext(fs.readFileSync(path.join(assets, name), 'utf8'), env, { filename: name });
  if (!options.missingCore) load('perspective.js');
  if (!options.missingOperation) load('perspective-operation.js');
  const actualOperation = env.MintPerspectiveOperation;
  if (actualOperation) env.MintPerspectiveOperation = Object.freeze({ ...actualOperation, applyCanvas(input, op, create, opts) {
    const output = actualOperation.applyCanvas(input, op, create, opts); previews.push({ input, op, opts, output }); return output;
  } });
  load('perspective-ui.js');
  const adapter = { panel, getDraft: () => draft, setDraft: d => { draft = d; }, getCanvas: () => source,
    createCanvas: canvas, revision: () => revision, outputSize: () => full,
    render() { renders++; if (renderFailures > 0) { renderFailures--; throw Error('preview rendering failed'); } if (renderHook) renderHook(); },
    toast: text => notices.push(text), hint: text => hints.push(text),
    assess(op) {
      assessments.push(op);
      if (assessmentOverride) return assessmentOverride(op);
      const result = {};
      for (const mode of ['original', 'working']) try {
        const w = mode === 'original' ? full.w : source.width, h = mode === 'original' ? full.h : source.height;
        result[mode] = { allowed: true, output: plain(actualOperation.plan(w, h, op).outputSize), error: '' };
      } catch (error) { result[mode] = { allowed: false, output: null, error: error.message }; }
      return result;
    } };
  const ui = env.PerspectiveUI, ready = ui.setup(adapter);
  return { env, ui, adapter, panel, nodes, notices, hints, assessments, previews, canvases, actualOperation, ready,
    get draft() { return draft; }, set draft(value) { draft = value; }, get source() { return source; }, get renders() { return renders; },
    setSource(value) { source = value; }, setRevision(value) { revision = value; }, setFull(w, h, basis) { full = basis === undefined ? { w, h } : { w, h, basis }; },
    setRenderHook(fn) { renderHook = fn; },
    assessWith(fn) { assessmentOverride = fn; }, failRender() { renderFailures++; }, replaceNode(id) { return element('px-' + id); },
    click(id) { return nodes['px-' + id].click(); },
    change(id, value) { const n = nodes['px-' + id]; n.value = String(value); return n.onchange && n.onchange({ target: n }); },
    grid(value) { const n = nodes['px-grid']; n.checked = value; return n.onchange && n.onchange({ target: n }); },
    run(code) { return vm.runInContext(code, env); }
  };
}
const allowed = (width = 130, height = 100) => ({ allowed: true, error: '', output: { width, height } });
const blocked = error => ({ allowed: false, error, output: null });

const neutral = { version: 1, quad: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}], outputFraction: { width:1,height:1 } };
const snapshot = h => JSON.stringify(h.draft);
function drag(h, from, to, finish = true) {
  const token = h.ui.start(h.draft, from); assert(token);
  const moved = h.ui.move(h.draft, to, token);
  if (finish) h.ui.finish(h.draft, to, token);
  return moved;
}
function overlayContext() {
  const lines = [], labels = [], arcs = [], calls = [];
  return { lines, labels, arcs, calls, save(){calls.push('save');},restore(){calls.push('restore');},setLineDash(){},beginPath(){},
    moveTo(...p){lines.push(p);},lineTo(...p){lines.push(p);},stroke(){calls.push('stroke');},arc(...a){arcs.push(a);},fill(){},
    fillText(...args){labels.push(args);},strokeText(){} };
}

test('initial state is exact portable neutral with labeled source-edge coordinates and real output dimensions', () => {
  const h = harness(); assert.equal(h.ready, h.draft); assert.deepEqual(plain(h.draft), {type:'perspective',recipe:neutral});
  assert.equal(h.ui.changed(h.draft), false); assert.equal(h.ui.canApply(h.draft), false);
  assert.equal(h.nodes['px-preview'].textContent, '校正预览'); assert.equal(h.nodes['px-grid'].checked, true);
  assert.match(h.panel.markup, /左上 TL → 右上 TR → 右下 BR → 左下 BL/); assert.match(h.panel.markup, /像素外边缘/);
  assert.match(h.panel.markup, /不替换已保留原图/); assert.match(h.nodes['px-mode-note'].textContent, /原始当前画面.*选角/);
  assert.equal(h.nodes['px-width'].value, '1200'); assert.equal(h.nodes['px-height'].value, '800');
  assert.match(h.nodes['px-declared-size'].textContent, /1200 × 800/); assert.match(h.nodes['px-working-export'].textContent, /120 × 80/);
  assert.equal(h.nodes['px-2-x'].value, '100'); assert.equal(h.nodes['px-2-y'].value, '100');
  assert.doesNotMatch(h.panel.markup, /<canvas|<img|<script|type="file"/);
});
test('source preview is always a fresh bounded copy, never a transform or source mutation', () => {
  const h = harness(), before = h.source.bytes.slice(); h.change('0-x', '10');
  const a = h.ui.preview(h.draft), b = h.ui.preview(h.draft);
  assert.notEqual(a,b); assert.notEqual(a,h.source); assert.deepEqual(a.bytes,before); assert.deepEqual(b.bytes,before);
  assert.equal(h.previews.length,0); assert.equal(h.source.reads,0); assert.equal(h.source.writes,0);
  a.width=1; a.height=1; assert.deepEqual(h.source.bytes,before); assert.equal(h.source.width,120);
  assert.equal(h.ui.canApply(h.draft),true);
});
test('corrected preview uses genuine projective adapter and never shows draggable source handles', () => {
  const h = harness(); h.change('0-x','20'); h.change('1-y','15'); const before = h.source.bytes.slice(), recipe=snapshot(h);
  const sourceView=h.ui.preview(h.draft); h.click('preview'); assert.equal(h.nodes['px-preview'].textContent,'返回选角');
  assert.equal(h.nodes['px-0-x'].disabled,true); assert.equal(h.nodes['px-grid'].disabled,true);
  assert.equal(h.ui.start(h.draft,{x:0.2,y:0}),false); assert.equal(h.ui.move(h.draft,{x:0.3,y:0.1}),false);
  const corrected=h.ui.preview(h.draft), ctx=overlayContext(); h.ui.overlay(ctx,600,400,h.draft);
  assert.equal(ctx.arcs.length,0); assert.equal(ctx.lines.length,0); assert.equal(h.previews.length,1);
  assert.notDeepEqual(corrected.bytes,sourceView.bytes); assert.equal(h.previews[0].input,h.source); assert.equal(h.previews[0].opts.maxSide,900);
  assert.equal(snapshot(h),recipe); assert.deepEqual(h.source.bytes,before); assert.equal(h.source.writes,0);
  h.click('preview'); assert.equal(h.nodes['px-0-x'].disabled,false); assert.equal(h.nodes['px-preview'].textContent,'校正预览');
  assert.deepEqual(h.ui.preview(h.draft).bytes,before); assert.equal(snapshot(h),recipe);
});
test('output fields set fractions of explicit full basis and retain real rounded stage outputs', () => {
  const h=harness(); assert.equal(h.change('width','601'),true); assert.equal(h.change('height','399'),true);
  assert.equal(h.draft.recipe.outputFraction.width,601/1200); assert.equal(h.draft.recipe.outputFraction.height,399/800);
  assert.match(h.nodes['px-declared-size'].textContent,/601 × 399/); assert.match(h.nodes['px-working-export'].textContent,/60 × 40/);
  assert.equal(h.nodes['px-width'].max,'1200'); assert.equal(h.nodes['px-height'].max,'800');
  h.click('preview'); const p=h.ui.preview(h.draft); assert.equal(p.width,60); assert.equal(p.height,40);
  assert.equal(h.change('width','1'),true); assert.equal(h.change('height','1'),true); const tiny=h.ui.preview(h.draft); assert.equal(tiny.width,1); assert.equal(tiny.height,1);
});
test('blank, nondecimal, nonfinite, excessive length, underflow and fractional pixel values retain last valid geometry', () => {
  const h=harness(); h.change('0-x','10'); h.change('width','600'); const before=snapshot(h);
  for(const value of ['', ' ', 'NaN', 'Infinity', '-Infinity', '0x10','false','12px','1e309','1e-999','0'.repeat(129),'-1','101']) {
    assert.equal(h.change('0-x',value),false,value); assert.equal(snapshot(h),before); assert.equal(h.nodes['px-0-x'].value,'10');
  }
  for(const value of ['0','-1','1201','1.5','NaN','','0x10','1e-999']) { assert.equal(h.change('width',value),false,value); assert.equal(snapshot(h),before); assert.equal(h.nodes['px-width'].value,'600'); }
  assert.equal(h.change('width','6e2'),true); assert.equal(h.change('0-y','-0'),true); assert.equal(Object.is(h.draft.recipe.quad[0].y,-0),false);
});
test('crossed, concave, repeated and collinear corner edits reject without reordering or losing a valid recipe', () => {
  const h=harness(); h.change('0-x','15'); const before=snapshot(h);
  assert.equal(h.change('0-y','100'),false); assert.equal(snapshot(h),before);
  assert.equal(h.change('0-x','100'),false); assert.equal(snapshot(h),before);
  assert.match(h.nodes['px-status'].textContent,/凸四边形.*不能交叉或共线/);
  const token=h.ui.start(h.draft,{x:.15,y:0}); assert(token); assert.equal(h.ui.move(h.draft,{x:.9,y:.9},token),false);
  assert.equal(snapshot(h),before); h.ui.cancelGesture(); assert.equal(snapshot(h),before);
});
test('nearest corner hit limit does not jump or move on background taps and moving is bounded to source axes', () => {
  const h=harness(); const before=snapshot(h); assert.equal(h.ui.start(h.draft,{x:.5,y:.5}),false); assert.equal(h.ui.start(h.draft,{x:.13,y:0}),false);
  assert.equal(h.ui.start(h.draft,{x:-.01,y:0}),false); assert.equal(h.ui.start(h.draft,{x:NaN,y:0}),false);
  const token=h.ui.start(h.draft,{x:.05,y:.05}); assert(token); assert.equal(snapshot(h),before);
  assert.equal(h.ui.move(h.draft,{x:.15,y:.2},token),true); assert.equal(h.draft.recipe.quad[0].x,.15-.05); assert.equal(h.draft.recipe.quad[0].y,.2-.05);
  assert.equal(h.ui.canApply(h.draft),false); h.ui.finish(h.draft,{x:.15,y:.2},token); assert.equal(h.ui.canApply(h.draft),true);
  const second=h.ui.start(h.draft,h.draft.recipe.quad[0]); assert(second); h.ui.move(h.draft,{x:-5,y:-8},second); h.ui.finish(h.draft,{x:-5,y:-8},second);
  assert.deepEqual(plain(h.draft.recipe.quad[0]),{x:0,y:0}); assert.equal(h.ui.changed(h.draft),false);
});
test('gesture cancellation restores exact start recipe including dimensions; stale tokens cannot drive newer gestures', () => {
  const h=harness(); h.change('0-x','12.3456789012345'); h.change('width','733'); const before=snapshot(h), ref=h.draft.recipe;
  const token=h.ui.start(h.draft,h.draft.recipe.quad[0]); h.ui.move(h.draft,{x:.2,y:.1},token); assert.notEqual(snapshot(h),before);
  assert.equal(h.ui.cancelGesture(),true); assert.equal(snapshot(h),before); assert.equal(h.draft.recipe,ref); assert.equal(h.ui.cancelGesture(),false);
  const second=h.ui.start(h.draft,h.draft.recipe.quad[0]); assert.equal(h.ui.move(h.draft,{x:.3,y:.2},token),false);
  assert.equal(h.ui.finish(h.draft,{x:.3,y:.2},token),false); h.ui.move(h.draft,{x:.2,y:.1},second); h.ui.finish(h.draft,null,second,true); assert.equal(snapshot(h),before);
  assert.equal(h.source.writes,0);
});
test('second-touch/blur cancellation leaves no transient change, and switching views cancels an active selection', () => {
  for(const cause of ['second-touch','blur','pointercancel']) { const h=harness(), before=snapshot(h); drag(h,{x:0,y:0},{x:.2,y:.1},false); assert.equal(h.ui.cancelGesture(),true,cause); assert.equal(snapshot(h),before); assert.equal(h.ui.changed(h.draft),false); }
  const h=harness(),before=snapshot(h); drag(h,{x:0,y:0},{x:.2,y:.1},false); h.click('preview'); assert.equal(snapshot(h),before); assert.equal(h.nodes['px-preview'].textContent,'返回选角');
});
test('reset restores full neutral coordinates and fractions without history or original pixel mutations', () => {
  const h=harness(), source=h.source.bytes.slice(); h.change('0-x','20'); h.change('2-y','80'); h.change('width','551'); h.change('height','433');
  h.click('preview'); h.ui.preview(h.draft); h.click('reset'); assert.deepEqual(plain(h.draft.recipe),neutral); assert.equal(h.ui.changed(h.draft),false); assert.equal(h.ui.canApply(h.draft),false);
  assert.equal(h.nodes['px-width'].value,'1200'); assert.equal(h.nodes['px-height'].value,'800'); assert.deepEqual(h.source.bytes,source); assert.equal(h.source.writes,0);
  assert.deepEqual(Object.keys(h.draft).sort(),['recipe','type']); assert.deepEqual(Object.keys(h.draft.recipe).sort(),['outputFraction','quad','version']);
});
test('both neutral and active previews honor 900 cap without changing saved geometry or declared output', () => {
  const h=harness({width:1000,height:600,fullWidth:4000,fullHeight:2400}); const initial=h.ui.preview(h.draft); assert.equal(initial.width,900); assert.equal(initial.height,540);
  h.change('0-x','10'); h.change('height','1200'); const before=snapshot(h); h.click('preview'); const out=h.ui.preview(h.draft);
  assert.equal(out.width,900); assert.equal(out.height,270); assert.equal(snapshot(h),before); assert.match(h.nodes['px-declared-size'].textContent,/4000 × 1200/);
  assert.match(h.nodes['px-working-export'].textContent,/1000 × 300/); assert.equal(h.source.width,1000); assert.equal(h.source.height,600);
});
test('full transform failure retains valid draft, original opaque pixels, and disables Apply even after returning to source', () => {
  const h=harness(); h.change('0-x','10'); const before=snapshot(h), source=h.source.bytes.slice(); h.click('preview');
  h.env.MintPerspectiveOperation={...h.actualOperation,applyCanvas(){throw Error('forced transform failure');}};
  assert.throws(()=>h.ui.preview(h.draft)); assert.equal(snapshot(h),before); assert.equal(h.ui.canApply(h.draft),false);
  h.click('preview'); assert.deepEqual(h.ui.preview(h.draft).bytes,source); assert.equal(h.ui.canApply(h.draft),false);
  h.change('0-x','11'); assert.equal(h.ui.canApply(h.draft),false); assert.deepEqual(h.source.bytes,source);
  h.env.MintPerspectiveOperation=h.actualOperation; h.click('preview'); h.ui.preview(h.draft); assert.equal(h.ui.canApply(h.draft),true);
  for(let i=3;i<h.source.bytes.length;i+=4) assert.equal(h.source.bytes[i],255);
});
test('source canvas aliases, fake identities, reused outputs, and wrong dimensions fail closed', () => {
  const a=harness(); a.change('0-x','10'); a.adapter.createCanvas=()=>a.source; assert.throws(()=>a.ui.preview(a.draft)); assert.equal(a.source.width,120); assert.equal(a.source.height,80); assert.equal(a.ui.canApply(a.draft),false);
  const b=harness(); b.change('0-x','10'); b.click('preview'); b.env.MintPerspectiveOperation={...b.actualOperation,applyCanvas:input=>input}; assert.throws(()=>b.ui.preview(b.draft),/未完成/); assert.equal(b.ui.canApply(b.draft),false);
  const c=harness(); c.change('0-x','10'); c.click('preview'); c.env.MintPerspectiveOperation={...c.actualOperation,applyCanvas:(_i,_o,create)=>create(2,3)}; assert.throws(()=>c.ui.preview(c.draft),/尺寸不符/); assert.equal(c.ui.canApply(c.draft),false); assert.equal(c.canvases.at(-1).width,1);
});
test('projective grid and all four labels are source-only UI overlays, not recipe data or output pixels', () => {
  const h=harness(); h.change('0-x','20'); h.change('1-y','10'); const before=snapshot(h), source=h.source.bytes.slice(), ctx=overlayContext();
  h.ui.overlay(ctx,600,400,h.draft); assert.equal(ctx.arcs.length,4); assert.equal(ctx.labels.length,4); assert.deepEqual(ctx.labels.map(x=>x[0]),['左上 TL','右上 TR','右下 BR','左下 BL']);
  assert.equal(ctx.lines.length,13); assert.equal(snapshot(h),before); assert.deepEqual(h.source.bytes,source);
  h.grid(false); const noGrid=overlayContext(); h.ui.overlay(noGrid,600,400,h.draft); assert.equal(noGrid.lines.length,5); assert.equal(noGrid.labels.length,4);
  assert.equal(snapshot(h),before); h.click('preview'); const noHandles=overlayContext(); h.ui.overlay(noHandles,600,400,h.draft); assert.equal(noHandles.lines.length,0); assert.equal(noHandles.labels.length,0);
});
test('source grid uses the actual inverse homography rather than bilinear thirds of distorted edges', () => {
  const h=harness(); h.change('0-x','30'); h.change('1-x','80'); const ctx=overlayContext(); h.ui.overlay(ctx,600,400,h.draft);
  const actual=ctx.lines[7]; // First horizontal grid endpoint: q0-to-q3 at output one-third.
  assert.notEqual(actual[1],400/3); assert(actual[1]>0 && actual[1]<400);
});
test('blocked export modes keep geometry and show both reasons, but allow either independently available mode', () => {
  const h=harness(); h.assessWith(()=>({original:blocked('原尺寸超过800万像素'),working:blocked('工作阶段累计预算已满')})); assert.equal(h.change('0-x','10'),true);
  assert.equal(h.ui.changed(h.draft),true); assert.equal(h.ui.canApply(h.draft),false); assert.match(h.nodes['px-budget'].textContent,/两种方式均不可用.*不会静默/);
  assert.match(h.nodes['px-original-export'].textContent,/原尺寸超过800万像素/); assert.match(h.nodes['px-working-export'].textContent,/累计预算/);
  h.assessWith(()=>({original:blocked('原图过大'),working:allowed(120,80)})); assert.equal(h.ui.canApply(h.draft),true);
  h.assessWith(()=>({original:allowed(1200,800),working:blocked('工作模式不可用')})); assert.equal(h.ui.canApply(h.draft),true);
});
test('huge original metadata cannot hide a valid working edit and working-basis fallback is explicit', () => {
  const h=harness({fullWidth:30000,fullHeight:20000}); assert.equal(h.ready,h.draft); assert.equal(h.change('0-x','10'),true); assert.equal(h.ui.canApply(h.draft),true);
  assert.match(h.nodes['px-basis'].textContent,/30000 × 20000/); assert.match(h.nodes['px-original-export'].textContent,/不可用/); assert.match(h.nodes['px-working-export'].textContent,/可用/);
  h.setFull(3000,2000,'working'); h.ui.setup(h.adapter); assert.match(h.nodes['px-basis'].textContent,/当前工作尺寸推算：3000 × 2000/);
});
test('malformed, inherited or accessor assessment output fails closed without calling getters', () => {
  const h=harness(); h.change('0-x','10'); const before=snapshot(h); let called=0;
  const inherited=Object.create({allowed:true}); inherited.output={width:120,height:80};
  const accessor={working:allowed()}; Object.defineProperty(accessor,'original',{enumerable:true,get(){called++;return allowed();}});
  const outputAccessor={height:80}; Object.defineProperty(outputAccessor,'width',{enumerable:true,get(){called++;return 120;}});
  for(const result of [null,{}, {original:allowed()}, {original:inherited,working:allowed()},accessor,{original:{allowed:true,output:outputAccessor},working:allowed()},
    {original:{allowed:'true',output:{width:2,height:2}},working:allowed()},{original:allowed(5000,1),working:allowed()},{original:blocked(''),working:allowed()}]) {
    h.assessWith(()=>result); assert.equal(h.ui.canApply(h.draft),false); assert.equal(h.change('0-x','20'),false); assert.equal(snapshot(h),before);
  }
  assert.equal(called,0); assert.throws(()=>h.ui.preview(h.draft));
});
test('stale source identity, dimensions, basis, revision, draft or detached panel cannot edit or preview', () => {
  for(const kind of ['identity','size','basis','revision','draft','panel']) {
    const h=harness(); h.change('0-x','10'); const d=h.draft,before=JSON.stringify(d),renders=h.renders;
    if(kind==='identity')h.setSource({width:120,height:80,getContext(){}}); if(kind==='size')h.source.width=121;
    if(kind==='basis')h.setFull(1201,800); if(kind==='revision')h.setRevision('stale'); if(kind==='draft')h.draft={type:'other'}; if(kind==='panel')h.panel.isConnected=false;
    h.change('0-x','20');h.click('reset');assert.equal(JSON.stringify(d),before); assert.equal(h.renders,renders);
    assert.equal(h.ui.start(d,{x:.1,y:0}),false);assert.equal(h.ui.changed(d),false);assert.equal(h.ui.canApply(d),false);assert.throws(()=>h.ui.preview(d));
  }
});
test('detached controls, old callbacks, foreign event targets and closed sessions never mutate a new photo', () => {
  const h=harness(),old=h.nodes['px-0-x'],callback=old.onchange; old.value='20';old.isConnected=false;callback({target:old});assert.equal(h.draft.recipe.quad[0].x,0);
  old.isConnected=true;h.replaceNode('0-x');callback({target:old});assert.equal(h.draft.recipe.quad[0].x,0);
  const g=harness();g.nodes['px-0-x'].onchange({target:{value:'77'}});assert.equal(g.draft.recipe.quad[0].x,0);
  const reset=g.nodes['px-reset'].onclick,previous=g.draft;g.ui.release();g.ui.setup(g.adapter);g.change('0-x','15');reset({});assert.equal(g.draft.recipe.quad[0].x,.15);assert.deepEqual(plain(previous.recipe),neutral);
});
test('source import cancels transient drag and restores only the same unchanged source after a failed import', () => {
  const h=harness();h.change('0-x','15');h.change('width','733');const before=snapshot(h),old=h.nodes['px-0-x'].onchange;
  drag(h,{x:.15,y:0},{x:.25,y:.1},false);h.setRevision('1/2');assert.equal(h.ui.sourceImportStarted(),true);assert.equal(snapshot(h),before);
  assert.equal(h.nodes['px-preview'].disabled,true);assert.equal(h.ui.canApply(h.draft),false);assert.throws(()=>h.ui.preview(h.draft));
  assert.equal(h.ui.sourceImportFinished(),true);assert.equal(h.nodes['px-preview'].disabled,false);assert.equal(snapshot(h),before);
  h.nodes['px-0-x'].value='50';old({target:h.nodes['px-0-x']});assert.equal(h.draft.recipe.quad[0].x,.15);assert.equal(h.change('0-x','16'),true);
});
test('successful main-photo import, stale basis, late finish or release cannot rebind an old selection', () => {
  for(const kind of ['source','size','basis','draft']) {
    const h=harness();h.change('0-x','15');const previous=h.draft;h.setRevision('1/2');h.ui.sourceImportStarted();
    if(kind==='source')h.setSource({width:120,height:80});if(kind==='size')h.source.height++;if(kind==='basis')h.setFull(1100,800);if(kind==='draft')h.draft={type:'other'};
    assert.equal(h.ui.sourceImportFinished(),false);assert.equal(h.ui.canApply(previous),false);assert.equal(previous.recipe.quad[0].x,.15);assert.equal(h.nodes['px-preview'].disabled,true);
  }
  const h=harness();h.ui.sourceImportStarted();h.ui.release();assert.equal(h.ui.sourceImportFinished(),false);h.ui.setup(h.adapter);assert.equal(h.ui.sourceImportFinished(),false);
});
test('revision changes during assessment or allocation stop late commits and preserve current photo', () => {
  const h=harness(),before=snapshot(h),renders=h.renders;h.assessWith(()=>{h.setRevision('new');return{original:allowed(),working:allowed()};});
  assert.equal(h.change('0-x','10'),false);assert.equal(snapshot(h),before);assert.equal(h.renders,renders);
  const g=harness();g.change('0-x','10');g.click('preview');const source=g.source.bytes.slice(),allocate=g.adapter.createCanvas;
  g.adapter.createCanvas=(w,hh)=>{const c=allocate(w,hh);g.setRevision('new');return c;};assert.throws(()=>g.ui.preview(g.draft));assert.deepEqual(g.source.bytes,source);
});
test('render failures roll settings back and release removes only handlers owned by that session', () => {
  const h=harness();h.change('0-x','10');const before=snapshot(h);h.failRender();assert.equal(h.change('0-x','20'),false);assert.equal(snapshot(h),before);assert.equal(h.nodes['px-0-x'].value,'10');
  const nodes=Object.values(h.nodes),foreign=()=>{};h.nodes['px-grid'].onchange=foreign;h.ui.release();h.ui.release();
  for(const n of nodes)for(const key of ['onclick','onchange'])if(n[key]!==undefined && n[key]!==foreign)assert.equal(n[key],null);assert.equal(h.nodes['px-grid'].onchange,foreign);
});
test('missing modules, malformed output plans and hostile draft data cannot show a usable fake operation', () => {
  for(const option of ['missingCore','missingOperation']){const h=harness({[option]:true});assert.equal(h.ready,null);assert.equal(h.draft,null);assert.equal(h.renders,0);assert.match(h.panel.textContent,/核心未加载/);}
  const h=harness();h.change('0-x','10');const before=snapshot(h);h.env.MintPerspectiveOperation={...h.actualOperation,plan(){return{outputSize:{width:120,height:80},renderedSize:{width:901,height:50}};}};
  assert.equal(h.ui.canApply(h.draft),false);assert.equal(h.change('0-x','20'),false);assert.equal(snapshot(h),before);assert.throws(()=>h.ui.preview(h.draft),/900/);
  const g=harness();g.env.__draft=g.draft;g.run('globalThis.__called=0;Object.defineProperty(__draft,"recipe",{enumerable:true,configurable:true,get(){__called++;throw Error("must not execute");}});');
  assert.equal(g.ui.changed(g.draft),false);assert.equal(g.ui.canApply(g.draft),false);assert.throws(()=>g.ui.preview(g.draft));assert.equal(g.env.__called,0);
});
test('budget errors use textContent without injecting markup', () => {
  const h=harness(),markup=h.panel.markup;h.assessWith(()=>({original:blocked('<img src=x onerror=alert(1)>'),working:blocked('阶段预算不足')}));h.change('0-x','10');
  assert.equal(h.panel.markup,markup);assert.match(h.nodes['px-original-export'].textContent,/<img src=x/);assert.equal(h.nodes.img,undefined);
});

test('reentrant assessment, render and import callbacks cannot commit an old edit into a reopened tool', () => {
  const h=harness(),previous=h.draft;h.assessWith(()=>{h.assessWith(null);h.setRevision('new-session');h.ui.setup(h.adapter);return {original:allowed(),working:allowed()};});
  assert.equal(h.change('0-x','20'),false);assert.notEqual(h.draft,previous);assert.deepEqual(plain(h.draft.recipe),neutral);assert.deepEqual(plain(previous.recipe),neutral);
  const g=harness();g.change('0-x','10');const old=g.draft;
  g.setRenderHook(()=>{g.setRenderHook(null);g.setRevision('new-session');g.ui.setup(g.adapter);});
  assert.equal(g.change('0-x','20'),false);assert.notEqual(g.draft,old);assert.deepEqual(plain(g.draft.recipe),neutral);assert.equal(g.nodes['px-preview'].disabled,false);
  const k=harness();k.change('0-x','10');k.ui.sourceImportStarted();k.setRenderHook(()=>{k.setRenderHook(null);k.setRevision('new-session');k.ui.setup(k.adapter);});
  assert.equal(k.ui.sourceImportFinished(),false);assert.deepEqual(plain(k.draft.recipe),neutral);assert.equal(k.nodes['px-preview'].disabled,false);assert.equal(k.nodes['px-0-x'].disabled,false);
});
test('allocation-time replacement is checked before dimension writes and a reused preview canvas is rejected', () => {
  const h=harness(),allocate=h.adapter.createCanvas;let replacement;
  h.adapter.createCanvas=()=>{replacement=allocate(31,17);h.setSource(replacement);h.setRevision('replacement');return replacement;};
  assert.throws(()=>h.ui.preview(h.draft));assert.equal(replacement.width,31);assert.equal(replacement.height,17);assert.equal(replacement.writes,0);
  const g=harness(),first=g.ui.preview(g.draft),bytes=first.bytes.slice();g.adapter.createCanvas=()=>first;
  assert.throws(()=>g.ui.preview(g.draft));assert.equal(first.width,120);assert.equal(first.height,80);assert.deepEqual(first.bytes,bytes);
});
test('synchronous corrected render failures keep last valid geometry and latch Apply until a genuine successful retry', () => {
  const h=harness();h.change('0-x','10');const before=snapshot(h);h.setRenderHook(()=>h.ui.preview(h.draft));
  h.env.MintPerspectiveOperation={...h.actualOperation,applyCanvas(){throw Error('render unavailable');}};
  assert.equal(h.click('preview'),false);assert.equal(snapshot(h),before);assert.equal(h.nodes['px-preview'].textContent,'校正预览');assert.equal(h.ui.canApply(h.draft),false);
  h.env.MintPerspectiveOperation=h.actualOperation;assert.equal(h.click('preview'),true);assert.equal(h.nodes['px-preview'].textContent,'返回选角');assert.equal(h.ui.canApply(h.draft),true);
});
test('pixel edits during an active drag preserve the entered value rather than consuming reset control text', () => {
  const h=harness();drag(h,{x:0,y:0},{x:.2,y:.1},false);assert.equal(h.change('width','733'),true);assert.equal(h.draft.recipe.outputFraction.width,733/1200);
  assert.deepEqual(plain(h.draft.recipe.quad),neutral.quad);assert.equal(h.ui.cancelGesture(),false);
});

test('UI discloses bounded prefilter softness and does not imply hidden output downsizing',()=>{const h=harness();assert.match(h.panel.markup,/缩小使用预滤波/);assert.match(h.panel.markup,/两方向压缩相差很大时细节仍可能变软/);assert.match(h.panel.markup,/不静默缩小声明尺寸/);});
