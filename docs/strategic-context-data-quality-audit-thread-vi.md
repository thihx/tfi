# Strategic Context Data Quality Audit Thread

Date: 2026-06-14
Goal thread: `019eb781-18ea-7e13-b09c-ae0f084cae8f`
Scope: pre-match strategic context / enrichment data used by MatchHub and live recommendation pipeline.

## 1. Why This Audit Exists

The current issue is not only whether the enrichment job runs or whether it can fetch any data. The real product question is:

- Does the collected pre-match context improve live betting decision quality?
- Are the sources trustworthy enough for a money-critical recommendation system?
- Do low/poor contexts fail because data does not exist, grounding does not find it, source filtering rejects it, AI Gateway blocks it, or provider fallback is too thin?
- Which parts should be visible to users, and which are internal diagnostics only?

This thread tracks the full audit and must be updated before implementation changes that affect strategic context quality.

## 2. Current Runtime Evidence

Production DB cohort from `monitored_matches.metadata.strategic_context`:

| Metric | Value |
|---|---:|
| Context rows sampled | 7 |
| Good contexts | 3 |
| Poor contexts | 4 |
| High source quality | 3 |
| Low source quality | 4 |
| Grounded contexts | 3 |
| Provider fallback contexts | 4 |
| Avg trusted sources | 3.14 |
| Avg quantitative fields | 6.86 |

Diagnostics from the repeatable audit script:

| Diagnostic | Distribution |
|---|---|
| Root cause | `grounded_but_claim_traceability_missing`: 3; `provider_fallback_after_grounding_sparse`: 4 |
| Decision usefulness | `useful_but_unverified`: 3; `fixture_only`: 4 |
| Claim traceability | `domain_only`: 7 |
| Quantitative integrity | `values_without_attribution`: 3; `none`: 4 |
| Recommendation influence risk | `eligible_but_unverified`: 3; `fixture_only_no_prompt`: 4 |
| Prompt inclusion | 3/7 include strategic context in the recommendation prompt path |
| Prematch feature construction | 3/7 build `PREMATCH_EXPERT_FEATURES_V1` from strategic context |

Observed segmentation:

| Segment | Rows | Avg trusted | Avg quantitative | Notes |
|---|---:|---:|---:|---|
| `good` + `high` + grounded | 3 | ~6 | 16 | Rich context; useful priors available. |
| `poor` + `low` + provider fallback | 4 | 1 | 0 | Fixture/odds facts only; no tactical/news/form priors. |

Concrete samples:

- `Sweden vs Tunisia` has `search_quality=high`, `trusted_source_count=7`, and 16/16 quantitative priors. This is potentially useful to the recommendation pipeline, but is currently `useful_but_unverified` because source URLs are generic domains and metrics have no persisted attribution.
- `Germany vs Curacao`, Chile/Spain examples are provider-limited: API-Football confirms fixture and odds, but there is no tactical/news/form intelligence and quantitative priors are all null.

Repeatable audit command:

```powershell
npm run strategic-context:audit-quality --prefix packages/server -- --lookback-hours 168 --sample-limit 12 --out-json replay-work/strategic-context-audit/latest.json --out-md replay-work/strategic-context-audit/latest.md
```

Latest artifacts:

- `packages/server/replay-work/strategic-context-audit/latest.json`
- `packages/server/replay-work/strategic-context-audit/latest.md`

The script now emits:

- `diagnosticsSummary.byRootCause`
- `diagnosticsSummary.byDecisionUsefulness`
- `diagnosticsSummary.byClaimTraceability`
- `diagnosticsSummary.byQuantitativeIntegrity`
- per-sample `reasonCodes`
- per-sample concrete vs generic source URL counts
- per-sample `gatewayCorrelation` counts for grounded/structured/repair stages
- per-sample `recommendationInfluence` showing prompt inclusion, prematch feature strength, confidence cap, noise penalty, and influence risk
- `traceabilityRiskSamples` for grounded/high contexts that still lack claim-level proof

## 3. Current Data Flow

