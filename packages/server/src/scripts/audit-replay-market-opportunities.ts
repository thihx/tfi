import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import type { SettledReplayScenario } from '../lib/db-replay-scenarios.js';
import {
  buildReplayMarketOpportunity,
  summarizeReplayMarketOpportunities,
} from '../lib/replay-market-opportunities.js';

interface AuditArgs {
  dirPath: string;
  minOdds: number;
  minuteBand?: string;
  scoreState?: string;
  reportJsonPath?: string;
  reportMdPath?: string;
}

function parseArgs(argv: string[]): AuditArgs {
  let dirPath = '';
  let minOdds = 1.5;
  let minuteBand: string | undefined;
  let scoreState: string | undefined;
  let reportJsonPath: string | undefined;
  let reportMdPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--dir' && next) {
      dirPath = resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (arg === '--min-odds' && next) {
      minOdds = Math.max(1.01, Number(next) || 1.5);
      i++;
      continue;
    }
    if (arg === '--minute-band' && next) {
      minuteBand = next;
      i++;
      continue;
    }
    if (arg === '--score-state' && next) {
      scoreState = next;
      i++;
      continue;
    }
    if (arg === '--report-json' && next) {
      reportJsonPath = resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (arg === '--report-md' && next) {
      reportMdPath = resolve(process.cwd(), next);
      i++;
      continue;
    }
  }

  if (!dirPath) {
    throw new Error('Usage: tsx src/scripts/audit-replay-market-opportunities.ts --dir <folder> [--min-odds 1.5] [--minute-band 45-59] [--score-state 0-0] [--report-json <file>] [--report-md <file>]');
  }

  return {
    dirPath,
    minOdds,
    minuteBand,
    scoreState,
    reportJsonPath,
    reportMdPath,
  };
}

function loadScenario(filePath: string): SettledReplayScenario {
  return JSON.parse(readFileSync(filePath, 'utf8')) as SettledReplayScenario;
}

