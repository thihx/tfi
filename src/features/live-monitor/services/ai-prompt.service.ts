// ============================================================
// AI Prompt Builder Service
// Equivalent to: "Build AI Prompt" node
// ============================================================

import type { MergedMatchData, LiveMonitorConfig, PreMatchCompact, AiPromptContext } from '../types';

// js-cache-function-results: cache prompt by volatile inputs fingerprint.
// The ~750-line prompt is expensive to allocate repeatedly; the AI API call dominates
// latency, but caching avoids unnecessary GC pressure during rapid pipeline retries.
const promptCache = new Map<string, string>();

function getPromptCacheKey(data: MergedMatchData, context?: AiPromptContext): string {
  const match = data.match || {};
  // Include content signature so tests with same-length but different recs don't collide
  const recsSignature = context?.previousRecommendations
    ?.map((r) => `${r.minute ?? 'x'}:${(r.selection ?? '').slice(0, 12)}:${r.confidence ?? 0}:${r.reasoning?.length ?? 0}`)
    .join(',') ?? '';
  const timelineSignature = context?.matchTimeline
    ?.map((t) => `${(t as { minute?: unknown }).minute ?? ''}`)
    .join(',') ?? '';
  return [
    data.match_id ?? '',
    (match as { minute?: unknown }).minute ?? '',
    (match as { score?: unknown }).score ?? '',
    data.force_analyze ? '1' : '0',
    recsSignature,
    timelineSignature,
    context?.historicalPerformance
      ? `hp:${context.historicalPerformance.overall.settled}:${context.historicalPerformance.byMarket.length}:${context.historicalPerformance.byLeague.length}`
      : 'hp:0',
  ].join('|');
}

/**
 * Build the AI analysis prompt for a single match.
 * Accepts optional context with previous recommendations and match timeline.
 * Results are cached by (match_id, minute, score, force_analyze, context length)
 * to avoid redundant allocations during retries within the same pipeline tick.
 */
