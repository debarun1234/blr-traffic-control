import json,math,sys,collections
import numpy as np
from shapely.geometry import Point,Polygon,MultiPolygon,box
from shapely.ops import unary_union
from scipy.spatial import Voronoi,cKDTree
sys.path.insert(0,'.')
from stations import S
D=json.load(open('data/crash_2018_2025.json'))
O=(77.40,12.80);SC=50000
def ll2xy(la,lo):return ((lo-O[0])*SC,(la-O[1])*SC)
rows=D['cur']['2025'];meta={r[2]:(r[0],r[1],r[3],r[4]) for r in rows}
names=[r[2] for r in rows];assert set(names)==set(S),set(names)^set(S)
def region(z,sub):
    if sub=='Central':return 'Central'
    return z
pts=np.array([ll2xy(S[n][0],S[n][1]) for n in names]);R=[region(meta[n][0],meta[n][1]) for n in names]
# voronoi with far points
far=np.array([[-1e5,-1e5],[1e5,-1e5],[1e5,1e5],[-1e5,1e5]])
vor=Voronoi(np.vstack([pts,far]))
Rad=850
BIG={'Int. Aiport','Chikkajala','Kengeri','Electronic City','Whitefield','Hulimavu','Thalagattapura','Chikkabanavara','Yalahanka','Hennuru','Bellanduru','Jnanabharathi'}
RADS=[850 if n in BIG else 520 for n in names]
import numpy as _np
b=[float(v) for v in open('data/boundary.txt').read().strip().split(',')]
bpoly=Polygon(list(zip(b[0::2],b[1::2]))).buffer(0)
print('boundary area km2',bpoly.area*5.42*5.56/1e6,bpoly.is_valid)
ai=names.index('Int. Aiport');yl=names.index('Yalahanka')
from shapely.geometry import LineString,MultiPoint
# BTP jurisdiction reaches the airport beyond the municipal boundary. Instead of an arbitrary wedge, extend the
# territory only along real arterial roads (class 0-1) that leave the boundary toward the airport, buffered ~1.3 km.
W=json.load(open('data/roads.json'))
north=MultiPoint([pts[names.index(k)] for k in ('Yalahanka','Chikkajala','Int. Aiport','Hennuru','Kodigehalli')]).convex_hull.buffer(1500)
lines=[]
for c,ni,ow,flat in W['w']:
    if c>1:continue
    xs=[flat[0]];ys=[flat[1]]
    for k in range(2,len(flat),2):xs.append(xs[-1]+flat[k]);ys.append(ys[-1]+flat[k+1])
    ls=LineString(list(zip(xs,ys)))
    if len(xs)>1 and ls.intersects(north) and not bpoly.contains(ls):lines.append(ls.intersection(north))
corridor=unary_union(lines).buffer(600,8)
clip=unary_union([bpoly,Point(*pts[ai]).buffer(650,32),corridor.buffer(900,8).buffer(-900,8)]).buffer(40).buffer(-40)
clip=unary_union([Polygon(g.exterior) for g in ([clip] if clip.geom_type=='Polygon' else clip.geoms)])
print('clip area km2',clip.area*2.2*2.2/1e6)
cells=[]
for i in range(len(names)):
    reg=vor.regions[vor.point_region[i]];poly=Polygon([vor.vertices[j] for j in reg])
    cells.append(poly.intersection(clip))
terr={n:c for n,c in zip(names,cells)}
reg_poly={}
for r in set(R):reg_poly[r]=unary_union([cells[i] for i in range(len(names)) if R[i]==r])
city=unary_union(cells)
def pl(g,tol=2.5):
    g=g.simplify(tol)
    polys=[g] if g.geom_type=='Polygon' else list(g.geoms)
    return [[[round(x),round(y)] for x,y in p.exterior.coords] for p in polys if p.area>50]
out={'o':O,'s':SC,'st':[],'reg':{},'city':pl(city,3)}
for i,n in enumerate(names):
    z,sub,tot,f=meta[n];out['st'].append({'n':n,'x':round(pts[i][0]),'y':round(pts[i][1]),'r':R[i],'z':z,'sub':sub,'t':tot,'f':f,'src':S[n][2],'poly':pl(terr[n])})
for r,g in reg_poly.items():out['reg'][r]=pl(g,3)
# roads
tree=cKDTree(pts)
from shapely.prepared import prep
cityp=prep(city)
ways=[]
for c,ni,ow,flat in W['w']:
    xs=[flat[0]];ys=[flat[1]]
    for k in range(2,len(flat),2):xs.append(xs[-1]+flat[k]);ys.append(ys[-1]+flat[k+1])
    mi=len(xs)//2;d,j=tree.query([xs[mi],ys[mi]])
    # keep way if any vertex lies inside the city polygon (own territory)
    inside=[i for i,(x,y) in enumerate(zip(xs,ys)) if cityp.contains(Point(x,y))]
    if not inside:continue
    i0=inside[len(inside)//2];d,j=tree.query([xs[i0],ys[i0]])
    ways.append((c,ni,ow,int(j),xs,ys))
print('ways kept',len(ways),'of',len(W['w']))
cnt=collections.Counter(w[0] for w in ways);print(cnt)
json.dump({'out':out,'ways':[(w[0],w[1],w[2],w[3],w[4],w[5]) for w in ways],'names':W['n'],'stnames':names},open('stage1.json','w'))
print('city area km2',city.area*5.42*5.56/1e6)
for r,g in reg_poly.items():print(r,sum(1 for x in R if x==r),round(g.area*5.42*5.56/1e6))
