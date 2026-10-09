// Optional Google Maps basemap drawn *under* the canvas. The canvas stays the single source of interaction and
// overlays; this module only keeps the Google camera in step with R.view. Google's logo/attribution stay visible
// (terms of use) and no Google traffic/route data is drawn here: that stays inside the Google map itself.
import { UNIT_M } from './data.mjs';

let loading = null;
export function loadGoogleMaps(key) {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  return (loading ??= new Promise((resolve, reject) => {
    window.__gmReady = () => resolve(window.google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__gmReady`;
    s.async = true; s.onerror = () => { loading = null; s.remove(); reject(new Error('Google Maps failed to load')); };
    document.head.append(s);
  }));
}

const TYPES = { roadmap: 'roadmap', hybrid: 'hybrid' };
export function createGoogleBase(wrap, R, { key, mapId, origin, onFail }) {
  const el = document.createElement('div'); el.className = 'cc-gmap'; el.setAttribute('aria-hidden', 'true'); el.hidden = true;
  wrap.insertBefore(el, wrap.firstChild);
  let map = null, type = 'plain', seq = 0, last = '', traffic = false, tl = null;
  const api = { active: false };

  function sync() {
    if (!map || !R.W) return;
    const { cx, cy, k } = R.view;
    const lat = origin[1] + (cy * UNIT_M) / 111320, lon = origin[0] + (cx * UNIT_M) / (111320 * Math.cos((lat * Math.PI) / 180));
    const zoom = Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180) * k) / UNIT_M), sig = `${lat.toFixed(6)}|${lon.toFixed(6)}|${zoom.toFixed(3)}`;
    if (sig === last) return; last = sig;
    map.moveCamera ? map.moveCamera({ center: { lat, lng: lon }, zoom }) : (map.setCenter({ lat, lng: lon }), map.setZoom(zoom));
  }
  function applyTraffic() { if (!map) return; const maps = window.google.maps; if (traffic && !tl) tl = new maps.TrafficLayer(); tl?.setMap(traffic && api.active ? map : null); }
  function fail(msg) { api.set('plain'); onFail?.(msg); }
  api.set = async (next) => {
    type = TYPES[next] ? next : 'plain'; const my = ++seq;
    if (type === 'plain') { api.active = false; applyTraffic(); el.hidden = true; wrap.classList.remove('gm'); R.dirty = true; return; }
    try {
      const maps = await loadGoogleMaps(key); if (my !== seq) return;
      window.gm_authFailure = () => fail('Google Maps rejected the API key (check key restrictions and billing).');
      if (!map) {
        map = new maps.Map(el, { mapId: mapId || 'DEMO_MAP_ID', disableDefaultUI: true, gestureHandling: 'none', keyboardShortcuts: false, clickableIcons: false, isFractionalZoomEnabled: true, center: { lat: origin[1], lng: origin[0] }, zoom: 11 });
      }
      el.hidden = false; map.setMapTypeId(TYPES[type]); api.active = true; wrap.classList.add('gm'); last = ''; applyTraffic(); sync(); R.dirty = true;
    } catch (e) { if (my === seq) fail(e.message); }
  };
  api.setTraffic = (on) => { traffic = !!on; applyTraffic(); };
  api.sync = sync;
  api.destroy = () => { seq++; el.remove(); };
  return api;
}