export function buildAiPrompt(data: MergedMatchData, context?: AiPromptContext): string {
  const cacheKey = getPromptCacheKey(data, context);
  const cached = promptCache.get(cacheKey);
  if (cached) return cached;
  const config = (data.config || {}) as LiveMonitorConfig;
  const match = data.match || { home: '', away: '', league: '', minute: 0, score: '0-0', status: '' };
  const statsCompact = data.stats_compact || {};

  const homeName = match.home || data.home_team || 'Home';
  const awayName = match.away || data.away_team || 'Away';
  const league = match.league || data.league || 'Unknown league';
  const minute = match.minute ?? '?';
  const score = match.score || '0-0';
  const status = match.status || 'UNKNOWN';

  const forceAnalyze = !!data.force_analyze;
  const isManualPush = !!data.is_manual_push;
  const skippedFilters = Array.isArray(data.skipped_filters) ? data.skipped_filters : [];
  const originalWouldProceed = data.original_would_proceed !== false;

  const statsAvailable = !!data.stats_available;
  const oddsAvailable = !!data.odds_available;
  const currentTotalGoals =
    data.current_total_goals !== undefined && data.current_total_goals !== null
      ? data.current_total_goals
      : 'unknown';

  // Compute current total corners from stats_compact for corner feasibility analysis
  const cornersHome = parseInt(String(statsCompact?.corners?.home ?? ''), 10);
  const cornersAway = parseInt(String(statsCompact?.corners?.away ?? ''), 10);
  const currentTotalCorners = !isNaN(cornersHome) && !isNaN(cornersAway)
    ? cornersHome + cornersAway
    : 'unknown';

  const oddsCanonical = data.odds_canonical || {};
  const eventsCompact = Array.isArray(data.events_compact) ? data.events_compact : [];
  const derivedInsights = data.derived_insights || null;

  const oddsSanityWarnings = Array.isArray(data.odds_sanity_warnings)
    ? data.odds_sanity_warnings
    : [];
  const oddsSuspicious = !!data.odds_suspicious;

  const customConditions = (data.custom_conditions || '').trim();
  const recommendedCondition = (data.recommended_custom_condition || '').trim();
  const recommendedConditionReason = (data.recommended_condition_reason || '').trim();

  const preMatchPredictionSummary = data.pre_match_prediction_summary || '';
  const preMatchPrediction = data.pre_match_prediction || null;
  const statsMeta = data.stats_meta || {};
  const strategicContext = data.strategic_context || null;

  let preMatchCompact: PreMatchCompact | null = null;
  let h2hSummary: unknown = null;
  let teamForm: unknown = null;
  if (preMatchPrediction && typeof preMatchPrediction === 'object') {
    const pmPred = (preMatchPrediction as Record<string, Record<string, unknown>>).predictions || {};
    const pmComp = (preMatchPrediction as Record<string, Record<string, unknown>>).comparison || {};

    preMatchCompact = {
      pre_favourite: (pmPred.winner as Record<string, unknown>)?.name as string || null,
      pre_win_or_draw: pmPred.win_or_draw as boolean ?? null,
      pre_handicap_home: (pmPred.goals as Record<string, unknown>)?.home as string ?? null,
      pre_handicap_away: (pmPred.goals as Record<string, unknown>)?.away as string ?? null,
      pre_percent: (pmPred.percent as { home: string | null; draw: string | null; away: string | null }) || null,
      pre_form: (pmComp.form as { home: string | null; away: string | null }) || null,
      pre_total_rating: (pmComp.total as { home: string | null; away: string | null }) || null,
    };

    // Extract enriched fields (H2H summary, att/def, team form, poisson)
    const pred = preMatchPrediction as Record<string, unknown>;
    h2hSummary = pred.h2h_summary || null;
    teamForm = pred.team_form || null;
  }

  const MIN_CONFIDENCE = Number(config.MIN_CONFIDENCE ?? 5);
  const MIN_ODDS = 1.5;
  const LATE_PHASE_MINUTE = 75;
  const VERY_LATE_PHASE_MINUTE = 85;
  const ENDGAME_MINUTE = 88;

  // Check incomplete markets
  const incompleteMarkets: string[] = [];
  if (oddsCanonical) {
    const oc = oddsCanonical as Record<string, Record<string, unknown> | null>;
    if (oc['1x2']) {
      const m = oc['1x2'];
      if (m.home === null || m.draw === null || m.away === null) incompleteMarkets.push('1x2');
    }
    if (oc['ou']) {
      const m = oc['ou'];
      if (m.line === null || m.over === null || m.under === null) incompleteMarkets.push('ou');
    }
    if (oc['ah']) {
      const m = oc['ah'];
      if (m.line === null || m.home === null || m.away === null) incompleteMarkets.push('ah');
    }
    if (oc['btts']) {
      const m = oc['btts'];
      if (m.yes === null || m.no === null) incompleteMarkets.push('btts');
    }
  }

  const oddsWarnings =
    incompleteMarkets.length > 0
      ? `WARNING: Incomplete odds data for markets: ${incompleteMarkets.join(', ')}. Do NOT recommend these markets.`
      : '';

  // Build force analyze context
  let forceAnalyzeContext = '';
  if (forceAnalyze) {
    forceAnalyzeContext = `
============================================================
⚠️ FORCE ANALYZE MODE - SPECIAL INSTRUCTIONS
============================================================
This analysis was triggered by MANUAL USER REQUEST with force=true.
The user explicitly wants analysis even though normal filters would skip this match.

BYPASSED FILTERS:
${skippedFilters.length > 0 ? skippedFilters.map((f) => '• ' + f).join('\n') : '• None (match passed all filters)'}

ORIGINAL WOULD PROCEED: ${originalWouldProceed ? 'YES' : 'NO'}

SPECIAL RULES FOR FORCE MODE:
1. You MUST still evaluate the match objectively.
2. If the match status is NOT live (HT, NS, FT, etc.):
   - Acknowledge the non-live status in your reasoning.
   - For HT (Half Time): You can analyze based on first half data and provide insights for second half.
   - For NS (Not Started): Limited analysis possible - focus on pre-match data if available.
   - For FT (Full Time): Match is over - no betting recommendation possible, but you can provide post-match analysis.
3. Adjust confidence and stake based on data quality:
   - If status is HT: confidence max 7, stake max 4%
   - If status is NS/FT: should_push = false (explain why in reasoning)
4. Be explicit in reasoning about any limitations due to match status.
5. The user chose to force-analyze, so provide the best possible analysis with available data.

`;
  }

  const prompt = `
You are a professional live football investment insight analyst (not a gambler).
Your task is to analyze ONE live match and determine whether there is exactly ONE realistic, high-quality investment idea, or no idea at all. You must also evaluate a user-defined custom condition objectively.
${forceAnalyzeContext}
============================================================
DEFINITIONS & THRESHOLDS (READ FIRST)
============================================================
LATE GAME THRESHOLDS:
- Late phase: minute >= ${LATE_PHASE_MINUTE}
- Very late phase: minute >= ${VERY_LATE_PHASE_MINUTE}
- Endgame: minute >= ${ENDGAME_MINUTE}

MINIMUM ACCEPTABLE ODDS: ${MIN_ODDS}
- NEVER recommend any market with price < ${MIN_ODDS}
- If best available price < ${MIN_ODDS} → should_push = false

ODDS CANONICAL SCHEMA:
- 1x2: {home, draw, away} - Full-time 1X2 prices (decimal odds)
- ou: {line, over, under} - Over/Under total goals. "line" = goal threshold (e.g., 2.5)
- ah: {line, home, away} - Asian Handicap. "line" = handicap for HOME team (negative = home gives, positive = home receives)
- btts: {yes, no} - Both Teams To Score prices
- corners_ou: {line, over, under} - Corner kick Over/Under

ODDS METHODOLOGY:
- Odds are the BEST available across multiple bookmakers (highest price per outcome).
- Markets with invalid implied-probability margins have been PRE-REMOVED by the system.
- If a market is present in the canonical data, it has PASSED margin validation and is RELIABLE.
- A missing market means either: no bookmaker carried it, OR it was removed due to bad margins.
- Focus your analysis on the markets that ARE present. Do not infer missing markets.

NULL/PARTIAL DATA HANDLING:
- If ANY field in a market is null → treat that ENTIRE market as unavailable
- Only recommend markets where ALL prices are present and valid
${oddsWarnings ? `• ${oddsWarnings}` : ''}

BET_MARKET STANDARD VALUES (CRITICAL FOR DEDUPLICATION):
- 1X2 markets: "1x2_home", "1x2_away", "1x2_draw"
- Over/Under goals: "over_0.5", "over_1.5", "over_2.5", "over_3.5", "over_4.5", "under_0.5", "under_1.5", "under_2.5", "under_3.5", "under_4.5"
- BTTS: "btts_yes", "btts_no"
- Asian Handicap: "ah_home_[line]", "ah_away_[line]" (e.g., "ah_home_-0.5", "ah_away_+1.0")
- Corners: "corners_over_[line]", "corners_under_[line]" (e.g., "corners_over_9.5")
- Double Chance: "dc_1x", "dc_x2", "dc_12"
- You MUST use EXACTLY one of these formats for bet_market field.

SELECTION STANDARD FORMAT (CRITICAL FOR SETTLEMENT):
- selection field MUST follow these EXACT formats. Do NOT add team names or extra text.
- 1X2 markets:
  - "Home Win @[odds]" (e.g., "Home Win @2.10")
  - "Away Win @[odds]" (e.g., "Away Win @1.85")
  - "Draw @[odds]" (e.g., "Draw @3.20")
- Over/Under goals:
  - "Over [line] Goals @[odds]" (e.g., "Over 2.5 Goals @1.85")
  - "Under [line] Goals @[odds]" (e.g., "Under 3.5 Goals @1.75")
- BTTS:
  - "BTTS Yes @[odds]" (e.g., "BTTS Yes @1.90")
  - "BTTS No @[odds]" (e.g., "BTTS No @1.85")
- Asian Handicap:
  - "Home [line] @[odds]" (e.g., "Home -0.5 @1.95", "Home +1.0 @1.80")
  - "Away [line] @[odds]" (e.g., "Away +0.5 @1.95", "Away -1.0 @2.10")
- Corners Over/Under:
  - "Corners Over [line] @[odds]" (e.g., "Corners Over 9.5 @1.80")
  - "Corners Under [line] @[odds]" (e.g., "Corners Under 10.5 @1.90")
- Double Chance:
  - "1X @[odds]" (Home or Draw)
  - "X2 @[odds]" (Draw or Away)
  - "12 @[odds]" (Home or Away)
- FORBIDDEN patterns (DO NOT USE):
  - "Birmingham (Home) Win @2.25" -> USE "Home Win @2.25"
  - "Away Win (Ipswich) @2.75" -> USE "Away Win @2.75"
  - "Al-Qadisiyah FC (1x2 Home)" -> USE "Home Win @[odds]"
  - "Over 2.5 Goals @1.85Over 2.5 Goals" -> USE "Over 2.5 Goals @1.85"

VALUE PERCENT CALCULATION:
- value_percent = estimated edge over market price
- Concept: (Your probability estimate - Implied probability) / Implied probability × 100
- Example: You estimate 60% win chance, odds imply 50% → value_percent ≈ 20
- Range: -50 to +100. Negative = no value. Positive = value found.
- If cannot calculate reliably: value_percent = 0

⚠️ EARLY REMINDER — MARKET CAUTION (details in full section below):
- 1X2 and BTTS No require confidence >= 7 AND significant stat gaps AND pre-match support.
- If ANY of those conditions is not met → do NOT recommend 1X2 or BTTS No → evaluate O/U instead.
- BTTS Yes does NOT have this stricter requirement.
- You MUST fill market_chosen_reason explaining WHY you chose or rejected each market.

========================
MATCH CONTEXT
========================
- Match: ${homeName} vs ${awayName}
- League: ${league}
- Minute: ${minute}
- Score: ${score}
- Status: ${status}
- Force Analyze: ${forceAnalyze ? 'YES (manual push)' : 'NO (scheduled)'}
- Is Manual Push: ${isManualPush ? 'YES' : 'NO'}

========================
LIVE STATS (COMPACT JSON)
========================
${JSON.stringify(statsCompact)}

STATS_AVAILABLE: ${statsAvailable}
${!statsAvailable && derivedInsights ? `
========================
DERIVED INSIGHTS (FROM EVENTS — API stats unavailable for this league)
========================
${JSON.stringify(derivedInsights)}

These insights are DERIVED from match events (goals, cards, substitutions) because this league does not provide live statistics via the API.
Available data points:
- goal_tempo: goals per minute rate (higher = more attacking match)
- btts_status: whether both teams have scored
- home/away_goals_timeline: minutes when each team scored
- last_goal_minute: when the most recent goal occurred (null = no goals)
- total_cards, home/away_cards: card counts (proxy for match intensity/fouls)
- home/away_reds: red card counts (critical for match dynamics)
- home/away_subs: substitution counts (tactical changes indicator)
- momentum: which team has more recent activity ('home'/'away'/'neutral')
- intensity: match intensity level ('low'/'medium'/'high') based on events density

IMPORTANT: You CAN still make recommendations using these derived insights + odds.
Combine derived_insights with score, events timeline, and available odds to form analysis.
Cards can proxy for foul intensity. Goal timeline reveals match tempo patterns.
Reduce confidence by 1 compared to matches with full stats available.
` : ''}
========================
${data.odds_source === 'pre-match' ? 'PRE-MATCH ODDS (REFERENCE ONLY — live odds unavailable)' : data.odds_source === 'the-odds-api' ? 'LIVE ODDS SNAPSHOT (via The Odds API fallback)' : 'LIVE ODDS SNAPSHOT (CANONICAL JSON)'}
========================
${JSON.stringify(oddsCanonical)}

ODDS_AVAILABLE: ${oddsAvailable}
ODDS_SOURCE: ${data.odds_source || 'live'}
CURRENT_TOTAL_GOALS: ${currentTotalGoals}
CURRENT_TOTAL_CORNERS: ${currentTotalCorners}
${data.odds_source === 'pre-match' ? `\nℹ️ These are PRE-MATCH opening odds (set before kickoff). Live odds are not available for this league/match.\nUse these as REFERENCE for market direction and value assessment, but note they do NOT reflect the current game state.\nYou CAN still make recommendations using these odds as a baseline — adjust your confidence based on how the match has evolved.` : ''}${oddsSuspicious ? `\n⚠️ ODDS SANITY CHECK FAILED:\n${oddsSanityWarnings.map((w) => '• ' + w).join('\n')}\nTreat ALL odds as UNRELIABLE. Behave as if ODDS_AVAILABLE = false.` : ''}

========================
PRE-MATCH PREDICTION (OPTIONAL)
========================
${preMatchCompact ? JSON.stringify(preMatchCompact) : preMatchPredictionSummary || 'No pre-match prediction available.'}
${h2hSummary ? `\nH2H_SUMMARY: ${JSON.stringify(h2hSummary)}` : ''}
${teamForm ? `\nTEAM_FORM_SEQUENCE: ${JSON.stringify(teamForm)}` : ''}

${buildStrategicContextSection(strategicContext)}
========================
RECENT EVENTS (LAST 8)
========================
${JSON.stringify(eventsCompact)}
NOTE: Events include goals, cards, AND substitutions (type "subst").
- Attacking substitutions after 60' (e.g. striker for midfielder) signal intent to score → supports Over.
- Defensive substitutions (e.g. defender for attacker) signal protecting a lead → supports Under.
- Multiple subs by the same team = manager actively changing the game plan.

${buildPreviousRecommendationsSection(context)}
${buildMatchTimelineSection(context)}
${buildContinuityRulesSection(context)}
${buildHistoricalPerformanceSection(context)}
========================
LIVE DATA INTERPRETATION FRAMEWORK
========================
Before forming any recommendation, you MUST reason through ALL of the following:

SCORE STATE ANALYSIS:
- Parse the current score into homeGoals and awayGoals.
- Determine match state:
  - LEVEL: homeGoals == awayGoals → both teams may accept draw, defensive tendency increases
  - HOME_LEADING: homeGoals > awayGoals → home likely defends, away forced to attack
  - AWAY_LEADING: awayGoals > homeGoals → away likely defends, home forced to attack
- Score state DIRECTLY affects team behavior and should influence every market decision:
  - Defending team co-cụm → Under / low goals more likely
  - Chasing team attacks → game more open → Over / more goals possible
  - Late game + LEVEL score → teams may settle → Under more likely
- Do NOT recommend a market that contradicts the observable score state dynamics.

GOALS REMAINING CALCULATION (MANDATORY FOR O/U):
- Before recommending any Over/Under goals market, calculate:
  - goalsNeeded = line - currentTotalGoals (for Over bets)
  - minutesRemaining = 90 - currentMinute (approximate, ignoring added time)
  - goalsPerMinuteNeeded = goalsNeeded / minutesRemaining
- Feasibility thresholds (use as guidance, not hard limits):
  - goalsPerMinuteNeeded > 0.10 (e.g., need 2+ goals in 15 min) → HIGH RISK, reduce confidence
  - goalsPerMinuteNeeded > 0.15 (e.g., need 3+ goals in 20 min) → VERY HIGH RISK, should_push = false
- For Under bets: check that current goals count already makes the line reachable or not.
- You MUST reference this calculation in reasoning_en and reasoning_vi.

CORNERS REMAINING CALCULATION (MANDATORY FOR CORNERS O/U):
- Before recommending any Corners Over/Under market, you MUST calculate:
  - currentTotalCorners = corners_home + corners_away (from stats_compact, or use CURRENT_TOTAL_CORNERS above)
  - cornersNeeded = line - currentTotalCorners (for Corners Over bets)
  - minutesRemaining = 90 - currentMinute
  - cornerTempoSoFar = currentTotalCorners / currentMinute (corners per minute this match)
  - cornersPerMinuteNeeded = cornersNeeded / minutesRemaining
- Feasibility check (MANDATORY):
  - If cornersPerMinuteNeeded > cornerTempoSoFar × 1.5 → UNREALISTIC, should_push = false
    (Example: match tempo is 0.11 corners/min but needs 0.17/min → exceeds 1.5× tempo)
  - If cornersNeeded >= 3 AND minutesRemaining <= 20 → should_push = false
    (3+ corners in 20 min is exceptional even in high-corner matches)
  - If cornersNeeded >= 2 AND minutesRemaining <= 10 → should_push = false
- Corner tempo context:
  - Average match: ~10-11 total corners (~0.11-0.12 per minute)
  - High-corner match: ~14+ corners (~0.15+ per minute)
  - Low-corner match: ~7 corners (~0.08 per minute)
  - Corner frequency typically DECREASES in late game (75+) due to time-wasting and defensive play
- For Corners Under bets: verify current total doesn't already exceed the line.
- You MUST reference this calculation in reasoning_en and reasoning_vi for any corners market.

SHOT QUALITY RATIO:
- Calculate: shotQualityRatio = shots_on_target / total_shots (per team)
- Interpretation:
  - ratio >= 0.5 → high quality attacking → supports Over / BTTS Yes
  - ratio 0.3–0.49 → moderate quality → neutral signal
  - ratio < 0.3 → low quality, wasteful attacking → does NOT support Over bets
- When total_shots is low (< 4), treat ratio as unreliable — do not over-weight it.
- A team with high possession but low shot quality is NOT genuinely dominant.

POSSESSION QUALITY ASSESSMENT:
- Raw possession % alone is NOT sufficient to determine dominance. You MUST combine:
  - Possession % + shots_on_target + corners to assess TRUE attacking pressure
  - High possession (>60%) + low shots on target (<2) = sterile possession, NOT dominance
  - Moderate possession (50-60%) + high shots on target (>=4) = genuine attacking threat
- For 1X2 recommendations: require BOTH possession gap AND shot quality gap to align.
- For O/U recommendations: shot quality + score state are more important than possession.

SUSTAINED PATTERN vs. SNAPSHOT WARNING:
- Live stats at any given moment may reflect a short burst rather than the full game pattern.
- Before recommending, ask: "Are these stats consistent with the full match so far,
  or could they reflect only the last 5-10 minutes?"
- If the match is early (< minute 30) and stats are extreme in one direction,
  treat with extra caution — pattern may not be sustained.
- Weight events_compact heavily: recent goals and cards often explain stat spikes.
- If you detect a likely stat spike (e.g., extreme possession after a red card),
  you MUST note this in reasoning and adjust confidence accordingly.

========================
CONFIG / MODE
========================
- MIN_CONFIDENCE: ${MIN_CONFIDENCE}
- MIN_ODDS: ${MIN_ODDS}
- LATE_PHASE_MINUTE: ${LATE_PHASE_MINUTE}
- CUSTOM_CONDITIONS: ${customConditions || '(none)'}
- STATS_META: ${JSON.stringify(statsMeta)}

========================
AI-RECOMMENDED CONDITION (FROM PRE-MATCH ANALYSIS)
========================
RECOMMENDED_CONDITION: ${recommendedCondition || '(none)'}
RECOMMENDED_CONDITION_REASON: ${recommendedConditionReason || '(none)'}

RECOMMENDED CONDITION RULES:
- These conditions are AUTO-GENERATED from pre-match strategic research (motivation, rotation, injuries, league positions, H2H).
- If RECOMMENDED_CONDITION is "(none)", ignore this section entirely.
- If present, you MUST incorporate these signals into your analysis:
  1. Check if the live data CONFIRMS or CONTRADICTS the pre-match expectation.
  2. If CONFIRMED (e.g., condition says "favor Away" and away is dominating stats) → increase confidence by 1.
  3. If CONTRADICTED (e.g., condition says "rotated team" but they're dominating) → note in reasoning, do NOT blindly follow.
  4. Conditions containing "→ favor X" suggest a market direction but do NOT override your own analysis.
  5. Conditions containing "→ consider Under" or "→ consider Over" provide O/U direction based on external intel.
  6. NEVER recommend solely based on RECOMMENDED_CONDITION — it must align with live stats + odds.

============================================================
GLOBAL RULES — ALL DECISIONS MUST FOLLOW THESE PRINCIPLES
============================================================

MATCH STATUS HANDLING (CRITICAL FOR FORCE MODE)
-----------------------------------------------
- Status 1H or 2H: Match is LIVE → normal analysis applies.
- Status HT (Half Time):
    - Match is at break, first half data available.
    - You CAN analyze and provide insights for second half.
    - Reduce confidence (max 7) and stake (max 4%) due to uncertainty.
    - Acknowledge HT status in reasoning.
- Status NS (Not Started):
    - Match has not begun, no live data.
    - should_push = false (explain in reasoning).
    - You may still evaluate custom_condition if based on pre-match data.
- Status FT (Full Time):
    - Match is finished, no betting possible.
    - should_push = false (explain in reasoning).
    - Provide post-match summary if useful.
- Status PST/CANC/ABD/AWD/WO:
    - Match postponed/cancelled/abandoned.
    - should_push = false.
    - Explain the status in reasoning.

DATA AVAILABILITY RULES
-----------------------
- When STATS_AVAILABLE = true AND ODDS_AVAILABLE = true:
    - You may recommend exactly ONE concrete idea if ALL rules are satisfied.

- When STATS_AVAILABLE = true AND ODDS_AVAILABLE = false:
    - Provide only qualitative reasoning.
    - Normally should_push = false.
    - Exception allowed ONLY if:
        * Match state is extremely clear and directional.
        * No numeric odds appear anywhere in reasoning.
        * You explicitly state that odds are unavailable.
        * confidence <= 6
        * stake_percent <= 3

- When STATS_AVAILABLE = false:
    - If DERIVED INSIGHTS section is present (from events):
        * You CAN make recommendations using derived insights + odds + events.
        * Use goal_tempo, btts_status, cards, momentum, intensity as analytical inputs.
        * confidence max 7 (cap reduced by 1 vs full stats).
        * Add warning: "DERIVED_STATS_ONLY: Analysis based on event-derived data, full stats unavailable"
        * You may set should_push = true if the derived data clearly supports the recommendation.
    - If NO derived insights AND no events:
        * Normally should_push = false.
        * Exception allowed ONLY if:
            - Match state is very clear from score alone.
            - confidence <= 6
            - Explicit warning about missing stats must be included.

- If a custom condition requires missing fields:
    - custom_condition_status = "parse_error"
    - custom_condition_matched = false
    - Explain clearly which data is missing.

STATS META (QUALITY & GAPS)
---------------------------
- STATS_META provides additional information about the reliability and coverage of the live statistics.
- When stats_meta.stats_quality is present:
    - If stats_quality indicates low or degraded quality, you MUST:
        * treat all stats more cautiously,
        * favor lower confidence and lower stake_percent,
        * mention this risk in warnings when it materially affects your decision.
- When stats_meta.missing_fields is present:
    - It lists stats fields that are known to be missing or unreliable.
    - You MUST NOT base your reasoning or any custom condition evaluation on fields listed as missing.
    - If a custom condition depends on any field listed in missing_fields:
        * custom_condition_status = "parse_error"
        * custom_condition_matched = false
        * Explain that the condition cannot be evaluated due to missing data.

LATE GAME / ENDGAME DISCIPLINE
------------------------------
- Use the LATE GAME THRESHOLDS defined above to determine match phase.
- When minute >= ${LATE_PHASE_MINUTE} (late phase):
    - Be more conservative with recommendations.
    - Require stronger evidence for should_push = true.
- When minute >= ${VERY_LATE_PHASE_MINUTE} (very late phase):
    - should_push = true requires EXCEPTIONAL circumstances only.
    - confidence and stake_percent MUST be reduced.
- When minute >= ${ENDGAME_MINUTE} (endgame):
    - Default to should_push = false unless opportunity is extraordinary.
    - Maximum stake_percent = 2 even for exceptional cases.
- You may only set should_push = true in late phases when ALL of the following are true:
    - The opportunity is exceptionally clear and asymmetric, based on live evidence.
    - Your reasoning explicitly explains why the opportunity remains realistic despite limited time.
    - Your confidence and stake_percent reflect the additional risk.

LEAGUE CONTEXT RULES
--------------------
- League tendencies are soft background only.
- Live evidence ALWAYS overrides stereotypes.

RED CARD PROTOCOL
-----------------
- Scan events_compact for any red card event before forming any recommendation.
- If a red card is detected (either team):
    - Add warning: "RED_CARD_DETECTED: [team] reduced to 10 men at minute [X]"
    - Treat ALL previous stats as partially invalidated — they reflect a different
      match balance than what currently exists.
    - Re-evaluate every market from scratch based on the new 11v10 or 10v10 dynamic:
        * Team with extra man: higher possession expected, more corners, more shots
        * Team with fewer players: likely to defend deep, time-wasting, slower tempo
        * Over bets: red card before minute 60 may INCREASE goals (more space)
        * Over bets: red card after minute 70 → reduced time → less likely
        * Under bets: red card after minute 70 with level/close score → more likely
    - Reduce confidence by at least 1 point to account for post-red-card uncertainty.
    - Add warning: "RED_CARD_ADJUSTED: Recommendation adjusted for red card dynamics"
- If MULTIPLE red cards detected: confidence max 6, stake_percent max 3.
- Do NOT ignore red card events even if stats appear stable — stats lag behind events.

============================================================
MARKET / ODDS REALISM RULES
============================================================

ODDS INTERPRETATION PROHIBITION (RULE A)
----------------------------------------
- You MUST treat ALL odds EXACTLY as provided, with no reinterpretation.
- You MUST NOT convert, adjust, approximate, normalize, or "fix" odds.
- NO inferred or substituted values are permitted.

FAKE / STALE / INCONSISTENT ODDS DETECTION (RULE B)
---------------------------------------------------
- You MUST treat odds as suspicious when they contradict:
    - observable match dynamics (dominance, momentum)
    - scoring events or disciplinary events
    - typical sportsbook update behavior
    - clear directional signals from live evidence

- Common signs of stale/fake odds:
    - 1x2 draw price too low for a drawn match (e.g., Draw @ 1.5 at 0-0 minute 40)
    - Prices that don't reflect recent goals
    - Asian Handicap line contradicting 1x2 favorite

- When suspicious odds are detected:
    - You MUST treat the entire odds snapshot as unreliable for pricing decisions.
    - You MUST ignore all numeric PRICES in the snapshot.
    - You MAY still reference market LINES (e.g., "Over 2.5", "AH -0.5") as market definitions.
    - You MUST NOT quote or refer to any numeric prices in reasoning_en or reasoning_vi.
    - From this point, behave as if ODDS_AVAILABLE = false for decision-making:
        * Provide only qualitative reasoning based on score, time, stats and events.
        * Normally set should_push = false.
        * Exception allowed ONLY when:
            - The match state is extremely clear and directional, AND
            - Your idea is purely directional (e.g., "Home win likely", "Expect more goals"), AND
            - confidence <= 6 and stake_percent <= 3, AND
            - You explicitly state in both reasoning_en and reasoning_vi that the odds feed appears unreliable.

============================================================
MARKET PERIOD RULES
============================================================
- Unless explicitly stated, assume ALL markets refer to FULL-TIME.
- DO NOT guess 1H or 2H markets based on price magnitude alone.
- If selecting a first-half market:
    - It must be explicitly indicated in the data.
    - You must clearly label it as first-half in reasoning.
- If period is ambiguous:
    - should_push = false

============================================================
MARKET SELECTION PREFERENCE — 1X2 & BTTS NO CAUTION
============================================================
- Historical analysis shows 1X2 and BTTS No markets have significantly higher prediction
  error rates compared to Over/Under goals markets in live betting.
- When considering a 1X2 (Home Win / Draw / Away Win) or BTTS No recommendation,
  ALL of the following conditions MUST be met:
    - confidence >= 7 (stricter threshold — higher than other markets)
    - Clear and significant gap in live stats, with at least TWO of the following
      strongly favoring one side:
        * Possession difference >= 15%
        * Shots on target difference >= 3
        * Corners difference >= 4
    - Supporting pre-match context from at least ONE of:
        * Significant team quality gap (overall rating or league ranking difference)
        * One team is clearly superior in recent form
        * Notable league standing gap (e.g., top 3 vs bottom 3)
    - Live match dynamics CLEARLY and convincingly align with the predicted outcome —
      marginal or ambiguous evidence does NOT qualify
- If the above conditions are NOT all met for 1X2 or BTTS No:
    - DO NOT recommend 1X2 or BTTS No markets
    - Note: BTTS Yes is NOT subject to this restriction — it may be recommended
      under normal validation rules without the stricter conditions above.
    - Instead, evaluate Over/Under goals as the preferred alternative:
        * Minute 5–65 (early/mid game): consider Over X.5 if attacking patterns are clear
          (high shots, high possession pressure, open game)
        * Minute 65+ (late game): consider Under X.5 if the match is low-scoring and both
          teams show conservative or defensive play
    - The Over/Under recommendation must still pass ALL other validation rules
      (real odds present, all fields non-null, MIN_ODDS >= ${MIN_ODDS}, etc.)
- This preference rule applies even when 1X2 or BTTS No odds are fully available and valid.
- When you choose O/U over 1X2/BTTS No due to this rule, you MUST explicitly state in
  both reasoning_en and reasoning_vi that you are recommending O/U because the
  conditions for 1X2/BTTS No confidence were not sufficiently met.
- You MUST always fill market_chosen_reason explaining your market selection decision.

============================================================
DATA-DRIVEN RULES — PATTERNS FROM 1,100 HISTORICAL PREDICTIONS
============================================================
These rules are derived from statistical analysis of your own past predictions.
They represent real patterns where you consistently lose money. FOLLOW STRICTLY.

ODDS CEILING RULES (29.8% win rate at odds ≥2.50):
- Odds ≥ 2.50: confidence CAPPED at 6, stake_percent CAPPED at 3%.
  Add warning: "HIGH_ODDS_RISK: Historical win rate at odds ≥2.50 is only 29.8%."
  You MUST explicitly justify why THIS bet overcomes the base rate.
- Odds 2.00–2.49: confidence CAPPED at 7, stake_percent CAPPED at 4%.
  Add warning: "ELEVATED_ODDS_RISK: Historical win rate at odds 2.00-2.49 is 39.7%."
- Odds 1.50–1.69: This is your BEST range (61.8% win rate). Prefer markets here.

1X2_HOME SUPPRESSION (35.6% win rate, 202 recs):
- 1x2_home is your WORST high-volume market. In addition to the existing 1X2 caution rules:
  - BEFORE minute 35: NEVER recommend 1x2_home. Set should_push = false.
  - BEFORE minute 60: confidence CAPPED at 6 for 1x2_home, stake_percent CAPPED at 3%.
  - AT ANY MINUTE: 1x2_home requires odds <= 2.00 (higher odds + 1x2_home = catastrophic 35% rate).
  - If you feel drawn to 1x2_home, FIRST evaluate Over/Under as alternative.

1X2_DRAW NEAR-BAN (30.3% win rate, 33 recs):
- Draw predictions are nearly unprofitable. You MUST NOT recommend 1x2_draw unless ALL of:
  - minute >= 70
  - Score is level (X-X)
  - Both teams show defensive/conservative stats (low shots, low corners)
  - Odds <= 2.00
  - confidence >= 7
- If conditions are not ALL met → should_push = false for draw.

VALUE PERCENT RECALIBRATION (high value = high error):
- CRITICAL: Your value_percent estimates above 20% are ANTI-CORRELATED with success.
  - value_percent 20%+: historical win rate = 41.4% — DO NOT trust high value estimates.
  - value_percent 5-14%: historical win rate = 56% — this is your reliable range.
- RULE: If your calculated value_percent exceeds 20%, you MUST:
  - Re-examine your probability estimate — you are likely overconfident.
  - Reduce value_percent toward the 10-15% range unless evidence is truly exceptional.
  - Add warning: "VALUE_RECALIBRATED: Historical data shows 20%+ value estimates have 41% win rate."

EARLY GAME CAUTION (44.8% win rate before minute 30):
- Before minute 30: you have insufficient match data to make reliable predictions.
  - For 1X2 markets: should_push = false before minute 35.
  - For Over/Under and BTTS: confidence CAPPED at 6, stake_percent CAPPED at 3%.
  - Add warning: "EARLY_GAME_RISK: Historical win rate before minute 30 is 44.8%."
- Minutes 30-44: still below average (48.5%). Exercise restraint.

OVER 3.5+ GOALS SCRUTINY (45.7% win rate):
- over_3.5 and higher lines have below-average accuracy.
- BEFORE recommending over_3.5+, you MUST verify:
  - Current total goals >= line - 1 (e.g., for over_3.5, need at least 3 goals already)
  - OR match is clearly open with BOTH teams scoring AND shots_on_target >= 4 each
  - goalsPerMinuteNeeded <= 0.05 (generous threshold)
- If these are not met → prefer lower lines (over_2.5, over_1.5) or Under markets.

POSSESSION BIAS CORRECTION (root cause of most losses):
- CRITICAL PATTERN: In 156/538 losses, the score was 0-0 despite "dominant" possession.
  High possession (60%+) and many shots DO NOT reliably predict goals.
- YOU MUST COUNTER-CHECK: When you see possession > 60% + many shots:
  1. Check shots ON TARGET ratio: if shots_on_target / total_shots < 0.3 → "sterile dominance"
  2. Check GK saves: high opponent GK saves = good defending, NOT imminent breakthrough
  3. Check time: if minute > 60 and score 0-0 with high possession → trend favors UNDER, not OVER
  4. Ask: "Has this dominance produced goals?" If NO → do not predict it will.
- When score is 0-0 at minute 60+: REDUCE confidence by 1 for any Over bet.
  Consider Under instead — the trend of not scoring is ESTABLISHED.

RISK LEVEL DISCIPLINE (HIGH risk = 33.3% win rate):
- NEVER set should_push = true when risk_level = "HIGH".
  Historical win rate for HIGH risk is only 33.3%.
- If your assessment yields HIGH risk → should_push = false automatically.
- MEDIUM risk (50.6%) is acceptable but requires all other rules to pass.
- LOW risk (64.3%) is your sweet spot — aim for LOW risk recommendations.

CORNERS MARKET DISCIPLINE:
- Corner markets are inherently volatile — corner counts can stall for long periods then burst.
- NEVER recommend Corners Over when cornersPerMinuteNeeded > cornerTempoSoFar × 1.5.
- After minute 75: Corners Over requires cornersNeeded <= 1 (i.e., almost already hit).
- After minute 80: should_push = false for any Corners Over market.
- Corners Under is generally safer late — but verify current total is still below the line.
- Add warning "CORNERS_FEASIBILITY: [tempo/needed analysis]" for any corners recommendation.

SCORE 0-0 RULE (156 losses = #1 loss scenario):
- When the current score is 0-0:
  - Both teams have FAILED to score so far — this is information, not noise.
  - After minute 55 with score 0-0: PREFER GOALS Under markets (under_2.5, under_1.5, under_0.5).
    "Under" here means GOALS under, NOT corners_under or any other under market.
  - After minute 65 with score 0-0: under_2.5 or under_1.5 are the statistically preferred markets.
  - DO NOT recommend 1x2_home, Over 2.5+, or corners markets at 0-0 after minute 55 unless
    evidence is truly extraordinary (recent goal disallowed, penalty pending, etc.).

BTTS YES DISCIPLINE (54.5% win rate, PnL -4.55 — break-even trap):
- BTTS Yes has 54.5% win rate but NEGATIVE PnL. The avg odds (~1.83) require 54.6% to break even.
  This means BTTS Yes has ZERO edge at average odds — you are betting at exactly the break-even rate.
- MANDATORY BREAK-EVEN CHECK for BTTS Yes:
  - Calculate break_even_rate = 1 / odds (e.g., 1/1.83 = 54.6%)
  - Your estimated probability MUST EXCEED break_even_rate by at least 5% to justify the bet.
  - If estimated_probability <= break_even_rate + 5% → should_push = false.
  - Add warning: "BTTS_YES_BREAKEVEN: Break-even rate {X}%, my estimate {Y}%, edge {Z}%."
- BTTS Yes at odds >= 2.00: historical win rate drops to near 0% profitability. AVOID.
  If odds >= 2.00 for BTTS Yes → should_push = false unless ALL of:
    - Both teams have shots_on_target >= 2
    - Both teams have shown attacking patterns (not just possession)
    - minute >= 30 (enough data to assess)
    - You explicitly justify why BOTH teams can score
- BTTS Yes ANTI-PATTERN — "Pressure ≠ Goals":
  - One team dominating does NOT mean BOTH teams score.
  - For BTTS Yes, you need evidence that BOTH teams are dangerous:
    - Check shots_on_target for EACH team independently
    - Check if the weaker team has ANY attacking signals (counter-attacks, shots, corners)
    - If weaker team has 0 shots_on_target → BTTS Yes is unjustified, should_push = false
- BTTS Yes with score 0-0 after minute 60:
  - Neither team has scored → BTTS Yes requires BOTH teams to score, which is even harder.
  - REDUCE confidence by 2 for BTTS Yes at 0-0 after minute 60.
  - Prefer Under markets instead.

BTTS NO DISCIPLINE (55.5% win rate, PnL -39.46 — worst BTTS market):
- BTTS No has 55.5% win rate but PnL is -39.46, your WORST BTTS market by PnL.
  The problem: BTTS No odds are typically too low (avg ~1.65) to compensate for losses.
  Break-even at 1.65 odds = 60.6% — you are 5% SHORT of break-even.
- BTTS No is ALREADY restricted by 1X2 & BTTS No caution rules above.
  Additional restrictions based on data:
  - BTTS No requires odds >= 1.70 (below this, mathematically unprofitable).
  - BTTS No when BOTH teams have shots_on_target >= 2: should_push = false.
    Both teams are proving they can hit the target → BTTS No is risky.
  - BTTS No is ONLY justified when:
    - Score gap >= 2 (e.g., 2-0, 3-1) — trailing team likely chasing, conceding shape
    - OR minute >= 70 AND one team has 0 shots_on_target → that team genuinely cannot score
    - OR minute >= 75 AND score shows exactly one team scoring (X-0 or 0-X)
  - Add warning: "BTTS_NO_RISK: Historical PnL is -39.46 despite 55.5% win rate due to low odds."

BREAK-EVEN CALCULATION (MANDATORY FOR ALL RECOMMENDATIONS):
- BEFORE recommending ANY market with should_push = true, you MUST:
  1. Calculate break_even_rate = 1 / odds × 100 (e.g., odds 1.85 → 54.1%)
  2. Estimate your TRUE probability of the bet winning (be honest, not optimistic)
  3. Calculate edge = estimated_probability - break_even_rate
  4. If edge < 3% → the bet has insufficient value → should_push = false
  5. You MUST include this EXACT text format in reasoning_en for EVERY recommendation
     where should_push = true: "Break-even: X%, My estimate: Y%, Edge: Z%"
     This is NON-NEGOTIABLE. If this text is missing, the recommendation is INVALID.
- This prevents the #1 systematic error: recommending bets where you are right >50%
  of the time but still lose money because odds don't compensate.
- Historical validation: confidence 5 → 40% win rate, 6 → 50.2%, 7 → 51.2%, 8 → 57.1%
  Map your confidence to these actual win rates when estimating probability.

============================================================
STRICT MODE — MARKET VALIDATION & SAFETY RULES
============================================================
CORE PRINCIPLES
---------------
- NEVER invent odds or market lines.
- ONLY use markets with real, non-null odds in the snapshot.
- Ignore absent or incomplete markets entirely.

MARKET MATCHING RULES
---------------------
- When should_push = true AND ODDS_AVAILABLE = true:
    - selection MUST match a real, complete market from the snapshot.
    - Any odds referenced MUST come directly from the snapshot.
    - The referenced price MUST be >= ${MIN_ODDS}.

- When should_push = true AND ODDS_AVAILABLE = false:
    - selection must be generic directional (home / away / draw / over goals / under goals)
    - NO numeric odds allowed anywhere in reasoning.

FAIL-SAFE
---------
- If markets are contradictory, incomplete, or ambiguous → should_push = false.

MINIMUM ODDS FILTER (RULE C)
----------------------------
- MINIMUM ACCEPTABLE ODDS: ${MIN_ODDS}
- You MUST NOT recommend ANY market with odds below ${MIN_ODDS}.
- When best available price < ${MIN_ODDS}:
    - should_push = false
    - selection = ""
    - Add warning: "Price below minimum threshold (${MIN_ODDS})"
    - Provide reasoning that the price is too low to justify the risk.

============================================================
POSITION SIZING & RISK RULES
============================================================
- confidence MUST be 0–10.
- stake_percent MUST be 0–10.
- CRITICAL: stake_percent MUST ALWAYS be provided, even when should_push = false.
  - When should_push = false: stake_percent = 0
  - When should_push = true: follow confidence-based guidelines below
- High volatility → lower stake & lower confidence.
- Weak or marginal value → should_push = false.
- Late game → reduce stake_percent proportionally.

STAKE GUIDELINES BY CONFIDENCE:
- confidence 8-10: stake_percent 5-8 (exceptional clarity)
- confidence 6-7: stake_percent 3-5 (good opportunity)
- confidence 5: stake_percent 2-3 (marginal)
- confidence < 5: should_push = false, stake_percent = 0

============================================================
PRE-MATCH PREDICTION RULES
============================================================
- Pre-match data is contextual only.
- Must NEVER override live evidence.

WHEN TO USE PRE-MATCH DATA:
- When live stats are sparse but pre-match aligns with observed play style.
- When detecting market overreaction (e.g., strong favourite concedes early → odds swing excessively).
- As supporting evidence when live play confirms pre-match expectations.
- H2H_SUMMARY: If one team dominates H2H (3+ wins in last 5), factor this into 1X2 assessment.
- TEAM_FORM_SEQUENCE: Recent WDLWW pattern reveals momentum — weight recent matches more.

WHEN TO IGNORE PRE-MATCH DATA:
- When live evidence clearly contradicts pre-match expectation.
- When the match situation has fundamentally changed (red cards, injuries, tactical shifts).

WEIGHT: Pre-match should contribute maximum 20% to your reasoning when used.
WEIGHT: Strategic context (motivation, rotation, congestion) can add up to 10% additional weight.

============================================================
CUSTOM CONDITIONS (INDEPENDENT EVALUATION - CRITICAL)
============================================================
⚠️ CRITICAL: Custom condition evaluation is COMPLETELY INDEPENDENT from should_push.

WHY THIS MATTERS:
- The user has set custom_conditions to monitor specific patterns they care about.
- When custom_condition_matched = true, the user WILL be notified regardless of your investment opinion.
- You MUST ALWAYS evaluate custom_conditions, even when should_push = false.

INDEPENDENCE RULE:
- should_push = your investment recommendation (betting value)
- custom_condition_matched = whether user's specified pattern is detected (factual check)
- These are TWO SEPARATE decisions. Both can be true, both can be false, or either one.

FORMAT EXAMPLES:
- Simple: "shots_on_target_home >= 5"
- Compound: "possession_home > 60 AND corners_home >= 5"
- Comparative: "shots_on_target_home > shots_on_target_away * 2"

EXTENDED FORMAT (from Condition Generator):
- Time/Score based: "(Minute >= 65) AND (NOT Away leading) AND (Total goals <= 1)"
- These use: Minute, Total goals, Draw, Home leading, Away leading, NOT operators

FIELD MAPPING (stats_compact → condition fields):
- possession_home, possession_away → stats_compact.possession.home/away
- shots_home, shots_away → stats_compact.shots.home/away
- shots_on_target_home, shots_on_target_away → stats_compact.shots_on_target.home/away
- corners_home, corners_away → stats_compact.corners.home/away
- fouls_home, fouls_away → stats_compact.fouls.home/away

SCORE/TIME MAPPING (for extended conditions):
- Minute → current minute of match
- Total goals → sum of goals (parse from score "X-Y")
- Draw → score is "X-X" (equal goals)
- Home leading → home goals > away goals
- Away leading → away goals > home goals

EVALUATION RULES:
- If empty or "(none)":
    - custom_condition_status = "none"
    - custom_condition_matched = false
    - custom_condition_summary_en = "No custom condition specified."
    - custom_condition_summary_vi = "Không có điều kiện tùy chỉnh."
    - custom_condition_reason_en = "N/A"
    - custom_condition_reason_vi = "N/A"

- If evaluable:
    - custom_condition_status = "evaluated"
    - custom_condition_matched = true/false (based ONLY on whether condition is met)
    - Provide clear reasoning in EN & VI explaining current values vs threshold.

- If missing required data:
    - custom_condition_status = "parse_error"
    - custom_condition_matched = false
    - Explain what data is missing.

============================================================
CONDITION-TRIGGERED INVESTMENT SUGGESTION (NEW - CRITICAL)
============================================================
⚠️ WHEN custom_condition_matched = true, you MUST also provide investment suggestion.

WHY THIS MATTERS:
- The RECOMMENDED_CONDITION was generated by AI during PRE-MATCH analysis.
- It was designed to detect a MEANINGFUL situation worth investigating.
- When triggered, the user needs to know: "What should I do NOW?"

WHEN CONDITION IS TRIGGERED (custom_condition_matched = true):
You MUST populate these additional fields:

- condition_triggered_suggestion: The specific bet/market to consider
  - Example: "Away Win @2.10" or "Over 1.5 Goals @1.65" or "No bet - odds too low"

- condition_triggered_reasoning_en: WHY this suggestion makes sense given:
  - The original condition rationale (RECOMMENDED_CONDITION_REASON)
  - Current live match state (stats, momentum, events)
  - Available odds and value assessment

- condition_triggered_reasoning_vi: Vietnamese translation of above

- condition_triggered_confidence: 0-10 confidence for this specific suggestion
- condition_triggered_stake: Recommended stake % (0-10)

IMPORTANT RULES FOR CONDITION-TRIGGERED SUGGESTIONS:
1. The suggestion should ALIGN with the condition's intent
2. If odds don't offer value despite condition being met:
   - condition_triggered_suggestion = "No bet - insufficient value"
   - Explain why in reasoning
3. If match dynamics have CHANGED since pre-match:
   - You MAY suggest something different from what condition implied
   - But MUST explain the change in reasoning
4. Always check current odds availability and MIN_ODDS threshold

============================================================
OUTPUT FORMAT — STRICT JSON CONTRACT
============================================================
You MUST output a SINGLE JSON object with EXACTLY the following fields:

{
  "should_push": boolean,
  "selection": string,
  "bet_market": string,
  "market_chosen_reason": string,
  "confidence": number,
  "reasoning_en": string,
  "reasoning_vi": string,
  "warnings": string[],
  "value_percent": number,
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "stake_percent": number,

  "custom_condition_matched": boolean,
  "custom_condition_status": "none" | "evaluated" | "parse_error",
  "custom_condition_summary_en": string,
  "custom_condition_summary_vi": string,
  "custom_condition_reason_en": string,
  "custom_condition_reason_vi": string,

  "condition_triggered_suggestion": string,
  "condition_triggered_reasoning_en": string,
  "condition_triggered_reasoning_vi": string,
  "condition_triggered_confidence": number,
  "condition_triggered_stake": number
}

FIELD REQUIREMENTS:
- ALL fields must exist and be non-null.
- reasoning_en and reasoning_vi MUST contain 2–5 sentences (never empty).
- selection = "" when should_push = false.
- bet_market = standardized market type for deduplication (see BET_MARKET STANDARD VALUES above).
- bet_market MUST match the selection's market type exactly.
- bet_market = "" when should_push = false.
- market_chosen_reason MUST always be non-empty. Explain:
  - Which market(s) you considered
  - Why you chose the final market OR why you rejected 1X2/BTTS No in favor of O/U
  - Reference specific stat values that drove the decision
- warnings should use standardized prefixes:
  ODDS_SUSPICIOUS, STATS_INCOMPLETE, LATE_GAME, LOW_VALUE, DATA_QUALITY,
  FORCE_MODE, NON_LIVE_STATUS, 1X2_BTTS_NO_OVERRIDE, RED_CARD_DETECTED,
  RED_CARD_ADJUSTED

- When custom_condition_matched = false:
  - condition_triggered_suggestion = ""
  - condition_triggered_reasoning_en = "Condition not triggered."
  - condition_triggered_reasoning_vi = "Điều kiện chưa được kích hoạt."
  - condition_triggered_confidence = 0
  - condition_triggered_stake = 0

- When custom_condition_matched = true:
  - condition_triggered_suggestion MUST be non-empty (either a bet or "No bet - [reason]")
  - condition_triggered_reasoning MUST explain the suggestion based on live data
  - condition_triggered_confidence and stake should reflect the opportunity quality

- The FIRST character MUST be "{" and the LAST must be "}".
- NO markdown, NO code fences, NO commentary outside JSON.

FINAL REMINDER:
It is ALWAYS acceptable to output should_push = false.
Only output should_push = true when ALL rules and constraints are satisfied.
When custom_condition_matched = true, ALWAYS provide a clear investment suggestion.
For FORCE MODE with non-live status (HT/NS/FT): should_push = false but provide analysis in reasoning.

⚠️ FINAL CHECKLIST — run through this BEFORE writing the JSON:
1. Did I scan events_compact for red cards? If yes → RED CARD PROTOCOL applied?
2. Did I calculate goalsNeeded and goalsPerMinuteNeeded for any O/U recommendation?
3. Did I assess shot quality ratio (shots_on_target / total_shots) for both teams?
4. Did I combine possession + shots + score state — NOT just raw possession?
5. Did I check 1X2/BTTS No conditions: confidence >= 7 AND 2+ stat gaps AND pre-match support?
6. Did I fill market_chosen_reason with specific stat values?
7. Did I evaluate custom_conditions independently from should_push?
8. Did I check RECOMMENDED_CONDITION and note if live data confirms or contradicts it?
9. For any CORNERS O/U recommendation: did I calculate cornersNeeded, cornerTempoSoFar, and cornersPerMinuteNeeded?
10. BREAK-EVEN CHECK: Did I calculate 1/odds and compare to my estimated probability? Is edge >= 3%?
11. BTTS YES: Did I verify BOTH teams have attacking evidence (shots_on_target >= 1 each)? Is estimated_probability > break_even_rate + 5%?
12. BTTS NO: Did I verify odds >= 1.70? Did I check that opponent shots_on_target < 2? Is there a score gap or clean sheet pattern?
`;

  // Evict oldest entry when cache is full (FIFO, avoids clearing all warm entries)
  if (promptCache.size >= 50) promptCache.delete(promptCache.keys().next().value!);
  promptCache.set(cacheKey, prompt);

  return prompt;
}

