// ================= panels =================
var ACT={};
function setTab(t){S.tab=t;renderTabs();renderPanel()}
function tabsFor(){var t=[['overview','overview'],['station','station'],['actions','actions'],['planner','planner'],['works','works']];if(isAdmin())t.push(['admin','admin']);return t}
function renderTabs(){var oa=openActions().length;$('tabs').innerHTML=tabsFor().map(function(t){return '<button class="tab'+(S.tab===t[0]?' on':'')+'" data-tab="'+t[0]+'">'+T(t[1])+(t[0]==='actions'&&oa?'<span class="bd">'+oa+'</span>':'')+'</button>'}).join('')}
$('tabs').onclick=function(e){var b=e.target.closest('[data-tab]');if(b)setTab(b.dataset.tab)};
$('pb').onclick=function(e){var b=e.target.closest('[data-a]');if(!b)return;var f=ACT[b.dataset.a];if(f)f(b,e)};
function renderPanel(){var f={overview:pOverview,station:pStation,actions:pActions,planner:pPlanner,works:pWorks,admin:pAdmin}[S.tab];var sc=$('pb').scrollTop;$('pb').innerHTML=f();$('pb').scrollTop=sc;if(S.tab==='overview')drawTL();if(S.tab==='admin')adminAfter();}
// ---------- helpers ----------
function scopeStations(){return ST.filter(function(s){return inScope(s.r)})}
function kpiHTML(a){return '<div class="kpis">'+a.map(function(k){return '<div class="kpi"><b'+(k[2]?' style="color:var(--bad)"':'')+'>'+k[1]+'</b><span>'+k[0]+'</span></div>'}).join('')+'</div>'}
function scopeSummary(){var r=CUR.r;if(!r)return null;var vk=0,vs=0,L=0,cl=0;for(var e=0;e<G.ne;e++){var s=ST[G.stn[e]];if(!inScope(s.r))continue;var f=Math.max(r.flow[2*e],r.flow[2*e+1]),l=G.len[e]/1000;vk+=f*l;vs+=f*l*r.spd[e];L+=l;if(r.vc[e]>0.95)cl+=l}
  return {speed:vk?vs/vk:0,cong:L?100*cl/L:0}}
function incInScope(){return CUR.inc.active.filter(function(x){return inScope(ST[x.stn].r)})}
// ---------- overview ----------
function pOverview(){
  var sm=scopeSummary(),ia=incInScope(),oa=openActions().filter(function(a){return inScope(ST[a.stn].r)}),es=oa.filter(function(a){return a.escalated}),fat=scopeStations().reduce(function(a,s){return a+s.f},0);
  var h='<h3>'+(S.scope==='All'?T('all'):T(S.scope))+' · '+fmtH(curT())+'</h3>';
  h+=kpiHTML([[T('spd'),sm?sm.speed.toFixed(0)+' km/h':'…'],[T('cong'),sm?sm.cong.toFixed(0)+'%':'…'],[T('inc'),ia.length],[T('openA'),oa.length],[T('esc'),es.length,es.length>0],[T('fat'),fat]]);
  h+='<h3>'+(S.lang==='kn'?'ದಿನದ ವೇಗ (ಮಾದರಿ) ಮತ್ತು ಮರುಪ್ರಸಾರ':'Typical day speed (model) and replay')+'</h3><canvas id="tl"></canvas>';
  h+='<div class="row sm" style="margin-top:4px"><input class="slider" id="rp" type="range" min="0" max="95" value="'+Math.round(curT()*4)+'" data-a="rp"><button class="btn sec sm" data-a="live">'+T('back')+'</button></div>';
  if(S.scope==='All'){h+='<h3>'+(S.lang==='kn'?'ವಿಭಾಗಗಳು':'Regions')+'</h3><table><tr><th></th><th class="n">'+T('spd')+'</th><th class="n">'+T('cong')+'</th><th class="n">'+T('inc')+'</th><th class="n">'+T('fat')+'</th></tr>';
    REGS.forEach(function(r){var st=ST.filter(function(s){return s.r===r}),vk=0,vs=0,cl=0,L=0;if(CUR.sum)st.forEach(function(s){var p=CUR.sum.per[s.i];if(p.speed!=null){vk+=1;vs+=p.speed}cl+=p.cong*p.L/100;L+=p.L});
      var sp=CUR.sum?avgSpeedReg(r):0;h+='<tr class="cl" data-a="scope" data-r="'+r+'"><td><b>'+T(r)+'</b> <span class="mut sm">'+st.length+'</span></td><td class="n">'+(CUR.sum?sp.toFixed(0):'…')+'</td><td class="n">'+(L?(100*cl/L).toFixed(0)+'%':'…')+'</td><td class="n">'+CUR.inc.active.filter(function(x){return ST[x.stn].r===r}).length+'</td><td class="n">'+st.reduce(function(a,s){return a+s.f},0)+'</td></tr>'});h+='</table>'}
  else{h+='<h3>'+(S.lang==='kn'?'ಠಾಣೆಗಳು':'Stations')+' ('+scopeStations().length+')</h3><table><tr><th></th><th class="n">'+T('spd')+'</th><th class="n">'+T('cong')+'</th><th class="n">'+T('fat')+'</th></tr>';
    scopeStations().sort(function(a,b){return b.f-a.f}).forEach(function(s){var p=CUR.sum&&CUR.sum.per[s.i];h+='<tr class="cl" data-a="pickst" data-i="'+s.i+'"><td>'+esc(s.n)+'</td><td class="n">'+(p&&p.speed!=null?p.speed.toFixed(0):'–')+'</td><td class="n">'+(p?p.cong.toFixed(0)+'%':'…')+'</td><td class="n">'+s.f+'</td></tr>'});h+='</table>'}
  h+='<h3>'+T('topRoads')+'</h3>'+topRoadsHTML(8);
  return h}
