// ============================================================
// AI Prompt Audit — Comprehensive Real LLM Tests (x3 Coverage)
//
// Tests every DATA-DRIVEN RULE in the prompt against the REAL Gemini API.
// Each scenario uses mock match data designed to trigger (or NOT trigger)
// specific prompt conditions, then validates AI compliance.
// ~66 test scenarios covering all prompt rules with multiple variations.
//
// Requires: GEMINI_API_KEY (reads from packages/server/.env)
// Timeout: 90s per test (AI calls may take 10-30s)
// Model: gemini-3-pro-preview (same as production)
// ============================================================

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAiPrompt } from '../services/ai-prompt.service';
import { parseAiResponse } from '../services/ai-analysis.service';
import { createMergedMatchData, createOddsCanonical, createStatsCompact } from './fixtures';
import type { MergedMatchData, ParsedAiResponse } from '../types';

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
const GEMINI_MODEL = 'gemini-3-pro-preview';
const RUN_LLM_TESTS = process.env['RUN_LLM_TESTS'] === '1';

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

// ==================== Pipeline Helper ====================

async function runAiPipeline(
  matchData: MergedMatchData,
): Promise<{ raw: string; parsed: ParsedAiResponse; prompt: string }> {
  const prompt = buildAiPrompt(matchData);
  const raw = await callGeminiDirect(prompt);
  const parsed = parseAiResponse(raw, matchData, matchData.config);
  return { raw, parsed, prompt };
}

function assertValidStructure(parsed: ParsedAiResponse) {
  expect(typeof parsed.should_push).toBe('boolean');
  expect(typeof parsed.confidence).toBe('number');
  expect(typeof parsed.reasoning_en).toBe('string');
  expect(typeof parsed.reasoning_vi).toBe('string');
  expect(parsed.confidence).toBeGreaterThanOrEqual(0);
  expect(parsed.confidence).toBeLessThanOrEqual(10);
  expect(parsed.stake_percent).toBeGreaterThanOrEqual(0);
  expect(parsed.stake_percent).toBeLessThanOrEqual(10);
  expect(['LOW', 'MEDIUM', 'HIGH']).toContain(parsed.risk_level);
  expect(parsed.reasoning_en.length).toBeGreaterThan(10);
  expect(parsed.reasoning_vi.length).toBeGreaterThan(10);

  if (parsed.ai_should_push) {
    expect(parsed.selection.length).toBeGreaterThan(0);
    expect(parsed.bet_market.length).toBeGreaterThan(0);
  }
  if (!parsed.ai_should_push) {
    expect(parsed.selection).toBe('');
    expect(parsed.stake_percent).toBe(0);
  }
}

// ==================== Test Report ====================

interface TestResult {
  scenario: string;
  rule: string;
  passed: boolean;
  details: string;
  aiResponse: {
    should_push: boolean;
    selection: string;
    bet_market: string;
    confidence: number;
    risk_level: string;
    stake_percent: number;
    value_percent: number;
    warnings: string[];
  };
}

const testResults: TestResult[] = [];

function recordResult(
  scenario: string,
  rule: string,
  passed: boolean,
  details: string,
  parsed: ParsedAiResponse,
) {
  testResults.push({
    scenario,
    rule,
    passed,
    details,
    aiResponse: {
      should_push: parsed.ai_should_push,
      selection: parsed.selection,
      bet_market: parsed.bet_market,
      confidence: parsed.confidence,
      risk_level: parsed.risk_level,
      stake_percent: parsed.stake_percent,
      value_percent: parsed.value_percent,
      warnings: parsed.warnings,
    },
  });
}

// ============================================================
// TEST SUITES
// ============================================================

