"""Extract highway ways (motorway..tertiary) and police nodes inside a bbox from an OSM .osm.pbf.
Resumable, time-budgeted (each run does at most --budget seconds) and parallel; node coordinates are decoded
straight from the PBF DenseNodes blocks with numpy, so no node index is held in memory.
Usage: python3 extract_osm.py <in.osm.pbf> <workdir> [--budget 150] [--bbox S W N E] [--finish out.json]"""
import sys, os, json, time, zlib, struct, array, glob, argparse
import numpy as np
from multiprocessing import Pool

CLS = {'motorway': 0, 'motorway_link': 0, 'trunk': 0, 'trunk_link': 0, 'primary': 1, 'primary_link': 1, 'secondary': 2, 'secondary_link': 2, 'tertiary': 3, 'tertiary_link': 3}

def varint(buf, i):
    r = s = 0
    while True:
        b = buf[i]; i += 1; r |= (b & 0x7f) << s; s += 7
        if b < 128: return r, i

def fields(buf):
    i, n = 0, len(buf)
    while i < n:
        k, i = varint(buf, i); f, w = k >> 3, k & 7
        if w == 0: v, i = varint(buf, i)
        elif w == 2:
            l, i = varint(buf, i); v = buf[i:i + l]; i += l
        elif w == 1: v = buf[i:i + 8]; i += 8
        elif w == 5: v = buf[i:i + 4]; i += 4
        else: raise ValueError('wire type')
        yield f, v

def packed_sint64(b):
    a = np.frombuffer(b, np.uint8)
    if not len(a): return np.zeros(0, np.int64)
    ends = np.flatnonzero(a < 128); starts = np.concatenate(([0], ends[:-1] + 1)); ln = ends - starts + 1
    v = np.zeros(len(ends), np.uint64)
    for k in range(int(ln.max())):
        idx = np.minimum(starts + k, len(a) - 1)
        v |= (((a[idx] & 0x7f).astype(np.uint64)) << np.uint64(7 * k)) * (k < ln).astype(np.uint64)
    return (v >> np.uint64(1)).astype(np.int64) ^ -(v & np.uint64(1)).astype(np.int64)

def blob_index(path):
    out = []
    with open(path, 'rb') as f:
        size = os.fstat(f.fileno()).st_size; pos = 0
        while pos < size:
            f.seek(pos); hl = struct.unpack('>I', f.read(4))[0]; hdr = f.read(hl)
            typ = None; ds = 0
            for fn, v in fields(hdr):
                if fn == 1: typ = bytes(v)
                elif fn == 3: ds = v
            if typ == b'OSMData': out.append((pos + 4 + hl, ds))
            pos += 4 + hl + ds
    return out