function avgSpeedReg(r){var vk=0,vs=0,R=CUR.r;for(var e=0;e<G.ne;e++){if(ST[G.stn[e]].r!==r)continue;var f=Math.max(R.flow[2*e],R.flow[2*e+1]),l=G.len[e]/1000;vk+=f*l;vs+=f*l*R.spd[e]}return vk?vs/vk:0}
function topRoadsHTML(n,stIdx){if(!CUR.r)return '<span class="mut">…</span>';var m={};for(var e=0;e<G.ne;e++){var nm=G.name[e];if(nm<0)continue;var s=G.stn[e];if(stIdx!=null&&s!==stIdx)continue;if(stIdx==null&&!inScope(ST[s].r))continue;var k=nm+'|'+s,o=m[k]||(m[k]={nm:nm,s:s,L:0,v:0,e:e,mx:-1});o.L+=G.len[e];if(CUR.r.vc[e]>o.mx){o.mx=CUR.r.vc[e];o.e=e}}
  var a=Object.values(m).filter(function(o){return o.L>600}).sort(function(a,b){return b.mx-a.mx}).slice(0,n);
  return '<table>'+a.map(function(o){return '<tr class="cl" data-a="pickedge" data-e="'+o.e+'"><td>'+esc(NAMES[o.nm])+'<div class="mut sm">'+esc(ST[o.s].n)+'</div></td><td class="n"><span class="tag" style="background:'+CCOL[colorFor(o.mx)]+';color:#fff;border:0">'+Math.round(CUR.r.spd[o.e])+' km/h</span></td></tr>'}).join('')+'</table>'}