1. Watchlist entry becomes eligible near kickoff.
2. `enrich-watchlist.job.ts` calls `fetchStrategicContext()`.
3. `strategic-context.service.ts` asks Gemini with Google Search grounding for raw research notes.
4. Service parses grounding metadata into:
   - `source_meta.search_quality`
   - `source_meta.sources`
   - `source_meta.trusted_source_count`
   - `source_meta.rejected_domains`
   - `source_meta.web_search_queries`
5. Gemini converts grounded notes into structured strategic context:
   - motivation
   - league positions
   - fixture congestion
   - rotation risk
   - absences
   - H2H narrative
   - quantitative priors
   - monitoring condition blueprint
6. If grounding/structured output is empty or blocked, provider fallback uses API-Football fixture + prematch odds.
7. Context is stored in `monitored_matches.metadata.strategic_context`.
8. In the official compact live recommendation path observed in tests, strategic context currently reaches the LLM mainly through `PREMATCH_EXPERT_FEATURES_V1` and prematch/profile discipline text.
9. `PrematchExpertFeaturesV1` derives secondary scores from strategic context + league/team profiles. Raw strategic context prompt sections still exist in code, but they are not the main observed official path.
10. MatchHub UI displays a subset of the context.

## 4. Business Data Contract To Audit

Strategic context should not be a generic match preview. It should collect only data that can affect live decision quality.

Required categories:

| Category | Business Purpose | Required Quality |
|---|---|---|
| Fixture facts | Correct match identity, kickoff, round, venue | Provider-confirmed |
| Competition context | Group/table/knockout stakes, cross-league caveat | Official or stats reference |
| Motivation | Need points, qualification/elimination, derby/final context | At least 1 trusted source |
| Team form | Last 5 points, goals for/against | Stats reference, numeric |
| Venue tendency | Home/away scoring averages | Stats reference, numeric |
| Goal environment | O2.5, BTTS, clean sheet, failed-to-score rates | Stats reference, numeric |
| Absences | injuries, suspensions, rotation | Official/team news/major news |
| Congestion | recent/next fixtures causing rotation risk | fixture schedule, official/stats |
| H2H | only if recent and comparable context | stats reference |
| Suggested monitoring condition | machine-readable watch condition | must be conservative and explainable |

Explicitly out of scope for user-facing UI:

- raw search queries
- full domain lists
- raw quantitative JSON
- provider/debug fallback internals

These are useful for operator audit, not for normal users.

## 5. Initial Findings

### F1. Provider fallback is not strategic intelligence

Provider fallback currently proves that the fixture and odds exist, but it does not provide:

- team form priors
- absences
- motivation
- fixture congestion
- tactical context

It should be marked as weak/poor and should not boost recommendation confidence.

### F2. Grounded contexts can be valuable when they succeed

The Sweden vs Tunisia context has 16 quantitative fields and multiple trusted sources. In the current official prompt path, those fields feed `PREMATCH_EXPERT_FEATURES_V1` derived features. Raw `QUANTITATIVE_PREMATCH_PRIORS` sections still exist in helper code, but they are not the primary observed official path.

So the data is not decorative; it can affect recommendation judgment. The risk is quality consistency.

### F3. UI currently exposes internal audit/debug fields

`Quantitative Priors`, `Trusted Domains`, and `Search Queries` create overtext and are not actionable for users. They should remain available in an admin/debug view, not MatchHub’s normal user view.

### F4. Low quality has multiple likely root causes

A low/poor context can come from:

- Gemini grounding returned no trustworthy context.
- AI Gateway breaker blocked strategic LLM calls.
- Prompt search strategy failed to target the right source types.
- Source classifier accepted too few trusted sources or over-relied on generic domains.
- Provider fallback has no stats/event/team profile enrichment.
- The match/league may have poor public coverage.

The audit must classify each low/poor case by cause instead of treating all as `empty_response` or `provider_limited`.

### F5. Trust is currently domain-level, not claim-level

The implementation classifies sources by domain:

- tier 1: official/major news domains
- tier 2: stats reference domains
- tier 3: aggregators/unknown
- rejected: social, forums, betting/tipster patterns

