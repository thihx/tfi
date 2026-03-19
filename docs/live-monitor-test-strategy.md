# Live Monitor — Test Strategy & Flow Comparison

## 1. n8n Workflow vs Migration — Flow Comparison

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   PIPELINE FLOW COMPARISON                                       │
├──────────┬──────────────────────────┬──────────────────────────┬─────────────────┤
│ Stage    │ n8n Node                 │ Migration Code           │ Status          │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 1.Config │ Set Config               │ loadMonitorConfig()      │ ✅ Equivalent    │
│          │ – CONFIG object          │ – createDefaultConfig()  │                 │
│          │ – webhook_params         │ – webhookMatchIds option │                 │
│          │ – is_manual_push         │ – MANUAL_PUSH_MATCH_IDS  │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 2.Load   │ Get Active Matches       │ loadAndFilterWatchlist() │ ✅ Equivalent    │
│          │ – Google Sheets read     │ – DB/API fetch           │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 3.Filter │ Filter Active Only       │ filterActiveMatches()    │ ✅ Equivalent    │
│          │ – By match_ids OR time   │ – Same dual-mode filter  │                 │
│          │ – force_analyze flag     │ – force_analyze flag     │                 │
│          │ – is_manual_push flag    │ – is_manual_push flag    │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 4.Gate   │ Has Active Matches?      │ if(length===0) return    │ ✅ Equivalent    │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 5.Prep   │ Prepare Match Data       │ prepareMatchData()       │ ✅ Equivalent    │
│          │ – Extract fields         │ – Same field mapping     │                 │
│          │ – recommended_custom_*   │ – recommended_custom_*   │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 6.Batch  │ Build Fixtures Batch     │ buildFixtureBatches()    │ ✅ Equivalent    │
│          │ – Dedup by match_id      │ – Dedup by match_id      │                 │
│          │ – Max 20 per batch       │ – Max 20 per batch       │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 7.Fetch  │ Fetch Live Data (HTTP)   │ fetchAllFixtures()       │ ✅ Equivalent    │
│          │ – api-sports /fixtures   │ – via proxy.service      │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 8.Merge  │ Merge Match Data         │ mergeMatchData()         │ ✅ Equivalent    │
│          │ – Stats extraction       │ – Stats extraction       │                 │
│          │ – Events → compact       │ – Events → compact       │                 │
│          │ – Pre-match prediction   │ – Pre-match prediction   │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 9.Check  │ Check Should Proceed     │ checkShouldProceed()     │ ✅ Equivalent    │
│          │ – Status: 1H/2H only     │ – Status: 1H/2H only    │                 │
│          │ – Minute: 5-85           │ – Minute: 5-85           │                 │
│          │ – 2H: 45+5 = min 50     │ – 2H: 45+5 = min 50     │                 │
│          │ – Stats quality          │ – Stats quality          │                 │
│          │ – Early game + poor      │ – Early game + poor      │                 │
│          │ – force_analyze bypass   │ – force_analyze bypass   │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 10.Gate  │ Should Proceed? (IF)     │ if(!proceed && !force)   │ ✅ Equivalent    │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 11.Odds  │ Fetch Live Odds (HTTP)   │ fetchFixtureOdds()       │ ✅ Equivalent    │
│          │ – api-sports /odds/live  │ – via proxy.service      │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 12.Merge │ Merge Odds to Match      │ mergeOddsToMatch()       │ ✅ Equivalent    │
│          │ – Canonical format       │ – Canonical format       │                 │
│          │ – Odds sanity check      │ – Odds sanity check      │                 │
│          │ – Half-time filter       │ – Half-time filter       │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 13.New   │ (N/A — stateless)       │ checkStaleness()          │ 🆕 Enhancement  │
│          │                          │ – Skip AI if <3 min +    │                 │
│          │                          │   no event changes       │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 14.New   │ (N/A — no context)      │ fetchMatchRecommendations │ 🆕 Enhancement  │
│          │                          │ fetchMatchSnapshots()     │                 │
│          │                          │ fetchHistoricalPerf()     │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 15.AI    │ Build AI Prompt          │ buildAiPrompt()          │ ✅ Equivalent+   │
│          │ – 8000+ line prompt      │ – Same prompt with       │                 │
│          │                          │   context enhancements   │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 16.Route │ Route AI Provider (IF)   │ routeAndCallAi()         │ ✅ Equivalent    │
│          │ – gemini → Gemini        │ – gemini → Gemini proxy  │                 │
│          │ – else → Claude          │ – else → Claude proxy    │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 17.Parse │ Parse AI Response        │ parseAiResponse()        │ ✅ Equivalent    │
│          │ – JSON extraction        │ – JSON extraction        │                 │
│          │ – Odds mapping           │ – Odds mapping           │                 │
│          │ – Confidence normalize   │ – Confidence normalize   │                 │
│          │ – Safety checks          │ – Safety checks (more)   │                 │
│          │ – Custom condition parse │ – Custom condition parse │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 18.Push  │ Should Push? (IF)        │ shouldPush()             │ ⚠️ SEE DIFF     │
│ Decision │ – ai_should_push OR      │ – ai_should_push OR      │ below           │
│          │   (condition_matched &&  │   (condition_matched &&  │                 │
│          │    status=="evaluated")  │    status=="evaluated")  │                 │
│          │   OR condition_triggered │   OR cond_trig_push      │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 19.Save  │ Should Save? (IF)        │ shouldSave()             │ ⚠️ FIXED v1.0.20│
│ Decision │ – ai_should_push ONLY    │ – NOW same as shouldPush │                 │
│          │                          │   (was bug: only checked │                 │
│          │                          │    ai_should_push)       │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 20.Save  │ Save Recommendation      │ saveRecommendation()     │ ✅ Equivalent    │
│          │ – Google Sheets append   │ – PostgreSQL upsert      │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 21.Email │ Format Email + Send      │ notifyRecommendation()   │ ✅ Equivalent    │
│          │ – Gmail                  │ – SendGrid via proxy     │                 │
├──────────┼──────────────────────────┼──────────────────────────┼─────────────────┤
│ 22.Tele  │ Format Telegram + Send   │ notifyRecommendation()   │ ✅ Equivalent    │
│          │ – Telegram Bot API       │ – Telegram via proxy     │                 │
└──────────┴──────────────────────────┴──────────────────────────┴─────────────────┘
```

### Key Differences Found

| # | Area | n8n Workflow | Migration | Impact |
|---|------|-------------|-----------|--------|
| 1 | **shouldSave** | Only `ai_should_push` | Same as `shouldPush` (fixed v1.0.20) | **Migration is MORE correct** — n8n missed condition saves |
| 2 | **Pipeline Order** | Notify BEFORE Save (parallel) | Save BEFORE Notify (fixed v1.0.20) | **Migration is MORE correct** — data persisted first |
| 3 | **Staleness** | Always re-analyzes AI | Skip if <3min + no changes | **Enhancement** — saves API costs |
| 4 | **Context** | Stateless (no history) | Previous recs + timeline + perf | **Enhancement** — better AI decisions |
| 5 | **condition_triggered_should_push** | Computed in Parse node | Computed in parseAiResponse | ✅ Same logic |
| 6 | **Auth Headers** | N/A (n8n handles) | Fixed in v1.0.20 (config.ts) | **Was bug** — now fixed |

---

## 2. Comprehensive Test Strategy

### Test Categories & Coverage Requirements

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEST PYRAMID                                  │
│                                                                  │
│                    ┌──────────┐                                  │
│                    │ E2E/Sim  │  Pipeline Simulation Tests       │
│                    │  (~25)   │  Full flow with data simulation  │
│                    ├──────────┤                                  │
│               ┌────┤Integration├────┐                            │
│               │    │   (~30)  │    │  Service interaction tests  │
│               │    ├──────────┤    │                              │
│          ┌────┤    │   Unit   │    ├────┐                        │
│          │    │    │  (~100+) │    │    │  Individual functions   │
│          └────┴────┴──────────┴────┴────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

### Category A: Football API Data Simulation (≥5 tests each)

Test real API response structures and edge cases:

| Scenario | Test Cases |
|----------|-----------|
| **A1. Normal Live Match** | 1H status, 2H status, with stats, with events, with odds |
| **A2. Edge Status** | HT (halftime), FT (full time), NS (not started), ABD (abandoned), PEN |
| **A3. Missing Stats** | No stats at all, partial stats, all zeros, null values, very poor quality |
| **A4. Odds Scenarios** | Normal odds, no odds returned, suspicious odds, half-time markets only, stale odds |
| **A5. Events Edge Cases** | Red card present, multiple goals, no events, own goal, penalty goal |
| **A6. Multi-Match Batch** | 3 matches all valid, mix of valid/invalid, >20 matches (multi-batch) |

### Category B: Auto-Trigger (Scheduled) Pipeline (≥5 tests each)

| Scenario | Test Cases |
|----------|-----------|
| **B1. Normal Scheduled Run** | 2H match proceeds, 1H match proceeds, multiple matches, save+notify, AI says push |
| **B2. Filter Rejection** | HT status rejected, minute <5 rejected, minute >85 rejected, 2H minute <50 rejected, FT rejected |
| **B3. Staleness Skip** | <3min no change → skip, ≥5min → re-analyze, goal scored → re-analyze, red card → re-analyze, odds moved → re-analyze |
| **B4. AI Response Handling** | Normal JSON, wrap in markdown, confidence >10 normalized, should_push=false, parse error |
| **B5. Error Recovery** | Fixture fetch fails, odds fetch fails → continue, AI call fails, save fails → still notify, match error → others continue |

### Category C: Manual/Ask-AI Pipeline (≥5 tests each)

| Scenario | Test Cases |
|----------|-----------|
| **C1. Ask AI with Selection** | AI returns real bet → save + notify, high confidence, low confidence but still save |
| **C2. Ask AI No Bet** | AI returns "No Bet" → no save + still notify, empty selection, dash "-" |
| **C3. Ask AI Force Analyze** | Non-live match (HT) → still analyzes, force bypasses all filters, skipped_filters populated |
| **C4. Ask AI Notification** | forceNotify=true → always sends, section=no_actionable but still sends, custom condition only |
| **C5. Ask AI Single Match** | Only processes 1 match from watchlist, correct match_id passed, MANUAL_PUSH_MATCH_IDS set |

### Category D: Push Notification Decision (≥5 tests each)

| Scenario | Test Cases |
|----------|-----------|
| **D1. AI Recommendation Push** | ai_should_push=true → push, section=ai_recommendation, email+telegram both sent |
| **D2. Condition Triggered Push** | custom_condition_matched + evaluated + suggestion → push, confidence ≥ MIN |
| **D3. No Push** | ai_should_push=false + no condition → no push, confidence < MIN, "No Bet" suggestion |
| **D4. Channel Failures** | Email fails → telegram still sends, telegram fails → email still sends, both fail → errors logged |
| **D5. Content Formatting** | AI recommendation section built, condition triggered section built, events + stats included, HTML escaped |

### Category E: Database Save Decision (≥5 tests each)

| Scenario | Test Cases |
|----------|-----------|
| **E1. AI Push Save** | ai_should_push=true → saved, recommendation fields correct |
| **E2. Condition Save** | custom_condition_matched + evaluated → saved, condition fields preserved |
| **E3. Condition Triggered Save** | condition_triggered_should_push=true → saved |
| **E4. No Save** | ai_should_push=false + no conditions → not saved, ask-ai with "No Bet" → not saved |
| **E5. Save Data Integrity** | unique_key computed correctly, stats/odds snapshots serialized, execution_id present, dedup key correct |

### Category F: Custom Condition Logic (≥5 tests each)

| Scenario | Test Cases |
|----------|-----------|
| **F1. Condition Matched** | matched=true + evaluated → condition_triggered_should_push computed |
| **F2. Condition Not Matched** | matched=false → triggered_suggestion empty, confidence=0 |
| **F3. No Condition** | status=none → no evaluation, all trigger fields default |
| **F4. Parse Error** | status=parse_error → matched=false, reason explains |
| **F5. Condition-Triggered with Bet** | Suggestion is real bet → save + push, suggestion is "No bet" → no push |

---

## 3. Test Data Simulation Fixtures

### Football API Response Scenarios

Each scenario uses realistic data that mirror actual API-Sports responses.
All fixtures defined in `__tests__/simulation-fixtures.ts`.

### Deterministic Pipeline Outcomes

Every test case has a **deterministic expected outcome** so we can assert:
- ✅ `matchResult.proceeded` — did it pass filters?
- ✅ `matchResult.saved` — was recommendation saved?
- ✅ `matchResult.notified` — was notification sent?
- ✅ `matchResult.stage` — what stage completed at?
- ✅ `parsed.ai_should_push` — did AI recommend?
- ✅ `parsed.condition_triggered_should_push` — did condition trigger?

---

## 4. Implementation Plan

Files to create:
1. `__tests__/simulation-fixtures.ts` — Extended test data factories
2. `__tests__/pipeline-e2e.test.ts` — Categories A-F comprehensive tests

Target: **≥150 new test cases** covering every scenario above.