ACT.scope=function(b){setScope(b.dataset.r)};
ACT.pickst=function(b){S.sel={t:'st',i:+b.dataset.i};zoomToStation(+b.dataset.i);setTab('station')};
ACT.pickedge=function(b){var e=+b.dataset.e;S.sel={t:'edge',e:e};var a=DX[M.r[e][5]],m=(a.length/4|0)*2;S.view.cx=a[m];S.view.cy=a[m+1];S.view.k=Math.max(S.view.k,0.25);dirty=true;setTab('station')};
ACT.live=function(){S.replay=null;updateClock();recompute()};
ACT.rp=function(b){S.replay=(+b.value)/4;updateClock();recomputeDebounced()};
$('pb').addEventListener('input',function(e){if(e.target.id==='rp')ACT.rp(e.target)});
function zoomToStation(i){fitBox(ST[i].box,0.25)}
function drawTL(){var c=$('tl');if(!c)return;var w=c.clientWidth,h=84,d=Math.min(2,window.devicePixelRatio||1);c.width=w*d;c.height=h*d;var g=c.getContext('2d');g.setTransform(d,0,0,d,0,0);cssv();
  var pts=TL.map(function(v,i){return v});g.strokeStyle=COL['--line'];g.fillStyle=COL['--mut'];g.font='10px Inter';
  for(var hh=0;hh<=24;hh+=6){var x=hh/24*(w-8)+4;g.beginPath();g.moveTo(x,6);g.lineTo(x,h-16);g.stroke();g.fillText(String(hh).padStart(2,'0'),x-6,h-4)}
  var have=TL.filter(function(v){return v!=null});if(!have.length){g.fillText('computing…',w/2-30,h/2);return}
  var lo=Math.min.apply(null,have)-2,hi=Math.max.apply(null,have)+2;g.beginPath();var f=true;TL.forEach(function(v,i){if(v==null)return;var x=i/24*(w-8)+4,y=6+(h-22)*(1-(v-lo)/(hi-lo));if(f){g.moveTo(x,y);f=false}else g.lineTo(x,y)});g.lineWidth=2;g.strokeStyle=COL['--acc'];g.stroke();
  var t=curT(),x=t/24*(w-8)+4;g.strokeStyle=COL['--bad'];g.lineWidth=1.5;g.beginPath();g.moveTo(x,2);g.lineTo(x,h-16);g.stroke();
  c.onclick=function(e){var r=c.getBoundingClientRect();S.replay=Math.max(0,Math.min(23.75,Math.round(((e.clientX-r.left-4)/(w-8))*96)/4));updateClock();recompute();renderPanel()}}
// ---------- station / edge ----------
function sparkSVG(v,col,w,h){var mx=Math.max.apply(null,v)||1,bw=(w-10)/v.length,s='<svg viewBox="0 0 '+w+' '+(h+24)+'" width="100%">';
  v.forEach(function(x,i){var hh=x/mx*h,xx=5+i*bw;s+='<rect x="'+(xx+3)+'" y="'+(h+10-hh)+'" width="'+(bw-6)+'" height="'+hh+'" fill="'+col+'" opacity=".85"/><text x="'+(xx+bw/2)+'" y="'+(h+8-hh)+'" font-size="9" text-anchor="middle" fill="var(--ink)">'+x+'</text><text x="'+(xx+bw/2)+'" y="'+(h+22)+'" font-size="8.5" text-anchor="middle" fill="var(--mut)">'+(2018+i)+'</text>'});return s+'</svg>'}
