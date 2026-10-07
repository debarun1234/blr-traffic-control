// ---- traffic model (DOM-free) ----
var G={};
function buildGraph(M){
  var nn=M.nn,E=M.r,ne=E.length;
  G.nn=nn;G.ne=ne;G.a=new Int32Array(ne);G.b=new Int32Array(ne);G.len=new Float32Array(ne);G.cls=new Uint8Array(ne);G.name=new Int32Array(ne);G.stn=new Int16Array(ne);
  G.cap=new Float32Array(ne);G.t0=new Float32Array(ne);
  var CAP=[4200,2600,1500],FF=[55,40,30];
  for(var i=0;i<ne;i++){var e=E[i];G.a[i]=e[0];G.b[i]=e[1];G.len[i]=e[2];G.cls[i]=e[3];G.stn[i]=e[4];G.name[i]=M.d[e[5]][1];
    G.cap[i]=CAP[e[3]];G.t0[i]=Math.max(0.02,(e[2]/1000)/FF[e[3]]*60); }// minutes
  // CSR over arcs: arc 2i = a->b , 2i+1 = b->a
  var deg=new Int32Array(nn+1);
  for(i=0;i<ne;i++){deg[G.a[i]+1]++;deg[G.b[i]+1]++;}
  for(i=0;i<nn;i++)deg[i+1]+=deg[i];
  G.off=deg;var pos=deg.slice(0,nn);G.to=new Int32Array(2*ne);G.arc=new Int32Array(2*ne);
  for(i=0;i<ne;i++){var p=pos[G.a[i]]++;G.to[p]=G.b[i];G.arc[p]=2*i;p=pos[G.b[i]]++;G.to[p]=G.a[i];G.arc[p]=2*i+1;}
  // centroids
  G.cen=[];G.cw=[];G.cemp=[];G.cname=[];
  M.hubs.forEach(function(h){G.cen.push(h.node);G.cw.push(h.w*3);G.cemp.push(h.w);G.cname.push(h.n);});
  M.st.forEach(function(s){G.cen.push(s.node);G.cw.push(1);G.cemp.push(0.25);G.cname.push(s.n);});
  G.nc=G.cen.length;
  // gravity matrix base (distance in map units between centroids)
  var xy=M.nxy,nc=G.nc;G.W=new Float32Array(nc*nc);
  for(var i2=0;i2<nc;i2++)for(var j=0;j<nc;j++){if(i2==j)continue;
    var A=xy[G.cen[i2]],B=xy[G.cen[j]];var d=Math.hypot(A[0]-B[0],A[1]-B[1])*2.2/1000;
    G.W[i2*nc+j]=G.cw[i2]*G.cw[j]*Math.exp(-d/9)*(d>1?1:0.3);}
  var s=0;for(i=0;i<G.W.length;i++)s+=G.W[i];G.Wsum=s;
  G.heapK=new Float64Array(2*ne+nn+8);G.heapV=new Int32Array(2*ne+nn+8);
}
function wt(t){return Math.min(1.15,0.28+0.62*Math.exp(-Math.pow((t-9)/1.4,2))+0.6*Math.exp(-Math.pow((t-18.5)/1.6,2))+0.22*Math.exp(-Math.pow((t-13)/3,2)));}
function tide(t){return Math.exp(-Math.pow((t-9)/1.8,2))-Math.exp(-Math.pow((t-18.5)/2,2));}
var DEMAND=300000;
function demandMatrix(t,boost){
  var nc=G.nc,D=new Float32Array(nc*nc),T=DEMAND*wt(t)*(boost||1)/G.Wsum,tau=tide(t);
  for(var i=0;i<nc;i++)for(var j=0;j<nc;j++){var w=G.W[i*nc+j];if(!w)continue;
    var ei=G.cemp[i],ej=G.cemp[j];var f=1+0.45*tau*(ej-ei)/(ej+ei);D[i*nc+j]=w*T*f;}
  return D;
}
// binary heap
function sssp(src,tm,dist,pred){
  var nn=G.nn,K=G.heapK,V=G.heapV,n=0;dist.fill(1e18);pred.fill(-1);dist[src]=0;
  function push(k,v){var i=n++;while(i>0){var p=(i-1)>>1;if(K[p]<=k)break;K[i]=K[p];V[i]=V[p];i=p;}K[i]=k;V[i]=v;}
  push(0,src);
  while(n>0){var k=K[0],u=V[0];n--;if(n>0){var lk=K[n],lv=V[n],i=0;while(true){var c=2*i+1;if(c>=n)break;if(c+1<n&&K[c+1]<K[c])c++;if(K[c]>=lk)break;K[i]=K[c];V[i]=V[c];i=c;}K[i]=lk;V[i]=lv;}
    if(k>dist[u])continue;
    for(var q=G.off[u];q<G.off[u+1];q++){var arc=G.arc[q],w=tm[arc];if(w>=1e9)continue;var nd=k+w,v=G.to[q];if(nd<dist[v]){dist[v]=nd;pred[v]=arc;push(nd,v);}}}
}
var _d=null,_p=null,_ord=null;
function aon(D,tm,flow){ // all-or-nothing from every centroid
  var nn=G.nn,nc=G.nc;if(!_d){_d=new Float64Array(nn);_p=new Int32Array(nn);}
  var sub=new Float64Array(nn),idx=new Int32Array(nn);
  for(var i=0;i<nc;i++){
    var any=false;for(var j=0;j<nc;j++)if(D[i*nc+j]>0){any=true;break;}if(!any)continue;
    sssp(G.cen[i],tm,_d,_p);
    sub.fill(0);for(j=0;j<nc;j++){var dj=D[i*nc+j];if(dj>0&&_d[G.cen[j]]<1e17)sub[G.cen[j]]+=dj;}
    // order nodes by dist desc
    var m=0;for(var v=0;v<nn;v++)if(_p[v]>=0)idx[m++]=v;
    var arr=Array.prototype.slice.call(idx,0,m);arr.sort(function(x,y){return _d[y]-_d[x];});
    for(var k=0;k<m;k++){v=arr[k];var arc=_p[v];flow[arc]+=sub[v];var e=arc>>1,u=(arc&1)?G.b[e]:G.a[e];sub[u]+=sub[v];}
  }
}
function arcTimes(flow,capMul){
  var tm=new Float32Array(2*G.ne);
  for(var i=0;i<G.ne;i++){var c=G.cap[i]*(capMul?capMul[i]:1);
    if(c<=0){tm[2*i]=tm[2*i+1]=1e9;continue;}
    for(var s=0;s<2;s++){var x=Math.min(2,flow[2*i+s]/c);tm[2*i+s]=G.t0[i]*(1+0.15*Math.pow(x,4));}}
  return tm;
}
// returns {flow,vc[],spd[],cost}
function assign(t,capMul,boost,iters){
  iters=iters||6;var D=demandMatrix(t,boost),na=2*G.ne;
  var flow=new Float32Array(na),tm=arcTimes(flow,capMul);aon(D,tm,flow);
  for(var it=2;it<=iters;it++){tm=arcTimes(flow,capMul);var aux=new Float32Array(na);aon(D,tm,aux);var l=1/it;for(var k=0;k<na;k++)flow[k]+=l*(aux[k]-flow[k]);}
  var vc=new Float32Array(G.ne),spd=new Float32Array(G.ne),cost=0;tm=arcTimes(flow,capMul);
  for(var i=0;i<G.ne;i++){var c=G.cap[i]*(capMul?capMul[i]:1);var f=Math.max(flow[2*i],flow[2*i+1]);
    vc[i]=c>0?f/c:9;var tt=Math.max(tm[2*i],tm[2*i+1]);spd[i]=c>0?(G.len[i]/1000)/(tt/60):0;
    cost+=(flow[2*i]*tm[2*i]+flow[2*i+1]*tm[2*i+1]);}
  return {flow:flow,vc:vc,spd:spd,cost:cost/60,t:t}; // veh-hours per hour
}
if(typeof module!=='undefined')module.exports={buildGraph:buildGraph,assign:assign,G:G,wt:wt,setDemand:function(x){DEMAND=x;}};
