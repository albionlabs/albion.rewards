# Asset-token metadata schema

`asset-token.schema.json` (draft-07) is the unified metadata schema for an Albion
tokenised energy revenue interest. **One shape spans the whole lifecycle:**

- **Development-stage** assets (e.g. Earlham) carry a `developmentStage` block
  (FDP roadmap, conditions precedent, development commitments) and leave the
  actuals arrays (`payoutData`, `historicalProduction`, `receiptsData`) empty.
- **Producing** assets (e.g. Wressle) omit `developmentStage`, populate the
  actuals arrays, and carry producing KPIs (`uptimePct`, `incidentFreeDays`) in
  `operationalMetrics`.

`status` is the coarse render/logic switch (`development` | `producing` | ...);
the granular position within development lives in `developmentStage`.

## Examples
- `example.earlham.json` — development-stage gas discovery
- `example.wressle.json` — producing onshore oil royalty

Validate with any draft-07 validator, e.g.:

    npx ajv-cli validate -s asset-token.schema.json -d example.earlham.json