function pStation(){
  var h='';var e=S.sel&&S.sel.t==='edge'?S.sel.e:-1,si=S.sel?(S.sel.t==='st'?S.sel.i:G.stn[S.sel.e]):-1;
  if(si<0){h+='<p class="mut">'+(S.lang==='kn'?'ನಕ್ಷೆಯಲ್ಲಿ ಠಾಣೆ ಅಥವಾ ರಸ್ತೆಯನ್ನು ಕ್ಲಿಕ್ ಮಾಡಿ.':'Click a station territory or a road on the map.')+'</p><h3>'+T('rank')+'</h3><table>';
    scopeStations().sort(function(a,b){return b.f-a.f}).slice(0,12).forEach(function(s){h+='<tr class="cl" data-a="pickst" data-i="'+s.i+'"><td>'+esc(s.n)+'</td><td class="n">'+s.f+'</td></tr>'});return h+'</table>'}
  var s=ST[si];
  if(e>=0&&CUR.r){var r=CUR.r;h+='<h3>'+(S.lang==='kn'?'ಆಯ್ದ ರಸ್ತೆ':'Selected road')+'</h3><div class="card"><b>'+esc(edgeName(e))+'</b> <span class="tag">'+['Arterial','Sub-arterial','Collector'][G.cls[e]]+'</span><div class="row sm" style="margin-top:4px"><span>'+Math.round(r.spd[e])+' km/h</span><span>v/c '+r.vc[e].toFixed(2)+'</span><span>'+Math.round(G.len[e])+' m</span>'+(function(){var x=CUR.inc.active.filter(function(i){return i.e===e})[0];return x?'<span class="tag bad">'+esc(x.type)+'</span>':''})()+'</div>'+
    '<div class="row" style="margin-top:6px"><button class="btn sm" data-a="planedge" data-e="'+e+'">'+(S.lang==='kn'?'ಇಲ್ಲಿ ಮುಚ್ಚುವ ಯೋಜನೆ':'Plan closure here')+'</button>'+(canActOn(si)?'<button class="btn sec sm" data-a="repform" data-e="'+e+'">'+T('report')+'</button>':'')+'</div><div id="repf"></div></div>'}
  var hs=HIST[s.n],rank=ST.slice().sort(function(a,b){return b.f-a.f}).findIndex(function(x){return x.i===si})+1,p=CUR.sum&&CUR.sum.per[si];
  h+='<h3>'+esc(s.n)+' · '+T(s.r)+(s.sub!==s.r?' · '+esc(s.sub):'')+'</h3>';
  h+=kpiHTML([[T('fat'),s.f],[(S.lang==='kn'?'ಮರಣರಹಿತ 2025':'Non-fatal 2025'),s.t],[(S.lang==='kn'?'ಶ್ರೇಣಿ':'Fatal rank'),'#'+rank+' / '+ST.length],[T('spd'),p&&p.speed!=null?p.speed.toFixed(0)+' km/h':'–'],[T('cong'),p?p.cong.toFixed(0)+'%':'…'],[T('inc'),CUR.inc.active.filter(function(x){return x.stn===si}).length]]);
  if(hs){var yrs=['2018','2019','2020','2021','2022','2023','2024','2025'];h+='<h3>'+T('trend')+'</h3><div class="sm mut">'+(S.lang==='kn'?'ಮರಣಾಂತಿಕ':'Fatal')+'</div>'+sparkSVG(yrs.map(function(y){return hs[y]?hs[y][0]:0}),'var(--bad)',300,34)+'<div class="sm mut">'+(S.lang==='kn'?'ಎಲ್ಲಾ ಅಪಘಾತಗಳು':'All recorded crashes')+'</div>'+sparkSVG(yrs.map(function(y){return hs[y]?hs[y][0]+hs[y][1]:0}),'var(--acc)',300,34)}
  else h+='<p class="mut sm">'+(S.lang==='kn'?'ಈ ಠಾಣೆಗೆ ಇತಿಹಾಸ ಲಭ್ಯವಿಲ್ಲ (ಹೆಸರು ಬದಲಾವಣೆ/ಹೊಸ ಠಾಣೆ).':'No 2018–2024 history for this station (renamed or new).')+'</p>';
  var acts=openActions().filter(function(a){return a.stn===si});
  if(acts.length)h+='<h3>'+T('actions')+'</h3>'+acts.map(actCard).join('');
  h+='<h3>'+T('topRoads')+'</h3>'+topRoadsHTML(6,si);
  h+='<div class="row" style="margin-top:8px"><button class="btn sec sm" data-a="zst" data-i="'+si+'">'+(S.lang==='kn'?'ಠಾಣೆಗೆ ಜೂಮ್':'Zoom to station')+'</button><button class="btn sec sm" data-a="planst" data-i="'+si+'">'+T('planner')+'</button></div>';
  if(!canActOn(si)&&roleNow().role!=='viewer')h+='<p class="mut sm">'+(S.lang==='kn'?'ಈ ಠಾಣೆ ನಿಮ್ಮ ವ್ಯಾಪ್ತಿಯಲ್ಲಿಲ್ಲ — ವೀಕ್ಷಣೆ ಮಾತ್ರ.':'Outside your jurisdiction — view only.')+'</p>';
  return h}
ACT.zst=function(b){zoomToStation(+b.dataset.i)};
ACT.planedge=function(b){var e=+b.dataset.e;PL.st=G.stn[e];PL.road=G.name[e];PL.res=null;setTab('planner')};
ACT.planst=function(b){PL.st=+b.dataset.i;PL.road=null;PL.res=null;setTab('planner')};
ACT.repform=function(b){var e=+b.dataset.e;$('repf').innerHTML='<div class="frm"><label>Type</label><select id="rt">'+ITYPES.map(function(t,i){return '<option value="'+i+'">'+t[0]+'</option>'}).join('')+'</select><label>Min</label><input type="number" id="rd" value="40" min="10" max="240"></div><button class="btn sm" data-a="repsave" data-e="'+e+'">'+T('report')+'</button>'};
ACT.repsave=function(b){var e=+b.dataset.e,it=ITYPES[+$('rt').value],dur=Math.max(10,Math.min(240,+$('rd').value||40)),id='u'+Date.now().toString(36)+Math.floor(Math.random()*999),t=istNow();
  var ev={type:it[0],e:e,date:t.date,sh:S.replay!=null?S.replay:t.h,dur:dur,cap:it[1],by:S.me.id||'local'};S.events[id]=ev;dbSet('events/'+id,ev);audit('incident',id,it[0]+' @ '+edgeName(e));recompute();renderPanel()};
