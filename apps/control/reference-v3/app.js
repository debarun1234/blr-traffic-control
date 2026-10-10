// ================= app shell =================
var TL=new Array(24).fill(null);
function setScope(s){var lr=lockedRegion();if(lr)s=lr;S.scope=s;S.sel=null;renderHeader();fitScope();renderPanel();dirty=true}
function renderHeader(){
  $('ttl').textContent=T('ttl');$('sub').textContent=T('sub');document.body.classList.toggle('kn',S.lang==='kn');$('lang').textContent=S.lang==='kn'?'English':'ಕನ್ನಡ';
  var lr=lockedRegion(),opts=lr?[lr]:['All'].concat(REGS);
  $('scopes').innerHTML=opts.map(function(r){return '<button class="chip'+(S.scope===r?' on':'')+'" data-s="'+r+'">'+T(r==='All'?'all':r)+'</button>'}).join('');
  var r=roleNow();var el=$('role');el.innerHTML='';var sp=document.createElement('span');sp.textContent=roleLabel()+(lockedRegion()?' · '+T(lockedRegion()):'')+(myStation()>=0?' · '+ST[myStation()].n:'');el.appendChild(sp);
  if(S.me.owner||S.me.canEdit||!S.dbOK){var sel=document.createElement('select');sel.id='viewas';sel.style.cssText='margin-left:6px;padding:1px 3px;font-size:11px';sel.title=T('viewas');
    [['','↺'],['commissioner',T('commissioner')],['dcp',T('dcp')+' · North'],['station',T('stationR')+' · Yelahanka'],['viewer',T('viewer')]].forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=(o[0]?T('viewas')+': ':T('viewas')+' …')+(o[0]?o[1]:'');if((S.viewAs&&S.viewAs.role)===o[0]||(!S.viewAs&&!o[0]))op.selected=true;sel.appendChild(op)});
    sel.onchange=function(){var v=sel.value;S.viewAs=!v?null:v==='dcp'?{role:'dcp',region:'North'}:v==='station'?{role:'station',station:'Yelahanka',region:'North'}:{role:v};var l=lockedRegion();if(l)S.scope=l;if(!l&&S.scope!=='All')S.scope=S.scope;renderHeader();renderTabs();renderPanel();fitScope()};el.appendChild(sel)}
  updateClock();renderTools();renderTabs()}
$('scopes').onclick=function(e){var b=e.target.closest('[data-s]');if(b)setScope(b.dataset.s)};
$('lang').onclick=function(){S.lang=S.lang==='kn'?'en':'kn';try{localStorage.setItem('blr_lang',S.lang)}catch(e){}renderHeader();renderPanel();dirty=true};
function updateClock(){var t=istNow();$('clock').textContent=(S.replay!=null?fmtH(S.replay):fmtH(t.h))+' IST';var p=$('live');p.classList.toggle('rep',S.replay!=null);$('livet').textContent=S.replay!=null?T('replay'):T('live')}
function renderTools(){var L=S.layers,el=$('tools');
  el.innerHTML='<input type="search" id="q" placeholder="'+esc(T('search'))+'" style="width:170px"><div id="qres" style="position:absolute;top:44px;left:8px;background:var(--pan);border:1px solid var(--line);border-radius:6px;display:none;z-index:6;max-height:240px;overflow:auto;min-width:200px"></div>'+
   '<label class="sm"><input type="checkbox" id="lc"'+(L.cong?' checked':'')+'> '+T('cLay')+'</label><label class="sm"><input type="checkbox" id="lm"'+(L.minor?' checked':'')+'> '+T('minor')+'</label><label class="sm"><input type="checkbox" id="ls"'+(L.stn?' checked':'')+'> '+T('stn')+'</label>'+
   '<select id="lsh"><option value="none"'+(L.shade==='none'?' selected':'')+'>'+T('none')+'</option><option value="crash"'+(L.shade==='crash'?' selected':'')+'>'+T('crash')+'</option><option value="speed"'+(L.shade==='speed'?' selected':'')+'>'+T('spdShade')+'</option></select>';
  $('lc').onchange=function(){L.cong=this.checked;dirty=true};$('lm').onchange=function(){L.minor=this.checked;dirty=true};$('ls').onchange=function(){L.stn=this.checked;dirty=true};$('lsh').onchange=function(){L.shade=this.value;dirty=true};
  var q=$('q'),res=$('qres');q.oninput=function(){var v=q.value.trim().toLowerCase();if(v.length<2){res.style.display='none';return}var h='';
    ST.filter(function(s){return s.n.toLowerCase().indexOf(v)>=0&&inScopeAny(s)}).slice(0,6).forEach(function(s){h+='<div class="cl" style="padding:5px 9px;cursor:pointer" data-st="'+s.i+'">'+esc(s.n)+' <span class="mut sm">'+T(s.r)+'</span></div>'});
    var seen={};NAMES.forEach(function(n,i){if(n.toLowerCase().indexOf(v)>=0&&ROADIDX[i]&&!seen[n]&&Object.keys(ROADIDX[i]).length){seen[n]=1;if(Object.keys(seen).length<=6)h+='<div class="cl" style="padding:5px 9px;cursor:pointer" data-rd="'+i+'">'+esc(n)+' <span class="mut sm">road</span></div>'}});
    res.innerHTML=h||'<div style="padding:6px 9px" class="mut">–</div>';res.style.display='block'};
  res.onclick=function(e){var a=e.target.closest('[data-st]'),b=e.target.closest('[data-rd]');if(a){var i=+a.dataset.st;S.sel={t:'st',i:i};zoomToStation(i);setTab('station')}
    if(b){var n=+b.dataset.rd,bx=[1e9,1e9,-1e9,-1e9],es=[];Object.keys(ROADIDX[n]).forEach(function(s){if(inScopeAny(ST[+s]))es=es.concat(ROADIDX[n][s])});es.forEach(function(e2){var d=M.r[e2][5];bx[0]=Math.min(bx[0],DB[4*d]);bx[1]=Math.min(bx[1],DB[4*d+1]);bx[2]=Math.max(bx[2],DB[4*d+2]);bx[3]=Math.max(bx[3],DB[4*d+3])});if(es.length){S.sel={t:'edge',e:es[0]};fitBox(bx,0.15);setTab('station')}}
    res.style.display='none';q.value=''};
  var lg=$('legend');lg.innerHTML='<b>'+T('legendT')+'</b>'+['0.4','0.7','0.9','1.05','1.3','1.6+'].map(function(v,i){return '<div class="lg"><i style="background:'+CCOL[i]+'"></i>'+['>34','27–34','20–27','14–20','<14','gridlock'][i]+' km/h</div>'}).join('')+'<div class="lg"><i style="background:var(--noFeed)"></i>'+T('nofeed')+'</div><div class="lg"><span style="color:var(--bad);font-weight:700">●</span> '+T('inc')+' &nbsp;<span style="color:var(--warn)">◆</span> hub</div>';
  $('note').textContent=T('note')}
