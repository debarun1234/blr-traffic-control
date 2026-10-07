// ================= core =================
var $=function(id){return document.getElementById(id)};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var REGS=['North','East','Central','West','South'];
var I18N={
en:{ttl:'Bengaluru Traffic Control Room',sub:'Simulated live feed · real roads, boundaries and 2025 crash records',all:'Whole city',North:'North',East:'East',Central:'Central',West:'West',South:'South',
 live:'LIVE (simulated)',replay:'REPLAY',back:'Back to live',overview:'Overview',actions:'Actions',planner:'Planner',works:'Works',admin:'Admin',station:'Station',
 spd:'City speed',cong:'Congested',inc:'Incidents',openA:'Open actions',esc:'Escalated',fat:'Fatal 2025',
 layers:'Layers',cLay:'Congestion',minor:'Minor roads',stn:'Stations',crash:'Crash shading',spdShade:'Speed shading',none:'No shading',search:'Search station or road',
 free:'Free',slow:'Slow',jam:'Jammed',nofeed:'No feed',legendT:'Road speed vs capacity',
 note:'Feed is a model run on real road geometry, not sensor data. Crash figures are real (BTP 2018–2025).',
 role:'Role',admin_:'Admin',commissioner:'Commissioner',dcp:'DCP',stationR:'Station',viewer:'Viewer',viewas:'View as',
 ack:'Acknowledge',start:'Start',done:'Mark done',reopen:'Reopen',newS:'New',ackS:'Acknowledged',progS:'In progress',doneS:'Done',
 noAct:'No open actions right now.',noInc:'No active incidents.',report:'Report incident',
 close:'Close',half:'One lane',peakAM:'Morning peak',mid:'Midday',peakPM:'Evening peak',night:'Night',
 run:'Run comparison',computing:'Computing…',addedVeh:'Extra vehicle-hours per hour',diverted:'Traffic shifts to',
 rank:'Rank by fatal crashes',trend:'Crashes 2018–2025',topRoads:'Busiest roads now',
 users:'Users',pending:'Signed in, no role yet',assign:'Assign',remove:'Remove',audit:'Audit log',findPpl:'Find people',
 clash:'Clash',advice:'Advice to GBA',quant:'Quantify',addWorks:'Add works',illus:'Illustrative'},
kn:{ttl:'ಬೆಂಗಳೂರು ಸಂಚಾರ ನಿಯಂತ್ರಣ ಕೊಠಡಿ',sub:'ಅನುಕರಿಸಿದ ನೇರ ಮಾಹಿತಿ · ನೈಜ ರಸ್ತೆಗಳು, ಗಡಿಗಳು ಮತ್ತು 2025ರ ಅಪಘಾತ ದಾಖಲೆಗಳು',all:'ಇಡೀ ನಗರ',North:'ಉತ್ತರ',East:'ಪೂರ್ವ',Central:'ಕೇಂದ್ರ',West:'ಪಶ್ಚಿಮ',South:'ದಕ್ಷಿಣ',
 live:'ನೇರ (ಅನುಕರಣೆ)',replay:'ಮರುಪ್ರಸಾರ',back:'ನೇರಕ್ಕೆ ಮರಳಿ',overview:'ಸಾರಾಂಶ',actions:'ಕ್ರಮಗಳು',planner:'ಯೋಜಕ',works:'ಕಾಮಗಾರಿ',admin:'ನಿರ್ವಾಹಕ',station:'ಠಾಣೆ',
 spd:'ನಗರ ವೇಗ',cong:'ದಟ್ಟಣೆ',inc:'ಘಟನೆಗಳು',openA:'ಬಾಕಿ ಕ್ರಮಗಳು',esc:'ಮೇಲ್ಮಟ್ಟಕ್ಕೆ',fat:'ಮರಣಾಂತಿಕ 2025',
 layers:'ಪದರಗಳು',cLay:'ದಟ್ಟಣೆ',minor:'ಸಣ್ಣ ರಸ್ತೆಗಳು',stn:'ಠಾಣೆಗಳು',crash:'ಅಪಘಾತ ಛಾಯೆ',spdShade:'ವೇಗ ಛಾಯೆ',none:'ಛಾಯೆ ಇಲ್ಲ',search:'ಠಾಣೆ ಅಥವಾ ರಸ್ತೆ ಹುಡುಕಿ',
 free:'ಸುಗಮ',slow:'ನಿಧಾನ',jam:'ಜಾಮ್',nofeed:'ಮಾಹಿತಿ ಇಲ್ಲ',legendT:'ರಸ್ತೆ ವೇಗ vs ಸಾಮರ್ಥ್ಯ',
 note:'ಈ ಮಾಹಿತಿ ನೈಜ ರಸ್ತೆ ಜ್ಯಾಮಿತಿಯ ಮೇಲೆ ಮಾದರಿ ಲೆಕ್ಕಾಚಾರ, ಸೆನ್ಸರ್ ಅಲ್ಲ. ಅಪಘಾತ ಅಂಕಿಅಂಶಗಳು ನೈಜ (BTP 2018–2025).',
 role:'ಪಾತ್ರ',admin_:'ನಿರ್ವಾಹಕ',commissioner:'ಆಯುಕ್ತರು',dcp:'ಡಿಸಿಪಿ',stationR:'ಠಾಣೆ',viewer:'ವೀಕ್ಷಕ',viewas:'ಹೀಗೆ ವೀಕ್ಷಿಸಿ',
 ack:'ಸ್ವೀಕರಿಸಿ',start:'ಆರಂಭಿಸಿ',done:'ಮುಗಿದಿದೆ',reopen:'ಮರುತೆರೆ',newS:'ಹೊಸದು',ackS:'ಸ್ವೀಕೃತ',progS:'ಪ್ರಗತಿಯಲ್ಲಿ',doneS:'ಪೂರ್ಣ',
 noAct:'ಈಗ ಬಾಕಿ ಕ್ರಮಗಳಿಲ್ಲ.',noInc:'ಸಕ್ರಿಯ ಘಟನೆಗಳಿಲ್ಲ.',report:'ಘಟನೆ ವರದಿ',
 close:'ಮುಚ್ಚುವುದು',half:'ಒಂದು ಪಥ',peakAM:'ಬೆಳಗಿನ ಗರಿಷ್ಠ',mid:'ಮಧ್ಯಾಹ್ನ',peakPM:'ಸಂಜೆ ಗರಿಷ್ಠ',night:'ರಾತ್ರಿ',
 run:'ಹೋಲಿಕೆ ನಡೆಸಿ',computing:'ಲೆಕ್ಕಹಾಕಲಾಗುತ್ತಿದೆ…',addedVeh:'ಗಂಟೆಗೆ ಹೆಚ್ಚುವರಿ ವಾಹನ-ಗಂಟೆಗಳು',diverted:'ಸಂಚಾರ ಹೋಗುವ ರಸ್ತೆಗಳು',
 rank:'ಮರಣಾಂತಿಕ ಅಪಘಾತ ಶ್ರೇಣಿ',trend:'ಅಪಘಾತಗಳು 2018–2025',topRoads:'ಈಗ ಅತಿ ದಟ್ಟಣೆಯ ರಸ್ತೆಗಳು',
 users:'ಬಳಕೆದಾರರು',pending:'ಲಾಗಿನ್ ಆಗಿದೆ, ಪಾತ್ರ ಇಲ್ಲ',assign:'ನಿಯೋಜಿಸಿ',remove:'ತೆಗೆಯಿರಿ',audit:'ಲೆಕ್ಕಪರಿಶೋಧನೆ ದಾಖಲೆ',findPpl:'ಜನರನ್ನು ಹುಡುಕಿ',
 clash:'ಘರ್ಷಣೆ',advice:'ಜಿಬಿಎಗೆ ಸಲಹೆ',quant:'ಅಳೆಯಿರಿ',addWorks:'ಕಾಮಗಾರಿ ಸೇರಿಸಿ',illus:'ಉದಾಹರಣೆ'}
};
function T(k){var l=S.lang;return (I18N[l]&&I18N[l][k])||I18N.en[k]||k}
var S={lang:'en',scope:'All',tab:'overview',sel:null,layers:{cong:true,minor:true,stn:true,shade:'none'},replay:null,viewAs:null,
 me:{id:null,name:'',owner:false,canEdit:false},canWrite:null,db:null,users:{},reg:{},acts:{},events:{},works:{},audit:[],dbOK:false,
 view:{cx:0,cy:0,k:0.02},W:0,H:0};