// ---------- actions ----------
var ASTATE={new:'newS',ack:'ackS',prog:'progS',done:'doneS'};
function advice(x){var e=x.e,a=G.a[e],b=G.b[e],best=-1,bv=9;
  [a,b].forEach(function(nd){for(var q=G.off[nd];q<G.off[nd+1];q++){var e2=G.arc[q]>>1;if(e2===e||G.name[e2]===G.name[e]||G.name[e2]<0)continue;var v=CUR.r?CUR.r.vc[e2]:1;if(G.cls[e2]<=2&&v<bv){bv=v;best=e2}}});
  var s='Deploy staff at '+edgeName(e)+' ('+ST[x.stn].n+')';if(best>=0)s+='; divert via '+edgeName(best)+' (v/c '+bv.toFixed(2)+')';return s+'.'}
function openActions(){var out=[],h=curT();CUR.inc.all.forEach(function(x){if(x.sh>h||x.eh<h-1.5)return;var id='A-'+x.id,st=S.acts[id]&&S.acts[id].st||'new',live=h<x.eh;
    if(!live&&st==='new')return;var esc=st==='new'&&live&&(h-x.sh)*60>15;out.push({id:id,inc:x,stn:x.stn,st:st,live:live,escalated:esc,sh:x.sh})});
  return out.filter(visibleAct).sort(function(a,b){return (b.escalated-a.escalated)||(a.live!==b.live?b.live-a.live:0)||(b.sh-a.sh)})}
function visibleAct(a){if(!inScope(ST[a.stn].r))return false;var r=roleNow();if(r.role==='station')return ST[a.stn].r===lockedRegion();if(r.role==='dcp')return ST[a.stn].r===lockedRegion();return true}
function actCard(a){var x=a.inc,can=canActOn(a.stn),st=a.st;var nxt=st==='new'?['ack','ack']:st==='ack'?['prog','start']:st==='prog'?['done','done']:null;
  var ver=st==='done'?(a.live?'<span class="tag warn">'+(S.lang==='kn'?'ಮಾಹಿತಿ ಇನ್ನೂ ತಡೆ ತೋರಿಸುತ್ತಿದೆ':'Feed still shows blockage')+'</span>':'<span class="tag ok">'+(S.lang==='kn'?'ಸಾಮಾನ್ಯ — ದೃಢೀಕೃತ':'Cleared · verified')+'</span>'):'';
  return '<div class="card'+(a.escalated?' esc':'')+(st==='done'&&!a.live?' done':'')+'"><div class="row"><b>'+esc(x.type)+'</b><span class="mut">'+esc(edgeName(x.e))+'</span><span class="sp"></span>'+(a.escalated?'<span class="tag bad">'+T('esc')+'</span>':'')+'<span class="tag">'+T(ASTATE[st])+'</span></div>'+
   '<div class="sm mut">'+esc(ST[a.stn].n)+' · '+T(ST[a.stn].r)+' · '+fmtH(x.sh)+(x.src==='sim'?' · <span class="tag sim">sim</span>':'')+'</div><div class="sm" style="margin:4px 0">'+esc(advice(x))+'</div>'+
   '<div class="row">'+(nxt&&can?'<button class="btn sm" data-a="act" data-id="'+esc(a.id)+'" data-to="'+nxt[0]+'" data-stn="'+a.stn+'">'+T(nxt[1])+'</button>':'')+(st==='done'&&a.live&&can?'<button class="btn sec sm" data-a="act" data-id="'+esc(a.id)+'" data-to="prog" data-stn="'+a.stn+'">'+T('reopen')+'</button>':'')+ver+
   '<button class="btn sec sm" data-a="pickedge" data-e="'+x.e+'">'+(S.lang==='kn'?'ನಕ್ಷೆ':'Map')+'</button></div></div>'}
function pActions(){var a=openActions(),h='';var r=roleNow().role;h+='<p class="mut sm">'+(S.lang==='kn'?'ಪಾತ್ರ':'Role')+': <b>'+esc(roleLabel())+'</b>'+(lockedRegion()?' · '+T(lockedRegion()):'')+'</p>';
  if(!a.length)return h+'<p class="mut">'+T('noAct')+'</p>';return h+a.map(actCard).join('')}
