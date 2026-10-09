// Canvas map renderer: zoom/pan LOD, region dimming, congestion colouring, shading layers, markers.
import { S, lockedRegion, myStation, curHour, incidentsAt, today, fatal2025 } from '../state.mjs';
import { REGIONS, REGION_INDEX, colourClass, speedBucket, worksEdges, worksActiveAt } from '../analytics.mjs';
import { UNIT_M } from './data.mjs';
import { t } from '../i18n.mjs';

const VARS = ['--map', '--land', '--ink', '--ink-2', '--line', '--accent', '--road-major', '--road-minor', '--nofeed', '--bad', '--warn', '--surface', '--c0', '--c1', '--c2', '--c3', '--c4', '--c5', '--font'];
const WD = [3.1, 2.3, 1.5, 0.8];

export function createRenderer(canvas) {
  const MD = S.MD, { map, net, DX, DB, DREG, ST, REGBOX, RT, N } = MD;
  const ctx = canvas.getContext('2d');
  const R = { view: { cx: 0, cy: 0, k: 0.02 }, W: 0, H: 0, dirty: true, DPR: 1, markers: [] };
  let COL = null, worksCache = { key: '', edges: [] };

  R.invalidate = () => { R.dirty = true; };
  R.refreshColours = () => { COL = null; R.dirty = true; };
  const colours = () => {
    if (COL) return COL;
    const cs = getComputedStyle(document.documentElement); COL = {};
    for (const k of VARS) COL[k] = cs.getPropertyValue(k).trim();
    COL.cls = [0, 1, 2, 3, 4, 5].map((i) => COL[`--c${i}`]);
    return COL;
  };
  R.colours = colours;
  R.resize = (w, h) => {
    R.DPR = Math.min(2, window.devicePixelRatio || 1); R.W = w; R.H = h;
    canvas.width = Math.max(1, Math.round(w * R.DPR)); canvas.height = Math.max(1, Math.round(h * R.DPR)); R.dirty = true;
  };
  const sx = (x) => (x - R.view.cx) * R.view.k + R.W / 2, sy = (y) => R.H / 2 - (y - R.view.cy) * R.view.k;
  const wx = (px) => (px - R.W / 2) / R.view.k + R.view.cx, wy = (py) => (R.H / 2 - py) / R.view.k + R.view.cy;
  Object.assign(R, { sx, sy, wx, wy });
  R.regAlpha = (ri) => (S.scope === 'All' ? 1 : ri === REGION_INDEX[S.scope] ? 1 : lockedRegion() ? 0.07 : 0.2);
  const regAlpha = R.regAlpha;
  const visItem = (i, x0, y0, x1, y1) => !(DB[4 * i + 2] < x0 || DB[4 * i] > x1 || DB[4 * i + 3] < y0 || DB[4 * i + 1] > y1);
  R.visItem = visItem;

  R.fitBox = (b, pad = 0.08, instant = false) => {
    const bw = (b[2] - b[0]) * (1 + pad * 2), bh = (b[3] - b[1]) * (1 + pad * 2);
    const k = Math.min(R.W / bw, R.H / bh), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (instant || reduce || !R.W) { R.view = { cx, cy, k }; R.dirty = true; return; }
    const v0 = { ...R.view }, t0 = performance.now(), id = (R._anim = (R._anim ?? 0) + 1);
    (function step() {
      if (id !== R._anim) return;
      let u = Math.min(1, (performance.now() - t0) / 350); u = u * u * (3 - 2 * u);
      R.view = { cx: v0.cx + (cx - v0.cx) * u, cy: v0.cy + (cy - v0.cy) * u, k: v0.k * Math.pow(k / v0.k, u) };
      R.dirty = true; if (u < 1) requestAnimationFrame(step);
    })();
  };
  R.zoomAt = (px, py, f) => {
    R._anim = (R._anim ?? 0) + 1;
    const k0 = R.view.k, k1 = Math.max(0.02, Math.min(4, k0 * f)), x = wx(px), y = wy(py);
    R.view.k = k1; R.view.cx = x - (px - R.W / 2) / k1; R.view.cy = y + (py - R.H / 2) / k1; R.dirty = true;
  };
  R.fitScope = (instant) => R.fitBox(REGBOX[S.scope] ?? REGBOX.All, 0.06, instant);

  function ringPath(rings) { for (const r of rings) { ctx.moveTo(sx(r[0][0]), sy(r[0][1])); for (let i = 1; i < r.length; i++) ctx.lineTo(sx(r[i][0]), sy(r[i][1])); ctx.closePath(); } }
  function polyline(a) { ctx.moveTo(sx(a[0]), sy(a[1])); for (let j = 2; j < a.length; j += 2) ctx.lineTo(sx(a[j]), sy(a[j + 1])); }
  function hl(e, col, w) { ctx.beginPath(); polyline(DX[net.draw[e]]); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.globalAlpha = 0.9; ctx.lineCap = 'round'; ctx.stroke(); ctx.globalAlpha = 1; }

  function activeWorksEdges() {
    const h = Math.round(curHour() * 4) / 4, d = today();
    const key = `${S.works.map((w) => w.id + w.cap + w.to).join(',')}|${h}|${d}`;
    if (worksCache.key !== key) { const es = []; for (const w of S.works) if (worksActiveAt(w, d, h)) es.push(...worksEdges(net, w)); worksCache = { key, edges: es }; }
    return worksCache.edges;
  }

  R.draw = () => {
    R.dirty = false;
    const C = colours(), k = R.view.k, W = R.W, H = R.H, vc = S.result?.vc, hasFeed = !!vc && S.layers.cong;
    const mini = W < 560;
    ctx.setTransform(R.DPR, 0, 0, R.DPR, 0, 0);
    if (R.baseOn?.()) ctx.clearRect(0, 0, W, H); // Google basemap shows through
    else { ctx.fillStyle = C['--map']; ctx.fillRect(0, 0, W, H); ctx.beginPath(); ringPath(map.city); ctx.fillStyle = C['--land']; ctx.fill(); }

    // territory shading
    if (S.layers.shade !== 'none') {
      const ramp = [C['--c4'], C['--c3'], C['--c2'], C['--c1'], C['--c0']];
      ST.forEach((s, i) => {
        let col, al;
        if (S.layers.shade === 'crash') { col = C['--c4']; al = Math.min(0.6, (fatal2025(i) / 26) * 0.6); }
        else { const b = speedBucket(S.sum?.per[i]?.speed); col = b == null ? null : ramp[b]; al = 0.38; }
        if (!col) return;
        ctx.globalAlpha = al * regAlpha(s.ri); ctx.beginPath(); ringPath(s.poly); ctx.fillStyle = col; ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    // own station territory
    const my = myStation();
    if (my >= 0) { ctx.globalAlpha = 0.16; ctx.beginPath(); ringPath(ST[my].poly); ctx.fillStyle = C['--accent']; ctx.fill(); ctx.globalAlpha = 1; }
    // dim outside the scope region
    if (S.scope !== 'All') { ctx.beginPath(); ringPath(map.city); ringPath(map.reg[S.scope]); ctx.fillStyle = C['--map']; ctx.globalAlpha = lockedRegion() ? 0.78 : 0.6; ctx.fill('evenodd'); ctx.globalAlpha = 1; }
    // station boundaries
    ctx.lineWidth = 0.7; ctx.strokeStyle = C['--line'];
    for (const s of ST) { ctx.globalAlpha = 0.95 * regAlpha(s.ri); ctx.beginPath(); ringPath(s.poly); ctx.stroke(); }
    ctx.globalAlpha = 1;

    // roads (level of detail by zoom)
    const x0 = wx(0), x1 = wx(W), y0 = wy(H), y1 = wy(0), sc = Math.min(2.4, Math.max(0.8, Math.pow(k / 0.06, 0.4)));
    const showMinor = S.layers.minor && k > 0.11;
    for (const bk of [1, 0]) {
      const B = [[], [], [], []].map(() => [[], [], [], [], [], [], []]);
      for (let i = 0; i < N; i++) {
        if (!visItem(i, x0, y0, x1, y1)) continue;
        const d = map.d[i], c = d[0]; if (c === 3 && !showMinor) continue;
        const ra = DREG[i], al = ra < 0 ? 1 : regAlpha(ra); if ((al >= 1 ? 0 : 1) !== bk) continue;
        B[c][d[4] >= 0 && hasFeed ? colourClass(vc[d[4]]) : 6].push(i);
      }
      ctx.globalAlpha = bk ? (lockedRegion() ? 0.14 : 0.22) : 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let c = 3; c >= 0; c--) for (let b = 0; b < 7; b++) {
        const L = B[c][b]; if (!L.length) continue;
        ctx.beginPath(); for (const i of L) polyline(DX[i]);
        ctx.strokeStyle = b < 6 ? C.cls[b] : c === 3 ? C['--road-minor'] : (c <= 2 && S.layers.cong ? C['--nofeed'] : C['--road-major']);
        ctx.lineWidth = WD[c] * sc * (b >= 3 && b < 6 ? 1.25 : 1); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // works overlay (dashed amber over affected edges)
    if (S.layers.works) {
      const es = activeWorksEdges();
      if (es.length) { ctx.setLineDash([5, 4]); ctx.strokeStyle = C['--warn']; ctx.lineWidth = 3.2 * sc; ctx.lineCap = 'butt'; ctx.beginPath(); for (const e of es) polyline(DX[net.draw[e]]); ctx.stroke(); ctx.setLineDash([]); }
    }

    // region + city borders
    ctx.lineWidth = 2; ctx.strokeStyle = C['--accent'];
    for (const r of REGIONS) { ctx.globalAlpha = S.scope === 'All' || S.scope === r ? 0.75 : 0.25; ctx.beginPath(); ringPath(map.reg[r]); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.lineWidth = 1.6; ctx.strokeStyle = C['--ink']; ctx.beginPath(); ringPath(map.city); ctx.stroke();

    // selection
    if (S.sel) {
      const si = S.sel.t === 'st' ? S.sel.i : net.stn[S.sel.e];
      ctx.lineWidth = 3; ctx.strokeStyle = C['--accent']; ctx.beginPath(); ringPath(ST[si].poly); ctx.stroke();
      if (S.sel.t === 'edge') hl(S.sel.e, C['--accent'], 6);
    }
    if (S.hover && S.hover.e >= 0) hl(S.hover.e, C['--ink'], 4);

    // road names
    const FONT = C['--font'] || 'system-ui, sans-serif';
    if (k > 0.16) {
      ctx.font = `10px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = C['--ink'];
      const placed = [], byName = {}; let cnt = 0;
      for (let q = 0; q < RT.length && cnt < 45; q++) {
        const i = RT[q], d = map.d[i];
        if (d[1] < 0 || d[0] > (k > 0.35 ? 2 : 1) || !visItem(i, x0, y0, x1, y1)) continue;
        if (DREG[i] >= 0 && regAlpha(DREG[i]) < 1) continue;
        const a = DX[i], m = ((a.length / 4) | 0) * 2, px = sx(a[m]), py = sy(a[m + 1]);
        if (px < 30 || px > W - 30 || py < 10 || py > H - 10) continue;
        const nm = map.n[d[1]], tw = ctx.measureText(nm).width; let ok = true;
        const bn = byName[d[1]] ?? [];
        for (const z of bn) if (Math.hypot(z[0] - px, z[1] - py) < 260) { ok = false; break; }
        if (ok) for (const p of placed) if (Math.abs(p[0] - px) < (p[2] + tw) / 2 + 6 && Math.abs(p[1] - py) < 13) { ok = false; break; }
        if (!ok) continue;
        placed.push([px, py, tw]); (byName[d[1]] = bn).push([px, py]); cnt++;
        ctx.lineWidth = 3; ctx.strokeStyle = C['--land']; ctx.strokeText(nm, px, py); ctx.fillText(nm, px, py);
      }
    }
    // stations
    if (S.layers.stn) {
      const big = S.scope !== 'All' || k > 0.1; ctx.textAlign = 'left';
      ST.forEach((s, i) => {
        const a = regAlpha(s.ri); if (a < 0.5) return;
        const px = sx(s.x), py = sy(s.y); if (px < -20 || px > W + 20 || py < -20 || py > H + 20) return;
        const mine = i === my; ctx.globalAlpha = a;
        if (mine) { ctx.beginPath(); ctx.arc(px, py, 10, 0, 7); ctx.fillStyle = C['--accent']; ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = a; }
        ctx.beginPath(); ctx.arc(px, py, mine ? 5.5 : 3.4, 0, 7); ctx.fillStyle = mine ? C['--accent'] : C['--ink']; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C['--land']; ctx.stroke();
        if (big || mine || fatal2025(i) >= 14) {
          ctx.font = `600 11px ${FONT}`; ctx.lineWidth = 3; ctx.strokeStyle = C['--land']; ctx.strokeText(s.n, px + 7, py + 4);
          ctx.fillStyle = mine ? C['--accent'] : C['--ink']; ctx.fillText(s.n, px + 7, py + 4);
        }
      });
      ctx.globalAlpha = 1;
    }
    // region labels in city view
    if (S.scope === 'All' && k < 0.1) {
      ctx.textAlign = 'center'; ctx.font = `700 ${mini ? 12 : 15}px ${FONT}`;
      for (const r of REGIONS) { const c = MD.REGLAB[r], lx = sx(c[0]), ly = sy(c[1]), txt = t(`reg.${r}`).toUpperCase(); ctx.globalAlpha = 0.9; ctx.lineWidth = 4; ctx.strokeStyle = C['--land']; ctx.strokeText(txt, lx, ly); ctx.fillStyle = C['--accent']; ctx.fillText(txt, lx, ly); }
      ctx.globalAlpha = 1;
    }
    // hubs
    for (const h of map.hubs) { ctx.save(); ctx.translate(sx(h.x), sy(h.y)); ctx.rotate(Math.PI / 4); ctx.fillStyle = C['--warn']; ctx.fillRect(-3.5, -3.5, 7, 7); ctx.restore(); }
    // incidents
    R.markers = [];
    if (S.layers.inc) {
      ctx.textAlign = 'center';
      for (const x of incidentsAt(curHour())) {
        const [mx, my2] = MD.edgeMid(x.e), px = sx(mx), py = sy(my2); if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
        const ri = ST[x.stn]?.ri ?? 0, dim = regAlpha(ri) < 1; ctx.globalAlpha = dim ? 0.3 : 1;
        if (!dim) R.markers.push({ x: px, y: py, e: x.e, id: x.id });
        const selected = S.sel?.t === 'edge' && S.sel.e === x.e;
        ctx.beginPath(); ctx.arc(px, py, selected ? 10 : 8, 0, 7); ctx.fillStyle = C['--bad']; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = `700 11px ${FONT}`; ctx.fillText('!', px, py + 4); ctx.globalAlpha = 1;
      }
    }
    // scale bar
    if (!mini) {
      const perKm = (1000 / UNIT_M) * k, km = [0.1, 0.2, 0.5, 1, 2, 5, 10].find((v) => v * perKm >= 70) ?? 10, pxl = km * perKm;
      ctx.fillStyle = C['--ink']; ctx.textAlign = 'left'; ctx.font = `11px ${FONT}`;
      const bx = W - pxl - 16, by = H - 70; ctx.fillRect(bx, by, pxl, 2); ctx.fillRect(bx, by - 3, 1.5, 8); ctx.fillRect(bx + pxl - 1.5, by - 3, 1.5, 8); ctx.fillText(`${km} km`, bx, by - 6);
    }
  };
  return R;
}
