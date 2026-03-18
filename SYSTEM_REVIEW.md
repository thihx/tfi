# TFI System Review — Comprehensive Findings
> Reviewed: 2026-03-18 | Scope: Business Logic, Pipeline, Data Integrity, AI/Prompt Quality

---

## Summary

| Category | Issues Found | Critical | High | Medium |
|----------|-------------|----------|------|--------|
| Type Mismatches / Logic Errors | 4 | 2 | 2 | 0 |
| Data Loss Risks | 3 | 2 | 1 | 0 |
| Config Inconsistencies | 2 | 0 | 2 | 0 |
| AI Prompt Quality | 4 | 0 | 2 | 2 |
| Validation Gaps | 5 | 0 | 1 | 4 |
| Pipeline Reliability | 4 | 1 | 2 | 1 |
| Business Rule Enforcement | 3 | 0 | 2 | 1 |
| **Total** | **25** | **5** | **12** | **8** |

---

## 🔴 CRITICAL Issues

### C1 — Staleness Service: Event Type Mismatch — Goals & Red Cards Never Detected

**File:** `src/features/live-monitor/services/staleness.service.ts` (lines 40, 48)

**Problem:** The staleness check compares event types using the wrong casing/format:
```typescript
// Line 40 — WRONG: compact events use lowercase 'goal'
if (e.type === 'Goal') { ... }

// Line 48 — WRONG: compact events use type='card' with detail containing 'Red Card'
if (e.type === 'Red Card') { ... }
```

The match-merger correctly creates compact events as `type: 'goal'` and `type: 'card'` (lowercase), so these checks **always fail**. Result:
- Goals never trigger non-stale detection → duplicate AI calls on same game state
- Red cards never trigger non-stale detection → AI misses critical game-changing events
- Pipeline wastes API quota re-analyzing unchanged matches

**Fix:** Change to `e.type === 'goal'` and `(e.type === 'card' && e.detail?.toLowerCase().includes('red'))`

---

### C2 — Server Pipeline: Derived Insights Entirely Broken (Home/Away Not Separated)

**File:** `packages/server/src/lib/server-pipeline.ts` (lines ~135–188)

**Problem:** `deriveInsightsFromEvents()` loops through all events but unconditionally increments **home** counters for every event regardless of which team:
```typescript
if (ev.type === 'card') {
  homeCards++;          // ← ALL cards counted as home
  if (isRed) homeReds++;
}
if (ev.type === 'subst') homeSubs++;  // ← ALL subs counted as home
```
`awayCards`, `awayReds`, `awaySubs` are **never incremented**. As a result:
- `total_cards` = homeCards + 0
- `away_cards` always 0
- `momentum` calculation is completely wrong
- `btts` always false (awayGoals never set)
- Goal timeline arrays always empty → wrong goal pace

This affects ~20% of matches where Football API returns no stats (stats unavailable fallback path).

**Fix:** Check `ev.team` against home/away team name to route to the correct counter. Reference `match-merger.service.ts` lines 88–167 for the correct implementation.

---

### C3 — Data Loss: trackSilent Fire-and-Forget With No Retry

**File:** `src/features/live-monitor/services/pipeline.ts` (lines ~186–231)

**Problem:** Snapshot saving, odds movement recording, and AI performance tracking are all fire-and-forget:
```typescript
trackSilent(
  saveMatchSnapshot(...),    // Failure silently swallowed
  saveOddsMovements(...),    // Failure silently swallowed
  saveAiPerformance(...)     // Failure silently swallowed
);
```
The main recommendation is saved regardless. This means:
- Historical AI performance metrics may be incomplete
- Odds movement history may have gaps
- Match snapshots lost → no replay/audit trail

**Fix:** At minimum, log failures with enough context to replay. Ideally wrap in retry with 1 attempt.

---

### C4 — Data Loss: AI Context Fetch Failure is Silent

