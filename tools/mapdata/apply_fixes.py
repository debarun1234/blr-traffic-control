"""One-off corrections applied directly to packages/mapdata/map.json (the raw OSM extracts for the rural units are not in the repo,
so the full pipeline cannot be re-run end to end). Idempotent.
 1. Byatarayanapura traffic police station is on Mysuru Road (West division), not on Ballari Road; the Ballari Road stretch
    between Hebbal and Yelahanka belongs to Hebbal traffic police (North). Move the station and recompute the territories.
 2. Road names: official current spellings (Ballari, Bengaluru, Mysuru, Tumakuru ...), spacing/case fixes, and drop non-road junk names.
Usage: python3 apply_fixes.py ../../packages/mapdata/map.json
"""
import json, re, sys
import numpy as np
from scipy.spatial import Voronoi, cKDTree
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union

P = sys.argv[1] if len(sys.argv) > 1 else '../../packages/mapdata/map.json'
m = json.load(open(P))
O, SC = m['o'], m['s']
ll2xy = lambda la, lo: ((lo - O[0]) * SC, (la - O[1]) * SC)

# ---------- 1. Byatarayanapura ----------
BY = 'Byatarayanapura'; LAT, LON = 12.9570, 77.5340   # Mysuru Road, near Gali Anjaneya temple / Satellite bus station (approximate)
st = m['st']; names = [s['n'] for s in st]
city_idx = [i for i, s in enumerate(st) if s['r'] != 'Rural']
bi = names.index(BY); bx, by = ll2xy(LAT, LON)
if abs(st[bi]['x'] - round(bx)) > 1 or abs(st[bi]['y'] - round(by)) > 1 or st[bi]['r'] != 'West':
    pts_old = np.array([[st[i]['x'], st[i]['y']] for i in city_idx], float)
    st[bi].update(x=round(bx), y=round(by), r='West', z='West', sub='West', src='approx')
    pts = np.array([[st[i]['x'], st[i]['y']] for i in city_idx], float)
    far = np.array([[-1e5, -1e5], [1e5, -1e5], [1e5, 1e5], [-1e5, 1e5]])
    def cells_of(P_):
        v = Voronoi(np.vstack([P_, far])); return [Polygon([v.vertices[j] for j in v.regions[v.point_region[k]]]) for k in range(len(P_))]
    old_c, new_c = cells_of(pts_old), cells_of(pts)
    city = unary_union([Polygon(r) for r in m['city']]).buffer(0)
    def pl(g, tol=2.5):
        g = g.simplify(tol); ps = [g] if g.geom_type == 'Polygon' else list(g.geoms)
        return [[[round(x), round(y)] for x, y in q.exterior.coords] for q in ps if q.area > 50]
    changed = []; lost = {}
    for k, i in enumerate(city_idx):
        gain, loss = new_c[k].difference(old_c[k]).intersection(city), old_c[k].difference(new_c[k])
        if gain.area < 200 and loss.area < 200: continue
        cur = unary_union([Polygon(q) for q in st[i]['poly']]).buffer(0)
        st[i]['poly'] = pl(cur.difference(loss).union(gain).buffer(0)); changed.append(names[i]); lost[i] = loss
    # edges whose midpoint is in an area its owner lost go to the nearest station of the new layout
    tree = cKDTree(pts); cidx = np.array(city_idx); moved = 0
    for i, d in enumerate(m['d']):
        s = d[2]
        if s not in lost: continue
        g = d[3]; xs = [g[0]]; ys = [g[1]]
        for k in range(2, len(g), 2): xs.append(xs[-1] + g[k]); ys.append(ys[-1] + g[k + 1])
        mx, my = xs[len(xs) // 2], ys[len(ys) // 2]
        if lost[s].contains(Point(mx, my)):
            d[2] = int(cidx[tree.query([mx, my])[1]]); moved += 1
            if d[4] >= 0: m['r'][d[4]][4] = d[2]
    # nearest routable node to the station
    nx = np.array(m['nxy'], float); dd, ni = cKDTree(nx).query([bx, by]); st[bi]['node'] = int(ni); st[bi]['nd'] = round(float(dd) * 2.2)
    # region outlines from the (changed) station territories
    for r in {st[i]['r'] for i in city_idx if names[i] in changed} | {'North', 'West'}:
        m['reg'][r] = pl(unary_union([Polygon(q).buffer(0) for i in city_idx if st[i]['r'] == r for q in st[i]['poly']]).buffer(2), 3)
    print('Byatarayanapura moved; territories changed:', changed, '| edges re-owned:', moved)
else:
    print('Byatarayanapura already placed')

# ---------- 2. road names ----------
SUBS = [(r'\bBangalore\b', 'Bengaluru'), (r'\bBellary\b', 'Ballari'), (r'\bMysore\b', 'Mysuru'), (r'\bTumkur\b', 'Tumakuru'), (r'\bMangalore\b', 'Mangaluru'),
        (r'\bHoskote\b', 'Hosakote'), (r'\bSarjapur\b', 'Sarjapura'), (r'\bVarthur\b', 'Varthuru'), (r'\bWhiteField\b', 'Whitefield'), (r'\bChikabellanduru\b', 'Chikka Bellandur')]
JUNK = re.compile(r'\b(pg|hostel|apartments?|restaurant|hotel|mall)\b.*,|,.*\bBangalore\b|\bfor ladies\b', re.I)
def fix(n):
    if JUNK.search(n): return None
    for a, b in SUBS: n = re.sub(a, b, n)
    n = re.sub(r'\s*-\s*', ' - ', n) if re.search(r'\b[A-Za-z]+\s*-\s*[A-Za-z]+\b (Road|Highway|Expressway)$', n) else n
    return re.sub(r'\s{2,}', ' ', n).strip()
chg = 0; junk = []
for i, n in enumerate(m['n']):
    f = fix(n)
    if f is None: junk.append(n); f = ''
    if f != n: m['n'][i] = f; chg += 1
print('road names changed:', chg, '| blanked:', junk)

json.dump(m, open(P, 'w'), separators=(',', ':'), ensure_ascii=False)