def decode_chunk(args):
    path, blobs, need, bbox = args
    S, W, N, E = bbox; ids_o, la_o, lo_o = [], [], []
    with open(path, 'rb') as f:
        for off, ds in blobs:
            f.seek(off); blob = f.read(ds); raw = None
            for fn, v in fields(blob):
                if fn == 3: raw = zlib.decompress(bytes(v))
                elif fn == 1: raw = bytes(v)
            gran, lat_off, lon_off, groups = 100, 0, 0, []
            for fn, v in fields(raw):
                if fn == 2: groups.append(v)
                elif fn == 17: gran = v
                elif fn == 19: lat_off = v
                elif fn == 20: lon_off = v
            for g in groups:
                for fn, v in fields(g):
                    if fn != 2: continue
                    ids = la = lo = None
                    for dn, dv in fields(v):
                        if dn == 1: ids = np.cumsum(packed_sint64(dv))
                        elif dn == 8: la = np.cumsum(packed_sint64(dv))
                        elif dn == 9: lo = np.cumsum(packed_sint64(dv))
                    if ids is None: continue
                    la = 1e-9 * (lat_off + gran * la); lo = 1e-9 * (lon_off + gran * lo)
                    m = (la >= S) & (la <= N) & (lo >= W) & (lo <= E)
                    if not m.any(): continue
                    ids, la, lo = ids[m], la[m], lo[m]
                    j = np.searchsorted(need, ids); j[j >= len(need)] = 0; k = need[j] == ids
                    ids_o.append(ids[k]); la_o.append(la[k]); lo_o.append(lo[k])
    cat = lambda L, dt: np.concatenate(L) if L else np.zeros(0, dt)
    return cat(ids_o, np.int64), cat(la_o, np.float64), cat(lo_o, np.float64)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('work'); ap.add_argument('--budget', type=float, default=150)
    ap.add_argument('--bbox', nargs=4, type=float, default=[12.85, 77.15, 13.55, 78.10]); ap.add_argument('--finish')
    a = ap.parse_args(); os.makedirs(a.work, exist_ok=True); W_ = lambda n: os.path.join(a.work, n); t0 = time.time()
    log = lambda m: print(f'{time.time()-t0:6.0f}s {m}', flush=True)
    import osmium as o
    if not os.path.exists(W_('ways.json')):
        ways = []; need = array.array('q')
        for w in o.FileProcessor(a.src, o.osm.WAY).with_filter(o.filter.KeyFilter('highway')):
            hw = w.tags.get('highway')
            if hw in CLS:
                ids = [n.ref for n in w.nodes]
                ways.append((CLS[hw], w.tags.get('name') or '', w.tags.get('ref') or '', 1 if w.tags.get('oneway') in ('yes', '1') else 0, ids)); need.extend(ids)
        json.dump(ways, open(W_('ways.json'), 'w'), separators=(',', ':')); np.save(W_('need.npy'), np.unique(np.frombuffer(need, dtype=np.int64)))
        police = [{'n': n.tags.get('name', ''), 'la': n.location.lat, 'lo': n.location.lon, 'o': 'node'} for n in o.FileProcessor(a.src, o.osm.NODE).with_filter(o.filter.KeyFilter('amenity')) if n.tags.get('amenity') == 'police' and n.location.valid()]
        json.dump(police, open(W_('police.json'), 'w')); log(f'pass 1: {len(ways)} ways, {len(police)} police nodes')
    need = np.load(W_('need.npy'))
    if not os.path.exists(W_('blobs.json')): json.dump(blob_index(a.src), open(W_('blobs.json'), 'w')); log('blob index built')
    blobs = json.load(open(W_('blobs.json'))); CH = 24
    chunks = [blobs[i:i + CH] for i in range(0, len(blobs), CH)]
    todo = [i for i in range(len(chunks)) if not os.path.exists(W_(f'c{i:05d}.npz'))]
    log(f'{len(blobs)} blobs, {len(chunks)} chunks, {len(todo)} to do')
    with Pool(4) as pool:
        it = pool.imap_unordered(decode_chunk, [(a.src, chunks[i], need, a.bbox) for i in todo], chunksize=1) if todo else iter(())
        # imap_unordered loses the chunk id; use ordered imap in small waves instead
    wave = 8
    with Pool(4) as pool:
        for s in range(0, len(todo), wave):
            if time.time() - t0 > a.budget: log('budget reached; run again to resume'); return 2
            batch = todo[s:s + wave]
            for i, (ids, la, lo) in zip(batch, pool.map(decode_chunk, [(a.src, chunks[i], need, a.bbox) for i in batch])):
                np.savez(W_(f'c{i:05d}.npz'), ids=ids, la=la, lo=lo)
            log(f'done {min(s + wave, len(todo))}/{len(todo)}')
    ids, la, lo = [], [], []
    for fn in sorted(glob.glob(W_('c*.npz'))):
        z = np.load(fn); ids.append(z['ids']); la.append(z['la']); lo.append(z['lo'])
    ids, la, lo = np.concatenate(ids), np.concatenate(la), np.concatenate(lo); order = np.argsort(ids); ids, la, lo = ids[order], la[order], lo[order]
    res = []
    for c, name, ref, ow, nds in json.load(open(W_('ways.json'))):
        arr = np.asarray(nds, np.int64); j = np.searchsorted(ids, arr); j[j >= len(ids)] = 0; ok = ids[j] == arr
        if ok.sum() < 2: continue
        res.append({'c': c, 'n': name, 'ref': ref, 'ow': ow, 'p': [[round(float(x), 6), round(float(y), 6)] for x, y in zip(lo[j[ok]], la[j[ok]])]})
    S, W, N, E = a.bbox; police = [p for p in json.load(open(W_('police.json'))) if S <= p['la'] <= N and W <= p['lo'] <= E]
    out = a.finish or W_('rural_osm.json'); json.dump({'bbox': a.bbox, 'ways': res, 'police': police}, open(out, 'w'), separators=(',', ':'))
    log(f'wrote {out}: {len(res)} ways, {len(police)} police'); return 0

if __name__ == '__main__': sys.exit(main())
