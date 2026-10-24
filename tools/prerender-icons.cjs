'use strict';

// Keep first-paint SVGs in HTML, generated from the shared runtime icon map.
// Run after changing data-icon markup or MintStudio.icon. --check never writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'app/src/main/assets');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(assets, 'studio-shell.js'), 'utf8'), context);
const icon = context.window.MintStudio.icon;
const file = path.join(assets, 'index.html');
const original = fs.readFileSync(file, 'utf8');
let count = 0;
const rendered = original.replace(/<span\b([^>]*\bdata-icon="([^"]+)"[^>]*)>[\s\S]*?<\/span>/g,
  (_, attributes, name) => { count++; return '<span' + attributes + '>' + icon(name) + '</span>'; });
if (count < 15) throw Error('Expected the static action and home icon containers.');
if (process.argv.includes('--check')) {
  if (rendered !== original) throw Error('Inline SVGs are stale; run node tools/prerender-icons.cjs.');
} else {
  fs.writeFileSync(file, rendered, 'utf8');
}
process.stdout.write(`Static SVG icons: ${count}, ${process.argv.includes('--check') ? 'checked' : 'rendered'}\n`);
