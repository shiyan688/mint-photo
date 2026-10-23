'use strict';
/* Mobile controls use the same tested curve/HSL pixel core as desktop exports. */
(() => {
  let A = null, state = null;
  const $ = id => document.getElementById(id);
  const names = ['红', '橙', '黄', '绿', '青', '蓝', '紫', '洋红'];
  const colors = ['#cf6054', '#d58c48', '#b3a543', '#598a61', '#419c9a', '#5688b0', '#8d6bb2', '#bc6f9a'];
  const channels = { rgb: '整体', red: '红通道', green: '绿通道', blue: '蓝通道' };
  const slider = (id, label, value, min, max, step = 1) => `<div class="slider-row"><label for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><output id="${id}-value">${value}</output></div>`;
  const core = () => window.MintAdvancedTone;
  const pixels = c => { const im = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height); return { width: im.width, height: im.height, data: im.data }; };
  function release() { state = null; A = null; }
  function changed(d) { return !!d && d.type === 'advanced-tone' && core().isActive(d.recipe); }
  function histogram(im) {
    if (!state || !A || A.getDraft() !== state.draft || !$('toneHistogram')) return;
    const h = core().histogram(im, { maxSamples: 65536 });
    const c = $('toneHistogram'), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    let peak = 1;
    for (const key of ['red', 'green', 'blue']) for (const v of h.bins[key]) peak = Math.max(peak, v);
    for (const [key, color] of [['red', '#c87564'], ['green', '#558b64'], ['blue', '#6095b8']]) {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < 256; i++) { const y = c.height - 2 - h.bins[key][i] / peak * (c.height - 4); if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y); }
      ctx.stroke();
    }
    const e = h.endpoints.luma;
    $('toneHistogramInfo').textContent = `${h.approximate ? '预览分层抽样' : '全部预览像素'} ${h.sampledPixels.toLocaleString()} 点 · 黑位 ${(e.blackFraction * 100).toFixed(1)}% / 白位 ${(e.whiteFraction * 100).toFixed(1)}%`;
  }
  function responseCurve() {
    if (!state) return;
    const c = $('toneCurve'), ctx = c.getContext('2d'), d = state.draft, key = state.channel;
    const r = core().defaults(); r.curveMode = d.recipe.curveMode; r.curves[key] = d.recipe.curves[key].slice();
    const data = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) data.set([i, i, i, 255], i * 4);
    const im = core().apply({ width: 256, height: 1, data }, r), k = key === 'green' ? 1 : key === 'blue' ? 2 : 0;
    ctx.clearRect(0, 0, c.width, c.height); ctx.strokeStyle = '#d4ded0'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i <= 4; i++) { const x = i * 255 / 4, y = i * (c.height - 1) / 4; ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.moveTo(0, y); ctx.lineTo(c.width, y); } ctx.stroke();
    ctx.strokeStyle = ({ rgb: '#315942', red: '#c87564', green: '#558b64', blue: '#6095b8' })[key]; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < 256; i++) { const y = (1 - im.data[i * 4 + k] / 255) * (c.height - 1); if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y); } ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    d.recipe.curves[key].forEach((v, i) => { ctx.beginPath(); ctx.arc(i * 255 / 4, (1 - v) * (c.height - 1), 3, 0, Math.PI * 2); ctx.fill(); });
  }
  function sync() {
    const d = state.draft, r = d.recipe;
    $('toneEnabled').checked = r.enabled; $('toneFree').checked = r.curveMode === 'free';
    $('toneStrength').value = Math.round(r.strength * 100); $('toneStrength-value').textContent = Math.round(r.strength * 100) + '%';
    for (const key of Object.keys(channels)) $('toneChannel-' + key).classList.toggle('active', key === state.channel);
    r.curves[state.channel].forEach((v, i, values) => {
      const el = $('toneNode-' + i); el.value = Math.round(v * 100);
      el.min = r.curveMode === 'monotone' && i > 0 ? values[i - 1] * 100 : 0;
      el.max = r.curveMode === 'monotone' && i < 4 ? values[i + 1] * 100 : 100;
      $('toneNode-' + i + '-value').textContent = Math.round(v * 100) + '%';
    });
    for (let i = 0; i < 8; i++) $('toneBand-' + i).classList.toggle('active', i === state.band);
    for (const key of ['hue', 'saturation', 'luminance']) { $('toneHsl-' + key).value = r.hsl[state.band][key]; $('toneHsl-' + key + '-value').textContent = r.hsl[state.band][key] + (key === 'hue' ? '°' : ''); }
    responseCurve();
    if (!changed(d)) histogram(pixels(A.getCanvas()));
    A.render();
  }
  function edit(fn) {
    if (!state || !A || A.getDraft() !== state.draft) return;
    try { const next = core().validate(state.draft.recipe); fn(next); state.draft.recipe = core().validate(next); }
    catch (error) { A.toast(error.message.includes('Monotone') ? '请先让各通道控制点由暗到亮递增，或先归零' : '数值无效，未改变当前调色'); }
    sync();
  }
  function setup(adapter, initialRecipe = null) {
    release(); A = adapter;
    if (!core()) { A.setDraft(null); $('toolPanel').textContent = '调色核心未加载，未应用任何效果。'; A.toast('调色核心未加载'); return; }
    const d = { type: 'advanced-tone', recipe: initialRecipe === null ? core().defaults() : core().validate(initialRecipe) }; A.setDraft(d); state = { draft: d, channel: 'rgb', band: 0 };
    $('toolPanel').innerHTML = `<div class="portrait-heading"><strong>曲线与分色 · 从原色开始</strong><span>本地可撤销</span></div><p class="portrait-copy">先轻调明暗，再按色相微调。8位 sRGB 常规调色，不是 RAW 高光恢复或自动美颜。</p><div class="tone-histogram"><canvas id="toneHistogram" width="256" height="64" aria-label="当前预览 RGB 直方图"></canvas><div id="toneHistogramInfo" class="portrait-copy"></div></div><div class="tone-switches"><label><input type="checkbox" id="toneEnabled" checked>启用本轮</label><button class="small-button" id="toneReset">全部归零</button></div>${slider('toneStrength', '总强度', 100, 0, 100)}<div class="portrait-section-label">五点曲线 · 由暗到亮</div><div class="segmented tone-channels">${Object.entries(channels).map(([k,n])=>`<button id="toneChannel-${k}">${n}</button>`).join('')}</div><canvas id="toneCurve" class="tone-curve" width="256" height="96" aria-label="所选曲线自身响应，不含其他通道和HSL"></canvas><div class="sliders portrait-sliders">${['黑场','阴影','中间调','高光','白场'].map((n,i)=>slider('toneNode-'+i,n,i*25,0,100)).join('')}</div><label class="manual-mask-toggle"><input type="checkbox" id="toneFree">自由曲线（可反转明暗）</label><div class="portrait-actions"><button class="small-button" id="toneResetChannel">归零当前通道</button></div><div class="portrait-section-label">HSL 分色 · 相邻色带平滑过渡</div><div class="tone-bands">${names.map((n,i)=>`<button id="toneBand-${i}" class="small-button" style="--band-color:${colors[i]}">${n}</button>`).join('')}</div><div class="sliders portrait-sliders">${slider('toneHsl-hue','色相',0,-30,30)}${slider('toneHsl-saturation','饱和',0,-100,100)}${slider('toneHsl-luminance','明度',0,-100,100)}</div><div class="portrait-actions"><button class="small-button" id="toneResetBand">归零当前色带</button></div><p class="portrait-copy subtle">直方图来自当前预览，透明度加权、非原尺寸全量统计；黑白端点不能证明原图丢失了多少高光。不会按肤色或族裔自动选色。应用后进入有序历史，改动可撤销。</p>`;
    $('toneEnabled').onchange = e => edit(r => { r.enabled = e.target.checked; });
    $('toneStrength').oninput = e => edit(r => { r.strength = +e.target.value / 100; });
    $('toneFree').onchange = e => edit(r => { r.curveMode = e.target.checked ? 'free' : 'monotone'; });
    for (const key of Object.keys(channels)) $('toneChannel-' + key).onclick = () => { state.channel = key; sync(); };
    for (let i = 0; i < 5; i++) $('toneNode-' + i).oninput = e => edit(r => { const values = r.curves[state.channel], low = r.curveMode === 'monotone' && i > 0 ? values[i-1] : 0, high = r.curveMode === 'monotone' && i < 4 ? values[i+1] : 1; values[i] = Math.max(low, Math.min(high, +e.target.value / 100)); });
    for (let i = 0; i < 8; i++) $('toneBand-' + i).onclick = () => { state.band = i; sync(); };
    for (const key of ['hue', 'saturation', 'luminance']) $('toneHsl-' + key).oninput = e => edit(r => { r.hsl[state.band][key] = +e.target.value; });
    $('toneResetChannel').onclick = () => edit(r => { r.curves[state.channel] = [0,.25,.5,.75,1]; });
    $('toneResetBand').onclick = () => edit(r => { r.hsl[state.band] = { hue: 0, saturation: 0, luminance: 0 }; });
    $('toneReset').onclick = () => { d.recipe = core().defaults(); sync(); };
    $('editLabel').textContent = '调色预览 · 应用后保存'; A.hint('曲线改变亮度映射；HSL只微调选择的色带'); sync();
  }
  function apply(canvas, d) {
    // Reuse the readback ImageData instead of a third full-resolution RGBA allocation.
    const ctx = canvas.getContext('2d', { willReadFrequently: true }), im = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = core().apply({ width: im.width, height: im.height, data: im.data }, d.recipe);
    im.data.set(out.data); ctx.putImageData(im, 0, 0);
    if (state && state.draft === d) histogram(out);
    return canvas;
  }
  window.AdvancedToneUI = { setup, release, changed, apply, updateHistogram: histogram };
})();
