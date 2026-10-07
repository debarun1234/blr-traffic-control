// ================= map renderer =================
var cv=$('cv'),ctx=cv.getContext('2d'),DPR=1,CUR={r:null,sum:null,inc:{all:[],active:[]},h:0,busy:false},dirty=true,HOV=null,COL={};
var RT=[];for(var i=0;i<N;i++)if(M.d[i][4]>=0)RT.push(i);
function cssv(){var cs=getComputedStyle(document.documentElement);['--map','--land','--ink','--mut','--line','--acc','--road0','--road3','--noFeed','--bad','--pan','--warn'].forEach(function(k){COL[k]=cs.getPropertyValue(k).trim()})}
function resize(){var w=$('mapw');DPR=Math.min(2,window.devicePixelRatio||1);S.W=w.clientWidth;S.H=w.clientHeight;cv.width=S.W*DPR;cv.height=S.H*DPR;dirty=true}
function fitBox(b,pad,instant){pad=pad||0.08;var bw=(b[2]-b[0])*(1+pad*2),bh=(b[3]-b[1])*(1+pad*2);var k=Math.min(S.W/bw,S.H/bh),cx=(b[0]+b[2])/2,cy=(b[1]+b[3])/2;
  if(instant||!S.W){S.view={cx:cx,cy:cy,k:k};dirty=true;return}
  var v0={cx:S.view.cx,cy:S.view.cy,k:S.view.k},t0=performance.now();(function st(){var u=Math.min(1,(performance.now()-t0)/350);u=u*u*(3-2*u);
   S.view={cx:v0.cx+(cx-v0.cx)*u,cy:v0.cy+(cy-v0.cy)*u,k:v0.k*Math.pow(k/v0.k,u)};dirty=true;if(u<1)requestAnimationFrame(st)})()}
