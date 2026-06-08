import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildRuntimePolicyShadowReport,
  formatRuntimePolicyShadowReportMarkdown,
} from '../lib/runtime-policy-shadow-report.js';
import {
  buildRuntimePolicyShadowSkippedReport,
  formatRuntimePolicyShadowSkippedReportMarkdown,
} from '../lib/runtime-policy-shadow-skipped-report.js';
import {
  buildRuntimePolicyShadowSettlementReport,
  formatRuntimePolicyShadowSettlementMarkdown,
} from '../lib/runtime-policy-shadow-settlement-report.js';
import {
  buildRuntimePolicyShadowSkippedSettlementReport,
  formatRuntimePolicyShadowSkippedSettlementMarkdown,
} from '../lib/runtime-policy-shadow-skipped-settlement-report.js';
import {
  evaluateRuntimePolicyShadowReadinessGates,
  formatRuntimePolicyShadowReadinessMarkdown,
  type RuntimePolicyShadowReadinessGateConfig,
} from '../lib/runtime-policy-shadow-readiness-gates.js';

interface Args {
  lookbackDays: number;
  settlementLookbackDays: number;
  maxRows: number;
  stakePercent: number;
  outDir: string;
}

interface RuntimePolicyShadowAuditSuiteManifest {
  generatedAt: string;
  lookbackDays: number;
  settlementLookbackDays: number;
  maxRows: number;
  stakePercent: number;
  files: Record<string, string>;
  summary: {
    matchedEvents: number;
    matchedPocketRows: number;
    matchedSettledRows: number;
    matchedWins: number;
    matchedLosses: number;
    matchedPnlPercent: number;
    skippedEvents: number;
    skippedSettledRows: number;
    skippedWins: number;
    skippedLosses: number;
    skippedPnlPercent: number;
    readinessOk: boolean;
  };
}

