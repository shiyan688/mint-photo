"""Check real home PNG glyph contrast using the on-device SVG geometry probe.

This detects blank painting, not icon shape accuracy or photo quality.
Use --screenshot with the pre-fix PNG as a negative control.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('evidence', type=Path)
parser.add_argument('--screenshot', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
probe_file = args.evidence / 'ai-e2e-home-icons.json'
probe = json.loads(probe_file.read_text(encoding='utf-8'))
png = args.screenshot or args.evidence / 'ai-e2e-home-actions.png'
pixels = np.asarray(Image.open(png).convert('RGB'), dtype=np.int32)
view = probe['webView']
scale = view['widthPerCssPixel']
results = []
for entry in probe['entries']:
    rect = entry['svg']['rect']
    left = math.floor(view['screenX'] + (rect['x'] + rect['width'] * .125) * scale)
    top = math.floor(view['screenY'] + (rect['y'] + rect['height'] * .125) * scale)
    right = math.ceil(view['screenX'] + (rect['x'] + rect['width'] * .875) * scale)
    bottom = math.ceil(view['screenY'] + (rect['y'] + rect['height'] * .875) * scale)
    inside = 0 <= left < right <= pixels.shape[1] and 0 <= top < bottom <= pixels.shape[0]
    count = int((pixels[top:bottom, left:right].sum(axis=2) < 390).sum()) if inside else 0
    results.append({'selector': entry['selector'], 'region': [left, top, right, bottom],
                    'insideScreenshot': inside, 'darkPixels': count, 'passed': inside and count >= 8})
passed = len(results) == 5 and all(item['passed'] for item in results)
report = {'result': 'PASS' if passed else 'FAIL', 'screenshot': str(png),
          'screenshotSha256': hashlib.sha256(png.read_bytes()).hexdigest(),
          'probeSha256': hashlib.sha256(probe_file.read_bytes()).hexdigest(),
          'method': 'SVG center 75%, RGB sum below 390, minimum 8 dark pixels; current light/lime home surfaces',
          'scope': 'Paint presence and contrast only; not shape fidelity or all icons', 'entries': results}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(report['result'] + ': ' + ', '.join(f"{r['selector']}={r['darkPixels']}" for r in results))
raise SystemExit(0 if passed else 1)