function sx(x){return (x-S.view.cx)*S.view.k+S.W/2}function sy(y){return S.H/2-(y-S.view.cy)*S.view.k}
function wx(px){return (px-S.W/2)/S.view.k+S.view.cx}function wy(py){return (S.H/2-py)/S.view.k+S.view.cy}
function ringPath(rings){rings.forEach(function(r){ctx.moveTo(sx(r[0][0]),sy(r[0][1]));for(var i=1;i<r.length;i++)ctx.lineTo(sx(r[i][0]),sy(r[i][1]));ctx.closePath()})}
function speedCol(v){return v==null?null:v<14?'#d93636':v<20?'#ef7b22':v<27?'#f2b01e':v<34?'#8bc34a':'#2e9e5b'}
function regAlpha(ri){if(S.scope==='All')return 1;var lr=lockedRegion();return ri===RIDX[S.scope]?1:(lr?0.07:0.2)}
function visItem(i,x0,y0,x1,y1){return !(DB[4*i+2]<x0||DB[4*i]>x1||DB[4*i+3]<y0||DB[4*i+1]>y1)}
var BUCK=null;
function draw(){
  dirty=false;cssv();var k=S.view.k,W=S.W,H=S.H;ctx.setTransform(DPR,0,0,DPR,0,0);ctx.fillStyle=COL['--map'];ctx.fillRect(0,0,W,H);
  ctx.beginPath();ringPath(M.city);ctx.fillStyle=COL['--land'];ctx.fill();
  // territory shading
  if(S.layers.shade!=='none'){ST.forEach(function(s,i){var a=regAlpha(s.ri);var col,al;
    if(S.layers.shade==='crash'){col='#d93636';al=Math.min(0.6,s.f/26*0.6)}else{var sp=CUR.sum&&CUR.sum.per[i].speed;col=speedCol(sp);al=0.38}
    if(!col)return;ctx.globalAlpha=al*a;ctx.beginPath();ringPath(s.poly);ctx.fillStyle=col;ctx.fill()});ctx.globalAlpha=1}
  // dim outside scope region
  if(S.scope!=='All'){ctx.beginPath();ringPath(M.city);ringPath(M.reg[S.scope]);ctx.fillStyle=COL['--map'];ctx.globalAlpha=0.6;ctx.fill('evenodd');ctx.globalAlpha=1}
  // station boundaries
  ctx.lineWidth=0.7;ctx.strokeStyle=COL['--line'];ST.forEach(function(s){ctx.globalAlpha=0.9*regAlpha(s.ri);ctx.beginPath();ringPath(s.poly);ctx.stroke()});ctx.globalAlpha=1;
  // roads
  var x0=wx(0),x1=wx(W),y0=wy(H),y1=wy(0),sc=Math.min(2.4,Math.max(0.8,Math.pow(k/0.06,0.4)));
  var WD=[3.1,2.3,1.5,0.8],showMinor=S.layers.minor&&k>0.11;
  function pass(alphaFn){
    var B=[];for(var c=0;c<4;c++){B.push([[],[],[],[],[],[],[]])}// per class: 6 colors + noFeed(6)
    for(var i=0;i<N;i++){if(!visItem(i,x0,y0,x1,y1))continue;var d=M.d[i],c=d[0];if(c===3&&!showMinor)continue;
      var ra=DREG[i];var al=ra<0?1:regAlpha(ra);var bk=al>=1?0:1;if(alphaFn!==bk)continue;
      var b;if(d[4]>=0){b=S.layers.cong&&CUR.r?colorFor(CUR.r.vc[d[4]]):6}else b=6;B[c][b].push(i)}
    return B}
  [1,0].forEach(function(bk){var B=pass(bk);ctx.globalAlpha=bk?0.2:1;ctx.lineCap='round';ctx.lineJoin='round';
    for(var c=3;c>=0;c--)for(var b=0;b<7;b++){var L=B[c][b];if(!L.length)continue;
      ctx.beginPath();for(var q=0;q<L.length;q++){var a=DX[L[q]];ctx.moveTo(sx(a[0]),sy(a[1]));for(var j=2;j<a.length;j+=2)ctx.lineTo(sx(a[j]),sy(a[j+1]))}
      var col;if(b<6&&S.layers.cong&&CUR.r)col=CCOL[b];else if(b===6)col=c===3?COL['--road3']:(c<=2&&S.layers.cong?COL['--noFeed']:COL['--road0']);else col=COL['--road0'];
      ctx.strokeStyle=col;ctx.lineWidth=WD[c]*sc*(b>=3&&b<6?1.25:1);ctx.stroke()}});
  ctx.globalAlpha=1;
  // region borders
  ctx.lineWidth=2;ctx.strokeStyle=COL['--acc'];REGS.forEach(function(r){ctx.globalAlpha=(S.scope==='All'||S.scope===r)?0.75:0.25;ctx.beginPath();ringPath(M.reg[r]);ctx.stroke()});ctx.globalAlpha=1;
  ctx.lineWidth=1.6;ctx.strokeStyle=COL['--ink'];ctx.beginPath();ringPath(M.city);ctx.stroke();
  // selection
  if(S.sel){if(S.sel.t==='st'||S.sel.t==='edge'){var si=S.sel.t==='st'?S.sel.i:G.stn[S.sel.e];ctx.lineWidth=3;ctx.strokeStyle=COL['--acc'];ctx.beginPath();ringPath(ST[si].poly);ctx.stroke()}
    if(S.sel.t==='edge'){hl(S.sel.e,COL['--acc'],6)}}
  if(HOV&&HOV.e>=0)hl(HOV.e,COL['--ink'],4);
  // road names
  if(k>0.16){ctx.font='10px '+(S.lang==='kn'?'Noto Sans Kannada,':'')+'Inter,sans-serif';ctx.textAlign='center';ctx.fillStyle=COL['--ink'];var placed=[],cnt=0,byName={};
    for(var q=0;q<RT.length&&cnt<45;q++){var i=RT[q],d=M.d[i];if(d[1]<0||d[0]>(k>0.35?2:1)||!visItem(i,x0,y0,x1,y1))continue;if(DREG[i]>=0&&regAlpha(DREG[i])<1)continue;
      var a=DX[i];var m=(a.length/4|0)*2;var px=sx(a[m]),py=sy(a[m+1]);if(px<30||px>W-30||py<10||py>H-10)continue;var tw=ctx.measureText(NAMES[d[1]]).width,ok=true;
      var bn=byName[d[1]]||[];for(var z=0;z<bn.length;z++)if(Math.hypot(bn[z][0]-px,bn[z][1]-py)<260){ok=false;break}
      if(ok)for(z=0;z<placed.length;z++){var p=placed[z];if(Math.abs(p[0]-px)<(p[2]+tw)/2+6&&Math.abs(p[1]-py)<13){ok=false;break}}
      if(!ok)continue;placed.push([px,py,tw]);(byName[d[1]]=bn).push([px,py]);cnt++;
      ctx.lineWidth=3;ctx.strokeStyle=COL['--land'];ctx.strokeText(NAMES[d[1]],px,py);ctx.fillText(NAMES[d[1]],px,py)}}
  // stations
  if(S.layers.stn){var big=(S.scope!=='All'||k>0.1);ctx.textAlign='left';ST.forEach(function(s,i){var a=regAlpha(s.ri);if(a<0.5)return;var px=sx(s.x),py=sy(s.y);if(px<-20||px>W+20||py<-20||py>H+20)return;
      ctx.globalAlpha=a;ctx.beginPath();ctx.arc(px,py,i===myStation()?5.5:3.4,0,7);ctx.fillStyle=i===myStation()?COL['--acc']:COL['--ink'];ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle=COL['--land'];ctx.stroke();
      if(big||s.f>=14){ctx.font='600 11px '+(S.lang==='kn'?'Noto Sans Kannada,':'')+'Inter,sans-serif';ctx.lineWidth=3;ctx.strokeStyle=COL['--land'];ctx.strokeText(s.n,px+6,py+4);ctx.fillStyle=COL['--ink'];ctx.fillText(s.n,px+6,py+4)}});ctx.globalAlpha=1}
  // region labels (city view)
  if(S.scope==='All'&&k<0.1){ctx.textAlign='center';ctx.font='700 15px Inter,sans-serif';REGS.forEach(function(r){var b=REGBOX[r];ctx.fillStyle=COL['--acc'];ctx.globalAlpha=0.7;ctx.fillText(T(r).toUpperCase(),sx((b[0]+b[2])/2),sy((b[1]+b[3])/2))});ctx.globalAlpha=1}
  // hubs
  M.hubs.forEach(function(h){var px=sx(h.x),py=sy(h.y);ctx.save();ctx.translate(px,py);ctx.rotate(Math.PI/4);ctx.fillStyle=COL['--warn'];ctx.fillRect(-3.5,-3.5,7,7);ctx.restore()});
  // incidents
  CUR.inc.active.forEach(function(x){var a=DX[M.r[x.e][5]],m=(a.length/4|0)*2,px=sx(a[m]),py=sy(a[m+1]);if(px<-20||px>W+20||py<-20||py>H+20)return;var rg=ST[x.stn].ri;ctx.globalAlpha=regAlpha(rg)<1?0.3:1;
    ctx.beginPath();ctx.arc(px,py,8,0,7);ctx.fillStyle=COL['--bad'];ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();ctx.fillStyle='#fff';ctx.font='700 11px Inter';ctx.textAlign='center';ctx.fillText('!',px,py+4);ctx.globalAlpha=1});
  // scale bar
  var m100=1000/2.2*k;var tot=m100>120?(m100>1000?5000/2.2*k:1000/2.2*k):0;var km=m100>120?1:5;var pxl=km*1000/2.2*k;ctx.fillStyle=COL['--ink'];ctx.textAlign='left';ctx.font='11px Inter';
  var bx=W-pxl-16,by=H-72;if(window.innerWidth>860){ctx.fillRect(bx,by,pxl,2);ctx.fillText(km+' km',bx,by-4)}
}
function hl(e,col,w){var a=DX[M.r[e][5]];ctx.beginPath();ctx.moveTo(sx(a[0]),sy(a[1]));for(var j=2;j<a.length;j+=2)ctx.lineTo(sx(a[j]),sy(a[j+1]));ctx.strokeStyle=col;ctx.lineWidth=w;ctx.globalAlpha=0.9;ctx.stroke();ctx.globalAlpha=1}
// ---- picking ----
function segDist(px,py,ax,ay,bx,by){var dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy,t=l?((px-ax)*dx+(py-ay)*dy)/l:0;t=t<0?0:t>1?1:t;var qx=ax+t*dx-px,qy=ay+t*dy-py;return qx*qx+qy*qy}
function pickEdge(mx,my,tol){var x0=wx(mx-tol),x1=wx(mx+tol),y1=wy(my-tol),y0=wy(my+tol),best=-1,bd=tol*tol;
  for(var q=0;q<RT.length;q++){var i=RT[q];if(!visItem(i,x0,y0,x1,y1))continue;var ra=DREG[i];if(ra>=0&&regAlpha(ra)<0.5)continue;var a=DX[i];
    for(var j=0;j+3<a.length;j+=2){var d=segDist(mx,my,sx(a[j]),sy(a[j+1]),sx(a[j+2]),sy(a[j+3]));if(d<bd){bd=d;best=M.d[i][4]}}}
  return best}
