import json,math,collections
st=json.load(open('stage1.json'));g=json.load(open('stage2.json'))
out=st['out'];edges=g['edges'];nid=g['nid'];keep=set(g['keep'])
names=st['names']
# relabel nodes in largest comp compactly
nmap={};E=[]
def nn(x):
    if x not in nmap:nmap[x]=len(nmap)
    return nmap[x]
# drawn geometry: all ways (classes 0..3). arterial (<=2) drawn from edges (split) to link ids; class 3 from stage1
nxy={}
draw=[]  # [cls,nameidx,owner,flat,routableEdgeIndex or -1]
route=[] # [a,b,len,cls,owner,drawIndex]
def flat(xs,ys):
    f=[xs[0],ys[0]]
    for i in range(1,len(xs)):f+= [xs[i]-xs[i-1],ys[i]-ys[i-1]]
    return f
def plen(xs,ys):return sum(math.hypot(xs[i]-xs[i-1],ys[i]-ys[i-1]) for i in range(1,len(xs)))*2.2
for ei,(c,ni,ow,j,xs,ys,wi) in enumerate(edges):
    di=len(draw);r=-1
    if ei in keep:
        a=nn(nid[2*ei]);b=nn(nid[2*ei+1]);nxy[a]=(xs[0],ys[0]);nxy[b]=(xs[-1],ys[-1])
        r=len(route);route.append([a,b,round(plen(xs,ys)),c,j,di])
    draw.append([c,ni,j,flat(xs,ys),r])
for (c,ni,ow,j,xs,ys) in st['ways']:
    if c==3:draw.append([3,-1,j,flat(xs,ys),-1])
import numpy as np
from scipy.spatial import cKDTree
ks=sorted(nxy);arr=np.array([nxy[k] for k in ks],float);kt=cKDTree(arr)
for s_ in out['st']:
    d,i=kt.query([s_['x'],s_['y']]);s_['node']=int(ks[i]);s_['nd']=round(float(d)*2.2)
HUBS=[('CBD (MG Road, Majestic)',12.975,77.595,1.6),('Whitefield, ITPL',12.985,77.735,1.0),('Electronic City',12.845,77.66,1.0),('Manyata, Nagawara',13.045,77.62,1.0),('Peenya',13.03,77.52,0.6),('Bellandur, Marathahalli ORR',12.93,77.685,1.2),('Airport',13.19,77.70,0.5)]
out['hubs']=[]
for n_,la,lo,w in HUBS:
    x,y=(lo-77.40)*50000,(la-12.80)*50000;d,i=kt.query([x,y]);out['hubs'].append({'n':n_,'x':round(x),'y':round(y),'node':int(ks[i]),'nd':round(float(d)*2.2),'w':w})
out['nxy']=[[int(nxy[k][0]),int(nxy[k][1])] for k in range(len(nmap))]
out['n']=names;out['d']=draw;out['r']=route;out['nn']=len(nmap)
json.dump(out,open('map.json','w'),separators=(',',':'))
import os;print('draw',len(draw),'route',len(route),'nodes',len(nmap),'bytes',os.path.getsize('map.json'))
# top road names by length in routable
L=collections.Counter()
for r in route:
    pass
print(sorted(names)[:40])
