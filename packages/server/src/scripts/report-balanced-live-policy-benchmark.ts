import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';
import { applyRecommendationPolicy, type RecommendationPolicyInput } from '../lib/recommendation-policy.js';

interface Args {
  blockedJson: string;
  livenessJson?: string;
  noSaveJson?: string;
  outJson?: string;
  outMd?: string;
  enableBalancedPocket?: boolean;
}

interface BlockedSelectionRow {
  auditLogId: number;
  timestamp: string;
  matchDisplay: string;
  canonicalMarket: string;
  selection: string;
  minute: number | null;
  score: string;
  evidenceMode: string;
  confidence: number | null;
  valuePercent?: number | null;
  riskLevel?: string;
  odds: number | null;
  policyWarnings: string[];
  settlementStatus: string;
  result: string | null;
  pnlPercent: number | null;
}

interface BlockedSelectionReport {
  generatedAt: string;
  lookbackHours: number;
  totalSelections: number;
  settledRows: number;
  wins: number;
  losses: number;
  pushLike: number;
  totalPnlPercent: number;
  roiOnStaked: number;
  rows: BlockedSelectionRow[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { blockedJson: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--blocked-json' && next) {
      args.blockedJson = resolve(process.cwd(), next);
      i++;
    } else if (arg === '--liveness-json' && next) {
      args.livenessJson = resolve(process.cwd(), next);
      i++;
    } else if (arg === '--no-save-json' && next) {
      args.noSaveJson = resolve(process.cwd(), next);
      i++;
    } else if (arg === '--out-json' && next) {
      args.outJson = resolve(process.cwd(), next);
      i++;
    } else if (arg === '--out-md' && next) {
      args.outMd = resolve(process.cwd(), next);
      i++;
    } else if (arg === '--enable-balanced-pocket') {
      args.enableBalancedPocket = true;
    }
  }
  if (!args.blockedJson) {
    throw new Error('Usage: tsx src/scripts/report-balanced-live-policy-benchmark.ts --blocked-json <current-runtime-blocked-selection.json> [--liveness-json <pipeline-liveness.json>] [--no-save-json <current-runtime-no-save.json>] [--out-json <file>] [--out-md <file>] [--enable-balanced-pocket]');
  }
  return args;
}

function setBalancedLivePolicyEnabled(enabled: boolean): void {
  (config as unknown as { policyBalancedLiveEnabled: boolean }).policyBalancedLiveEnabled = enabled;
}

