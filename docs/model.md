# Traffic model

`packages/model` is a deterministic, dependency-free JavaScript model shared by the API, worker and the Control app (replay mode runs it in the browser).

- **Network.** Routable graph built from OpenStreetMap roads (`tools/mapdata`). One map unit is about 2.2 m.
- **Link time.** BPR: `t = t0 * (1 + 0.15 * (v/c)^4)`, with `v/c` the volume to capacity ratio. Capacity is scaled by incident and works multipliers.
- **Demand.** Gravity model among 64 centroids (7 hubs, the 53 station areas and the 4 Rural taluk units), total demand 300,000 trips, shaped by an hourly tide factor (`wt`) for the day profile.
- **Assignment.** Method of successive averages over shortest paths.
- **Calibration.** Bisection of a global demand scale against probe observations (corridor minutes). Without probe data the state is labelled modelled/simulated, never live.
- **State encoding.** Per edge `v/c` (uint8, x100) and speed (uint8, km/h), base64, so `state/current` stays one small document.
- **Incidents.** `simIncidents` generates seeded, repeatable demo incidents; real ones come from officers, connectors or `/ingest/v1/events`.

## Limits

The model has not been calibrated against real Bengaluru probe data. Absolute speeds are indicative; relative effects (a closure or works clash shifting load) are the intended use. Treat outputs as decision support, not measurement. Calibrate using Google Routes or TomTom probes (see the integration guide) and review the fit in the Admin site before any operational use.