// ---- interaction ----
var ptrs={},moved=0,lastPinch=0;
cv.addEventListener('pointerdown',function(e){cv.setPointerCapture(e.pointerId);ptrs[e.pointerId]={x:e.clientX,y:e.clientY};moved=0;cv.classList.add('drag');var ks=Object.keys(ptrs);if(ks.length==2){var a=ptrs[ks[0]],b=ptrs[ks[1]];lastPinch=Math.hypot(a.x-b.x,a.y-b.y)}});
cv.addEventListener('pointermove',function(e){var p=ptrs[e.pointerId];var r=cv.getBoundingClientRect();
  if(p){var ks=Object.keys(ptrs);
    if(ks.length==2){var a=ptrs[ks[0]],b=ptrs[ks[1]];p.x=e.clientX;p.y=e.clientY;var d=Math.hypot(a.x-b.x,a.y-b.y);if(lastPinch){zoomAt((a.x+b.x)/2-r.left,(a.y+b.y)/2-r.top,d/lastPinch)}lastPinch=d;moved=99}
    else{var dx=e.clientX-p.x,dy=e.clientY-p.y;moved+=Math.abs(dx)+Math.abs(dy);S.view.cx-=dx/S.view.k;S.view.cy+=dy/S.view.k;p.x=e.clientX;p.y=e.clientY;dirty=true;hideTip()}}
  else hover(e.clientX-r.left,e.clientY-r.top,e)});
