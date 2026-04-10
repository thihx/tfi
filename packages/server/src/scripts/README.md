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
- `npm run data-driven:replay-batch` — writes `replay-work/data-driven-runs/<runId>/`: `coverage.json`, `run-spec.json`, exported scenario JSONs, then runs `evaluate-settled-prompt-variants` (default `--llm mock`; real LLM: `--llm real --allow-real-llm`). Use `--apply-replay-policy` for production parity after parse.

Use these only for:

- replay
- validation
- benchmarking
- diagnostics

Do not treat them as required production workflow steps.
If the application only works after manually running one of these scripts, that is a product/runtime bug and should be fixed in the server jobs or routes instead.