try{var _l=localStorage.getItem('blr_lang');if(_l)S.lang=_l}catch(e){}
// ---- IST time ----
function istNow(){var d=new Date(Date.now()+19800000);return {date:d.toISOString().slice(0,10),h:d.getUTCHours()+d.getUTCMinutes()/60+d.getUTCSeconds()/3600,ms:Date.now()}}
function curT(){return S.replay!=null?S.replay:istNow().h}
function fmtH(h){h=((h%24)+24)%24;var hh=Math.floor(h),mm=Math.floor((h-hh)*60);return (hh<10?'0':'')+hh+':'+(mm<10?'0':'')+mm}
// ---- map data ----
var M=MAPDATA,N=M.d.length,ST=M.st;
var DX=[],DB=new Float32Array(N*4),DREG=new Int8Array(N);
var RIDX={North:0,East:1,Central:2,West:3,South:4};
(function(){for(var i=0;i<N;i++){var f=M.d[i][3],n=f.length/2,a=new Float32Array(f.length),x=f[0],y=f[1];a[0]=x;a[1]=y;
 var x0=x,x1=x,y0=y,y1=y;for(var j=1;j<n;j++){x+=f[2*j];y+=f[2*j+1];a[2*j]=x;a[2*j+1]=y;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
 DX.push(a);DB[4*i]=x0;DB[4*i+1]=y0;DB[4*i+2]=x1;DB[4*i+3]=y1;var s=M.d[i][2];DREG[i]=s>=0?RIDX[ST[s].r]:-1}})();
var REGBOX={};
(function(){function bb(rings){var a=1e9,b=1e9,c=-1e9,d=-1e9;rings.forEach(function(r){r.forEach(function(p){if(p[0]<a)a=p[0];if(p[0]>c)c=p[0];if(p[1]<b)b=p[1];if(p[1]>d)d=p[1]})});return [a,b,c,d]}
 REGBOX.All=bb(M.city);REGS.forEach(function(r){REGBOX[r]=bb(M.reg[r])});ST.forEach(function(s,i){s.box=bb(s.poly);s.i=i;s.ri=RIDX[s.r];s.fx=s.f;s.nf=s.t})})();
var HIST=HISTDATA;
function stByName(n){for(var i=0;i<ST.length;i++)if(ST[i].n===n)return i;return -1}
function pip(x,y,rings){var inside=false;rings.forEach(function(r){for(var i=0,j=r.length-1;i<r.length;j=i++){var xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside}});return inside}
function stAt(x,y){for(var i=0;i<ST.length;i++){var b=ST[i].box;if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;if(pip(x,y,ST[i].poly))return i}return -1}
// ---- road names & route index ----
var NAMES=M.n;
function edgeName(e){var n=G.name[e];return n>=0?NAMES[n]:(S.lang==='kn'?'(ಹೆಸರಿಲ್ಲದ ರಸ್ತೆ)':'(unnamed road)')}
var ROADIDX=null;// name -> {stn -> [edges]}
function buildRoadIdx(){ROADIDX={};for(var e=0;e<G.ne;e++){var n=G.name[e];if(n<0)continue;var o=ROADIDX[n]||(ROADIDX[n]={});(o[G.stn[e]]||(o[G.stn[e]]=[])).push(e)}}
// ---- scope & role helpers ----
function inScope(reg){return S.scope==='All'||reg===S.scope}
function roleNow(){
  if(S.viewAs)return S.viewAs;
  if(S.me.owner||S.me.canEdit)return {role:'admin'};
  var u=S.me.id&&S.users[S.me.id];return u||{role:'viewer'};
}
function lockedRegion(){var r=roleNow();if(r.role==='dcp'||r.role==='station')return r.region||(r.station!=null&&ST[stByName(r.station)]?ST[stByName(r.station)].r:null);return null}
function myStation(){var r=roleNow();if(r.role==='station'&&r.station)return stByName(r.station);return -1}
function canActOn(stIdx){var r=roleNow();if(r.role==='admin'||r.role==='commissioner')return true;
  if(r.role==='dcp')return ST[stIdx].r===lockedRegion();if(r.role==='station')return stIdx===myStation();return false}
function isCmd(){var r=roleNow().role;return r==='admin'||r==='commissioner'}
function isAdmin(){return roleNow().role==='admin'}
