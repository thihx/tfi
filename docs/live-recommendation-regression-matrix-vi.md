# Live Recommendation Regression Matrix

**Status:** Draft test contract before implementation  
**Updated:** 2026-06-09  
**Scope:** regression va edge-case matrix cho viec tach live recommendation output router.

## Nguyen Tac Test

Thay doi lon trong pipeline phai duoc test theo outcome, khong chi theo branch code. Moi scenario quan trong can assert it nhat:

- `outputKind`
- evidence mode
- LLM co duoc goi hay khong
- recommendation co duoc save hay khong
- notification/delivery co duoc stage hay khong
- audit bucket/no-action reason
- settlement/ROI eligibility

Bat bien money-critical:

- Khong co canonical live odds thi khong save `recommendations`.
- Stats-only signal khong goi LLM mac dinh.
- Shadow candidate khong notify user mac dinh.
- Parse error khong save.
- Market unresolved khong save.
- Policy blocked khong save.
- Delivery failure khong duoc bien thanh saved recommendation failure neu recommendation row da save thanh cong.

## Test Layers

### Unit

Nen co unit tests cho:

- Evidence classifier.
- Opportunity classifier.
- Output router.
- Stats-only deterministic signal evaluator.
- Market normalization va canonical line matching.
- Save-integrity validator.
- Audit bucket mapper.

### Integration

Nen co integration tests quanh `server-pipeline.ts` voi mocks:

- provider/cache input
- odds resolver
- LLM/callGemini
- recommendation repo
- delivery repo
- alert delivery repo
- audit log writer

### DB/Report

Nen co tests hoac scripted checks cho:

- audit bucket aggregation
- no-save diagnostics
- blocked-selection counterfactual cohort
- stats-only signal delivery rows
- "why no recommendation" report grouping

### Replay/Gates

Nen tiep tuc dung:

- `data-driven:current-runtime-no-save`
- `data-driven:current-runtime-blocked-selection`
- `data-driven:check-current-runtime-blocked-selection-gates`
- `data-driven:policy-shadow-suite`
- `data-driven:verify-gates-ci`

## Core Scenario Matrix

| ID | Scenario | Input State | Expected Output | LLM | Save | Notify | Audit/Reason | Critical Asserts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M01 | Full data, valid AI candidate | Fresh stats/events/live odds, canonical market, confidence pass | `money_recommendation` | Yes | Yes | Yes if target eligible | `recommendation_saved` | recommendation row has odds/stake; settlementEligible true; ROI eligible true |
| M02 | Full data, AI intentional no-bet | Fresh full data, LLM returns no bet | `no_action` | Yes | No | No | `model_no_bet` | no delivery; audit includes model reason |
| M03 | Full data, malformed AI JSON | Fresh full data, LLM returns malformed/partial JSON | `no_action` | Yes | No | No | `llm_parse_error` | parse default cannot save; no stake |
| M04 | Full data, market unknown | LLM candidate text cannot normalize | `shadow_candidate` or `no_action` | Yes | No | No | `market_unresolved` | raw candidate retained for audit; no recommendation row |
| M05 | Full data, market/selection mismatch | `bet_market` and selection normalize differently | `no_action` | Yes | No | No | `save_integrity_blocked` | save repo not called |
| M06 | Full data, policy blocked | Candidate valid but blocked by policy | `shadow_candidate` | Yes | No | No | `policy_blocked` | shadow/debug payload includes policy reason |
| M07 | Full data, thin edge | Odds/confidence near break-even threshold | `shadow_candidate` or `no_action` | Yes | No | No | `thin_edge_blocked` | no save; appears in thin-edge audit cohort |
| M08 | Full data, same-thesis cap | Candidate repeats existing exposure | `shadow_candidate` or `no_action` | Yes | No | No | `same_thesis_blocked` | exposure count/stake included in audit |
| M09 | Full data, segment blocklist | Candidate segment is blocked | `shadow_candidate` | Yes | No | No | `segment_policy_blocked` | segment key included; no delivery |
| M10 | Full data, stake cap reduced | Candidate passes but segment cap lowers stake | `money_recommendation` if stake still valid | Yes | Yes | Yes if target eligible | `recommendation_saved` | saved stake equals capped stake; cap reason retained |
| M11 | Full data, min odds fail | Canonical odds below min odds | `no_action` | Yes or skipped by precheck | No | No | `policy_blocked` or `no_tradable_canonical_market` | no save below min odds |
| M12 | Full data, delivery disabled | Recommendation saved, user/channel delivery disabled | `money_recommendation` | Yes | Yes | No | `delivery_no_target` or `delivery_staged` absent | saved row remains settlement eligible; delivery status explicit |

