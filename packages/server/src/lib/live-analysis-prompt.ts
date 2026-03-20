export type PromptStatsSource = 'api-football' | 'live-score-api-fallback' | string;
export type PromptEvidenceMode =
  | 'full_live_data'
  | 'stats_only'
  | 'odds_events_only_degraded'
  | 'events_only_degraded'
  | 'low_evidence';

interface TwoSideValue {
  home: string | number | null | undefined;
  away: string | number | null | undefined;
}

export interface LiveAnalysisPromptSettings {
  minConfidence: number;
  minOdds: number;
  latePhaseMinute: number;
  veryLatePhaseMinute: number;
  endgameMinute: number;
}

export interface LiveAnalysisPromptPreviousRecommendation {
  minute?: number | null;
  selection?: string | null;
  bet_market?: string | null;
  confidence?: number | null;
  odds?: number | null;
  reasoning?: string | null;
  result?: string | null;
}

export interface LiveAnalysisMatchTimelineSnapshot {
  minute: number;
  score: string;
  possession: string;
  shots: string;
  shots_on_target: string;
  corners: string;
  fouls: string;
  yellow_cards: string;
  red_cards: string;
  goalkeeper_saves: string;
  status: string;
}

export interface LiveAnalysisHistoricalPerformance {
  overall: { settled: number; correct: number; accuracy: number };
  byMarket: Array<{ market: string; settled: number; correct: number; accuracy: number }>;
  byConfidenceBand: Array<{ band: string; settled: number; correct: number; accuracy: number }>;
  byMinuteBand: Array<{ band: string; settled: number; correct: number; accuracy: number }>;
  byOddsRange: Array<{ range: string; settled: number; correct: number; accuracy: number }>;
  byLeague: Array<{ league: string; settled: number; correct: number; accuracy: number }>;
}

export interface LiveAnalysisPromptInput {
  homeName: string;
  awayName: string;
  league: string;
  minute: number;
  score: string;
  status: string;
  statsCompact: {
    possession: TwoSideValue;
    shots: TwoSideValue;
    shots_on_target: TwoSideValue;
    corners: TwoSideValue;
    fouls: TwoSideValue;
    offsides?: TwoSideValue;
    yellow_cards?: TwoSideValue;
    red_cards?: TwoSideValue;
    goalkeeper_saves?: TwoSideValue;
    blocked_shots?: TwoSideValue;
    total_passes?: TwoSideValue;
    passes_accurate?: TwoSideValue;
  };
  statsAvailable: boolean;
  statsSource: PromptStatsSource;
  evidenceMode: PromptEvidenceMode;
  statsMeta?: Record<string, unknown> | null;
  eventsCompact: Array<{
    minute: number;
    extra?: number | null;
    team: string;
    type: string;
    detail: string;
    player?: string;
  }>;
  oddsCanonical: Record<string, unknown>;
  oddsAvailable: boolean;
  oddsSource: string;
  oddsFetchedAt: string | null;
  oddsSanityWarnings?: string[];
  oddsSuspicious?: boolean;
  derivedInsights: Record<string, unknown> | null;
  customConditions: string;
  recommendedCondition: string;
  recommendedConditionReason: string;
  strategicContext: Record<string, string> | null;
  forceAnalyze: boolean;
  isManualPush?: boolean;
  skippedFilters?: string[];
  originalWouldProceed?: boolean;
  prediction: Record<string, unknown> | null;
  currentTotalGoals: number;
  previousRecommendations?: LiveAnalysisPromptPreviousRecommendation[];
  matchTimeline?: LiveAnalysisMatchTimelineSnapshot[];
  historicalPerformance?: LiveAnalysisHistoricalPerformance | null;
  preMatchPredictionSummary: string;
  mode: string;
  statsFallbackReason: string;
}

