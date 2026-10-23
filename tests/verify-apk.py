#!/usr/bin/env python3
"""Check packaged assets and native alignment; not device/runtime acceptance."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('apks', nargs='*', type=Path)
args = parser.parse_args()
apks = args.apks or sorted((ROOT / 'app/build/outputs/apk/debug').glob('*.apk'))
if not apks:
    raise SystemExit('No APKs supplied or found.')

asset_root = ROOT / 'app/src/main/assets'
source = {file.relative_to(asset_root).as_posix(): file.read_bytes()
          for file in asset_root.rglob('*') if file.is_file()}
asset_manifest = {name: hashlib.sha256(body).hexdigest() for name, body in sorted(source.items())}
asset_manifest_sha256 = hashlib.sha256(json.dumps(asset_manifest, sort_keys=True,
                                                 separators=(',', ':')).encode()).hexdigest()
results = []
for apk in apks:
    with zipfile.ZipFile(apk) as archive:
        packaged = {name[7:]: archive.read(name) for name in archive.namelist()
                    if name.startswith('assets/') and not name.endswith('/')}
        if packaged.keys() != source.keys():
            raise SystemExit(f'{apk.name}: packaged asset inventory differs from source.')
        changed = [name for name in source if packaged[name] != source[name]]
        if changed:
            raise SystemExit(f'{apk.name}: stale or changed assets: {changed}')
        native = []
        for name in archive.namelist():
            if not name.endswith('.so'):
                continue
            data = archive.read(name)
            if data[:4] != b'\x7fELF' or data[4] not in (1, 2) or data[5] not in (1, 2):
                raise SystemExit(f'{apk.name}: unsupported ELF header in {name}')
            is_64 = data[4] == 2
            endian = '<' if data[5] == 1 else '>'
            offset = struct.unpack_from(endian + ('Q' if is_64 else 'I'), data, 32 if is_64 else 28)[0]
            entry_size, count = struct.unpack_from(endian + 'HH', data, 54 if is_64 else 42)
            alignments = []
            for index in range(count):
                start = offset + index * entry_size
                if struct.unpack_from(endian + 'I', data, start)[0] == 1:
                    alignments.append(struct.unpack_from(endian + ('Q' if is_64 else 'I'),
                                                         data, start + (48 if is_64 else 28))[0])
            if not alignments or any(value < 16384 for value in alignments):
                raise SystemExit(f'{apk.name}: native LOAD segments are not 16 KiB aligned: {name}')
            native.append({'file': name, 'load_alignments': alignments})
        if not native:
            raise SystemExit(f'{apk.name}: missing native inference library.')
        results.append({'apk': apk.name, 'bytes': apk.stat().st_size,
                        'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
                        'source_assets_matched': len(source),
                        'asset_manifest_sha256': asset_manifest_sha256, 'native_libraries': native})
print(json.dumps(results, indent=2))
