#!/usr/bin/env node
'use strict';

// Portable entry point for the supplied pure suite. No browser or Android device
// is impersonated here; those need separate acceptance runs.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);

const inlineIcons = spawnSync(process.execPath, ['tools/prerender-icons.cjs', '--check'], { stdio: 'inherit' });
if (inlineIcons.status !== 0) process.exit(inlineIcons.status || 1);

const java = spawnSync('javac', ['-version'], { encoding: 'utf8' });
if (java.error || java.status !== 0) {
  console.error('CI requires a full JDK 17+ on PATH: the backup parity tests compile and execute Java.');
  process.exit(1);
}

const archived = 'tests/beauty-protection-independent.test.cjs';
const archivedInputs = ['2.rgba.gz', '5.rgba.gz'].map(name =>
  path.join('quality/portrait-people-independent', name));
const includeArchived = process.argv.includes('--include-archived-fixtures');
if (includeArchived && archivedInputs.some(file => !fs.existsSync(file))) {
  console.error('The archived beauty audit requires the original 2.rgba.gz and 5.rgba.gz fixtures. No synthetic replacement is used.');
  process.exit(1);
}

const shell = fs.readFileSync('tests/run-pure.sh', 'utf8');
let files = [...shell.matchAll(/tests\/[^\s]+\.cjs/g)].map(match => match[0]);
files = files.flatMap(file => {
  if (!file.includes('*')) return [file];
  const dir = path.dirname(file);
  const pattern = new RegExp('^' + path.basename(file).split('*').map(part =>
    part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return fs.readdirSync(dir).filter(name => pattern.test(name)).sort()
    .map(name => path.join(dir, name));
});
// The shell comment names a real-browser suite; only parse its test command.
files = files.filter(file => file !== 'tests/editor.test.cjs');
if (!includeArchived) {
  files = files.filter(file => file !== archived);
  console.log('NOT RUN: archived beauty-protection-independent audit (original photo RGBA fixtures are not distributed).');
  console.log('Its synthetic core, operation, UI, and selection suites remain in this run. See docs/CI.md.');
}
if (!files.length || files.some(file => !fs.existsSync(file))) {
  throw new Error('The pure test inventory is empty or references a missing test file.');
}
console.log(`Running ${files.length} pure test files with JDK parity checks; this is not Android/WebView acceptance.`);
const result = spawnSync(process.execPath,
  ['--test', '--test-concurrency=4', '--test-reporter=tap', ...files],
  { stdio: 'inherit', env: { ...process.env, PAINT_CORE_TEST_MODE: 'pure' } });
if (result.error) throw result.error;
process.exit(result.status === null ? 1 : result.status);