function buildForceAnalyzeContext(data: LiveAnalysisPromptInput): string {
  if (!data.forceAnalyze) return '';
  const skippedFilters = Array.isArray(data.skippedFilters) ? data.skippedFilters : [];
  const originalWouldProceed = data.originalWouldProceed !== false;
  return `
============================================================
FORCE ANALYZE MODE - SPECIAL INSTRUCTIONS
============================================================
This analysis was triggered by MANUAL USER REQUEST with force=true.
The user explicitly wants analysis even though normal filters would skip this match.

BYPASSED FILTERS:
${skippedFilters.length > 0 ? skippedFilters.map((f) => `- ${f}`).join('\n') : '- None (match passed all filters)'}

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

function buildPreviousRecommendationsSection(data: LiveAnalysisPromptInput): string {
  const recs = Array.isArray(data.previousRecommendations) ? data.previousRecommendations : [];
  if (recs.length === 0) return '';

  const lines = recs.map((r, i) => {
    const resultStr = r.result ? ` | Result: ${r.result}` : '';
    const reasoning = r.reasoning ? `\n     Reasoning: ${String(r.reasoning).substring(0, 150)}` : '';
    return `  ${i + 1}. [Min ${r.minute ?? '?'}] ${r.selection || 'No selection'} (${r.bet_market || '?'}) | Conf: ${r.confidence ?? 0}/10 | Odds: ${r.odds ?? 'N/A'}${resultStr}${reasoning}`;
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

function buildMatchTimelineSection(data: LiveAnalysisPromptInput): string {
  const timeline = Array.isArray(data.matchTimeline) ? data.matchTimeline : [];
  if (timeline.length === 0) return '';

  const lines = timeline.map((s) =>
    `  Min ${s.minute}: ${s.score} | Poss: ${s.possession} | Shots: ${s.shots} (OT: ${s.shots_on_target}) | Corners: ${s.corners} | Fouls: ${s.fouls} | Cards: ${s.yellow_cards}Y ${s.red_cards}R | GKSaves: ${s.goalkeeper_saves}`,
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
- Fouls + cards indicate match intensity and discipline risks
- GK saves ratio vs shots on target shows shooting quality
`;
}

