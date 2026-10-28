#!/usr/bin/env python3
"""Reject shell error messages and truncated PNGs when collecting test evidence."""
import json
import struct
import sys
import zlib
from pathlib import Path


def png(data):
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('missing PNG signature')
    pos, index, has_data = 8, 0, False
    while pos + 12 <= len(data):
        length = struct.unpack_from('>I', data, pos)[0]
        kind = data[pos + 4:pos + 8]
        end = pos + 12 + length
        if end > len(data):
            raise ValueError('truncated PNG chunk')
        payload = data[pos + 8:pos + 8 + length]
        checksum = struct.unpack_from('>I', data, pos + 8 + length)[0]
        if (zlib.crc32(kind + payload) & 0xffffffff) != checksum:
            raise ValueError('invalid PNG chunk CRC')
        if index == 0:
            if kind != b'IHDR' or length != 13:
                raise ValueError('missing PNG IHDR')
            w, h = struct.unpack_from('>II', payload)
            if not (0 < w <= 4096 and 0 < h <= 4096 and w * h <= 8000000):
                raise ValueError('invalid PNG dimensions')
        if kind == b'IDAT':
            has_data = True
        if kind == b'IEND':
            if length or not has_data or end != len(data):
                raise ValueError('invalid PNG ending')
            return
        pos, index = end, index + 1
    raise ValueError('missing PNG IEND')


def main():
    if len(sys.argv) != 3 or sys.argv[2] not in ('png', 'json'):
        raise ValueError('usage: validate-interactive-evidence.py FILE png|json')
    data = Path(sys.argv[1]).read_bytes()
    if sys.argv[2] == 'png':
        png(data)
    else:
        value = json.loads(data)
        if not isinstance(value, dict) or value.get('result') not in ('PASS', 'FAIL'):
            raise ValueError('invalid result JSON')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'evidence validation failed: {error}', file=sys.stderr)
        sys.exit(1)
