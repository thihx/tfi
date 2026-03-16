// ============================================================
// Test Fixtures for Live Monitor Pipeline
// ============================================================

import type {
  LiveMonitorConfig,
  WatchlistMatch,
  FilteredMatch,
  MergedMatchData,
  ParsedAiResponse,
  FootballApiFixture,
  FootballApiOddsResponse,
  StatsCompact,
  OddsCanonical,
} from '../types';

// ==================== Config ====================

export function createConfig(overrides?: Partial<LiveMonitorConfig>): LiveMonitorConfig {
  return {
    SPREADSHEET_ID: 'test-sheet-id',
    SHEET_IDS: { Watchlist: 0, Recommendations: 1, Matches: 2, ApprovedLeagues: 3 },
    TIMEZONE: 'Asia/Seoul',
    MATCH_STARTED_THRESHOLD_MINUTES: 120,
    MATCH_NOT_YET_STARTED_BUFFER_MINUTES: 5,
    MIN_CONFIDENCE: 5,
    MIN_ODDS: 1.5,
    LATE_PHASE_MINUTE: 75,
    VERY_LATE_PHASE_MINUTE: 85,
    ENDGAME_MINUTE: 88,
    AI_PROVIDER: 'gemini',
    AI_MODEL: 'gemini-3-pro-preview',
    EMAIL_TO: 'test@example.com',
    TELEGRAM_CHAT_ID: '1234567',
    MANUAL_PUSH_MATCH_IDS: [],
    MIN_MINUTE: 5,
    MAX_MINUTE: 85,
    SECOND_HALF_START_MINUTE: 5,
    BATCH_SIZE: 20,
    ...overrides,
  };
}

// ==================== Watchlist ====================

export function createWatchlistMatch(overrides?: Partial<WatchlistMatch>): WatchlistMatch {
  return {
    match_id: '12345',
    date: '2026-03-16',
    league: 'Premier League',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    kickoff: '20:00',
    mode: 'B',
    priority: 3,
    custom_conditions: '',
    status: 'active',
    ...overrides,
  };
}

export function createFilteredMatch(overrides?: Partial<FilteredMatch>): FilteredMatch {
  return {
    ...createWatchlistMatch(),
    force_analyze: false,
    is_manual_push: false,
    ...overrides,
  };
}

// ==================== Stats ====================

export function createStatsCompact(overrides?: Partial<StatsCompact>): StatsCompact {
  return {
    possession: { home: 55, away: 45 },
    shots: { home: 8, away: 5 },
    shots_on_target: { home: 4, away: 2 },
    corners: { home: 5, away: 3 },
    fouls: { home: 10, away: 12 },
    offsides: { home: 2, away: 1 },
    yellow_cards: { home: 1, away: 2 },
    red_cards: { home: 0, away: 0 },
    goalkeeper_saves: { home: 2, away: 3 },
    blocked_shots: { home: 3, away: 1 },
    total_passes: { home: 350, away: 280 },
    passes_accurate: { home: 300, away: 240 },
    ...overrides,
  };
}

// ==================== Odds ====================

export function createOddsCanonical(overrides?: Partial<OddsCanonical>): OddsCanonical {
  return {
    '1x2': { home: 2.1, draw: 3.4, away: 3.8 },
    ou: { line: 2.5, over: 1.85, under: 2.0 },
    ah: { line: -0.5, home: 1.9, away: 2.0 },
    btts: { yes: 1.75, no: 2.1 },
    corners_ou: { line: 9.5, over: 1.85, under: 1.95 },
    ...overrides,
  };
}

// ==================== Merged Match Data ====================

export function createMergedMatchData(overrides?: Partial<MergedMatchData>): MergedMatchData {
  const config = createConfig();
  return {
    match_id: '12345',
    config,
    match: {
      id: '12345',
      home: 'Arsenal',
      away: 'Chelsea',
      league: 'Premier League',
      minute: 65,
      score: '1-0',
      status: '2H',
    },
    league: 'Premier League',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    minute: 65,
    score: '1-0',
    status: '2H',
    mode: 'B',
    custom_conditions: '',
    recommended_custom_condition: '',
    recommended_condition_reason: '',
    recommended_condition_reason_vi: '',
    force_analyze: false,
    is_manual_push: false,
    skipped_filters: [],
    original_would_proceed: true,
    stats_compact: createStatsCompact(),
    stats_available: true,
    stats_meta: { stats_quality: 'GOOD' },
    stats: {
      possession: '55% - 45%',
      shots: '8 - 5',
      shots_on_target: '4 - 2',
      corners: '5 - 3',
      fouls: '10 - 12',
    },
    events_compact: [
      { minute: 23, extra: null, team: 'Arsenal', type: 'Goal', detail: 'Normal Goal', player: 'Saka' },
    ],
    events_summary: '23\' ⚽ Saka (Arsenal)',
    current_total_goals: 1,
    odds_canonical: createOddsCanonical(),
    odds_available: true,
    odds_sanity_warnings: [],
    odds_suspicious: false,
    pre_match_prediction: null,
    pre_match_prediction_summary: '',
    ...overrides,
  };
}

