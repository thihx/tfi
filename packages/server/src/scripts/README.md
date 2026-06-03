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
- `npm run data-driven:replay-batch` — writes `replay-work/data-driven-runs/<runId>/`: `coverage.json`, `run-spec.json`, scenarios, eval reports, and (unless `--no-post-summarize`) `replay-vs-original.json` + `cases-flat.csv` (variant 0). Unless `--no-post-segment-hotspots`, also writes `segment-hotspots.json` (variant 0: minute band × market family rollups) and `segment-action-plan.json` (quality blockers plus reviewable block/cap/review candidates). Default `--llm mock`; real: `--llm real --allow-real-llm`. `--apply-replay-policy` for production parity after parse. If `LIVE_ANALYSIS_*_PROMPT_VERSION` env vars are unset, eval falls back to code default `LIVE_ANALYSIS_PROMPT_VERSION` (`v10-hybrid-legacy-g`).
- `npm run data-driven:improvement-run` — preset batch for analysis/improvement loops: `--lookback-days 14`, `--limit 50`, `--max-scenarios 30`, mock LLM, `odds recorded`, `--apply-replay-policy`. Same outputs as `replay-batch`; read `replay-vs-original.json`, `segment-hotspots.json`, `segment-action-plan.json`, `eval-summary.md`, and `cases-flat.csv` first to prioritize prompt or segment policy changes.
- `npm run data-driven:improvement-run-real` — same shape as above but **`--llm real`** (needs `GEMINI_API_KEY`, smaller cap: 15 scenarios, 1.2s delay). Writes **`llm-cache/*.json`** per case (`aiText`, `prompt`, `selection`) even when `should_push` is false — use these to audit refusals (e.g. “no usable odds”) vs snapshot shape. Increase `--max-scenarios` only deliberately (cost/latency).
- `npm run data-driven:fast-hotspot-real` — quick hotspot gate (real LLM): 10-day window, 80 scenarios, faster delay. Best for short inner-loop checks right after policy/prompt edits.
- `npm run data-driven:fast-smoke-real` — wider smoke gate (real LLM): 10-day window, 150 scenarios, medium delay. Use after hotspot pass to catch regressions before full 400.
- `npm run data-driven:fast-gate-real` — sequential `fast-hotspot-real` + `fast-smoke-real` as a single command.
- `npm run data-driven:summarize-vs-original` — `--cases-json <eval-cases.json> [--out-json] [--out-csv] [--csv-variant-index N]` for Step 2 delta vs production outcomes on an existing run.
- `npm run data-driven:check-gates` — Step 3: `--config data-driven-replay-gates.json` (copy from `data-driven-replay-gates.example.json`, set `deltaPath` + `promptVersion` + thresholds); exit 1 if replay-vs-original metrics regress.
- `npm run data-driven:segment-hotspots` — `--cases-json <eval-cases.json> [--variant-index 0] [--out-json ...] [--min-settled N] [--min-staked N]` for segment rollups on an existing eval run (same logic as batch `segment-hotspots.json`).
- `npm run data-driven:check-segment-gates` — Step 4b: `--config data-driven-segment-gates.json` (copy from `data-driven-segment-gates.example.json`, set `hotspotPath` + optional `promptVersion` + per-segment `rules`); exit 1 if hotspot metrics breach thresholds.
- `npm run data-driven:check-quality-gates` — Step 4c: `--config data-driven-quality-gates.json` (or CI config). Reads `segment-action-plan.json` and fails when replay has too much provider coverage mismatch or replay context gap before prompt/policy tuning.
- `npm run data-driven:verify-gates-ci` — same checks as CI: `ci-baselines/data-driven-gates/gates-delta.ci.json` + `gates-segment.ci.json` (static JSON, UTF-8). Repo root `npm run verify:ci` runs server+client typecheck/tests plus this.
- **GitHub Actions (on demand):** `.github/workflows/data-driven-db-coverage.yml` — Postgres service, `npm run migrate`, then `data-driven:coverage` writing `replay-work/ci-artifacts/snapshot-coverage.json` and uploading artifact `data-driven-snapshot-coverage` (empty DB is valid; counts are zero).
- **Runtime segment blocklist** (optional): set `SEGMENT_POLICY_BLOCKLIST_PATH` to a JSON file like `segment-policy-blocklist.example.json` (`minuteBand::marketFamily` keys). Live pipeline policy will block matching recommendations.
- **Runtime segment stake cap** (optional): `SEGMENT_POLICY_STAKE_CAP_PATH` → `segment-policy-stake-cap.example.json` (`caps` map). Matching segments get `min(modelStake, cap)` with warning `POLICY_WARN_SEGMENT_STAKE_CAP` (blocklist still wins if both apply).
- **Line Ladder Patience** (default on): `LINE_PATIENCE_ENABLED` (`false` to disable). Optional `LINE_PATIENCE_CONFIG_PATH` → `line-patience-policy.example.json`. Runs after AI parse, before `applyRecommendationPolicy` — see [line-ladder-patience-spec.md](../../../docs/line-ladder-patience-spec.md).
- **Thesis watch** (default on, requires LLP): `THESIS_WATCH_ENABLED`, `THESIS_WATCH_TTL_MINUTES`. Persists LLP deferrals and promotes on the next cycle without a second LLM call — see spec Phase 2.
- `npm run data-driven:suggest-segment-blocklist` — `--hotspots-json <segment-hotspots.json>` prints JSON `{ segmentKeys }` (default: union top 8 worst-accuracy + top 8 worst-ROI rows). Tighten with `--max-accuracy`, `--max-roi`, `--worst-accuracy-top 0` to disable a source, `--out-json <file>` to write.
- `npm run data-driven:action-plan -- --hotspots-json <segment-hotspots.json> [--eval-cases-json <eval-cases.json>] [--out-json <file>]` — builds a reviewable quality action plan from segment hotspots. With `--eval-cases-json`, it also writes `qualityBlockers` (decision diagnostics, market-resolution status, top warnings, and representative unresolved/policy-blocked cases), which is important when replay has zero actionable pushes. Severe underperformers become blocklist candidates, moderate weak segments become stake-cap candidates, and production-loss segments that replay still wants are flagged for prompt/provider review. It does not modify runtime policy files; copy accepted candidates into `SEGMENT_POLICY_BLOCKLIST_PATH` / `SEGMENT_POLICY_STAKE_CAP_PATH` deliberately.
- Replay quality attribution fields in `eval-cases.json` / `cases-flat.csv`: `provider_coverage` means the recorded provider snapshot did not have the requested historical line; `replay_context_gap` means replay lacked context such as performance memory; `pre_llm_blocked` means the auto-LLM eligibility firewall skipped the call before any model response; `model_policy_mismatch` means the model proposed a bet in a hard-policy zone already exposed by runtime preflight prompt context; `hard_policy_gate` means odds resolved but a remaining post-parse policy gate blocked. Treat provider/context rows as diagnostics before changing prompt or segment policy.
- Runtime save integrity: recommendation saves now record `saveIntegrityStatus`, `saveProviderCoverageStatus`, `saveMarketResolutionStatus`, `saveMappedOdd`, `savedSelection`, and `savedBetMarket` in `decision_context`. If the save candidate cannot be proven against canonical provider odds, the pipeline audits `RECOMMENDATION_SAVE_BLOCKED_PROVIDER_COVERAGE` and does not create a recommendation row.
- `npm run data-driven:memory-rebuild` rebuilds `recommendation_performance_memory` from trusted settled recommendations. Run before replay analysis when `segment-action-plan.json` shows `memory_no_history`; it prints source rows, aggregate groups, total samples, and reliable groups.
- `npm run provider:coverage-audit --prefix packages/server -- --lookback-days 180 --limit 500` replays stored `provider_odds_samples.normalized_payload` through the current coverage classifier and canonical odds builder. Use `--fail-on-mismatch` for a hard gate and `--out-json <path>` to persist the report. This proves whether stored provider coverage flags are consistent with canonical markets without spending real provider quota. The report separates raw provider availability (`raw_has_*`) from canonical tradable availability (`canonical_has_*`).
- `npm run provider:coverage-backfill --prefix packages/server -- --lookback-days 180 --limit 1000` dry-runs a recomputation of `provider_odds_samples.coverage_flags` from stored normalized payloads. Add `--apply` only when you intentionally want to correct historical sample flags used by Ops Monitoring. Backfilled flags keep legacy `has_*` raw semantics and add explicit `raw_has_*` / `canonical_has_*` fields.

Use these only for:

- replay
- validation
- benchmarking
- diagnostics

Do not treat them as required production workflow steps.
If the application only works after manually running one of these scripts, that is a product/runtime bug and should be fixed in the server jobs or routes instead.