## Stats-only And No-odds Matrix

| ID | Scenario | Input State | Expected Output | LLM | Save | Notify | Audit/Reason | Critical Asserts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S01 | Strong 0-0 pressure after 55 | No live odds, stats show shots/SOT/corners pressure, score 0-0 minute >=55 | `stats_only_signal` | No | No | Yes if subscribers | `stats_only_signal_emitted` | message says check live market/price; no recommendation row |
| S02 | Weak stats-only | No live odds, stats/events weak | `no_action` | No | No | No | `stats_only_weak_trigger` | audit includes missing/weak trigger reason |
| S03 | Prematch odds available only | No live odds, prematch odds exists | `stats_only_signal` only if deterministic trigger passes | No | No | Maybe | `prematch_odds_reference_only` plus signal/no-action bucket | prematch odds not stored as live recommendation odds |
| S04 | No odds at all, strong trigger | No live or prematch odds, strong stats/events | `stats_only_signal` | No | No | Yes if subscribers | `stats_only_signal_emitted` | signal carries no price/stake |
| S05 | Late goal after 75 | No live odds, goal event after 75 | `stats_only_signal` or `watch_insight` depending trigger strength | No | No | Maybe | `stats_only_signal_emitted` or no-action reason | copy avoids chasing; no market price fabricated |
| S06 | Red card state | No live odds, red card in events | `stats_only_signal` if watch target eligible | No | No | Yes if subscribers | `stats_only_signal_emitted` | signal type includes red-card state |
| S07 | Corner pressure | No live odds, corner pressure trigger | `stats_only_signal` | No | No | Yes if subscribers | `stats_only_signal_emitted` | triggerKey dedupes by match/score/minute bucket |
| S08 | Pressure but no subscribers | Strong stats trigger, no active watch subscribers | `no_action` or non-user-visible signal audit | No | No | No | `stats_only_signal_no_subscriber` | no delivery rows for users |
| S09 | Subscriber notifications disabled | Strong trigger, subscriber exists but condition alerts disabled | `no_action` or delivery skipped | No | No | No | `stats_only_signal_delivery_blocked` | respects user settings |
| S10 | Duplicate trigger | Same match/score/minute bucket already delivered | `no_action` | No | No | No | `stats_only_signal_deduped` | exactly one delivery for trigger key |
| S11 | Live odds return after previous stats-only signal | Earlier signal emitted, later full odds usable | `money_recommendation` possible only through normal money path | Yes if routed | Yes if pass | Yes if pass | `recommendation_saved` or model/policy reason | stats-only prior delivery does not count as saved recommendation |
| S12 | Stats-only manual Ask AI | User asks advisory/manual analysis without odds | advisory answer only | Optional by manual flow | No | No | advisory/manual audit | no recommendation save/delivery |

## Degraded Evidence Matrix

| ID | Scenario | Input State | Expected Output | LLM | Save | Notify | Audit/Reason | Critical Asserts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D01 | Odds + events only | Live odds and events present, stats missing | `shadow_candidate` or `no_action` | Current default: No unless explicit shadow experiment | No | No | `degraded_evidence_odds_events_only` | no production save until gates pass |
| D02 | Odds-events positive candidate in shadow | Shadow experiment creates candidate | `shadow_candidate` | Maybe in controlled shadow | No | No | `policy_blocked` or degraded bucket | counterfactual can settle but not production ROI |
| D03 | Events only | Events present, no odds/stats | `watch_insight` or `no_action` | No | No | No by default | `degraded_evidence_events_only` | no money route |
| D04 | Odds only | Odds present, no stats/events | `no_action` | No by default | No | No | `low_evidence` with degraded reason `odds_only_without_stats_events` | no LLM by default; do not add `odds_only` prompt enum until a later gated phase |
| D05 | Suspicious odds | Odds impossible/stale/contaminated | `no_action` | No or Yes before save-integrity | No | No | `no_tradable_canonical_market` | suspicious odds not canonical tradable |
| D06 | Market allowed in full data only | Degraded evidence candidate for high-risk market | `shadow_candidate` or `no_action` | Maybe | No | No | `market_not_allowed_for_evidence_mode` | evidence allowlist blocks save |
| D07 | Low freshness snapshot | Snapshot stale beyond threshold | `no_action` | No | No | No | `stale_snapshot` | stale data reason appears in audit |

