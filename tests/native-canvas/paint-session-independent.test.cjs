'use strict';
// Independent read-only regression against the parent's current integration.
// This file is not part of the frozen 140-pure/21-native core suite.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const project=path.resolve(__dirname,'../..');
const {integrated,plain}=require(project+'/quality/paint-layer-evidence/editor-harness.cjs');
const {canvas,fixture,decode}=require(project+'/quality/text-overlay-independent/native-canvas.cjs');
async function start(){const photo=fixture(160,120),bytes=photo.toBuffer('image/png');const h=await integrated({nativeFactory:canvas,width:160,height:120,file:{bytes,image:await decode(bytes)}});h.paint();return h;}
function stroke(h){h.event('pointerdown',.2,.5);h.event('pointerup',.8,.5);h.paint();}
test('detached old color control cannot change a new session brush or next stroke',async()=>{
 const h=await start(),stale=h.node('pl-color').oninput;h.click('cancelBtn');h.paint();const original=h.node('pl-color').value;
 stale({target:{value:'#123456'}});assert.equal(h.node('pl-color').value,original);stroke(h);assert.equal(h.state.draft.recipe.strokes[0].color,original);
});
test('detached old Clear/Undo/New controls cannot remove or switch new-session strokes',async()=>{
 const h=await start(),stale=[h.node('pl-clear').onclick,h.node('pl-undo').onclick,h.node('pl-new').onclick];h.click('cancelBtn');stroke(h);
 const before=plain(h.state.draft);for(const fn of stale){fn({});assert.deepEqual(plain(h.state.draft),before);}
});
test('detached old blur/visibility callbacks cannot cancel a current-session provisional gesture',async()=>{
 const h=await start(),oldBlur=[...h.env.__events.blur],oldHidden=[...h.env.document.__events.visibilitychange];
 h.click('cancelBtn');const liveBlur=h.env.__events.blur,liveHidden=h.env.document.__events.visibilitychange;
 const stale=[...oldBlur.filter(fn=>!liveBlur.has(fn)),...oldHidden.filter(fn=>!liveHidden.has(fn))];assert.ok(stale.length>=2);
 h.event('pointerdown',.2,.5);h.env.document.hidden=true;for(const fn of stale)fn();h.env.document.hidden=false;h.event('pointerup',.8,.5);assert.equal(h.state.draft.recipe.strokes.length,1);
});