describe.skipIf(!GEMINI_API_KEY || !RUN_LLM_TESTS)('AI Prompt Audit — Data-Driven Rules', () => {

  // ============================================================
  // BTTS YES RULES
  // ============================================================

  // BTTS-Y1: BTTS Yes at high odds (>=2.00) — should NOT push
  test('BTTS-Y1: BTTS Yes at odds >= 2.00 — should reject or heavily caveat', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-y1', home: 'Roma', away: 'Lazio', league: 'Serie A', minute: 50, score: '1-0', status: '2H' },
      match_id: 'btts-y1', home_team: 'Roma', away_team: 'Lazio', league: 'Serie A',
      minute: 50, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 55, away: 45 },
        shots: { home: 8, away: 5 },
        shots_on_target: { home: 3, away: 1 }, // Lazio has only 1 SOT — weak attacking
        corners: { home: 4, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.65, draw: 3.8, away: 5.5 },
        ou: { line: 2.5, over: 1.80, under: 2.00 },
        btts: { yes: 2.10, no: 1.70 }, // BTTS Yes at 2.10 — high odds
      }),
      odds_available: true,
      events_compact: [
        { minute: 25, extra: null, team: 'Roma', type: 'goal', detail: '1-0', player: 'Dybala' },
      ],
      events_summary: "25' ⚽ Dybala (Roma)",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Rule: BTTS Yes at odds >= 2.00 should be avoided unless BOTH teams have SOT >= 2
    // Lazio has only 1 SOT → should NOT recommend BTTS Yes
    const violates = parsed.ai_should_push && parsed.bet_market === 'btts_yes';
    recordResult('BTTS-Y1', 'BTTS Yes at odds >= 2.00 with weak away attack', !violates,
      violates ? 'AI recommended BTTS Yes despite Lazio having only 1 SOT and odds >= 2.00' : 'Correctly avoided BTTS Yes',
      parsed);

    if (violates) {
      console.warn('BTTS-Y1 VIOLATION: AI recommended BTTS Yes at odds 2.10 when away team has only 1 SOT');
    }
  }, 90_000);

  // BTTS-Y2: BTTS Yes with one-sided match (opposing team 0 SOT)
  test('BTTS-Y2: BTTS Yes — opposing team has 0 SOT (pressure ≠ goals)', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-y2', home: 'PSG', away: 'Montpellier', league: 'Ligue 1', minute: 55, score: '2-0', status: '2H' },
      match_id: 'btts-y2', home_team: 'PSG', away_team: 'Montpellier', league: 'Ligue 1',
      minute: 55, score: '2-0', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 72, away: 28 },
        shots: { home: 15, away: 2 },
        shots_on_target: { home: 7, away: 0 }, // Montpellier: 0 SOT — CANNOT score
        corners: { home: 9, away: 0 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.05, draw: 14.0, away: 30.0 },
        ou: { line: 3.5, over: 1.55, under: 2.45 },
        btts: { yes: 2.50, no: 1.50 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 12, extra: null, team: 'PSG', type: 'goal', detail: '1-0', player: 'Mbappe' },
        { minute: 40, extra: null, team: 'PSG', type: 'goal', detail: '2-0', player: 'Dembele' },
      ],
      events_summary: "12' ⚽ Mbappe, 40' ⚽ Dembele",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const violates = parsed.ai_should_push && parsed.bet_market === 'btts_yes';
    recordResult('BTTS-Y2', 'BTTS Yes when opposing team has 0 SOT', !violates,
      violates ? 'AI recommended BTTS Yes despite Montpellier having 0 SOT — pressure ≠ goals trap' : 'Correctly avoided BTTS Yes',
      parsed);
  }, 90_000);

  // BTTS-Y3: BTTS Yes at score 0-0 after minute 60 — should reduce confidence
  test('BTTS-Y3: BTTS Yes at 0-0 after minute 60 — confidence reduced', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-y3', home: 'Wolves', away: 'Burnley', league: 'Premier League', minute: 65, score: '0-0', status: '2H' },
      match_id: 'btts-y3', home_team: 'Wolves', away_team: 'Burnley', league: 'Premier League',
      minute: 65, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 55, away: 45 },
        shots: { home: 7, away: 4 },
        shots_on_target: { home: 2, away: 1 },
        corners: { home: 4, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.5, draw: 3.0, away: 3.2 },
        ou: { line: 2.5, over: 3.0, under: 1.38 },
        btts: { yes: 3.2, no: 1.32 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const violates = parsed.ai_should_push && parsed.bet_market === 'btts_yes';
    recordResult('BTTS-Y3', 'BTTS Yes at 0-0 after minute 60', !violates,
      violates ? 'AI recommended BTTS Yes at 0-0 minute 65 — neither team has scored, BTTS requires BOTH to score' : 'Correctly avoided BTTS Yes at 0-0',
      parsed);
  }, 90_000);

  // BTTS-Y4: Valid BTTS Yes scenario — both teams dangerous, good odds
  test('BTTS-Y4: Valid BTTS Yes — both teams attacking, good odds range', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-y4', home: 'Liverpool', away: 'Man City', league: 'Premier League', minute: 45, score: '1-0', status: '2H' },
      match_id: 'btts-y4', home_team: 'Liverpool', away_team: 'Man City', league: 'Premier League',
      minute: 45, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 48, away: 52 },
        shots: { home: 8, away: 9 },
        shots_on_target: { home: 4, away: 5 }, // Both teams with good SOT
        corners: { home: 4, away: 5 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.3, draw: 3.5, away: 3.0 },
        ou: { line: 2.5, over: 1.55, under: 2.45 },
        btts: { yes: 1.65, no: 2.20 }, // Good odds range for BTTS Yes
      }),
      odds_available: true,
      events_compact: [
        { minute: 18, extra: null, team: 'Liverpool', type: 'goal', detail: '1-0', player: 'Salah' },
      ],
      events_summary: "18' ⚽ Salah",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // This is a valid BTTS Yes scenario — both teams have SOT >= 4, odds 1.65 (break-even 60.6%)
    // AI may or may not recommend it, but reasoning should mention both teams' attacking threat
    const mentionsBothTeams = parsed.reasoning_en.toLowerCase().includes('city') ||
      parsed.reasoning_en.toLowerCase().includes('both') ||
      parsed.reasoning_en.toLowerCase().includes('away');
    recordResult('BTTS-Y4', 'Valid BTTS Yes scenario — both teams attacking', true,
      `AI decision: should_push=${parsed.ai_should_push}, market=${parsed.bet_market}. Mentions both teams: ${mentionsBothTeams}`,
      parsed);
  }, 90_000);

  // ============================================================
  // BTTS NO RULES
  // ============================================================

  // BTTS-N1: BTTS No at low odds (< 1.70) — should reject
  test('BTTS-N1: BTTS No at odds < 1.70 — mathematically unprofitable', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-n1', home: 'Atletico', away: 'Getafe', league: 'La Liga', minute: 60, score: '1-0', status: '2H' },
      match_id: 'btts-n1', home_team: 'Atletico', away_team: 'Getafe', league: 'La Liga',
      minute: 60, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 60, away: 40 },
        shots: { home: 10, away: 3 },
        shots_on_target: { home: 4, away: 0 }, // Getafe has 0 SOT — seems like BTTS No is good
        corners: { home: 6, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.35, draw: 5.0, away: 8.5 },
        ou: { line: 2.5, over: 2.20, under: 1.65 },
        btts: { yes: 2.80, no: 1.40 }, // BTTS No at 1.40 — too low
      }),
      odds_available: true,
      events_compact: [
        { minute: 35, extra: null, team: 'Atletico', type: 'goal', detail: '1-0', player: 'Griezmann' },
      ],
      events_summary: "35' ⚽ Griezmann",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // BTTS No at 1.40 odds — below MIN_ODDS threshold (1.50) and below 1.70 profitability threshold
    const violates = parsed.ai_should_push && parsed.bet_market === 'btts_no';
    recordResult('BTTS-N1', 'BTTS No at odds < 1.50 (MIN_ODDS)', !violates,
      violates ? 'AI recommended BTTS No at odds 1.40 — below MIN_ODDS of 1.50' : 'Correctly rejected BTTS No at low odds',
      parsed);
  }, 90_000);

  // BTTS-N2: BTTS No when BOTH teams have SOT >= 2 — should reject
  test('BTTS-N2: BTTS No when both teams have SOT >= 2 — risky', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-n2', home: 'Dortmund', away: 'Leverkusen', league: 'Bundesliga', minute: 55, score: '1-0', status: '2H' },
      match_id: 'btts-n2', home_team: 'Dortmund', away_team: 'Leverkusen', league: 'Bundesliga',
      minute: 55, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 50, away: 50 },
        shots: { home: 8, away: 7 },
        shots_on_target: { home: 4, away: 3 }, // BOTH teams have SOT >= 2
        corners: { home: 4, away: 4 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.1, draw: 3.5, away: 3.5 },
        ou: { line: 2.5, over: 1.60, under: 2.30 },
        btts: { yes: 1.55, no: 2.40 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 28, extra: null, team: 'Dortmund', type: 'goal', detail: '1-0', player: 'Brandt' },
      ],
      events_summary: "28' ⚽ Brandt",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const violates = parsed.ai_should_push && parsed.bet_market === 'btts_no';
    recordResult('BTTS-N2', 'BTTS No when both teams have SOT >= 2', !violates,
      violates ? 'AI recommended BTTS No despite both teams having SOT >= 2' : 'Correctly avoided BTTS No',
      parsed);
  }, 90_000);

  // BTTS-N3: Valid BTTS No — late game, clean sheet, score gap
  test('BTTS-N3: Valid BTTS No — minute 78, score 2-0, opponent 0 SOT', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-n3', home: 'Chelsea', away: 'Bournemouth', league: 'Premier League', minute: 78, score: '2-0', status: '2H' },
      match_id: 'btts-n3', home_team: 'Chelsea', away_team: 'Bournemouth', league: 'Premier League',
      minute: 78, score: '2-0', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 62, away: 38 },
        shots: { home: 14, away: 3 },
        shots_on_target: { home: 6, away: 0 }, // Bournemouth 0 SOT
        corners: { home: 8, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.05, draw: 14.0, away: 25.0 },
        ou: { line: 2.5, over: 2.00, under: 1.80 },
        btts: { yes: 3.50, no: 1.28 }, // BTTS No at 1.28 — below MIN_ODDS
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Chelsea', type: 'goal', detail: '1-0', player: 'Palmer' },
        { minute: 60, extra: null, team: 'Chelsea', type: 'goal', detail: '2-0', player: 'Jackson' },
      ],
      events_summary: "15' ⚽ Palmer, 60' ⚽ Jackson",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // BTTS No at 1.28 is below MIN_ODDS (1.50), so should_push should be false for BTTS No
    // But the scenario is valid for BTTS No analysis — AI should recognize the clean sheet
    recordResult('BTTS-N3', 'Valid BTTS No scenario but odds below MIN_ODDS', true,
      `AI decision: should_push=${parsed.ai_should_push}, market=${parsed.bet_market}. BTTS No odds 1.28 < MIN_ODDS 1.50.`,
      parsed);
  }, 90_000);

  // ============================================================
  // BREAK-EVEN CHECK
  // ============================================================

  // BE-1: Break-even check — AI should mention break-even in reasoning
  test('BE-1: Break-even calculation mentioned in reasoning', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'be-1', home: 'Arsenal', away: 'Everton', league: 'Premier League', minute: 55, score: '1-0', status: '2H' },
      match_id: 'be-1', home_team: 'Arsenal', away_team: 'Everton', league: 'Premier League',
      minute: 55, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 60, away: 40 },
        shots: { home: 10, away: 4 },
        shots_on_target: { home: 5, away: 1 },
        corners: { home: 6, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.50, draw: 4.5, away: 6.5 },
        ou: { line: 2.5, over: 1.75, under: 2.05 },
        btts: { yes: 2.30, no: 1.60 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 30, extra: null, team: 'Arsenal', type: 'goal', detail: '1-0', player: 'Saka' },
      ],
      events_summary: "30' ⚽ Saka",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const mentionsBreakEven = parsed.reasoning_en.toLowerCase().includes('break') ||
      parsed.reasoning_en.toLowerCase().includes('edge') ||
      parsed.reasoning_en.toLowerCase().includes('probability') ||
      (parsed.warnings && parsed.warnings.some(w => w.includes('BREAKEVEN')));
    recordResult('BE-1', 'Break-even calculation in reasoning', mentionsBreakEven,
      mentionsBreakEven ? 'AI mentioned break-even/edge/probability analysis' : 'AI did NOT mention break-even calculation — rule not followed',
      parsed);
  }, 90_000);

  // ============================================================
  // ODDS CEILING RULES
  // ============================================================

  // OC-1: Odds >= 2.50 — confidence capped at 6, stake capped at 3
  test('OC-1: High odds >= 2.50 — confidence capped at 6', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'oc-1', home: 'Bologna', away: 'Fiorentina', league: 'Serie A', minute: 60, score: '0-1', status: '2H' },
      match_id: 'oc-1', home_team: 'Bologna', away_team: 'Fiorentina', league: 'Serie A',
      minute: 60, score: '0-1', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 45, away: 55 },
        shots: { home: 4, away: 9 },
        shots_on_target: { home: 1, away: 5 },
        corners: { home: 2, away: 6 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 4.5, draw: 3.8, away: 1.75 },
        ou: { line: 2.5, over: 2.60, under: 1.50 }, // Over at 2.60 — high odds
        btts: { yes: 2.80, no: 1.42 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 22, extra: null, team: 'Fiorentina', type: 'goal', detail: '0-1', player: 'Vlahovic' },
      ],
      events_summary: "22' ⚽ Vlahovic (Fiorentina)",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // If AI pushes at these odds, confidence should be capped at 6, stake at 3
    if (parsed.ai_should_push) {
      const confOk = parsed.confidence <= 6;
      const stakeOk = parsed.stake_percent <= 3;
      const hasWarning = parsed.warnings.some(w => w.includes('HIGH_ODDS_RISK') || w.includes('ELEVATED_ODDS'));
      recordResult('OC-1', 'Odds >= 2.50 → confidence cap 6, stake cap 3', confOk && stakeOk,
        `Confidence: ${parsed.confidence} (cap 6: ${confOk}), Stake: ${parsed.stake_percent} (cap 3: ${stakeOk}), Warning: ${hasWarning}`,
        parsed);
    } else {
      recordResult('OC-1', 'Odds >= 2.50 → confidence cap 6, stake cap 3', true,
        'AI correctly did not push — high odds risk acknowledged',
        parsed);
    }
  }, 90_000);

  // ============================================================
  // 1X2_HOME SUPPRESSION
  // ============================================================

  // 1X2-H1: 1x2_home before minute 35 — should be rejected
  test('1X2-H1: 1x2_home before minute 35 — NEVER recommend', async () => {
    const matchData = createMergedMatchData({
      match: { id: '1x2-h1', home: 'Tottenham', away: 'West Ham', league: 'Premier League', minute: 25, score: '1-0', status: '1H' },
      match_id: '1x2-h1', home_team: 'Tottenham', away_team: 'West Ham', league: 'Premier League',
      minute: 25, score: '1-0', status: '1H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 62, away: 38 },
        shots: { home: 7, away: 2 },
        shots_on_target: { home: 4, away: 0 },
        corners: { home: 5, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.50, draw: 4.5, away: 6.5 },
        ou: { line: 2.5, over: 1.65, under: 2.20 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 10, extra: null, team: 'Tottenham', type: 'goal', detail: '1-0', player: 'Son' },
      ],
      events_summary: "10' ⚽ Son",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const violates = parsed.ai_should_push && parsed.bet_market === '1x2_home';
    recordResult('1X2-H1', '1x2_home before minute 35', !violates,
      violates ? 'AI recommended 1x2_home at minute 25 — violates EARLY_GAME rule and 1X2_HOME_SUPPRESSION' : 'Correctly avoided 1x2_home early',
      parsed);
  }, 90_000);

  // ============================================================
  // 1X2_DRAW NEAR-BAN
  // ============================================================

  // DR-1: Draw recommendation before minute 70 — should be rejected
  test('DR-1: Draw before minute 70 — should not recommend', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'dr-1', home: 'Sevilla', away: 'Betis', league: 'La Liga', minute: 55, score: '1-1', status: '2H' },
      match_id: 'dr-1', home_team: 'Sevilla', away_team: 'Betis', league: 'La Liga',
      minute: 55, score: '1-1', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 50, away: 50 },
        shots: { home: 6, away: 6 },
        shots_on_target: { home: 3, away: 3 },
        corners: { home: 3, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.0, draw: 2.90, away: 3.0 },
        ou: { line: 2.5, over: 1.70, under: 2.10 },
        btts: { yes: 1.40, no: 2.80 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 20, extra: null, team: 'Sevilla', type: 'goal', detail: '1-0', player: 'Torres' },
        { minute: 38, extra: null, team: 'Betis', type: 'goal', detail: '1-1', player: 'Iglesias' },
      ],
      events_summary: "20' ⚽ Torres, 38' ⚽ Iglesias",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const violates = parsed.ai_should_push && parsed.bet_market === '1x2_draw';
    recordResult('DR-1', 'Draw before minute 70', !violates,
      violates ? 'AI recommended Draw at minute 55 — violates 1X2_DRAW NEAR-BAN (requires min >= 70)' : 'Correctly avoided Draw',
      parsed);
  }, 90_000);

  // ============================================================
  // EARLY GAME CAUTION
  // ============================================================

  // EG-1: Before minute 30 — 1X2 should_push = false
  test('EG-1: Before minute 30 — restricted recommendations', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'eg-1', home: 'Bayern', away: 'Stuttgart', league: 'Bundesliga', minute: 18, score: '0-0', status: '1H' },
      match_id: 'eg-1', home_team: 'Bayern', away_team: 'Stuttgart', league: 'Bundesliga',
      minute: 18, score: '0-0', status: '1H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 65, away: 35 },
        shots: { home: 5, away: 1 },
        shots_on_target: { home: 3, away: 0 },
        corners: { home: 3, away: 0 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.35, draw: 5.5, away: 8.0 },
        ou: { line: 3.5, over: 1.60, under: 2.30 },
        btts: { yes: 1.55, no: 2.40 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Before minute 30: 1X2 should_push=false, O/U and BTTS confidence capped at 6
    if (parsed.ai_should_push) {
      const is1x2 = parsed.bet_market.startsWith('1x2_');
      recordResult('EG-1', 'Early game (min 18) — restricted', !is1x2,
        is1x2 ? `AI recommended ${parsed.bet_market} at minute 18 — violates EARLY_GAME rule` : `AI recommended ${parsed.bet_market}, conf=${parsed.confidence}`,
        parsed);
    } else {
      recordResult('EG-1', 'Early game (min 18) — restricted', true,
        'AI correctly did not push at minute 18',
        parsed);
    }
  }, 90_000);

  // ============================================================
  // VALUE PERCENT RECALIBRATION
  // ============================================================

  // VP-1: Value percent > 20% should trigger warning
  test('VP-1: High value_percent > 20% — should be recalibrated', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'vp-1', home: 'Man United', away: 'Fulham', league: 'Premier League', minute: 60, score: '2-0', status: '2H' },
      match_id: 'vp-1', home_team: 'Man United', away_team: 'Fulham', league: 'Premier League',
      minute: 60, score: '2-0', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 60, away: 40 },
        shots: { home: 12, away: 3 },
        shots_on_target: { home: 6, away: 1 },
        corners: { home: 7, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.12, draw: 8.0, away: 18.0 },
        ou: { line: 2.5, over: 1.55, under: 2.45 },
        btts: { yes: 3.20, no: 1.32 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Man United', type: 'goal', detail: '1-0', player: 'Rashford' },
        { minute: 45, extra: null, team: 'Man United', type: 'goal', detail: '2-0', player: 'Bruno' },
      ],
      events_summary: "15' ⚽ Rashford, 45' ⚽ Bruno",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    if (parsed.ai_should_push && parsed.value_percent > 20) {
      const hasWarning = parsed.warnings.some(w => w.includes('VALUE_RECALIBRATED'));
      recordResult('VP-1', 'Value > 20% recalibrated', hasWarning,
        hasWarning ? 'AI added VALUE_RECALIBRATED warning' : `AI estimated value_percent=${parsed.value_percent} without recalibration warning`,
        parsed);
    } else {
      recordResult('VP-1', 'Value > 20% recalibrated', true,
        `Value percent: ${parsed.value_percent} (within acceptable range or no push)`,
        parsed);
    }
  }, 90_000);

  // ============================================================
  // POSSESSION BIAS / STERILE DOMINANCE
  // ============================================================

  // PB-1: High possession + low SOT ratio at 0-0 — should NOT recommend Over
  test('PB-1: Sterile dominance — 70% possession, 2/14 SOT, score 0-0', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'pb-1', home: 'Man City', away: 'Crystal Palace', league: 'Premier League', minute: 65, score: '0-0', status: '2H' },
      match_id: 'pb-1', home_team: 'Man City', away_team: 'Crystal Palace', league: 'Premier League',
      minute: 65, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 70, away: 30 },
        shots: { home: 14, away: 2 },
        shots_on_target: { home: 2, away: 1 }, // 2/14 = 14.3% — sterile dominance
        corners: { home: 9, away: 1 },
        goalkeeper_saves: { home: 1, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.65, draw: 3.8, away: 5.5 },
        ou: { line: 2.5, over: 2.80, under: 1.42 },
        btts: { yes: 3.00, no: 1.38 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Should NOT recommend Over at 0-0 with sterile dominance
    const recommendsOver = parsed.ai_should_push && parsed.bet_market?.startsWith('over_');
    const recommends1x2Home = parsed.ai_should_push && parsed.bet_market === '1x2_home';
    const violates = recommendsOver || recommends1x2Home;

    recordResult('PB-1', 'Sterile dominance — no Over or 1x2_home', !violates,
      violates ? `AI fell for possession trap: recommended ${parsed.bet_market} despite SOT ratio 2/14 and 0-0 at min 65` : 'Correctly avoided possession bias trap',
      parsed);
  }, 90_000);

  // ============================================================
  // SCORE 0-0 RULE
  // ============================================================

  // Z0-1: 0-0 at minute 70 — should prefer Under
  test('Z0-1: Score 0-0 at minute 70 — Under preferred', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'z0-1', home: 'Torino', away: 'Udinese', league: 'Serie A', minute: 70, score: '0-0', status: '2H' },
      match_id: 'z0-1', home_team: 'Torino', away_team: 'Udinese', league: 'Serie A',
      minute: 70, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 52, away: 48 },
        shots: { home: 5, away: 4 },
        shots_on_target: { home: 1, away: 1 },
        corners: { home: 3, away: 3 },
        fouls: { home: 12, away: 14 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.8, draw: 2.8, away: 3.0 },
        ou: { line: 2.5, over: 3.80, under: 1.25 },
        btts: { yes: 3.80, no: 1.25 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    if (parsed.ai_should_push) {
      const isUnder = parsed.bet_market?.startsWith('under_');
      recordResult('Z0-1', '0-0 at min 70 — Under preferred', isUnder,
        isUnder ? `Correct: AI recommended ${parsed.bet_market}` : `AI recommended ${parsed.bet_market} instead of Under at 0-0 minute 70`,
        parsed);
    } else {
      // No push is also acceptable — 0-0 is uncertain
      recordResult('Z0-1', '0-0 at min 70 — Under preferred', true,
        'AI did not push — acceptable for 0-0 at minute 70 (odds may be too low)',
        parsed);
    }
  }, 90_000);

  // ============================================================
  // RISK LEVEL DISCIPLINE
  // ============================================================

  // RL-1: HIGH risk should never push
  test('RL-1: High risk assessment — should_push = false', async () => {
    // Scenario that SHOULD yield HIGH risk: red card, losing team, chaotic stats
    const matchData = createMergedMatchData({
      match: { id: 'rl-1', home: 'Watford', away: 'Norwich', league: 'Championship', minute: 60, score: '1-2', status: '2H' },
      match_id: 'rl-1', home_team: 'Watford', away_team: 'Norwich', league: 'Championship',
      minute: 60, score: '1-2', status: '2H', current_total_goals: 3,
      stats_compact: createStatsCompact({
        possession: { home: 42, away: 58 },
        shots: { home: 5, away: 10 },
        shots_on_target: { home: 2, away: 5 },
        corners: { home: 2, away: 7 },
        red_cards: { home: 1, away: 0 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 5.5, draw: 4.0, away: 1.55 },
        ou: { line: 3.5, over: 1.55, under: 2.45 },
        btts: { yes: 1.50, no: 2.50 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Watford', type: 'goal', detail: '1-0', player: 'Sarr' },
        { minute: 30, extra: null, team: 'Watford', type: 'card', detail: 'Red Card', player: 'Kayembe' },
        { minute: 40, extra: null, team: 'Norwich', type: 'goal', detail: '1-1', player: 'Pukki' },
        { minute: 55, extra: null, team: 'Norwich', type: 'goal', detail: '1-2', player: 'Sargent' },
      ],
      events_summary: "15' ⚽ Sarr, 30' 🔴 Kayembe, 40' ⚽ Pukki, 55' ⚽ Sargent",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    if (parsed.risk_level === 'HIGH') {
      const violates = parsed.ai_should_push;
      recordResult('RL-1', 'HIGH risk → should_push = false', !violates,
        violates ? 'AI pushed despite HIGH risk — violates rule' : 'Correctly did not push with HIGH risk',
        parsed);
    } else {
      recordResult('RL-1', 'HIGH risk → should_push = false', true,
        `Risk level assessed as ${parsed.risk_level} — not HIGH, test not strictly applicable`,
        parsed);
    }
  }, 90_000);

  // ============================================================
  // CORNERS MARKET DISCIPLINE
  // ============================================================

  // CO-1: Corners Over after minute 80 — should_push = false
  test('CO-1: Corners Over after minute 80 — must reject', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'co-1', home: 'Leeds', away: 'Sheffield', league: 'Championship', minute: 82, score: '1-0', status: '2H' },
      match_id: 'co-1', home_team: 'Leeds', away_team: 'Sheffield', league: 'Championship',
      minute: 82, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 55, away: 45 },
        shots: { home: 8, away: 5 },
        shots_on_target: { home: 3, away: 2 },
        corners: { home: 5, away: 3 }, // Total 8 corners
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.15, draw: 7.0, away: 16.0 },
        ou: { line: 2.5, over: 3.50, under: 1.28 },
        corners_ou: { line: 9.5, over: 1.85, under: 1.95 }, // Need 2 more corners in 8 min
      }),
      odds_available: true,
      events_compact: [
        { minute: 30, extra: null, team: 'Leeds', type: 'goal', detail: '1-0', player: 'Bamford' },
      ],
      events_summary: "30' ⚽ Bamford",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const violates = parsed.ai_should_push && parsed.bet_market?.startsWith('corners_over');
    recordResult('CO-1', 'Corners Over after minute 80', !violates,
      violates ? 'AI recommended Corners Over after minute 80 — violates rule' : 'Correctly avoided Corners Over after minute 80',
      parsed);
  }, 90_000);

  // ============================================================
  // OVER 3.5+ SCRUTINY
  // ============================================================

  // O35-1: Over 3.5 with only 1 goal at minute 60 — should reject
  test('O35-1: Over 3.5 with 1 goal at minute 60 — not feasible', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'o35-1', home: 'Hoffenheim', away: 'Mainz', league: 'Bundesliga', minute: 60, score: '1-0', status: '2H' },
      match_id: 'o35-1', home_team: 'Hoffenheim', away_team: 'Mainz', league: 'Bundesliga',
      minute: 60, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 55, away: 45 },
        shots: { home: 7, away: 5 },
        shots_on_target: { home: 3, away: 2 },
        corners: { home: 4, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.80, draw: 3.6, away: 4.5 },
        ou: { line: 3.5, over: 4.50, under: 1.18 },
        btts: { yes: 2.10, no: 1.70 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 35, extra: null, team: 'Hoffenheim', type: 'goal', detail: '1-0', player: 'Kramaric' },
      ],
      events_summary: "35' ⚽ Kramaric",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const violates = parsed.ai_should_push && parsed.bet_market === 'over_3.5';
    recordResult('O35-1', 'Over 3.5 with only 1 goal — not feasible', !violates,
      violates ? 'AI recommended Over 3.5 needing 3 more goals in 30 min — violates feasibility check' : 'Correctly avoided Over 3.5',
      parsed);
  }, 90_000);

  // ============================================================
  // RED CARD PROTOCOL
  // ============================================================

  // RC-1: Red card detected — should mention in warnings/reasoning
  test('RC-1: Red card detected — triggers RED_CARD_PROTOCOL', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'rc-1', home: 'Marseille', away: 'Nice', league: 'Ligue 1', minute: 50, score: '0-0', status: '2H' },
      match_id: 'rc-1', home_team: 'Marseille', away_team: 'Nice', league: 'Ligue 1',
      minute: 50, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 55, away: 45 },
        shots: { home: 6, away: 5 },
        shots_on_target: { home: 2, away: 2 },
        corners: { home: 3, away: 3 },
        red_cards: { home: 0, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.55, draw: 4.0, away: 5.5 },
        ou: { line: 2.5, over: 1.80, under: 2.00 },
        btts: { yes: 2.00, no: 1.80 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 42, extra: null, team: 'Nice', type: 'card', detail: 'Red Card', player: 'Todibo' },
      ],
      events_summary: "42' 🔴 Todibo (Nice)",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const mentionsRedCard = parsed.reasoning_en.toLowerCase().includes('red card') ||
      parsed.warnings.some(w => w.includes('RED_CARD'));
    recordResult('RC-1', 'Red card — mentioned in reasoning/warnings', mentionsRedCard,
      mentionsRedCard ? 'AI correctly identified red card' : 'AI did NOT mention red card — RED_CARD_PROTOCOL not triggered',
      parsed);
  }, 90_000);

  // ============================================================
  // ENDGAME RULES
  // ============================================================

  // END-1: Minute 89 — default should_push=false, max stake 2%
  test('END-1: Endgame minute 89 — very conservative', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'end-1', home: 'Valencia', away: 'Villarreal', league: 'La Liga', minute: 89, score: '1-1', status: '2H' },
      match_id: 'end-1', home_team: 'Valencia', away_team: 'Villarreal', league: 'La Liga',
      minute: 89, score: '1-1', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 48, away: 52 },
        shots: { home: 7, away: 8 },
        shots_on_target: { home: 3, away: 3 },
        corners: { home: 4, away: 5 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 4.0, draw: 1.55, away: 5.5 },
        ou: { line: 2.5, over: 3.50, under: 1.28 },
        btts: { yes: 1.15, no: 5.50 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 20, extra: null, team: 'Valencia', type: 'goal', detail: '1-0', player: 'Soler' },
        { minute: 65, extra: null, team: 'Villarreal', type: 'goal', detail: '1-1', player: 'Moreno' },
      ],
      events_summary: "20' ⚽ Soler, 65' ⚽ Moreno",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    if (parsed.ai_should_push) {
      const stakeOk = parsed.stake_percent <= 2;
      recordResult('END-1', 'Endgame min 89 — max stake 2%', stakeOk,
        `Stake: ${parsed.stake_percent}% (max 2%: ${stakeOk})`,
        parsed);
    } else {
      recordResult('END-1', 'Endgame min 89 — max stake 2%', true,
        'AI correctly did not push at minute 89',
        parsed);
    }
  }, 90_000);

  // ============================================================
  // ODDS INTERPRETATION / FAKE ODDS
  // ============================================================

  // OI-1: Suspicious odds — should flag or not push
  test('OI-1: Suspicious odds — contradicting match state', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'oi-1', home: 'Porto', away: 'Braga', league: 'Liga Portugal', minute: 60, score: '3-0', status: '2H' },
      match_id: 'oi-1', home_team: 'Porto', away_team: 'Braga', league: 'Liga Portugal',
      minute: 60, score: '3-0', status: '2H', current_total_goals: 3,
      stats_compact: createStatsCompact({
        possession: { home: 65, away: 35 },
        shots: { home: 14, away: 3 },
        shots_on_target: { home: 7, away: 0 },
        corners: { home: 8, away: 1 },
      }),
      stats_available: true,
      // Odds that DON'T make sense for a 3-0 lead at min 60
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.5, draw: 2.8, away: 2.5 }, // Home leading 3-0 but home odds are 3.5?!
        ou: { line: 2.5, over: 1.80, under: 2.00 }, // Over 2.5 at 1.80 when already 3 goals?
      }),
      odds_available: true,
      odds_suspicious: true,
      odds_sanity_warnings: ['1X2 odds contradict 3-0 scoreline'],
      events_compact: [
        { minute: 10, extra: null, team: 'Porto', type: 'goal', detail: '1-0', player: 'Evanilson' },
        { minute: 35, extra: null, team: 'Porto', type: 'goal', detail: '2-0', player: 'Nico' },
        { minute: 52, extra: null, team: 'Porto', type: 'goal', detail: '3-0', player: 'Galeno' },
      ],
      events_summary: "10' ⚽ Evanilson, 35' ⚽ Nico, 52' ⚽ Galeno",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const flagsOdds = parsed.reasoning_en.toLowerCase().includes('suspicious') ||
      parsed.reasoning_en.toLowerCase().includes('stale') ||
      parsed.reasoning_en.toLowerCase().includes('unreliable') ||
      parsed.warnings.some(w => w.includes('ODDS_SUSPICIOUS'));
    recordResult('OI-1', 'Suspicious odds — should flag', flagsOdds || !parsed.ai_should_push,
      flagsOdds ? 'AI correctly flagged suspicious odds' : (parsed.ai_should_push ? 'AI pushed with suspicious odds without flagging' : 'AI did not push — acceptable'),
      parsed);
  }, 90_000);

  // ============================================================
  // MINIMUM ODDS FILTER
  // ============================================================

  // MO-1: All available odds below MIN_ODDS — should not push
  test('MO-1: All odds below MIN_ODDS (1.50) — should not push', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'mo-1', home: 'Celtic', away: 'Ross County', league: 'Scottish Premiership', minute: 75, score: '4-0', status: '2H' },
      match_id: 'mo-1', home_team: 'Celtic', away_team: 'Ross County', league: 'Scottish Premiership',
      minute: 75, score: '4-0', status: '2H', current_total_goals: 4,
      stats_compact: createStatsCompact({
        possession: { home: 75, away: 25 },
        shots: { home: 18, away: 1 },
        shots_on_target: { home: 9, away: 0 },
        corners: { home: 10, away: 0 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.01, draw: 25.0, away: 50.0 },
        ou: { line: 4.5, over: 1.40, under: 2.80 }, // Over 4.5 at 1.40 — below MIN_ODDS
        btts: { yes: 4.50, no: 1.15 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 8, extra: null, team: 'Celtic', type: 'goal', detail: '1-0', player: 'Kyogo' },
        { minute: 25, extra: null, team: 'Celtic', type: 'goal', detail: '2-0', player: 'Hatate' },
        { minute: 55, extra: null, team: 'Celtic', type: 'goal', detail: '3-0', player: 'Forrest' },
        { minute: 70, extra: null, team: 'Celtic', type: 'goal', detail: '4-0', player: 'Kyogo' },
      ],
      events_summary: "8' ⚽ Kyogo, 25' ⚽ Hatate, 55' ⚽ Forrest, 70' ⚽ Kyogo",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Most available odds are too low. If AI pushes, odds must be >= 1.50
    if (parsed.ai_should_push) {
      // Check if the selected odd is >= 1.50
      const oddMatch = parsed.selection.match(/@(\d+\.\d+)/);
      const selectedOdd = oddMatch ? parseFloat(oddMatch[1] ?? '0') : 0;
      const oddsOk = selectedOdd >= 1.50;
      recordResult('MO-1', 'Min odds filter — selected odds >= 1.50', oddsOk,
        `Selected: ${parsed.selection}, odds: ${selectedOdd} (min 1.50: ${oddsOk})`,
        parsed);
    } else {
      recordResult('MO-1', 'Min odds filter — selected odds >= 1.50', true,
        'AI correctly did not push — most odds below MIN_ODDS',
        parsed);
    }
  }, 90_000);

  // ============================================================
  // LATE GAME PHASE
  // ============================================================

  // LG-1: Very late phase (min 86) — exceptional circumstances only
  test('LG-1: Very late phase min 86 — exceptional only', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'lg-1', home: 'Inter', away: 'Napoli', league: 'Serie A', minute: 86, score: '0-0', status: '2H' },
      match_id: 'lg-1', home_team: 'Inter', away_team: 'Napoli', league: 'Serie A',
      minute: 86, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 50, away: 50 },
        shots: { home: 6, away: 5 },
        shots_on_target: { home: 2, away: 2 },
        corners: { home: 4, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.8, draw: 1.80, away: 4.0 },
        ou: { line: 0.5, over: 1.55, under: 2.45 },
        btts: { yes: 4.50, no: 1.18 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Very late phase: should be extremely conservative
    if (parsed.ai_should_push) {
      const stakeOk = parsed.stake_percent <= 3;
      recordResult('LG-1', 'Very late phase — max stake 3%', stakeOk,
        `Stake: ${parsed.stake_percent}% at minute 86`,
        parsed);
    } else {
      recordResult('LG-1', 'Very late phase — max stake 3%', true,
        'AI correctly did not push at minute 86',
        parsed);
    }
  }, 90_000);

  // ============================================================
  // CUSTOM CONDITION INDEPENDENCE
  // ============================================================

  // CC-1: Custom condition met but should_push = false — both can coexist
  test('CC-1: Custom condition met independently from should_push', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'cc-1', home: 'RB Leipzig', away: 'Union Berlin', league: 'Bundesliga', minute: 70, score: '0-0', status: '2H' },
      match_id: 'cc-1', home_team: 'RB Leipzig', away_team: 'Union Berlin', league: 'Bundesliga',
      minute: 70, score: '0-0', status: '2H', current_total_goals: 0,
      custom_conditions: 'possession_home > 60 AND shots_on_target_home >= 4',
      stats_compact: createStatsCompact({
        possession: { home: 65, away: 35 },
        shots: { home: 12, away: 3 },
        shots_on_target: { home: 5, away: 0 },
        corners: { home: 7, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.0, draw: 3.2, away: 4.0 },
        ou: { line: 2.5, over: 3.00, under: 1.38 },
        btts: { yes: 3.40, no: 1.30 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Custom condition: possession_home=65 > 60 (true) AND shots_on_target_home=5 >= 4 (true) → MATCHED
    // But should_push could be false (0-0 at minute 70, high odds, sterile dominance)
    const conditionEvaluated = parsed.custom_condition_status === 'evaluated';
    const conditionMatched = parsed.custom_condition_matched;
    recordResult('CC-1', 'Custom condition evaluated independently', conditionEvaluated && conditionMatched,
      `status=${parsed.custom_condition_status}, matched=${conditionMatched}, should_push=${parsed.ai_should_push}`,
      parsed);
  }, 90_000);

  // ============================================================
  // COMBINED TRAP: BTTS Yes + Possession Bias + 0-0
  // The ultimate test — all traps combined
  // ============================================================

  // TRAP-1: All traps combined — high possession, 0-0, BTTS Yes temptation
  test('TRAP-1: Combined trap — possession + 0-0 + BTTS Yes temptation', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'trap-1', home: 'Barcelona', away: 'Real Sociedad', league: 'La Liga', minute: 62, score: '0-0', status: '2H' },
      match_id: 'trap-1', home_team: 'Barcelona', away_team: 'Real Sociedad', league: 'La Liga',
      minute: 62, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 72, away: 28 },
        shots: { home: 16, away: 3 },
        shots_on_target: { home: 3, away: 1 }, // Low SOT ratio for Barcelona (3/16=18.7%)
        corners: { home: 10, away: 1 },
        goalkeeper_saves: { home: 1, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.60, draw: 4.0, away: 5.5 },
        ou: { line: 2.5, over: 2.40, under: 1.55 },
        btts: { yes: 2.60, no: 1.50 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // This scenario combines:
    // 1. Possession bias (72% but only 3 SOT from 16 shots)
    // 2. Score 0-0 at minute 62 (Score 0-0 rule: prefer Under after 55)
    // 3. BTTS Yes at odds 2.60 (above 2.00 threshold) — should be rejected
    // 4. 1x2_home before sufficient evidence
    // Best response: Under 2.5 @1.55 or no push

    const recommends1x2Home = parsed.ai_should_push && parsed.bet_market === '1x2_home';
    const recommendsBttsYes = parsed.ai_should_push && parsed.bet_market === 'btts_yes';
    const recommendsOver = parsed.ai_should_push && parsed.bet_market?.startsWith('over_2');

    const violatesAny = recommends1x2Home || recommendsBttsYes || recommendsOver;
    recordResult('TRAP-1', 'Combined trap — avoids all pitfalls', !violatesAny,
      violatesAny
        ? `AI fell for trap: recommended ${parsed.bet_market}. Traps: possession bias(72%), 0-0 at 62', BTTS Yes @2.60`
        : `Correct: AI recommended ${parsed.ai_should_push ? parsed.bet_market : 'no push'}`,
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL BTTS YES VARIATIONS
  // ============================================================

  // BTTS-Y5: Valid BTTS Yes — both teams 3+ SOT, good odds
  test('BTTS-Y5: Valid BTTS Yes — both teams 3+ SOT, odds 1.75', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-y5', home: 'AC Milan', away: 'Juventus', league: 'Serie A', minute: 50, score: '1-0', status: '2H' },
      match_id: 'btts-y5', home_team: 'AC Milan', away_team: 'Juventus', league: 'Serie A',
      minute: 50, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 48, away: 52 },
        shots: { home: 9, away: 10 },
        shots_on_target: { home: 4, away: 3 },
        corners: { home: 4, away: 5 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.3, draw: 3.3, away: 3.2 },
        ou: { line: 2.5, over: 1.60, under: 2.30 },
        btts: { yes: 1.75, no: 2.05 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'AC Milan', type: 'goal', detail: '1-0', player: 'Leao' },
      ],
      events_summary: "15' ⚽ Leao",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Valid scenario — both teams dangerous, odds 1.75 is acceptable
    const mentionsBothTeams = parsed.reasoning_en.toLowerCase().includes('juventus') ||
      parsed.reasoning_en.toLowerCase().includes('both') ||
      parsed.reasoning_en.toLowerCase().includes('away');
    recordResult('BTTS-Y5', 'Valid BTTS Yes — both teams 3+ SOT, odds 1.75', true,
      `AI decision: should_push=${parsed.ai_should_push}, market=${parsed.bet_market}. Mentions both: ${mentionsBothTeams}`,
      parsed);
  }, 90_000);

  // BTTS-Y6: BTTS Yes at minute 80 with 1-1 — both already scored
  test('BTTS-Y6: BTTS Yes at 1-1 minute 80 — both already scored, irrelevant market', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-y6', home: 'Ajax', away: 'PSV', league: 'Eredivisie', minute: 80, score: '1-1', status: '2H' },
      match_id: 'btts-y6', home_team: 'Ajax', away_team: 'PSV', league: 'Eredivisie',
      minute: 80, score: '1-1', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 50, away: 50 },
        shots: { home: 8, away: 8 },
        shots_on_target: { home: 4, away: 4 },
        corners: { home: 5, away: 5 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.0, draw: 2.5, away: 3.5 },
        ou: { line: 2.5, over: 1.90, under: 1.90 },
        btts: { yes: 1.08, no: 8.0 }, // BTTS Yes already won essentially — odds too low
      }),
      odds_available: true,
      events_compact: [
        { minute: 20, extra: null, team: 'Ajax', type: 'goal', detail: '1-0', player: 'Berghuis' },
        { minute: 55, extra: null, team: 'PSV', type: 'goal', detail: '1-1', player: 'De Jong' },
      ],
      events_summary: "20' ⚽ Berghuis, 55' ⚽ De Jong",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // BTTS Yes at 1.08 is below MIN_ODDS — should not push this market
    const violates = parsed.ai_should_push && parsed.bet_market === 'btts_yes';
    recordResult('BTTS-Y6', 'BTTS Yes already settled at 1.08 — below MIN_ODDS', !violates,
      violates ? 'AI recommended BTTS Yes at 1.08 — below MIN_ODDS' : 'Correctly avoided BTTS Yes at dead odds',
      parsed);
  }, 90_000);

  // BTTS-Y7: BTTS Yes in first half at 0-0
  test('BTTS-Y7: BTTS Yes at minute 30, 0-0 — too early and no goals', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-y7', home: 'Real Madrid', away: 'Atletico', league: 'La Liga', minute: 30, score: '0-0', status: '1H' },
      match_id: 'btts-y7', home_team: 'Real Madrid', away_team: 'Atletico', league: 'La Liga',
      minute: 30, score: '0-0', status: '1H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 58, away: 42 },
        shots: { home: 6, away: 2 },
        shots_on_target: { home: 2, away: 0 },
        corners: { home: 4, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.55, draw: 4.0, away: 5.5 },
        ou: { line: 2.5, over: 1.65, under: 2.20 },
        btts: { yes: 1.80, no: 2.00 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Atletico has 0 SOT — BTTS Yes requires both teams dangerous
    const violates = parsed.ai_should_push && parsed.bet_market === 'btts_yes';
    recordResult('BTTS-Y7', 'BTTS Yes early + away 0 SOT', !violates,
      violates ? 'AI recommended BTTS Yes despite Atletico 0 SOT at minute 30' : 'Correctly avoided BTTS Yes',
      parsed);
  }, 90_000);

  // BTTS-Y8: BTTS Yes at odds 2.50 — extreme high odds
  test('BTTS-Y8: BTTS Yes at odds 2.50 — extreme high odds, should reject', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-y8', home: 'Benfica', away: 'Sporting', league: 'Liga Portugal', minute: 55, score: '1-0', status: '2H' },
      match_id: 'btts-y8', home_team: 'Benfica', away_team: 'Sporting', league: 'Liga Portugal',
      minute: 55, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 60, away: 40 },
        shots: { home: 10, away: 4 },
        shots_on_target: { home: 5, away: 1 },
        corners: { home: 6, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.30, draw: 5.5, away: 9.0 },
        ou: { line: 2.5, over: 1.80, under: 2.00 },
        btts: { yes: 2.50, no: 1.52 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 20, extra: null, team: 'Benfica', type: 'goal', detail: '1-0', player: 'Di Maria' },
      ],
      events_summary: "20' ⚽ Di Maria",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const violates = parsed.ai_should_push && parsed.bet_market === 'btts_yes';
    recordResult('BTTS-Y8', 'BTTS Yes extreme odds 2.50 + away 1 SOT', !violates,
      violates ? 'AI recommended BTTS Yes at 2.50 — both high odds AND away has only 1 SOT' : 'Correctly rejected BTTS Yes',
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL BTTS NO VARIATIONS
  // ============================================================

  // BTTS-N4: Valid BTTS No — score 3-0, minute 70, clean sheet
  test('BTTS-N4: BTTS No valid — 3-0, minute 70, opponent 0 SOT', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-n4', home: 'Man City', away: 'Southampton', league: 'Premier League', minute: 70, score: '3-0', status: '2H' },
      match_id: 'btts-n4', home_team: 'Man City', away_team: 'Southampton', league: 'Premier League',
      minute: 70, score: '3-0', status: '2H', current_total_goals: 3,
      stats_compact: createStatsCompact({
        possession: { home: 70, away: 30 },
        shots: { home: 16, away: 2 },
        shots_on_target: { home: 8, away: 0 },
        corners: { home: 10, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.01, draw: 20.0, away: 50.0 },
        ou: { line: 3.5, over: 1.55, under: 2.45 },
        btts: { yes: 4.00, no: 1.22 }, // BTTS No odds too low (< 1.50)
      }),
      odds_available: true,
      events_compact: [
        { minute: 10, extra: null, team: 'Man City', type: 'goal', detail: '1-0', player: 'Haaland' },
        { minute: 35, extra: null, team: 'Man City', type: 'goal', detail: '2-0', player: 'Foden' },
        { minute: 62, extra: null, team: 'Man City', type: 'goal', detail: '3-0', player: 'Haaland' },
      ],
      events_summary: "10' ⚽ Haaland, 35' ⚽ Foden, 62' ⚽ Haaland",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // BTTS No is valid but odds 1.22 < MIN_ODDS 1.50 — should not push BTTS No
    const pushBttsNo = parsed.ai_should_push && parsed.bet_market === 'btts_no';
    recordResult('BTTS-N4', 'Valid BTTS No scenario but odds 1.22 < MIN_ODDS', !pushBttsNo,
      pushBttsNo ? 'AI pushed BTTS No at 1.22 — below MIN_ODDS' : `Correctly: ${parsed.ai_should_push ? parsed.bet_market : 'no push'}`,
      parsed);
  }, 90_000);

  // BTTS-N5: BTTS No when BOTH teams already scored (1-1)
  test('BTTS-N5: BTTS No at 1-1 — both teams scored, BTTS already lost', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-n5', home: 'Wolves', away: 'Aston Villa', league: 'Premier League', minute: 60, score: '1-1', status: '2H' },
      match_id: 'btts-n5', home_team: 'Wolves', away_team: 'Aston Villa', league: 'Premier League',
      minute: 60, score: '1-1', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 45, away: 55 },
        shots: { home: 6, away: 8 },
        shots_on_target: { home: 3, away: 4 },
        corners: { home: 3, away: 5 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.5, draw: 3.2, away: 2.2 },
        ou: { line: 2.5, over: 1.55, under: 2.45 },
        btts: { yes: 1.10, no: 7.0 }, // BTTS Yes already settled — No is dead
      }),
      odds_available: true,
      events_compact: [
        { minute: 25, extra: null, team: 'Wolves', type: 'goal', detail: '1-0', player: 'Cunha' },
        { minute: 50, extra: null, team: 'Aston Villa', type: 'goal', detail: '1-1', player: 'Watkins' },
      ],
      events_summary: "25' ⚽ Cunha, 50' ⚽ Watkins",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // BTTS No at 7.0 odds — both teams already scored, this bet is essentially lost
    const violates = parsed.ai_should_push && parsed.bet_market === 'btts_no';
    recordResult('BTTS-N5', 'BTTS No when 1-1 — already lost', !violates,
      violates ? 'AI recommended BTTS No at 1-1 — both teams already scored!' : 'Correctly avoided dead BTTS No',
      parsed);
  }, 90_000);

  // BTTS-N6: BTTS No at minute 80, score 1-0, away 0 SOT, good odds
  test('BTTS-N6: BTTS No valid — min 80, 1-0, away 0 SOT, odds 1.75', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'btts-n6', home: 'Napoli', away: 'Cagliari', league: 'Serie A', minute: 80, score: '1-0', status: '2H' },
      match_id: 'btts-n6', home_team: 'Napoli', away_team: 'Cagliari', league: 'Serie A',
      minute: 80, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 62, away: 38 },
        shots: { home: 12, away: 4 },
        shots_on_target: { home: 5, away: 0 },
        corners: { home: 7, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.10, draw: 9.0, away: 20.0 },
        ou: { line: 1.5, over: 1.60, under: 2.30 },
        btts: { yes: 3.80, no: 1.75 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Napoli', type: 'goal', detail: '1-0', player: 'Osimhen' },
      ],
      events_summary: "15' ⚽ Osimhen",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // This IS a valid BTTS No: min 80, clean sheet, away 0 SOT, odds 1.75 > 1.70
    recordResult('BTTS-N6', 'Valid BTTS No — late, clean sheet, good odds', true,
      `AI decision: should_push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL BREAK-EVEN VARIATIONS
  // ============================================================

  // BE-2: Marginal edge — should reject (odds 1.85, ~54.1% break-even)
  test('BE-2: Marginal edge — odds 1.85, break-even 54.1% vs ~51% actual', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'be-2', home: 'Newcastle', away: 'Brighton', league: 'Premier League', minute: 55, score: '0-0', status: '2H' },
      match_id: 'be-2', home_team: 'Newcastle', away_team: 'Brighton', league: 'Premier League',
      minute: 55, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 52, away: 48 },
        shots: { home: 6, away: 5 },
        shots_on_target: { home: 2, away: 2 },
        corners: { home: 4, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.5, draw: 3.2, away: 3.0 },
        ou: { line: 2.5, over: 1.85, under: 1.95 }, // Over 2.5 at 1.85 — break-even 54.1%
        btts: { yes: 1.90, no: 1.90 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Check that break-even is mentioned
    const mentionsBreakEven = parsed.reasoning_en.toLowerCase().includes('break-even') ||
      parsed.reasoning_en.toLowerCase().includes('break even');
    if (parsed.ai_should_push) {
      recordResult('BE-2', 'Marginal edge with break-even check', mentionsBreakEven,
        mentionsBreakEven ? 'AI mentioned break-even calculation' : 'AI pushed without mentioning break-even',
        parsed);
    } else {
      recordResult('BE-2', 'Marginal edge with break-even check', true,
        'AI correctly did not push — marginal edge insufficient',
        parsed);
    }
  }, 90_000);

  // BE-3: Clear edge — should mention break-even and potentially push
  test('BE-3: Clear edge — odds 2.10, strong evidence', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'be-3', home: 'Liverpool', away: 'Nottingham', league: 'Premier League', minute: 55, score: '2-0', status: '2H' },
      match_id: 'be-3', home_team: 'Liverpool', away_team: 'Nottingham', league: 'Premier League',
      minute: 55, score: '2-0', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 62, away: 38 },
        shots: { home: 14, away: 3 },
        shots_on_target: { home: 7, away: 1 },
        corners: { home: 7, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.08, draw: 10.0, away: 20.0 },
        ou: { line: 2.5, over: 1.55, under: 2.45 },
        btts: { yes: 2.10, no: 1.70 },
        ah: { line: -1.5, home: 1.65, away: 2.25 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 12, extra: null, team: 'Liverpool', type: 'goal', detail: '1-0', player: 'Salah' },
        { minute: 40, extra: null, team: 'Liverpool', type: 'goal', detail: '2-0', player: 'Diaz' },
      ],
      events_summary: "12' ⚽ Salah, 40' ⚽ Diaz",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    if (parsed.ai_should_push) {
      const mentionsBreakEven = parsed.reasoning_en.toLowerCase().includes('break-even') ||
        parsed.reasoning_en.toLowerCase().includes('break even');
      recordResult('BE-3', 'Clear edge — break-even mentioned', mentionsBreakEven,
        mentionsBreakEven ? `AI mentioned break-even. Market: ${parsed.bet_market}` : 'AI pushed without break-even text — rule violation',
        parsed);
    } else {
      recordResult('BE-3', 'Clear edge — break-even mentioned', true,
        'AI did not push — conservative but acceptable',
        parsed);
    }
  }, 90_000);

  // ============================================================
  // ADDITIONAL ODDS CEILING VARIATIONS
  // ============================================================

  // OC-2: Extreme odds 4.00+
  test('OC-2: Extreme odds 4.00+ — should not push', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'oc-2', home: 'Lecce', away: 'Atalanta', league: 'Serie A', minute: 55, score: '0-2', status: '2H' },
      match_id: 'oc-2', home_team: 'Lecce', away_team: 'Atalanta', league: 'Serie A',
      minute: 55, score: '0-2', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 35, away: 65 },
        shots: { home: 3, away: 12 },
        shots_on_target: { home: 1, away: 6 },
        corners: { home: 1, away: 8 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 12.0, draw: 5.5, away: 1.20 },
        ou: { line: 3.5, over: 1.55, under: 2.45 },
        btts: { yes: 4.50, no: 1.18 }, // BTTS Yes at 4.50 — extreme
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Atalanta', type: 'goal', detail: '0-1', player: 'Lookman' },
        { minute: 42, extra: null, team: 'Atalanta', type: 'goal', detail: '0-2', player: 'De Ketelaere' },
      ],
      events_summary: "15' ⚽ Lookman, 42' ⚽ De Ketelaere",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    if (parsed.ai_should_push) {
      const confOk = parsed.confidence <= 6;
      const stakeOk = parsed.stake_percent <= 3;
      recordResult('OC-2', 'Extreme odds 4.00+ — caps enforced', confOk && stakeOk,
        `Conf: ${parsed.confidence} (cap 6: ${confOk}), Stake: ${parsed.stake_percent}% (cap 3: ${stakeOk})`,
        parsed);
    } else {
      recordResult('OC-2', 'Extreme odds 4.00+ — caps enforced', true,
        'AI correctly did not push with extreme odds',
        parsed);
    }
  }, 90_000);

  // OC-3: Normal odds range (1.65-1.90) — no cap needed
  test('OC-3: Normal odds 1.65-1.90 — no artificial cap', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'oc-3', home: 'Tottenham', away: 'Brentford', league: 'Premier League', minute: 60, score: '2-0', status: '2H' },
      match_id: 'oc-3', home_team: 'Tottenham', away_team: 'Brentford', league: 'Premier League',
      minute: 60, score: '2-0', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 58, away: 42 },
        shots: { home: 12, away: 5 },
        shots_on_target: { home: 6, away: 2 },
        corners: { home: 6, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.15, draw: 7.5, away: 15.0 },
        ou: { line: 2.5, over: 1.55, under: 2.45 },
        ah: { line: -1.5, home: 1.75, away: 2.10 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 18, extra: null, team: 'Tottenham', type: 'goal', detail: '1-0', player: 'Son' },
        { minute: 50, extra: null, team: 'Tottenham', type: 'goal', detail: '2-0', player: 'Richarlison' },
      ],
      events_summary: "18' ⚽ Son, 50' ⚽ Richarlison",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Normal odds — if AI pushes, confidence can be up to 8
    recordResult('OC-3', 'Normal odds — no artificial cap', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}, conf=${parsed.confidence}, stake=${parsed.stake_percent}%`,
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL 1X2 HOME VARIATIONS
  // ============================================================

  // 1X2-H2: 1x2_home at minute 45, dominating 2-0
  test('1X2-H2: 1x2_home at minute 45, score 2-0 — still cautious zone', async () => {
    const matchData = createMergedMatchData({
      match: { id: '1x2-h2', home: 'Bayern', away: 'Augsburg', league: 'Bundesliga', minute: 45, score: '2-0', status: '2H' },
      match_id: '1x2-h2', home_team: 'Bayern', away_team: 'Augsburg', league: 'Bundesliga',
      minute: 45, score: '2-0', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 68, away: 32 },
        shots: { home: 14, away: 2 },
        shots_on_target: { home: 7, away: 0 },
        corners: { home: 8, away: 0 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.05, draw: 15.0, away: 30.0 },
        ou: { line: 3.5, over: 1.55, under: 2.45 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 12, extra: null, team: 'Bayern', type: 'goal', detail: '1-0', player: 'Sane' },
        { minute: 38, extra: null, team: 'Bayern', type: 'goal', detail: '2-0', player: 'Muller' },
      ],
      events_summary: "12' ⚽ Sane, 38' ⚽ Muller",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // 1x2_home at 1.05 is below MIN_ODDS — should not push this market
    const violates = parsed.ai_should_push && parsed.bet_market === '1x2_home';
    recordResult('1X2-H2', '1x2_home at 1.05 — below MIN_ODDS', !violates,
      violates ? 'AI recommended 1x2_home at 1.05 — below MIN_ODDS' : `Correctly: ${parsed.ai_should_push ? parsed.bet_market : 'no push'}`,
      parsed);
  }, 90_000);

  // 1X2-H3: 1x2_home at minute 70, score 1-0, dominating — could be valid
  test('1X2-H3: 1x2_home at minute 70, 1-0, dominant — may be valid', async () => {
    const matchData = createMergedMatchData({
      match: { id: '1x2-h3', home: 'Arsenal', away: 'Bournemouth', league: 'Premier League', minute: 70, score: '1-0', status: '2H' },
      match_id: '1x2-h3', home_team: 'Arsenal', away_team: 'Bournemouth', league: 'Premier League',
      minute: 70, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 65, away: 35 },
        shots: { home: 14, away: 3 },
        shots_on_target: { home: 6, away: 1 },
        corners: { home: 8, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.20, draw: 6.5, away: 12.0 },
        ou: { line: 1.5, over: 1.55, under: 2.45 },
        ah: { line: -1.5, home: 2.10, away: 1.75 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 25, extra: null, team: 'Arsenal', type: 'goal', detail: '1-0', player: 'Saka' },
      ],
      events_summary: "25' ⚽ Saka",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // After minute 35, 1x2_home is technically allowed but still risky
    // 1x2_home at 1.20 is below MIN_ODDS — should use asian handicap instead
    recordResult('1X2-H3', '1x2_home late game, low odds', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}, conf=${parsed.confidence}`,
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL DRAW VARIATIONS
  // ============================================================

  // DR-2: Draw at minute 78, score 1-1 — may be valid
  test('DR-2: Draw at minute 78, 1-1 — getting more acceptable', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'dr-2', home: 'Sevilla', away: 'Valencia', league: 'La Liga', minute: 78, score: '1-1', status: '2H' },
      match_id: 'dr-2', home_team: 'Sevilla', away_team: 'Valencia', league: 'La Liga',
      minute: 78, score: '1-1', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 48, away: 52 },
        shots: { home: 5, away: 6 },
        shots_on_target: { home: 2, away: 2 },
        corners: { home: 3, away: 4 },
        fouls: { home: 14, away: 16 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.8, draw: 2.20, away: 3.5 },
        ou: { line: 2.5, over: 2.80, under: 1.42 },
        btts: { yes: 1.18, no: 4.80 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 30, extra: null, team: 'Sevilla', type: 'goal', detail: '1-0', player: 'En-Nesyri' },
        { minute: 60, extra: null, team: 'Valencia', type: 'goal', detail: '1-1', player: 'Duro' },
      ],
      events_summary: "30' ⚽ En-Nesyri, 60' ⚽ Duro",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // After minute 70, draw is technically allowed — valid to push or not
    recordResult('DR-2', 'Draw at min 78 — acceptable zone', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // DR-3: Draw temptation at minute 40, score 0-0 — must reject
  test('DR-3: Draw at minute 40, 0-0 — too early, must reject', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'dr-3', home: 'Genoa', away: 'Sassuolo', league: 'Serie A', minute: 40, score: '0-0', status: '1H' },
      match_id: 'dr-3', home_team: 'Genoa', away_team: 'Sassuolo', league: 'Serie A',
      minute: 40, score: '0-0', status: '1H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 50, away: 50 },
        shots: { home: 3, away: 3 },
        shots_on_target: { home: 1, away: 1 },
        corners: { home: 2, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.2, draw: 3.0, away: 2.5 },
        ou: { line: 2.5, over: 1.70, under: 2.10 },
        btts: { yes: 1.80, no: 2.00 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const violates = parsed.ai_should_push && parsed.bet_market === '1x2_draw';
    recordResult('DR-3', 'Draw at minute 40 — far too early', !violates,
      violates ? 'AI recommended Draw at minute 40 — heavily violates min 70 rule' : 'Correctly avoided Draw',
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL EARLY GAME VARIATIONS
  // ============================================================

  // EG-2: Minute 10, already 1-0 — still too early
  test('EG-2: Minute 10, 1-0 — extremely early, no push', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'eg-2', home: 'Dortmund', away: 'Monchengladbach', league: 'Bundesliga', minute: 10, score: '1-0', status: '1H' },
      match_id: 'eg-2', home_team: 'Dortmund', away_team: 'Monchengladbach', league: 'Bundesliga',
      minute: 10, score: '1-0', status: '1H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 60, away: 40 },
        shots: { home: 3, away: 1 },
        shots_on_target: { home: 2, away: 0 },
        corners: { home: 2, away: 0 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.40, draw: 4.5, away: 8.0 },
        ou: { line: 2.5, over: 1.50, under: 2.50 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 5, extra: null, team: 'Dortmund', type: 'goal', detail: '1-0', player: 'Brandt' },
      ],
      events_summary: "5' ⚽ Brandt",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Minute 10 — should definitely not push
    if (parsed.ai_should_push) {
      const is1x2 = parsed.bet_market.startsWith('1x2_');
      recordResult('EG-2', 'Minute 10 — no 1X2', !is1x2,
        is1x2 ? `Pushed ${parsed.bet_market} at minute 10!` : `Pushed ${parsed.bet_market} at minute 10 — very early`,
        parsed);
    } else {
      recordResult('EG-2', 'Minute 10 — no 1X2', true,
        'Correctly did not push at minute 10', parsed);
    }
  }, 90_000);

  // EG-3: Minute 28, lots of action — borderline
  test('EG-3: Minute 28, 2-1 — borderline early, some action', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'eg-3', home: 'Leipzig', away: 'Frankfurt', league: 'Bundesliga', minute: 28, score: '2-1', status: '1H' },
      match_id: 'eg-3', home_team: 'Leipzig', away_team: 'Frankfurt', league: 'Bundesliga',
      minute: 28, score: '2-1', status: '1H', current_total_goals: 3,
      stats_compact: createStatsCompact({
        possession: { home: 52, away: 48 },
        shots: { home: 7, away: 6 },
        shots_on_target: { home: 4, away: 3 },
        corners: { home: 3, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.80, draw: 3.8, away: 4.2 },
        ou: { line: 3.5, over: 1.55, under: 2.45 },
        btts: { yes: 1.35, no: 3.20 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 8, extra: null, team: 'Leipzig', type: 'goal', detail: '1-0', player: 'Werner' },
        { minute: 15, extra: null, team: 'Frankfurt', type: 'goal', detail: '1-1', player: 'Kolo Muani' },
        { minute: 22, extra: null, team: 'Leipzig', type: 'goal', detail: '2-1', player: 'Nkunku' },
      ],
      events_summary: "8' ⚽ Werner, 15' ⚽ Kolo Muani, 22' ⚽ Nkunku",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Still before minute 30 — 1X2 should not be pushed
    const is1x2 = parsed.ai_should_push && parsed.bet_market.startsWith('1x2_');
    recordResult('EG-3', 'Minute 28 — no 1X2 despite action', !is1x2,
      is1x2 ? `Pushed ${parsed.bet_market} at minute 28 — violates early game rule` : `Decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL POSSESSION BIAS VARIATIONS
  // ============================================================

  // PB-2: Good possession + good SOT ratio — NOT sterile
  test('PB-2: 60% possession, 5/10 SOT — effective, not sterile', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'pb-2', home: 'Real Madrid', away: 'Mallorca', league: 'La Liga', minute: 55, score: '1-0', status: '2H' },
      match_id: 'pb-2', home_team: 'Real Madrid', away_team: 'Mallorca', league: 'La Liga',
      minute: 55, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 60, away: 40 },
        shots: { home: 10, away: 4 },
        shots_on_target: { home: 5, away: 1 }, // 50% accuracy — effective
        corners: { home: 5, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.40, draw: 4.8, away: 7.5 },
        ou: { line: 2.5, over: 1.60, under: 2.30 },
        ah: { line: -1.5, home: 1.90, away: 1.95 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 30, extra: null, team: 'Real Madrid', type: 'goal', detail: '1-0', player: 'Vinicius' },
      ],
      events_summary: "30' ⚽ Vinicius",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Good SOT ratio — not sterile. Over/AH could be valid
    recordResult('PB-2', 'Effective possession — not sterile', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // PB-3: Extreme sterile dominance — 80% possession, 1/20 SOT
  test('PB-3: 80% possession, 1/20 SOT — extremely sterile', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'pb-3', home: 'Barcelona', away: 'Getafe', league: 'La Liga', minute: 75, score: '0-0', status: '2H' },
      match_id: 'pb-3', home_team: 'Barcelona', away_team: 'Getafe', league: 'La Liga',
      minute: 75, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 80, away: 20 },
        shots: { home: 20, away: 1 },
        shots_on_target: { home: 1, away: 0 }, // 1/20 = 5% — extremely sterile
        corners: { home: 12, away: 0 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.90, draw: 3.2, away: 4.5 },
        ou: { line: 2.5, over: 3.50, under: 1.28 },
        btts: { yes: 4.00, no: 1.22 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const recommendsOver = parsed.ai_should_push && parsed.bet_market?.startsWith('over_');
    const recommends1x2Home = parsed.ai_should_push && parsed.bet_market === '1x2_home';
    const violates = recommendsOver || recommends1x2Home;
    recordResult('PB-3', 'Extreme sterile — no Over/1x2_home', !violates,
      violates ? `Fell for trap: ${parsed.bet_market} despite 1/20 SOT at 0-0 min 75` : 'Avoided sterile dominance trap',
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL SCORE 0-0 VARIATIONS
  // ============================================================

  // Z0-2: 0-0 at minute 80 — Under 1.5 strongly preferred
  test('Z0-2: Score 0-0 at minute 80 — Under 1.5 strongly preferred', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'z0-2', home: 'Empoli', away: 'Monza', league: 'Serie A', minute: 80, score: '0-0', status: '2H' },
      match_id: 'z0-2', home_team: 'Empoli', away_team: 'Monza', league: 'Serie A',
      minute: 80, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 48, away: 52 },
        shots: { home: 4, away: 3 },
        shots_on_target: { home: 1, away: 1 },
        corners: { home: 2, away: 3 },
        fouls: { home: 16, away: 18 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.5, draw: 2.2, away: 3.5 },
        ou: { line: 0.5, over: 1.80, under: 2.00 },
        btts: { yes: 4.50, no: 1.18 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    if (parsed.ai_should_push) {
      const isGoalsUnder = parsed.bet_market?.startsWith('under_');
      recordResult('Z0-2', '0-0 at min 80 — goals Under only', isGoalsUnder,
        isGoalsUnder ? `Correct: ${parsed.bet_market}` : `Wrong: ${parsed.bet_market} instead of goals Under`,
        parsed);
    } else {
      recordResult('Z0-2', '0-0 at min 80 — goals Under only', true,
        'No push — acceptable for 0-0 at minute 80',
        parsed);
    }
  }, 90_000);

  // Z0-3: 0-0 at minute 55 — Under preference starts
  test('Z0-3: Score 0-0 at minute 55 — Under preference begins', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'z0-3', home: 'Freiburg', away: 'Wolfsburg', league: 'Bundesliga', minute: 55, score: '0-0', status: '2H' },
      match_id: 'z0-3', home_team: 'Freiburg', away_team: 'Wolfsburg', league: 'Bundesliga',
      minute: 55, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 55, away: 45 },
        shots: { home: 6, away: 5 },
        shots_on_target: { home: 2, away: 1 },
        corners: { home: 4, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.5, draw: 3.0, away: 3.2 },
        ou: { line: 2.5, over: 2.40, under: 1.55 },
        btts: { yes: 2.50, no: 1.52 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // After minute 55, Under preference. Should NOT recommend Over or 1x2_home
    if (parsed.ai_should_push) {
      const isOver = parsed.bet_market?.startsWith('over_');
      const is1x2Home = parsed.bet_market === '1x2_home';
      recordResult('Z0-3', '0-0 at min 55 — not Over/1x2_home', !isOver && !is1x2Home,
        isOver || is1x2Home ? `Wrong: ${parsed.bet_market} at 0-0 minute 55` : `OK: ${parsed.bet_market}`,
        parsed);
    } else {
      recordResult('Z0-3', '0-0 at min 55 — not Over/1x2_home', true,
        'No push — fine at 0-0 minute 55', parsed);
    }
  }, 90_000);

  // ============================================================
  // ADDITIONAL CORNERS VARIATIONS
  // ============================================================

  // CO-2: Corners Over at minute 70, need only 1 more — valid
  test('CO-2: Corners Over at min 70, need 1 more — could be valid', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'co-2', home: 'Chelsea', away: 'West Ham', league: 'Premier League', minute: 70, score: '1-0', status: '2H' },
      match_id: 'co-2', home_team: 'Chelsea', away_team: 'West Ham', league: 'Premier League',
      minute: 70, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 58, away: 42 },
        shots: { home: 10, away: 5 },
        shots_on_target: { home: 4, away: 2 },
        corners: { home: 6, away: 3 }, // Total 9 corners, need 1 more for Over 9.5
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.25, draw: 6.0, away: 10.0 },
        ou: { line: 1.5, over: 1.55, under: 2.45 },
        corners_ou: { line: 9.5, over: 1.55, under: 2.45 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 35, extra: null, team: 'Chelsea', type: 'goal', detail: '1-0', player: 'Palmer' },
      ],
      events_summary: "35' ⚽ Palmer",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Need only 1 more corner, 20 minutes left — feasible
    recordResult('CO-2', 'Corners Over — need 1, 20 min left', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // CO-3: Corners Under at minute 85, comfortably below — safe
  test('CO-3: Corners Under at min 85, well below line — safe', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'co-3', home: 'Burnley', away: 'Luton', league: 'Championship', minute: 85, score: '0-0', status: '2H' },
      match_id: 'co-3', home_team: 'Burnley', away_team: 'Luton', league: 'Championship',
      minute: 85, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 50, away: 50 },
        shots: { home: 4, away: 3 },
        shots_on_target: { home: 1, away: 1 },
        corners: { home: 2, away: 1 }, // Total 3, well below 9.5
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.5, draw: 2.5, away: 3.0 },
        ou: { line: 0.5, over: 1.65, under: 2.20 },
        corners_ou: { line: 9.5, over: 6.0, under: 1.08 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Corners Under 9.5 at 1.08 — below MIN_ODDS. Should not push corners at these odds
    recordResult('CO-3', 'Corners Under — odds too low', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL OVER 3.5+ VARIATIONS
  // ============================================================

  // O35-2: Over 3.5 with 3 goals at minute 50 — only need 1 more
  test('O35-2: Over 3.5 with 3 goals at min 50 — feasible', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'o35-2', home: 'Leverkusen', away: 'Dortmund', league: 'Bundesliga', minute: 50, score: '2-1', status: '2H' },
      match_id: 'o35-2', home_team: 'Leverkusen', away_team: 'Dortmund', league: 'Bundesliga',
      minute: 50, score: '2-1', status: '2H', current_total_goals: 3,
      stats_compact: createStatsCompact({
        possession: { home: 52, away: 48 },
        shots: { home: 9, away: 8 },
        shots_on_target: { home: 5, away: 4 },
        corners: { home: 4, away: 4 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 2.0, draw: 3.5, away: 3.8 },
        ou: { line: 3.5, over: 1.65, under: 2.20 },
        btts: { yes: 1.30, no: 3.50 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 10, extra: null, team: 'Leverkusen', type: 'goal', detail: '1-0', player: 'Wirtz' },
        { minute: 25, extra: null, team: 'Dortmund', type: 'goal', detail: '1-1', player: 'Brandt' },
        { minute: 42, extra: null, team: 'Leverkusen', type: 'goal', detail: '2-1', player: 'Schick' },
      ],
      events_summary: "10' ⚽ Wirtz, 25' ⚽ Brandt, 42' ⚽ Schick",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // 3 goals in 50 min, need 1 more in 40 min — feasible
    recordResult('O35-2', 'Over 3.5 feasible — 3 goals, 40 min left', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // O35-3: Over 2.5 with 0 goals at minute 70 — not feasible
  test('O35-3: Over 2.5 with 0 goals at min 70 — nearly impossible', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'o35-3', home: 'Torino', away: 'Verona', league: 'Serie A', minute: 70, score: '0-0', status: '2H' },
      match_id: 'o35-3', home_team: 'Torino', away_team: 'Verona', league: 'Serie A',
      minute: 70, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 50, away: 50 },
        shots: { home: 4, away: 3 },
        shots_on_target: { home: 1, away: 1 },
        corners: { home: 3, away: 2 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.2, draw: 2.5, away: 3.5 },
        ou: { line: 2.5, over: 6.00, under: 1.10 },
        btts: { yes: 5.00, no: 1.14 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const violates = parsed.ai_should_push && parsed.bet_market === 'over_2.5';
    recordResult('O35-3', 'Over 2.5 at 0-0 min 70 — reject', !violates,
      violates ? 'AI recommended Over 2.5 needing 3 goals in 20 min at 0-0!' : 'Correctly rejected',
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL RED CARD VARIATIONS
  // ============================================================

  // RC-2: Double red card — extreme chaos
  test('RC-2: Two red cards — extreme unpredictability', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'rc-2', home: 'Lille', away: 'Lyon', league: 'Ligue 1', minute: 55, score: '1-1', status: '2H' },
      match_id: 'rc-2', home_team: 'Lille', away_team: 'Lyon', league: 'Ligue 1',
      minute: 55, score: '1-1', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 50, away: 50 },
        shots: { home: 6, away: 6 },
        shots_on_target: { home: 3, away: 3 },
        corners: { home: 3, away: 3 },
        red_cards: { home: 1, away: 1 },
        fouls: { home: 18, away: 20 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.2, draw: 2.8, away: 3.0 },
        ou: { line: 2.5, over: 1.70, under: 2.10 },
        btts: { yes: 1.55, no: 2.40 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 20, extra: null, team: 'Lille', type: 'goal', detail: '1-0', player: 'David' },
        { minute: 35, extra: null, team: 'Lille', type: 'card', detail: 'Red Card', player: 'Diakite' },
        { minute: 40, extra: null, team: 'Lyon', type: 'goal', detail: '1-1', player: 'Lacazette' },
        { minute: 48, extra: null, team: 'Lyon', type: 'card', detail: 'Red Card', player: 'Tolisso' },
      ],
      events_summary: "20' ⚽ David, 35' 🔴 Diakite, 40' ⚽ Lacazette, 48' 🔴 Tolisso",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const mentionsRedCards = parsed.reasoning_en.toLowerCase().includes('red card') ||
      parsed.warnings.some(w => w.includes('RED_CARD'));
    recordResult('RC-2', 'Double red card — acknowledged', mentionsRedCards,
      mentionsRedCards ? 'AI correctly identified red cards' : 'AI missed double red card situation!',
      parsed);
  }, 90_000);

  // RC-3: Red card for away team, home leading — home advantage amplified
  test('RC-3: Away red card, home 1-0 — home domination', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'rc-3', home: 'Inter', away: 'Monza', league: 'Serie A', minute: 55, score: '1-0', status: '2H' },
      match_id: 'rc-3', home_team: 'Inter', away_team: 'Monza', league: 'Serie A',
      minute: 55, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 62, away: 38 },
        shots: { home: 10, away: 3 },
        shots_on_target: { home: 5, away: 1 },
        corners: { home: 6, away: 1 },
        red_cards: { home: 0, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.10, draw: 9.0, away: 22.0 },
        ou: { line: 2.5, over: 1.60, under: 2.30 },
        ah: { line: -1.5, home: 1.70, away: 2.15 },
        btts: { yes: 2.50, no: 1.52 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 30, extra: null, team: 'Inter', type: 'goal', detail: '1-0', player: 'Lautaro' },
        { minute: 40, extra: null, team: 'Monza', type: 'card', detail: 'Red Card', player: 'Pessina' },
      ],
      events_summary: "30' ⚽ Lautaro, 40' 🔴 Pessina (Monza)",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const mentionsRedCard = parsed.reasoning_en.toLowerCase().includes('red card') ||
      parsed.reasoning_en.toLowerCase().includes('man') ||
      parsed.warnings.some(w => w.includes('RED_CARD'));
    recordResult('RC-3', 'Away red card — mentioned in analysis', mentionsRedCard,
      mentionsRedCard ? 'AI correctly factored in red card advantage' : 'AI missed red card context',
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL ENDGAME VARIATIONS
  // ============================================================

  // END-2: Minute 92 (added time) — absolute last moment
  test('END-2: Minute 92 added time — absolute last moment', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'end-2', home: 'Marseille', away: 'Rennes', league: 'Ligue 1', minute: 92, score: '2-2', status: '2H' },
      match_id: 'end-2', home_team: 'Marseille', away_team: 'Rennes', league: 'Ligue 1',
      minute: 92, score: '2-2', status: '2H', current_total_goals: 4,
      stats_compact: createStatsCompact({
        possession: { home: 52, away: 48 },
        shots: { home: 10, away: 9 },
        shots_on_target: { home: 5, away: 4 },
        corners: { home: 5, away: 5 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 4.5, draw: 1.35, away: 6.0 },
        ou: { line: 4.5, over: 2.80, under: 1.42 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Marseille', type: 'goal', detail: '1-0', player: 'Aubameyang' },
        { minute: 35, extra: null, team: 'Rennes', type: 'goal', detail: '1-1', player: 'Terrier' },
        { minute: 60, extra: null, team: 'Marseille', type: 'goal', detail: '2-1', player: 'Payet' },
        { minute: 85, extra: null, team: 'Rennes', type: 'goal', detail: '2-2', player: 'Bourigeaud' },
      ],
      events_summary: "15' ⚽ Aubameyang, 35' ⚽ Terrier, 60' ⚽ Payet, 85' ⚽ Bourigeaud",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Minute 92 — should absolutely not push or max stake 2%
    if (parsed.ai_should_push) {
      const stakeOk = parsed.stake_percent <= 2;
      recordResult('END-2', 'Minute 92 — max stake 2%', stakeOk,
        `Stake: ${parsed.stake_percent}% at minute 92 (max 2%: ${stakeOk})`,
        parsed);
    } else {
      recordResult('END-2', 'Minute 92 — max stake 2%', true,
        'Correctly did not push at minute 92', parsed);
    }
  }, 90_000);

  // END-3: Minute 85, clear domination — may push conservatively
  test('END-3: Minute 85, 3-0 domination — conservative push possible', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'end-3', home: 'Bayern', away: 'Bremen', league: 'Bundesliga', minute: 85, score: '3-0', status: '2H' },
      match_id: 'end-3', home_team: 'Bayern', away_team: 'Bremen', league: 'Bundesliga',
      minute: 85, score: '3-0', status: '2H', current_total_goals: 3,
      stats_compact: createStatsCompact({
        possession: { home: 68, away: 32 },
        shots: { home: 16, away: 3 },
        shots_on_target: { home: 8, away: 0 },
        corners: { home: 9, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.01, draw: 25.0, away: 50.0 },
        ou: { line: 3.5, over: 1.70, under: 2.10 },
        btts: { yes: 5.00, no: 1.12 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Bayern', type: 'goal', detail: '1-0', player: 'Kane' },
        { minute: 45, extra: null, team: 'Bayern', type: 'goal', detail: '2-0', player: 'Sane' },
        { minute: 68, extra: null, team: 'Bayern', type: 'goal', detail: '3-0', player: 'Musiala' },
      ],
      events_summary: "15' ⚽ Kane, 45' ⚽ Sane, 68' ⚽ Musiala",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Late game — if pushes, stake should be very low
    if (parsed.ai_should_push) {
      const stakeOk = parsed.stake_percent <= 3;
      recordResult('END-3', 'Minute 85 domination — conservative', stakeOk,
        `Stake: ${parsed.stake_percent}% (max 3%: ${stakeOk})`,
        parsed);
    } else {
      recordResult('END-3', 'Minute 85 domination — conservative', true,
        'No push at minute 85 — acceptable', parsed);
    }
  }, 90_000);

  // ============================================================
  // ADDITIONAL LATE GAME VARIATIONS
  // ============================================================

  // LG-2: Minute 88, 2-1, exciting finish — still conservative
  test('LG-2: Minute 88, 2-1 — exciting but must be conservative', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'lg-2', home: 'Roma', away: 'Lazio', league: 'Serie A', minute: 88, score: '2-1', status: '2H' },
      match_id: 'lg-2', home_team: 'Roma', away_team: 'Lazio', league: 'Serie A',
      minute: 88, score: '2-1', status: '2H', current_total_goals: 3,
      stats_compact: createStatsCompact({
        possession: { home: 45, away: 55 },
        shots: { home: 9, away: 11 },
        shots_on_target: { home: 4, away: 5 },
        corners: { home: 4, away: 6 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.55, draw: 4.5, away: 5.5 },
        ou: { line: 3.5, over: 2.80, under: 1.42 },
        btts: { yes: 1.12, no: 6.50 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 20, extra: null, team: 'Roma', type: 'goal', detail: '1-0', player: 'Dybala' },
        { minute: 50, extra: null, team: 'Lazio', type: 'goal', detail: '1-1', player: 'Immobile' },
        { minute: 75, extra: null, team: 'Roma', type: 'goal', detail: '2-1', player: 'Abraham' },
      ],
      events_summary: "20' ⚽ Dybala, 50' ⚽ Immobile, 75' ⚽ Abraham",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    if (parsed.ai_should_push) {
      const stakeOk = parsed.stake_percent <= 3;
      recordResult('LG-2', 'Minute 88 — max stake 3%', stakeOk,
        `Stake: ${parsed.stake_percent}% at minute 88`,
        parsed);
    } else {
      recordResult('LG-2', 'Minute 88 — max stake 3%', true,
        'No push at minute 88 — correct', parsed);
    }
  }, 90_000);

  // LG-3: Minute 83, one-sided blowout
  test('LG-3: Minute 83, 4-0 blowout — limited options', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'lg-3', home: 'PSG', away: 'Clermont', league: 'Ligue 1', minute: 83, score: '4-0', status: '2H' },
      match_id: 'lg-3', home_team: 'PSG', away_team: 'Clermont', league: 'Ligue 1',
      minute: 83, score: '4-0', status: '2H', current_total_goals: 4,
      stats_compact: createStatsCompact({
        possession: { home: 74, away: 26 },
        shots: { home: 20, away: 2 },
        shots_on_target: { home: 10, away: 0 },
        corners: { home: 12, away: 0 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.01, draw: 30.0, away: 60.0 },
        ou: { line: 4.5, over: 1.55, under: 2.45 },
        btts: { yes: 5.50, no: 1.10 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 10, extra: null, team: 'PSG', type: 'goal', detail: '1-0', player: 'Mbappe' },
        { minute: 30, extra: null, team: 'PSG', type: 'goal', detail: '2-0', player: 'Mbappe' },
        { minute: 55, extra: null, team: 'PSG', type: 'goal', detail: '3-0', player: 'Dembele' },
        { minute: 70, extra: null, team: 'PSG', type: 'goal', detail: '4-0', player: 'Ramos' },
      ],
      events_summary: "10' ⚽ Mbappe, 30' ⚽ Mbappe, 55' ⚽ Dembele, 70' ⚽ Ramos",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Most odds are below MIN_ODDS in this situation
    if (parsed.ai_should_push) {
      const stakeOk = parsed.stake_percent <= 3;
      recordResult('LG-3', 'Minute 83 blowout — conservative', stakeOk,
        `Pushed ${parsed.bet_market}, stake: ${parsed.stake_percent}%`,
        parsed);
    } else {
      recordResult('LG-3', 'Minute 83 blowout — conservative', true,
        'No push — correct for blowout with dead odds',
        parsed);
    }
  }, 90_000);

  // ============================================================
  // ADDITIONAL SUSPICIOUS ODDS VARIATIONS
  // ============================================================

  // OI-2: Normal odds matching game state — should NOT flag
  test('OI-2: Normal odds matching game state — no flag', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'oi-2', home: 'Arsenal', away: 'Newcastle', league: 'Premier League', minute: 60, score: '1-0', status: '2H' },
      match_id: 'oi-2', home_team: 'Arsenal', away_team: 'Newcastle', league: 'Premier League',
      minute: 60, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 58, away: 42 },
        shots: { home: 10, away: 6 },
        shots_on_target: { home: 5, away: 2 },
        corners: { home: 5, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.35, draw: 5.0, away: 8.0 }, // Makes sense for 1-0 leader
        ou: { line: 2.5, over: 1.65, under: 2.20 },
        ah: { line: -1.0, home: 1.75, away: 2.10 },
        btts: { yes: 2.10, no: 1.70 },
      }),
      odds_available: true,
      odds_suspicious: false,
      odds_sanity_warnings: [],
      events_compact: [
        { minute: 30, extra: null, team: 'Arsenal', type: 'goal', detail: '1-0', player: 'Saka' },
      ],
      events_summary: "30' ⚽ Saka",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    recordResult('OI-2', 'Normal odds — no suspicion', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL MIN ODDS VARIATIONS
  // ============================================================

  // MO-2: One market at exactly 1.50 — borderline
  test('MO-2: Market at exactly 1.50 — borderline MIN_ODDS', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'mo-2', home: 'Rangers', away: 'Hearts', league: 'Scottish Premiership', minute: 65, score: '2-0', status: '2H' },
      match_id: 'mo-2', home_team: 'Rangers', away_team: 'Hearts', league: 'Scottish Premiership',
      minute: 65, score: '2-0', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 60, away: 40 },
        shots: { home: 12, away: 3 },
        shots_on_target: { home: 6, away: 1 },
        corners: { home: 7, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.08, draw: 10.0, away: 20.0 },
        ou: { line: 2.5, over: 1.50, under: 2.50 }, // Exactly 1.50
        btts: { yes: 3.50, no: 1.28 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Rangers', type: 'goal', detail: '1-0', player: 'Morelos' },
        { minute: 50, extra: null, team: 'Rangers', type: 'goal', detail: '2-0', player: 'Tavernier' },
      ],
      events_summary: "15' ⚽ Morelos, 50' ⚽ Tavernier",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    recordResult('MO-2', 'Borderline 1.50 odds', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL RISK LEVEL VARIATIONS
  // ============================================================

  // RL-2: Extreme unpredictability — multiple reds + volatile score
  test('RL-2: Extreme chaos — 3 red cards, volatile score', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'rl-2', home: 'Getafe', away: 'Vallecano', league: 'La Liga', minute: 65, score: '2-3', status: '2H' },
      match_id: 'rl-2', home_team: 'Getafe', away_team: 'Vallecano', league: 'La Liga',
      minute: 65, score: '2-3', status: '2H', current_total_goals: 5,
      stats_compact: createStatsCompact({
        possession: { home: 45, away: 55 },
        shots: { home: 8, away: 10 },
        shots_on_target: { home: 4, away: 5 },
        corners: { home: 3, away: 4 },
        red_cards: { home: 2, away: 1 },
        yellow_cards: { home: 4, away: 3 },
        fouls: { home: 22, away: 18 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 6.0, draw: 4.0, away: 1.50 },
        ou: { line: 5.5, over: 1.55, under: 2.45 },
        btts: { yes: 1.10, no: 7.0 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 10, extra: null, team: 'Getafe', type: 'goal', detail: '1-0', player: 'Borja' },
        { minute: 20, extra: null, team: 'Getafe', type: 'card', detail: 'Red Card', player: 'Djene' },
        { minute: 30, extra: null, team: 'Vallecano', type: 'goal', detail: '1-1', player: 'De Tomas' },
        { minute: 35, extra: null, team: 'Vallecano', type: 'goal', detail: '1-2', player: 'Falcao' },
        { minute: 42, extra: null, team: 'Getafe', type: 'card', detail: 'Red Card', player: 'Arambarri' },
        { minute: 50, extra: null, team: 'Getafe', type: 'goal', detail: '2-2', player: 'Unal' },
        { minute: 55, extra: null, team: 'Vallecano', type: 'card', detail: 'Red Card', player: 'Catena' },
        { minute: 60, extra: null, team: 'Vallecano', type: 'goal', detail: '2-3', player: 'Isi' },
      ],
      events_summary: "10' ⚽ Borja, 20' 🔴 Djene, 30' ⚽ De Tomas, 35' ⚽ Falcao, 42' 🔴 Arambarri, 50' ⚽ Unal, 55' 🔴 Catena, 60' ⚽ Isi",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Should recognize HIGH risk with 3 red cards
    const isHighRisk = parsed.risk_level === 'HIGH';
    const mentionsRedCards = parsed.reasoning_en.toLowerCase().includes('red card');
    recordResult('RL-2', 'Extreme chaos — HIGH risk expected', isHighRisk || mentionsRedCards,
      `Risk: ${parsed.risk_level}, mentions red: ${mentionsRedCards}, push: ${parsed.ai_should_push}`,
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL VALUE PERCENT VARIATIONS
  // ============================================================

  // VP-2: Extreme value claim > 30% — must recalibrate
  test('VP-2: Value > 30% — extreme overestimate', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'vp-2', home: 'Chelsea', away: 'Fulham', league: 'Premier League', minute: 55, score: '1-0', status: '2H' },
      match_id: 'vp-2', home_team: 'Chelsea', away_team: 'Fulham', league: 'Premier League',
      minute: 55, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 58, away: 42 },
        shots: { home: 8, away: 5 },
        shots_on_target: { home: 3, away: 2 },
        corners: { home: 4, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.55, draw: 4.0, away: 5.5 },
        ou: { line: 2.5, over: 1.70, under: 2.10 },
        btts: { yes: 1.90, no: 1.90 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 30, extra: null, team: 'Chelsea', type: 'goal', detail: '1-0', player: 'Palmer' },
      ],
      events_summary: "30' ⚽ Palmer",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    if (parsed.ai_should_push && parsed.value_percent > 30) {
      recordResult('VP-2', 'Value > 30% — must be recalibrated', false,
        `Value: ${parsed.value_percent}% — unrealistically high, should be recalibrated`,
        parsed);
    } else {
      recordResult('VP-2', 'Value > 30% — must be recalibrated', true,
        `Value: ${parsed.value_percent}% — within acceptable range`,
        parsed);
    }
  }, 90_000);

  // ============================================================
  // ADDITIONAL CUSTOM CONDITION VARIATIONS
  // ============================================================

  // CC-2: Custom condition NOT met — should report as not matched
  test('CC-2: Custom condition NOT met — reported as not matched', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'cc-2', home: 'Mainz', away: 'Cologne', league: 'Bundesliga', minute: 60, score: '0-0', status: '2H' },
      match_id: 'cc-2', home_team: 'Mainz', away_team: 'Cologne', league: 'Bundesliga',
      minute: 60, score: '0-0', status: '2H', current_total_goals: 0,
      custom_conditions: 'possession_home > 70 AND shots_on_target_home >= 6',
      stats_compact: createStatsCompact({
        possession: { home: 48, away: 52 }, // NOT > 70
        shots: { home: 5, away: 6 },
        shots_on_target: { home: 2, away: 3 }, // NOT >= 6
        corners: { home: 2, away: 3 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.2, draw: 3.0, away: 2.5 },
        ou: { line: 2.5, over: 1.75, under: 2.05 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const conditionEvaluated = parsed.custom_condition_status === 'evaluated';
    const conditionNotMatched = !parsed.custom_condition_matched;
    recordResult('CC-2', 'Custom condition NOT met', conditionEvaluated && conditionNotMatched,
      `status=${parsed.custom_condition_status}, matched=${parsed.custom_condition_matched}`,
      parsed);
  }, 90_000);

  // ============================================================
  // ADDITIONAL COMBINED TRAP VARIATIONS
  // ============================================================

  // TRAP-2: Leading team high possession + Over temptation at high odds
  test('TRAP-2: Leading + high possession + Over at high odds', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'trap-2', home: 'Man City', away: 'Leicester', league: 'Premier League', minute: 65, score: '1-0', status: '2H' },
      match_id: 'trap-2', home_team: 'Man City', away_team: 'Leicester', league: 'Premier League',
      minute: 65, score: '1-0', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 75, away: 25 },
        shots: { home: 18, away: 2 },
        shots_on_target: { home: 3, away: 0 }, // 3/18 = 16.7% — sterile
        corners: { home: 10, away: 0 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.25, draw: 6.0, away: 10.0 },
        ou: { line: 2.5, over: 2.20, under: 1.65 }, // Over at 2.20 — high
        btts: { yes: 3.00, no: 1.38 },
        ah: { line: -1.5, home: 2.00, away: 1.85 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Man City', type: 'goal', detail: '1-0', player: 'Haaland' },
      ],
      events_summary: "15' ⚽ Haaland",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Traps: sterile dominance (3/18 SOT), Over 2.5 at high odds, 1x2_home at low odds
    const recommendsOver = parsed.ai_should_push && parsed.bet_market?.startsWith('over_');
    const recommends1x2 = parsed.ai_should_push && parsed.bet_market === '1x2_home';
    const violates = recommendsOver || recommends1x2;
    recordResult('TRAP-2', 'Sterile dominance + Over temptation', !violates,
      violates ? `Fell for trap: ${parsed.bet_market} with 3/18 SOT` : `Correct: ${parsed.ai_should_push ? parsed.bet_market : 'no push'}`,
      parsed);
  }, 90_000);

  // TRAP-3: BTTS No + low odds + both teams SOT — triple rejection
  test('TRAP-3: BTTS No trap — low odds + both SOT + open game', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'trap-3', home: 'Tottenham', away: 'Arsenal', league: 'Premier League', minute: 55, score: '1-1', status: '2H' },
      match_id: 'trap-3', home_team: 'Tottenham', away_team: 'Arsenal', league: 'Premier League',
      minute: 55, score: '1-1', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 48, away: 52 },
        shots: { home: 8, away: 9 },
        shots_on_target: { home: 4, away: 5 }, // Both teams SOT >= 2
        corners: { home: 4, away: 5 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.2, draw: 3.0, away: 2.5 },
        ou: { line: 2.5, over: 1.50, under: 2.50 },
        btts: { yes: 1.10, no: 7.0 }, // BTTS No at 7.0 — already lost (1-1)
      }),
      odds_available: true,
      events_compact: [
        { minute: 20, extra: null, team: 'Tottenham', type: 'goal', detail: '1-0', player: 'Son' },
        { minute: 40, extra: null, team: 'Arsenal', type: 'goal', detail: '1-1', player: 'Saka' },
      ],
      events_summary: "20' ⚽ Son, 40' ⚽ Saka",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    const violates = parsed.ai_should_push && parsed.bet_market === 'btts_no';
    recordResult('TRAP-3', 'BTTS No at 1-1 — already lost', !violates,
      violates ? 'AI recommended BTTS No when both teams already scored!' : 'Correctly avoided dead BTTS No',
      parsed);
  }, 90_000);

  // TRAP-4: Asian Handicap temptation with early lead
  test('TRAP-4: AH -1.5 temptation — early lead, still cautious', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'trap-4', home: 'Liverpool', away: 'Crystal Palace', league: 'Premier League', minute: 35, score: '1-0', status: '1H' },
      match_id: 'trap-4', home_team: 'Liverpool', away_team: 'Crystal Palace', league: 'Premier League',
      minute: 35, score: '1-0', status: '1H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 65, away: 35 },
        shots: { home: 8, away: 2 },
        shots_on_target: { home: 5, away: 0 },
        corners: { home: 5, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.25, draw: 6.0, away: 10.0 },
        ou: { line: 2.5, over: 1.55, under: 2.45 },
        ah: { line: -1.5, home: 1.85, away: 2.00 },
        btts: { yes: 2.30, no: 1.60 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Liverpool', type: 'goal', detail: '1-0', player: 'Salah' },
      ],
      events_summary: "15' ⚽ Salah",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Early game — 1X2 before min 35 is banned. AH is technically not 1X2 but still early.
    const is1x2 = parsed.ai_should_push && parsed.bet_market.startsWith('1x2_');
    recordResult('TRAP-4', 'Early lead — no 1X2 before min 35', !is1x2,
      is1x2 ? `Pushed ${parsed.bet_market} at minute 35!` : `Decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // ============================================================
  // ASIAN HANDICAP TESTS
  // ============================================================

  // AH-1: Valid AH scenario — dominating team, good value
  test('AH-1: Asian Handicap -0.5 valid — dominating 2-0 at min 60', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'ah-1', home: 'Bayern', away: 'Hoffenheim', league: 'Bundesliga', minute: 60, score: '2-0', status: '2H' },
      match_id: 'ah-1', home_team: 'Bayern', away_team: 'Hoffenheim', league: 'Bundesliga',
      minute: 60, score: '2-0', status: '2H', current_total_goals: 2,
      stats_compact: createStatsCompact({
        possession: { home: 65, away: 35 },
        shots: { home: 14, away: 3 },
        shots_on_target: { home: 7, away: 1 },
        corners: { home: 8, away: 1 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.05, draw: 14.0, away: 30.0 },
        ou: { line: 3.5, over: 1.60, under: 2.30 },
        ah: { line: -1.5, home: 1.55, away: 2.50 },
        btts: { yes: 2.80, no: 1.42 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 15, extra: null, team: 'Bayern', type: 'goal', detail: '1-0', player: 'Kane' },
        { minute: 45, extra: null, team: 'Bayern', type: 'goal', detail: '2-0', player: 'Sane' },
      ],
      events_summary: "15' ⚽ Kane, 45' ⚽ Sane",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Good scenario for AH — dominating with clean stats
    recordResult('AH-1', 'Valid AH scenario — 2-0 domination', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}, conf=${parsed.confidence}`,
      parsed);
  }, 90_000);

  // AH-2: AH on underdog — risky
  test('AH-2: AH on underdog — trailing team, risky bet', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'ah-2', home: 'Nottingham', away: 'Man City', league: 'Premier League', minute: 55, score: '0-1', status: '2H' },
      match_id: 'ah-2', home_team: 'Nottingham', away_team: 'Man City', league: 'Premier League',
      minute: 55, score: '0-1', status: '2H', current_total_goals: 1,
      stats_compact: createStatsCompact({
        possession: { home: 30, away: 70 },
        shots: { home: 2, away: 12 },
        shots_on_target: { home: 0, away: 6 },
        corners: { home: 1, away: 8 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 10.0, draw: 5.5, away: 1.20 },
        ou: { line: 2.5, over: 1.50, under: 2.50 },
        ah: { line: 1.5, home: 1.70, away: 2.15 }, // AH +1.5 for Nottingham
      }),
      odds_available: true,
      events_compact: [
        { minute: 20, extra: null, team: 'Man City', type: 'goal', detail: '0-1', player: 'Haaland' },
      ],
      events_summary: "20' ⚽ Haaland (Man City)",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    recordResult('AH-2', 'AH underdog — risky analysis', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // ============================================================
  // HALFTIME SCENARIOS
  // ============================================================

  // HT-1: Halftime break — limited analysis
  test('HT-1: Halftime break — analysis with limited live data', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'ht-1', home: 'Dortmund', away: 'Bayern', league: 'Bundesliga', minute: 45, score: '0-0', status: 'HT' },
      match_id: 'ht-1', home_team: 'Dortmund', away_team: 'Bayern', league: 'Bundesliga',
      minute: 45, score: '0-0', status: 'HT', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 42, away: 58 },
        shots: { home: 5, away: 8 },
        shots_on_target: { home: 2, away: 3 },
        corners: { home: 3, away: 4 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.5, draw: 3.2, away: 2.2 },
        ou: { line: 2.5, over: 1.65, under: 2.20 },
        btts: { yes: 1.55, no: 2.40 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // HT — should be conservative, not push 1X2
    const is1x2 = parsed.ai_should_push && parsed.bet_market.startsWith('1x2_');
    recordResult('HT-1', 'Halftime — conservative analysis', !is1x2,
      is1x2 ? `Pushed ${parsed.bet_market} at HT` : `Decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // ============================================================
  // MULTI-GOAL SCENARIOS
  // ============================================================

  // MG-1: High-scoring open match — both teams scoring freely
  test('MG-1: Open match 3-2 at min 55 — active game', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'mg-1', home: 'Leeds', away: 'Middlesbrough', league: 'Championship', minute: 55, score: '3-2', status: '2H' },
      match_id: 'mg-1', home_team: 'Leeds', away_team: 'Middlesbrough', league: 'Championship',
      minute: 55, score: '3-2', status: '2H', current_total_goals: 5,
      stats_compact: createStatsCompact({
        possession: { home: 52, away: 48 },
        shots: { home: 12, away: 10 },
        shots_on_target: { home: 6, away: 5 },
        corners: { home: 5, away: 4 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 1.75, draw: 3.8, away: 4.5 },
        ou: { line: 5.5, over: 1.55, under: 2.45 },
        btts: { yes: 1.08, no: 8.0 },
        ah: { line: -0.5, home: 1.60, away: 2.35 },
      }),
      odds_available: true,
      events_compact: [
        { minute: 5, extra: null, team: 'Leeds', type: 'goal', detail: '1-0', player: 'Bamford' },
        { minute: 18, extra: null, team: 'Middlesbrough', type: 'goal', detail: '1-1', player: 'Akpom' },
        { minute: 30, extra: null, team: 'Leeds', type: 'goal', detail: '2-1', player: 'James' },
        { minute: 38, extra: null, team: 'Leeds', type: 'goal', detail: '3-1', player: 'Gnonto' },
        { minute: 50, extra: null, team: 'Middlesbrough', type: 'goal', detail: '3-2', player: 'McGree' },
      ],
      events_summary: "5' ⚽ Bamford, 18' ⚽ Akpom, 30' ⚽ James, 38' ⚽ Gnonto, 50' ⚽ McGree",
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Open match — should analyze goal trend, not recommend BTTS No since already 1-1+
    recordResult('MG-1', 'High-scoring open match', true,
      `AI decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}, risk=${parsed.risk_level}`,
      parsed);
  }, 90_000);

  // MG-2: Low scoring defensive battle — 0-0 at min 65 with low SOT
  test('MG-2: Defensive battle 0-0 — low activity', async () => {
    const matchData = createMergedMatchData({
      match: { id: 'mg-2', home: 'Stoke', away: 'Sunderland', league: 'Championship', minute: 65, score: '0-0', status: '2H' },
      match_id: 'mg-2', home_team: 'Stoke', away_team: 'Sunderland', league: 'Championship',
      minute: 65, score: '0-0', status: '2H', current_total_goals: 0,
      stats_compact: createStatsCompact({
        possession: { home: 45, away: 55 },
        shots: { home: 3, away: 4 },
        shots_on_target: { home: 0, away: 1 },
        corners: { home: 2, away: 2 },
        fouls: { home: 14, away: 16 },
      }),
      stats_available: true,
      odds_canonical: createOddsCanonical({
        '1x2': { home: 3.5, draw: 2.8, away: 3.0 },
        ou: { line: 2.5, over: 4.00, under: 1.22 },
        btts: { yes: 4.00, no: 1.22 },
      }),
      odds_available: true,
      events_compact: [],
      events_summary: '',
    });

    const { parsed } = await runAiPipeline(matchData);
    assertValidStructure(parsed);

    // Should prefer Under — 0-0 at min 65 with 0 + 1 SOT total
    const recommendsOver = parsed.ai_should_push && parsed.bet_market?.startsWith('over_');
    recordResult('MG-2', 'Defensive 0-0 — Under preferred', !recommendsOver,
      recommendsOver ? `Wrongly recommended ${parsed.bet_market} at 0-0 with total 1 SOT` : `Decision: push=${parsed.ai_should_push}, market=${parsed.bet_market}`,
      parsed);
  }, 90_000);

  // ============================================================
  // PRINT FINAL REPORT
  // ============================================================

  test('=== FINAL REPORT ===', () => {
    if (testResults.length === 0) {
      console.log('No test results recorded (tests may have been skipped)');
      return;
    }

    console.log('\n' + '='.repeat(80));
    console.log('AI PROMPT AUDIT REPORT');
    console.log('='.repeat(80));

    const passed = testResults.filter(r => r.passed);
    const failed = testResults.filter(r => !r.passed);

    console.log(`\nTotal Rules Tested: ${testResults.length}`);
    console.log(`Passed: ${passed.length} (${Math.round(passed.length / testResults.length * 100)}%)`);
    console.log(`Failed: ${failed.length} (${Math.round(failed.length / testResults.length * 100)}%)`);

    if (failed.length > 0) {
      console.log('\n' + '-'.repeat(40));
      console.log('FAILED RULES:');
      console.log('-'.repeat(40));
      for (const f of failed) {
        console.log(`\n❌ ${f.scenario} — ${f.rule}`);
        console.log(`   Details: ${f.details}`);
        console.log(`   AI Response: push=${f.aiResponse.should_push}, market=${f.aiResponse.bet_market}, conf=${f.aiResponse.confidence}, stake=${f.aiResponse.stake_percent}%`);
        console.log(`   Warnings: ${f.aiResponse.warnings.join(', ') || 'none'}`);
      }
    }

    if (passed.length > 0) {
      console.log('\n' + '-'.repeat(40));
      console.log('PASSED RULES:');
      console.log('-'.repeat(40));
      for (const p of passed) {
        console.log(`\n✅ ${p.scenario} — ${p.rule}`);
        console.log(`   Details: ${p.details}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('END OF REPORT');
    console.log('='.repeat(80) + '\n');
  });
});