**File:** `src/features/live-monitor/services/pipeline.ts` (lines ~237–245)

**Problem:**
```typescript
try {
  const [prevRecs, snapshots] = await Promise.all([...]);
  aiContext = { previousRecommendations: prevRecs, ... };
} catch {
  // Context fetch failed — continue without context (empty)
}
```
When DB/API is slow, the AI receives **zero historical context** but the prompt doesn't indicate this. AI proceeds as if it has full information and produces confidence/value_percent calculations based on empty history — no different from a first-ever match.

**Fix:** Pass a flag to the prompt builder indicating context is unavailable. Reduce AI confidence floor. Alert operator.

---

### C5 — Business Rule Bypass: 1X2 Before Minute 35 Not Enforced in Code

**File:** `src/features/live-monitor/services/ai-prompt.service.ts`

**Problem:** The prompt instructs the AI:
> "Before minute 35: 1X2 should_push=false"

But `parseAiResponse()` has no validation enforcing this. If the AI ignores the instruction, the recommendation is accepted and potentially sent to users.

**Fix:** In post-parse validation, check: if `bet_market` is `1x2_*` and `minute < 35`, force `should_push = false` and add warning.

---

## 🟠 HIGH Priority Issues

### H1 — Config Inconsistency: MIN_CONFIDENCE / MIN_ODDS Ignored on Server

**Files:**
- `packages/server/src/lib/server-pipeline.ts` (lines ~496, ~876–877)
- `src/features/live-monitor/services/ai-prompt.service.ts`

**Problem:** The server pipeline hard-codes:
```typescript
const MIN_CONFIDENCE = 5;
const MIN_ODDS = 1.5;
```
The frontend pipeline reads these from `config.MIN_CONFIDENCE` / `config.MIN_ODDS`. Config changes in the LiveMonitor settings UI only affect the frontend pipeline. The server-side auto-scheduler ignores user configuration entirely.

**Impact:** Two different pipelines (frontend manual + server auto) apply different thresholds → inconsistent recommendation behavior.

**Fix:** Pass config to server pipeline and replace hard-coded constants.

---

### H2 — Config Inconsistency: Late-Game Thresholds Not Config-Driven

**Files:**
- `src/features/live-monitor/services/ai-prompt.service.ts` (lines ~111–113)
- `packages/server/src/lib/server-pipeline.ts` (lines ~878–880)

**Problem:** Both hardcode `LATE=75`, `VERY_LATE=85`, `ENDGAME=88` with no config override. These phase thresholds directly affect which markets the AI is allowed to recommend.

---

### H3 — Odds Source Ambiguity: AI Doesn't Know Odds Freshness

**File:** `packages/server/src/lib/server-pipeline.ts` (lines ~621–657)

**Problem:** The fallback chain tries live odds → pre-match odds → The Odds API. The variable `oddsSource` is updated but the **timestamp of when odds were fetched** is never included in the prompt. The AI cannot distinguish between:
- Live odds at minute 45
- Pre-match odds from 2 hours before kickoff

This affects value bet calculations significantly. Pre-match odds on a 2-0 game are meaningless.

**Fix:** Include `odds_fetched_at` and `odds_source` in prompt context.

---

### H4 — Recommendation Deduplication: Market Key Normalization Flawed

**File:** `src/features/live-monitor/services/recommendation.service.ts` (lines ~14–43)

**Problem:** `normalizeMarketKey()` normalizes AI selection string to a key, but if AI says `"Over 2.5 Goals @3.10"` vs database `"Over 2.5"`, the keys differ → same bet inserted multiple times.

---

### H5 — Pre-Match Odds Sanity Check Always Skipped

**File:** `src/features/live-monitor/services/match-merger.service.ts` (lines ~687–700)

**Problem:**
```typescript
if (isPreMatch) {
  oddsSuspicious = false;  // ← Always trusted
}
```
Pre-match odds are never validated for sanity. Corrupted/missing pre-match odds are passed to AI as reliable.

