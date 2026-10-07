# Data sources and honesty notes

| Data | Source | Status |
|---|---|---|
| Roads | OpenStreetMap contributors, ODbL. Attribution must stay visible in the app | Real |
| Police stations (53) | Public station listing; 6 coordinates approximate | Verify and override in Admin > Stations |
| Station territories | Voronoi around station points, clipped to the city boundary | Approximate; upload official boundaries to `territories/current` |
| Crash statistics | Bengaluru Traffic Police 2018–2025 via OpenCity | Real, aggregate per station |
| Traffic speeds and congestion | Built-in model | Modelled unless calibrated with probes |
| Incidents, works | Simulated seed data, or entered/imported | Real only when entered or connected |
| Kannada text | Written by the authors | Needs native-speaker review |

Rebuild the map: `tools/mapdata` (`prep.py`, `graph12.py`, `final.py`, `stations.py`), needs Python and the input files in `tools/mapdata/data`.
