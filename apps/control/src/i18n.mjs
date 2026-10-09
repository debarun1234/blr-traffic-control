// All user-visible strings. Each entry is [English, Kannada]. Parity is structural: every key has both.
// NOTE FOR REVIEW: the Kannada (KN) column was written without a native-speaker pass and MUST be reviewed
// by a native Kannada speaker (terminology for police/traffic operations in particular) before production use.
// Placeholders like {n} are replaced by t(key, {n}). Technical tokens (km/h, v/c, veh-h/h, IST) stay Latin.

const D = {
  // ---- app / generic ----
  'app.name': ['Bengaluru Traffic Control', 'ಬೆಂಗಳೂರು ಸಂಚಾರ ನಿಯಂತ್ರಣ'],
  'app.sub': ['Modelled traffic · 53 station territories + 4 Rural taluks', 'ಮಾದರಿ ಸಂಚಾರ · 53 ಠಾಣೆ ವ್ಯಾಪ್ತಿಗಳು + 4 ಗ್ರಾಮಾಂತರ ತಾಲ್ಲೂಕುಗಳು'],
  'loading': ['Loading…', 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…'],
  'computing': ['Computing…', 'ಲೆಕ್ಕಹಾಕಲಾಗುತ್ತಿದೆ…'],
  'retry': ['Retry', 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ'],
  'cancel': ['Cancel', 'ರದ್ದುಮಾಡಿ'],
  'close': ['Close', 'ಮುಚ್ಚಿ'],
  'save': ['Save', 'ಉಳಿಸಿ'],
  'edit': ['Edit', 'ಸಂಪಾದಿಸಿ'],
  'remove': ['Remove', 'ತೆಗೆಯಿರಿ'],
  'road.unnamed': ['(unnamed road)', '(ಹೆಸರಿಲ್ಲದ ರಸ್ತೆ)'],

  // ---- scope / roles ----
  'scope.all': ['Whole city', 'ಇಡೀ ನಗರ'],
  'scope.aria': ['Region scope', 'ವಿಭಾಗ ವ್ಯಾಪ್ತಿ'],
  'scope.locked': ['Your view is locked to this region', 'ನಿಮ್ಮ ವೀಕ್ಷಣೆ ಈ ವಿಭಾಗಕ್ಕೆ ಸೀಮಿತವಾಗಿದೆ'],
  'lock.note': ['Your view is locked to the {region} region.', 'ನಿಮ್ಮ ವೀಕ್ಷಣೆ {region} ವಿಭಾಗಕ್ಕೆ ಸೀಮಿತವಾಗಿದೆ.'],
  'reg.North': ['North', 'ಉತ್ತರ'], 'reg.East': ['East', 'ಪೂರ್ವ'], 'reg.Central': ['Central', 'ಕೇಂದ್ರ'], 'reg.West': ['West', 'ಪಶ್ಚಿಮ'], 'reg.Rural': ['Rural', 'ಗ್ರಾಮಾಂತರ'], 'reg.South': ['South', 'ದಕ್ಷಿಣ'],
  'role.admin': ['Admin', 'ನಿರ್ವಾಹಕ'], 'role.commissioner': ['Commissioner', 'ಆಯುಕ್ತರು'], 'role.dcp': ['DCP', 'ಡಿಸಿಪಿ'], 'role.station': ['Station', 'ಠಾಣೆ'], 'role.viewer': ['Viewer (read-only)', 'ವೀಕ್ಷಕ (ಓದಲು ಮಾತ್ರ)'],
  'role.readonly': ['Read-only access: you can view but not change anything.', 'ಓದಲು ಮಾತ್ರ ಪ್ರವೇಶ: ನೀವು ನೋಡಬಹುದು, ಬದಲಾಯಿಸಲಾಗದು.'],
  'role.readonlyPlan': ['Your role is read-only, so the planner is disabled.', 'ನಿಮ್ಮ ಪಾತ್ರ ಓದಲು ಮಾತ್ರ, ಆದ್ದರಿಂದ ಯೋಜಕ ನಿಷ್ಕ್ರಿಯವಾಗಿದೆ.'],

  // ---- status / banners ----
  'pill.live': ['LIVE (modelled)', 'ನೇರ (ಮಾದರಿ)'],
  'pill.blend': ['BLENDED (modelled)', 'ಮಿಶ್ರ (ಮಾದರಿ)'],
  'pill.sim': ['SIMULATED FEED', 'ಅನುಕರಿಸಿದ ಮಾಹಿತಿ'],
  'pill.stale': ['STALE since {time}', '{time} ರಿಂದ ಹಳೆಯದು'],
  'pill.replay': ['REPLAY', 'ಮರುಪ್ರಸಾರ'],
  'pill.replayHint': ['Local what-if replay computed in your browser. Not live data.', 'ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಲೆಕ್ಕಹಾಕಿದ ಸ್ಥಳೀಯ ಮರುಪ್ರಸಾರ. ನೇರ ಮಾಹಿತಿಯಲ್ಲ.'],
  'pill.connecting': ['CONNECTING…', 'ಸಂಪರ್ಕಿಸಲಾಗುತ್ತಿದೆ…'],
  'pill.offline': ['OFFLINE', 'ಆಫ್‌ಲೈನ್'],
  'mode.live.long': ['Model calibrated against probe observations. Not every road is measured.', 'ಮಾದರಿಯನ್ನು ಪ್ರೋಬ್ ವೀಕ್ಷಣೆಗಳೊಂದಿಗೆ ಹೊಂದಿಸಲಾಗಿದೆ. ಪ್ರತಿ ರಸ್ತೆಯನ್ನೂ ಅಳೆಯಲಾಗಿಲ್ಲ.'],
  'mode.blend.long': ['Model blended with partial probe observations. Not every road is measured.', 'ಮಾದರಿಯನ್ನು ಭಾಗಶಃ ಪ್ರೋಬ್ ವೀಕ್ಷಣೆಗಳೊಂದಿಗೆ ಬೆರೆಸಲಾಗಿದೆ. ಪ್ರತಿ ರಸ್ತೆಯನ್ನೂ ಅಳೆಯಲಾಗಿಲ್ಲ.'],
  'mode.sim.long': ['Simulated feed: a model on real road geometry, not sensor data.', 'ಅನುಕರಿಸಿದ ಮಾಹಿತಿ: ನೈಜ ರಸ್ತೆ ಜ್ಯಾಮಿತಿಯ ಮೇಲೆ ಮಾದರಿ, ಸೆನ್ಸರ್ ಮಾಹಿತಿಯಲ್ಲ.'],
  'ago.s': ['{n}s ago', '{n} ಸೆ. ಹಿಂದೆ'], 'ago.m': ['{n}m ago', '{n} ನಿ. ಹಿಂದೆ'], 'ago.h': ['{n}h ago', '{n} ಗಂ. ಹಿಂದೆ'], 'ago.d': ['{n}d ago', '{n} ದಿನ ಹಿಂದೆ'],
  'top.updated': ['updated {ago}', '{ago} ನವೀಕರಿಸಲಾಗಿದೆ'],
  'clock.aria': ['Current time, India Standard Time', 'ಪ್ರಸ್ತುತ ಸಮಯ, ಭಾರತೀಯ ಪ್ರಮಾಣಿತ ಸಮಯ'],
  'banner.offline': ['Cannot reach the server. Showing the last data from {time} IST. Retrying automatically.', 'ಸರ್ವರ್ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ. {time} IST ರ ಕೊನೆಯ ಮಾಹಿತಿ ತೋರಿಸಲಾಗುತ್ತಿದೆ. ತಾನಾಗಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲಾಗುತ್ತದೆ.'],
  'banner.offlineNoData': ['Cannot reach the server. Retrying automatically.', 'ಸರ್ವರ್ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ. ತಾನಾಗಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲಾಗುತ್ತದೆ.'],
  'banner.stale': ['The feed is stale: last update at {time} IST. Figures may not reflect current conditions.', 'ಮಾಹಿತಿ ಹಳೆಯದಾಗಿದೆ: ಕೊನೆಯ ನವೀಕರಣ {time} IST. ಅಂಕಿಅಂಶಗಳು ಪ್ರಸ್ತುತ ಸ್ಥಿತಿಯನ್ನು ತೋರಿಸದಿರಬಹುದು.'],
  'banner.maint': ['Maintenance mode is on. Only admins can use the app.', 'ನಿರ್ವಹಣಾ ಮೋಡ್ ಚಾಲನೆಯಲ್ಲಿದೆ. ನಿರ್ವಾಹಕರು ಮಾತ್ರ ಬಳಸಬಹುದು.'],
  'banner.mismatch': ['The server map version does not match this app. Reload the page; roads are not recoloured until then.', 'ಸರ್ವರ್‌ನ ನಕ್ಷೆ ಆವೃತ್ತಿ ಈ ಅಪ್ಲಿಕೇಶನ್‌ಗೆ ಹೊಂದುತ್ತಿಲ್ಲ. ಪುಟವನ್ನು ಮರುಲೋಡ್ ಮಾಡಿ; ಅಲ್ಲಿಯವರೆಗೆ ರಸ್ತೆ ಬಣ್ಣ ಬದಲಾಗುವುದಿಲ್ಲ.'],

  // ---- tabs / menus ----
  'tab.overview': ['Overview', 'ಸಾರಾಂಶ'], 'tab.station': ['Station', 'ಠಾಣೆ'], 'tab.actions': ['Actions', 'ಕ್ರಮಗಳು'], 'tab.planner': ['Planner', 'ಯೋಜಕ'], 'tab.works': ['Works', 'ಕಾಮಗಾರಿ'],
  'tab.actionsCount': ['{n} open actions', '{n} ಬಾಕಿ ಕ್ರಮಗಳು'],
  'tabs.aria': ['Inspector sections', 'ವಿವರ ವಿಭಾಗಗಳು'],
  'insp.aria': ['Inspector', 'ವಿವರ ಫಲಕ'],
  'menu.account': ['Account menu', 'ಖಾತೆ ಮೆನು'],
  'menu.admin': ['Admin site', 'ನಿರ್ವಾಹಕ ಸೈಟ್'],
  'menu.signout': ['Sign out', 'ಸೈನ್ ಔಟ್'],
  'theme.toggle': ['Switch light / dark theme', 'ಬೆಳಕು / ಕತ್ತಲೆ ಥೀಮ್ ಬದಲಿಸಿ'],
  'kbd.title': ['Keyboard shortcuts', 'ಕೀಬೋರ್ಡ್ ಶಾರ್ಟ್‌ಕಟ್‌ಗಳು'],
  'kbd.scope1': ['Whole city', 'ಇಡೀ ನಗರ'],
  'kbd.scope26': ['North, East, Central, West, South', 'ಉತ್ತರ, ಪೂರ್ವ, ಕೇಂದ್ರ, ಪಶ್ಚಿಮ, ದಕ್ಷಿಣ'],
  'kbd.search': ['Search station or road', 'ಠಾಣೆ ಅಥವಾ ರಸ್ತೆ ಹುಡುಕಿ'],
  'kbd.zoom': ['Zoom out / zoom in', 'ಜೂಮ್ ಕಡಿಮೆ / ಹೆಚ್ಚು'],
  'kbd.replay': ['Toggle replay', 'ಮರುಪ್ರಸಾರ ಆನ್/ಆಫ್'],
  'kbd.esc': ['Clear selection', 'ಆಯ್ಕೆ ತೆರವುಗೊಳಿಸಿ'],
  'kbd.help': ['Show this sheet', 'ಈ ಪಟ್ಟಿಯನ್ನು ತೋರಿಸಿ'],

  // ---- map ----
  'map.aria': ['Traffic map of Bengaluru. Use the search box and the tables to select a station or road. Arrow keys pan, plus and minus zoom.', 'ಬೆಂಗಳೂರಿನ ಸಂಚಾರ ನಕ್ಷೆ. ಠಾಣೆ ಅಥವಾ ರಸ್ತೆ ಆಯ್ಕೆಗೆ ಹುಡುಕಾಟ ಪೆಟ್ಟಿಗೆ ಮತ್ತು ಕೋಷ್ಟಕಗಳನ್ನು ಬಳಸಿ. ಬಾಣದ ಕೀಲಿಗಳಿಂದ ಸರಿಸಿ, ಪ್ಲಸ್ ಮತ್ತು ಮೈನಸ್‌ನಿಂದ ಜೂಮ್ ಮಾಡಿ.'],
  'map.region': ['Map', 'ನಕ್ಷೆ'],
  'map.search': ['Search station or road', 'ಠಾಣೆ ಅಥವಾ ರಸ್ತೆ ಹುಡುಕಿ'],
  'map.zoom': ['Zoom', 'ಜೂಮ್'], 'map.zoomIn': ['Zoom in', 'ಜೂಮ್ ಹೆಚ್ಚಿಸಿ'], 'map.zoomOut': ['Zoom out', 'ಜೂಮ್ ಕಡಿಮೆ ಮಾಡಿ'], 'map.fit': ['Fit to scope', 'ವ್ಯಾಪ್ತಿಗೆ ಹೊಂದಿಸಿ'],
  'map.loading': ['Loading modelled feed…', 'ಮಾದರಿ ಮಾಹಿತಿ ಲೋಡ್ ಆಗುತ್ತಿದೆ…'],
  'map.note': ['Modelled traffic on real road geometry, not sensor data. Crash figures are real (BTP 2018–2025).', 'ನೈಜ ರಸ್ತೆ ಜ್ಯಾಮಿತಿಯ ಮೇಲೆ ಮಾದರಿ ಸಂಚಾರ, ಸೆನ್ಸರ್ ಮಾಹಿತಿಯಲ್ಲ. ಅಪಘಾತ ಅಂಕಿಅಂಶಗಳು ನೈಜ (BTP 2018–2025).'],
  'layers.title': ['Layers', 'ಪದರಗಳು'], 'layers.cong': ['Congestion', 'ದಟ್ಟಣೆ'], 'layers.minor': ['Minor roads', 'ಸಣ್ಣ ರಸ್ತೆಗಳು'], 'layers.stn': ['Stations', 'ಠಾಣೆಗಳು'], 'layers.inc': ['Incidents', 'ಘಟನೆಗಳು'], 'layers.works': ['Works', 'ಕಾಮಗಾರಿ'],
  'layers.base': ['Basemap', 'ಬೇಸ್‌ಮ್ಯಾಪ್'], 'layers.gtraffic': ['Google live traffic (whole area, incl. Rural)', 'ಗೂಗಲ್ ಲೈವ್ ಟ್ರಾಫಿಕ್ (ಗ್ರಾಮಾಂತರ ಸೇರಿ)'], 'layers.base.plain': ['Plain (built-in)', 'ಸರಳ (ಅಂತರ್ನಿರ್ಮಿತ)'], 'layers.base.roadmap': ['Google Maps', 'ಗೂಗಲ್ ಮ್ಯಾಪ್ಸ್'], 'layers.base.hybrid': ['Google satellite', 'ಗೂಗಲ್ ಉಪಗ್ರಹ'],
  'layers.shade': ['Territory shading', 'ವ್ಯಾಪ್ತಿ ಛಾಯೆ'], 'layers.shade.none': ['None', 'ಇಲ್ಲ'], 'layers.shade.crash': ['Fatal crashes 2025', 'ಮರಣಾಂತಿಕ ಅಪಘಾತ 2025'], 'layers.shade.speed': ['Modelled speed', 'ಮಾದರಿ ವೇಗ'],
  'legend.title': ['Road load (v/c)', 'ರಸ್ತೆ ಭಾರ (v/c)'],
  'legend.free': ['Free', 'ಸುಗಮ'], 'legend.light': ['Light', 'ಹಗುರ'], 'legend.busy': ['Busy', 'ಕಾರ್ಯನಿರತ'], 'legend.slow': ['Slow', 'ನಿಧಾನ'], 'legend.jam': ['Jammed', 'ಜಾಮ್'], 'legend.grid': ['Gridlock', 'ಸ್ಥಗಿತ'],
  'legend.nofeed': ['No feed', 'ಮಾಹಿತಿ ಇಲ್ಲ'], 'legend.inc': ['Incident', 'ಘಟನೆ'], 'legend.works': ['Works', 'ಕಾಮಗಾರಿ'],
  'search.road': ['road', 'ರಸ್ತೆ'], 'search.none': ['No match', 'ಹೊಂದಾಣಿಕೆ ಇಲ್ಲ'],
  'tip.incident': ['Incident here', 'ಇಲ್ಲಿ ಘಟನೆ'],

  // ---- overview ----
  'kpi.speed': ['Avg speed', 'ಸರಾಸರಿ ವೇಗ'], 'kpi.cong': ['Congested', 'ದಟ್ಟಣೆ'], 'kpi.inc': ['Incidents', 'ಘಟನೆಗಳು'], 'kpi.open': ['Open actions', 'ಬಾಕಿ ಕ್ರಮಗಳು'], 'kpi.esc': ['Escalated', 'ಮೇಲ್ಮಟ್ಟಕ್ಕೆ'],
  'kpi.fatal': ['Fatal 2025', 'ಮರಣಾಂತಿಕ 2025'], 'kpi.nonfatal': ['Non-fatal 2025', 'ಮರಣರಹಿತ 2025'], 'kpi.rank': ['Fatal rank', 'ಮರಣಾಂತಿಕ ಶ್ರೇಣಿ'], 'kpi.liveOnly': ['live workflow', 'ನೇರ ಕಾರ್ಯಪ್ರವಾಹ'],
  'dq.cal': ['Calibrated against {probes} probes (RMSE {rmse}%).', '{probes} ಪ್ರೋಬ್‌ಗಳೊಂದಿಗೆ ಹೊಂದಿಸಲಾಗಿದೆ (RMSE {rmse}%).'],
  'dq.uncal': ['Not calibrated against probe data.', 'ಪ್ರೋಬ್ ಮಾಹಿತಿಯೊಂದಿಗೆ ಹೊಂದಿಸಿಲ್ಲ.'],
  'dq.updated': ['Updated {ago}.', '{ago} ನವೀಕರಿಸಲಾಗಿದೆ.'],
  'tl.title': ['Typical day (model) and replay', 'ಸಾಮಾನ್ಯ ದಿನ (ಮಾದರಿ) ಮತ್ತು ಮರುಪ್ರಸಾರ'], 'tl.sub': ['avg speed by hour', 'ಗಂಟೆವಾರು ಸರಾಸರಿ ವೇಗ'],
  'tl.aria': ['Modelled average speed across the day. Click to replay an hour.', 'ದಿನವಿಡೀ ಮಾದರಿ ಸರಾಸರಿ ವೇಗ. ಒಂದು ಗಂಟೆಯನ್ನು ಮರುಪ್ರಸಾರ ಮಾಡಲು ಕ್ಲಿಕ್ ಮಾಡಿ.'],
  'tl.live': ['Drag the slider or click the chart to replay an hour in your browser.', 'ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಒಂದು ಗಂಟೆ ಮರುಪ್ರಸಾರಕ್ಕೆ ಸ್ಲೈಡರ್ ಎಳೆಯಿರಿ ಅಥವಾ ಚಾರ್ಟ್ ಕ್ಲಿಕ್ ಮಾಡಿ.'],
  'replay.back': ['Back to live', 'ನೇರಕ್ಕೆ ಮರಳಿ'], 'replay.slider': ['Replay hour', 'ಮರುಪ್ರಸಾರ ಗಂಟೆ'],
  'replay.note': ['Replay: recomputed in your browser from today’s incidents and works with the calibrated model. Not live.', 'ಮರುಪ್ರಸಾರ: ಇಂದಿನ ಘಟನೆಗಳು ಮತ್ತು ಕಾಮಗಾರಿಗಳಿಂದ ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಮರುಲೆಕ್ಕ. ನೇರವಲ್ಲ.'],
  'col.region': ['Region', 'ವಿಭಾಗ'], 'col.station': ['Station', 'ಠಾಣೆ'], 'col.speed': ['km/h', 'km/h'], 'col.cong': ['Cong.', 'ದಟ್ಟಣೆ'], 'col.inc': ['Inc.', 'ಘಟನೆ'], 'col.fatal': ['Fatal', 'ಮರಣ'],
  'sec.regions': ['Regions', 'ವಿಭಾಗಗಳು'], 'sec.stations': ['Stations ({n})', 'ಠಾಣೆಗಳು ({n})'], 'sec.topRoads': ['Busiest roads now', 'ಈಗ ಅತಿ ದಟ್ಟಣೆಯ ರಸ್ತೆಗಳು'],
  'empty.roads': ['No road data yet.', 'ಇನ್ನೂ ರಸ್ತೆ ಮಾಹಿತಿ ಇಲ್ಲ.'],
  'badge.mine': ['Yours', 'ನಿಮ್ಮದು'], 'badge.esc': ['Escalated', 'ಮೇಲ್ಮಟ್ಟಕ್ಕೆ'], 'badge.high': ['High', 'ಹೆಚ್ಚು'],

  // ---- station ----
  'stn.hint': ['Click a station territory or a road on the map, or pick a station below.', 'ನಕ್ಷೆಯಲ್ಲಿ ಠಾಣೆ ವ್ಯಾಪ್ತಿ ಅಥವಾ ರಸ್ತೆ ಕ್ಲಿಕ್ ಮಾಡಿ, ಅಥವಾ ಕೆಳಗೆ ಠಾಣೆ ಆರಿಸಿ.'],
  'stn.rank': ['Rank by fatal crashes (2025)', 'ಮರಣಾಂತಿಕ ಅಪಘಾತ ಶ್ರೇಣಿ (2025)'],
  'stn.road': ['Selected road', 'ಆಯ್ದ ರಸ್ತೆ'], 'stn.plan': ['Plan closure here', 'ಇಲ್ಲಿ ಮುಚ್ಚುವ ಯೋಜನೆ'],
  'stn.trend': ['Crashes 2018–2025', 'ಅಪಘಾತಗಳು 2018–2025'], 'stn.fatalOnly': ['Fatal', 'ಮರಣಾಂತಿಕ'], 'stn.allCrashes': ['All recorded crashes', 'ದಾಖಲಾದ ಎಲ್ಲಾ ಅಪಘಾತಗಳು'],
  'stn.noHist': ['No 2018–2024 history for this station (renamed or new).', 'ಈ ಠಾಣೆಗೆ 2018–2024 ಇತಿಹಾಸ ಇಲ್ಲ (ಹೆಸರು ಬದಲಾವಣೆ ಅಥವಾ ಹೊಸದು).'],
  'stn.zoom': ['Zoom to station', 'ಠಾಣೆಗೆ ಜೂಮ್'], 'stn.outside': ['Outside your jurisdiction: view only.', 'ನಿಮ್ಮ ವ್ಯಾಪ್ತಿಯ ಹೊರಗೆ: ವೀಕ್ಷಣೆ ಮಾತ್ರ.'], 'stn.clear': ['Clear selection', 'ಆಯ್ಕೆ ತೆರವುಗೊಳಿಸಿ'],
  'cls.arterial': ['Arterial', 'ಮುಖ್ಯ ರಸ್ತೆ'], 'cls.subArterial': ['Sub-arterial', 'ಉಪ-ಮುಖ್ಯ ರಸ್ತೆ'], 'cls.collector': ['Collector', 'ಸಂಪರ್ಕ ರಸ್ತೆ'],
  'rep.open': ['Report incident', 'ಘಟನೆ ವರದಿ ಮಾಡಿ'], 'rep.type': ['Type', 'ಪ್ರಕಾರ'], 'rep.dur': ['Duration (min)', 'ಅವಧಿ (ನಿಮಿಷ)'], 'rep.note': ['Note (optional)', 'ಟಿಪ್ಪಣಿ (ಐಚ್ಛಿಕ)'], 'rep.submit': ['Report', 'ವರದಿ'], 'rep.ok': ['Incident reported.', 'ಘಟನೆ ವರದಿಯಾಗಿದೆ.'],
  'inc.type.vehicle-breakdown': ['Vehicle breakdown', 'ವಾಹನ ಕೆಟ್ಟುಹೋಗಿದೆ'], 'inc.type.accident': ['Accident', 'ಅಪಘಾತ'], 'inc.type.waterlogging': ['Waterlogging', 'ನೀರು ನಿಂತಿದೆ'],
  'inc.type.procession': ['Procession', 'ಮೆರವಣಿಗೆ'], 'inc.type.signal-fault': ['Signal fault', 'ಸಿಗ್ನಲ್ ದೋಷ'], 'inc.type.tree-fall': ['Tree fall', 'ಮರ ಬಿದ್ದಿದೆ'],

  // ---- actions ----
  'act.filter': ['Filter actions', 'ಕ್ರಮಗಳನ್ನು ಸೋಸಿ'], 'act.f.open': ['Open', 'ಬಾಕಿ'], 'act.f.all': ['All', 'ಎಲ್ಲಾ'],
  'act.count': ['{n} open · {e} escalated', '{n} ಬಾಕಿ · {e} ಮೇಲ್ಮಟ್ಟಕ್ಕೆ'],
  'act.none': ['No open actions right now.', 'ಈಗ ಬಾಕಿ ಕ್ರಮಗಳಿಲ್ಲ.'], 'act.noneHint': ['New congestion and incidents will appear here.', 'ಹೊಸ ದಟ್ಟಣೆ ಮತ್ತು ಘಟನೆಗಳು ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತವೆ.'],
  'act.ack': ['Acknowledge', 'ಸ್ವೀಕರಿಸಿ'], 'act.start': ['Start', 'ಆರಂಭಿಸಿ'], 'act.done': ['Mark done', 'ಮುಗಿದಿದೆ'], 'act.reopen': ['Reopen', 'ಮರುತೆರೆ'], 'act.resume': ['Resume', 'ಮುಂದುವರಿಸಿ'],
  'act.verifying': ['Awaiting verification', 'ದೃಢೀಕರಣಕ್ಕೆ ಕಾಯುತ್ತಿದೆ'], 'act.persist': ['Feed still shows blockage', 'ಮಾಹಿತಿ ಇನ್ನೂ ತಡೆ ತೋರಿಸುತ್ತಿದೆ'], 'act.cleared': ['Cleared · verified', 'ಸಾಮಾನ್ಯ · ದೃಢೀಕೃತ'],
  'act.map': ['Map', 'ನಕ್ಷೆ'], 'act.outside': ['Outside your jurisdiction', 'ನಿಮ್ಮ ವ್ಯಾಪ್ತಿಯ ಹೊರಗೆ'],
  'act.divert': ['Divert via {road} (v/c {vc})', '{road} ಮೂಲಕ ತಿರುಗಿಸಿ (v/c {vc})'], 'act.updated': ['Action marked {to}', 'ಕ್ರಮವನ್ನು “{to}” ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ'],
  'state.new': ['New', 'ಹೊಸದು'], 'state.ack': ['Acknowledged', 'ಸ್ವೀಕೃತ'], 'state.prog': ['In progress', 'ಪ್ರಗತಿಯಲ್ಲಿ'], 'state.done': ['Done', 'ಪೂರ್ಣ'], 'state.cleared': ['Cleared', 'ಸಾಮಾನ್ಯ'], 'state.persist': ['Persisting', 'ಮುಂದುವರಿದಿದೆ'],
  'src.sim': ['Simulated', 'ಅನುಕರಣೆ'], 'src.user': ['Reported', 'ವರದಿ'], 'src.connector': ['Connector', 'ಕನೆಕ್ಟರ್'], 'src.ingest': ['Ingested', 'ಒಳಬಂದದ್ದು'],

  // ---- AI ----
  'ai.advise': ['Advise', 'ಸಲಹೆ'], 'ai.label': ['AI-generated, verify before acting', 'AI ರಚಿತ, ಕ್ರಮ ಕೈಗೊಳ್ಳುವ ಮೊದಲು ಪರಿಶೀಲಿಸಿ'], 'ai.cached': ['cached', 'ಸಂಗ್ರಹಿತ'],
  'ai.tier.t0': ['T0 · rules', 'T0 · ನಿಯಮಗಳು'], 'ai.tier.t1': ['T1', 'T1'], 'ai.tier.t2': ['T2', 'T2'], 'ai.tier.t3': ['T3', 'T3'],
  'ai.tierHint.t0': ['Deterministic rules, no model call', 'ನಿರ್ಧಾರಾತ್ಮಕ ನಿಯಮಗಳು, ಮಾದರಿ ಕರೆ ಇಲ್ಲ'], 'ai.tierHint.t1': ['Fast model', 'ವೇಗದ ಮಾದರಿ'], 'ai.tierHint.t2': ['Standard model', 'ಪ್ರಮಾಣಿತ ಮಾದರಿ'], 'ai.tierHint.t3': ['Briefing model', 'ಸಾರಾಂಶ ಮಾದರಿ'],
  'ai.quota': ['AI calls today: {used} of {limit}', 'ಇಂದಿನ AI ಕರೆಗಳು: {limit} ರಲ್ಲಿ {used}'],
  'ai.quotaOut': ['Daily AI quota reached. Try again after the reset.', 'ದೈನಂದಿನ AI ಮಿತಿ ತಲುಪಿದೆ. ಮರುಹೊಂದಿಕೆಯ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.'],
  'ai.rate': ['Too many AI requests. Wait a moment.', 'ತುಂಬಾ AI ವಿನಂತಿಗಳು. ಸ್ವಲ್ಪ ಕಾಯಿರಿ.'],
  'ai.unavailable': ['AI advice is unavailable right now.', 'AI ಸಲಹೆ ಈಗ ಲಭ್ಯವಿಲ್ಲ.'],
  'brief.title': ['Daily briefing', 'ದೈನಂದಿನ ಸಾರಾಂಶ'], 'brief.scope': ['Scope: {scope}', 'ವ್ಯಾಪ್ತಿ: {scope}'], 'brief.generate': ['Generate briefing', 'ಸಾರಾಂಶ ರಚಿಸಿ'], 'brief.refresh': ['Refresh', 'ನವೀಕರಿಸಿ'],
  'brief.hint': ['Summarises the current picture for this scope. Generated on request.', 'ಈ ವ್ಯಾಪ್ತಿಯ ಪ್ರಸ್ತುತ ಚಿತ್ರಣದ ಸಾರಾಂಶ. ವಿನಂತಿಯ ಮೇರೆಗೆ ರಚಿಸಲಾಗುತ್ತದೆ.'], 'brief.at': ['generated {time}', '{time} ಕ್ಕೆ ರಚಿಸಲಾಗಿದೆ'],

  // ---- planner ----
  'plan.intro': ['Close or restrict a road segment and see the city-wide effect on the real road network, by time of day. Runs in your browser.', 'ರಸ್ತೆ ಭಾಗವನ್ನು ಮುಚ್ಚಿದರೆ ಅಥವಾ ನಿರ್ಬಂಧಿಸಿದರೆ ಇಡೀ ನಗರದ ನೈಜ ರಸ್ತೆ ಜಾಲದ ಮೇಲೆ, ಸಮಯವಾರು, ಆಗುವ ಪರಿಣಾಮ ನೋಡಿ. ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತದೆ.'],
  'plan.road': ['Road', 'ರಸ್ತೆ'], 'plan.run': ['Run comparison', 'ಹೋಲಿಕೆ ನಡೆಸಿ'], 'plan.empty': ['No comparison yet', 'ಇನ್ನೂ ಹೋಲಿಕೆ ಇಲ್ಲ'], 'plan.emptyHint': ['Pick a station and road, then run the comparison.', 'ಠಾಣೆ ಮತ್ತು ರಸ್ತೆ ಆರಿಸಿ, ನಂತರ ಹೋಲಿಕೆ ನಡೆಸಿ.'],
  'plan.failed': ['The computation failed. Try again.', 'ಲೆಕ್ಕಾಚಾರ ವಿಫಲವಾಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.'],
  'plan.added': ['Extra vehicle-hours per hour', 'ಗಂಟೆಗೆ ಹೆಚ್ಚುವರಿ ವಾಹನ-ಗಂಟೆಗಳು'], 'plan.close': ['Full closure', 'ಸಂಪೂರ್ಣ ಮುಚ್ಚುವಿಕೆ'], 'plan.half': ['One lane open', 'ಒಂದು ಪಥ ತೆರೆದಿದೆ'],
  'plan.advice': ['Advice:', 'ಸಲಹೆ:'],
  'plan.adviceText': ['{road}, {station}: the least disruptive window for a full closure is {win} ({best} veh-h/h) versus {peak} in the morning peak.', '{road}, {station}: ಸಂಪೂರ್ಣ ಮುಚ್ಚುವಿಕೆಗೆ ಅತಿ ಕಡಿಮೆ ಅಡಚಣೆಯ ಸಮಯ {win} ({best} veh-h/h); ಬೆಳಗಿನ ಗರಿಷ್ಠ ಸಮಯದಲ್ಲಿ {peak}.'],
  'plan.halfHelps': ['Keeping one lane open cuts the peak impact sharply.', 'ಒಂದು ಪಥ ತೆರೆದಿಟ್ಟರೆ ಗರಿಷ್ಠ ಸಮಯದ ಪರಿಣಾಮ ಬಹಳ ಕಡಿಮೆಯಾಗುತ್ತದೆ.'],
  'plan.diverted': ['Traffic shifts to', 'ಸಂಚಾರ ಹೋಗುವ ರಸ್ತೆಗಳು'], 'plan.noDivert': ['No significant diversion.', 'ಗಮನಾರ್ಹ ತಿರುವು ಇಲ್ಲ.'],
  'plan.fatalNote': ['The fatal column is the real 2025 count for that road’s police station, so diversions into already-dangerous areas stand out.', 'ಮರಣಾಂತಿಕ ಕಾಲಂ ಆ ರಸ್ತೆಯ ಠಾಣೆಯ ನೈಜ 2025 ಸಂಖ್ಯೆ; ಈಗಾಗಲೇ ಅಪಾಯಕರ ಪ್ರದೇಶಗಳತ್ತ ತಿರುವು ಎದ್ದು ಕಾಣುತ್ತದೆ.'],
  'plan.clickCell': ['Select a cell to see where traffic goes.', 'ಸಂಚಾರ ಎಲ್ಲಿಗೆ ಹೋಗುತ್ತದೆ ಎಂದು ನೋಡಲು ಕೋಶ ಆರಿಸಿ.'],
  'plan.modelNote': ['Planning-grade model, not a forecast.', 'ಯೋಜನಾ ಮಟ್ಟದ ಮಾದರಿ, ಮುನ್ಸೂಚನೆಯಲ್ಲ.'],
  'win.peakAM': ['Morning peak', 'ಬೆಳಗಿನ ಗರಿಷ್ಠ'], 'win.mid': ['Midday', 'ಮಧ್ಯಾಹ್ನ'], 'win.peakPM': ['Evening peak', 'ಸಂಜೆ ಗರಿಷ್ಠ'], 'win.night': ['Night', 'ರಾತ್ರಿ'],

  // ---- works ----
  'wk.intro': ['Register of civic works (GBA, BMRCL, utilities). Active works reduce capacity in the model, on the live map and in replay.', 'ನಾಗರಿಕ ಕಾಮಗಾರಿಗಳ ನೋಂದಣಿ (ಜಿಬಿಎ, ಬಿಎಂಆರ್‌ಸಿಎಲ್, ಸೌಲಭ್ಯ ಸಂಸ್ಥೆಗಳು). ಸಕ್ರಿಯ ಕಾಮಗಾರಿಗಳು ಮಾದರಿ, ನೇರ ನಕ್ಷೆ ಮತ್ತು ಮರುಪ್ರಸಾರದಲ್ಲಿ ಸಾಮರ್ಥ್ಯ ಕಡಿಮೆ ಮಾಡುತ್ತವೆ.'],
  'wk.count': ['{n} works', '{n} ಕಾಮಗಾರಿಗಳು'], 'wk.add': ['Add works', 'ಕಾಮಗಾರಿ ಸೇರಿಸಿ'], 'wk.edit': ['Edit works', 'ಕಾಮಗಾರಿ ಸಂಪಾದಿಸಿ'], 'wk.name': ['Name', 'ಹೆಸರು'], 'wk.namePh': ['e.g. Metro pier work', 'ಉದಾ. ಮೆಟ್ರೋ ಕಂಬ ಕಾಮಗಾರಿ'],
  'wk.from': ['From', 'ಇಂದ'], 'wk.to': ['To', 'ವರೆಗೆ'], 'wk.hours': ['Hours', 'ಸಮಯ'], 'wk.hours.all': ['All day', 'ದಿನವಿಡೀ'], 'wk.hours.peak': ['Peak hours', 'ಗರಿಷ್ಠ ಸಮಯ'], 'wk.hours.night': ['Night only', 'ರಾತ್ರಿ ಮಾತ್ರ'],
  'wk.cap': ['Capacity left (%)', 'ಉಳಿದ ಸಾಮರ್ಥ್ಯ (%)'], 'wk.capHelp': ['Share of road capacity left while the works are active (0 = closed).', 'ಕಾಮಗಾರಿ ನಡೆಯುವಾಗ ಉಳಿಯುವ ರಸ್ತೆ ಸಾಮರ್ಥ್ಯದ ಪಾಲು (0 = ಮುಚ್ಚಿದೆ).'],
  'wk.kind': ['Type', 'ಪ್ರಕಾರ'], 'wk.kind.Metro': ['Metro', 'ಮೆಟ್ರೋ'], 'wk.kind.Drain': ['Drain', 'ಚರಂಡಿ'], 'wk.kind.Bridge': ['Bridge', 'ಸೇತುವೆ'], 'wk.kind.Road': ['Road', 'ರಸ್ತೆ'], 'wk.kind.Utility': ['Utility', 'ಸೌಲಭ್ಯ'], 'wk.kind.Other': ['Other', 'ಇತರೆ'],
  'wk.agency': ['Agency', 'ಸಂಸ್ಥೆ'], 'wk.active': ['Active now', 'ಈಗ ಸಕ್ರಿಯ'], 'wk.scheduled': ['Scheduled', 'ನಿಗದಿತ'],
  'wk.src.csv': ['CSV import', 'CSV ಆಮದು'], 'wk.src.connector': ['Connector', 'ಕನೆಕ್ಟರ್'], 'wk.src.ingest': ['Ingested', 'ಒಳಬಂದದ್ದು'], 'wk.src.manual': ['Manual', 'ಕೈಯಾರೆ'],
  'wk.none': ['No works registered.', 'ಯಾವುದೇ ಕಾಮಗಾರಿ ನೋಂದಾಯಿಸಿಲ್ಲ.'], 'wk.noneHint': ['Add works to include them in the model.', 'ಮಾದರಿಯಲ್ಲಿ ಸೇರಿಸಲು ಕಾಮಗಾರಿ ಸೇರಿಸಿ.'],
  'wk.removeQ': ['Remove these works?', 'ಈ ಕಾಮಗಾರಿಯನ್ನು ತೆಗೆಯಬೇಕೇ?'], 'wk.removed': ['Works removed.', 'ಕಾಮಗಾರಿ ತೆಗೆಯಲಾಗಿದೆ.'], 'wk.added': ['Works added.', 'ಕಾಮಗಾರಿ ಸೇರಿಸಲಾಗಿದೆ.'], 'wk.saved': ['Works saved.', 'ಕಾಮಗಾರಿ ಉಳಿಸಲಾಗಿದೆ.'],
  'wk.err.required': ['Name, road and dates are required.', 'ಹೆಸರು, ರಸ್ತೆ ಮತ್ತು ದಿನಾಂಕಗಳು ಅಗತ್ಯ.'], 'wk.err.dates': ['The end date must not be before the start date.', 'ಅಂತಿಮ ದಿನಾಂಕ ಆರಂಭ ದಿನಾಂಕಕ್ಕಿಂತ ಮುಂಚೆ ಇರಬಾರದು.'],
  'wk.clash': ['Clashes', 'ಘರ್ಷಣೆಗಳು'], 'clash.none': ['No clashing works found.', 'ಘರ್ಷಣೆಯಾಗುವ ಕಾಮಗಾರಿ ಕಂಡುಬಂದಿಲ್ಲ.'],
  'clash.corridor': ['Physically connected on the same corridor', 'ಒಂದೇ ಕಾರಿಡಾರ್‌ನಲ್ಲಿ ಸಂಪರ್ಕ ಹೊಂದಿವೆ'], 'clash.station': ['Same station area: {s}', 'ಒಂದೇ ಠಾಣೆ ವ್ಯಾಪ್ತಿ: {s}'],
  'clash.quant': ['Quantify', 'ಅಳೆಯಿರಿ'], 'clash.rerun': ['Re-run', 'ಮತ್ತೆ ನಡೆಸಿ'], 'clash.alone': ['{w} alone', '{w} ಮಾತ್ರ'], 'clash.together': ['Together', 'ಒಟ್ಟಿಗೆ'], 'clash.syn': ['({n} more than the two alone add up to)', '(ಎರಡನ್ನೂ ಪ್ರತ್ಯೇಕವಾಗಿ ಕೂಡಿಸಿದ್ದಕ್ಕಿಂತ {n} ಹೆಚ್ಚು)'],
  'clash.advice': ['Together they add {together} vehicle-hours per hour at the morning peak {syn}. Consider moving "{move}" to night hours or after "{first}" ends ({end}): peak delay falls to about {solo} veh-h/h.', 'ಒಟ್ಟಿಗೆ ಅವು ಬೆಳಗಿನ ಗರಿಷ್ಠ ಸಮಯದಲ್ಲಿ ಗಂಟೆಗೆ {together} ವಾಹನ-ಗಂಟೆ ಸೇರಿಸುತ್ತವೆ {syn}. “{move}” ಅನ್ನು ರಾತ್ರಿ ಸಮಯಕ್ಕೆ ಅಥವಾ “{first}” ಮುಗಿದ ನಂತರ ({end}) ಸರಿಸಿ: ಗರಿಷ್ಠ ವಿಳಂಬ ಸುಮಾರು {solo} veh-h/h ಗೆ ಇಳಿಯುತ್ತದೆ.'],

  // ---- sign-in / gates / errors ----
  'signin.title': ['Sign in to the control room', 'ನಿಯಂತ್ರಣ ಕೊಠಡಿಗೆ ಸೈನ್ ಇನ್ ಮಾಡಿ'],
  'signin.purpose': ['Operational view of modelled road congestion, incidents, works and actions across Bengaluru’s 53 police-station territories and the four Bengaluru Rural taluks.', 'ಬೆಂಗಳೂರಿನ 53 ಪೊಲೀಸ್ ಠಾಣೆ ವ್ಯಾಪ್ತಿಗಳ ಮಾದರಿ ರಸ್ತೆ ದಟ್ಟಣೆ, ಘಟನೆಗಳು, ಕಾಮಗಾರಿಗಳು ಮತ್ತು ಕ್ರಮಗಳ ಕಾರ್ಯಾಚರಣೆ ನೋಟ.'],
  'signin.google': ['Sign in with Google', 'Google ಮೂಲಕ ಸೈನ್ ಇನ್ ಮಾಡಿ'],
  'signin.honest': ['Access is allowlist-only. Everything shown is modelled or simulated unless the banner says LIVE (modelled), and even then not every road is measured.', 'ಪ್ರವೇಶ ಅನುಮತಿ ಪಟ್ಟಿಯಲ್ಲಿರುವವರಿಗೆ ಮಾತ್ರ. ಇಲ್ಲಿ ತೋರಿಸುವುದೆಲ್ಲವೂ ಮಾದರಿ ಅಥವಾ ಅನುಕರಣೆ; ಬ್ಯಾನರ್ “ನೇರ (ಮಾದರಿ)” ಎಂದರೂ ಪ್ರತಿ ರಸ್ತೆಯನ್ನೂ ಅಳೆಯಲಾಗಿಲ್ಲ.'],
  'signin.devNote': ['Development sign-in: pick a test user. This is disabled in production.', 'ಅಭಿವೃದ್ಧಿ ಸೈನ್-ಇನ್: ಪರೀಕ್ಷಾ ಬಳಕೆದಾರರನ್ನು ಆರಿಸಿ. ಉತ್ಪಾದನೆಯಲ್ಲಿ ಇದು ನಿಷ್ಕ್ರಿಯ.'],
  'signin.devPick': ['Test users', 'ಪರೀಕ್ಷಾ ಬಳಕೆದಾರರು'], 'signin.otherEmail': ['Other email address', 'ಬೇರೆ ಇಮೇಲ್ ವಿಳಾಸ'], 'signin.go': ['Sign in', 'ಸೈನ್ ಇನ್'],
  'signin.scope.admin': ['Everything + admin site', 'ಎಲ್ಲವೂ + ನಿರ್ವಾಹಕ ಸೈಟ್'], 'signin.scope.commissioner': ['Whole city, works, briefing', 'ಇಡೀ ನಗರ, ಕಾಮಗಾರಿ, ಸಾರಾಂಶ'], 'signin.scope.dcp': ['North region only', 'ಉತ್ತರ ವಿಭಾಗ ಮಾತ್ರ'], 'signin.scope.station': ['One station, its region’s map', 'ಒಂದು ಠಾಣೆ, ಅದರ ವಿಭಾಗದ ನಕ್ಷೆ'], 'signin.scope.viewer': ['Read-only', 'ಓದಲು ಮಾತ್ರ'],
  'signin.cancelled': ['Sign-in was cancelled.', 'ಸೈನ್-ಇನ್ ರದ್ದಾಯಿತು.'], 'signin.failed': ['Sign-in failed. Try again.', 'ಸೈನ್-ಇನ್ ವಿಫಲವಾಯಿತು. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.'],
  'signin.hello': ['Welcome', 'ಸ್ವಾಗತ'], 'signin.btp': ['Bengaluru Traffic Police', 'ಬೆಂಗಳೂರು ಸಂಚಾರ ಪೊಲೀಸ್'], 'signin.sim': ['Simulated telemetry, not live data', 'ಅನುಕರಣ ಟೆಲಿಮೆಟ್ರಿ, ನೇರ ಮಾಹಿತಿಯಲ್ಲ'],
  'wl.k.commissioner': ['Commissioner · All Bengaluru', 'ಆಯುಕ್ತರು · ಇಡೀ ಬೆಂಗಳೂರು'], 'wl.k.dcp': ['DCP · {region} division', 'ಡಿಸಿಪಿ · {region} ವಿಭಾಗ'], 'wl.k.station': ['Station · {station}', 'ಠಾಣೆ · {station}'],
  'wl.k.viewer': ['Viewer · Read-only', 'ವೀಕ್ಷಕರು · ಓದಲು ಮಾತ್ರ'], 'wl.k.admin': ['Administrator · Control room', 'ನಿರ್ವಾಹಕರು · ನಿಯಂತ್ರಣ ಕೊಠಡಿ'],
  'signin.art.t': ['Real road network', 'ನೈಜ ರಸ್ತೆ ಜಾಲ'], 'signin.art.s': ['Illustration only. Traffic values are modelled.', 'ಚಿತ್ರಣ ಮಾತ್ರ. ಸಂಚಾರ ಮೌಲ್ಯಗಳು ಮಾದರಿಯವು.'],
  'gate.denied.t': ['You are not on the allowlist', 'ನೀವು ಅನುಮತಿ ಪಟ್ಟಿಯಲ್ಲಿಲ್ಲ'], 'gate.denied.d': ['This account is signed in but is not on the allowlist. Contact your admin to be added, then sign in again.', 'ಈ ಖಾತೆ ಸೈನ್ ಇನ್ ಆಗಿದೆ ಆದರೆ ಅನುಮತಿ ಪಟ್ಟಿಯಲ್ಲಿಲ್ಲ. ಸೇರಿಸಲು ನಿಮ್ಮ ನಿರ್ವಾಹಕರನ್ನು ಸಂಪರ್ಕಿಸಿ, ನಂತರ ಮತ್ತೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.'],
  'gate.unauth.t': ['Your session has ended', 'ನಿಮ್ಮ ಸೆಷನ್ ಮುಗಿದಿದೆ'], 'gate.unauth.d': ['Sign in again to continue.', 'ಮುಂದುವರಿಯಲು ಮತ್ತೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.'],
  'gate.maint.t': ['Down for maintenance', 'ನಿರ್ವಹಣೆಗಾಗಿ ಸ್ಥಗಿತ'], 'gate.maint.d': ['The control room is in maintenance mode. This page checks again automatically.', 'ನಿಯಂತ್ರಣ ಕೊಠಡಿ ನಿರ್ವಹಣಾ ಮೋಡ್‌ನಲ್ಲಿದೆ. ಈ ಪುಟ ತಾನಾಗಿ ಮತ್ತೆ ಪರಿಶೀಲಿಸುತ್ತದೆ.'],
  'gate.offline.t': ['Cannot reach the service', 'ಸೇವೆ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ'], 'gate.offline.d': ['Check your connection. This page retries automatically.', 'ನಿಮ್ಮ ಸಂಪರ್ಕ ಪರಿಶೀಲಿಸಿ. ಈ ಪುಟ ತಾನಾಗಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸುತ್ತದೆ.'],
  'gate.error.t': ['Something went wrong', 'ಏನೋ ತಪ್ಪಾಗಿದೆ'], 'gate.error.d': ['The app could not start. Try again, and contact your admin if it persists.', 'ಅಪ್ಲಿಕೇಶನ್ ಆರಂಭವಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ; ಮುಂದುವರಿದರೆ ನಿಮ್ಮ ನಿರ್ವಾಹಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.'],
  'err.forbidden': ['You do not have permission for that.', 'ಅದಕ್ಕೆ ನಿಮಗೆ ಅನುಮತಿ ಇಲ್ಲ.'], 'err.conflict': ['That changed elsewhere. The list was refreshed.', 'ಅದು ಬೇರೆಡೆ ಬದಲಾಗಿದೆ. ಪಟ್ಟಿ ನವೀಕರಿಸಲಾಗಿದೆ.'],
  'err.network': ['Cannot reach the server. Nothing was saved.', 'ಸರ್ವರ್ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ. ಏನೂ ಉಳಿಸಿಲ್ಲ.'], 'err.unauth': ['Your session expired. Sign in again.', 'ನಿಮ್ಮ ಸೆಷನ್ ಮುಗಿದಿದೆ. ಮತ್ತೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.'], 'err.generic': ['Something went wrong.', 'ಏನೋ ತಪ್ಪಾಗಿದೆ.'],
};

let lang = 'en';
export const setI18nLang = (l) => { lang = l === 'kn' ? 'kn' : 'en'; };
export const getI18nLang = () => lang;
export const KEYS = Object.keys(D);
export const DICT = D;

export function t(key, vars) {
  const e = D[key]; let s = e ? e[lang === 'kn' ? 1 : 0] : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}
export const regionName = (r) => (D[`reg.${r}`] ? t(`reg.${r}`) : String(r ?? ''));
export const roleLabel = (r) => (D[`role.${r}`] ? t(`role.${r}`) : String(r ?? ''));
export function typeName(type) {
  const key = `inc.type.${String(type ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return D[key] ? t(key) : String(type ?? '');
}

/** Localised relative time. */
export function agoText(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  return s < 90 ? t('ago.s', { n: Math.round(s) }) : s < 5400 ? t('ago.m', { n: Math.round(s / 60) }) : s < 129600 ? t('ago.h', { n: Math.round(s / 3600) }) : t('ago.d', { n: Math.round(s / 86400) });
}
