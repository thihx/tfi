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
- `npm run data-driven:replay-batch` — writes `replay-work/data-driven-runs/<runId>/`: `coverage.json`, `run-spec.json`, scenarios, eval reports, and (unless `--no-post-summarize`) `replay-vs-original.json` + `cases-flat.csv` (variant 0). Unless `--no-post-segment-hotspots`, also writes `segment-hotspots.json` (variant 0: minute band × market family rollups). Default `--llm mock`; real: `--llm real --allow-real-llm`. `--apply-replay-policy` for production parity after parse. If `LIVE_ANALYSIS_*_PROMPT_VERSION` env vars are unset, eval falls back to code default `LIVE_ANALYSIS_PROMPT_VERSION` (`v10-hybrid-legacy-b`).
- `npm run data-driven:improvement-run` — preset batch for analysis/improvement loops: `--lookback-days 14`, `--limit 50`, `--max-scenarios 30`, mock LLM, `odds recorded`, `--apply-replay-policy`. Same outputs as `replay-batch`; use `replay-vs-original.json`, `segment-hotspots.json`, `eval-summary.md`, and `cases-flat.csv` to prioritize prompt or segment policy changes.
- `npm run data-driven:improvement-run-real` — same shape as above but **`--llm real`** (needs `GEMINI_API_KEY`, smaller cap: 15 scenarios, 1.2s delay). Writes **`llm-cache/*.json`** per case (`aiText`, `prompt`, `selection`) even when `should_push` is false — use these to audit refusals (e.g. “no usable odds”) vs snapshot shape. Increase `--max-scenarios` only deliberately (cost/latency).
- `npm run data-driven:fast-hotspot-real` — quick hotspot gate (real LLM): 10-day window, 80 scenarios, faster delay. Best for short inner-loop checks right after policy/prompt edits.
- `npm run data-driven:fast-smoke-real` — wider smoke gate (real LLM): 10-day window, 150 scenarios, medium delay. Use after hotspot pass to catch regressions before full 400.
- `npm run data-driven:fast-gate-real` — sequential `fast-hotspot-real` + `fast-smoke-real` as a single command.
- `npm run data-driven:summarize-vs-original` — `--cases-json <eval-cases.json> [--out-json] [--out-csv] [--csv-variant-index N]` for Step 2 delta vs production outcomes on an existing run.
- `npm run data-driven:check-gates` — Step 3: `--config data-driven-replay-gates.json` (copy from `data-driven-replay-gates.example.json`, set `deltaPath` + `promptVersion` + thresholds); exit 1 if replay-vs-original metrics regress.
- `npm run data-driven:segment-hotspots` — `--cases-json <eval-cases.json> [--variant-index 0] [--out-json ...] [--min-settled N] [--min-staked N]` for segment rollups on an existing eval run (same logic as batch `segment-hotspots.json`).
- `npm run data-driven:check-segment-gates` — Step 4b: `--config data-driven-segment-gates.json` (copy from `data-driven-segment-gates.example.json`, set `hotspotPath` + optional `promptVersion` + per-segment `rules`); exit 1 if hotspot metrics breach thresholds.
- `npm run data-driven:verify-gates-ci` — same checks as CI: `ci-baselines/data-driven-gates/gates-delta.ci.json` + `gates-segment.ci.json` (static JSON, UTF-8). Repo root `npm run verify:ci` runs server+client typecheck/tests plus this.
- **GitHub Actions (on demand):** `.github/workflows/data-driven-db-coverage.yml` — Postgres service, `npm run migrate`, then `data-driven:coverage` writing `replay-work/ci-artifacts/snapshot-coverage.json` and uploading artifact `data-driven-snapshot-coverage` (empty DB is valid; counts are zero).
- **Runtime segment blocklist** (optional): set `SEGMENT_POLICY_BLOCKLIST_PATH` to a JSON file like `segment-policy-blocklist.example.json` (`minuteBand::marketFamily` keys). Live pipeline policy will block matching recommendations.
- **Runtime segment stake cap** (optional): `SEGMENT_POLICY_STAKE_CAP_PATH` → `segment-policy-stake-cap.example.json` (`caps` map). Matching segments get `min(modelStake, cap)` with warning `POLICY_WARN_SEGMENT_STAKE_CAP` (blocklist still wins if both apply).
- `npm run data-driven:suggest-segment-blocklist` — `--hotspots-json <segment-hotspots.json>` prints JSON `{ segmentKeys }` (default: union top 8 worst-accuracy + top 8 worst-ROI rows). Tighten with `--max-accuracy`, `--max-roi`, `--worst-accuracy-top 0` to disable a source, `--out-json <file>` to write.

Use these only for:

- replay
- validation
- benchmarking
- diagnostics

Do not treat them as required production workflow steps.
If the application only works after manually running one of these scripts, that is a product/runtime bug and should be fixed in the server jobs or routes instead.
