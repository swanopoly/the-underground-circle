#!/usr/bin/env python3
"""Independent binary-STL reader — a from-scratch parser (no STL library) that
reports triangle count and the geometric bounding box, so a solid our generator
produced can be dimensionally verified against what it INTENDED. Different code
path from the TS generator; agreement is real proof the STL is well-formed.

Binary STL layout: 80-byte header, uint32 little-endian triangle count, then
per triangle 12 float32 (normal + 3 vertices) + 2 pad bytes = 50 bytes."""
import sys, struct, json

def verify(path):
    with open(path, 'rb') as f:
        data = f.read()
    if len(data) < 84:
        return {'ok': False, 'error': 'file too short for a binary STL header'}
    if data[:6].lower() == b'solid ' and b'facet' in data[:512]:
        return {'ok': False, 'error': 'ASCII STL, not the binary Blender writes'}
    count = struct.unpack_from('<I', data, 80)[0]
    expected = 84 + count * 50
    minx = miny = minz = float('inf')
    maxx = maxy = maxz = float('-inf')
    read = 0
    off = 84
    for _ in range(count):
        if off + 50 > len(data):
            break
        # 12 floats: normal(3) + v1(3) + v2(3) + v3(3); we want the 9 vertex coords.
        vals = struct.unpack_from('<12f', data, off)
        for i in (3, 6, 9):  # start of each vertex triple
            x, y, z = vals[i], vals[i + 1], vals[i + 2]
            minx, maxx = min(minx, x), max(maxx, x)
            miny, maxy = min(miny, y), max(maxy, y)
            minz, maxz = min(minz, z), max(maxz, z)
        read += 1
        off += 50
    return {
        'ok': read > 0,
        'triangles': read,
        'declaredTriangles': count,
        'byteLengthMatches': len(data) == expected,
        'bbox': None if read == 0 else {
            'minX': round(minx, 4), 'minY': round(miny, 4), 'minZ': round(minz, 4),
            'maxX': round(maxx, 4), 'maxY': round(maxy, 4), 'maxZ': round(maxz, 4),
        },
        'dimensions': None if read == 0 else {
            'w': round(maxx - minx, 3), 'd': round(maxy - miny, 3), 'h': round(maxz - minz, 3),
        },
    }

if __name__ == '__main__':
    print(json.dumps(verify(sys.argv[1]), indent=2))
