This directory holds replay / odds-audit baselines referenced from docs/live-monitor-ai-ou-under-bias.md.

Committed files:
- last-odds-audit-smoke.json — audit-replay-odds-integrity on fixtures/odds-audit-smoke (expects 1 contaminated row).
- last-odds-audit-structural-replay.json — same audit on fixtures/settled-replay-structural (expect 0 contaminated).
- structural-replay-summary.json / structural-replay-summary.md — evaluate-settled-prompt-variants (v8 vs v10, --llm mock) on structural fixtures.
- structural-replay-cases.json — per-case payload for the same run.
- structural-market-opportunities.json / structural-market-opportunities.md — audit-replay-market-opportunities on structural fixtures.

Regenerate (from packages/server):
  npm run replay:fixtures:structural
  npm run replay:eval:structural
  npm run replay:audit:odds:smoke
  npm run replay:audit:odds:structural

Full integration (export + Step B real LLM + Step C self-audit + odds audit), using DATABASE_URL and GEMINI_API_KEY from repo/server .env:

  cd packages/server
  npm run replay:ou-under:integration
  npm run replay:ou-under:integration:structural

Writes integration-*.json/md here and uses gitignored replay-work/ for export + LLM cache.
