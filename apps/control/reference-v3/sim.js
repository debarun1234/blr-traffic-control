// ================= simulation: incidents, works, evaluation =================
function hash(s){var h=2166136261;for(var i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0}
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;var t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
var ITYPES=[['Vehicle breakdown',0.55],['Accident',0.4],['Waterlogging',0.45],['Procession',0.5],['Signal fault',0.7],['Tree fall',0.35]];
var ELIG=null;
function genIncidents(date){
  if(!ELIG){ELIG=[];for(var e=0;e<G.ne;e++)if(G.name[e]>=0&&(G.cls[e]<=1||(G.cls[e]==2&&e%3==0)))ELIG.push(e)}
  var r=rng(hash(date)),out=[];
  for(var k=0;k<18;k++){var p=r(),h;if(p<0.5)h=7.5+r()*3.5;else if(p<0.85)h=16.5+r()*4;else h=6+r()*16;
    var it=ITYPES[Math.floor(r()*ITYPES.length)],d=25+Math.floor(r()*50),e=ELIG[Math.floor(r()*ELIG.length)];
    out.push({id:date+'-'+k,type:it[0],e:e,sh:h,eh:h+d/60,cap:it[1],src:'sim',stn:G.stn[e]});}
  return out;
}
var _incCache={};
function incidentsAt(h){
  var dt=istNow().date;if(!_incCache[dt])_incCache={},_incCache[dt]=genIncidents(dt);
  var all=_incCache[dt].slice();
  Object.keys(S.events).forEach(function(id){var v=S.events[id];if(v&&v.date===dt&&v.e>=0&&v.e<G.ne)all.push({id:id,type:v.type,e:v.e,sh:v.sh,eh:v.sh+v.dur/60,cap:v.cap,src:'user',by:v.by,stn:G.stn[v.e]})});
  return {all:all,active:all.filter(function(x){return h>=x.sh&&h<x.eh})};
}
// ---- works ----
var SEEDS=[
 {id:'s1',name:'Metro blue line viaduct works, ORR',road:'Outer Ring Road',stns:['Bellanduru','Mahadevapura'],from:'2026-09-01',to:'2027-06-30',hours:'all',cap:0.75,kind:'Metro',seed:1},
 {id:'s2',name:'Storm-water drain remodelling, ORR',road:'Outer Ring Road',stns:['Bellanduru'],from:'2026-10-01',to:'2026-12-31',hours:'all',cap:0.7,kind:'Drain',seed:1},
 {id:'s3',name:'Flyover bearing repair, Bellary Road',road:'Bellary Road',stns:['Bytarayanapura','Yalahanka'],from:'2026-10-10',to:'2026-12-10',hours:'all',cap:0.7,kind:'Bridge',seed:1},
 {id:'s4',name:'Resurfacing, Hosur Road (night shifts)',road:'Hosur Road',stns:['Madivala','Adugodi'],from:'2026-10-05',to:'2026-11-05',hours:'night',cap:0.5,kind:'Road',seed:1},
 {id:'s5',name:'Utility trench, Tumkur Road',road:'Tumkur Road',stns:['Peenya'],from:'2026-10-01',to:'2026-11-30',hours:'all',cap:0.75,kind:'Utility',seed:1}];
function allWorks(){var a=SEEDS.slice();Object.keys(S.works).forEach(function(id){if(S.works[id])a.push(Object.assign({id:id},S.works[id]))});return a}
function worksEdges(w){var ni=NAMES.indexOf(w.road);if(ni<0||!ROADIDX[ni])return [];var out=[];(w.stns||[]).forEach(function(n){var si=stByName(n);if(si>=0&&ROADIDX[ni][si])out=out.concat(ROADIDX[ni][si])});return out}
function hoursOK(w,h){if(w.hours==='all')return true;var pk=(h>=7.5&&h<11)||(h>=16.5&&h<20.5);if(w.hours==='peak')return pk;return h>=22||h<6}
function worksActive(w,date,h){return w.from<=date&&date<=w.to&&hoursOK(w,h)}
// ---- capacity multiplier array for state ----
function capFor(h,opts){
  opts=opts||{};var cm=null;function m(){if(!cm){cm=new Float32Array(G.ne);cm.fill(1)}return cm}
  if(!opts.noInc){incidentsAt(h).active.forEach(function(x){var c=m();c[x.e]=Math.min(c[x.e],x.cap)})}
  var dt=istNow().date;
  allWorks().forEach(function(w){if(w.seed&&!opts.seeds)return;if(!worksActive(w,dt,h))return;var es=worksEdges(w),c=m();es.forEach(function(e){c[e]=Math.min(c[e],w.cap)})});
  if(opts.extra)opts.extra.forEach(function(x){var c=m();x.edges.forEach(function(e){c[e]=Math.min(c[e],x.cap)})});
  return cm;
}
// ---- evaluation cache ----
var EV={};
function capKey(cm){if(!cm)return '0';var s=[];for(var i=0;i<cm.length;i++)if(cm[i]<1)s.push(i+':'+cm[i].toFixed(2));return s.join(',')}
function evalState(h,cm,iters){var q=Math.round(h*4)/4,k=q+'|'+capKey(cm)+'|'+(iters||6);if(EV[k])return EV[k];var r=assign(q,cm,1,iters||6);r.key=k;
  var keys=Object.keys(EV);if(keys.length>60)delete EV[keys[0]];EV[k]=r;return r}
function evalAsync(h,cm,iters){return new Promise(function(res){setTimeout(function(){res(evalState(h,cm,iters))},15)})}
// ---- summaries ----
function summarize(r){
  var ne=G.ne,vk=0,vkSp=0,tot=0,cong=0,per=new Array(ST.length);for(var i=0;i<ST.length;i++)per[i]={vk:0,sp:0,L:0,c:0};
  for(var e=0;e<ne;e++){var f=Math.max(r.flow[2*e],r.flow[2*e+1]),L=G.len[e]/1000,w=f*L;vk+=w;vkSp+=w*r.spd[e];tot+=L;var s=G.stn[e],P=per[s];P.vk+=w;P.sp+=w*r.spd[e];P.L+=L;if(r.vc[e]>0.95){cong+=L;P.c+=L}}
  var out={speed:vk>0?vkSp/vk:0,congPct:100*cong/tot,per:per.map(function(p){return {speed:p.vk>0?p.sp/p.vk:null,cong:p.L>0?100*p.c/p.L:0,L:p.L}})};
  return out;
}
function colorFor(vc){return vc<0.5?0:vc<0.75?1:vc<0.95?2:vc<1.15?3:vc<1.5?4:5}
var CCOL=['#2e9e5b','#8bc34a','#f2b01e','#ef7b22','#d93636','#8e1b2c'];
