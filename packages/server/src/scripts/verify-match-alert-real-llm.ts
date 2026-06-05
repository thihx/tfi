import { config } from '../config.js';
import { adjudicateMatchAlertWithLlm } from '../lib/match-alert-llm.js';
import { SYSTEM_CONDITION_ALERT_PRESETS } from '../lib/match-alert-presets.js';
import { evaluateMatchAlertRule, type MatchAlertContext } from '../lib/match-alert-rule-engine.js';
import type { MatchAlertRule } from '../repos/match-alert-rules.repo.js';

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function baseContext(overrides: Partial<MatchAlertContext> = {}): MatchAlertContext {
  return {
    matchId: 'real-llm-smoke-1001',
    status: '2H',
    minute: 62,
    kickoffAtUtc: '2026-06-05T11:00:00.000Z',
    nowIso: '2026-06-05T12:02:00.000Z',
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    leagueName: 'Premier League',
    score: {
      home: 1,
      away: 1,
      total: 2,
      state: 'draw',
      leadingSide: null,
      losingSide: null,
    },
    stats: {
      shots_on_target: { home: 4, away: 3 },
      corners: { home: 5, away: 4 },
    },
    events: {},
    derived: {
      corners_total: 9,
      sot_diff: { home: 1, away: -1 },
    },
    dataFreshness: { snapshotAgeSeconds: 20 },
    ...overrides,
  };
}

const contexts: Record<string, MatchAlertContext> = {
  away_scores_first: baseContext({
    minute: 18,
    score: { home: 0, away: 1, total: 1, state: 'away_leading', leadingSide: 'away', losingSide: 'home' },
    events: { first_goal: { side: 'away', minute: 18 }, last_goal: { side: 'away', minute: 18, type: 'lead_change' } },
  }),
  red_card: baseContext({
    minute: 54,
    events: { red_card: { side: 'home', minute: 54 } },
  }),
  leading_team_red_card: baseContext({
    minute: 62,
    score: { home: 0, away: 1, total: 1, state: 'away_leading', leadingSide: 'away', losingSide: 'home' },
    events: { red_card: { side: 'away', minute: 62 }, first_goal: { side: 'away', minute: 18 } },
  }),
  equalizer_after_60: baseContext({
    minute: 66,
    score: { home: 1, away: 1, total: 2, state: 'draw', leadingSide: null, losingSide: null },
    events: { last_goal: { side: 'away', minute: 66, type: 'equalizer' } },
  }),
  late_goal_after_75: baseContext({
    minute: 78,
    score: { home: 2, away: 1, total: 3, state: 'home_leading', leadingSide: 'home', losingSide: 'away' },
    events: { last_goal: { side: 'home', minute: 78, type: 'lead_change' } },
  }),
  zero_zero_pressure_after_55: baseContext({
    minute: 58,
    score: { home: 0, away: 0, total: 0, state: 'draw', leadingSide: null, losingSide: null },
    stats: { shots_on_target: { home: 3, away: 2 }, corners: { home: 5, away: 4 } },
    derived: { corners_total: 9, sot_diff: { home: 1, away: -1 } },
  }),
  home_pressure_no_goal: baseContext({
    minute: 34,
    score: { home: 0, away: 0, total: 0, state: 'draw', leadingSide: null, losingSide: null },
    stats: { shots_on_target: { home: 5, away: 1 }, corners: { home: 4, away: 1 } },
    derived: { corners_total: 5, sot_diff: { home: 4, away: -4 } },
  }),
  away_pressure_no_goal: baseContext({
    minute: 37,
    score: { home: 0, away: 0, total: 0, state: 'draw', leadingSide: null, losingSide: null },
    stats: { shots_on_target: { home: 1, away: 5 }, corners: { home: 1, away: 5 } },
    derived: { corners_total: 6, sot_diff: { home: -4, away: 4 } },
  }),
  corner_pressure: baseContext({
    minute: 50,
    score: { home: 0, away: 0, total: 0, state: 'draw', leadingSide: null, losingSide: null },
    stats: { shots_on_target: { home: 2, away: 2 }, corners: { home: 5, away: 3 } },
    derived: { corners_total: 8, sot_diff: { home: 0, away: 0 } },
  }),
  early_red_card_trap: baseContext({
    minute: 28,
    events: { red_card: { side: 'away', minute: 28 } },
  }),
};

function fakeRule(index: number, presetId: string, ruleJson: Record<string, unknown>): MatchAlertRule {
  return {
    id: index + 1,
    userId: 'real-llm-smoke-user',
    matchId: contexts[presetId]?.matchId ?? 'real-llm-smoke-1001',
    alertKind: 'condition_signal',
    enabled: true,
    source: `preset:${presetId}`,
    sourceRef: {},
    ruleJson,
    compiledStatus: 'compiled',
    cooldownMinutes: 10,
    oncePerMatch: true,
    channelPolicy: {},
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  if (!hasFlag('--allow-real-llm')) {
    throw new Error('Real LLM verification requires --allow-real-llm.');
  }
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY not configured.');
  }

  const rows: Array<{ id: string; shouldPush: boolean; confidence: number; action: string; summary: string }> = [];
  for (const [index, preset] of SYSTEM_CONDITION_ALERT_PRESETS.entries()) {
    const context = contexts[preset.id];
    if (!context) throw new Error(`Missing real LLM smoke context for preset ${preset.id}`);
    const evaluation = evaluateMatchAlertRule('condition_signal', preset.ruleJson, context);
    if (!evaluation.supported || !evaluation.matched) {
      throw new Error(`Preset ${preset.id} did not match its smoke context: ${evaluation.unsupportedReason ?? 'not matched'}`);
    }
    const decision = await adjudicateMatchAlertWithLlm({
      rule: fakeRule(index, preset.id, preset.ruleJson as Record<string, unknown>),
      context,
      evaluation,
    });
    if (!decision.summaryVi || !decision.reasonVi) {
      throw new Error(`Preset ${preset.id} returned an incomplete LLM decision.`);
    }
    rows.push({
      id: preset.id,
      shouldPush: decision.shouldPush,
      confidence: decision.confidence,
      action: decision.suggestedAction,
      summary: decision.summaryVi,
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  console.table(rows);
  console.log(`Verified ${rows.length} match alert presets with real Gemini model ${config.geminiMatchAlertModel}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
