# Data sources and honesty notes

| Data | Source | Status |
|---|---|---|
| Roads | OpenStreetMap contributors, ODbL. Attribution must stay visible in the app | Real |
| Police stations (53) | Public station listing; 6 coordinates approximate | Verify and override in Admin > Stations |
| Outer area, "Rural" scope (9 taluk units) | Territories: official KGIS taluk boundaries (Karnataka GIS, via source.coop; check its licence) for Devanahalli, Doddaballapura, Hoskote and Nelamangala (Bangalore Rural) and Anekal, Bengaluru South, Bengaluru North, Bengaluru East and Yelahanka (Bengaluru Urban district), each minus the city territory. Roads: OpenStreetMap (Geofabrik southern-zone extract), motorway to residential | Real roads and boundaries. The units are taluks, not police stations: no station list was used. No crash data (shown as a dash). Confirm the Commissionerate's jurisdiction covers them |
| Station territories | Voronoi around station points, clipped to the city boundary | Approximate; upload official boundaries to `territories/current` |
| Crash statistics | Bengaluru Traffic Police 2018–2025 via OpenCity | Real, aggregate per station |
| Traffic speeds and congestion | Built-in model | Modelled unless calibrated with probes. Applies to the Rural area too, where it is least reliable |
| Incidents, works | Simulated seed data, or entered/imported | Real only when entered or connected |
| Kannada text | Written by the authors | Needs native-speaker review |

## Rebuilding the map

Inputs live in `tools/mapdata/data` (`boundary.txt`, `police.json`, `roads.json`, `crash_2018_2025.json`, `rural_taluks.json`). Large raw files go in `data/raw/`, which is git-ignored and must never be committed. Needs Python 3 with `numpy`, `scipy`, `shapely`, `networkx` and `osmium`. `rural_taluks.json` was converted once from the KGIS `Taluk.parquet` (EPSG:32643 to EPSG:4326; needs `pyarrow` and `pyproj`) and is checked in.

1. City: `python3 prep.py` (uses the station list in `stations.py`, the boundary and OSM roads; writes `stage1.json`).
2. Outer area: download the Geofabrik southern-zone `.osm.pbf`, then `python3 extract_osm.py <file.osm.pbf> data/raw/work4` (bbox 12.55, 77.15 to 13.55, 78.10; resumable and time-budgeted: re-run until it finishes). It writes `rural_osm.json`.
3. `python3 rural.py` adds the nine outer units, their roads, residential streets near and inside the city, and snaps road ends so city and outer roads connect. It keeps a city-only copy as `stage1.city.json` and is re-runnable.
4. `python3 graph12.py` then `python3 final.py` write `map.json`; copy it to `packages/mapdata/map.json` and rebuild the web apps.

Road classes in `map.json`: 0 to 2 are routable (motorway/trunk, primary, secondary); 3 (tertiary, unclassified) and 4 (residential, living street) are draw-only, and class 4 is shown only when zoomed in.

## Corrections applied after the pipeline (`tools/mapdata/apply_fixes.py`)

The raw OSM extracts for the outer taluks are not kept in the repo, so `packages/mapdata/map.json` is corrected in place by an idempotent script rather than by re-running the whole pipeline.

- **Byatarayanapura traffic police station** is on Mysuru Road and belongs to the West traffic division. The Ballari Road stretch between Hebbal and Yelahanka (also called Byatarayanapura) is policed by Hebbal traffic police (North). The station point is an approximation (Mysuru Road near the Gali Anjaneya temple); replace it with the station's surveyed coordinates when available. Territories of the neighbouring stations and the ownership of the roads in the changed areas were recomputed.
- **Road names** use current official spellings (Ballari, Bengaluru, Mysuru, Tumakuru, Mangaluru, Hosakote, Sarjapura, Varthuru) and obvious non-road names from OSM are dropped. Names are otherwise as in OpenStreetMap.
