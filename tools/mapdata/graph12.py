import json,collections,math
import numpy as np
from scipy.spatial import cKDTree
st=json.load(open('stage1.json'))
ways=[w for w in st['ways'] if w[0]<=2]   # arterial: class 0..2
print('arterial ways',len(ways))
TOL=12
# vertex index
V=[];own=[]
for wi,(c,ni,ow,j,xs,ys) in enumerate(ways):
    for k,(x,y) in enumerate(zip(xs,ys)):V.append((x,y));own.append((wi,k))
V=np.array(V,float);tree=cKDTree(V)
# split points: for each endpoint of way A, nearest vertex of other way B (non-endpoint) within TOL
splits=collections.defaultdict(set)
for wi,(c,ni,ow,j,xs,ys) in enumerate(ways):
    for e in (0,len(xs)-1):
        p=(xs[e],ys[e])
        for idx in tree.query_ball_point(p,TOL):
            wb,k=own[idx]
            if wb==wi:continue
            n=len(ways[wb][4])
            if 0<k<n-1:splits[wb].add(k)
# build edges
edges=[]   # (c,ni,ow,j,xs,ys, orig way index)
for wi,(c,ni,ow,j,xs,ys) in enumerate(ways):
    ks=sorted(splits.get(wi,[]));cuts=[0]+ks+[len(xs)-1]
    for a,b in zip(cuts,cuts[1:]):
        edges.append((c,ni,ow,j,xs[a:b+1],ys[a:b+1],wi))
print('edges',len(edges))
# node merge by union-find on endpoints within TOL
ends=[];eid=[]
for ei,e in enumerate(edges):
    ends.append((e[4][0],e[5][0]));eid.append((ei,0))
    ends.append((e[4][-1],e[5][-1]));eid.append((ei,1))
ends=np.array(ends,float);et=cKDTree(ends)
parent=list(range(len(ends)))
def find(a):
    while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
    return a
for a,b in et.query_pairs(TOL):
    ra,rb=find(a),find(b)
    if ra!=rb:parent[ra]=rb
nodes={};nid=[0]*len(ends)
for i in range(len(ends)):
    r=find(i)
    if r not in nodes:nodes[r]=len(nodes)
    nid[i]=nodes[r]
import networkx as nx
G=nx.Graph()
for ei,e in enumerate(edges):
    G.add_edge(nid[2*ei],nid[2*ei+1],e=ei)
comps=sorted(nx.connected_components(G),key=len,reverse=True)
print('nodes',G.number_of_nodes(),'edges',G.number_of_edges(),'components',len(comps),'largest',len(comps[0]),'second',len(comps[1]) if len(comps)>1 else 0)
big=comps[0]
keep=[ei for ei in range(len(edges)) if nid[2*ei] in big]
print('edges in largest',len(keep))
json.dump({'edges':edges,'nid':nid,'keep':keep},open('stage2.json','w'))
