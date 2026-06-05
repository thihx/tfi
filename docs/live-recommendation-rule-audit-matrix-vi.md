# Live Recommendation Rule Audit Matrix

**Updated:** 2026-06-06  
**Contract:** [live-recommendation-guard-relaxation-contract-vi.md](./live-recommendation-guard-relaxation-contract-vi.md)  
**Runtime source of truth:** [live-recommendation-pipeline-vi.md](./live-recommendation-pipeline-vi.md)

Tai lieu nay la checklist trien khai theo contract. Muc dich la khoa hanh vi hard-guard, tach cac guard duoc review bang pocket, va ngan viec noi global threshold.

## Baseline Evidence

Before paths:

- `packages/server/replay-work/audit/20260606-022250/pipeline-liveness.json`
- `packages/server/replay-work/audit/20260606-022250/current-runtime-no-save.json`
- `packages/server/replay-work/audit/20260606-022250/current-runtime-blocked-selection.json`

Tom tat:

- Official prompt `v10-hybrid-legacy-g` co 814 `LLM_CALL_STARTED`, 791 completed, 148 match analyzed trong 336h.
- Official prompt saved rows = 0; parse actionable/skipped = 0 / 18.
- Current-runtime blocked selections = 40 settled rows, ROI = -0.092.
- `REQUIRED_CONDITIONS_NOT_MET`: 32 settled rows, ROI = 0.0569.
- `POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL`: 17 settled rows, ROI = 0.2724.
- `full_live_data` blocked cohort: 25 settled rows, ROI = -0.5528.
- `odds_events_only_degraded` cohort: 15 settled rows, ROI = 0.676, but contract classifies this as shadow-only because stats are missing.

## Status Legend

- `hard_keep`: khong duoc noi trong scope nay.
- `strict_keep`: giu strict mac dinh; chi duoc shadow/review neu co spec rieng.
- `review_pocket`: co the noi bang pocket cu the, khong noi global.
- `shadow_only`: chi ghi telemetry/counterfactual, khong save/notify mac dinh.
- `opt_in_only`: co implementation/test, nhung default off cho den khi pass promotion gate.

## Rule Matrix

