"""Add Bengaluru Rural (Devanahalli, Doddaballapura, Hoskote, Nelamangala taluks) to the road/territory stage.
Rural = four Bangalore Rural taluks + the parts of the four Bengaluru Urban district taluks (Anekal, South, North, East, Yelahanka) that lie outside the city territory.
Reads  stage1.city.json (the city-only stage, copied once from stage1.json), data/rural_taluks.json (KGIS taluk
boundaries, EPSG:4326) and data/raw/work4/rural_osm.json (OSM highways from tools/mapdata/extract_osm.py).
Writes stage1.json (city + Rural). Then run graph12.py and final.py as before.
Rural territories are the four official taluks minus the existing city territory. They are taluk-level units, NOT police
stations: no Rural station list was available, so none is invented. Crash figures are absent (t/f = null)."""
import json, math, os, shutil, collections, sys
import numpy as np
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, shape
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree
from scipy.spatial import cKDTree

O = (77.40, 12.80); SC = 50000
ll2xy = lambda lo, la: ((lo - O[0]) * SC, (la - O[1]) * SC)
here = os.path.dirname(os.path.abspath(__file__)); P = lambda *a: os.path.join(here, *a)
if not os.path.exists(P('stage1.city.json')): shutil.copy(P('stage1.json'), P('stage1.city.json'))
st = json.load(open(P('stage1.city.json'))); out = st['out']
assert not any(s['r'] == 'Rural' for s in out['st']), 'stage1.city.json already contains Rural'
tal = json.load(open(P('data/rural_taluks.json')))['taluks']
osm = json.load(open(P('data/raw/work4/rural_osm.json')))

def geom_xy(g):
    s = shape(g); polys = [s] if s.geom_type == 'Polygon' else list(s.geoms)
    return unary_union([Polygon([ll2xy(x, y) for x, y in p.exterior.coords], [[ll2xy(x, y) for x, y in h.coords] for h in p.interiors]).buffer(0) for p in polys])
city = unary_union([Polygon(r).buffer(0) for r in out['city']])
# taluk HQ towns (approximate coordinates; used only as the unit's anchor point)
TOWN = {'Devanahalli': (13.2468, 77.7138), 'Doddaballapura': (13.2957, 77.5378), 'Hoskote': (13.0707, 77.7982), 'Nelamangala': (13.0953, 77.3912), 'Anekal': (12.7108, 77.6966)}
MINKM2 = 0.5; KM2 = (1000 / 2.2) ** 2
units = []
for name in ['Nelamangala', 'Doddaballapura', 'Devanahalli', 'Hoskote', 'Anekal', 'Bengaluru South', 'Bengaluru North', 'Bengaluru East', 'Yelahanka']:
    g = geom_xy(tal[name]).difference(city)
    parts = [g] if g.geom_type == 'Polygon' else [p for p in g.geoms if p.geom_type == 'Polygon']
    parts = [p for p in parts if p.area > MINKM2 * KM2]
    g = unary_union(parts).buffer(0)
    la, lo = TOWN.get(name, (None, None)); pt = Point(*ll2xy(lo, la)) if lo else g.representative_point(); x, y = pt.x, pt.y
    if lo and not g.contains(pt): pt = g.representative_point(); print(f'  {name}: HQ point outside unit; using a point inside it')
    units.append({'name': name, 'poly': g, 'x': pt.x, 'y': pt.y})
    print(f'{name}: {g.area/KM2:.0f} km2 outside the city territory')
rural = unary_union([u['poly'] for u in units]).buffer(0)

# ---- roads ----
base_ways = st['ways']; names = list(st['names']); nidx = {n.lower(): i for i, n in enumerate(names)}
def name_ix(w):
    n = (w['n'] or w['ref'] or '').strip()
    if not n: return -1
    if n.lower() not in nidx: nidx[n.lower()] = len(names); names.append(n)
    return nidx[n.lower()]
# existing geometry (to avoid duplicating roads that leave the city) as a union of lines buffered a few units
existing = [LineString(list(zip(w[4], w[5]))) for w in base_ways if len(w[4]) > 1]
ex_tree = STRtree(existing); BUF = 6
def near_existing(ls):
    cand = ex_tree.query(ls.buffer(BUF))
    if len(cand) == 0: return None
    return unary_union([existing[i] for i in cand]).buffer(BUF)
