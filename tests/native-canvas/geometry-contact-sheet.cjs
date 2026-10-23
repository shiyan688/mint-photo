'use strict';
// Synthetic coordinate fixture, not an application screenshot or a photograph.
// Images are actual MintGeometry.apply outputs. Canvas draws the input/labels
// and encodes the PNGs; no geometry is recreated using Canvas transforms.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCanvas } = require('@napi-rs/canvas');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const outdir = path.resolve(process.argv[3] || path.join(__dirname, 'results'));
const corePath = path.join(root, 'app/src/main/assets/geometry.js');
const G = require(corePath);
fs.mkdirSync(outdir, { recursive: true });
const cell = 48, columns = 6, rows = 4;
const input = createCanvas(columns * cell, rows * cell), ctx = input.getContext('2d');
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
  ctx.fillStyle = `hsl(${(y * 73 + x * 17) % 360},72%,${62 - x * 3}%)`;
  ctx.fillRect(x * cell, y * cell, cell, cell);
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.strokeRect(x * cell + .5, y * cell + .5, cell - 1, cell - 1);
  ctx.fillStyle = '#17212e';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(`${x},${y}`, x * cell + 24, y * cell + 29);
  // Each cell has an upper-left triangular fiducial to expose flip/turn direction.
  ctx.beginPath();
  ctx.moveTo(x * cell + 5, y * cell + 5);
  ctx.lineTo(x * cell + 15, y * cell + 5);
  ctx.lineTo(x * cell + 5, y * cell + 15);
  ctx.closePath(); ctx.fill();
}
const data = ctx.getImageData(0, 0, input.width, input.height).data;
const source = { width: input.width, height: input.height, data };
const cropRecipe = { ...G.defaults(), crop: { x: 1 / 6, y: 1 / 4, w: 4 / 6, h: 2 / 4 } };
const cropped = G.apply(source, cropRecipe);
const frames = [
  { name: 'original', title: 'ORIGINAL', caption: 'Source cells: x=0..5, y=0..3', image: source, recipe: null },
  { name: 'crop', title: 'CROP', caption: 'Keep x=1..4, y=1..2', image: cropped, recipe: cropRecipe },
  { name: 'rotate-cw', title: 'CROP + ROTATE CW', caption: '90 degrees clockwise', image: G.apply(cropped, { ...G.defaults(), quarterTurns: 1 }), recipe: { ...G.defaults(), quarterTurns: 1 } },
  { name: 'flip-x', title: 'CROP + FLIP X', caption: 'Horizontal mirror of crop', image: G.apply(cropped, { ...G.defaults(), flipX: true }), recipe: { ...G.defaults(), flipX: true } },
  { name: 'flip-y', title: 'CROP + FLIP Y', caption: 'Vertical mirror of crop', image: G.apply(cropped, { ...G.defaults(), flipY: true }), recipe: { ...G.defaults(), flipY: true } }
];
function asCanvas(im) {
  const c = createCanvas(im.width, im.height), x = c.getContext('2d');
  const pixels = x.createImageData(im.width, im.height); pixels.data.set(im.data);
  x.putImageData(pixels, 0, 0); // Identity CTM; no compatibility shim is needed here.
  return c;
}
const margin = 24, pitch = 308, sheet = createCanvas(margin * 2 + pitch * frames.length, 386);
const s = sheet.getContext('2d');
s.fillStyle = '#f6f8fc'; s.fillRect(0, 0, sheet.width, sheet.height);
s.fillStyle = '#192838'; s.font = 'bold 23px sans-serif';
s.fillText('Synthetic coordinate grid: actual geometry output', margin, 35);
s.font = '14px sans-serif'; s.fillStyle = '#4d6073';
s.fillText('Not an app screenshot. Labels are source (x,y) cells. Every panel is shown at 1:1 pixels.', margin, 60);
frames.forEach((frame, i) => {
  const c = asCanvas(frame.image), left = margin + i * pitch;
  fs.writeFileSync(path.join(outdir, `geometry-${frame.name}.png`), c.toBuffer('image/png'));
  s.fillStyle = '#192838'; s.font = 'bold 16px sans-serif'; s.fillText(frame.title, left, 95);
  s.font = '13px sans-serif'; s.fillStyle = '#4d6073'; s.fillText(frame.caption, left, 116);
  s.drawImage(c, left, 134);
  s.font = '13px sans-serif'; s.fillText(`${c.width} x ${c.height} px`, left, 347);
});
s.fillStyle = '#4d6073'; s.font = '13px sans-serif';
s.fillText('Rotate / Flip X / Flip Y each start from the same cropped result, not from the previous column.', margin, 374);
fs.writeFileSync(path.join(outdir, 'geometry-contact-sheet.png'), sheet.toBuffer('image/png'));
const manifest = {
  description: 'Synthetic fixture, not app / Android / browser screenshot. Actual shared core output.',
  geometrySha256: crypto.createHash('sha256').update(fs.readFileSync(corePath)).digest('hex'),
  frames: frames.map(({ name, image, recipe }) => ({ name, width: image.width, height: image.height, recipe, rgbaSha256: crypto.createHash('sha256').update(image.data).digest('hex') }))
};
fs.writeFileSync(path.join(outdir, 'geometry-contact-sheet.json'), JSON.stringify(manifest, null, 2));
console.log(path.join(outdir, 'geometry-contact-sheet.png'));
