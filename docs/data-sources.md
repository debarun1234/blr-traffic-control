# Data sources and honesty notes

| Data | Source | Status |
|---|---|---|
| Roads | OpenStreetMap contributors, ODbL. Attribution must stay visible in the app | Real |
| Police stations (53) | Public station listing; 6 coordinates approximate | Verify and override in Admin > Stations |
| Bengaluru Rural (4 taluk units) | Territories: official KGIS taluk boundaries (Karnataka GIS, via source.coop; check its licence) for Devanahalli, Doddaballapura, Hoskote and Nelamangala, minus the city territory. Roads: OpenStreetMap (Geofabrik southern-zone extract), motorway to tertiary | Real roads and boundaries. The units are taluks, not police stations: no Rural station list was used. No crash data (shown as a dash). Confirm the Commissionerate's jurisdiction covers them |
| Station territories | Voronoi around station points, clipped to the city boundary | Approximate; upload official boundaries to `territories/current` |
| Crash statistics | Bengaluru Traffic Police 2018–2025 via OpenCity | Real, aggregate per station |
| Traffic speeds and congestion | Built-in model | Modelled unless calibrated with probes |
| Incidents, works | Simulated seed data, or entered/imported | Real only when entered or connected |
| Kannada text | Written by the authors | Needs native-speaker review |

Rebuild the map: `tools/mapdata` (`prep.py`, `graph12.py`, `final.py`, `stations.py`), needs Python and the input files in `tools/mapdata/data`.

Rebuild with Rural: `prep.py` (city) → `python3 extract_osm.py <southern-zone.osm.pbf> data/raw/work` (about 80 s, resumable, needs `pip install osmium numpy`) → `python3 rural.py` (adds the four taluk units and their roads to `stage1.json`; keeps a city-only copy as `stage1.city.json`) → `graph12.py` → `final.py`. Copy `map.json` to `packages/mapdata/`.