rb = rural.buffer(30); rp = prep(rb)
TRANS = 1800  # residential/living streets are kept only within ~4 km of the city boundary (link zone); beyond it only tertiary and above + unclassified
citybuf = city.buffer(TRANS); cbp = prep(citybuf)
pts = np.array([[u['x'], u['y']] for u in units]); tree = cKDTree(pts)
new, kept = [], collections.Counter()
for w in osm['ways']:
    xy = [ll2xy(lo, la) for lo, la in w['p']]
    if len(xy) < 2: continue
    ls = LineString(xy)
    if not rp.intersects(ls): continue
    g = ls.intersection(rb)
    res = w['c'] == 4
    if res:
        if not cbp.intersects(ls): continue
        g = g.intersection(citybuf)
    nb = near_existing(g) if not g.is_empty else None
    if nb is not None: g = g.difference(nb)
    segs = [g] if g.geom_type == 'LineString' else [s for s in getattr(g, 'geoms', []) if s.geom_type == 'LineString']
    ni = name_ix(w)
    for s in segs:
        if s.length < 12 or len(s.coords) < 2: continue
        cx = list(s.coords); mi = len(cx) // 2; d, j = tree.query([cx[mi][0], cx[mi][1]])
        xs = [round(c[0]) for c in cx]; ys = [round(c[1]) for c in cx]
        if res and s.length < 25: continue
        new.append((4 if res else w['c'], ni, w['ow'], 53 + int(j), xs, ys)); kept[4 if res else w['c']] += 1
# ---- residential / living streets inside the city territory (draw-only, class 3), clipped to the city and owned by the station polygon holding their midpoint ----
sp = [unary_union([Polygon(r).buffer(0) for r in x['poly']]) for x in out['st'][:53]]; sp_tree = STRtree(sp)
ctree = cKDTree(np.array([[x['x'], x['y']] for x in out['st'][:53]])); cprep = prep(city); ncity = 0
for w in osm['ways']:
    if w['c'] != 4: continue
    xy = [ll2xy(lo, la) for lo, la in w['p']]
    if len(xy) < 2: continue
    ls = LineString(xy)
    if not cprep.intersects(ls): continue
    g = ls.intersection(city)
    nb = near_existing(g) if not g.is_empty else None
    if nb is not None: g = g.difference(nb)
    segs = [g] if g.geom_type == 'LineString' else [q for q in getattr(g, 'geoms', []) if q.geom_type == 'LineString']
    ni = name_ix(w)
    for q in segs:
        if q.length < 25 or len(q.coords) < 2: continue
        cx = list(q.coords); mp = Point(cx[len(cx) // 2]); hit = sp_tree.query(mp, predicate='within')
        j = int(hit[0]) if len(hit) else int(ctree.query([mp.x, mp.y])[1])
        new.append((4, ni, w['ow'], j, [round(c[0]) for c in cx], [round(c[1]) for c in cx])); ncity += 1
print('city residential ways added', ncity)

# snap rural way ends onto the nearest existing city vertex (<= SNAP units) so roads cross the boundary as one connected line
SNAP = 14
ev = np.array([(x, y) for w in base_ways for x, y in zip(w[4], w[5])]); et = cKDTree(ev); nsn = 0
for k, (c, ni, ow, si, xs, ys) in enumerate(new):
    for e in (0, -1):
        d, j = et.query([xs[e], ys[e]])
        if 0 < d <= SNAP: xs[e], ys[e] = int(ev[j][0]), int(ev[j][1]); nsn += 1
print('endpoints snapped', nsn)
print('rural ways kept', len(new), dict(kept))

# ---- territory / outline ----
def pl(g, tol=2.5):
    g = g.simplify(tol); polys = [g] if g.geom_type == 'Polygon' else list(g.geoms)
    return [[[round(x), round(y)] for x, y in p.exterior.coords] for p in polys if p.area > 50]
nst = len(out['st']); assert nst == 53
for i, u in enumerate(units):
    out['st'].append({'n': f"{u['name']} (taluk)", 'x': round(u['x']), 'y': round(u['y']), 'r': 'Rural', 'z': 'Rural', 'sub': 'Rural', 't': None, 'f': None, 'src': 'approx', 'poly': pl(u['poly'])})
out['reg']['Rural'] = pl(rural, 3)
out['city'] = pl(unary_union([city, rural]).buffer(40).buffer(-40), 3)
st['ways'] = base_ways + new; st['names'] = names; st['stnames'] = list(st['stnames']) + [s['n'] for s in out['st'][nst:]]
json.dump(st, open(P('stage1.json'), 'w'))
print('stations', len(out['st']), 'ways', len(st['ways']), 'names', len(names), 'city polygons', len(out['city']))