cv.addEventListener('pointerup',function(e){var wasClick=moved<5&&ptrs[e.pointerId]&&Object.keys(ptrs).length==1;delete ptrs[e.pointerId];lastPinch=0;if(!Object.keys(ptrs).length)cv.classList.remove('drag');
  if(wasClick){var r=cv.getBoundingClientRect();clickAt(e.clientX-r.left,e.clientY-r.top)}});
cv.addEventListener('pointercancel',function(e){delete ptrs[e.pointerId];cv.classList.remove('drag')});
cv.addEventListener('pointerleave',function(){HOV=null;hideTip();dirty=true});
cv.addEventListener('wheel',function(e){e.preventDefault();var r=cv.getBoundingClientRect();zoomAt(e.clientX-r.left,e.clientY-r.top,Math.exp(-e.deltaY*0.0015))},{passive:false});
cv.addEventListener('dblclick',function(e){var r=cv.getBoundingClientRect();zoomAt(e.clientX-r.left,e.clientY-r.top,2)});
function zoomAt(px,py,f){var k0=S.view.k,k1=Math.max(0.02,Math.min(4,k0*f));var wx0=wx(px),wy0=wy(py);S.view.k=k1;S.view.cx=wx0-(px-S.W/2)/k1;S.view.cy=wy0+(py-S.H/2)/k1;dirty=true}
$('zi').onclick=function(){zoomAt(S.W/2,S.H/2,1.6)};$('zo').onclick=function(){zoomAt(S.W/2,S.H/2,1/1.6)};$('zf').onclick=function(){fitScope()};
function fitScope(){fitBox(REGBOX[S.scope]||REGBOX.All,0.06)}
function hideTip(){$('tip').style.display='none'}
var hovPending=false;
function hover(mx,my,ev){if(hovPending)return;hovPending=true;requestAnimationFrame(function(){hovPending=false;
  var e=pickEdge(mx,my,7),tip=$('tip');var prev=HOV&&HOV.e;HOV={e:e};if(prev!==e)dirty=true;
  var x=wx(mx),y=wy(my),si=stAt(x,y),h='';
  if(e>=0&&CUR.r){var vc=CUR.r.vc[e],sp=CUR.r.spd[e];h='<b>'+esc(edgeName(e))+'</b><br>'+Math.round(sp)+' km/h · v/c '+vc.toFixed(2)+'<br><span class="mut">'+esc(ST[G.stn[e]].n)+' · '+T(ST[G.stn[e]].r)+'</span>'}
  else if(si>=0){h='<b>'+esc(ST[si].n)+'</b><br><span class="mut">'+T(ST[si].r)+' · '+T('fat')+': '+ST[si].f+'</span>'}
  if(h&&regAlpha(si>=0?ST[si].ri:0)>0.5){tip.innerHTML=h;tip.style.display='block';var r=$('mapw').getBoundingClientRect();tip.style.left=Math.min(mx+14,S.W-200)+'px';tip.style.top=Math.min(my+14,S.H-70)+'px'}else hideTip()})}
function clickAt(mx,my){var e=pickEdge(mx,my,9);
  if(e>=0){S.sel={t:'edge',e:e};setTab('station')}
  else{var si=stAt(wx(mx),wy(my));if(si>=0&&regAlpha(ST[si].ri)>0.5){S.sel={t:'st',i:si};setTab('station')}else S.sel=null}
  dirty=true;renderPanel()}
function loop(){if(dirty)draw();requestAnimationFrame(loop)}
