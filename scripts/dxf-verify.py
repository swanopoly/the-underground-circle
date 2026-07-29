#!/usr/bin/env python3
"""Independent DXF R12 verifier — a from-scratch reader in a DIFFERENT language
from the TS generator/parser, so agreement is genuine cross-implementation
proof, not a self-check. Reads raw (code,value) line pairs; no DXF library."""
import sys, json

def read_pairs(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        lines = f.read().split('\n')
    pairs = []
    i = 0
    while i + 1 < len(lines):
        code = lines[i].strip()
        if code.lstrip('-').isdigit():
            pairs.append((int(code), lines[i+1]))
            i += 2
        else:
            i += 1
    return pairs

def verify(path):
    pairs = read_pairs(path)
    section = None
    in_layer_table = False
    cur = None
    cur_layer = '0'
    cur_block = None
    layers = set()
    blocks = set()
    ent_counts = {}
    by_layer = {}
    inserts = {}
    total = 0
    minx=miny=1e18; maxx=maxy=-1e18
    sec_depth = endsec = 0
    has_eof = False
    acad = None

    def flush():
        nonlocal cur, cur_block, total
        if cur and section == 'ENTITIES' and cur not in ('VERTEX','SEQEND'):
            ent_counts[cur] = ent_counts.get(cur,0)+1
            by_layer[cur_layer] = by_layer.get(cur_layer,0)+1
            total += 1
            if cur == 'INSERT' and cur_block:
                inserts[cur_block] = inserts.get(cur_block,0)+1
        cur = None; cur_block = None

    for idx,(code,val) in enumerate(pairs):
        v = val.strip()
        if code == 0:
            flush()
            if v == 'SECTION': section=None; sec_depth+=1
            elif v == 'ENDSEC': section=None; in_layer_table=False; endsec+=1
            elif v == 'EOF': has_eof=True
            elif v == 'LAYER' and section=='TABLES': in_layer_table=True
            elif v == 'BLOCK' and section=='BLOCKS': cur_block=None
            elif section=='ENTITIES': cur=v; cur_layer='0'; cur_block=None
            continue
        if code==2 and section is None and sec_depth>0 and not in_layer_table and v in ('HEADER','TABLES','BLOCKS','ENTITIES'):
            section=v; continue
        if code==1 and section=='HEADER' and acad is None and v.startswith('AC'): acad=v
        if in_layer_table and code==2 and v: layers.add(v)
        if section=='BLOCKS' and code==2 and v: blocks.add(v)
        if section=='ENTITIES' and cur:
            if code==8: cur_layer=v or '0'
            if cur=='INSERT' and code==2: cur_block=v
            for c in (10,11,20,21):
                if code==c:
                    try:
                        f=float(v)
                        if c in (10,11): minx=min(minx,f); maxx=max(maxx,f)
                        else: miny=min(miny,f); maxy=max(maxy,f)
                    except: pass
    flush()
    return {
        'acadVersion': acad,
        'layers': sorted(layers),
        'blocks': sorted(blocks),
        'entityCounts': ent_counts,
        'entitiesByLayer': by_layer,
        'insertsByBlock': inserts,
        'totalEntities': total,
        'bbox': [round(minx),round(miny),round(maxx),round(maxy)] if maxx>-1e17 else None,
        'sectionsBalanced': sec_depth==endsec and sec_depth>0,
        'hasEof': has_eof,
    }

if __name__ == '__main__':
    print(json.dumps(verify(sys.argv[1]), indent=2))