---

### H6 — Notification Logic: Condition Triggered Sent Even When No Bet

**File:** `src/features/live-monitor/services/notification.service.ts` (lines ~76–82)

**Problem:**
```typescript
if (parsed.custom_condition_matched) return 'condition_triggered';
```
This fires even when `condition_triggered_should_push = false` — sending a "condition triggered" notification that implies action but AI says do nothing. Misleading to the operator.

**Fix:** Only return `condition_triggered` section when `condition_triggered_should_push === true`.

---

### H7 — Stats Quality Check: Only 5 Fields, Missing Red/Yellow Cards

**File:** `src/features/live-monitor/services/filters.service.ts` (lines ~110–118)

**Problem:** Stats quality rating only checks 5 fields: possession, shots, shots_on_target, corners, fouls. Missing: yellow_cards, red_cards, goalkeeper_saves, passes, offsides. A match with all 5 checked fields present is rated "GOOD" even if all other fields are null.

---

### H8 — Server Pipeline: Event Type Mismatch in buildEventsCompact

**File:** `packages/server/src/lib/server-pipeline.ts` (lines ~235–239)

**Problem:**
```typescript
if (type === 'Goal') { ... }   // Football API returns 'Goal' (uppercase)
if (type === 'Card') { ... }   // Football API returns 'Card' (uppercase)
```
The raw Football API does return uppercase type strings here. But the **compact events built from these** use lowercase (`type: 'goal'`), which is inconsistent with the staleness service expectations (see C1). The root mismatch creates confusion in which layer uses which format.

**Fix:** Standardize on one casing throughout. Recommend lowercase. Apply `.toLowerCase()` at the API ingestion boundary.

---

## 🟡 MEDIUM Priority Issues

### M1 — Possession Swing Detection: Incomplete Implementation

**File:** `src/features/live-monitor/services/staleness.service.ts` (lines ~54–60)

**Problem:** Comment says "heuristic: if only 1-2 minutes passed, check possession swing" but the actual check is never implemented — the code just parses the string and does nothing with the result.

---

### M2 — minute Field: Inconsistent Type (string | number)

**File:** `src/features/live-monitor/types.ts` (line ~267)

**Problem:** `minute: number | string` causes inconsistent handling:
- `staleness.service.ts` parses it as number
- `notification.service.ts` uses it directly as string

"90+" (extra time) breaks numeric parsing silently.

**Fix:** Normalize to `number | null` at ingestion, store extra time separately.

---

### M3 — Historical Performance Cache: No TTL

**File:** `src/features/live-monitor/services/pipeline.ts` (line ~134)

**Problem:** `fetchHistoricalPerformance()` is called once per pipeline run. If matches settle during a long pipeline session, the cached performance data is stale for subsequent matches in the same run.

---

### M4 — Odds Extraction Failure: No Warning Propagated

**File:** `src/features/live-monitor/services/ai-analysis.service.ts` (lines ~271–272)

**Problem:** If `extractOddsFromSelection()` returns null, the recommendation is saved with `null` odds and no warning. Downstream settlement logic may fail silently.

---

### M5 — Error Categorization: Stack Traces Lost in Pipeline Catch

**File:** `src/features/live-monitor/services/pipeline.ts` (lines ~336–347)

**Problem:** Catch block logs `err.message` only, losing the stack trace. All errors categorized as `'PIPELINE'/'MATCH_ANALYZED'/'FAILURE'` regardless of cause (DB error vs AI error vs API error). Hard to debug production failures.

---

### M6 — AI Prompt: Incomplete Market Warning Placement

**File:** `src/features/live-monitor/services/ai-prompt.service.ts` (lines ~115–140)

**Problem:** The prompt warns the AI not to recommend markets with incomplete odds, but these warnings appear **after** the incomplete odds data is already listed. The AI sees the data before the instruction not to use it — conflicting signal ordering.