// ==================== Parsed AI Response ====================

export function createParsedAiResponse(overrides?: Partial<ParsedAiResponse>): ParsedAiResponse {
  return {
    should_push: true,
    selection: 'Over 2.5 @1.85',
    bet_market: 'Over/Under',
    market_chosen_reason: 'Both teams attacking',
    confidence: 7,
    reasoning_en: 'Arsenal pressing high, Chelsea on counter.',
    reasoning_vi: 'Arsenal pressing cao, Chelsea phản công.',
    warnings: [],
    value_percent: 12,
    risk_level: 'MEDIUM',
    stake_percent: 3,
    custom_condition_matched: false,
    custom_condition_status: 'none',
    custom_condition_summary_en: '',
    custom_condition_summary_vi: '',
    custom_condition_reason_en: '',
    custom_condition_reason_vi: '',
    condition_triggered_suggestion: '',
    condition_triggered_reasoning_en: '',
    condition_triggered_reasoning_vi: '',
    condition_triggered_confidence: 0,
    condition_triggered_stake: 0,
    ai_should_push: true,
    system_should_bet: true,
    final_should_bet: true,
    ai_selection: 'Over 2.5 @1.85',
    ai_confidence: 7,
    ai_odd_raw: 1.85,
    ai_warnings: [],
    usable_odd: 1.85,
    mapped_odd: 1.85,
    odds_for_display: 1.85,
    condition_triggered_should_push: false,
    ...overrides,
  };
}

// ==================== Football API Fixture ====================

export function createFootballApiFixture(overrides?: Partial<FootballApiFixture>): FootballApiFixture {
  return {
    fixture: {
      id: 12345,
      referee: 'Michael Oliver',
      timezone: 'UTC',
      date: '2026-03-16T20:00:00+00:00',
      timestamp: 1773955200,
      periods: { first: 1773955200, second: 1773958800 },
      venue: { id: 1, name: 'Emirates Stadium', city: 'London' },
      status: { long: 'Second Half', short: '2H', elapsed: 65 },
    },
    league: {
      id: 39,
      name: 'Premier League',
      country: 'England',
      logo: 'https://example.com/logo.png',
      flag: 'https://example.com/flag.png',
      season: 2025,
      round: 'Regular Season - 30',
    },
    teams: {
      home: { id: 42, name: 'Arsenal', logo: 'https://example.com/arsenal.png', winner: null },
      away: { id: 49, name: 'Chelsea', logo: 'https://example.com/chelsea.png', winner: null },
    },
    goals: { home: 1, away: 0 },
    score: {
      halftime: { home: 1, away: 0 },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
    events: [
      {
        time: { elapsed: 23, extra: null },
        team: { id: 42, name: 'Arsenal', logo: '' },
        player: { id: 1, name: 'Saka' },
        assist: { id: 2, name: 'Odegaard' },
        type: 'Goal',
        detail: 'Normal Goal',
        comments: null,
      },
    ],
    statistics: [
      {
        team: { id: 42, name: 'Arsenal', logo: '' },
        statistics: [
          { type: 'Ball Possession', value: '55%' },
          { type: 'Total Shots', value: 8 },
          { type: 'Shots on Goal', value: 4 },
          { type: 'Corner Kicks', value: 5 },
          { type: 'Fouls', value: 10 },
        ],
      },
      {
        team: { id: 49, name: 'Chelsea', logo: '' },
        statistics: [
          { type: 'Ball Possession', value: '45%' },
          { type: 'Total Shots', value: 5 },
          { type: 'Shots on Goal', value: 2 },
          { type: 'Corner Kicks', value: 3 },
          { type: 'Fouls', value: 12 },
        ],
      },
    ],
    ...overrides,
  };
}

// ==================== Odds Response ====================

export function createOddsResponse(overrides?: Partial<FootballApiOddsResponse>): FootballApiOddsResponse {
  return {
    response: [
      {
        fixture: { id: 12345 },
        update: '2026-03-16T20:30:00+00:00',
        league: { id: 39, name: 'Premier League', country: 'England', logo: '', flag: '', season: 2025 },
        bookmakers: [
          {
            id: 1,
            name: 'Bet365',
            bets: [
              {
                id: 1,
                name: 'Match Winner',
                values: [
                  { value: 'Home', odd: '2.10' },
                  { value: 'Draw', odd: '3.40' },
                  { value: 'Away', odd: '3.80' },
                ],
              },
              {
                id: 2,
                name: 'Over/Under 2.5',
                values: [
                  { value: 'Over', odd: '1.85', handicap: '2.5' },
                  { value: 'Under', odd: '2.00', handicap: '2.5' },
                ],
              },
              {
                id: 3,
                name: 'Both Teams Score',
                values: [
                  { value: 'Yes', odd: '1.75' },
                  { value: 'No', odd: '2.10' },
                ],
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

// ==================== AppConfig ====================

export function createAppConfig() {
  return {
    defaultMode: 'B',
    apiUrl: 'http://localhost:4000',
  };
}