## Provider, Scheduler, And Subscription Matrix

| ID | Scenario | Input State | Expected Output | LLM | Save | Notify | Audit/Reason | Critical Asserts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | Provider quota/circuit open | Job runs but provider fetch blocked | `no_action` | No | No | No | `provider_quota_or_circuit_open` | liveness report separates provider issue from model silence |
| P02 | Provider fetch failed | Network/API error | `no_action` | No | No | No | `provider_fetch_failed` | retry/backoff logged; no fake data |
| P03 | No live matches | Scheduler finds no eligible live match | `no_action` at job level | No | No | No | `no_live_match` | report not counted as model no-bet |
| P04 | Watch subscription absent | Match live but no relevant active watch subscription | route-dependent no delivery | Depends on product decision | Depends on route | No | `no_active_watch_subscription` | no user notification; audit explicit |
| P05 | Watch subscription disabled notify | Subscriber exists with notify disabled | route-dependent no delivery | Depends | Depends | No | `watch_subscription_notify_disabled` | respects settings |
| P06 | Delivery repo failure after save | Money recommendation saved, delivery staging throws | `money_recommendation` saved with delivery failure audit | Yes | Yes | No | `delivery_failed` | save success and delivery failure are distinguishable |

## Matches UI Ask AI Matrix

| ID | Scenario | Input State | UI Control | Backend Preflight | LLM | Save | Notify | Critical Asserts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| U01 | Not watched match | Match visible in Matches, not in Watchlist | Disabled; tooltip says add to Watchlist | `not_in_watchlist` | No | No | No | clicking does not call analyze API |
| U02 | Watched full live data | Watched, live, minute in window, stats/events/live odds usable | Enabled | `eligible_full_live_data` | Yes | No by manual-advisory default | No by manual-advisory default | panel renders grounded analysis; no recommendation row unless explicit promote path exists |
| U03 | Watched live but too early | Watched, status 1H, minute below live-analysis window, no strong trigger | Disabled or preflight-blocked | `match_too_early` | No | No | No | UI shows reason before token spend |
| U04 | Watched live stats-only strong trigger | Watched, live, no usable odds, strong stats/events trigger | Enabled as advisory/signal | `eligible_stats_only_explainable` | No by default, unless separate advisory LLM experiment | No | Maybe match-alert signal only if product chooses | no stake/price; copy says check live market |
| U05 | Watched live stats-only weak trigger | Watched, live, no odds, weak stats | Disabled or preflight-blocked | `low_evidence` or `stats_only_weak_trigger` | No | No | No | no generic "AI no bet" if LLM was not called |
| U06 | Watched odds only | Watched, odds present, stats/events absent | Disabled by default | `low_evidence` or `degraded_evidence` | No | No | No | no token spend until pocket has explicit contract |
| U07 | Watched events only | Watched, events present, odds/stats absent | Disabled or watch-insight only | `degraded_evidence_events_only` | No | No | No | no money-market thesis shown |
| U08 | Structured prematch eligible | Watched, `NS`, top league, prematch/profile coverage sufficient | Enabled as prematch advisory | `eligible_structured_prematch` | Yes | No | No | prompt includes structured prematch override; no live pressure claims |
| U09 | Prematch not eligible | Watched, `NS`, non-top league or thin prematch coverage | Disabled/preflight-blocked | `top_league_required` or `profile_coverage_too_thin` | No | No | No | UI explains data is too thin |
| U10 | Finished match | Watched row remains after FT | Disabled for new analysis; cached view allowed | `match_finished` | No for new run | No | No | existing cached panel can be opened; no new LLM call |
| U11 | Cached result | Match has cached `aiResults` | Primary button shows cached result; chat jumps to follow-up | `cached_result_available` or no preflight needed for view | No for view | No | No | clicking primary does not call analyze API |
| U12 | Follow-up chat after result | Cached result exists, user asks follow-up | Chat enabled if match context still exists | advisory follow-up eligible | Yes | No | No | request sends `advisoryOnly=true`; no save/notify |
| U13 | Follow-up without backend context | Cached result exists but match no longer in current Matches state/backend | Chat disabled or error handled | `missing_fixture_context` | No | No | No | user sees clear error; no empty answer |
| U14 | AI gateway/entitlement blocked | User over daily limit or feature disabled | Disabled/preflight-blocked | `ai_quota_or_entitlement_blocked` | No | No | No | no provider/LLM call; toast/message explains limit |
| U15 | Initial quick analysis manual route | User clicks first analysis in Matches | Enabled only if eligible | advisory/manual-safe | Depends on mode | No by default | No by default | initial Matches analysis must not accidentally enter production save path |

