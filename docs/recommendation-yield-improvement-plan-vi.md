# Recommendation Yield Improvement Plan

**Date:** 2026-06-04  
**Related audit:** `replay-work/audit/20260604-yield-policy/yield-policy-deep-audit-vi.md`

## Problem

Official prompt/policy `v10-hybrid-legacy-g` đang quá im lặng nếu chỉ tính đầu ra là saved betting recommendation.

Điều này có hai mặt:

- Tốt: hệ thống tránh nhiều kèo rủi ro, đặc biệt ở sample nhỏ.
- Xấu: người dùng gần như không thấy giá trị nếu không có kèo saveable, trong khi live betting thường có nhiều trạng thái đáng quan sát nhưng chưa đáng vào tiền.

Do đó không nên giải bằng cách nới global policy ngay. Nên productize thành ba trạng thái:

| State | Meaning | Persist as bet? |
| --- | --- | --- |
| `Bet` | Recommendation đã qua money-critical guards. | Yes |
| `Watch` | Có thesis hoặc điều kiện chờ xác nhận. | No |
| `No Action` | Đã phân tích nhưng không đủ điều kiện. | No |

## Current Evidence

Từ audit 2026-06-04:

- Runtime official prompt active nhưng không save recommendation mới.
- Recent saved recommendation rows đều là old prompt, không dùng để đánh giá official prompt.
- Mock replay: 15 scenarios, 1 actionable, push rate `6.67%`.
- Real LLM cached replay: 11 scenarios, 0 actionable sau production policy.
- Blocked-selection counterfactual: 39 rows, ROI `-6.87%`.
- Full-live blocked slice: ROI `-53.42%`.
- Một vài pocket nhỏ dương nhưng chưa đủ promote.

Historical replay update:

- Related report: `replay-work/audit/20260604-historical-yield/historical-yield-replay-vi.md`.
- 180-day coverage found `2,748` settled actionable/export-eligible snapshots and `100%` replay-ready coverage.
- Two non-overlapping historical mock chunks produced only `3/240` actionable recommendations, push rate `1.25%`.
- Historical win recall was only `1.77%`: 2 replayed original winners out of 113 original directional wins.
- Replay avoided original directional losses in these chunks: 0 replayed losses out of 114 original directional losses.
- Broadly allowing all trusted policy-blocked candidates would be negative: 210 candidates, ROI `-9.41%`.
- Real Gemini targeted `goals_over` historical sample produced `0/8` actionable and 0 trusted policy-experiment candidates.

Conclusion from historical data:

- The silence problem is real even when recent workload is ignored.
- Broad policy loosening is still not justified.
- Positive mock pockets must be treated as Watch/shadow experiments until real Gemini and runtime settlement confirm them.

## Principles

1. Do not trade product silence for unsafe bet spam.
2. Bet policy must stay stricter than Watch/No Action presentation.
3. Policy promotion requires runtime settlement, not only replay.
4. Small sample positive pockets are hypotheses, not production rules.
5. Every relaxation must be measurable by prompt version, evidence mode, minute band, market family, unique matches, ROI, and drawdown.

## Phase 1: Product Yield Without Money Relaxation

Build visible Live Signals:

- Show `Bet`, `Watch`, `No Action` as separate labels.
- Surface No Action reasoning when AI was called and intentionally skipped.
- Surface Watch thesis with the condition that would make it actionable.
- Keep recommendation table/reporting for Bet only.
- Add signal count metrics:
  - `bet_signal_count`
  - `watch_signal_count`
  - `no_action_signal_count`
  - `visible_signal_count`

Acceptance:

- User can see that the system analyzed a watched match even when there is no bet.
- No Action/Watch cannot be settled as P/L.
- No Action/Watch cannot be sent as betting advice text.

## Phase 2: Better Runtime Evidence

Already patched:

- `PIPELINE_MATCH_ANALYZED` metadata now includes minute, score, status, raw market, odds, value, and risk.

Next:

- Run weekly:

```powershell
npm run data-driven:current-runtime-no-save --prefix packages/server -- --lookback-hours 336
npm run data-driven:current-runtime-blocked-selection --prefix packages/server -- --lookback-hours 336
npm run data-driven:policy-shadow-suite --prefix packages/server
```

Promotion gate for any narrow pocket:

- at least 20 settled rows
- at least 5 unique matches
- positive ROI after stake cap
- no single match contributes more than 35% of pocket P/L
- manual review of worst losses

## Phase 3: Shadow Experiments Only

Review candidates:

| Candidate | Current evidence | Action |
| --- | --- | --- |
| `POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL` | 17 runtime rows, ROI `+27.24%` | Shadow with 0.5-1% cap. |
| `over_1.5`, minute `60-74`, one-goal margin | Historical mock: 6 candidates, 5W/1L, ROI `+30.25%`; real Gemini targeted sample: 0/8 actionable | Convert to Watch/shadow prompt experiment, not production loosen. |
| Late `under_4.5`, 75+, two-plus margin, total goals 4 | 1 real selected winner, blocked by LLP/policy cap path | Shadow exact pocket, review line-patience. |
| `odds_events_only_degraded` O/U/AH | 15 rows, ROI `+67.60%` | Shadow only; check match concentration. |

Keep blocked:

- global confidence lowering from 7 to 6
- broad full-live blocked cohort
- HT Under tight low signal
- same-thesis exposure caps
- generic BTTS/corners loosen

## Phase 4: Production Policy Change Path

Only after shadow gates pass:

1. Add config-driven override with stake cap.
2. Replay with `--apply-replay-policy`.
3. Run CI gates.
4. Deploy as limited beta.
5. Monitor runtime for two weeks before wider rollout.