This is a useful first gate, but it does not prove that a specific extracted claim is supported by a specific source. Example: a context can have trusted domains, but the system does not persist evidence like:

- `home_last5_points` came from `flashscore.com`
- `key_absences` came from `bbc.co.uk`
- `fixture_congestion` came from an official schedule page

For money-critical use, domain trust is necessary but not sufficient. The next design should add per-field source attribution or at least per-category source attribution.

### F6. AI Gateway is a real quality factor, not only a cost control

AI Gateway logs over the latest audit window show strategic-context calls blocked by `breaker_open:loop_detected`. When this happens, the system can only fall back to provider-limited fixture/odds facts.

This is good for cost safety, but it also means:

- poor context may mean "LLM blocked", not "no public data exists"
- the UI/status should distinguish provider-limited fallback from grounded no-data
- the audit report must include AI Gateway status whenever diagnosing source quality

### F7. Current source policy has broad tier-3 aggregator matching

The base policy marks domains containing terms like `score`, `sport`, or `news` as aggregators. This catches many noisy domains, but it can also classify some legitimate sports sites as tier 3 unless they are explicitly allowlisted.

Observed source domain examples from the latest audit:

- tier 1/tier 2 useful: `fifa.com`, `uefa.com`, `bbc.co.uk`, `flashscore.com`, `sofascore.com`, `whoscored.com`, `transfermarkt.com`
- tier 3/needs review: `wikipedia.org`, `sportsillustrated.com`, `tntsports.co.uk`, `onefootball.com`, `olympics.com`, `standard.co.uk`

The next audit pass should decide whether these domains should remain tier 3, move to tier 2/major news, or be used only for context but not metric extraction.

### F8. `high` source quality does not yet mean claim-level verification

Runtime sample `Sweden vs Tunisia` is marked `search_quality=high` with `trusted_source_count=7`, but the stored source list contains only generic domain URLs such as `https://fifa.com`, `https://flashscore.com`, and `https://goal.com`.

That means the system can say "trusted domains were involved", but cannot prove:

- which exact URL supported `home_last5_points=8`
- which exact URL supported `home_key_absences`
- whether H2H came from a current preview, a database page, or model synthesis
- whether contradictory sources were compared and resolved

For a money-critical assistant, this is the core data-quality gap: domain-level trust is useful for filtering, but it is not enough for business confidence.

### F9. Some weak contexts are not caused by API failure

`Germany vs Curacao` ended as provider fallback/low quality, but AI Gateway logs around the attempted enrichment show:

- `grounded_research`: started + succeeded
- `structured_context`: started + succeeded
- `json_repair`: started + succeeded

So the failure mode was not "LLM/API did not run". It was more likely one of:

- grounded pass produced sparse/no trusted tactical context
- source extraction did not retain useful grounded URLs
- quality gate decided the grounded result was too weak
- the prompt/source policy failed to target sources that were actually available

This distinction matters operationally: retrying the same job may not help unless query design, source policy, or evidence extraction changes.

### F10. Public data may exist even when TFI stores provider fallback

For `Germany vs Curacao`, external checks found official fixture and multiple public previews/news pages for the match, while TFI stored only provider fallback facts. That suggests "provider-limited" is not always equal to "no public data exists"; it can also mean the collect/grounding strategy failed to recover useful context.

The UI/status should therefore avoid wording that implies the world has no data. Better internal reason codes:

- `provider_fallback_after_grounding_sparse`
- `provider_fallback_after_source_quality_low`
- `provider_fallback_after_gateway_blocked`
- `provider_fallback_after_empty_grounding`
- `provider_fallback_provider_only_supported`

## 6. Source Trust Audit Questions

For each grounded context, answer:

- Which domains were used?
- Which source tier did each domain get?
- Did the content actually support the extracted fact?
- Were official/stat sources preferred over news/blog/tip sites?
- Did the model use Wikipedia or generic pages for facts that require current data?
- Did the query strategy include team aliases, accents, country names, and competition round?
- Were rejected domains logged with reasons?
- Can we reproduce the source set for audit?

## 7. Data Quality Dimensions

Each context should receive explicit scoring:

