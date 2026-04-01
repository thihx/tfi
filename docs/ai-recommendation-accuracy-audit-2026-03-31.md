# AI Recommendation Accuracy Audit

Date: 2026-03-31

## Scope

This audit reviewed:

- production historical recommendation outcomes
- prompt/model cohorts
- market, minute, odds, and league patterns
- enrichment and prematch-context architecture
- what is currently persisted vs what is missing for a reliable feedback loop

All recommendation counts below use the same runtime logic as the product UI:

- exclude `duplicate`
- exclude `NO_BET`
- directional win = `win + half_win`
- directional loss = `loss + half_loss`
- push/void tracked separately

## Executive Summary

The system-wide number looks close to coin-flip:

- `1520` actionable recommendations
- `767` directional wins
- `713` directional losses
- `40` push
- `51.82%` directional hit rate
- `-152.01` total P/L
- `-2.84%` ROI on stake

But the poor all-time result is not evenly distributed.

The main drag is legacy output:

- `gemini-3.0-flash + prompt_version=''`
- `1100` settled picks
- `50.28%` directional hit rate
- `-248.08` P/L
- `-6.51%` ROI

Recent pro cohorts are materially better:

- `gemini-3-pro-preview + v4-evidence-hardened`
  - `316` settled picks
  - `54.92%` hit rate
  - `+54.93` P/L
  - `+4.54%` ROI
- `gemini-3-pro-preview + v6-betting-discipline-c`
  - `76` settled picks
  - `60.27%` hit rate
  - `+26.62` P/L
  - `+11.28%` ROI

So the problem is not "every version of the AI is bad". The stronger conclusion is:

- legacy cohorts are still contaminating the aggregate
- some market families and score-state situations are structurally weak
- enrichment is materially underpowered in production because the structured prematch-prior layer is effectively empty

## Historical Loss Patterns

### 1. `1x2_home` is the single worst recurring pattern

- `204` picks
- `73W / 131L`
- `35.78%` hit rate
- `-184.98` P/L

By minute:

- `0-44`: `32W / 56L`, `-95.79`
- `45-59`: `18W / 37L`, `-69.19`
- `60-74`: `15W / 30L`, `-35.69`
- `75+`: `8W / 8L`, `+15.69`

Implication:

- `1x2_home` before minute `75` is a structurally losing pattern under current system behavior
- this is large enough to move portfolio-level performance by itself

### 2. `1x2_draw` is also weak and noisy

- `33` picks
- `10W / 23L`
- `30.30%` hit rate
- `-34.23` P/L

Notable sub-patterns:

- `60-74`: `4W / 10L`, `-29.38`
- rows with unparseable or inconsistent score state: `0W / 9L`, `-31.5`

Implication:

- `1x2_draw` should not remain a normal live market
- if kept at all, it should be rare and heavily gated

### 3. Not all `1x2` is bad: `1x2_away` is positive

- `89` picks
- `49W / 40L`
- `55.06%` hit rate
- `+46.14` P/L

Best states:

- draw state: `25W / 15L`, `+39.3`
- away already leading: `10W / 5L`, `+7.03`

Implication:

- do not ban all `1x2`
- the real issue is mostly `home` and `draw`, not `away`

### 4. `under_2.5` is bad before minute `75`

- overall: `14W / 21L`, `-38.25`
- before `75`: `5W / 17L`, `-43.63`
- after `75`: `9W / 4L`, `+5.38`

Implication:

- the system is entering low-goal unders too early
- the thesis becomes materially safer only later in the match

### 5. `over_0.5` after minute `75` is a trap

- overall: `33W / 36L`, `-30.44`
- `60-74`: `26W / 16L`, `+11.67`
- `75+`: `4W / 20L`, `-47.4`

Implication:

- chasing one more goal very late is a consistently bad pattern here
- this is an ideal candidate for a deterministic hard-stop rule

### 6. `btts_no` has acceptable hit rate but still loses money

- `66W / 55L`
- `54.55%` hit rate
- `-47.46` P/L
- average odds only `1.691`

Implication:

- raw hit rate is misleading
- the system is not pricing value correctly on this market
- stake/confidence discipline is too loose for low-payout defensive markets

### 7. Mid-second-half is the main negative phase overall

Overall by minute:

- `0-44`: `49.25%`, `-72.74`
- `45-59`: `53.73%`, `-6.67`
- `60-74`: `52.01%`, `-119.67`
- `75+`: `52.35%`, `+47.07`

The worst family-phase combinations:

- `1x2 @ 60-74`: `27W / 47L`, `-58.81`
- `btts @ 60-74`: `37W / 43L`, `-49.79`
- `1x2 @ 0-44`: `53W / 74L`, `-67.94`
- `1x2 @ 45-59`: `42W / 60L`, `-52.96`

Implication:

- minute alone is not enough
- the weak spot is minute + market family together

### 8. Confidence is not separating quality well enough

- confidence `6-7`: `1438` picks, `51.78%`, `-198.92`
- confidence `8-10`: only `33` picks, `60%`, `+55.63`

Implication:

- the system is overusing the middle confidence band
- confidence is not acting as a meaningful portfolio filter

### 9. Odds buckets reveal value discipline issues

- `<1.70`: `62.22%` hit rate, still `-9.94`
- `1.90-2.09`: `46.97%`, `-88.74`
- `2.50+`: `29.85%`, `-32.72`

Implication:

- the system is weak around the common even-money band
- long-odds selections are especially poor
- low-odds selections win often but still do not clear expected value

### 10. Exposure stacking is still meaningful

- `121` same-thesis clusters
- `336` recommendations inside stacked clusters
- `1270` total stake in stacked clusters

Large negative examples exist in repeated under ladders and corners-under ladders.

Implication:

- the system still over-concentrates on one thesis across multiple adjacent lines
- accuracy alone understates portfolio risk

## Context And Enrichment Audit

## Finding A: structured prematch priors are effectively missing in production

Production counts today:

- `league_profiles = 0`
- `team_profiles = 0`
- `favorite_teams = 0`

This matters because `buildPrematchExpertFeaturesV1()` expects a mixture of:

- `strategic_context`
- `prediction`
- `league_profile`
- `home_team_profile`
- `away_team_profile`

In production, two of those four sources are currently absent at the table level.

Impact:

- the prompt has less structured prematch grounding than the code suggests
- the system is leaning mostly on:
  - provider prediction
  - Gemini-grounded strategic context
- it is not getting stable league/team priors from internal data

Root cause:

- `league_profiles` and `team_profiles` are admin-managed via routes
- there is no automatic population job in runtime code
- `team_profiles` also depends on `favorite_teams`, which is currently empty

## Finding B: the enrichment job is too narrow and too fragile

`enrich-watchlist.job.ts` only enriches:

- active operational watchlist
- `NS` matches only
- inside a `2 hour` prematch window

It also:

- sleeps `2s` between items
- uses long retry backoffs after poor/failed enrichment
- only runs a rescue pass for top leagues

Impact:

- enrichment can easily be late, shallow, or missing for non-top leagues
- low-quality context can persist because retries are conservative
- the system has no broad prematch preparation horizon such as `12-24h before KO`

## Finding C: strategic context is LLM-grounded and conservative, not a strong structured data layer

`fetchStrategicContext()` is Gemini + Google Search grounding.

When evidence is weak, the code intentionally returns:

- `"No data found"` narrative fields
- `null` quantitative fields

Fallback behavior is shallow:

- `mergeStrategicContextWithPredictionFallback()` mostly backfills:
  - summary
  - H2H text
  - last-5 points

It does not recreate a robust prematch quantitative block.

Impact:

- the enrichment layer can look "present" in UI but still be strategically weak
- non-top leagues are especially exposed because top-league rescue is more aggressive

## Finding D: current recommendation history does not persist enough prompt-context detail

The runtime does persist:

- `stats_snapshot`
- `odds_snapshot`
- `minute`
- `score`
- `prompt_version`

But it does not persist the full prematch context used by the prompt.

Current live save path in `server-pipeline.ts` writes:

- `pre_match_prediction_summary: ''`

That means new rows do not store a compact prematch summary from the live pipeline save path.

Impact:

- we can analyze what happened live
- but we cannot cleanly reconstruct the prematch priors the AI saw at decision time
- this weakens the learning loop and slows root-cause analysis for wrong picks

## Finding E: historical priors exist, but only as soft prompt guidance

The prompt already injects:

- market priors
- confidence-band priors
- minute-band priors
- odds-range priors
- league priors

But the prompt also explicitly says these priors should not become hard bans.

Impact:

- the system knows some buckets are weak
- but still leaves the final enforcement to the LLM
- repeated losing patterns are not yet converted into deterministic runtime controls

## What This Means

The current architecture is good enough to improve from legacy behavior, but not good enough to guarantee a strong jump in hit rate just by "giving the AI more text".

The main constraints are:

1. weak structured prematch-prior coverage in production
2. no persistent prompt-context record for reliable post-mortem learning
3. historically losing patterns are still mostly handled as prompt hints, not runtime policy

## Recommended Fixes

## Phase 1: deterministic policy fixes with immediate impact

These do not require a model change.

1. Hard-block `1x2_home` before minute `75`
   - highest impact recurring loser
2. Hard-block `1x2_draw` by default
   - re-enable only under very selective evidence if later proven worthwhile
3. Hard-block `over_0.5` at minute `75+`
4. Hard-block `under_2.5` before minute `75`
5. Add value discipline to `btts_no`
   - confidence cap
   - stake cap
   - stricter min-odds / edge rule
6. Keep `1x2_away` available, but only for evidence-tier-clean cases
7. Convert same-thesis stacking rules from prompt advice into runtime portfolio caps

Expected impact:

- quickest path to move hit rate and ROI without waiting for richer data systems

## Phase 2: repair prematch-context richness properly

1. Auto-populate `league_profiles`
   - nightly or scheduled job
   - derive from provider/reference data
2. Rework `team_profiles`
   - remove dependency on `favorite_teams` as the only entry point
   - populate from teams/provider data directly
3. Expand enrichment horizon
   - first pass `12-24h` before kickoff
   - refresh pass inside `2h`
   - final refresh closer to kickoff for high-priority matches
4. Make non-top-league enrichment less fragile
   - better fallback than just search-grounded narrative
5. Add more structured prematch features from provider/reference data
   - standings delta
   - recent xG-like proxies if available
   - home/away form deltas
   - clean-sheet / failed-to-score priors
   - schedule stress and rotation flags from deterministic sources when possible

Expected impact:

- better AI context quality
- less dependence on Gemini web-search quality

## Phase 3: fix the learning loop

1. Persist a compact prompt-context record on every recommendation
   - evidence mode
   - strategic-context quality
   - trusted source count
   - prediction fallback used
   - prematch feature availability
   - league/team profile availability
   - compact prematch feature snapshot
2. Persist `league_id` and team IDs with the recommendation
3. Add cohort-aware reporting
   - do not mix legacy flash/prompt-blank rows with modern v4/v6 when judging current quality
4. Add replay/backtest workflow
   - run old snapshots against new prompt/policy logic before rollout

Expected impact:

- faster diagnosis
- safer optimization
- less guesswork when a strategy degrades

## Phase 4: additional approach beyond enrichment + prompt tuning

If the goal is to move well beyond current accuracy, enrichment alone will not be enough.

Recommended next layer:

1. Split responsibilities:
   - LLM proposes thesis and reasoning
   - deterministic policy layer accepts/rejects/caps stake
2. Add a lightweight statistical scorer on top of the LLM
   - inputs: market, minute, score-state, odds band, evidence quality, priors availability
   - output: allow / suppress / cap confidence / cap stake
3. Make runtime policy recent-cohort aware
   - use modern cohort performance only
   - decay or exclude old flash-era history

Why this matters:

- the strongest problems found in this audit are repeated structural patterns
- those are better handled by policy and calibration than by hoping the LLM self-corrects every time

## Priority Order

1. deterministic market-policy bans/caps for proven losers
2. auto-populate league/team profile tables
3. persist prompt-context and IDs for every recommendation
4. expand prematch enrichment horizon and make it less search-dependent
5. add a policy/calibration layer above the LLM

## Bottom Line

The current `~51.8%` headline is real, but it is not the whole story.

The production system already shows that newer prompt/model cohorts can outperform the legacy baseline.
The next meaningful jump will not come from prompt wording alone.

It will come from:

- removing structurally bad market patterns
- restoring missing structured prematch priors
- persisting enough decision context to learn properly
- moving repeated caution patterns from prompt text into runtime policy
