## Server Scripts

Files in this folder are operational or diagnostic utilities.

They are **not** part of the request-serving runtime path.

### Current intent

- `replay-pipeline-suite.ts`
- `replay-pipeline.ts`
- `replay-strategic-context-suite.ts`
- `validate-production-readiness-real.ts`

### Data-driven pipeline improvement (Step 0–1)

- `npm run data-driven:coverage` — JSON report of recommendation snapshot coverage vs settled-replay export filters (`--lookback-days`, `--out-json`).
- `npm run data-driven:replay-batch` — writes `replay-work/data-driven-runs/<runId>/`: `coverage.json`, `run-spec.json`, scenarios, eval reports, and (unless `--no-post-summarize`) `replay-vs-original.json` + `cases-flat.csv` (variant 0). Unless `--no-post-segment-hotspots`, also writes `segment-hotspots.json` (variant 0: minute band × market family rollups). Default `--llm mock`; real: `--llm real --allow-real-llm`. `--apply-replay-policy` for production parity after parse.
- `npm run data-driven:summarize-vs-original` — `--cases-json <eval-cases.json> [--out-json] [--out-csv] [--csv-variant-index N]` for Step 2 delta vs production outcomes on an existing run.
- `npm run data-driven:check-gates` — Step 3: `--config data-driven-replay-gates.json` (copy from `data-driven-replay-gates.example.json`, set `deltaPath` + `promptVersion` + thresholds); exit 1 if replay-vs-original metrics regress.
- `npm run data-driven:segment-hotspots` — `--cases-json <eval-cases.json> [--variant-index 0] [--out-json ...] [--min-settled N] [--min-staked N]` for segment rollups on an existing eval run (same logic as batch `segment-hotspots.json`).

Use these only for:

- replay
- validation
- benchmarking
- diagnostics

Do not treat them as required production workflow steps.
If the application only works after manually running one of these scripts, that is a product/runtime bug and should be fixed in the server jobs or routes instead.