function inScopeAny(s){var lr=lockedRegion();return !lr||s.r===lr}
// ---- recompute live state ----
var rcTimer=null,lastKey='';
function recomputeDebounced(){clearTimeout(rcTimer);rcTimer=setTimeout(recompute,120)}
function recompute(){var h=curT(),inc=incidentsAt(h),cm=capFor(h),key=Math.round(h*4)+'|'+capKey(cm);CUR.inc=inc;lastKey=key;
  evalAsync(h,cm).then(function(r){if(lastKey!==key)return;CUR.r=r;CUR.sum=summarize(r);CUR.h=h;dirty=true;renderTabs();if(!document.activeElement||document.activeElement.id!=='rp')renderPanel()})}
function tick(){updateClock();if(S.replay==null){var h=curT(),cm=capFor(h),key=Math.round(h*4)+'|'+capKey(cm);if(key!==lastKey){recompute()}}}
// ---- typical-day timeline ----
function buildTL(){var h=0;(function nx(){if(h>=24){return}var hh=h++;evalAsync(hh+0.0,null,4).then(function(r){var vk=0,vs=0;for(var e=0;e<G.ne;e++){var f=Math.max(r.flow[2*e],r.flow[2*e+1]),l=G.len[e]/1000;vk+=f*l;vs+=f*l*r.spd[e]}TL[hh]=vk?vs/vk:null;if(S.tab==='overview'&&hh%4===3)drawTL();setTimeout(nx,900)})})()}
// ---- shared data ----
function dbSet(path,data){if(!S.db)return;S.db.doc(path).set(data).catch(function(e){S.writeErr=e&&e.code;flash('Not saved: '+(e&&e.code||'error')+' — you may need Contributor access.')})}
function dbDel(path){if(!S.db)return;S.db.doc(path).delete().catch(function(){})}
function audit(kind,target,txt){var o={t:Date.now(),who:S.me.id||'local',kind:kind,target:target,txt:String(txt||'').slice(0,120)};S.audit.unshift(o);S.audit=S.audit.slice(0,60);if(S.db)S.db.collection('audit').add(o).catch(function(){})}
function flash(m){var d=document.createElement('div');d.textContent=m;d.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--ink);color:var(--pan);padding:8px 14px;border-radius:8px;z-index:20;font-size:12px';document.body.appendChild(d);setTimeout(function(){d.remove()},4000)}
var rdT=null;function softRender(){clearTimeout(rdT);rdT=setTimeout(function(){renderHeader();var l=lockedRegion();if(l&&S.scope!==l){S.scope=l;fitScope()}if(!document.activeElement||!/^(INPUT|SELECT)$/.test(document.activeElement.tagName))renderPanel();recomputeDebounced();dirty=true},200)}
function snapMap(snap){var o={};snap.docs.forEach(function(d){o[d.id]=d.data()});return o}
async function initData(){
  var cl=window.claude;if(!cl||!cl.use){renderHeader();return}
  try{var u=await cl.use('user');if(u){S.userCap=u;var me=await u.me();S.me={id:me.id,name:me.name,owner:me.isOwner,canEdit:me.canEdit};S.canWrite=await u.can('data.write')}}catch(e){}
  try{var db=await cl.use('db');if(db){S.db=db;S.dbOK=true;
    var sub=function(path,key,fn){try{db.collection(path).onSnapshot(function(s){S[key]=fn?fn(s):snapMap(s);softRender()},function(){})}catch(e){}};
    sub('users','users');sub('reg','reg');sub('actions','acts');sub('events','events');sub('works','works');
    try{db.collection('audit').orderBy('t','desc').limit(40).onSnapshot(function(s){S.audit=s.docs.map(function(d){return d.data()});softRender()},function(){})}catch(e){}
    setTimeout(function(){if(S.me.id&&!S.users[S.me.id]&&!S.reg[S.me.id]&&S.canWrite!==false&&!(S.me.owner||S.me.canEdit)){db.doc('reg/'+S.me.id).set({t:Date.now()}).catch(function(){})}},2500)}}catch(e){}
  renderHeader();renderPanel()}
// ---- init ----
buildGraph(M);buildRoadIdx();
renderHeader();resize();fitScope();S.view=S.view;(function(){var b=REGBOX.All;fitBox(b,0.04,true)})();
window.addEventListener('resize',function(){resize();renderPanel()});
renderPanel();recompute();loop();setInterval(tick,1000);setTimeout(buildTL,1500);initData();