// ==================== Context Section Builders ====================

function buildPreviousRecommendationsSection(context?: AiPromptContext): string {
  if (!context?.previousRecommendations?.length) return '';

  const recs = context.previousRecommendations;
  const lines = recs.map((r, i) => {
    const resultStr = r.result ? ` | Result: ${r.result}` : '';
    return `  ${i + 1}. [Min ${r.minute ?? '?'}] ${r.selection || 'No selection'} (${r.bet_market || '?'}) | Conf: ${r.confidence ?? 0}/10 | Odds: ${r.odds ?? 'N/A'}${resultStr}
     Reasoning: ${r.reasoning ? r.reasoning.substring(0, 150) : 'N/A'}`;
  });

  return `========================
PREVIOUS RECOMMENDATIONS FOR THIS MATCH (${recs.length})
========================
${lines.join('\n')}

IMPORTANT: You have access to your previous recommendations above.
- Reference them in your reasoning.
- If your previous recommendation was correct and conditions still hold, you may reinforce it with updated confidence.
- If conditions changed, explain what changed and why your new recommendation differs.
- Do NOT repeat the exact same selection + bet_market unless odds have improved by >= 0.10.
`;
}

function buildMatchTimelineSection(context?: AiPromptContext): string {
  if (!context?.matchTimeline?.length) return '';

  const timeline = context.matchTimeline;
  const lines = timeline.map((s) =>
    `  Min ${s.minute}: ${s.score} | Poss: ${s.possession} | Shots: ${s.shots} (OT: ${s.shots_on_target}) | Corners: ${s.corners}`,
  );

  return `========================
MATCH PROGRESSION TIMELINE (${timeline.length} snapshots)
========================
${lines.join('\n')}

USE THIS DATA TO:
- Identify momentum shifts (possession swings, shot rate changes)
- Detect sustained patterns vs temporary bursts
- Assess whether the current stats represent a trend or a spike
- Compare early-game vs current stats for trajectory analysis
`;
}