| Dimension | Pass Criteria |
|---|---|
| Identity confidence | provider match id, teams, competition, kickoff match |
| Source credibility | at least 2 tier-1/tier-2 sources for non-provider strategic claims |
| Source recency | current match/tournament context, not stale historical page |
| Quant coverage | enough numeric fields for the market being analyzed |
| Tactical coverage | absences/congestion/motivation are source-backed or explicitly absent |
| Extraction consistency | values are numeric and normalized |
| Decision usefulness | can influence O/U, BTTS, AH, 1X2, no-bet rationale |
| User display value | concise, understandable, no raw debug text |

## 8. Recommendation Impact Audit

The audit must inspect whether strategic context affects:

- LLM prompt content
- `PrematchExpertFeaturesV1`
- confidence/risk/stake
- no-bet reasoning
- market selection
- save/push eligibility

Important rule: strategic context is a secondary prior. Live stats, events, odds, and market value must remain primary.

Current code evidence:

- In the official compact prompt path, strategic context currently reaches the LLM mainly through `PREMATCH_EXPERT_FEATURES_V1`, not a raw visible `STRATEGIC CONTEXT` section.
- `buildStrategicContextSection()` and `buildStrategicContextSectionCompact()` still exist, but the current official prompt path observed in tests does not render their raw `STRUCTURED_STRATEGIC_SIGNALS` / `QUANTITATIVE_PREMATCH_PRIORS` block directly.
- The prompt explicitly treats prematch/profile priors as supporting evidence only and says weak or unavailable prematch strength should default to no-bet unless live evidence is clearly one-sided.
- `prematch-expert-features.ts` converts strategic quantitative fields into derived scores:
  - recent points delta
  - attack form delta
  - defense form delta
  - venue attack delta
  - over tendency score
  - BTTS tendency score
  - clean-sheet suppression score
  - projected goal environment score
- `server-pipeline.ts` records strategic context availability/trust in diagnostics and can attempt on-demand context when pre-match context is missing.
- `server-pipeline.ts` only passes strategic context into prompt construction when `_meta.refresh_status === "good"` and `hasUsableStrategicContext()` returns true.

Business interpretation:

- Current provider-fallback/poor contexts do not enter the prompt path. Latest audit shows 4/7 rows are `fixture_only_no_prompt`.
- Current grounded/high contexts do enter the prompt path and build `PREMATCH_EXPERT_FEATURES_V1`. Latest audit shows 3/7 rows are `eligible_but_unverified`.
- Those 3 grounded/high rows currently produce weak prematch strength with confidence cap 6 and noise penalty 76 when evaluated using strategic context alone. This reduces immediate money risk, but the data is still eligible for prompt influence despite missing claim-level source attribution.
- A future quality gate should make this explicit in code: `fixture_only` stays out of prompt/features; `useful_but_unverified` remains soft guidance only; `decision_relevant` requires concrete source URLs or deterministic metric basis.

## 9. Proposed Audit Phases

### Phase A: Source Pipeline Trace

Trace current code and logs:

- prompt construction
- search queries
- grounding metadata extraction
- source classification
- trusted/rejected counting
- JSON synthesis and repair
- provider fallback
- retry/backoff
- AI Gateway interaction

Output: sequence diagram + code risk findings.

### Phase B: Production Cohort Audit

Build a DB report for the last 24h/7d:

- status distribution
- quality distribution
- provider fallback ratio
- trusted source count
- quantitative coverage
- top low-quality causes
- examples by league/provider

Output: audit report JSON/MD and a repeatable script.

Status: initial script added as `npm run strategic-context:audit-quality --prefix packages/server`.

Status update: script now classifies root causes, traceability risk, and per-match AI Gateway correlation. Latest cohort:

- 4/7 rows are `provider_fallback_after_grounding_sparse`.
- 3/7 rows are `grounded_but_claim_traceability_missing`.
- 7/7 rows are `domain_only` traceability.
- 0/7 rows have concrete source URLs stored.
- All 4 provider-fallback rows had at least one `grounded_research` succeeded event and at least one `structured_context` + `json_repair` succeeded event in AI Gateway logs.