function readArg(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0) return argv[idx + 1] ?? null;
  return null;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseNonNegativeNumber(raw: string | null, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseArgs(argv: string[]): Args {
  const lookbackDays = parsePositiveInt(readArg(argv, 'lookback-days'), 14);
  const settlementLookbackDays = parsePositiveInt(
    readArg(argv, 'settlement-lookback-days'),
    Math.max(30, lookbackDays),
  );
  const outDir = readArg(argv, 'out-dir');
  return {
    lookbackDays,
    settlementLookbackDays,
    maxRows: parsePositiveInt(readArg(argv, 'max-rows'), 1000),
    stakePercent: parseNonNegativeNumber(readArg(argv, 'stake-percent'), 1),
    outDir: outDir ? resolve(process.cwd(), outDir) : resolve(process.cwd(), 'replay-work/runtime-policy-shadow-suite', timestampForPath()),
  };
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function rel(name: string): string {
  return name;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.outDir, { recursive: true });

  const matched = await buildRuntimePolicyShadowReport({
    lookbackDays: args.lookbackDays,
    maxRows: args.maxRows,
  });
  const skipped = await buildRuntimePolicyShadowSkippedReport({
    lookbackDays: args.lookbackDays,
    maxRows: args.maxRows,
  });
  const matchedSettlement = await buildRuntimePolicyShadowSettlementReport({
    lookbackDays: args.settlementLookbackDays,
    maxRows: args.maxRows,
  });
  const skippedSettlement = await buildRuntimePolicyShadowSkippedSettlementReport({
    lookbackDays: args.settlementLookbackDays,
    maxRows: args.maxRows,
    stakePercent: args.stakePercent,
  });

  const files = {
    matchedJson: rel('runtime-policy-shadow-report.json'),
    matchedMd: rel('runtime-policy-shadow-report.md'),
    skippedJson: rel('runtime-policy-shadow-skipped-report.json'),
    skippedMd: rel('runtime-policy-shadow-skipped-report.md'),
    matchedSettlementJson: rel('runtime-policy-shadow-settlement-report.json'),
    matchedSettlementMd: rel('runtime-policy-shadow-settlement-report.md'),
    skippedSettlementJson: rel('runtime-policy-shadow-skipped-settlement-report.json'),
    skippedSettlementMd: rel('runtime-policy-shadow-skipped-settlement-report.md'),
    readinessJson: rel('runtime-policy-shadow-readiness-gates.json'),
    readinessMd: rel('runtime-policy-shadow-readiness-gates.md'),
    manifestJson: rel('manifest.json'),
  };

  writeJson(resolve(args.outDir, files.matchedJson), matched);
  writeText(resolve(args.outDir, files.matchedMd), formatRuntimePolicyShadowReportMarkdown(matched));
  writeJson(resolve(args.outDir, files.skippedJson), skipped);
  writeText(resolve(args.outDir, files.skippedMd), formatRuntimePolicyShadowSkippedReportMarkdown(skipped));
  writeJson(resolve(args.outDir, files.matchedSettlementJson), matchedSettlement);
  writeText(resolve(args.outDir, files.matchedSettlementMd), formatRuntimePolicyShadowSettlementMarkdown(matchedSettlement));
  writeJson(resolve(args.outDir, files.skippedSettlementJson), skippedSettlement);
  writeText(
    resolve(args.outDir, files.skippedSettlementMd),
    formatRuntimePolicyShadowSkippedSettlementMarkdown(skippedSettlement),
  );
  const readinessConfig: RuntimePolicyShadowReadinessGateConfig = {
    candidates: [
      {
        id: 'medium_risk_thin_edge_shadow_v1',
        label: 'Medium-risk thin-edge full-data shadow',
        source: 'matched_pocket',
        key: 'medium_risk_thin_edge_shadow_v1',
        expectedEvidenceModes: ['full_live_data'],
        minTelemetryEvents: 20,
        minUniqueMatches: 8,
        minSettlementRows: 20,
        minSettledRows: 16,
        minSettledRate: 0.8,
        maxLosses: 5,
        maxUnresolvedRows: 4,
        minTotalPnlPercent: 0.5,
        minRoiOnStaked: 0.05,
        maxTopMatchShare: 0.25,
        maxTopLeagueShare: 0.5,
        maxTopTeamShare: 0.25,
        maxTopMarketShare: 0.6,
        maxMarketUnresolvedRate: 0.05,
        maxEvidenceContaminationRate: 0,
      },
      {
        id: 'odds_events_degraded_shadow_v1',
        label: 'Odds-events degraded O/U-AH shadow',
        source: 'matched_pocket',
        key: 'odds_events_degraded_shadow_v1',
        expectedEvidenceModes: ['odds_events_only_degraded'],
        minTelemetryEvents: 30,
        minUniqueMatches: 10,
        minSettlementRows: 20,
        minSettledRows: 16,
        minSettledRate: 0.8,
        maxLosses: 5,
        maxUnresolvedRows: 4,
        minTotalPnlPercent: 0.5,
        minRoiOnStaked: 0.05,
        maxTopMatchShare: 0.25,
        maxTopLeagueShare: 0.5,
        maxTopTeamShare: 0.25,
        maxTopMarketShare: 0.6,
        maxMarketUnresolvedRate: 0.05,
        maxEvidenceContaminationRate: 0,
      },
    ],
  };
  const readiness = evaluateRuntimePolicyShadowReadinessGates(readinessConfig, {
    matchedReport: matched,
    skippedReport: skipped,
    matchedSettlement,
    skippedSettlement,
  });
  writeJson(resolve(args.outDir, files.readinessJson), {
    config: readinessConfig,
    result: readiness,
  });
  writeText(resolve(args.outDir, files.readinessMd), formatRuntimePolicyShadowReadinessMarkdown(readiness));

  const manifest: RuntimePolicyShadowAuditSuiteManifest = {
    generatedAt: new Date().toISOString(),
    lookbackDays: args.lookbackDays,
    settlementLookbackDays: args.settlementLookbackDays,
    maxRows: args.maxRows,
    stakePercent: args.stakePercent,
    files,
    summary: {
      matchedEvents: matched.totalEvents,
      matchedPocketRows: matchedSettlement.totalPocketRows,
      matchedSettledRows: matchedSettlement.settledRows,
      matchedWins: matchedSettlement.wins,
      matchedLosses: matchedSettlement.losses,
      matchedPnlPercent: matchedSettlement.totalPnlPercent,
      skippedEvents: skipped.totalEvents,
      skippedSettledRows: skippedSettlement.settledRows,
      skippedWins: skippedSettlement.wins,
      skippedLosses: skippedSettlement.losses,
      skippedPnlPercent: skippedSettlement.totalPnlPercent,
      readinessOk: readiness.ok,
    },
  };
  writeJson(resolve(args.outDir, files.manifestJson), manifest);

  console.log(JSON.stringify({
    outDir: args.outDir,
    summary: manifest.summary,
    files,
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
