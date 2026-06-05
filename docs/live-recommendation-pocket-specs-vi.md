# Live Recommendation Pocket Specs

**Updated:** 2026-06-06  
**Contract:** [live-recommendation-guard-relaxation-contract-vi.md](./live-recommendation-guard-relaxation-contract-vi.md)  
**Audit matrix:** [live-recommendation-rule-audit-matrix-vi.md](./live-recommendation-rule-audit-matrix-vi.md)

Tai lieu nay dinh nghia cac pocket duoc phep trien khai/review. Pocket nao chua pass promotion gate thi khong duoc save/notify mac dinh.

## Pocket: `balanced_live_value_v1`

```text
Pocket ID: balanced_live_value_v1
Owner / date: Codex / 2026-06-06
Reason:
  Live betting edge khong dong nghia voi odds cao. Pocket nay cho phep test odds 1.65-2.00 trong cua so live rat hep, nhung khong ha global break-even guard.

Market family:
  goals_over, asian_handicap
Canonical markets:
  over_1.5
  asian_handicap_home_+0.25, asian_handicap_home_+0.5, asian_handicap_home_+0.75
  asian_handicap_home_-0.25, asian_handicap_home_-0.5, asian_handicap_home_-0.75
  asian_handicap_away_+0.25, asian_handicap_away_+0.5, asian_handicap_away_+0.75
  asian_handicap_away_-0.25, asian_handicap_away_-0.5, asian_handicap_away_-0.75
Minute band:
  over_1.5: 60-84
  asian_handicap: 45-84
Score state:
  over_1.5: one-goal margin only
  asian_handicap: level or one-goal margin only
Evidence mode:
  full_live_data only
Allowed odds range:
  1.65-2.00
Minimum confidence:
  7
Minimum value_percent:
  7
Risk-level rule:
  risk_level must not be HIGH
Required live signals:
  canonical market resolved
  odds mapped from canonical provider snapshot
  directionalWin=true unless an existing later hard guard blocks
  breakEvenRate present or derivable from odds
Forbidden contexts:
  unknown market
  odds unavailable/unmapped/suspicious/below min
  degraded evidence modes
  BTTS, corners, 1X2, broad goals Under, HT markets
  high-risk market set
  two-plus margin AH
  same-thesis or segment blocklist violation
Stake cap:
  POLICY_BALANCED_LIVE_MAX_STAKE_PERCENT, default 2
Warning key:
  POLICY_MATCH_BALANCED_LIVE_VALUE_POCKET
  POLICY_CAP_BALANCED_LIVE_VALUE_STAKE when stake is capped
Kill switch / env:
  POLICY_BALANCED_LIVE_ENABLED=true
  POLICY_BALANCED_LIVE_MIN_ODDS=1.65
  POLICY_BALANCED_LIVE_MAX_ODDS=2.00
  POLICY_BALANCED_LIVE_MIN_CONFIDENCE=7
  POLICY_BALANCED_LIVE_MIN_EDGE=7
  POLICY_BALANCED_LIVE_MAX_STAKE_PERCENT=2

Before benchmark path:
  packages/server/replay-work/audit/20260606-022250/current-runtime-blocked-selection.json
  packages/server/replay-work/audit/20260606-022250/pipeline-liveness.json
  packages/server/replay-work/audit/20260606-022250/current-runtime-no-save.json
After benchmark path:
  packages/server/replay-work/balanced-live-policy/20260606-contract/balanced-live-policy-benchmark.json
  packages/server/replay-work/balanced-live-policy/20260606-contract/balanced-live-policy-benchmark.md
Promotion evidence:
  Not satisfied. Current audit counterfactual has 0 real candidates after applying minute/full-live/confidence filters.
  Runtime default must remain disabled until a new settled cohort passes the promotion gate.
Rollback condition:
  Set POLICY_BALANCED_LIVE_ENABLED=false or unset the env.
  Roll back if saved recommendations spike, ROI/hit rate deteriorates, duplicate/same-thesis warnings increase, provider/LLM calls exceed budget, or market-resolution/save-integrity warnings increase.
```

Implementation status:

- Implemented in `packages/server/src/lib/recommendation-policy.ts`.
- Default disabled in `packages/server/src/config.ts`.
- Prompt text mentions the pocket only as explicitly enabled runtime policy.
- Unit tests cover kill-switch off, allowed Over 1.5, allowed AH, wrong AH score state, wrong market, degraded evidence, stake cap, and warning key.
- Benchmark script supports `--enable-balanced-pocket` for counterfactual only; it does not call provider or LLM.

Promotion status:

- `opt_in_only`, not production-default.
- Meets deterministic policy-smoke expectations when enabled.
- Does not meet production promotion gate because sample size is below default `>=20` settled rows.

## Pocket: `medium_risk_thin_edge_shadow_v1`

```text
Pocket ID: medium_risk_thin_edge_shadow_v1
Owner / date: Codex / 2026-06-06
Reason:
  Audit shows `POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL` has positive counterfactual ROI, but the sample has metadata gaps and overlaps weak cohorts.

Market family:
  TBD by next settled cohort; do not include props by default.
Canonical markets:
  TBD from settled rows only
Minute band:
  TBD
Score state:
  TBD
Evidence mode:
  full_live_data only
Allowed odds range:
  TBD; must not override min odds
Minimum confidence:
  >= 7 unless a later contract changes this
Minimum value_percent:
  TBD per market; no global thin-edge relaxation
Risk-level rule:
  MEDIUM only; HIGH remains blocked
Required live signals:
  canonical market, mapped odds, directional thesis, settled sample
Forbidden contexts:
  unknown market, degraded evidence, high-risk market, props without sample, same-thesis/segment violation
Stake cap:
  TBD, expected <= 2
Warning key:
  TBD, must be unique before implementation
Kill switch / env:
  TBD before implementation

Before benchmark path:
  packages/server/replay-work/audit/20260606-022250/current-runtime-blocked-selection.json
After benchmark path:
  Not generated; shadow spec only.
Promotion evidence:
  Not satisfied.
Rollback condition:
  Not applicable until runtime implementation exists.
```

Implementation status: not implemented. This is a review placeholder only.

## Pocket: `odds_events_degraded_shadow_v1`

```text
Pocket ID: odds_events_degraded_shadow_v1
Owner / date: Codex / 2026-06-06
Reason:
  `odds_events_only_degraded` blocked cohort was profitable in the current report, but contract allows degraded evidence as shadow-only until evidence risk is proven.

Market family:
  goals_over, asian_handicap only if future sample supports it
Canonical markets:
  TBD
Minute band:
  TBD
Score state:
  TBD
Evidence mode:
  odds_events_only_degraded only
Allowed odds range:
  TBD
Minimum confidence:
  TBD, expected >= 8 for degraded evidence
Minimum value_percent:
  TBD
Risk-level rule:
  HIGH blocked
Required live signals:
  odds + events present, no stats; canonical market resolved
Forbidden contexts:
  props, BTTS, 1X2, broad Under, unknown market, unmapped odds
Stake cap:
  Shadow only; no production stake
Warning key:
  TBD, must be unique before implementation
Kill switch / env:
  TBD before implementation

Before benchmark path:
  packages/server/replay-work/audit/20260606-022250/current-runtime-blocked-selection.json
After benchmark path:
  Not generated; shadow spec only.
Promotion evidence:
  Not satisfied.
Rollback condition:
  Not applicable until runtime implementation exists.
```

Implementation status: not implemented. Contract permits telemetry/shadow/reporting only, not runtime save/notify default.

