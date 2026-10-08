// Sign-in artwork: the real road network with simulated telemetry (travelling pulses, junction ripples, radar sweep).
// Purely decorative and synthetic: the card says so. Respects reduced motion, pauses when hidden, stops when detached.

const rnd = (a, b) => a + Math.random() * (b - a);

/** @param {{focus?: number[][][] | null}} [opt] focus = polygon rings in map units to spotlight (a region or a station) */
export function startArt(canvas, map, opt = {}) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, stopped = false, geo = null, base = null, last = 0, t0 = 0, nextEvent = 0;
  const particles = [], ripples = [];

  const build = () => {
    const dpr = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth || 560, hh = canvas.clientHeight || 420;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const r of map.city) for (const p of r) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const k = Math.min(w / (x1 - x0), hh / (y1 - y0)) * 0.92, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const X = (x) => (x - cx) * k + w / 2, Y = (y) => hh / 2 - (y - cy) * k;
    const cs = getComputedStyle(document.documentElement), col = (v) => cs.getPropertyValue(v).trim();
    const roads = [];
    for (const d of map.d) {
      if (d[4] < 0 || d[0] > 1) continue; // animate on major + secondary roads only
      const f = d[3], pts = []; let x = f[0], y = f[1]; pts.push([X(x), Y(y)]);
      for (let j = 2; j < f.length; j += 2) { x += f[j]; y += f[j + 1]; pts.push([X(x), Y(y)]); }
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      if (cum[cum.length - 1] > 0.5) roads.push({ pts, cum, len: cum[cum.length - 1], major: d[0] === 0 });
    }
    // connect edges that share an endpoint (snapped to a 2 px grid) so pulses can turn at junctions
    const key = (p) => `${Math.round(p[0] / 2)},${Math.round(p[1] / 2)}`, adj = new Map();
    for (const r of roads) for (const [end, p] of [[0, r.pts[0]], [1, r.pts[r.pts.length - 1]]]) { const k = key(p); (adj.get(k) ?? adj.set(k, []).get(k)).push({ r, end }); }
    const longRoads = roads.filter((r) => r.len > 14);
    geo = { w, hh, dpr, X, Y, cx: X(cx), cy: Y(cy), r: Math.max(w, hh) * 0.62, roads, longRoads, adj, key, col: { accent: col('--accent'), warn: col('--warn'), bad: col('--bad'), good: col('--good') } };

    // static layer (outline + roads) rendered once per size/theme
    base = document.createElement('canvas'); base.width = canvas.width; base.height = canvas.height;
    const g = base.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const city = new Path2D(); for (const r of map.city) { city.moveTo(X(r[0][0]), Y(r[0][1])); for (const p of r) city.lineTo(X(p[0]), Y(p[1])); city.closePath(); }
    g.globalAlpha = 0.85; g.fillStyle = col('--surface'); g.fill(city); g.globalAlpha = 1; g.strokeStyle = col('--line-2'); g.lineWidth = 1.5; g.stroke(city);
    g.lineCap = 'round'; g.lineJoin = 'round'; const width = [1.9, 1.2, 0.7];
    for (const c of [2, 1, 0]) {
      g.beginPath();
      for (const d of map.d) { if (d[0] !== c || d[4] < 0) continue; const f = d[3]; let x = f[0], y = f[1]; g.moveTo(X(x), Y(y)); for (let j = 2; j < f.length; j += 2) { x += f[j]; y += f[j + 1]; g.lineTo(X(x), Y(y)); } }
      g.strokeStyle = c === 0 ? col('--accent') : c === 1 ? col('--ink-3') : col('--line-2'); g.globalAlpha = c === 0 ? 0.95 : c === 1 ? 0.55 : 0.4; g.lineWidth = width[c]; g.stroke();
    }
    g.globalAlpha = 1; g.strokeStyle = col('--accent'); g.lineWidth = 1.2; g.globalAlpha = 0.5; g.setLineDash([4, 4]);
    for (const reg of Object.values(map.reg)) { g.beginPath(); for (const r of reg) { g.moveTo(X(r[0][0]), Y(r[0][1])); for (const p of r) g.lineTo(X(p[0]), Y(p[1])); g.closePath(); } g.stroke(); }
    geo.city = city;
    if (opt.focus?.length) {
      const fp = new Path2D(); for (const r of opt.focus) { fp.moveTo(X(r[0][0]), Y(r[0][1])); for (const p of r) fp.lineTo(X(p[0]), Y(p[1])); fp.closePath(); }
      const veil = new Path2D(); veil.rect(0, 0, w, hh); veil.addPath(fp);
      g.save(); g.setLineDash([]); g.fillStyle = col('--bg'); g.globalAlpha = 0.6; g.fill(veil, 'evenodd'); g.globalAlpha = 0.1; g.fillStyle = col('--accent'); g.fill(fp);
      g.globalAlpha = 1; g.strokeStyle = col('--accent'); g.lineWidth = 2; g.stroke(fp); g.restore();
      let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9; for (const r of opt.focus) for (const p of r) { const px = X(p[0]), py = Y(p[1]); bx0 = Math.min(bx0, px); bx1 = Math.max(bx1, px); by0 = Math.min(by0, py); by1 = Math.max(by1, py); }
      const pad = 18, near = geo.longRoads.filter((r) => { const [px, py] = r.pts[0]; return px > bx0 - pad && px < bx1 + pad && py > by0 - pad && py < by1 + pad; });
      if (near.length >= 3) geo.longRoads = near; geo.focus = true;
    }
    particles.length = 0; ripples.length = 0;
  };

  const pointAt = (rd, s) => { // position at arc-length s
    const { pts, cum } = rd; let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1, u = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
  };
  const pickRoad = () => { const m = geo.longRoads.filter((r) => r.major === (Math.random() < 0.65)); const a = m.length ? m : geo.longRoads; return a[(Math.random() * a.length) | 0]; };
  const spawn = () => {
    const rd = pickRoad(); if (!rd) return null; const rr = Math.random();
    return { rd, rev: Math.random() < 0.5, s: 0, v: rnd(70, 170), trail: rnd(50, 130), life: geo.focus ? rnd(120, 360) : rnd(350, 1100), hist: [], color: rr < 0.82 ? geo.col.accent : rr < 0.94 ? geo.col.warn : geo.col.bad };
  };
  const posOn = (p) => pointAt(p.rd, p.rev ? p.rd.len - p.s : p.s);
  const advance = (p, d) => { // move d px, turning onto a connected edge at each end; false when the pulse has run its course
    while (d > 0) {
      const rem = p.rd.len - p.s; if (d < rem) { p.s += d; break; }
      d -= rem; p.s = p.rd.len; const end = p.rev ? p.rd.pts[0] : p.rd.pts[p.rd.pts.length - 1];
      const opts = (geo.adj.get(geo.key(end)) ?? []).filter((o) => o.r !== p.rd); if (!opts.length) return false;
      const w = opts.filter((o) => o.r.major === p.rd.major), pick = (w.length && Math.random() < 0.8 ? w : opts)[(Math.random() * (w.length && Math.random() < 0.8 ? w.length : opts.length)) | 0] ?? opts[0];
      p.rd = pick.r; p.rev = pick.end === 1; p.s = 0;
    }
    return true;
  };

  const frame = (now) => {
    if (stopped) return; if (!canvas.isConnected) { stop(); return; }
    raf = requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; }
    if (!t0) { t0 = now; last = now; }
    const dt = Math.min(0.05, (now - last) / 1000), el = (now - t0) / 1000; last = now;
    const g = canvas.getContext('2d'); g.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0); g.clearRect(0, 0, geo.w, geo.hh);
    g.drawImage(base, 0, 0, geo.w, geo.hh);

    // radar sweep, clipped to the city
    if (g.createConicGradient) {
      g.save(); g.clip(geo.city); const a = (el / 9) * Math.PI * 2, grad = g.createConicGradient(a, geo.cx, geo.cy);
      grad.addColorStop(0, geo.col.accent + '00'); grad.addColorStop(0.86, geo.col.accent + '00'); grad.addColorStop(0.985, geo.col.accent + '3a'); grad.addColorStop(1, geo.col.accent + '00');
      g.fillStyle = grad; g.fillRect(0, 0, geo.w, geo.hh); g.restore();
    }

    // pulses travelling along roads (ramp up over the first 2.5 s so the screen "wakes up")
    const target = Math.round(Math.min(1, el / 2.5) * (geo.focus ? 40 : 70));
    while (particles.length < target) { const p = spawn(); if (!p) break; particles.push(p); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i], step = p.v * dt; p.life -= step;
      if (p.life <= 0 || !advance(p, step)) { if (p.hist.length > 1 && p.life > -p.trail) { p.hist.shift(); if (p.hist.length < 2) { const n = spawn(); if (n) particles[i] = n; else particles.splice(i, 1); } else p.life -= step; } else { const n = spawn(); if (n) particles[i] = n; else particles.splice(i, 1); continue; } }
      else { p.hist.push(posOn(p)); if (p.hist.length > 90) p.hist.shift(); }
      const hs = p.hist; if (hs.length < 2) continue;
      let acc = 0, n = hs.length - 1; while (n > 0 && acc < p.trail) { acc += Math.hypot(hs[n][0] - hs[n - 1][0], hs[n][1] - hs[n - 1][1]); n--; }
      const H = hs[hs.length - 1], T = hs[n], gr = g.createLinearGradient(T[0], T[1], H[0], H[1]); gr.addColorStop(0, p.color + '00'); gr.addColorStop(1, p.color + 'ee');
      g.strokeStyle = gr; g.lineWidth = 3; g.beginPath(); g.moveTo(T[0], T[1]); for (let k = n + 1; k < hs.length; k++) g.lineTo(hs[k][0], hs[k][1]); g.stroke();
      if (p.life > 0) { g.fillStyle = p.color; g.shadowColor = p.color; g.shadowBlur = 8; g.beginPath(); g.arc(H[0], H[1], 3, 0, 7); g.fill(); g.shadowBlur = 0; }
    }

    // junction ripples (random "events")
    if (el > 1.2 && now > nextEvent) {
      nextEvent = now + rnd(350, 1100); const rd = pickRoad(); if (rd) { const pt = pointAt(rd, rnd(0, rd.len)), rr = Math.random(); ripples.push({ x: pt[0], y: pt[1], age: 0, color: rr < 0.78 ? geo.col.accent : rr < 0.93 ? geo.col.warn : geo.col.bad }); }
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]; r.age += dt; const u = r.age / 1.6; if (u >= 1) { ripples.splice(i, 1); continue; }
      g.strokeStyle = r.color + Math.round((1 - u) * 200).toString(16).padStart(2, '0'); g.lineWidth = 1.5; g.beginPath(); g.arc(r.x, r.y, 3 + u * 22, 0, 7); g.stroke();
      g.fillStyle = r.color; g.beginPath(); g.arc(r.x, r.y, 2, 0, 7); g.fill();
    }
  };

  const ro = new ResizeObserver(() => { if (!stopped) { build(); if (reduce) paintStill(); } });
  const paintStill = () => { const g = canvas.getContext('2d'); g.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0); g.clearRect(0, 0, geo.w, geo.hh); g.drawImage(base, 0, 0, geo.w, geo.hh); };
  const theme = new MutationObserver(() => { if (!stopped) { build(); if (reduce) paintStill(); } });
  function stop() { stopped = true; cancelAnimationFrame(raf); ro.disconnect(); theme.disconnect(); }

  build();
  ro.observe(canvas); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (reduce) paintStill(); else raf = requestAnimationFrame(frame);
  return stop;
}
