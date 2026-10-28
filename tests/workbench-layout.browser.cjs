'use strict';

// Real Chromium layout/interaction checks. Intentionally excluded from run-ci's
// pure suite. Requires Playwright and a Chromium executable (or its installed
// browser); CHROMIUM_EXECUTABLE can select a system browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const assets = path.resolve(__dirname, '../app/src/main/assets');
const evidence = path.resolve(__dirname, '../.work/workbench-layout');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
const checks = [], errors = [];

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function setSlider(locator, value) {
  const delta = value - Number(await locator.inputValue());
  await locator.focus();
  for (let i = 0; i < Math.abs(delta); i++) await locator.press(delta > 0 ? 'ArrowRight' : 'ArrowLeft');
  assert.equal(Number(await locator.inputValue()), value);
}
async function targets(page, selectors) {
  const results = await page.locator(selectors).evaluateAll(nodes => nodes.map(e => {
    const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { id: e.id || e.dataset.category || e.tagName, width: r.width, height: r.height,
      visible: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      uncovered: !!hit && (hit === e || e.contains(hit)) };
  }));
  assert(results.length, `No targets: ${selectors}`);
  for (const r of results) assert(r.width >= 39.5 && r.height >= 39.5 && r.visible && r.uncovered, `40 CSS px target: ${JSON.stringify(r)}`);
}
async function layout(page, name) {
  await settle(page);
  const report = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.left, y: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
      stage: rect('#stage'), photo: rect('#previewCanvas'), panel: rect('#toolPanel'), category: rect('.category-tabs') };
  });
  fs.writeFileSync(path.join(evidence, `${name}.json`), JSON.stringify(report, null, 2));
  assert(report.scrollWidth <= report.viewport.width + 1, 'No horizontal page overflow');
  for (const key of ['stage', 'panel', 'category']) {
    const r = report[key];
    assert(r.width > 0 && r.height >= 39.5 && r.x >= -1 && r.y >= -1 && r.right <= report.viewport.width + 1 && r.bottom <= report.viewport.height + 1, `${key} remains visible: ${JSON.stringify(report)}`);
  }
  const { photo: p, stage: s } = report;
  assert(p.width >= 96 && p.height >= 96, 'Photo remains large enough to inspect');
  assert(p.x >= s.x - 1 && p.y >= s.y - 1 && p.right <= s.right + 1 && p.bottom <= s.bottom + 1, 'Fitted photo is fully inside its stage');
  if (report.viewport.width <= 760) assert(report.category.y >= report.panel.bottom - 1, 'Mobile categories are below the parameter panel');
  checks.push(name);
}

(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const server = http.createServer((req, res) => {
    try {
      const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(assets, relative);
      if (!file.startsWith(assets + path.sep)) { res.writeHead(403); res.end(); return; }
      const data = fs.readFileSync(file); res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
    for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 915, height: 412 }, { width: 1360, height: 1000 }]) {
      const page = await browser.newPage({ viewport });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
      await page.locator('#portraitDemoBtn').click();
      await page.waitForFunction(() => document.body.classList.contains('is-editing') && document.querySelector('#busy').hidden && document.querySelector('#imageInfo').textContent.includes('512 × 512'));
      const name = `${viewport.width}x${viewport.height}`;
      await layout(page, `${name}-imported`);
      await targets(page, '#homeBack,#headerMenu summary,#exportBtn,#undoBtn,#redoBtn,#compareBtn,#viewToggle,[data-category]');
      assert.equal(await page.locator('#viewToggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('.view-controls').isVisible(), false);
      await page.locator('#viewToggle').click(); await settle(page);
      assert.equal(await page.locator('#viewToggle').getAttribute('aria-expanded'), 'true');
      await targets(page, '#viewFit,#viewPan,#viewZoom');
      await page.locator('#viewToggle').click();
      assert.equal(await page.locator('.view-controls').isVisible(), false);
      await page.locator('[data-tool=adjust]').click();
      await page.locator('[data-adjust-param=brightness]').click();
      assert.equal(await page.locator('#toolPanel input[type=range]:visible').count(), 1);
      await setSlider(page.locator('#brightness'), 17);
      await page.locator('[data-adjust-param=contrast]').click();
      await setSlider(page.locator('#contrast'), -11); await settle(page);
      const pixels = await page.locator('#previewCanvas').evaluate(e => e.toDataURL());
      await page.locator('[data-adjust-param=brightness]').click(); await settle(page);
      assert.equal(await page.locator('#brightness').inputValue(), '17');
      assert.equal(await page.locator('#contrast').inputValue(), '-11');
      assert.equal(await page.locator('#confirmDialog').isVisible(), false);
      assert.equal(await page.locator('#previewCanvas').evaluate(e => e.toDataURL()), pixels);
      await targets(page, '#brightness,#applyBtn,#cancelBtn');
      await layout(page, `${name}-parameter-preview`);
      await page.screenshot({ path: path.join(evidence, `${name}-parameters.png`) });
      await page.locator('#cancelBtn').click();
      await page.locator('#headerMenu summary').click();
      await targets(page, '#openTop,#projectLibraryBtn,#batchBtn,#aiBtn');
      await page.locator('#headerMenu summary').click();
      await page.locator('#homeBack').click();
      assert.equal(await page.locator('#resumeBtn').isVisible(), true);
      await page.locator('#resumeBtn').click();
      await layout(page, `${name}-resumed`);
      await page.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ result: 'PASS', checks, errors, androidDevice: false }, null, 2));
    console.log(`PASS ${checks.length} real Chromium layout checkpoints; not Android acceptance.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
