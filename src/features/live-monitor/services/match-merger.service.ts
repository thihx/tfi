// ============================================================
// Match Merger Service
// Equivalent to: "Merge Match Data" + "Merge Odds to Match"
// ============================================================

import type {
  LiveMonitorConfig,
  FootballApiFixture,
  FootballApiOddsResponse,
  StatsCompact,
  EventCompact,
  OddsCanonical,
  MergedMatchData,
  PreMatchPrediction,
  DerivedMatchInsights,
} from '../types';

// ==================== Helpers ====================

function getStatValue(
  teamStats: Array<{ type: string; value: number | string | null }>,
  statName: string,
): string | null {
  if (!Array.isArray(teamStats)) return null;
  const stat = teamStats.find((s) => s.type === statName);
  return stat?.value != null ? String(stat.value) : null;
}

function twoSideStat(
  homeStats: Array<{ type: string; value: number | string | null }>,
  awayStats: Array<{ type: string; value: number | string | null }>,
  statName: string,
): string {
  const h = getStatValue(homeStats, statName) ?? '';
  const a = getStatValue(awayStats, statName) ?? '';
  return `${h}-${a}`;
}

function parseTwoSide(v: string): { home: string | null; away: string | null } {
  if (!v) return { home: null, away: null };
  const parts = String(v).split('-');
  const h = (parts[0] || '').trim() || null;
  const a = (parts[1] || '').trim() || null;
  return { home: h, away: a };
}

function toNumber(v: unknown, def: number | null = null): number | null {
  if (v === null || v === undefined) return def;
  if (typeof v === 'number') return isNaN(v) ? def : v;
  const n = Number(String(v).trim());
  return isNaN(n) ? def : n;
}