ACT.act=function(b){var id=b.dataset.id,to=b.dataset.to,stn=+b.dataset.stn;if(!canActOn(stn))return;var v={st:to,by:S.me.id||'local',at:Date.now()};S.acts[id]=v;dbSet('actions/'+id,v);audit('action',id,to+' · '+ST[stn].n);renderTabs();renderPanel();dirty=true};
function roleLabel(){var r=roleNow().role;return {admin:T('admin_'),commissioner:T('commissioner'),dcp:T('dcp'),station:T('stationR'),viewer:T('viewer')}[r]}
// ---------- planner ----------
var PL={st:null,road:null,res:null,busy:false,sel:null};
var WIN=[['peakAM',9.0],['mid',13.0],['peakPM',18.5],['night',23.5]];
function roadsIn(si){var out=[];Object.keys(ROADIDX).forEach(function(n){var es=ROADIDX[n][si];if(es){var L=0;es.forEach(function(e){L+=G.len[e]});if(L>400)out.push([+n,L])}});return out.sort(function(a,b){return b[1]-a[1]})}
function pPlanner(){
  var h='<p class="mut sm">'+(S.lang==='kn'?'ಒಂದು ರಸ್ತೆ ಭಾಗವನ್ನು ಮುಚ್ಚಿದರೆ ಇಡೀ ನಗರದ ಮೇಲೆ ಪರಿಣಾಮ — ನೈಜ ರಸ್ತೆ ಜಾಲದಲ್ಲಿ ಮಾದರಿ.':'Close or restrict a road segment and see the city-wide effect on the real road network, by time of day.')+'</p>';
  if(PL.st==null)PL.st=S.sel?(S.sel.t==='st'?S.sel.i:G.stn[S.sel.e]):(scopeStations()[0]||ST[0]).i;
  var rs=roadsIn(PL.st);if(PL.road==null||!rs.some(function(r){return r[0]===PL.road}))PL.road=rs.length?rs[0][0]:null;
  h+='<div class="frm"><label>'+T('station')+'</label><select data-a="plst" id="plst">'+ST.slice().sort(function(a,b){return a.n<b.n?-1:1}).map(function(s){return '<option value="'+s.i+'"'+(s.i===PL.st?' selected':'')+'>'+esc(s.n)+'</option>'}).join('')+'</select>'+
    '<label>'+(S.lang==='kn'?'ರಸ್ತೆ':'Road')+'</label><select id="plrd">'+rs.map(function(r){return '<option value="'+r[0]+'"'+(r[0]===PL.road?' selected':'')+'>'+esc(NAMES[r[0]])+' ('+(r[1]/1000).toFixed(1)+' km)</option>'}).join('')+'</select></div>';
  h+='<button class="btn" data-a="plrun"'+(PL.busy||PL.road==null?' disabled':'')+'>'+(PL.busy?T('computing'):T('run'))+'</button>';
  if(PL.busy)h+='<div class="bar" style="margin-top:8px"><i style="width:'+PL.prog+'%"></i></div>';
  if(PL.res){var R=PL.res;h+='<h3>'+T('addedVeh')+'</h3><table class="mx"><tr><td class="h"></td>'+WIN.map(function(w){return '<td class="h">'+T(w[0])+'<br>'+fmtH(w[1])+'</td>'}).join('')+'</tr>';
    [['close','close'],['half','half']].forEach(function(o){h+='<tr><td class="h">'+T(o[1])+'</td>'+WIN.map(function(w){var c=R.cells[o[0]+w[0]],mx=R.max||1,u=Math.min(1,Math.max(0,c.d)/mx);return '<td data-a="plcell" data-k="'+o[0]+w[0]+'" style="background:rgba(217,54,54,'+(0.12+0.6*u).toFixed(2)+');'+(PL.sel===o[0]+w[0]?'outline:2px solid var(--acc)':'')+'">'+(c.d<0.5?'≈0':Math.round(c.d))+'</td>'}).join('')+'</tr>'});h+='</table>';
    var best=WIN.map(function(w){return [w,R.cells['close'+w[0]].d]}).sort(function(a,b){return a[1]-b[1]})[0];
    h+='<div class="warnbox"><b>'+T('advice')+':</b> '+esc(NAMES[R.road])+', '+esc(ST[R.st].n)+' — '+(S.lang==='kn'?'ಕನಿಷ್ಠ ಪರಿಣಾಮದ ಸಮಯ: ':'least-disruptive window for a full closure: ')+'<b>'+T(best[0][0])+'</b> ('+Math.round(best[1])+' '+(S.lang==='kn'?'ವಾಹನ-ಗಂ/ಗಂ':'veh-h/h')+') vs <b>'+Math.round(R.cells.closepeakAM.d)+'</b> '+(S.lang==='kn'?'ಬೆಳಗಿನ ಗರಿಷ್ಠ':'in the morning peak')+'. '+(R.cells.halfpeakAM.d<R.cells.closepeakAM.d*0.4?(S.lang==='kn'?'ಒಂದು ಪಥ ಉಳಿಸಿದರೆ ಪರಿಣಾಮ ಬಹಳ ಕಡಿಮೆ.':'Keeping one lane open cuts the peak impact sharply.'):'')+'</div>';
    if(PL.sel){var c=R.cells[PL.sel];h+='<h3>'+T('diverted')+'</h3><table><tr><th></th><th class="n">+veh/h</th><th class="n">'+T('fat')+'</th></tr>'+c.div.map(function(d){return '<tr class="cl" data-a="pickedge" data-e="'+d.e+'"><td>'+esc(edgeName(d.e))+'<div class="mut sm">'+esc(ST[G.stn[d.e]].n)+'</div></td><td class="n">+'+Math.round(d.up)+'</td><td class="n">'+ST[G.stn[d.e]].f+'</td></tr>'}).join('')+'</table><p class="mut sm">'+(S.lang==='kn'?'ಮರಣಾಂತಿಕ ಅಪಘಾತ = ಆ ಠಾಣೆಯ 2025ರ ನೈಜ ಸಂಖ್ಯೆ.':'Fatal column is the real 2025 count for that road’s police station — diversions into already-dangerous areas are visible.')+'</p>'}
    else h+='<p class="mut sm">'+(S.lang==='kn'?'ವಿವರಕ್ಕೆ ಕೋಶ ಕ್ಲಿಕ್ ಮಾಡಿ.':'Click a cell to see where the traffic goes.')+'</p>'}
  return h}
