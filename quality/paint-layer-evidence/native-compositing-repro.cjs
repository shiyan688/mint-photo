'use strict';
// Independent, intentionally failing conformance probe for @napi-rs/canvas
// 0.1.100. This does NOT load MintPaintLayer or change its implementation.
const { createCanvas } = require('@napi-rs/canvas');
const version = require('@napi-rs/canvas/package.json').version;
const results = [];
for (const opacity of [.25, .5, .75, 1]) {
  const c = createCanvas(20, 20), ctx = c.getContext('2d');
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 20, 20);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = opacity;
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 20, 20);
  const actual = [...ctx.getImageData(10, 10, 1, 1).data];
  const expectedAlpha = Math.round(255 * (1 - opacity));
  results.push({ opacity, expectedAlpha, actual, conforms: Math.abs(actual[3] - expectedAlpha) <= 1 });
}
console.log(JSON.stringify({ backend: '@napi-rs/canvas', version, results }, null, 2));
if (results.some(row => !row.conforms)) process.exitCode = 1;