## Message Template Matrix

| ID | Scenario | Output Kind | Expected Message Kind | Required Copy | Forbidden Copy/CTA | Critical Asserts |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | Saved money recommendation web push | `money_recommendation` | `OFFICIAL_BET_RECOMMENDATION` | heading says official bet; body includes selection, odds, confidence, stake | missing odds; "not a bet" | action may be `Invest`; `settlementEligible=true` |
| T02 | Saved money recommendation Telegram | `money_recommendation` | `OFFICIAL_BET_RECOMMENDATION` | official heading, live odds, stake, risk, value, reasoning | signal/no-action heading | message can route to Recommendations/invest flow |
| T03 | Stats-only signal web push | `stats_only_signal` | `LIVE_STATS_SIGNAL` | "NOT A BET", "No live odds available", trigger summary | `Invest`, stake, tradable odds | click opens Matches/match detail |
| T04 | Stats-only signal Telegram | `stats_only_signal` | `LIVE_STATS_SIGNAL` | "không phải kèo", "không có odds live usable", suggested action review live market | KÈO CHÍNH THỨC, stake amount | no settlement/ROI wording |
| T05 | Watch/shadow candidate internal feed | `shadow_candidate` or `watch_insight` | `WATCH_SIGNAL` | "NO BET STAGED", block reason | `Invest`, official recommendation | metadata includes policy/market/evidence reason |
| T06 | No-action analysis | `no_action` | `NO_ACTION_ANALYSIS` | reason group and whether LLM was called | bet-like selection formatting | user push suppressed by default |
| T07 | Manual Matches analysis | manual advisory route | `MANUAL_ADVISORY` | "ADVISORY ONLY", data mode, live odds availability | save/notify/settlement language | initial and follow-up chat do not save/notify |
| T08 | Condition alert | match alert `condition_signal` | `LIVE_STATS_SIGNAL` or condition-specific signal | trigger summary and suggested action | official bet heading unless recommendation row exists | no `Invest` unless linked to saved recommendation |
| T09 | Message metadata consistency | any output | matches output | metadata `outputKind`, `messageKind`, `deliveryKind`, `settlementEligible`, `roiEligible` | missing messageKind | UI/filter can distinguish bet vs signal |
| T10 | Notification click target | stats/watch/no-action signal | non-invest signal | opens Matches/match detail | opens Recommendations with invest action | service worker route respects message kind/tag |

## Subscription, Settlement, Dashboard, Live Monitor Matrix

### Subscription And Entitlement

| ID | Scenario | Input State | Expected Output | LLM | Save | Notify | Critical Asserts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q01 | Matches initial Ask AI over daily quota | Authenticated member, watched eligible match, quota exhausted | preflight/route error `ai_quota_or_entitlement_blocked` | No | No | No | quota checked before LLM/provider-heavy work |
| Q02 | Matches initial Ask AI feature disabled | Member entitlement `ai.manual.ask.enabled=false` | preflight/route error | No | No | No | same error shape as proxy AI analyze entitlement block |
| Q03 | Matches initial Ask AI admin bypass | Admin/owner, otherwise eligible match | advisory analysis allowed | Depends on eligibility | No by manual default | No by manual default | bypass is explicit and tested |
| Q04 | Matches follow-up chat quota policy | Cached result, user asks follow-up | advisory follow-up or quota block per chosen policy | Depends | No | No | policy is documented; no hidden production save |
| Q05 | Stats-only signal subscriber enabled | Active watch subscriber, notify enabled, condition alerts enabled | signal delivery eligible | No | No | Yes | delivery target respects subscription settings |
| Q06 | Stats-only signal subscriber disabled notify | Active watch subscriber, `notify_enabled=false` or condition alerts disabled | no user notification | No | No | No | audit says delivery blocked; no fallback recommendation delivery |
| Q07 | Channel disabled at send time | User has disabled web push/Telegram channel | delivery skipped/failed per channel state | N/A | No | No | channel config status respected |