This means the current production readiness blocker is not simply "fetch more data". It is:

1. grounded research can run successfully but still produce context that is too sparse/untrusted, causing provider fallback
2. grounded success does not persist claim/source evidence
3. numeric priors are not reproducible because raw match lists/calculation basis are not stored

### Phase C: Source Truth Verification

For representative matches:

- inspect actual grounded sources
- verify whether extracted facts are supported
- mark unsupported/inferred facts
- compare with API-Football/Sportmonks/The Odds API where relevant

Output: source verification matrix.

Status: first manual pass completed for two representative rows.

#### C1. Sweden vs Tunisia (`1539002`) - grounded/high sample

Stored context:

- `search_quality=high`
- `trusted_source_count=7`
- `source_mode=grounded`
- quantitative coverage: `16/16`
- stored domains include `fifa.com`, `wikipedia.org`, `sportsillustrated.com`, `flashscore.com`, `goal.com`, `whoscored.com`, `sofascore.com`, `transfermarkt.com`, `bbc.co.uk`, `tntsports.co.uk`

External verification snapshot:

| Stored claim / metric | TFI value | Verification result | Notes |
|---|---:|---|---|
| Fixture identity | Sweden vs Tunisia, Group F | Supported | FIFA match centre confirms the fixture and Group F match page: https://www.fifa.com/en/match-centre/match/17/285023/289273/400021474 |
| H2H | Sweden leads 2W-1D-1L in 4 friendlies | Supported by one preview, contradicted by another source | Sports Mole supports 4 previous meetings and 2-1-1 record: https://www.sportsmole.co.uk/football/spain/world-cup-2026/head-to-head/sweden-vs-tunisia-head-to-head-record-and-past-meetings_599097.html. Goal's match guide indexed in search says only one previous meeting. TFI does not store which source won the conflict. |
| Sweden absences | Dejan Kulusevski, Emil Holm, Gabriel Gudmundsson doubt | Partially supported / conflict-sensitive | Search results show sources for Kulusevski and Holm injuries, and Sports Mole mentions Holm withdrawal/Gudmundsson illness: https://www.sportsmole.co.uk/football/sweden/world-cup-2026/preview/sweden-vs-tunisia-prediction-team-news-lineups_599031.html. However another Goal preview says no listed injuries. Needs source recency and authority ranking. |
| Tunisia absences | None / fully fit squad | Weakly supported | Some previews say no major Tunisia injury concerns, but TFI does not store a URL or timestamp for this claim. |
| Sweden last 5 points | 8 | Ambiguous | Could match a D-W-W-L-D style form window, but another indexed Goal guide says Sweden last five were 2W-1D-2L = 7 points. TFI does not store the actual match list used. |
| Sweden last 5 goals for/against | 10 / 9 | Ambiguous / likely inconsistent with one public source | Goal indexed text says 8 scored and 7 conceded across the last five. TFI value may come from another stats window/source, but there is no claim-level source trace. |
| Tunisia last 5 points | 5 | Plausible but untraceable | Goal indexed text says 1W-1D-3L = 4 points. TFI value may use a different result classification or source. Needs metric definition and match list persistence. |
| Quantitative rates | BTTS/O2.5/CS/FTS | Useful but untraceable | These are potentially valuable for O/U and BTTS priors, but no source URL, stat window, or raw calculation basis is stored. |

Conclusion for this sample:

- The context is not useless; it contains decision-relevant priors.
- But "high" is overstated for money-critical use because exact metric provenance is missing.
- The biggest gap is not extraction coverage; it is evidence traceability and conflict resolution.

#### C2. Germany vs Curacao (`1489374`) - provider-fallback/low sample

Stored context:

- `search_quality=low`
- `trusted_source_count=1`
- `source_mode=provider_fallback`
- quantitative coverage: `0/16`
- fallback says API-Football confirmed fixture and prematch odds: 14 bookmakers, 180 markets, 6991 selections

External verification snapshot:

| Area | Verification result | Notes |
|---|---|---|
| Official fixture | Supported | FIFA match centre exists for Germany vs Curacao: https://www.fifa.com/en/match-centre/match/17/285023/289273/400021464 |
| Venue/kickoff | Supported by multiple public pages | Standard/Houston/other pages report Houston/NRG/Houston Stadium context. |
| Tactical/news context availability | Public data exists | Search returned current public previews with Germany team news, Curacao tournament context, rankings, and odds. Examples: https://www.standard.co.uk/sport/football/germany-vs-curacao-prediction-kick-off-time-team-news-tv-live-stream-h2h-results-odds-world-cup-2026-preview-today-b1285707.html and https://www.cbssports.com/soccer/news/germany-curacao-odds-prediction-time-2026-world-cup-picks-best-bets/ |
| AI Gateway | Not the direct cause in this attempt | Logs around 2026-06-14 14:17-14:19 UTC show grounded, structured, and repair stages succeeded. |
| Final TFI value | Provider fallback only | The collect pipeline ran but still failed to produce trusted strategic intelligence. |

Conclusion for this sample:

- The root cause is not provider coverage and not a direct LLM block.
- The likely root cause is grounding/source extraction/quality gating producing a sparse or untrusted context despite available public information.
- This case should become a regression fixture for "public data exists but TFI stores provider fallback".

### Phase D: Business Contract Gap Analysis

Compare collected data against the data contract in section 4.

Output: required improvements by category.

Initial gap analysis:

| Contract category | Current state | Gap |
|---|---|---|
| Fixture facts | Good via provider/API-Football fallback | Fine, but should be separated from strategic intelligence. |
| Competition context | Sometimes present | Needs official URL attribution and group/table semantics. |
| Motivation | Model-generated from previews | Needs source-backed categories and conflict handling. |
| Team form | Numeric values can be filled | Needs raw match list and calculation definition. |
| Venue tendency | Numeric values can be filled | Needs provider/stat source provenance. |
| Goal environment | Useful rates can be filled | Needs stat window/source attribution before using as confidence boost. |
| Absences | Present but source-conflicted | Needs official/news priority, timestamp, and confidence. |
| Congestion | Often generic | Needs schedule-derived deterministic calculation where possible. |
| H2H | Present but can conflict by database coverage | Needs source priority and recency/comparability rules. |
| Monitoring condition | Generated | Needs confidence tied to evidence quality, not just quantity. |

### Phase C/D Finding: Definition of "high" should be split

Current `search_quality=high` mixes several ideas:

- trusted domains found
- enough sources found
- structured context contains many fields

These should be split into separate scores:

- `source_retrieval_quality`: were good source URLs found?
- `claim_attribution_quality`: are important claims tied to URLs?
- `quantitative_integrity`: are numeric values calculated from a persisted raw basis?
- `conflict_resolution_quality`: were contradictory sources detected/resolved?
- `decision_usefulness`: can this context safely influence live recommendation?

Until these are separated, UI/operator panels can mislead us by showing "high" when the data is only broadly plausible.

### Phase E: UX Audit

Separate:

- user-facing match context
- admin/operator diagnostics
- internal prompt features

Output: UI changes and admin debug design.

### Phase F: Improvement Plan

Potential improvements:

- add source-tier allow/deny list with reason codes
- persist source verification/audit rows, not only final context JSON
- add quantitative source attribution per metric
- use provider/team profile data before falling back to provider-limited prose
- make provider fallback structured and explicit: fixture, odds, standings, form, stats separately
- create quality gates that block strategic-context confidence boosts when source quality is low
- add evaluation fixtures for good/poor/source-misleading cases

Recommended implementation phases from this audit:

#### Phase 1: Quality Reason Codes

Add machine-readable quality reasons to stored strategic context:

- `grounded_but_claim_traceability_missing`
- `provider_fallback_provider_only_supported`
- `provider_fallback_after_gateway_blocked`
- `provider_fallback_after_grounding_sparse`
- `numeric_values_without_source_url`
- `generic_domain_urls`

DoD:

- Existing audit script can read reason codes directly from context, not only infer them.
- Unit tests cover provider-only fallback, gateway-blocked fallback, grounded generic-domain-only context, and grounded concrete-source context.