function parsePreMatchPrediction(predictionRaw: unknown): PreMatchPrediction | null {
  if (!predictionRaw) return null;
  if (typeof predictionRaw === 'object' && predictionRaw !== null)
    return predictionRaw as PreMatchPrediction;
  if (typeof predictionRaw === 'string') {
    const trimmed = predictionRaw.trim();
    if (!trimmed || trimmed === '{}') return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

function buildPreMatchSummary(prediction: PreMatchPrediction | null): string {
  if (!prediction) return '';
  const parts: string[] = [];
  const pred = prediction.predictions || {};
  const comp = prediction.comparison || {};
  if (pred.winner?.name) parts.push(`Favourite: ${pred.winner.name}`);
  if (pred.percent) {
    const p = pred.percent;
    parts.push(`H${p.home || '?'} D${p.draw || '?'} A${p.away || '?'}`);
  }
  if (comp.total?.home && comp.total?.away) {
    parts.push(`Rating: ${comp.total.home} vs ${comp.total.away}`);
  }
  return parts.join(' | ');
}

// ==================== Derive Insights from Events ====================

function deriveInsightsFromEvents(
  events: EventCompact[],
  minute: number,
  homeName: string,
  awayName: string,
): DerivedMatchInsights {
  const homeGoalsTimeline: number[] = [];
  const awayGoalsTimeline: number[] = [];
  let homeCards = 0;
  let awayCards = 0;
  let homeReds = 0;
  let awayReds = 0;
  let homeSubs = 0;
  let awaySubs = 0;
  let lastGoalMinute: number | null = null;

  // Recent events in last 15 minutes for momentum calc
  const recentThreshold = Math.max(0, minute - 15);
  let homeRecentEvents = 0;
  let awayRecentEvents = 0;

  for (const ev of events) {
    const isHome = ev.team === homeName;
    const isAway = ev.team === awayName;

    if (ev.type === 'goal') {
      if (isHome) homeGoalsTimeline.push(ev.minute);
      if (isAway) awayGoalsTimeline.push(ev.minute);
      lastGoalMinute = Math.max(lastGoalMinute ?? 0, ev.minute);
    }
    if (ev.type === 'card') {
      const isRed = ev.detail.toLowerCase().includes('red');
      if (isHome) { homeCards++; if (isRed) homeReds++; }
      if (isAway) { awayCards++; if (isRed) awayReds++; }
    }
    if (ev.type === 'subst') {
      if (isHome) homeSubs++;
      if (isAway) awaySubs++;
    }

    // Momentum: count recent events per team
    if (ev.minute >= recentThreshold) {
      if (isHome) homeRecentEvents++;
      if (isAway) awayRecentEvents++;
    }
  }

  const totalCards = homeCards + awayCards;
  const totalGoals = homeGoalsTimeline.length + awayGoalsTimeline.length;
  const goalTempo = minute > 0 ? totalGoals / minute : 0;

  // Intensity based on events density
  const eventsPerMinute = minute > 0 ? (totalGoals + totalCards) / minute : 0;
  let intensity: 'low' | 'medium' | 'high' = 'low';
  if (eventsPerMinute > 0.1) intensity = 'high';
  else if (eventsPerMinute > 0.05) intensity = 'medium';

  // Momentum: which team had more recent events
  let momentum: 'home' | 'away' | 'neutral' = 'neutral';
  if (homeRecentEvents > awayRecentEvents + 1) momentum = 'home';
  else if (awayRecentEvents > homeRecentEvents + 1) momentum = 'away';

  return {
    goal_tempo: Math.round(goalTempo * 1000) / 1000,
    btts_status: homeGoalsTimeline.length > 0 && awayGoalsTimeline.length > 0,
    home_goals_timeline: homeGoalsTimeline,
    away_goals_timeline: awayGoalsTimeline,
    last_goal_minute: lastGoalMinute,
    total_cards: totalCards,
    home_cards: homeCards,
    away_cards: awayCards,
    home_reds: homeReds,
    away_reds: awayReds,
    home_subs: homeSubs,
    away_subs: awaySubs,
    momentum,
    intensity,
    source: 'events',
  };
}

// ==================== Merge Match Data ====================

interface PreparedMatch {
  config: LiveMonitorConfig;
  match_id: string;
  home_team: string;
  away_team: string;
  league: string;
  mode: string;
  custom_conditions: string;
  priority: number;
  prediction: string;
  force_analyze: boolean;
  is_manual_push: boolean;
  recommended_custom_condition: string;
  recommended_condition_reason: string;
  recommended_condition_reason_vi: string;
  strategic_context: unknown;
}

/**
 * Merge fixture API data with watchlist match data.
 * Mirrors the "Merge Match Data" node exactly.
 */
export function mergeMatchData(
  preparedMatches: PreparedMatch[],
  fixtures: FootballApiFixture[],
): MergedMatchData[] {
  const fixtureMap = new Map<string, FootballApiFixture>();
  for (const fx of fixtures) {
    const id = fx?.fixture?.id;
    if (id) fixtureMap.set(String(id), fx);
  }

  const outputs: MergedMatchData[] = [];

  for (const match of preparedMatches) {
    const matchId = String(match.match_id);
    const fx = fixtureMap.get(matchId);
    if (!fx) continue;

    const status = fx.fixture?.status?.short || 'NS';
    const minute = fx.fixture?.status?.elapsed ?? (status === 'FT' ? 90 : 0);
    const homeGoals = fx.goals?.home ?? 0;
    const awayGoals = fx.goals?.away ?? 0;

    const statsArr = fx.statistics || [];
    const homeStats = statsArr[0]?.statistics || [];
    const awayStats = statsArr[1]?.statistics || [];

    const stats = {
      possession: twoSideStat(homeStats, awayStats, 'Ball Possession'),
      shots: twoSideStat(homeStats, awayStats, 'Total Shots'),
      shots_on_target: twoSideStat(homeStats, awayStats, 'Shots on Goal'),
      corners: twoSideStat(homeStats, awayStats, 'Corner Kicks'),
      fouls: twoSideStat(homeStats, awayStats, 'Fouls'),
    };

    const statsCompact: StatsCompact = {
      possession: parseTwoSide(stats.possession),
      shots: parseTwoSide(stats.shots),
      shots_on_target: parseTwoSide(stats.shots_on_target),
      corners: parseTwoSide(stats.corners),
      fouls: parseTwoSide(stats.fouls),
      offsides: parseTwoSide(twoSideStat(homeStats, awayStats, 'Offsides')),
      yellow_cards: parseTwoSide(twoSideStat(homeStats, awayStats, 'Yellow Cards')),
      red_cards: parseTwoSide(twoSideStat(homeStats, awayStats, 'Red Cards')),
      goalkeeper_saves: parseTwoSide(twoSideStat(homeStats, awayStats, 'Goalkeeper Saves')),
      blocked_shots: parseTwoSide(twoSideStat(homeStats, awayStats, 'Blocked Shots')),
      total_passes: parseTwoSide(twoSideStat(homeStats, awayStats, 'Total passes')),
      passes_accurate: parseTwoSide(twoSideStat(homeStats, awayStats, 'Passes accurate')),
    };

    const rawEvents = Array.isArray(fx.events) ? fx.events : [];
    const homeName = fx.teams?.home?.name || match.home_team || 'Home';
    const awayName = fx.teams?.away?.name || match.away_team || 'Away';
    const leagueName = fx.league?.name || match.league || 'Unknown league';
    const homeTeamId = fx.teams?.home?.id;
    const awayTeamId = fx.teams?.away?.id;

    const summaryPieces: string[] = [];
    const compactEvents: EventCompact[] = [];

    let goalsHomeEv = 0;
    let goalsAwayEv = 0;
    const sortedEvents = [...rawEvents].sort(
      (a, b) => (a.time?.elapsed || 0) - (b.time?.elapsed || 0),
    );

    for (const ev of sortedEvents) {
      const m = ev.time?.elapsed;
      const type = ev.type || '';
      const detail = ev.detail || '';
      const teamId = ev.team?.id;
      const side =
        teamId === homeTeamId ? 'home' : teamId === awayTeamId ? 'away' : 'unknown';
      const sideName =
        side === 'home' ? homeName : side === 'away' ? awayName : (ev.team?.name || '');

      if (type === 'Goal') {
        if (side === 'home') goalsHomeEv++;
        else if (side === 'away') goalsAwayEv++;
        summaryPieces.push(`${m}'Goal ${sideName} ${goalsHomeEv}-${goalsAwayEv}`);
        compactEvents.push({
          minute: m ?? 0,
          extra: ev.time?.extra ?? null,
          team: sideName,
          type: 'goal',
          detail: `${goalsHomeEv}-${goalsAwayEv}`,
          player: ev.player?.name || '',
        });
      }
      if (type === 'Card') {
        summaryPieces.push(`${m}'${detail} ${sideName}`);
        compactEvents.push({
          minute: m ?? 0,
          extra: ev.time?.extra ?? null,
          team: sideName,
          type: 'card',
          detail,
          player: ev.player?.name || '',
        });
      }
      if (type === 'subst') {
        const playerOut = ev.player?.name || '';
        const playerIn = ev.assist?.name || '';
        summaryPieces.push(`${m}'Sub ${sideName} ${playerIn} for ${playerOut}`);
        compactEvents.push({
          minute: m ?? 0,
          extra: ev.time?.extra ?? null,
          team: sideName,
          type: 'subst',
          detail: `${playerIn} for ${playerOut}`,
          player: playerIn,
        });
      }
    }

    const preMatchPrediction = parsePreMatchPrediction(match.prediction);
    const preMatchPredictionSummary = buildPreMatchSummary(preMatchPrediction);

    // Derive insights from events (useful when API stats are unavailable)
    const allCompactEvents = [...compactEvents]; // all events, not sliced
    const derivedInsights = deriveInsightsFromEvents(
      allCompactEvents,
      typeof minute === 'number' ? minute : 0,
      homeName,
      awayName,
    );

    // Backfill card stats from events when API stats are empty
    const apiStatsEmpty = homeStats.length === 0 && awayStats.length === 0;
    if (apiStatsEmpty) {
      statsCompact.yellow_cards = {
        home: String(derivedInsights.home_cards - derivedInsights.home_reds),
        away: String(derivedInsights.away_cards - derivedInsights.away_reds),
      };
      statsCompact.red_cards = {
        home: String(derivedInsights.home_reds),
        away: String(derivedInsights.away_reds),
      };
    }

    outputs.push({
      match_id: match.match_id,
      config: match.config,
      match: {
        id: matchId,
        home: homeName,
        away: awayName,
        league: leagueName,
        minute,
        score: `${homeGoals}-${awayGoals}`,
        status,
      },
      league: leagueName,
      home_team: homeName,
      away_team: awayName,
      minute,
      score: `${homeGoals}-${awayGoals}`,
      status,
      mode: match.mode,
      custom_conditions: match.custom_conditions,
      recommended_custom_condition: match.recommended_custom_condition,
      recommended_condition_reason: match.recommended_condition_reason,
      recommended_condition_reason_vi: match.recommended_condition_reason_vi,
      force_analyze: match.force_analyze,
      is_manual_push: match.is_manual_push,
      skipped_filters: [],
      original_would_proceed: true,
      stats_compact: statsCompact,
      stats_available: false, // Will be set by filters
      stats_meta: {},
      stats,
      events_compact: compactEvents.slice(-8),
      events_summary: summaryPieces.slice(-8).join(' | '),
      current_total_goals: homeGoals + awayGoals,
      odds_canonical: {},
      odds_available: false,
      odds_sanity_warnings: [],
      odds_suspicious: false,
      odds_source: undefined,
      derived_insights: derivedInsights,
      pre_match_prediction: preMatchPrediction,
      pre_match_prediction_summary: preMatchPredictionSummary,
      strategic_context: match.strategic_context || null,
    });
  }

  return outputs;
}

// ==================== Merge Odds ====================

function isHalfTimeMarket(betName: string): boolean {
  const name = betName.toLowerCase();
  return (
    name.includes('1st half') ||
    name.includes('2nd half') ||
    name.includes('(1st half)') ||
    name.includes('(2nd half)') ||
    name.includes('first half') ||
    name.includes('second half') ||
    name.includes(' 1h') ||
    name.includes('1h ') ||
    name.includes(' 2h') ||
    name.includes('2h ') ||
    name.includes(' ht') ||
    name.endsWith(' ht') ||
    name.includes('half time') ||
    name.includes('halftime') ||
    name.includes('half-time') ||
    /\b1h\b/.test(name) ||
    /\b2h\b/.test(name) ||
    /\bht\b/.test(name)
  );
}

/**
 * Validate implied-probability margins for each market.
 * Removes markets with unrealistic margins (implied probability outside 85-115% for 2-way,
 * 90-120% for 3-way), since those indicate stale/corrupted data.
 * Returns warnings for removed markets.
 */
function validateMarketMargins(canonical: OddsCanonical): { warnings: string[]; cleaned: OddsCanonical } {
  const warnings: string[] = [];
  const cleaned = { ...canonical };

  // Helper: implied probability = 1/odds
  const ip = (o: number | null | undefined) => (o && o > 1 ? 1 / o : 0);

  // 1X2 (3-way): valid range 90%-120%
  const odds1x2 = canonical['1x2'];
  if (odds1x2) {
    const total = ip(odds1x2.home) + ip(odds1x2.draw) + ip(odds1x2.away);
    if (total > 0 && (total < 0.90 || total > 1.20)) {
      warnings.push(`MARGIN_INVALID: 1X2 implied probability ${(total * 100).toFixed(1)}% outside 90-120% range — removed`);
      delete cleaned['1x2'];
    }
  }

  // OU (2-way): valid range 85%-115%
  const ou = canonical['ou'];
  if (ou && ou.over !== null && ou.under !== null) {
    const total = ip(ou.over) + ip(ou.under);
    if (total > 0 && (total < 0.85 || total > 1.15)) {
      warnings.push(`MARGIN_INVALID: O/U ${ou.line} implied probability ${(total * 100).toFixed(1)}% outside 85-115% range — removed`);
      delete cleaned['ou'];
    }
  }

  // AH (2-way): valid range 85%-115%
  const ah = canonical['ah'];
  if (ah && ah.home !== null && ah.away !== null) {
    const total = ip(ah.home) + ip(ah.away);
    if (total > 0 && (total < 0.85 || total > 1.15)) {
      warnings.push(`MARGIN_INVALID: AH ${ah.line} implied probability ${(total * 100).toFixed(1)}% outside 85-115% range — removed`);
      delete cleaned['ah'];
    }
  }

  // BTTS (2-way): valid range 85%-115%
  const btts = canonical['btts'];
  if (btts && btts.yes !== null && btts.no !== null) {
    const total = ip(btts.yes) + ip(btts.no);
    if (total > 0 && (total < 0.85 || total > 1.15)) {
      warnings.push(`MARGIN_INVALID: BTTS implied probability ${(total * 100).toFixed(1)}% outside 85-115% range — removed`);
      delete cleaned['btts'];
    }
  }

  // Corners OU (2-way): valid range 85%-115%
  const cornersOu = canonical['corners_ou'];
  if (cornersOu && cornersOu.over !== null && cornersOu.under !== null) {
    const total = ip(cornersOu.over) + ip(cornersOu.under);
    if (total > 0 && (total < 0.85 || total > 1.15)) {
      warnings.push(`MARGIN_INVALID: Corners O/U ${cornersOu.line} implied probability ${(total * 100).toFixed(1)}% outside 85-115% range — removed`);
      delete cleaned['corners_ou'];
    }
  }

  return { warnings, cleaned };
}

function checkOddsSanity(
  canonical: OddsCanonical,
  minute: number,
  scoreStr: string,
): string[] {
  const warnings: string[] = [];

  // Phase 1: Margin validation (all minutes) — removes bad markets from copy
  const { warnings: marginWarnings, cleaned } = validateMarketMargins(canonical);
  warnings.push(...marginWarnings);
  // Apply cleaned result: remove keys that were stripped by validation
  for (const k of Object.keys(canonical) as (keyof OddsCanonical)[]) {
    if (!(k in cleaned)) delete canonical[k];
  }

  const odds1x2 = canonical?.['1x2'];
  if (!odds1x2) return warnings;

  const { home, draw, away } = odds1x2;
  const parts = String(scoreStr || '0-0').split('-');
  const homeGoals = parseInt(parts[0] ?? '0', 10) || 0;
  const awayGoals = parseInt(parts[1] ?? '0', 10) || 0;

  // Phase 2: Late-game directional checks (minute >= 75)
  if (minute >= 75) {
    if (homeGoals === awayGoals && draw !== null && draw > 15) {
      warnings.push(`SANITY_FAIL: Draw @${draw} at ${minute}' with ${scoreStr} is unrealistic`);
    }
    if (homeGoals >= awayGoals + 2 && home !== null && home > 5) {
      warnings.push(
        `SANITY_FAIL: Home @${home} leading 2+ at ${minute}' is unrealistic`,
      );
    }
    if (awayGoals >= homeGoals + 2 && away !== null && away > 5) {
      warnings.push(
        `SANITY_FAIL: Away @${away} leading 2+ at ${minute}' is unrealistic`,
      );
    }
    if (homeGoals > awayGoals && home !== null && away !== null && home > away) {
      warnings.push(
        `SANITY_FAIL: Home leading but higher odds (H@${home} vs A@${away})`,
      );
    }
    if (awayGoals > homeGoals && away !== null && home !== null && away > home) {
      warnings.push(
        `SANITY_FAIL: Away leading but higher odds (A@${away} vs H@${home})`,
      );
    }
  }

  // Phase 3: Extreme odds check (minute >= 70)
  if (
    minute >= 70 &&
    ((home !== null && home > 50) ||
      (draw !== null && draw > 50) ||
      (away !== null && away > 50))
  ) {
    warnings.push(
      `SANITY_FAIL: Extreme odds (H@${home}, D@${draw}, A@${away}) at ${minute}'`,
    );
  }

  return warnings;
}

/**
 * Merge live odds data into match data.
 * Mirrors the "Merge Odds to Match" node exactly.
 */
export function mergeOddsToMatch(
  matchData: MergedMatchData,
  oddsResponse: FootballApiOddsResponse,
): MergedMatchData {
  const respArr = Array.isArray(oddsResponse.response) ? oddsResponse.response : [];
  let bookmakers: FootballApiOddsResponse['response'][0]['bookmakers'] = [];

  if (respArr.length > 0) {
    const first = respArr[0];
    if (first && Array.isArray(first.bookmakers) && first.bookmakers.length) {
      bookmakers = first.bookmakers;
    }
  }

  let oddsAvailable = false;
  const oddsMap: Record<string, number> = {};

  const best1X2 = {
    home: { odd: 0, bm: '' },
    draw: { odd: 0, bm: '' },
    away: { odd: 0, bm: '' },
  };
  const bestBTTS = {
    yes: { odd: 0, bm: '' },
    no: { odd: 0, bm: '' },
  };

  if (bookmakers.length > 0) {
    oddsAvailable = true;

    for (const bk of bookmakers) {
      const bkName = bk.name || 'Bookmaker';

      for (const bet of bk.bets || []) {
        const betName = String(bet.name || '').toLowerCase();
        const values = bet.values || [];
        const isHalfMarket = isHalfTimeMarket(betName);
        const isSpecialMinuteMarket = /\d+\s*minute/.test(betName);
        const isCornersMarket = betName.includes('corner');

        // --- 1X2 ---
        if (
          !isHalfMarket &&
          !isSpecialMinuteMarket &&
          !isCornersMarket &&
          (betName.includes('1x2') ||
            betName.includes('match winner') ||
            betName === 'full time result' ||
            betName === 'fulltime result' ||
            betName.includes('fulltime result'))
        ) {
          for (const v of values) {
            const label = String(v.value || '').toLowerCase().trim();
            const odd = toNumber(v.odd) ?? 0;
            if (!odd || odd <= 1) continue;

            if (label === 'home' || label === '1') {
              if (odd > best1X2.home.odd) best1X2.home = { odd, bm: bkName };
              oddsMap['home'] = Math.max(oddsMap['home'] || 0, odd);
            }
            if (label === 'draw' || label === 'x') {
              if (odd > best1X2.draw.odd) best1X2.draw = { odd, bm: bkName };
              oddsMap['draw'] = Math.max(oddsMap['draw'] || 0, odd);
            }
            if (label === 'away' || label === '2') {
              if (odd > best1X2.away.odd) best1X2.away = { odd, bm: bkName };
              oddsMap['away'] = Math.max(oddsMap['away'] || 0, odd);
            }
          }
        }

        // --- Over/Under ---
        if (
          !isHalfMarket &&
          (betName.includes('over/under') ||
            betName.includes('over / under') ||
            betName.includes('total goals') ||
            betName.includes('match goals'))
        ) {
          for (const v of values) {
            const raw = String(v.value || '').toLowerCase().trim();
            const hc = (v as Record<string, unknown>).handicap != null
              ? String((v as Record<string, unknown>).handicap).trim()
              : '';
            const odd = toNumber(v.odd) ?? 0;
            if (!odd || odd <= 1) continue;

            // Live format: value="Over", handicap="2.5"
            // Pre-match format: value="Over 2.5", handicap=""
            let key: string;
            if (hc) {
              key = `${raw} ${hc}`.toLowerCase();
            } else {
              // Try to parse from value e.g. "over 2.5" → keep as-is
              const m = raw.match(/^(over|under)\s+([0-9]+(?:\.[0-9]+)?)$/);
              if (!m) continue;
              key = raw;
            }
            if (!oddsMap[key] || odd > oddsMap[key]) {
              oddsMap[key] = odd;
            }
          }
        }

        // --- Asian Handicap ---
        if (
          !isHalfMarket &&
          (betName.includes('asian handicap') || betName.includes('handicap'))
        ) {
          for (const v of values) {
            let raw = String(v.value || '').toLowerCase().trim();
            const hc = (v as Record<string, unknown>).handicap != null
              ? String((v as Record<string, unknown>).handicap).trim()
              : '';
            const odd = toNumber(v.odd) ?? 0;
            if (!odd || odd <= 1) continue;

            // Live format: value="Home", handicap="-1"
            // Pre-match format: value="Home -1", handicap=""
            let key: string;
            if (hc) {
              if (raw === '1') raw = 'home';
              if (raw === '2') raw = 'away';
              key = `${raw} ${hc}`.toLowerCase();
            } else {
              // Try to parse from value e.g. "home -1" or "away -0.5"
              const m = raw.match(/^(home|away|1|2)\s+([-+]?[0-9]+(?:\.[0-9]+)?)$/);
              if (!m) continue;
              let side = m[1];
              if (side === '1') side = 'home';
              if (side === '2') side = 'away';
              key = `${side} ${m[2]}`;
            }
            if (!oddsMap[key] || odd > oddsMap[key]) {
              oddsMap[key] = odd;
            }
          }
        }

        // --- Corners ---
        if (!isHalfMarket && betName.includes('corner')) {
          for (const v of values) {
            const raw = String(v.value || '').toLowerCase().trim();
            const hc = (v as Record<string, unknown>).handicap != null
              ? String((v as Record<string, unknown>).handicap).trim()
              : '';
            const odd = toNumber(v.odd) ?? 0;
            if (!odd || odd <= 1) continue;

            // Live format: value="Over", handicap="9.5"
            // Pre-match format: value="Over 9.5", handicap=""
            let key: string | null = null;
            if (hc && (raw === 'over' || raw === 'under')) {
              key = `corners ${raw} ${hc}`.toLowerCase();
            } else {
              const m = raw.match(/^(over|under)\s+([0-9]+(?:\.[0-9]+)?)$/);
              if (m) key = `corners ${m[1]} ${m[2]}`.toLowerCase();
            }
            if (key && (!oddsMap[key] || odd > oddsMap[key])) {
              oddsMap[key] = odd;
            }
          }
        }

        // --- BTTS ---
        if (!isHalfMarket && (betName.includes('both teams') || betName === 'btts')) {
          for (const v of values) {
            const label = String(v.value || '').toLowerCase().trim();
            const odd = toNumber(v.odd) ?? 0;
            if (!odd || odd <= 1) continue;

            if (label === 'yes') {
              if (odd > bestBTTS.yes.odd) bestBTTS.yes = { odd, bm: bkName };
              oddsMap['btts yes'] = Math.max(oddsMap['btts yes'] || 0, odd);
            }
            if (label === 'no') {
              if (odd > bestBTTS.no.odd) bestBTTS.no = { odd, bm: bkName };
              oddsMap['btts no'] = Math.max(oddsMap['btts no'] || 0, odd);
            }
          }
        }
      }
    }
  }

  // Build canonical odds
  const oddsCanonical: OddsCanonical = {};

  // 1X2
  if (best1X2.home.odd > 0 || best1X2.away.odd > 0 || best1X2.draw.odd > 0) {
    oddsCanonical['1x2'] = {
      home: best1X2.home.odd || null,
      draw: best1X2.draw.odd || null,
      away: best1X2.away.odd || null,
    };
  }

  // OU Goals
  oddsCanonical['ou'] = buildMainOU(
    oddsMap,
    /^(over|under)\s+[0-9]+(\.[0-9]+)?$/,
    /^(over|under)\s+([0-9]+(\.[0-9]+)?)/,
  );

  // Asian Handicap
  oddsCanonical['ah'] = buildMainAH(oddsMap);

  // Corners OU
  oddsCanonical['corners_ou'] = buildMainOU(
    oddsMap,
    /^corners\s+(over|under)\s+[0-9]+(\.[0-9]+)?$/,
    /^corners\s+(over|under)\s+([0-9]+(\.[0-9]+)?)/,
  );

  // BTTS
  if (bestBTTS.yes.odd > 0 || bestBTTS.no.odd > 0) {
    oddsCanonical['btts'] = {
      yes: bestBTTS.yes.odd || null,
      no: bestBTTS.no.odd || null,
    };
  }

  // Sanity check — skip for pre-match odds since they don't reflect live game state
  const oddsSource = oddsResponse.odds_source;
  const isPreMatch = oddsSource === 'pre-match';
  const minute = typeof matchData.match.minute === 'number' ? matchData.match.minute : 0;
  let oddsSanityWarnings: string[];
  let oddsSuspicious: boolean;

  if (isPreMatch) {
    oddsSanityWarnings = ['PRE_MATCH_ODDS: Live odds unavailable, using pre-match opening odds as reference only'];
    oddsSuspicious = false;
  } else {
    oddsSanityWarnings = checkOddsSanity(oddsCanonical, minute, matchData.match.score);
    // Only mark as broadly suspicious for SANITY_FAIL warnings (directional/extreme),
    // not for MARGIN_INVALID (those markets are already removed from canonical)
    oddsSuspicious = oddsSanityWarnings.some(w => w.startsWith('SANITY_FAIL'));
  }

  // Check if any valid markets remain after margin validation
  const hasAnyMarket = !!(
    oddsCanonical['1x2'] || oddsCanonical['ou'] || oddsCanonical['ah'] ||
    oddsCanonical['btts'] || oddsCanonical['corners_ou']
  );
  const oddsStillAvailable = oddsAvailable && hasAnyMarket;

  return {
    ...matchData,
    odds_canonical: oddsCanonical,
    odds_available: oddsStillAvailable,
    odds_sanity_warnings: oddsSanityWarnings,
    odds_suspicious: oddsSuspicious,
    odds_source: oddsSource,
    current_total_goals: matchData.current_total_goals,
  };
}

// ==================== OU/AH Line Builders ====================

function buildMainOU(
  oddsMap: Record<string, number>,
  regexKey: RegExp,
  regexParse: RegExp,
): { line: number; over: number | null; under: number | null } | undefined {
  const entries = Object.entries(oddsMap).filter(([k]) => regexKey.test(k));
  if (!entries.length) return undefined;

  const lineMap = new Map<string, Record<string, number>>();
  for (const [k, odd] of entries) {
    const m = k.match(regexParse);
    if (!m?.[1] || !m[2]) continue;
    const dir = m[1]; // over / under
    const lineStr = m[2]; // "2.5"
    const line = Number(lineStr);
    if (!Number.isFinite(line)) continue;

    if (!lineMap.has(lineStr)) lineMap.set(lineStr, {});
    const entry = lineMap.get(lineStr)!;
    entry[dir] = Math.max(entry[dir] || 0, odd);
  }

  // Pick the most balanced line (smallest spread between over/under odds).
  // This correctly selects e.g. O/U 2.5 from pre-match data with all lines.
  let bestLine: string | null = null;
  let bestSpread = Infinity;
  for (const [lineStr, data] of lineMap) {
    const o = data['over'];
    const u = data['under'];
    if (o && u) {
      const spread = Math.abs(o - u);
      if (spread < bestSpread) {
        bestSpread = spread;
        bestLine = lineStr;
      }
    }
  }
  // Fallback: pick smallest absolute line if no line has both sides
  if (!bestLine) {
    const sorted = Array.from(lineMap.keys())
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => Math.abs(a) - Math.abs(b));
    if (!sorted.length) return undefined;
    bestLine = String(sorted[0]);
  }
  const bestData = lineMap.get(bestLine) || {};
  return {
    line: Number(bestLine),
    over: bestData['over'] ?? null,
    under: bestData['under'] ?? null,
  };
}

function buildMainAH(
  oddsMap: Record<string, number>,
): { line: number; home: number | null; away: number | null } | undefined {
  const entries = Object.entries(oddsMap).filter(([k]) =>
    /^(home|away)\s+[-+]?[0-9]+(\.[0-9]+)?$/.test(k),
  );
  if (!entries.length) return undefined;

  const lineMap = new Map<string, Record<string, number>>();
  for (const [k, odd] of entries) {
    const m = k.match(/^(home|away)\s+([-+]?[0-9]+(\.[0-9]+)?)/);
    if (!m?.[1] || !m[2]) continue;
    const side = m[1];
    const lineStr = m[2];
    const line = Number(lineStr);
    if (!Number.isFinite(line)) continue;

    if (!lineMap.has(lineStr)) lineMap.set(lineStr, {});
    const entry = lineMap.get(lineStr)!;
    entry[side] = Math.max(entry[side] || 0, odd);
  }

  // Pick the most balanced line (smallest spread between home/away odds).
  // This correctly selects e.g. AH -1 from pre-match data with all lines.
  let bestLine: string | null = null;
  let bestSpread = Infinity;
  for (const [lineStr, data] of lineMap) {
    const h = data['home'];
    const a = data['away'];
    if (h && a) {
      const spread = Math.abs(h - a);
      if (spread < bestSpread) {
        bestSpread = spread;
        bestLine = lineStr;
      }
    }
  }
  // Fallback: pick smallest absolute line if no line has both sides
  if (!bestLine) {
    const sorted = Array.from(lineMap.keys())
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => Math.abs(a) - Math.abs(b));
    if (!sorted.length) return undefined;
    bestLine = String(sorted[0]);
  }
  const bestData = lineMap.get(bestLine) || {};
  return {
    line: Number(bestLine),
    home: bestData['home'] ?? null,
    away: bestData['away'] ?? null,
  };
}