function buildMarkdown(summary: {
  generatedAt: string;
  minOdds: number;
  minuteBand: string | null;
  scoreState: string | null;
  rows: ReturnType<typeof buildReplayMarketOpportunity>[];
  summary: ReturnType<typeof summarizeReplayMarketOpportunities>;
}): string {
  const lines: string[] = [
    '# Replay Market Opportunities',
    '',
    `- Generated: ${summary.generatedAt}`,
    `- Min odds: ${summary.minOdds}`,
    `- Minute band filter: ${summary.minuteBand ?? '(none)'}`,
    `- Score state filter: ${summary.scoreState ?? '(none)'}`,
    '',
    '## Aggregate',
    '',
    `- Total scenarios: ${summary.summary.total}`,
    `- 1X2 home available: ${summary.summary.has1x2Home}`,
    `- 1X2 home playable: ${summary.summary.playable1x2Home}`,
    `- AH home available: ${summary.summary.hasAsianHandicapHome}`,
    `- AH home playable: ${summary.summary.playableAsianHandicapHome}`,
    `- Goals O/U available: ${summary.summary.hasGoalsOu}`,
    `- Corners O/U available: ${summary.summary.hasCornersOu}`,
    `- H1 1X2 home available: ${summary.summary.hasHt1x2Home}`,
    `- H1 1X2 home playable: ${summary.summary.playableHt1x2Home}`,
    `- H1 AH home available: ${summary.summary.hasHtAsianHandicapHome}`,
    `- H1 AH home playable: ${summary.summary.playableHtAsianHandicapHome}`,
    `- H1 goals O/U available: ${summary.summary.hasHtGoalsOu}`,
    '',
    '## By Minute Band',
    '',
    '| Bucket | Total | 1X2 H | 1X2 P | AH H | AH P | HT1X2 H | HT1X2 P | HTAH H | HTAH P | G O/U | Cor | HT G O/U |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of summary.summary.byMinuteBand) {
    lines.push(
      `| ${row.bucket} | ${row.total} | ${row.has1x2Home} | ${row.playable1x2Home} | ${row.hasAsianHandicapHome} | ${row.playableAsianHandicapHome} | ${row.hasHt1x2Home} | ${row.playableHt1x2Home} | ${row.hasHtAsianHandicapHome} | ${row.playableHtAsianHandicapHome} | ${row.hasGoalsOu} | ${row.hasCornersOu} | ${row.hasHtGoalsOu} |`,
    );
  }

  lines.push('');
  lines.push('## By Score State');
  lines.push('');
  lines.push('| Bucket | Total | 1X2 H | 1X2 P | AH H | AH P | HT1X2 H | HT1X2 P | HTAH H | HTAH P | G O/U | Cor | HT G O/U |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of summary.summary.byScoreState) {
    lines.push(
      `| ${row.bucket} | ${row.total} | ${row.has1x2Home} | ${row.playable1x2Home} | ${row.hasAsianHandicapHome} | ${row.playableAsianHandicapHome} | ${row.hasHt1x2Home} | ${row.playableHt1x2Home} | ${row.hasHtAsianHandicapHome} | ${row.playableHtAsianHandicapHome} | ${row.hasGoalsOu} | ${row.hasCornersOu} | ${row.hasHtGoalsOu} |`,
    );
  }

  lines.push('');
  lines.push('## Scenario Rows');
  lines.push('');
  lines.push('| Scenario | Band | Score | 1X2 H | AH | G O/U | Cor | HT1X2 H | HT AH | HT G O/U |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of summary.rows) {
    const oneX2 = row.has1x2Home ? `${row.oneX2HomeOdds}${row.playable1x2Home ? ' (P)' : ''}` : '-';
    const ah = row.hasAsianHandicapHome ? `${row.asianHandicapLine}@${row.asianHandicapHomeOdds}${row.playableAsianHandicapHome ? ' (P)' : ''}` : '-';
    const ht1 = row.hasHt1x2Home ? `${row.ht1x2HomeOdds}${row.playableHt1x2Home ? ' (P)' : ''}` : '-';
    const htAh = row.hasHtAsianHandicapHome
      ? `${row.htAsianHandicapLine}@${row.htAsianHandicapHomeOdds}${row.playableHtAsianHandicapHome ? ' (P)' : ''}`
      : '-';
    lines.push(
      `| ${row.scenarioName} | ${row.minuteBand} | ${row.scoreState} | ${oneX2} | ${ah} | ${row.hasGoalsOu} | ${row.hasCornersOu} | ${ht1} | ${htAh} | ${row.hasHtGoalsOu} |`,
    );
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = readdirSync(args.dirPath)
    .filter((name) => extname(name).toLowerCase() === '.json' && !name.startsWith('_'))
    .sort((a, b) => a.localeCompare(b));

  const rows = files
    .map((file) => loadScenario(resolve(args.dirPath, file)))
    .map((scenario) => buildReplayMarketOpportunity(scenario, args.minOdds))
    .filter((row) => (args.minuteBand ? row.minuteBand === args.minuteBand : true))
    .filter((row) => (args.scoreState ? row.scoreState === args.scoreState : true));

  const summary = {
    generatedAt: new Date().toISOString(),
    minOdds: args.minOdds,
    minuteBand: args.minuteBand ?? null,
    scoreState: args.scoreState ?? null,
    rows,
    summary: summarizeReplayMarketOpportunities(rows),
  };

  if (args.reportJsonPath) {
    mkdirSync(dirname(args.reportJsonPath), { recursive: true });
    writeFileSync(args.reportJsonPath, JSON.stringify(summary, null, 2));
  }
  if (args.reportMdPath) {
    mkdirSync(dirname(args.reportMdPath), { recursive: true });
    writeFileSync(args.reportMdPath, buildMarkdown(summary));
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