function buildContinuityRulesSection(data: LiveAnalysisPromptInput): string {
  const recs = Array.isArray(data.previousRecommendations) ? data.previousRecommendations : [];
  if (recs.length === 0) return '';

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
   If neither condition is met -> set should_push = false with reasoning:
   "No significant change since last recommendation at minute [X]."
5. CHAIN OF THOUGHT: Your reasoning should build upon previous analysis, not start fresh.
   Think of this as a progressive report, not isolated snapshots.
`;
}

function buildHistoricalPerformanceSection(data: LiveAnalysisPromptInput): string {
  const perf = data.historicalPerformance;
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
      const tag = m.accuracy >= 60 ? '(strong)' : m.accuracy < 45 ? '(WEAK - be cautious)' : '';
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
      const tag = m.accuracy < 45 ? '(WEAK - reduce aggression)' : '';
      lines.push(`  Min ${m.band}: ${m.accuracy}% (${m.correct}/${m.settled}) ${tag}`);
    }
  }

  if (perf.byOddsRange.length > 0) {
    lines.push('');
    lines.push('By Odds Range:');
    for (const o of perf.byOddsRange) {
      const tag = o.accuracy < 40 ? '(DANGER - avoid)' : o.accuracy < 50 ? '(WEAK)' : o.accuracy >= 60 ? '(RELIABLE)' : '';
      lines.push(`  Odds ${o.range}: ${o.accuracy}% (${o.correct}/${o.settled}) ${tag}`);
    }
  }

  if (perf.byLeague.length > 0) {
    lines.push('');
    lines.push('By League (top leagues):');
    for (const l of perf.byLeague) {
      const tag = l.accuracy < 40 ? '(POOR - extra caution)' : l.accuracy >= 65 ? '(RELIABLE)' : '';
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

function buildStrategicContextSection(strategicContext: Record<string, string> | null): string {
  if (!strategicContext || typeof strategicContext !== 'object') return '';
  const ctx = strategicContext;
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
  if (ctx.competition_type && ctx.competition_type !== 'No data found')
    lines.push(`COMPETITION_TYPE: ${ctx.competition_type}`);
  lines.push(`SUMMARY: ${ctx.summary}`);
  lines.push('');
  lines.push('STRATEGIC CONTEXT RULES:');
  lines.push('- COMPETITION_TYPE: For european/international/friendly competitions, teams are from DIFFERENT domestic leagues. LEAGUE_POSITIONS CANNOT be compared across leagues - IGNORE position gap signals.');
  lines.push('- LEAGUE_POSITIONS: ONLY for domestic_league matches: Top 3 vs bottom 3 = strong favourite signal. Within 3 places = evenly matched -> AVOID 1X2, prefer O/U or BTTS.');
  lines.push('- ROTATION: If team likely rotates key players, reduce confidence for that team winning by 1-2.');
  lines.push('- NOTHING TO PLAY FOR: Expect lower intensity -> favors Under, Draw.');
  lines.push('- TITLE RACE / RELEGATION BATTLE: Expect high intensity -> supports attacking.');
  lines.push('- FIXTURE_CONGESTION within 3 days of major match significantly increases rotation risk.');
  lines.push('- KEY_ABSENCES of star players should reduce expected goals for that team.');
  lines.push('');

  return lines.join('\n');
}

function buildPreMatchPredictionSection(prediction: Record<string, unknown> | null, summary: string): string {
  if (!prediction && !summary) return '';

  const lines: string[] = [];
  lines.push('========================');
  lines.push('PRE-MATCH PREDICTION (OPTIONAL)');
  lines.push('========================');

  if (prediction && typeof prediction === 'object') {
    const pmPred = (prediction as Record<string, Record<string, unknown>>).predictions || {};
    const pmComp = (prediction as Record<string, Record<string, unknown>>).comparison || {};

    const compact: Record<string, unknown> = {
      pre_favourite: (pmPred.winner as Record<string, unknown>)?.name || null,
      pre_win_or_draw: pmPred.win_or_draw ?? null,
      pre_handicap_home: (pmPred.goals as Record<string, unknown>)?.home ?? null,
      pre_handicap_away: (pmPred.goals as Record<string, unknown>)?.away ?? null,
      pre_percent: pmPred.percent || null,
      pre_form: (pmComp.form as Record<string, unknown>) || null,
      pre_total_rating: (pmComp.total as Record<string, unknown>) || null,
    };

    lines.push(JSON.stringify(compact));

    const h2hSummary = prediction.h2h_summary;
    if (h2hSummary) lines.push(`H2H_SUMMARY: ${JSON.stringify(h2hSummary)}`);

    const teamForm = prediction.team_form;
    if (teamForm) lines.push(`TEAM_FORM_SEQUENCE: ${JSON.stringify(teamForm)}`);
  } else {
    lines.push(summary || 'No pre-match prediction available.');
  }

  lines.push('');
  return lines.join('\n');
}

export function buildLiveAnalysisPrompt(
  data: LiveAnalysisPromptInput,
  settings: LiveAnalysisPromptSettings,
): string {
  const MIN_CONFIDENCE = settings.minConfidence;
  const MIN_ODDS = settings.minOdds;
  const LATE_PHASE_MINUTE = settings.latePhaseMinute;
  const VERY_LATE_PHASE_MINUTE = settings.veryLatePhaseMinute;
  const ENDGAME_MINUTE = settings.endgameMinute;

  const cornersHome = parseInt(String(data.statsCompact?.corners?.home ?? ''), 10);
  const cornersAway = parseInt(String(data.statsCompact?.corners?.away ?? ''), 10);
  const currentTotalCorners = !isNaN(cornersHome) && !isNaN(cornersAway)
    ? cornersHome + cornersAway
    : 'unknown';

  const incompleteMarkets: string[] = [];
  const oc = data.oddsCanonical as Record<string, Record<string, unknown>>;
  if (oc['1x2']) {
    if (oc['1x2'].home === null || oc['1x2'].draw === null || oc['1x2'].away === null) incompleteMarkets.push('1x2');
  }
  if (oc['ou']) {
    if (oc['ou'].line === null || oc['ou'].over === null || oc['ou'].under === null) incompleteMarkets.push('ou');
  }
  if (oc['ah']) {
    if (oc['ah'].line === null || oc['ah'].home === null || oc['ah'].away === null) incompleteMarkets.push('ah');
  }
  if (oc['btts']) {
    if (oc['btts'].yes === null || oc['btts'].no === null) incompleteMarkets.push('btts');
  }

  const oddsWarnings = incompleteMarkets.length > 0
    ? `WARNING: Incomplete odds data for markets: ${incompleteMarkets.join(', ')}. Do NOT recommend these markets.`
    : '';

  return `
You are a professional live football investment insight analyst (not a gambler).
Your task is to analyze ONE live match and determine whether there is exactly ONE realistic, high-quality investment idea, or no idea at all. You must also evaluate a user-defined custom condition objectively.
${buildForceAnalyzeContext(data)}
============================================================
DEFINITIONS & THRESHOLDS (READ FIRST)
============================================================
LATE GAME THRESHOLDS:
- Late phase: minute >= ${LATE_PHASE_MINUTE}
- Very late phase: minute >= ${VERY_LATE_PHASE_MINUTE}
- Endgame: minute >= ${ENDGAME_MINUTE}

MINIMUM ACCEPTABLE ODDS: ${MIN_ODDS}
- NEVER recommend any market with price < ${MIN_ODDS}

BET_MARKET STANDARD VALUES:
- 1X2 markets: "1x2_home", "1x2_away", "1x2_draw"
- Over/Under goals: "over_0.5", "over_1.5", "over_2.5", "over_3.5", "over_4.5", "under_0.5", "under_1.5", "under_2.5", "under_3.5", "under_4.5"
- BTTS: "btts_yes", "btts_no"
- Asian Handicap: "asian_handicap_home_[line]", "asian_handicap_away_[line]"
- Corners: "corners_over_[line]", "corners_under_[line]"

SELECTION STANDARD FORMAT:
- 1X2: "Home Win @[odds]", "Away Win @[odds]", "Draw @[odds]"
- Over/Under: "Over [line] Goals @[odds]", "Under [line] Goals @[odds]"
- BTTS: "BTTS Yes @[odds]", "BTTS No @[odds]"
- Asian Handicap: "Home [line] @[odds]", "Away [line] @[odds]"
- Corners: "Corners Over [line] @[odds]", "Corners Under [line] @[odds]"
- FORBIDDEN: Do NOT add team names in selection.

VALUE PERCENT CALCULATION:
- value_percent = estimated edge over market price. Range: -50 to +100.

MARKET RESTRICTIONS (READ BEFORE VIEWING ODDS DATA):
${oddsWarnings ? `- ${oddsWarnings}` : '- No restrictions - all available markets have complete odds data.'}
- Do NOT recommend 1X2 markets before minute 35 (too early, game state can change completely).
- Do NOT recommend any market with price < ${MIN_ODDS}.

${buildStrategicContextSection(data.strategicContext)}
========================
MATCH CONTEXT
========================
- Match: ${data.homeName} vs ${data.awayName}
- League: ${data.league}
- Minute: ${data.minute}
- Score: ${data.score}
- Status: ${data.status}
- Stats Source: ${data.statsSource}
- Evidence Mode: ${data.evidenceMode}
- Force Analyze: ${data.forceAnalyze ? 'YES (watchlist force mode)' : 'NO (auto-pipeline)'}
- Is Manual Push: ${data.isManualPush ? 'YES' : 'NO'}
${data.statsFallbackReason ? `- Stats Fallback Note: ${data.statsFallbackReason}` : ''}

========================
LIVE STATS (COMPACT JSON)
========================
${JSON.stringify(data.statsCompact)}

STATS_AVAILABLE: ${data.statsAvailable}
STATS_SOURCE: ${data.statsSource}
STATS_META: ${JSON.stringify(data.statsMeta || {})}
${!data.statsAvailable && data.derivedInsights ? `
========================
DERIVED INSIGHTS (FROM EVENTS)
========================
${JSON.stringify(data.derivedInsights)}
These insights are DERIVED from match events. Reduce confidence by 1 compared to full stats.
` : ''}
========================
${!data.oddsAvailable ? 'NO USABLE ODDS AVAILABLE' : data.oddsSource === 'pre-match' ? 'PRE-MATCH ODDS (REFERENCE ONLY)' : data.oddsSource === 'the-odds-api' ? 'LIVE ODDS (The Odds API fallback)' : 'LIVE ODDS SNAPSHOT (CANONICAL JSON)'}
========================
${JSON.stringify(data.oddsCanonical)}

ODDS_AVAILABLE: ${data.oddsAvailable}
ODDS_SOURCE: ${data.oddsSource}
ODDS_FETCHED_AT: ${data.oddsFetchedAt ?? 'unknown'} (match minute at fetch: ${data.minute})
CURRENT_TOTAL_GOALS: ${data.currentTotalGoals}
CURRENT_TOTAL_CORNERS: ${currentTotalCorners}
${data.oddsSource === 'pre-match' ? '\nCAUTION: These are PRE-MATCH opening odds fetched before kickoff. Live odds are unavailable for this match.\nYou CAN still use them as a baseline for market direction and value, but adjust confidence based on the current game state.\n' : ''}${data.oddsSource === 'the-odds-api' ? '\nNOTE: These odds are from The Odds API exact-event fallback. They may have slight delay vs Football API live odds.\n' : ''}${!data.oddsAvailable ? '\nNO_USABLE_ODDS: Treat odds as unavailable and be conservative.\n' : ''}${data.oddsSuspicious ? `\nODDS SANITY CHECK FAILED:\n${(data.oddsSanityWarnings || []).map((w) => '- ' + w).join('\n')}\nTreat ALL odds as UNRELIABLE. Behave as if ODDS_AVAILABLE = false.\n` : ''}
ODDS METHODOLOGY:
- Odds are the BEST available across multiple bookmakers (highest price per outcome).
- Markets with invalid implied-probability margins have been PRE-REMOVED by the system.
- If a market is present in the canonical data, it has PASSED margin validation and is RELIABLE.
- Focus your analysis on the markets that ARE present. Do not infer missing markets.

${buildPreMatchPredictionSection(data.prediction, data.preMatchPredictionSummary)}
========================
RECENT EVENTS (LAST 8)
========================
${JSON.stringify(data.eventsCompact)}

EVENT_COUNT: ${data.eventsCompact.length}

${buildPreviousRecommendationsSection(data)}
${buildMatchTimelineSection(data)}
${buildContinuityRulesSection(data)}
${buildHistoricalPerformanceSection(data)}
========================
CONFIG / MODE
========================
- MIN_CONFIDENCE: ${MIN_CONFIDENCE}
- MIN_ODDS: ${MIN_ODDS}
- CUSTOM_CONDITIONS: ${data.customConditions || '(none)'}
- EVIDENCE_MODE: ${data.evidenceMode}

========================
AI-RECOMMENDED CONDITION
========================
RECOMMENDED_CONDITION: ${data.recommendedCondition || '(none)'}
RECOMMENDED_CONDITION_REASON: ${data.recommendedConditionReason || '(none)'}

============================================================
PRE-MATCH PREDICTION RULES
============================================================
- Pre-match data is contextual only.
- Must NEVER override live evidence.

WHEN TO USE PRE-MATCH DATA:
- When live stats are sparse but pre-match aligns with observed play style.
- When detecting market overreaction (e.g., strong favourite concedes early -> odds swing excessively).
- As supporting evidence when live play confirms pre-match expectations.
- H2H_SUMMARY: If one team dominates H2H (3+ wins in last 5), factor this into 1X2 assessment.
- TEAM_FORM_SEQUENCE: Recent WDLWW pattern reveals momentum - weight recent matches more.

WHEN TO IGNORE PRE-MATCH DATA:
- When live evidence clearly contradicts pre-match expectation.
- When the match situation has fundamentally changed (red cards, injuries, tactical shifts).

WEIGHT: Pre-match should contribute maximum 20% to your reasoning when used.
WEIGHT: Strategic context (motivation, rotation, congestion) can add up to 10% additional weight.

============================================================
GLOBAL RULES
============================================================
- Status 1H or 2H = LIVE -> normal analysis.
- Status HT: max confidence 7, max stake 4%.
- Status NS/FT/PST/CANC: should_push = false.

DATA RULES:
- STATS + ODDS available: may recommend if all rules pass.
- STATS only (no odds): should_push = false normally, exception only if extremely clear.
- NO STATS but DERIVED INSIGHTS present: may recommend with confidence cap 7.
- NO STATS and no events: should_push = false normally.

EVIDENCE MODE RULES:
- full_live_data: Normal evaluation path. All supported markets allowed if the rest of the rules pass.
- stats_only: Stats are usable but odds are unavailable. Default should_push=false. Exceptional cases only.
- odds_events_only_degraded: Odds usable, stats unavailable, events available. ONLY evaluate Over/Under or Asian Handicap. DO NOT recommend 1X2. DO NOT recommend BTTS. confidence cap 6. stake cap 3%.
- events_only_degraded: Events available but stats and odds are both unavailable. should_push=false normally.
- low_evidence: No usable stats, no usable odds, and no meaningful events. should_push=false.
- If STATS_SOURCE = live-score-api-fallback, treat that fallback as the primary live stats source for this run. Do NOT blend or average it with missing API-Sports stats.

LATE GAME DISCIPLINE:
- minute >= ${LATE_PHASE_MINUTE}: be more conservative.
- minute >= ${VERY_LATE_PHASE_MINUTE}: exceptional circumstances only.
- minute >= ${ENDGAME_MINUTE}: default should_push = false, max stake 2%.

RED CARD PROTOCOL:
- Scan events for red cards. If found: add warning, reduce confidence by 1, re-evaluate.

MARKET SELECTION:
- 1X2 and BTTS No require confidence >= 7 AND significant stat gaps AND pre-match support.
- If not met, evaluate Over/Under instead.
- Historical data: 1x2_home worst market (35.6% win rate), 1x2_draw near-ban (30.3%).
- Odds >= 2.50: confidence cap 6, stake cap 3%.
- Before minute 30: early game caution, 1X2 should_push=false before minute 35.
- Over 3.5+: need current goals >= line-1 or clearly open match.
- CORNERS O/U: MUST calculate cornerTempoSoFar, cornersNeeded, cornersPerMinuteNeeded.
  - If cornersPerMinuteNeeded > cornerTempoSoFar x 1.5 -> should_push = false.
  - If cornersNeeded >= 3 AND minutesRemaining <= 20 -> should_push = false.
  - After minute 75: Corners Over requires cornersNeeded <= 1.
  - After minute 80: should_push = false for any Corners Over.
- Score 0-0 after minute 55: prefer GOALS Under markets (under_2.5, under_1.5). NOT corners_under.
- risk_level = HIGH -> should_push = false.

BTTS RULES (DATA-DRIVEN):
- BTTS YES: 54.5% win rate but PnL -4.55 (break-even trap at avg odds ~1.83).
  - MANDATORY: Calculate break_even_rate = 1/odds. Estimated probability must exceed break_even_rate + 5%.
  - Odds >= 2.00 for BTTS Yes -> should_push = false unless BOTH teams have shots_on_target >= 2.
  - "Pressure != Goals": Need evidence BOTH teams are dangerous. If weaker team has 0 SOT -> no BTTS Yes.
  - Score 0-0 after minute 60: reduce confidence by 2 for BTTS Yes, prefer Under.
- BTTS NO: 55.5% win rate but PnL -39.46 (worst BTTS market, odds too low).
  - Requires odds >= 1.70 (below = mathematically unprofitable).
  - If BOTH teams have shots_on_target >= 2 -> should_push = false for BTTS No.
  - Only justified: score gap >= 2, OR minute >= 70 + one team has 0 SOT, OR minute >= 75 + clean sheet.

BREAK-EVEN CHECK (MANDATORY FOR ALL):
- Before recommending ANY market: break_even_rate = 1/odds x 100.
- Estimated probability must exceed break_even_rate by >= 3% (edge >= 3%).
- If edge < 3% -> should_push = false.
- MUST include EXACT text in reasoning_en: "Break-even: X%, My estimate: Y%, Edge: Z%" - NON-NEGOTIABLE.
- Reference: confidence 5->40%, 6->50.2%, 7->51.2%, 8->57.1% actual win rates.

ODDS RULES:
- Treat odds exactly as provided, no adjustments.
- Suspicious odds (contradicting match dynamics) -> treat as unreliable -> should_push = false normally.
- Price < ${MIN_ODDS} -> should_push = false.

STAKE GUIDELINES:
- confidence 8-10: stake 5-8%
- confidence 6-7: stake 3-5%
- confidence 5: stake 2-3%
- confidence < 5: should_push = false, stake = 0

============================================================
CUSTOM CONDITIONS (INDEPENDENT EVALUATION)
============================================================
should_push = your investment recommendation.
custom_condition_matched = whether user's condition pattern is detected (factual check).
These are TWO SEPARATE decisions.

When custom_condition_matched = true, provide:
- condition_triggered_suggestion (bet or "No bet - reason")
- condition_triggered_reasoning_en/vi
- condition_triggered_confidence, condition_triggered_stake

============================================================
OUTPUT FORMAT - STRICT JSON
============================================================
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

ALL fields must exist. selection="" when should_push=false. bet_market="" when should_push=false.
The FIRST character MUST be "{" and the LAST must be "}".
NO markdown, NO code fences, NO commentary outside JSON.
`;
}
