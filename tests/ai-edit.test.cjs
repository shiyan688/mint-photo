'use strict';const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');const C=require('../app/src/main/assets/ai-edit-core.js');
test('outpaint uses real pixel padding per side and rejects empty or oversized geometry',()=>{assert.deepEqual(C.plan(1000,800,{mode:'outpaint',left:.1,right:.2,top:0,bottom:.5}),{mode:'outpaint',width:1300,height:1200,x:100,y:0,sourceWidth:1000,sourceHeight:800});for(const o of [{mode:'outpaint',left:0,right:0,top:0,bottom:0},{mode:'outpaint',left:-.1},{mode:'outpaint',top:NaN},{mode:'unknown'}])assert.throws(()=>C.plan(1000,800,o));assert.throws(()=>C.plan(2560,2560,{mode:'outpaint'}));});
function transport(android){const root={Android:android,AbortController,DOMException,setTimeout,clearTimeout,Date,Promise,Error};root.window=root;vm.runInNewContext(fs.readFileSync('app/src/main/assets/ai-transport.js','utf8'),root);return root.MintAiTransport;}
test('native promise accepts only matching request ID and cleans stale result after cancel',async()=>{let id,cancel;const t=transport({editImage:(body,r)=>{assert.deepEqual(JSON.parse(body),{key:'mock-only'});id=r;},cancelAiEdit:r=>cancel=r}),ctrl=new AbortController(),p=t.send({key:'mock-only'},ctrl.signal);t.receive('stale','bad',null);ctrl.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(cancel,id);t.receive(id,'old',null);const next=t.send({key:'mock-only'},new AbortController().signal);t.receive(id,'data:image/png;base64,result',null);assert.deepEqual(JSON.parse(JSON.stringify(await next)),{image:'data:image/png;base64,result'});});
test('native errors settle a request and allow explicit retry; overlap refused',async()=>{let id;const t=transport({editImage:(b,r)=>id=r,cancelAiEdit:()=>{}}),c=new AbortController(),p=t.send({},c.signal);await assert.rejects(t.send({},c.signal),/已有/);t.receive(id,null,'HTTP failed');await assert.rejects(p,/HTTP failed/);const q=t.send({},c.signal);t.receive(id,'ok',null);assert.equal((await q).image,'ok');});