document.addEventListener('change',function(e){if(e.target.id==='plst'){PL.st=+e.target.value;PL.road=null;PL.res=null;renderPanel()}if(e.target.id==='plrd'){PL.road=+e.target.value;PL.res=null}});
ACT.plcell=function(b){PL.sel=b.dataset.k;renderPanel()};
ACT.plrun=function(){var es=ROADIDX[PL.road]&&ROADIDX[PL.road][PL.st];if(!es||PL.busy)return;PL.busy=true;PL.prog=0;PL.res=null;renderPanel();
  var jobs=[];WIN.forEach(function(w){jobs.push({k:'base'+w[0],h:w[1],cap:null});[['close',0],['half',0.5]].forEach(function(o){var cm=new Float32Array(G.ne);cm.fill(1);es.forEach(function(e){cm[e]=o[1]});jobs.push({k:o[0]+w[0],h:w[1],cap:cm})})});
  var out={},i=0;(function nx(){if(i>=jobs.length){var cells={},mx=0;WIN.forEach(function(w){var b=out['base'+w[0]];['close','half'].forEach(function(o){var r=out[o+w[0]],d=r.cost-b.cost;var dv=[];for(var e=0;e<G.ne;e++){var f1=r.flow[2*e]+r.flow[2*e+1],f0=b.flow[2*e]+b.flow[2*e+1];if(f1-f0>30&&es.indexOf(e)<0)dv.push({e:e,up:f1-f0})}dv.sort(function(a,b){return b.up-a.up});
      var seen={},dd=[];dv.forEach(function(x){var k=G.name[x.e]+'|'+G.stn[x.e];if(!seen[k]&&dd.length<8){seen[k]=1;dd.push(x)}});cells[o+w[0]]={d:d,div:dd};if(d>mx)mx=d})});
      PL.res={cells:cells,max:mx,road:PL.road,st:PL.st};PL.sel='closepeakAM';PL.busy=false;renderPanel();return}
    var j=jobs[i++];PL.prog=Math.round(i/jobs.length*100);var bar=document.querySelector('.bar i');if(bar)bar.style.width=PL.prog+'%';
    evalAsync(j.h,j.cap,5).then(function(r){out[j.k]=r;nx()})})()};
