import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildCurrentRuntimeNoSaveDiagnosticsReport,
  type CurrentRuntimeNoSaveDiagnosticsReport,
} from '../lib/current-runtime-no-save-diagnostics-report.js';

interface Args {
  shortHours: number;
  longHours: number;
  maxSamples: number;
  minResolvedShadowCandidates: number;
  outJson?: string;
  outMd?: string;
}

interface ReadinessWindow {
  lookbackHours: number;
  parseDiagnostics: number;
  matchAnalyzed: number;
  matchAnalyzedSaved: number;
  shadowCandidatePresent: number;
  shadowCandidateResolved: number;
  telemetryCompleteness: CurrentRuntimeNoSaveDiagnosticsReport['telemetryCompleteness'];
  noPromoteReasons: string[];
  telemetryReady: boolean;
  promotionEvidenceReady: boolean;
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

function parseArgs(argv: string[]): Args {
  const outJson = readArg(argv, 'out-json');
  const outMd = readArg(argv, 'out-md');
  return {
    shortHours: parsePositiveInt(readArg(argv, 'short-hours'), 48),
    longHours: parsePositiveInt(readArg(argv, 'long-hours'), 168),
    maxSamples: parsePositiveInt(readArg(argv, 'max-samples'), 50),
    minResolvedShadowCandidates: parsePositiveInt(readArg(argv, 'min-resolved-shadow-candidates'), 20),
    outJson: outJson ? resolve(process.cwd(), outJson) : undefined,
    outMd: outMd ? resolve(process.cwd(), outMd) : undefined,
  };
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function summarizeWindow(
  report: CurrentRuntimeNoSaveDiagnosticsReport,
  minResolvedShadowCandidates: number,
): ReadinessWindow {
  const c = report.telemetryCompleteness;
  const noPromoteReasons: string[] = [];
  if (c.auditRows === 0) noPromoteReasons.push('no_audit_rows');
  if (c.missingMinute > 0) noPromoteReasons.push('missing_minute');
  if (c.missingScore > 0) noPromoteReasons.push('missing_score');
  if (c.missingEvidenceMode > 0) noPromoteReasons.push('missing_evidence_mode');
  if (c.missingValuePercent > 0) noPromoteReasons.push('missing_value_percent');
  if (c.missingRiskLevel > 0) noPromoteReasons.push('missing_risk_level');
  if (c.missingShadowCandidate > 0) noPromoteReasons.push('missing_shadow_candidate');
  if (c.shadowCandidateResolved < minResolvedShadowCandidates) {
    noPromoteReasons.push(`resolved_shadow_candidates_below_${minResolvedShadowCandidates}`);
  }

  const telemetryReady = c.auditRows > 0
    && c.missingMinute === 0
    && c.missingScore === 0
    && c.missingEvidenceMode === 0
    && c.missingValuePercent === 0
    && c.missingRiskLevel === 0
    && c.missingShadowCandidate === 0;

  return {
    lookbackHours: report.lookbackHours,
    parseDiagnostics: report.totals.parseDiagnostics,
    matchAnalyzed: report.totals.matchAnalyzed,
    matchAnalyzedSaved: report.totals.matchAnalyzedSaved,
    shadowCandidatePresent: c.shadowCandidatePresent,
    shadowCandidateResolved: c.shadowCandidateResolved,
    telemetryCompleteness: c,
    noPromoteReasons,
    telemetryReady,
    promotionEvidenceReady: telemetryReady && c.shadowCandidateResolved >= minResolvedShadowCandidates,
  };
}

function formatMarkdown(report: {
  generatedAt: string;
  officialPromptVersion: string;
  minResolvedShadowCandidates: number;
  windows: ReadinessWindow[];
}): string {
  const lines = [
    '# Live Recommendation Telemetry Readiness',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Official prompt version: ${report.officialPromptVersion}`,
    `- Minimum resolved shadow candidates: ${report.minResolvedShadowCandidates}`,
    '',
    '| Lookback | Audit rows | Parse diagnostics | Match analyzed | Saved | Shadow present | Shadow resolved | Telemetry ready | Promotion evidence ready | No-promote reasons |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |',
    ...report.windows.map((row) => [
      row.lookbackHours,
      row.telemetryCompleteness.auditRows,
      row.parseDiagnostics,
      row.matchAnalyzed,
      row.matchAnalyzedSaved,
      row.shadowCandidatePresent,
      row.shadowCandidateResolved,
      row.telemetryReady,
      row.promotionEvidenceReady,
      row.noPromoteReasons.join('; ') || 'none',
    ].join(' | ')).map((line) => `| ${line} |`),
    '',
    'Promotion evidence ready=false is a hard no-promote signal. This report never enables runtime pockets and does not call provider or LLM.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const shortReport = await buildCurrentRuntimeNoSaveDiagnosticsReport({
    lookbackHours: args.shortHours,
    maxSamples: args.maxSamples,
  });
  const longReport = await buildCurrentRuntimeNoSaveDiagnosticsReport({
    lookbackHours: args.longHours,
    maxSamples: args.maxSamples,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    officialPromptVersion: shortReport.officialPromptVersion,
    minResolvedShadowCandidates: args.minResolvedShadowCandidates,
    windows: [
      summarizeWindow(shortReport, args.minResolvedShadowCandidates),
      summarizeWindow(longReport, args.minResolvedShadowCandidates),
    ],
  };

  const json = JSON.stringify(report, null, 2);
  if (args.outJson) writeText(args.outJson, `${json}\n`);
  if (args.outMd) writeText(args.outMd, formatMarkdown(report));
  console.log(json);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