// Small deterministic pixel buffers let these tests inject failures at each ownership
// boundary. Native-canvas tests cover rasterization; this suite covers cleanup.
function pixelCanvas(width, height, failMethod) {
  const c = { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
  const check = name => { if (name === failMethod) throw Error('injected ' + name); };
  const ctx = {
    drawImage(source) { check('drawImage'); c.pixels.set(source.pixels); },
    fillRect() { check('fillRect'); c.pixels.fill(255); },
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
    getImageData() { check('getImageData'); return { data: c.pixels.slice() }; },
    createImageData(w, h) { check('createImageData'); return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(image) { check('putImageData'); c.pixels.set(image.data); }
  };
  c.getContext = () => ctx;
  return c;
}
function allocationProbe({ failAllocation, failCanvas, failMethod } = {}) {
  const made = []; let attempts = 0;
  return {
    made,
    create(w, h) {
      const number = ++attempts;
      if (number === failAllocation) throw Error('injected allocation ' + number);
      const c = pixelCanvas(w, h, number === failCanvas ? failMethod : undefined);
      made.push(c); return c;
    }
  };
}
function assertReleased(canvases) {
  for (const c of canvases) assert.deepEqual([c.width, c.height], [1, 1]);
}

test('empty or over-limit erase selection is rejected before allocating image-sized canvases', () => {
  const source = pixelCanvas(4, 3);
  for (const strokes of [undefined, [], Array(65).fill({ radius: .02, points: [{ x: .5, y: .5 }] })]) {
    const p = allocationProbe();
    assert.throws(() => C.prepare(source, { mode: 'erase', strokes }, p.create), /涂抹/);
    assert.equal(p.made.length, 0);
  }
  assert.deepEqual([source.width, source.height], [4, 3]);
});

test('prepare releases earlier owned canvases when a later allocation fails', () => {
  const source = pixelCanvas(4, 3);
  for (const failAllocation of [1, 2, 3]) {
    const p = allocationProbe({ failAllocation });
    assert.throws(() => C.prepare(source, { mode: 'edit' }, p.create), /injected allocation/);
    assert.equal(p.made.length, failAllocation - 1);
    assertReleased(p.made);
    assert.deepEqual([source.width, source.height], [4, 3]);
  }
});

test('invalid erase strokes release all three working canvases without resizing source', () => {
  const source = pixelCanvas(4, 3);
  const invalid = [
    { radius: NaN, points: [{ x: .5, y: .5 }] },
    { radius: .2, points: [{ x: .5, y: .5 }] },
    { radius: .02, points: [] },
    { radius: .02, points: [{ x: -1, y: .5 }] },
    { radius: .02, points: [{ x: .5, y: Infinity }] },
    { radius: .02, points: Array(2049).fill({ x: .5, y: .5 }) }
  ];
  for (const stroke of invalid) {
    const p = allocationProbe();
    assert.throws(() => C.prepare(source, { mode: 'erase', strokes: [stroke] }, p.create));
    assert.equal(p.made.length, 3);
    assertReleased(p.made);
    assert.deepEqual([source.width, source.height], [4, 3]);
  }
});

test('prepare releases owned canvases on drawing, pixel read, allocation and write errors', () => {
  const source = pixelCanvas(4, 3);
  for (const [failCanvas, failMethod] of [[1, 'drawImage'], [3, 'getImageData'], [2, 'createImageData'], [2, 'putImageData']]) {
    const p = allocationProbe({ failCanvas, failMethod });
    assert.throws(() => C.prepare(source, { mode: 'edit' }, p.create), /injected/);
    assert.equal(p.made.length, 3); assertReleased(p.made);
    assert.deepEqual([source.width, source.height], [4, 3]);
  }
});

test('successful prepare retains its buffers until the caller releases them', () => {
  const source = pixelCanvas(4, 3), p = allocationProbe();
  const prepared = C.prepare(source, { mode: 'edit' }, p.create);
  assert.equal(prepared.selectedPixels, 12);
  assert.equal(prepared.image, p.made[0]);
  for (const c of p.made) assert.deepEqual([c.width, c.height], [4, 3]);
  for (let i = 3; i < prepared.mask.pixels.length; i += 4) assert.equal(prepared.mask.pixels[i], 0);
  C.release(prepared); assertReleased(p.made);
  assert.deepEqual([source.width, source.height], [4, 3]);
});

function compositeInputs(failInput) {
  const image = pixelCanvas(2, 1, failInput === 'image' ? 'getImageData' : undefined);
  const selection = pixelCanvas(2, 1, failInput === 'selection' ? 'getImageData' : undefined);
  image.pixels.set([101, 102, 103, 77, 201, 202, 203, 255]);
  selection.pixels.set([255, 255, 255, 0, 255, 255, 255, 255]);
  const generated = pixelCanvas(2, 1);
  generated.pixels.set([10, 20, 30, 255, 40, 50, 60, 255]);
  return { prepared: { mode: 'erase', width: 2, height: 1, image, selection }, generated };
}

test('composite rejects mismatched geometry before allocating a result', () => {
  const { prepared } = compositeInputs(), p = allocationProbe();
  assert.throws(() => C.composite(prepared, pixelCanvas(1, 2), p.create), /比例/);
  assert.equal(p.made.length, 0);
});

test('composite releases only its result when output or input pixel operations fail', () => {
  for (const failure of ['drawImage', 'getImageData', 'putImageData', 'image', 'selection']) {
    const { prepared, generated } = compositeInputs(failure);
    const p = allocationProbe({ failCanvas: 1, failMethod: failure });
    assert.throws(() => C.composite(prepared, generated, p.create), /injected/);
    assert.equal(p.made.length, 1); assertReleased(p.made);
    for (const c of [prepared.image, prepared.selection, generated]) assert.deepEqual([c.width, c.height], [2, 1]);
  }
});

test('composite preserves all four original channels outside the selection exactly', () => {
  const { prepared, generated } = compositeInputs(), p = allocationProbe();
  const result = C.composite(prepared, generated, p.create);
  assert.deepEqual(Array.from(result.pixels), [101, 102, 103, 77, 40, 50, 60, 255]);
  assert.deepEqual([result.width, result.height], [2, 1]);
});