#### Phase 2: Source Evidence Envelope

Persist source evidence beyond final domains:

- exact grounded URLs when available
- source tier/type
- source recency where available
- source role/category: fixture, team_news, injuries, stats, h2h, odds, schedule
- grounded query that found the source

DoD:

- A grounded/high context has at least one concrete URL or is downgraded.
- UI/operator audit can show source categories without showing raw user-facing noise.
- Tests cover Vertex/Google redirect URLs and direct URLs.

#### Phase 3: Claim-Level Or Category-Level Attribution

Attach evidence to important fields:

- `home_key_absences`, `away_key_absences`
- `league_positions`
- `fixture_congestion`
- `h2h_narrative`
- quantitative metric groups

Minimum viable version can be category-level, for example `quantitative.form` sourced from a stats reference page. Money-critical version should be claim-level.

DoD:

- Every numeric field used by `PrematchExpertFeaturesV1` has `source_basis`.
- If source basis is missing, the field can be displayed as context but must not boost confidence/stake.

#### Phase 4: Deterministic Quantitative Basis

Stop relying on LLM-only numeric extraction for last-5/last-10 metrics where provider/stat data can be deterministic.

Store:

- raw last-N match list
- competition scope
- home/away scope
- calculation timestamp
- provider/source

DoD:

- Last-5 points/goals can be recalculated from stored inputs.
- Conflicting public snippets do not silently change values.
- Tests cover points/goals/BTTS/O2.5/CS/FTS calculations.

#### Phase 5: Grounding Recovery For "Public Data Exists But Fallback Stored"

Use `Germany vs Curacao` as a regression fixture:

- public fixture exists
- public preview/team-news pages exist
- AI stages can succeed
- TFI currently stores provider-only fallback

Improve query design/source policy/fallback decision so that this class is either:

- recovered into a low/medium grounded context with source evidence, or
- explicitly marked `grounding_sparse_despite_public_data_candidates`

DoD:

- Regression test freezes this failure mode.
- Audit script separates "no public data" from "grounding failed to recover public data".

#### Phase 6: Recommendation Gating

Make strategic context influence explicit:

- `fixture_only` can explain limitations but must not increase confidence/stake.
- `useful_but_unverified` can be used as soft narrative prior only.
- `decision_relevant` can feed `PrematchExpertFeaturesV1` and prompt priors.
- Prompt wording must down-weight `low`, `medium`, and `unknown` source quality. A regression test now covers the current official path where low-quality strategic context renders through `PREMATCH_EXPERT_FEATURES_V1`.

DoD:

- Tests prove provider fallback does not boost recommendation confidence.
- Prompt diagnostics show whether strategic prior was `none`, `soft_unverified`, or `decision_relevant`.

#### Phase 7: UI/Operator Split

Normal MatchHub UI should show concise useful context only. Operator/admin diagnostics should show:

- root cause
- reason codes
- source evidence
- traceability/integrity status
- retry/recovery status

DoD:

- User view has no raw search query/domain dump.
- Operator view can diagnose low quality without opening DB JSON.

Acceptance criteria for implementation phases:

- Every context has a machine-readable `quality_reason` or equivalent reason codes.
- Provider fallback is separated from grounded strategic intelligence in both storage and UI.
- Every non-provider strategic claim is linked to at least a source category; high-risk claims should have source URL attribution.
- Quantitative priors used by recommendation have source attribution or are clearly marked provider/profile-derived.
- Audit script can show high/medium/low/poor ratios and top causes for the last 24h/7d.
- Tests cover at least:
  - grounded high-quality context
  - provider fallback only
  - AI Gateway blocked fallback
  - misleading/rejected source domains
  - low-quality context not boosting confidence
  - UI hiding raw diagnostics from normal users

## 10. Definition Of Done For This Audit

This audit is complete only when:

- We can explain why each poor/low context is poor.
- We can quantify how often the function returns useful vs weak context.
- We know which source types are being trusted and whether that trust is justified.
- We can show exactly how the context affects recommendation output.
- User UI no longer displays raw diagnostics.
- There is a concrete implementation roadmap with tests and rollout guardrails.