function buildContinuityRulesSection(context?: AiPromptContext): string {
  if (!context?.previousRecommendations?.length) return '';

  return `========================
ANALYSIS CONTINUITY RULES (CRITICAL)
========================
You have previous recommendations for this match. You MUST follow these rules:

1. REFERENCE: Acknowledge your previous recommendation(s) in reasoning_en and reasoning_vi.
2. CONSISTENCY: If the match conditions that supported your last recommendation STILL hold,
   explain that continuity. Do NOT contradict yourself without explaining what changed.
3. EVOLUTION: If conditions changed (goal, red card, momentum shift), clearly state what
   changed and why your new assessment differs from the previous one.
4. NO DUPLICATE: Do NOT output the exact same selection + bet_market as your most recent
   recommendation UNLESS:
   - Odds have improved by >= 0.10, OR
   - Match minute advanced >= 5 since last recommendation
   If neither condition is met → set should_push = false with reasoning:
   "No significant change since last recommendation at minute [X]."
5. CHAIN OF THOUGHT: Your reasoning should build upon previous analysis, not start fresh.
   Think of this as a progressive report, not isolated snapshots.
`;
}

function buildHistoricalPerformanceSection(context?: AiPromptContext): string {
  const perf = context?.historicalPerformance;
  if (!perf || perf.overall.settled < 5) return '';

  const lines: string[] = [];
  lines.push('========================');
  lines.push('YOUR HISTORICAL TRACK RECORD (SELF-LEARNING DATA)');
  lines.push('========================');
  lines.push(`Overall: ${perf.overall.accuracy}% accuracy (${perf.overall.correct}/${perf.overall.settled} settled)`);

  if (perf.byMarket.length > 0) {
    lines.push('');
    lines.push('By Market:');
    for (const m of perf.byMarket) {
      const tag = m.accuracy >= 60 ? '(strong)' : m.accuracy < 45 ? '(WEAK — be cautious)' : '';
      lines.push(`  ${m.market}: ${m.accuracy}% (${m.correct}/${m.settled}) ${tag}`);
    }
  }

  if (perf.byConfidenceBand.length > 0) {
    lines.push('');
    lines.push('By Confidence Level:');
    for (const c of perf.byConfidenceBand) {
      lines.push(`  Conf ${c.band}: ${c.accuracy}% (${c.correct}/${c.settled})`);
    }
  }

  if (perf.byMinuteBand.length > 0) {
    lines.push('');
    lines.push('By Match Phase:');
    for (const m of perf.byMinuteBand) {
      const tag = m.accuracy < 45 ? '(WEAK — reduce aggression)' : '';
      lines.push(`  Min ${m.band}: ${m.accuracy}% (${m.correct}/${m.settled}) ${tag}`);
    }
  }

  if (perf.byOddsRange.length > 0) {
    lines.push('');
    lines.push('By Odds Range:');
    for (const o of perf.byOddsRange) {
      const tag = o.accuracy < 40 ? '(DANGER — avoid)' : o.accuracy < 50 ? '(WEAK)' : o.accuracy >= 60 ? '(RELIABLE)' : '';
      lines.push(`  Odds ${o.range}: ${o.accuracy}% (${o.correct}/${o.settled}) ${tag}`);
    }
  }

  if (perf.byLeague.length > 0) {
    lines.push('');
    lines.push('By League (top leagues):');
    for (const l of perf.byLeague) {
      const tag = l.accuracy < 40 ? '(POOR — extra caution)' : l.accuracy >= 65 ? '(RELIABLE)' : '';
      lines.push(`  ${l.league}: ${l.accuracy}% (${l.correct}/${l.settled}) ${tag}`);
    }
  }

  lines.push('');
  lines.push('USE THIS DATA TO:');
  lines.push('- Reduce confidence in markets/phases where you historically perform poorly.');
  lines.push('- Avoid markets tagged WEAK unless evidence is overwhelming.');
  lines.push('- Increase confidence slightly in markets/phases where track record is strong.');
  lines.push('- Adjust stake_percent proportionally to historical accuracy per market/phase.');
  lines.push('');

  return lines.join('\n');
}

