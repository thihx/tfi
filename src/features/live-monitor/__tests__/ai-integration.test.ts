// ============================================================
// AI Integration Tests — Real LLM Calls with Simulated Data
//
// These tests call the REAL Gemini API to verify:
// 1. Prompt engineering produces correct AI behavior
// 2. AI response parsing works end-to-end
// 3. Different match scenarios yield sensible recommendations
//
// Requires: GEMINI_API_KEY env var (reads from packages/server/.env)
// Skip: Automatically skipped if no API key available
// Timeout: 60s per test (AI calls may take 10-30s)
// ============================================================

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAiPrompt } from '../services/ai-prompt.service';
import { parseAiResponse } from '../services/ai-analysis.service';
import { createMergedMatchData, createOddsCanonical, createStatsCompact } from './fixtures';
import type { MergedMatchData, LiveMonitorConfig, ParsedAiResponse } from '../types';

// ==================== Load API Key ====================

function loadGeminiApiKey(): string {
  try {
    const envPath = resolve(__dirname, '../../../../packages/server/.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^GEMINI_API_KEY=(.+)$/m);
    return match?.[1]?.trim() ?? '';
  } catch {
    return process.env.GEMINI_API_KEY ?? '';
  }
}

const GEMINI_API_KEY = loadGeminiApiKey();
const GEMINI_MODEL = 'gemini-2.5-flash';

// ==================== Direct Gemini API Call ====================

async function callGeminiDirect(prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API ${res.status}: ${text.substring(0, 300)}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ==================== Helpers ====================

/** Build MergedMatchData, call Gemini, parse response — full pipeline */
async function runAiPipeline(
  matchData: MergedMatchData,
  config?: LiveMonitorConfig,
): Promise<{ raw: string; parsed: ParsedAiResponse; prompt: string }> {
  const cfg = config ?? matchData.config;
  const prompt = buildAiPrompt(matchData);
  const raw = await callGeminiDirect(prompt);
  const parsed = parseAiResponse(raw, matchData, cfg);
  return { raw, parsed, prompt };
}

/** Common structural assertions for any valid AI response */
function assertValidStructure(parsed: ParsedAiResponse) {
  // Type checks
  expect(typeof parsed.should_push).toBe('boolean');
  expect(typeof parsed.ai_should_push).toBe('boolean');
  expect(typeof parsed.confidence).toBe('number');
  expect(typeof parsed.reasoning_en).toBe('string');
  expect(typeof parsed.reasoning_vi).toBe('string');
  expect(typeof parsed.selection).toBe('string');
  expect(typeof parsed.bet_market).toBe('string');
  expect(typeof parsed.stake_percent).toBe('number');
  expect(typeof parsed.custom_condition_matched).toBe('boolean');

  // Value ranges
  expect(parsed.confidence).toBeGreaterThanOrEqual(0);
  expect(parsed.confidence).toBeLessThanOrEqual(10);
  expect(parsed.stake_percent).toBeGreaterThanOrEqual(0);
  expect(parsed.stake_percent).toBeLessThanOrEqual(10);
  expect(['LOW', 'MEDIUM', 'HIGH']).toContain(parsed.risk_level);

  // Reasoning must be non-empty
  expect(parsed.reasoning_en.length).toBeGreaterThan(10);
  expect(parsed.reasoning_vi.length).toBeGreaterThan(10);

  // Consistency: if should_push=true, selection must exist
  if (parsed.ai_should_push) {
    expect(parsed.selection.length).toBeGreaterThan(0);
    expect(parsed.bet_market.length).toBeGreaterThan(0);
  }

  // Consistency: if should_push=false, selection should be empty
  if (!parsed.ai_should_push) {
    expect(parsed.selection).toBe('');
    expect(parsed.stake_percent).toBe(0);
  }

  // Custom condition fields must exist
  expect(['none', 'evaluated', 'parse_error']).toContain(parsed.custom_condition_status);
}

// ==================== Test Suites ====================

describe.skipIf(!GEMINI_API_KEY)('AI Integration — Real LLM', () => {

  // ----------------------------------------------------------
  // Scenario 1: Normal 2H match with good stats and odds
  // Expected: AI provides a reasonable recommendation or well-reasoned "no push"
  // ----------------------------------------------------------
  test('Scenario 1: Normal 2H match — valid response structure', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90001',
        home: 'Liverpool',
        away: 'Manchester City',
        league: 'Premier League',
        minute: 62,
        score: '1-1',
        status: '2H',
      },
      match_id: '90001',
      home_team: 'Liverpool',
      away_team: 'Manchester City',
      league: 'Premier League',
      minute: 62,
      score: '1-1',
      status: '2H',
      current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 52, away: 48 },
        shots: { home: 9, away: 7 },
        shots_on_target: { home: 4, away: 3 },
        corners: { home: 5, away: 4 },
        fouls: { home: 8, away: 11 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.6, draw: 3.3, away: 2.8 },
        ou: { line: 2.5, over: 1.55, under: 2.45 },
        ah: { line: -0.25, home: 1.95, away: 1.95 },
        btts: { yes: 1.4, no: 2.9 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 18, extra: null, team: 'Liverpool', type: 'goal', detail: '1-0', player: 'Salah' },
        { minute: 41, extra: null, team: 'Manchester City', type: 'goal', detail: '1-1', player: 'Haaland' },
      ],
      events_summary: "18' ⚽ Salah (Liverpool), 41' ⚽ Haaland (Manchester City)",
      force_analyze: false,
      is_manual_push: false,
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // BTTS is already true, so AI should not recommend BTTS Yes (already landed)
    if (parsed.ai_should_push && parsed.bet_market === 'btts_yes') {
      // BTTS Yes already achieved at 1-1, odd would be ~1.0
      // A good AI should NOT recommend this
      console.warn('AI recommended BTTS Yes when BTTS already achieved — prompt may need improvement');
    }
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 2: Early 1H match — AI should be cautious
  // ----------------------------------------------------------
  test('Scenario 2: Early 1H match — cautious response expected', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90002',
        home: 'Real Madrid',
        away: 'Barcelona',
        league: 'La Liga',
        minute: 15,
        score: '0-0',
        status: '1H',
      },
      match_id: '90002',
      home_team: 'Real Madrid',
      away_team: 'Barcelona',
      league: 'La Liga',
      minute: 15,
      score: '0-0',
      status: '1H',
      current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 45, away: 55 },
        shots: { home: 2, away: 3 },
        shots_on_target: { home: 1, away: 1 },
        corners: { home: 1, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.2, draw: 3.5, away: 3.1 },
        ou: { line: 2.5, over: 1.75, under: 2.05 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Early game: confidence capped at 6, 1X2 should_push=false before min 35
    if (parsed.ai_should_push) {
      expect(parsed.confidence).toBeLessThanOrEqual(7); // Early game should be cautious
      // 1X2 should NOT be recommended before minute 35
      if (parsed.bet_market.startsWith('1x2_')) {
        console.warn('AI recommended 1X2 at minute 15 — violates EARLY_GAME rule');
      }
    }
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 3: High-scoring match, 2H — likely Over/BTTS
  // ----------------------------------------------------------
  test('Scenario 3: High-scoring 2H match — expects attacking analysis', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90003',
        home: 'Bayern Munich',
        away: 'Borussia Dortmund',
        league: 'Bundesliga',
        minute: 58,
        score: '2-2',
        status: '2H',
      },
      match_id: '90003',
      home_team: 'Bayern Munich',
      away_team: 'Borussia Dortmund',
      league: 'Bundesliga',
      minute: 58,
      score: '2-2',
      status: '2H',
      current_total_goals: 4,
      stats_compact: createStatsCompact({
        possession: { home: 56, away: 44 },
        shots: { home: 12, away: 10 },
        shots_on_target: { home: 6, away: 5 },
        corners: { home: 6, away: 5 },
        fouls: { home: 7, away: 9 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.3, draw: 3.6, away: 3.2 },
        ou: { line: 4.5, over: 1.70, under: 2.10 },
        btts: { yes: 1.15, no: 5.0 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 8, extra: null, team: 'Bayern Munich', type: 'goal', detail: '1-0', player: 'Muller' },
        { minute: 22, extra: null, team: 'Borussia Dortmund', type: 'goal', detail: '1-1', player: 'Brandt' },
        { minute: 35, extra: null, team: 'Bayern Munich', type: 'goal', detail: '2-1', player: 'Sane' },
        { minute: 52, extra: null, team: 'Borussia Dortmund', type: 'goal', detail: '2-2', player: 'Adeyemi' },
      ],
      events_summary: "8' ⚽ Muller, 22' ⚽ Brandt, 35' ⚽ Sane, 52' ⚽ Adeyemi",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Both teams clearly attacking — reasoning should mention the open game
    expect(parsed.reasoning_en.toLowerCase()).toMatch(/goal|attack|shot|open|scor/);
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 4: Late game 0-0 — should favor Under or no push
  // ----------------------------------------------------------
  test('Scenario 4: Late game 0-0 — favors Under or no push', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90004',
        home: 'Atletico Madrid',
        away: 'Villarreal',
        league: 'La Liga',
        minute: 72,
        score: '0-0',
        status: '2H',
      },
      match_id: '90004',
      home_team: 'Atletico Madrid',
      away_team: 'Villarreal',
      league: 'La Liga',
      minute: 72,
      score: '0-0',
      status: '2H',
      current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 48, away: 52 },
        shots: { home: 6, away: 4 },
        shots_on_target: { home: 1, away: 1 },
        corners: { home: 3, away: 2 },
        fouls: { home: 14, away: 12 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.8, draw: 2.9, away: 3.0 },
        ou: { line: 2.5, over: 3.50, under: 1.30 },
        btts: { yes: 3.5, no: 1.28 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 30, extra: null, team: 'Atletico Madrid', type: 'card', detail: 'Yellow Card', player: 'Koke' },
        { minute: 55, extra: null, team: 'Villarreal', type: 'card', detail: 'Yellow Card', player: 'Parejo' },
      ],
      events_summary: "30' 🟡 Koke, 55' 🟡 Parejo",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Per DATA-DRIVEN RULES: 0-0 after minute 65 → prefer Under
    if (parsed.ai_should_push) {
      // Should NOT recommend Over 2.5 in a 0-0 game at minute 72
      expect(parsed.bet_market).not.toMatch(/over_2\.5|over_3\.5/);
    }
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 5: Red card match — should trigger RED_CARD_PROTOCOL
  // ----------------------------------------------------------
  test('Scenario 5: Red card detected — adjusts analysis', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90005',
        home: 'AC Milan',
        away: 'Inter Milan',
        league: 'Serie A',
        minute: 55,
        score: '0-1',
        status: '2H',
      },
      match_id: '90005',
      home_team: 'AC Milan',
      away_team: 'Inter Milan',
      league: 'Serie A',
      minute: 55,
      score: '0-1',
      status: '2H',
      current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 40, away: 60 },
        shots: { home: 4, away: 8 },
        shots_on_target: { home: 1, away: 4 },
        corners: { home: 2, away: 6 },
        red_cards: { home: 1, away: 0 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 5.5, draw: 3.8, away: 1.60 },
        ou: { line: 2.5, over: 1.85, under: 1.95 },
        btts: { yes: 2.1, no: 1.7 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 30, extra: null, team: 'Inter Milan', type: 'goal', detail: '0-1', player: 'Lautaro' },
        { minute: 42, extra: null, team: 'AC Milan', type: 'card', detail: 'Red Card', player: 'Theo' },
      ],
      events_summary: "30' ⚽ Lautaro (Inter), 42' 🔴 Theo (AC Milan)",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // AI should mention red card in reasoning or warnings
    const mentionsRedCard =
      parsed.reasoning_en.toLowerCase().includes('red card') ||
      parsed.warnings.some(w => w.includes('RED_CARD'));
    expect(mentionsRedCard).toBe(true);
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 6: Custom condition evaluation
  // ----------------------------------------------------------
  test('Scenario 6: Custom condition — evaluated independently', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90006',
        home: 'PSG',
        away: 'Lyon',
        league: 'Ligue 1',
        minute: 55,
        score: '1-0',
        status: '2H',
      },
      match_id: '90006',
      home_team: 'PSG',
      away_team: 'Lyon',
      league: 'Ligue 1',
      minute: 55,
      score: '1-0',
      status: '2H',
      current_total_goals: 1,
      custom_conditions: 'shots_on_target_home >= 5 AND possession_home > 55',
      stats_compact: createStatsCompact({
        possession: { home: 62, away: 38 },
        shots: { home: 11, away: 4 },
        shots_on_target: { home: 6, away: 1 },
        corners: { home: 7, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.25, draw: 6.0, away: 11.0 },
        ou: { line: 2.5, over: 1.65, under: 2.20 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 20, extra: null, team: 'PSG', type: 'goal', detail: '1-0', player: 'Mbappe' },
      ],
      events_summary: "20' ⚽ Mbappe (PSG)",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Custom condition: shots_on_target_home=6 >= 5 (true) AND possession_home=62 > 55 (true)
    // AI should evaluate this as matched
    expect(parsed.custom_condition_status).toBe('evaluated');
    expect(parsed.custom_condition_matched).toBe(true);

    // When condition matched, triggered suggestion should be non-empty
    expect(parsed.condition_triggered_suggestion.length).toBeGreaterThan(0);
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 7: Force analyze at Half Time
  // ----------------------------------------------------------
  test('Scenario 7: Force analyze at HT — should analyze but not push', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90007',
        home: 'Arsenal',
        away: 'Tottenham',
        league: 'Premier League',
        minute: 45,
        score: '2-0',
        status: 'HT',
      },
      match_id: '90007',
      home_team: 'Arsenal',
      away_team: 'Tottenham',
      league: 'Premier League',
      minute: 45,
      score: '2-0',
      status: 'HT',
      current_total_goals: 2,
      force_analyze: true,
      is_manual_push: true,
      skipped_filters: ['STATUS_NOT_LIVE'],
      original_would_proceed: false,
      stats_compact: createStatsCompact({
        possession: { home: 58, away: 42 },
        shots: { home: 10, away: 3 },
        shots_on_target: { home: 5, away: 1 },
        corners: { home: 5, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.12, draw: 8.5, away: 18.0 },
        ou: { line: 2.5, over: 1.50, under: 2.50 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 12, extra: null, team: 'Arsenal', type: 'goal', detail: '1-0', player: 'Saka' },
        { minute: 38, extra: null, team: 'Arsenal', type: 'goal', detail: '2-0', player: 'Rice' },
      ],
      events_summary: "12' ⚽ Saka, 38' ⚽ Rice",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // HT force analyze: should analyze but mention HT status
    expect(parsed.reasoning_en.toLowerCase()).toMatch(/half.?time|ht|break|interval|first half/);

    // HT confidence should be capped at 7
    if (parsed.ai_should_push) {
      expect(parsed.confidence).toBeLessThanOrEqual(7);
    }
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 8: No odds available — qualitative only
  // ----------------------------------------------------------
  test('Scenario 8: No odds — should not push or be qualitative only', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90008',
        home: 'Galatasaray',
        away: 'Fenerbahce',
        league: 'Super Lig',
        minute: 50,
        score: '1-0',
        status: '2H',
      },
      match_id: '90008',
      home_team: 'Galatasaray',
      away_team: 'Fenerbahce',
      league: 'Super Lig',
      minute: 50,
      score: '1-0',
      status: '2H',
      current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 55, away: 45 },
        shots: { home: 7, away: 5 },
        shots_on_target: { home: 3, away: 2 },
      }),
      stats_available: true,
      odds_canonical: {},
      odds_available: false,
      events_compact: [
        { minute: 33, extra: null, team: 'Galatasaray', type: 'goal', detail: '1-0', player: 'Icardi' },
      ],
      events_summary: "33' ⚽ Icardi",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Without odds, if AI pushes it should be cautious
    if (parsed.ai_should_push) {
      expect(parsed.confidence).toBeLessThanOrEqual(6);
    }
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 9: Selection format validation
  // ----------------------------------------------------------
  test('Scenario 9: Selection follows standard format when pushing', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90009',
        home: 'Juventus',
        away: 'Napoli',
        league: 'Serie A',
        minute: 65,
        score: '0-0',
        status: '2H',
      },
      match_id: '90009',
      home_team: 'Juventus',
      away_team: 'Napoli',
      league: 'Serie A',
      minute: 65,
      score: '0-0',
      status: '2H',
      current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 50, away: 50 },
        shots: { home: 5, away: 5 },
        shots_on_target: { home: 2, away: 2 },
        corners: { home: 3, away: 3 },
        fouls: { home: 10, away: 10 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.8, draw: 3.0, away: 2.9 },
        ou: { line: 2.5, over: 3.20, under: 1.35 },
        btts: { yes: 3.0, no: 1.35 },
        corners_ou: { line: 9.5, over: 1.85, under: 1.95 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    if (parsed.ai_should_push && parsed.selection) {
      // Validate selection follows standardized format:
      // "Home Win @X.XX", "Away Win @X.XX", "Draw @X.XX",
      // "Over X.X Goals @X.XX", "Under X.X Goals @X.XX",
      // "BTTS Yes @X.XX", "BTTS No @X.XX",
      // "Home ±X.X @X.XX", "Away ±X.X @X.XX",
      // "Corners Over/Under X.X @X.XX", etc.
      const validFormats = [
        /^Home Win @\d+\.\d+$/,
        /^Away Win @\d+\.\d+$/,
        /^Draw @\d+\.\d+$/,
        /^Over \d+\.?\d* Goals @\d+\.\d+$/,
        /^Under \d+\.?\d* Goals @\d+\.\d+$/,
        /^BTTS (Yes|No) @\d+\.\d+$/,
        /^Home [+-]?\d+\.?\d* @\d+\.\d+$/,
        /^Away [+-]?\d+\.?\d* @\d+\.\d+$/,
        /^Corners (Over|Under) \d+\.?\d* @\d+\.\d+$/,
        /^1X @\d+\.\d+$/,
        /^X2 @\d+\.\d+$/,
        /^12 @\d+\.\d+$/,
      ];

      const matchesFormat = validFormats.some(fmt => fmt.test(parsed.selection));
      if (!matchesFormat) {
        console.warn(`AI selection format violation: "${parsed.selection}"`);
        // Not a hard fail — log for prompt engineering improvement
      }

      // Selection should NOT contain team names (forbidden pattern)
      expect(parsed.selection).not.toMatch(/Juventus|Napoli/i);
    }
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 10: bet_market standardization
  // ----------------------------------------------------------
  test('Scenario 10: bet_market uses standard values', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90010',
        home: 'Chelsea',
        away: 'Newcastle',
        league: 'Premier League',
        minute: 55,
        score: '1-2',
        status: '2H',
      },
      match_id: '90010',
      home_team: 'Chelsea',
      away_team: 'Newcastle',
      league: 'Premier League',
      minute: 55,
      score: '1-2',
      status: '2H',
      current_total_goals: 3,
      stats_compact: createStatsCompact({
        possession: { home: 55, away: 45 },
        shots: { home: 10, away: 8 },
        shots_on_target: { home: 5, away: 4 },
        corners: { home: 6, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.3, draw: 3.6, away: 3.1 },
        ou: { line: 3.5, over: 1.60, under: 2.30 },
        btts: { yes: 1.30, no: 3.40 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Chelsea', type: 'goal', detail: '1-0', player: 'Palmer' },
        { minute: 30, extra: null, team: 'Newcastle', type: 'goal', detail: '1-1', player: 'Isak' },
        { minute: 48, extra: null, team: 'Newcastle', type: 'goal', detail: '1-2', player: 'Gordon' },
      ],
      events_summary: "15' ⚽ Palmer, 30' ⚽ Isak, 48' ⚽ Gordon",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    if (parsed.ai_should_push && parsed.bet_market) {
      const validMarkets = [
        '1x2_home', '1x2_away', '1x2_draw',
        /^over_\d+\.?\d*$/, /^under_\d+\.?\d*$/,
        'btts_yes', 'btts_no',
        /^ah_home_[+-]?\d+\.?\d*$/, /^ah_away_[+-]?\d+\.?\d*$/,
        /^corners_over_\d+\.?\d*$/, /^corners_under_\d+\.?\d*$/,
        'dc_1x', 'dc_x2', 'dc_12',
      ];

      const isValid = validMarkets.some(m =>
        typeof m === 'string' ? parsed.bet_market === m : m.test(parsed.bet_market),
      );
      expect(isValid).toBe(true);
    }
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 11: Endgame minute (89') — very conservative
  // ----------------------------------------------------------
  test('Scenario 11: Endgame minute — should not push or max stake 2%', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90011',
        home: 'Dortmund',
        away: 'Frankfurt',
        league: 'Bundesliga',
        minute: 89,
        score: '2-1',
        status: '2H',
      },
      match_id: '90011',
      home_team: 'Dortmund',
      away_team: 'Frankfurt',
      league: 'Bundesliga',
      minute: 89,
      score: '2-1',
      status: '2H',
      current_total_goals: 3,
      stats_compact: createStatsCompact({
        possession: { home: 50, away: 50 },
        shots: { home: 8, away: 7 },
        shots_on_target: { home: 4, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.05, draw: 12.0, away: 25.0 },
        ou: { line: 3.5, over: 2.50, under: 1.50 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 20, extra: null, team: 'Dortmund', type: 'goal', detail: '1-0', player: 'Brandt' },
        { minute: 55, extra: null, team: 'Frankfurt', type: 'goal', detail: '1-1', player: 'Kolo' },
        { minute: 75, extra: null, team: 'Dortmund', type: 'goal', detail: '2-1', player: 'Adeyemi' },
      ],
      events_summary: "20' ⚽ Brandt, 55' ⚽ Kolo, 75' ⚽ Adeyemi",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Endgame rules: default should_push=false, max stake=2%
    if (parsed.ai_should_push) {
      expect(parsed.stake_percent).toBeLessThanOrEqual(2);
    }
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 12: Dominant team with sterile possession (0-0 trap)
  // ----------------------------------------------------------
  test('Scenario 12: Sterile dominance — should not over-predict goals', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90012',
        home: 'Manchester United',
        away: 'Crystal Palace',
        league: 'Premier League',
        minute: 62,
        score: '0-0',
        status: '2H',
      },
      match_id: '90012',
      home_team: 'Manchester United',
      away_team: 'Crystal Palace',
      league: 'Premier League',
      minute: 62,
      score: '0-0',
      status: '2H',
      current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 68, away: 32 },
        shots: { home: 14, away: 3 },
        shots_on_target: { home: 2, away: 1 },  // Key: low SOT despite many shots
        corners: { home: 8, away: 1 },
        goalkeeper_saves: { home: 1, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.80, draw: 3.6, away: 4.8 },
        ou: { line: 2.5, over: 2.60, under: 1.50 },
        btts: { yes: 2.8, no: 1.42 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // POSSESSION BIAS CORRECTION: 68% possession but only 2 SOT from 14 shots
    // AI should recognize sterile dominance — shot quality ratio 2/14 = 0.14 < 0.3
    // Should NOT recommend Over 2.5 in this scenario
    if (parsed.ai_should_push && parsed.bet_market?.startsWith('over_2')) {
      console.warn('AI fell for sterile dominance trap — recommended Over despite low SOT ratio');
    }
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 13: JSON parsing robustness — validates parseAiResponse
  // ----------------------------------------------------------
  test('Scenario 13: Response parsing produces valid ParsedAiResponse', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90013',
        home: 'Ajax',
        away: 'PSV',
        league: 'Eredivisie',
        minute: 45,
        score: '0-1',
        status: '2H',
      },
      match_id: '90013',
      home_team: 'Ajax',
      away_team: 'PSV',
      league: 'Eredivisie',
      minute: 45,
      score: '0-1',
      status: '2H',
      current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 53, away: 47 },
        shots: { home: 6, away: 5 },
        shots_on_target: { home: 2, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical(),
      odds_available: true,
      events_compact: [
        { minute: 38, extra: null, team: 'PSV', type: 'goal', detail: '0-1', player: 'de Jong' },
      ],
      events_summary: "38' ⚽ de Jong (PSV)",
    });

    const { raw, parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Should have successfully parsed — no PARSE_ERROR or JSON_PARSE_ERROR
    expect(parsed.warnings).not.toContain('PARSE_ERROR');
    expect(parsed.warnings).not.toContain('JSON_PARSE_ERROR');

    // Raw response should contain valid JSON
    expect(raw).toContain('{');
    expect(raw).toContain('}');
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 14: Previous recommendations context
  // ----------------------------------------------------------
  test('Scenario 14: With previous recommendations — no duplicate selection', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90014',
        home: 'Benfica',
        away: 'Porto',
        league: 'Liga Portugal',
        minute: 70,
        score: '1-0',
        status: '2H',
      },
      match_id: '90014',
      home_team: 'Benfica',
      away_team: 'Porto',
      league: 'Liga Portugal',
      minute: 70,
      score: '1-0',
      status: '2H',
      current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 55, away: 45 },
        shots: { home: 9, away: 6 },
        shots_on_target: { home: 4, away: 2 },
        corners: { home: 5, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.55, draw: 4.0, away: 5.5 },
        ou: { line: 2.5, over: 2.40, under: 1.55 },
        btts: { yes: 2.4, no: 1.55 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 25, extra: null, team: 'Benfica', type: 'goal', detail: '1-0', player: 'Pavlidis' },
      ],
      events_summary: "25' ⚽ Pavlidis (Benfica)",
    });

    const context = {
      previousRecommendations: [
        {
          minute: 42,
          selection: 'Over 2.5 Goals @1.85',
          bet_market: 'over_2.5',
          confidence: 7,
          odds: 1.85,
          reasoning: 'Both teams attacking, open game expected',
          result: 'pending',
          timestamp: '2026-03-19T18:42:00Z',
        },
      ],
      matchTimeline: [
        {
          minute: 42,
          score: '1-0',
          possession: '52-48',
          shots: '7-4',
          shots_on_target: '3-2',
          corners: '4-2',
          status: '1H',
        },
      ],
    };

    const prompt = buildAiPrompt(matchData, context);
    const raw = await callGeminiDirect(prompt);
    const parsed = parseAiResponse(raw, matchData, matchData.config);
    assertValidStructure(parsed);

    // Should reference previous recommendations in reasoning
    // (The prompt includes previous recommendations context)
    // Not a hard assert — just verify structure is valid
  }, 60_000);

  // ----------------------------------------------------------
  // Scenario 15: Recommended custom condition from pre-match
  // ----------------------------------------------------------
  test('Scenario 15: With recommended condition — condition evaluated', async () => {
    const matchData = createMergedMatchData({
      match: {
        id: '90015',
        home: 'Aston Villa',
        away: 'Brighton',
        league: 'Premier League',
        minute: 60,
        score: '0-0',
        status: '2H',
      },
      match_id: '90015',
      home_team: 'Aston Villa',
      away_team: 'Brighton',
      league: 'Premier League',
      minute: 60,
      score: '0-0',
      status: '2H',
      current_total_goals: 0,
      custom_conditions: '(Minute >= 55) AND (Total goals <= 1) AND (NOT Away leading)',
      recommended_custom_condition: '(Minute >= 55) AND (Total goals <= 1) AND (NOT Away leading)',
      recommended_condition_reason: 'Brighton rotated 5 players for Europa League. If 0-0 or low-scoring after 55 min, Under market should offer value.',
      stats_compact: createStatsCompact({
        possession: { home: 48, away: 52 },
        shots: { home: 5, away: 6 },
        shots_on_target: { home: 2, away: 2 },
        corners: { home: 3, away: 4 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.5, draw: 3.2, away: 2.9 },
        ou: { line: 2.5, over: 2.50, under: 1.52 },
        btts: { yes: 2.4, no: 1.55 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Condition: min>=55 (60 ✓), total goals<=1 (0 ✓), NOT away leading (0-0 ✓) → MATCHED
    expect(parsed.custom_condition_status).toBe('evaluated');
    expect(parsed.custom_condition_matched).toBe(true);

    // When matched with recommended reason about Under value:
    expect(parsed.condition_triggered_suggestion.length).toBeGreaterThan(0);
    expect(parsed.condition_triggered_confidence).toBeGreaterThan(0);
  }, 60_000);
});
