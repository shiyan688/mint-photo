#!/usr/bin/env python3
"""Reproducible local CPU inference on labelled public-photo composites, not Android QA.

Requires the already-approved MediaPipe/Pillow/numpy environment. Does not download,
train, upload, package fixtures as APK assets, or synthesize landmark coordinates.
"""
import argparse
import hashlib
import json
import math
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import vision
from PIL import Image, ImageDraw, ImageFont

EXPECTED_MODEL_SHA = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'
SOURCE_IDS = ['01_kim', '02_chawla', '04_yamazaki', '05_mukai', '06_chiao']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--source-pack', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sha = digest(args.model)
    if sha != EXPECTED_MODEL_SHA:
        raise ValueError('Bundled model SHA-256 mismatch')
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((args.source_pack / 'manifest.json').read_text())
    sources = {x['id']: x for x in manifest['images']}
    records = []
    crops = []
    opts = vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.model), delegate=mp.tasks.BaseOptions.Delegate.CPU),
        running_mode=vision.RunningMode.IMAGE, num_faces=5,
        min_face_detection_confidence=0.5, min_face_presence_confidence=0.5,
        output_face_blendshapes=False, output_facial_transformation_matrixes=False,
    )
    def infer(detector, image):
        started = time.perf_counter()
        result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(image)))
        faces = [{'landmarks': [{'x': p.x, 'y': p.y, 'z': p.z} for p in face]} for face in result.face_landmarks]
        assert len(faces) <= 5
        for face in faces:
            assert len(face['landmarks']) == 478
            assert all(math.isfinite(p[k]) for p in face['landmarks'] for k in ('x', 'y', 'z'))
        return {
            'ok': bool(faces), 'faces': faces,
            'detector': {'id': 'mediapipe-face-landmarker', 'modelSha256': sha, 'topology': 'MediaPipe478'},
            'detectionSize': {'width': image.width, 'height': image.height}, 'faceLimit': 5,
        }, round((time.perf_counter() - started) * 1000, 3)
    with vision.FaceLandmarker.create_from_options(opts) as detector:
        # Adult status and names below come from the pre-verified source manifest, not inference.
        for source_id in SOURCE_IDS:
            source = sources[source_id]
            assert source['adult']['verified'] is True
            source_path = args.source_pack / source['file']
            assert digest(source_path) == source['sha256']
            original = Image.open(source_path).convert('RGB')
            preview = original.copy()
            preview.thumbnail((900, 900), Image.Resampling.LANCZOS)
            payload, elapsed = infer(detector, preview)
            assert len(payload['faces']) == 1, f'{source_id}: expected one source face'
            points = payload['faces'][0]['landmarks']
            xs, ys = [p['x'] * original.width for p in points], [p['y'] * original.height for p in points]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            side = max((max(xs) - min(xs)) * 1.40, (max(ys) - min(ys)) * 1.35)
            box = tuple(round(v) for v in (cx - side/2, cy - side/2 - side*.055, cx + side/2, cy + side/2 - side*.055))
            assert box[0] >= 0 and box[1] >= 0 and box[2] <= original.width and box[3] <= original.height
            crop = original.crop(box)
            crops.append(crop)
            records.append({'id': source_id, 'name': source['name'], 'source_sha256': source['sha256'],
                'source_file': str(source_path), 'source_url': source['source_url'], 'credit': source['credit'],
                'adult_verified_from_manifest': True, 'adult_evidence': source['adult'],
                'original_size': list(original.size), 'crop_original_pixels': list(box),
                'individual_detection_size': list(preview.size), 'individual_detection_ms': elapsed,
                'individual_detected_faces': len(payload['faces']), 'individual_landmark_count': 478})
        font = ImageFont.load_default()
        results = []
        for count, size in [(2, (900, 500)), (5, (900, 680))]:
            image = Image.new('RGB', size, '#25323c')
            draw = ImageDraw.Draw(image)
            draw.text((12, 10), f'SYNTHETIC {count}-PORTRAIT QA COMPOSITE | Public NASA photos | Not a real group photograph', font=font, fill='white')
            draw.text((12, 26), 'Local informational QA only. Not advertising, endorsement, model training, or APK assets.', font=font, fill='#cbd7dd')
            if count == 2:
                placements = [(20, 58, 420), (460, 58, 420)]
            else:
                placements = [(15, 64, 280), (310, 64, 280), (605, 64, 280), (160, 384, 280), (460, 384, 280)]
            used = []
            for index, (x, y, edge) in enumerate(placements):
                image.paste(crops[index].resize((edge, edge), Image.Resampling.LANCZOS), (x, y))
                draw.text((x + 3, y - 13), f'[{index+1}] {records[index]["name"]} / NASA', font=font, fill='white')
                used.append({'source_id': SOURCE_IDS[index], 'paste_xy': [x,y], 'size': [edge,edge]})
            path = args.output / f'synthetic-{count}-adults-900.png'
            image.save(path)
            payload, elapsed = infer(detector, image)
            payload_path = path.with_suffix('.landmarks.json')
            payload_path.write_text(json.dumps(payload, indent=2) + '\n')
            detail = {'image_file': path.name, 'landmarks_file': payload_path.name, 'synthetic_composite': True,
                'not_real_group_photo': True, 'placements': used, 'image_sha256': digest(path),
                'landmarks_sha256': digest(payload_path), 'expected_faces': count,
                'detected_faces': len(payload['faces']), 'landmark_counts': [len(f['landmarks']) for f in payload['faces']],
                'detection_size': payload['detectionSize'], 'duration_ms': elapsed,
                'pass': len(payload['faces']) == count}
            results.append(detail)
            print(json.dumps(detail), flush=True)
        summary = {'schema': 'mobile-multiface-host-qa-v1', 'created_at_utc': datetime.now(timezone.utc).isoformat(),
            'scope': 'Local informational public-photo QA only. Synthetic composites, not actual group photos; no training/marketing/APK assets.',
            'limitations': ['Host Python CPU inference is not Android runtime, WebView, device performance, or ARM acceptance.',
                'Five successful spaced faces do not prove general group-photo detection or correct face selection.',
                'No model-release/marketing permission or endorsement is asserted.'],
            'source_manifest_sha256': digest(args.source_pack / 'manifest.json'),
            'model': {'file': str(args.model), 'sha256': sha, 'runtime': 'MediaPipe Tasks Python',
                'version': mp.__version__, 'delegate': 'CPU', 'num_faces': 5, 'running_mode': 'IMAGE',
                'min_face_detection_confidence': 0.5, 'min_face_presence_confidence': 0.5},
            'host': {'python': platform.python_version(), 'platform': platform.platform(), 'machine': platform.machine()},
            'sources': records, 'results': results,
            'pass': all(r['pass'] for r in results)}
        (args.output / 'host-inference-evidence.json').write_text(json.dumps(summary, indent=2) + '\n')
        if not summary['pass']:
            raise AssertionError('A composite did not yield its expected face count; real outputs retained')


if __name__ == '__main__':
    main()
