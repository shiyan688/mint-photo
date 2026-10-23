'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const M = require('../../../app/src/main/assets/manual-tools.js');
const V29 = require('../../fixtures/manual-tools-legacy-v29.cjs');
const revision = 'audit-legacy', context = { sourceRevision: revision };
const c = extra => ({ kind: 'push', sourceRevision: revision, radius: .2, strength: .6,
  points: [{ x: .44, y: .5 }, { x: .54, y: .5 }], selection: null, ...extra });
const selected = extra => ({ version: 1, sourceRevision: revision, base: 'none', inverted: false, feather: 0,
  commands: [{ kind: 'brush', mode: 'add', radius: .3, points: [{ x: .5, y: .5 }] }], ...extra });

test('legacy oracle is the exact frozen v29 file, not a rewritten expected implementation', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../../fixtures/manual-tools-legacy-v29.cjs'))).digest('hex'),
    'd28e4cef2a7f589a667e89b691bad72d31f0907d40ed47fe897f564d3dd12762');
});

test('all old push/restore recipes preserve v29 bytes and diagnostics across sizes and alpha', () => {
  const dense = Array.from({ length: 81 }, (_, i) => ({ x: .3 + .4 * i / 80, y: .5 }));
  const recipes = [[], [c({ strength: 0 })], [c({ points: [{ x: .5, y: .5 }] })], [c()],
    [c({ points: dense })], [c({ selection: selected({ commands: [] }) })],
    [c({ selection: selected({ feather: .03 }) })], [c({ selection: selected({ inverted: true }) })],
    [c({ kind: 'restore' })], [c(), c({ kind: 'restore', radius: .5, strength: 1, points: [{ x: .5, y: .5 }] })],
    Array.from({ length: 20 }, (_, i) => c({ kind: i % 6 === 5 ? 'restore' : 'push', strength: 1,
      points: i % 2 ? [{ x: .6, y: .35 }, { x: .35, y: .65 }] : [{ x: .35, y: .35 }, { x: .65, y: .65 }],
      selection: i % 3 ? null : selected({ feather: .02 }) }))];
  for (const [w, h] of [[1, 1], [1, 65], [65, 1], [65, 49], [129, 97]]) for (const transparent of [false, true]) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, circle = Math.hypot(x - (w - 1) / 2, y - (h - 1) / 2) < Math.min(w, h) / 4;
      data.set([Math.round(x * 255 / Math.max(1, w - 1)), Math.round(y * 255 / Math.max(1, h - 1)), circle ? 240 : (((x >> 2) ^ (y >> 2)) & 1 ? 180 : 20), transparent ? (i % 7 ? i % 254 + 1 : 0) : 255], i * 4);
    }
    const image = { width: w, height: h, data }, before = data.slice();
    for (const commands of recipes) assert.deepEqual(M.liquify(image, commands, context), V29.liquify(image, commands, context), `${w}x${h}, transparent=${transparent}, ${JSON.stringify(commands).slice(0,100)}`);
    assert.deepEqual(data, before);
  }
});