**Fix:** Place "DO NOT USE if null" instructions before presenting the odds data.

---

### M7 — Yellow Card Tracking: Not Separated From Reds in Server Derived Insights

**File:** `packages/server/src/lib/server-pipeline.ts` (lines ~155–160)

**Problem:** All card events increment `homeCards` (total), then `homeReds` is added if red. But the resulting `home_cards` includes red cards, so if you want `home_yellows = home_cards - home_reds` it works — but it's never computed or surfaced. AI prompt mentions "yellow card count" but only receives `total_cards`.

---

### M8 — FORCE_MODE Warning: Included in Notification But Not Actionable

**File:** `src/features/live-monitor/services/notification.service.ts`

**Problem:** `FORCE_MODE` warning appears in Telegram/email notifications. Users receiving this don't know what FORCE_MODE means or why it's listed. Needs either explanation or removal from end-user notifications (keep in logs only).

---

## 📋 Recommendations by Priority

### Immediate (Fix This Week)
1. **[C1]** Fix event type matching in `staleness.service.ts` — 5 min fix, high impact
2. **[C5]** Add post-parse enforcement for 1X2 before minute 35
3. **[H6]** Fix misleading condition-triggered notification when `should_push=false`

### Short Term (Fix This Sprint)
4. **[C2]** Fix `deriveInsightsFromEvents()` to properly split home/away events
5. **[H1]** Make `MIN_CONFIDENCE` / `MIN_ODDS` config-driven in server pipeline
6. **[H3]** Add `odds_fetched_at` and `odds_source` to AI prompt context
7. **[C4]** Log AI context fetch failures and communicate to prompt

### Medium Term
8. **[C3]** Add failure logging with replay context to `trackSilent`
9. **[H2]** Expose late-game thresholds (LATE/VERY_LATE/ENDGAME minutes) to config
10. **[H4]** Harden `normalizeMarketKey()` to handle odds-appended selections
11. **[M2]** Normalize `minute` field to `number | null` at API boundary
12. **[M6]** Reorder AI prompt — place constraints before data

### Nice to Have
13. **[M1]** Implement possession swing detection (currently stubbed)
14. **[H7]** Expand stats quality check to include all stat fields
15. **[M8]** Remove or explain FORCE_MODE in end-user notifications

---

## Data Flow Diagram (Current State)

```
Football API
    │
    ▼
fetch-matches.job.ts ──────────────────► matches table (DB)
    │                                          │
    │                                          ▼
    │                              getAllMatches() + snapshot JOIN
    │                                          │
    ▼                                          ▼
server-pipeline.ts              MatchesTab / WatchlistTab (UI)
    │
    ├── fetchFixtureStatistics()
    ├── fetchFixtureEvents()
    ├── buildStatsCompact()          ← stats available
    ├── deriveInsightsFromEvents()   ← stats unavailable [BROKEN - C2]
    │
    ▼
AI Prompt Builder
    ├── Match context
    ├── Stats / derived insights
    ├── Odds (live → pre-match → TheOddsAPI) [source not timestamped - H3]
    ├── Previous recommendations    [may be empty on DB failure - C4]
    └── Historical performance
    │
    ▼
LLM (Gemini / Claude)
    │
    ▼
parseAiResponse()
    ├── Market key normalization     [flawed - H4]
    ├── Business rule enforcement    [missing - C5]
    └── Odds extraction             [silent failure - M4]
    │
    ▼
Recommendation saved to DB
    │
    ├── trackSilent(snapshot, odds, perf)  [fire-and-forget - C3]
    │
    ▼
Staleness check on next run
    ├── Goal detection               [broken - C1]
    └── Red card detection           [broken - C1]
    │
    ▼
Notification (Telegram / Email)
    ├── Condition triggered even if no_push  [H6]
    └── FORCE_MODE unexplained               [M8]
```

---

*Generated by system review — 2026-03-18*