function readJson<T>(path: string | undefined): T | null {
  if (!path) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function scoreState(score: string): 'unknown' | 'level' | 'one-goal-margin' | 'two-plus-margin' {
  const match = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return 'unknown';
  const diff = Math.abs(Number(match[1] ?? 0) - Number(match[2] ?? 0));
  if (diff === 0) return 'level';
  if (diff === 1) return 'one-goal-margin';
  return 'two-plus-margin';
}

function getAhLine(canonicalMarket: string): number | null {
  const match = String(canonicalMarket || '').match(/^asian_handicap_(?:home|away)_([+-]?\d+(?:\.\d+)?)$/);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function resultBucket(result: string | null): 'win' | 'loss' | 'push_like' | 'unknown' {
  const normalized = String(result || '').trim().toLowerCase();
  if (normalized === 'win' || normalized === 'half_win') return 'win';
  if (normalized === 'loss' || normalized === 'half_loss') return 'loss';
  if (normalized === 'push' || normalized === 'void') return 'push_like';
  return 'unknown';
}

function pocketReason(row: BlockedSelectionRow): string | null {
  if (row.settlementStatus !== 'settled_rules') return 'unsettled_or_unsupported';
  if (row.evidenceMode !== 'full_live_data') return 'not_full_live_data';
  if (row.minute == null) return 'missing_minute';
  if (row.odds == null || !Number.isFinite(row.odds)) return 'missing_odds';
  if (row.odds < config.policyBalancedLiveMinOdds) return 'odds_below_balanced_min';
  if (row.odds > config.policyBalancedLiveMaxOdds) return 'odds_above_balanced_max';
  if ((row.confidence ?? 0) < config.policyBalancedLiveMinConfidence) return 'confidence_below_balanced_min';
  if (row.valuePercent == null) return 'missing_value_percent';
  if (row.valuePercent < config.policyBalancedLiveMinEdge) return 'edge_below_balanced_min';
  if (String(row.riskLevel || '').trim().toUpperCase() === 'HIGH') return 'high_risk';

  if (row.canonicalMarket === 'over_1.5') {
    return row.minute >= 60 && row.minute < 85 && scoreState(row.score) === 'one-goal-margin'
      ? null
      : 'over_15_context_mismatch';
  }

  if (row.canonicalMarket.startsWith('asian_handicap_')) {
    const line = getAhLine(row.canonicalMarket);
    if (line == null) return 'ah_line_missing';
    const absLine = Math.abs(line);
    const score = scoreState(row.score);
    return row.minute >= 45
      && row.minute < 85
      && absLine >= 0.25
      && absLine <= 0.75
      && (score === 'level' || score === 'one-goal-margin')
      ? null
      : 'ah_context_mismatch';
  }

  return 'market_not_in_balanced_pocket';
}

function summarizeRows(rows: BlockedSelectionRow[]) {
  const totalPnlPercent = round(rows.reduce((sum, row) => sum + (row.pnlPercent ?? 0), 0));
  return {
    selectedCount: rows.length,
    wins: rows.filter((row) => resultBucket(row.result) === 'win').length,
    losses: rows.filter((row) => resultBucket(row.result) === 'loss').length,
    pushLike: rows.filter((row) => resultBucket(row.result) === 'push_like').length,
    totalPnlPercent,
    roiOnStaked: rows.length > 0 ? round(totalPnlPercent / rows.length) : 0,
  };
}

function buildPolicySmokeCases() {
  const cases: Array<{ id: string; label: string; input: RecommendationPolicyInput; legacyBlocked: boolean }> = [
    {
      id: 'balanced_over_15_60_84_one_goal',
      label: 'Balanced Over 1.5, minute 66 one-goal margin, odds 1.80',
      legacyBlocked: true,
      input: {
        selection: 'Over 1.5 Goals @1.80',
        betMarket: 'over_1.5',
        minute: 66,
        score: '1-0',
        odds: 1.8,
        confidence: 7,
        valuePercent: 7,
        stakePercent: 4,
        riskLevel: 'MEDIUM',
        evidenceMode: 'full_live_data',
        breakEvenRate: 1 / 1.8,
        directionalWin: true,
        promptVersion: 'v10-hybrid-legacy-g',
      },
    },
    {
      id: 'balanced_ah_small_line',
      label: 'Balanced AH -0.5, minute 63, odds 1.82',
      legacyBlocked: true,
      input: {
        selection: 'Home -0.5 @1.82',
        betMarket: 'asian_handicap_home_-0.5',
        minute: 63,
        score: '1-1',
        odds: 1.82,
        confidence: 8,
        valuePercent: 8,
        stakePercent: 3,
        riskLevel: 'LOW',
        evidenceMode: 'full_live_data',
        breakEvenRate: 1 / 1.82,
        directionalWin: true,
        promptVersion: 'v10-hybrid-legacy-g',
      },
    },
    {
      id: 'under_not_balanced',
      label: 'Goals Under remains outside balanced pocket',
      legacyBlocked: true,
      input: {
        selection: 'Under 1.5 Goals @1.80',
        betMarket: 'under_1.5',
        minute: 66,
        score: '1-0',
        odds: 1.8,
        confidence: 8,
        valuePercent: 8,
        stakePercent: 2,
        riskLevel: 'LOW',
        evidenceMode: 'full_live_data',
        breakEvenRate: 1 / 1.8,
        directionalWin: true,
        promptVersion: 'v10-hybrid-legacy-g',
      },
    },
    {
      id: 'degraded_not_balanced',
      label: 'Degraded evidence remains outside balanced pocket',
      legacyBlocked: true,
      input: {
        selection: 'Over 1.5 Goals @1.80',
        betMarket: 'over_1.5',
        minute: 66,
        score: '1-0',
        odds: 1.8,
        confidence: 8,
        valuePercent: 8,
        stakePercent: 2,
        riskLevel: 'LOW',
        evidenceMode: 'odds_events_only_degraded',
        breakEvenRate: 1 / 1.8,
        directionalWin: true,
        promptVersion: 'v10-hybrid-legacy-g',
      },
    },
  ];

  return cases.map((item) => {
    const after = applyRecommendationPolicy(item.input);
    return {
      id: item.id,
      label: item.label,
      legacyBlocked: item.legacyBlocked,
      afterBlocked: after.blocked,
      afterStakePercent: after.stakePercent,
      afterWarnings: after.warnings,
    };
  });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const runtimeDefaultBalancedLiveEnabled = config.policyBalancedLiveEnabled;
  if (args.enableBalancedPocket) {
    setBalancedLivePolicyEnabled(true);
  }
  const blocked = readJson<BlockedSelectionReport>(args.blockedJson);
  if (!blocked) throw new Error('blocked report not found');
  const liveness = readJson<Record<string, any>>(args.livenessJson);
  const noSave = readJson<Record<string, any>>(args.noSaveJson);

  const excluded = new Map<string, number>();
  const candidates: BlockedSelectionRow[] = [];
  for (const row of blocked.rows ?? []) {
    const reason = pocketReason(row);
    if (reason == null) {
      candidates.push(row);
    } else {
      excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
    }
  }

  const after = summarizeRows(candidates);
  const policySmokeCases = buildPolicySmokeCases();
  const policySmokeSummary = {
    totalCases: policySmokeCases.length,
    legacyAllowed: policySmokeCases.filter((row) => !row.legacyBlocked).length,
    afterAllowed: policySmokeCases.filter((row) => !row.afterBlocked).length,
    newlyAllowed: policySmokeCases.filter((row) => row.legacyBlocked && !row.afterBlocked).length,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    benchmark: 'balanced-live-policy-pocket',
    sourceReports: {
      blockedJson: args.blockedJson,
      livenessJson: args.livenessJson ?? null,
      noSaveJson: args.noSaveJson ?? null,
    },
    config: {
      runtimeDefaultBalancedLiveEnabled,
      benchmarkBalancedLiveEnabled: config.policyBalancedLiveEnabled,
      policyBalancedLiveMinOdds: config.policyBalancedLiveMinOdds,
      policyBalancedLiveMaxOdds: config.policyBalancedLiveMaxOdds,
      policyBalancedLiveMinConfidence: config.policyBalancedLiveMinConfidence,
      policyBalancedLiveMinEdge: config.policyBalancedLiveMinEdge,
      policyBalancedLiveMaxStakePercent: config.policyBalancedLiveMaxStakePercent,
    },
    before: {
      officialPromptLlmStarted: liveness?.pipelineActions?.find?.((row: any) => row.action === 'LLM_CALL_STARTED')?.count ?? null,
      officialPromptSavedRows: liveness?.recommendations?.officialPromptRows ?? null,
      parseDiagnostics: noSave?.totals?.parseDiagnostics ?? null,
      parseActionable: noSave?.totals?.parseActionable ?? null,
      parseSkipped: noSave?.totals?.parseSkipped ?? null,
      blockedSelections: blocked.totalSelections,
      blockedSelectionSettledRows: blocked.settledRows,
      blockedSelectionPnlPercent: blocked.totalPnlPercent,
      blockedSelectionRoiOnStaked: blocked.roiOnStaked,
    },
    afterCounterfactual: {
      ...after,
      note: 'Rows are current-runtime blocked selections that match the new balanced live value pocket using settled audit data. This does not call an LLM and does not predict model-side prompt adoption.',
    },
    policySmokeSummary,
    policySmokeCases,
    excludedReasons: Array.from(excluded.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    candidates: candidates.map((row) => ({
      auditLogId: row.auditLogId,
      timestamp: row.timestamp,
      matchDisplay: row.matchDisplay,
      canonicalMarket: row.canonicalMarket,
      selection: row.selection,
      minute: row.minute,
      score: row.score,
      odds: row.odds,
      confidence: row.confidence,
      valuePercent: row.valuePercent ?? null,
      riskLevel: row.riskLevel ?? 'unknown',
      result: row.result,
      pnlPercent: row.pnlPercent,
      policyWarnings: row.policyWarnings,
    })),
  };

  const jsonText = `${JSON.stringify(report, null, 2)}\n`;
  const md = [
    '# Balanced Live Policy Benchmark',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Blocked source: ${args.blockedJson}`,
    `- Runtime default balanced pocket enabled: ${report.config.runtimeDefaultBalancedLiveEnabled}`,
    `- Benchmark balanced pocket enabled: ${report.config.benchmarkBalancedLiveEnabled}`,
    '',
    '## Before',
    '',
    `- Official prompt LLM started: ${report.before.officialPromptLlmStarted ?? '(unknown)'}`,
    `- Official prompt saved rows: ${report.before.officialPromptSavedRows ?? '(unknown)'}`,
    `- Parse actionable/skipped: ${report.before.parseActionable ?? '(unknown)'} / ${report.before.parseSkipped ?? '(unknown)'}`,
    `- Blocked selections: ${report.before.blockedSelections}`,
    `- Blocked-selection ROI: ${report.before.blockedSelectionRoiOnStaked}`,
    '',
    '## After Counterfactual',
    '',
    `- Balanced pocket candidates: ${report.afterCounterfactual.selectedCount}`,
    `- Wins/losses/push-like: ${report.afterCounterfactual.wins} / ${report.afterCounterfactual.losses} / ${report.afterCounterfactual.pushLike}`,
    `- P/L % at 1% audit stake: ${report.afterCounterfactual.totalPnlPercent}`,
    `- ROI on staked: ${report.afterCounterfactual.roiOnStaked}`,
    '',
    '## Deterministic Policy Smoke',
    '',
    `- Legacy allowed: ${report.policySmokeSummary.legacyAllowed}/${report.policySmokeSummary.totalCases}`,
    `- After allowed: ${report.policySmokeSummary.afterAllowed}/${report.policySmokeSummary.totalCases}`,
    `- Newly allowed by balanced pocket: ${report.policySmokeSummary.newlyAllowed}`,
    '',
    report.config.benchmarkBalancedLiveEnabled
      ? 'This benchmark enables the opt-in pocket for counterfactual analysis only; production default remains controlled by POLICY_BALANCED_LIVE_ENABLED.'
      : 'This benchmark uses the current runtime default. Pass --enable-balanced-pocket to test the opt-in pocket counterfactual without LLM/provider calls.',
    '',
    '| Case | Legacy blocked | After blocked | After stake % | Warnings |',
    '| --- | --- | --- | ---: | --- |',
    ...report.policySmokeCases.map((row) => `| ${row.label} | ${row.legacyBlocked} | ${row.afterBlocked} | ${row.afterStakePercent} | ${row.afterWarnings.join('; ')} |`),
    '',
    '## Excluded Reasons',
    '',
    '| Reason | Count |',
    '| --- | ---: |',
    ...report.excludedReasons.map((row) => `| ${row.key} | ${row.count} |`),
    '',
    '## Candidates',
    '',
    '| Match | Market | Selection | Minute | Odds | Confidence | Edge | Result | P/L % |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: |',
    ...report.candidates.map((row) => `| ${row.matchDisplay || '(unknown)'} | ${row.canonicalMarket} | ${row.selection} | ${row.minute ?? ''} | ${row.odds ?? ''} | ${row.confidence ?? ''} | ${row.valuePercent ?? ''} | ${row.result ?? ''} | ${row.pnlPercent ?? ''} |`),
    '',
  ].join('\n');

  if (args.outJson) {
    mkdirSync(dirname(args.outJson), { recursive: true });
    writeFileSync(args.outJson, jsonText, 'utf8');
  }
  if (args.outMd) {
    mkdirSync(dirname(args.outMd), { recursive: true });
    writeFileSync(args.outMd, md, 'utf8');
  }
  process.stdout.write(jsonText);
}

main();