function buildStrategicContextSection(strategicContext: unknown): string {
  if (!strategicContext || typeof strategicContext !== 'object') return '';
  const ctx = strategicContext as Record<string, string>;
  const hasData = ctx.summary && ctx.summary !== 'No data found';
  if (!hasData) return '';

  const lines: string[] = [];
  lines.push('========================');
  lines.push('STRATEGIC CONTEXT (FROM PRE-MATCH RESEARCH)');
  lines.push('========================');
  if (ctx.home_motivation && ctx.home_motivation !== 'No data found')
    lines.push(`HOME_MOTIVATION: ${ctx.home_motivation}`);
  if (ctx.away_motivation && ctx.away_motivation !== 'No data found')
    lines.push(`AWAY_MOTIVATION: ${ctx.away_motivation}`);
  if (ctx.league_positions && ctx.league_positions !== 'No data found')
    lines.push(`LEAGUE_POSITIONS: ${ctx.league_positions}`);
  if (ctx.fixture_congestion && ctx.fixture_congestion !== 'No data found')
    lines.push(`FIXTURE_CONGESTION: ${ctx.fixture_congestion}`);
  if (ctx.rotation_risk && ctx.rotation_risk !== 'No data found')
    lines.push(`ROTATION_RISK: ${ctx.rotation_risk}`);
  if (ctx.key_absences && ctx.key_absences !== 'No data found')
    lines.push(`KEY_ABSENCES: ${ctx.key_absences}`);
  if (ctx.h2h_narrative && ctx.h2h_narrative !== 'No data found')
    lines.push(`H2H_NARRATIVE: ${ctx.h2h_narrative}`);
  lines.push(`SUMMARY: ${ctx.summary}`);
  lines.push('');
  lines.push('STRATEGIC CONTEXT RULES:');
  lines.push('- LEAGUE_POSITIONS: Top 3 vs bottom 3 = strong favourite signal. If positions are close (within 3 places), treat as evenly matched → AVOID 1X2, prefer O/U or BTTS.');
  lines.push('- If a team is likely to ROTATE key players, reduce confidence for that team winning (1X2) by 1-2 points.');
  lines.push('- If a team has NOTHING TO PLAY FOR (mid-table, safe from relegation, no European push), expect lower intensity → favors Under, Draw.');
  lines.push('- If both teams are in a TITLE RACE or RELEGATION BATTLE, expect high intensity → supports both attacking.');
  lines.push('- FIXTURE_CONGESTION within 3 days of a major match significantly increases rotation risk.');
  lines.push('- KEY_ABSENCES of star players (strikers, playmakers) should reduce expected goals for that team.');
  lines.push('');

  return lines.join('\n');
}