| Rule / area | Source | Contract status | Evidence | Decision | Next action |
| --- | --- | --- | --- | --- | --- |
| Unknown market / unresolved normalization | `packages/server/src/lib/recommendation-policy.ts:271`, `packages/server/src/lib/server-pipeline.ts:805` | `hard_keep` | No-save report co 125 `MARKET_UNRESOLVED` warnings. | Khong noi. Unknown market khong save. | Giu test normalization/save-integrity; khong pocket. |
| Odds unavailable, unmapped, below min, provider coverage save block | `packages/server/src/lib/server-pipeline.ts:805`, `packages/server/src/lib/server-pipeline.ts:5062` | `hard_keep` | Contract hard guard; money-critical provider snapshot. | Khong noi. | Giu backend provider/canonical odds boundary. |
| Official prompt and strict JSON | `packages/server/src/lib/live-analysis-prompt.ts`, `docs/live-recommendation-pipeline-vi.md` | `hard_keep` | Official prompt active in audit: 814 starts on `v10-hybrid-legacy-g`. | Khong tao prompt candidate/shadow moi. | Prompt wording chi lam ro opt-in pocket, khong doi version. |
| Advisory/manual mode save/notify | `packages/server/src/lib/server-pipeline.ts:4937` | `hard_keep` | Contract says advisory/manual prompt-only flow must not save/notify. | Khong noi. | No runtime change. |
| Same-thesis exposure cap | `packages/server/src/lib/recommendation-policy.ts:883` | `hard_keep` | Contract hard guard for bankroll discipline. | Khong noi. | Pocket nao cung phai di qua cap nay. |
| Segment blocklist / segment stake cap | `packages/server/src/lib/recommendation-policy.ts:374`, `packages/server/src/lib/server-pipeline.ts:1742` | `hard_keep` | Contract says blocklist overrides any pocket. | Khong noi. | Giu override tren pocket. |
| `1x2_draw` | `packages/server/src/lib/recommendation-policy.ts:386` | `hard_keep` | Contract hard guard. | Khong noi. | No pocket. |
| High-risk break-even | `packages/server/src/lib/recommendation-policy.ts:326` | `strict_keep` | 2 settled rows ROI 0.8, sample qua nho va high-risk guard la hard-risk. | Khong promote. | Chi review sau sample rieng, full-live only. |
| `REQUIRED_CONDITIONS_NOT_MET` | `packages/server/src/lib/recommendation-policy.ts:318` | `review_pocket` | 32 settled rows ROI 0.0569, nhung full-live cohort ROI -0.5528. | Khong noi global. | Chi cho pocket co market/minute/score/evidence/odds/confidence/edge/stake cap. |
| `POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL` | `packages/server/src/lib/recommendation-policy.ts:860` | `review_pocket` | 17 settled rows ROI 0.2724. Tin hieu tot nhung co metadata gap va risk cluster. | Chua promote. | Tao shadow/pocket spec rieng neu co du minute/value/risk evidence. |
| `OVER_1_5_BLOCKED_LATE_MIDGAME` | Existing warning in audit; dedicated hard block is minute >=85 in `recommendation-policy.ts:390` | `review_pocket` | 2 settled rows, 2 wins, ROI 0.725, nhung current rows thieu minute. | Chi dua vao `balanced_live_value_v1` opt-in. | Can telemetry co minute/score truoc khi deploy default. |
| AH small-line | `packages/server/src/lib/recommendation-policy.ts:141`, `packages/server/src/lib/recommendation-policy.ts:825` | `review_pocket` | AH low-signal group 3 rows ROI 0.0433; small-line winners co sample rat nho. | Chi dua vao `balanced_live_value_v1` opt-in. | Gioi han line +/-0.25 den +/-0.75, minute 45-84, level/one-goal, full-live. |
| `odds_events_only_degraded` | `packages/server/src/lib/server-pipeline.ts:1169` | `shadow_only` | 15 settled rows ROI 0.676, nhung thieu stats. | Khong save/notify mac dinh. | Neu lam tiep, tao degraded O/U/AH shadow spec rieng. |
| Goals Under thin cushion | `packages/server/src/lib/recommendation-policy.ts:752` | `strict_keep` | 25 rows ROI -0.0144; loss cluster trong Croatia/Norway. | Giu strict. | Chi rescue pocket cuc hep voi settlement ung ho. |
| BTTS No pre60 / goal-margin | `packages/server/src/lib/recommendation-policy.ts:330`, `packages/server/src/lib/recommendation-policy.ts:542` | `strict_keep` | 1 settled blocked row win, sample qua nho va contract very strict. | Giu strict. | Shadow only neu co sample BTTS rieng. |
| Corners hot-zone props | `packages/server/src/lib/recommendation-policy.ts:533`, `packages/server/src/lib/recommendation-policy.ts:536` | `strict_keep` | 1 policy-blocked sample loss; props can sample rieng. | Giu strict. | No runtime relaxation. |
| `balanced_live_value_v1` | `packages/server/src/config.ts:193`, `packages/server/src/lib/recommendation-policy.ts:175`, `packages/server/src/lib/recommendation-policy.ts:315` | `opt_in_only` | Current audit has 0 real candidates because minute/full-live/confidence gaps exclude all rows. | Default off. | Benchmark with `--enable-balanced-pocket`; promotion needs settled sample gate. |

## Regression Lock

- Khong ha global `PIPELINE_MIN_CONFIDENCE`.
- Khong doi `policyRequiredBreakEvenMax` / `policyHighRiskBreakEvenMax` cho toan bo pipeline.
- Khong doi official prompt version.
- Khong cho degraded evidence save/notify mac dinh.
- Khong cho pocket bo qua market normalization, save integrity, same-thesis cap, segment blocklist, hoac min odds.