### Settlement And ROI

| ID | Scenario | Input State | Expected Output | Auto-settle | Dashboard/Reports | Critical Asserts |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | Saved money recommendation | `recommendations.id` exists, actionable bet, pending result | settlement eligible | Yes | Counted in pending/open exposure | `settlementEligible=true`, `roiEligible=true` |
| R02 | Stats-only signal delivery row | `user_recommendation_deliveries.recommendation_id=NULL`, `delivery_kind=match_alert/stats_only` | signal only | No | Not counted in P/L/ROI | no `ai_performance` row; no recommendation row |
| R03 | Watch/no-action analysis signal row | `recommendation_id=NULL`, metadata `watch_signal/no_action`, status suppressed | internal signal/audit | No | Not counted as unsettled bet | summary excludes from `pending` bet count or reports separate signal count |
| R04 | Shadow candidate settlement report | counterfactual candidate settled in shadow report | shadow metric only | No production settle | Not production ROI | stored/reported separately from `recommendations.pnl` |
| R05 | Recommendation delivery summary in bets-only mode | Mixed saved rec deliveries and signal rows | bet metrics only | N/A | pending/P&L only from saved recs | signal rows do not inflate `Unsettled` |
| R06 | Recommendation delivery summary in all-signals mode | Mixed feed | separated bet vs signal counters | N/A | P/L label applies only to bet subset | UI copy does not imply signals are unsettled bets |
| R07 | Manual settlement modal on signal row | Delivery row without rec id appears in My Signals | no settle/invest actions | N/A | N/A | buttons hidden because `recommendation_id` missing |

### Dashboard And Reports

| ID | Scenario | Input State | Expected Output | Critical Asserts |
| --- | --- | --- | --- | --- |
| B01 | Dashboard with only signal rows | No recommendations, several stats/watch/no-action deliveries | zero recommendation KPI; optional signal diagnostics separate | `Settled Recommendations`, P/L, ROI stay zero |
| B02 | Dashboard with saved recs plus signals | Mixed data | KPI equals saved actionable recommendations only | recent recommendations excludes signal rows |
| B03 | Reports overview with signal rows | Mixed data and date filter | reports ignore signal-only delivery rows | total/pending/P&L from `recommendations` only |
| B04 | AI stats with signal rows | Signal-only rows, no `ai_performance` | AI stats unaffected | no join to delivery-only rows |
| B05 | Operator why-no-recommendation dashboard | No-save audit buckets present | diagnostic buckets shown separately | labels avoid ROI/hit-rate language |

### Live Monitor

| ID | Scenario | Input State | Expected Output | Critical Asserts |
| --- | --- | --- | --- | --- |
| V01 | Money recommendation saved and notified | Pipeline result `outputKind=money_recommendation`, saved true | summary increments saved rec and official bet notification | badge says official bet/recommendation |
| V02 | Stats-only signal notified | `outputKind=stats_only_signal`, saved false, notified true | summary increments signal notification, not saved rec | label not just generic `Notifications` if mixed |
| V03 | Watch signal staged suppressed | `outputKind=watch_insight/shadow_candidate`, saved false, delivery suppressed | shown as Watch/internal if product allows | no `Push` or `Invest` badge |
| V04 | No-action audit | `outputKind=no_action`, saved false, notified false | no-action count/reason shown | reason from audit bucket, not just candidate pre-check |
| V05 | Candidate precheck stale but final output no-action | Live monitor target `candidateReason=not_stale`, output router blocks market | final reason is market/policy bucket | UI does not confuse precheck candidate with final action |
| V06 | Sorting mixed result kinds | Bet, signal, no-action results in same run | stable priority using explicit output kind | saved bet first, then signal/watch, then no-action/errors |

## Prompt And LLM Matrix

| ID | Scenario | Input State | Expected Output | Critical Asserts |
| --- | --- | --- | --- | --- |
| L01 | Official prompt baseline | Runtime live recommendation path | Uses `v10-hybrid-legacy-g` | No env active/shadow prompt selection |
| L02 | Invalid prompt override in test/replay | Override input is retired/unknown | Normalizes to official prompt for live builder | No retired prompt rendered |
| L03 | LLM timeout/cooldown | Full data but LLM unavailable | `no_action` | audit bucket `llm_cooldown` or provider-specific failure; no save |
| L04 | LLM fabricates odds in text | Candidate references odds not in canonical snapshot | `no_action` | save-integrity blocks; canonical odds are source of truth |
| L05 | LLM recommends blocked market | Candidate market blocked by mandatory guard | `shadow_candidate` or `no_action` | policy reason retained |

## Market Normalization Matrix

Moi market shape moi can unit test. Minimum set:

- `Over 0.5 @1.65` -> canonical total over 0.5.
- `Over 1.5 Goals @1.90` -> canonical total over 1.5.
- `Under 2.5 @1.82` -> canonical total under 2.5.
- `Home -0.75 @1.92` -> Asian Handicap home -0.75, khong phai 1X2.
- `Away +0.25 @2.10` -> Asian Handicap away +0.25.
- `Home Win @1.80` -> 1X2 home.
- `Draw @3.20` -> 1X2 draw, blocked by mandatory guard.
- `BTTS Yes @1.95` -> BTTS yes, evidence-specific guard.
- Unknown/free-text market -> `market_unresolved`, no save.

Critical asserts:

- Selection text va `bet_market` phai dong nhat.
- Line sign khong bi mat.
- Odds source phai la canonical odds snapshot.
- Below-min odds khong save.

## Phase Gates

### Phase 1 Gate - Output Router/Audit

Required tests:

- Unit tests cho evidence classifier va output router.
- Integration tests cho M01-M08, S01-S04, D01-D03, P01-P03.
- Assert moi processed match co output/audit bucket.
- Assert stats-only signal no LLM/no recommendation save.

Required reports:

- Current runtime no-save report van chay duoc.
- Stats-only emitted/skipped/no-subscriber buckets co the aggregate.

No-go:

- Bat ky stats-only scenario nao tao row trong `recommendations`.
- Bat ky market unresolved nao save thanh cong.
- Bat ky prompt retired nao duoc render trong live path.

### Phase 2 Gate - Dashboard/Operator Readiness

Required tests:

- API/report grouping dung taxonomy.
- Subscription/quota tests cho manual Matches Ask AI route.
- Delivery summary/chart tests tach bet metrics voi signal/no-action rows.
- Dashboard/Reports tests dam bao signal rows khong vao ROI/P&L.
- Live Monitor summary tests tach official bet notification voi signal notification.
- Empty state copy khong gop provider issue, model no-bet, va policy block thanh mot nhom.
- Drilldown co match id, minute, evidence mode, reason.

Implemented Phase 2 checks:

- `live-output-operator-report.test.ts` covers audit bucket taxonomy groups and report drilldown from `PIPELINE_MATCH_ANALYZED`.
- `live-monitor.routes.test.ts` covers `GET /api/live-monitor/why-no-recommendation` query wiring and response shape.
- `server-monitor.service.test.ts` covers frontend service call and query params.
- `LiveMonitorTab.test.tsx` covers Live Monitor rendering of "Why No Recommendation", reason bucket copy, and drilldown metadata.
- Existing Phase 1/pre-P1 tests continue to cover manual Ask AI quota block, admin bypass, delivery summary bet-only metrics, and official/signal/no-action Live Monitor summary split.

Current intentional boundary:

- Phase 2 does not create a production ROI/reporting table for signal/no-action rows.
- Phase 2 does not settle shadow candidates; counterfactual settlement remains Phase 3.
- Provider/job-level causes like `no_live_match` and provider circuit status are visible through existing ops/liveness surfaces; this Phase 2 endpoint focuses on per-match `PIPELINE_MATCH_ANALYZED` output taxonomy.

Required operator questions:

- "Hom nay provider co bi quota/circuit open khong?"
- "Co bao nhieu match full data ma model no-bet?"
- "Co bao nhieu candidate bi policy block?"
- "Co bao nhieu stats-only signal duoc emit nhung khong co subscriber?"
- "Co bao nhieu match khong save vi market unresolved?"

### Phase 3 Gate - Shadow Pocket

Required artifacts:

- Shadow cohort JSON/CSV.
- Settlement coverage.
- Segment hotspot report.
- Gate config checked in or documented.

Minimum checks:

- Settled sample count dat nguong da thong nhat.
- Canonical market resolution rate dat nguong.
- ROI/P&L positive theo gate.
- Max drawdown/loss cap khong vuot nguong.
- Khong co save-integrity gap.

Hard no-promote:

- Sample qua mong.
- ROI tot nhung tap trung vao mot league/team qua hep.
- Market unresolved cao.
- Loss cap fail.
- Evidence mode bi contaminate.

Implemented Phase 3 checks:

- `runtime-policy-shadow.test.ts` covers the two new telemetry-only pockets:
  - `medium_risk_thin_edge_shadow_v1`
  - `odds_events_degraded_shadow_v1`
- `runtime-policy-shadow-readiness-gates.test.ts` covers the aggregate hard no-promote gate for sample, settlement coverage, unresolved rows, loss/P&L/ROI, match/league/team/market concentration, market resolution, and evidence purity.
- Shadow audit/report/settlement tests assert normalized `leagueSegmentKey`, `teamSegmentKeys`, and league/team segment summaries for both matched pockets and skipped-neighbor rows.
- `data-driven:policy-shadow-suite` emits readiness JSON/Markdown beside matched/skipped shadow and settlement reports.
- `data-driven:check-policy-shadow-readiness-gates` checks saved artifacts from a config file.
- No Phase 3 test should assert save/notify promotion; these pockets are shadow telemetry only.

Current intentional boundary:

- `odds_events_degraded_shadow_v1` is observable only when a blocked model candidate exists; Phase 3 does not enable default LLM calls for all odds+events-only matches.
- Segment hotspot coverage now has normalized league/team telemetry in runtime shadow audit and settlement rows. Phase 4 still requires enough live cycles and readiness gate pass before any production policy proposal.

### Phase 4 Gate - Controlled Production

Required controls:

- Feature flag: `RUNTIME_POLICY_PROMOTION_ENABLED`.
- Pocket allowlist: `RUNTIME_POLICY_PROMOTION_POCKET_IDS`.
- Cohort/percentage rollout: `RUNTIME_POLICY_PROMOTION_ROLLOUT_PERCENT`.
- Rollback switch: `RUNTIME_POLICY_PROMOTION_KILL_SWITCH`.
- Required evidence acknowledgement: `RUNTIME_POLICY_PROMOTION_EVIDENCE_ACK=ready_for_human_review`.
- Clear owner for monitoring: `RUNTIME_POLICY_PROMOTION_OWNER`.
- Audit line: `PIPELINE_POLICY_PROMOTION_EVALUATED`.

Implemented Phase 4 checks:

- `runtime-policy-production-promotion.test.ts` covers disabled default, missing evidence ack, kill switch, pocket allowlist, rollout zero, and stake cap promotion.
- `server-pipeline.test.ts` covers a configured shadow pocket promoted into an official money recommendation only when all promotion guards pass.
- Promotion rows must keep `decision_context.policyBlocked=true`, set `recommendationSource=runtime_policy_promotion`, include `runtimePolicyPromotion*` metadata, and still pass save-integrity.

Success:

- Quality gate pass lien tiep trong production pocket.
- No-save/no-delivery reasons van nhin duoc sau rollout.

Rollback:

- Gate fail.
- Delivery spam.
- Market normalization incident.
- Provider data contamination.
- Settlement mismatch.

## Suggested Test Names

Phase 1 nen them hoac cap nhat cac tests theo ten gan voi behavior:

- `evidence-classifier.test.ts`
- `live-output-router.test.ts`
- `stats-only-signal-evaluator.test.ts`
- `server-pipeline.output-router.test.ts`
- `server-pipeline.stats-only-signal.test.ts`
- `server-pipeline.money-save-integrity.test.ts`
- `live-output-audit-report.test.ts`

Khong bat buoc dung dung ten nay, nhung behavior tuong ung phai co coverage.

## Manual QA Checklist

Truoc khi merge moi phase:

- Chay focused server tests quanh pipeline.
- Chay data-driven gate baseline neu thay policy/replay.
- Doc diff audit payload de dam bao reason khong bi mat.
- Confirm docs source-of-truth van noi single prompt `v10-hybrid-legacy-g`.
- Confirm `.env.example` khong co retired prompt/shadow selector.
- Confirm advisory/manual flow khong save/notify.
