import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import {
  countStrategicQuantitativeCoverage,
  fetchStrategicContext,
  hasUsableStrategicContext,
  type StrategicCompetitionType,
  type StrategicContext,
} from '../lib/strategic-context.service.js';
import type { StrategicSearchQuality } from '../config/strategic-source-policy.js';

interface StrategicContextScenario {
  name: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string | null;
  expected?: {
    competitionType?: StrategicCompetitionType;
    usable?: boolean;
    minTrustedSources?: number;
    minQuantitativeCoverage?: number;
    searchQualityIn?: StrategicSearchQuality[];
    requireBilingual?: boolean;
    requireConditionBlueprint?: boolean;
    expectNoData?: boolean;
  };
}

interface SuiteArgs {
  dirPath: string;
  delayMs: number;
  retries: number;
  reportJsonPath?: string;
  reportMdPath?: string;
}

interface StrategicAssertionResult {
  field: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
}

interface StrategicScenarioRunOutput {
  scenarioName: string;
  success: boolean;
  context: StrategicContext | null;
  assertions: StrategicAssertionResult[];
  allPassed: boolean;
  error?: string;
}

function parseArgs(argv: string[]): SuiteArgs {
  let dirPath = '';
  let delayMs = 750;
  let retries = 0;
  let reportJsonPath: string | undefined;
  let reportMdPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--dir' && next) {
      dirPath = next;
      i++;
      continue;
    }
    if (arg === '--delay-ms' && next) {
      delayMs = Math.max(0, Number(next) || 0);
      i++;
      continue;
    }
    if (arg === '--retries' && next) {
      retries = Math.max(0, Number(next) || 0);
      i++;
      continue;
    }
    if (arg === '--report-json' && next) {
      reportJsonPath = next;
      i++;
      continue;
    }
    if (arg === '--report-md' && next) {
      reportMdPath = next;
      i++;
      continue;
    }
  }

  if (!dirPath) {
    throw new Error('Usage: tsx src/scripts/replay-strategic-context-suite.ts --dir <folder> [--delay-ms N] [--retries N] [--report-json <file>] [--report-md <file>]');
  }

  return {
    dirPath: resolve(process.cwd(), dirPath),
    delayMs,
    retries,
    reportJsonPath: reportJsonPath ? resolve(process.cwd(), reportJsonPath) : undefined,
    reportMdPath: reportMdPath ? resolve(process.cwd(), reportMdPath) : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isNoDataContext(context: StrategicContext | null): boolean {
  if (!context) return true;
  return String(context.summary || '').toLowerCase().startsWith('no data');
}

function evaluateAssertions(
  expected: StrategicContextScenario['expected'],
  context: StrategicContext | null,
): StrategicAssertionResult[] {
  if (!expected) return [];

  const assertions: StrategicAssertionResult[] = [];
  const usable = hasUsableStrategicContext(context);
  const quantitativeCoverage = countStrategicQuantitativeCoverage(context?.quantitative ?? null);
  const trustedSources = context?.source_meta?.trusted_source_count ?? 0;
  const searchQuality = context?.source_meta?.search_quality ?? 'unknown';
  const bilingualReady = Boolean(context?.summary && context?.summary_vi);
  const hasBlueprint = Boolean(context?.ai_condition_blueprint);
  const noData = isNoDataContext(context);

  if (expected.competitionType !== undefined) {
    assertions.push({
      field: 'competitionType',
      pass: (context?.competition_type ?? '') === expected.competitionType,
      expected: expected.competitionType,
      actual: context?.competition_type ?? '',
    });
  }
  if (expected.usable !== undefined) {
    assertions.push({
      field: 'usable',
      pass: usable === expected.usable,
      expected: expected.usable,
      actual: usable,
    });
  }
  if (expected.minTrustedSources !== undefined) {
    assertions.push({
      field: 'minTrustedSources',
      pass: trustedSources >= expected.minTrustedSources,
      expected: expected.minTrustedSources,
      actual: trustedSources,
    });
  }
  if (expected.minQuantitativeCoverage !== undefined) {
    assertions.push({
      field: 'minQuantitativeCoverage',
      pass: quantitativeCoverage >= expected.minQuantitativeCoverage,
      expected: expected.minQuantitativeCoverage,
      actual: quantitativeCoverage,
    });
  }
  if (expected.searchQualityIn !== undefined) {
    assertions.push({
      field: 'searchQualityIn',
      pass: expected.searchQualityIn.includes(searchQuality),
      expected: expected.searchQualityIn,
      actual: searchQuality,
    });
  }
  if (expected.requireBilingual !== undefined) {
    assertions.push({
      field: 'requireBilingual',
      pass: bilingualReady === expected.requireBilingual,
      expected: expected.requireBilingual,
      actual: bilingualReady,
    });
  }
  if (expected.requireConditionBlueprint !== undefined) {
    assertions.push({
      field: 'requireConditionBlueprint',
      pass: hasBlueprint === expected.requireConditionBlueprint,
      expected: expected.requireConditionBlueprint,
      actual: hasBlueprint,
    });
  }
  if (expected.expectNoData !== undefined) {
    assertions.push({
      field: 'expectNoData',
      pass: noData === expected.expectNoData,
      expected: expected.expectNoData,
      actual: noData,
    });
  }

  return assertions;
}

async function runScenario(scenario: StrategicContextScenario): Promise<StrategicScenarioRunOutput> {
  try {
    const context = await fetchStrategicContext(
      scenario.homeTeam,
      scenario.awayTeam,
      scenario.league,
      scenario.matchDate,
    );
    const assertions = evaluateAssertions(scenario.expected, context);
    return {
      scenarioName: scenario.name,
      success: context != null,
      context,
      assertions,
      allPassed: assertions.every((item) => item.pass),
    };
  } catch (err) {
    return {
      scenarioName: scenario.name,
      success: false,
      context: null,
      assertions: [],
      allPassed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildMarkdownReport(outputs: StrategicScenarioRunOutput[]): string {
  const passed = outputs.filter((item) => item.allPassed).length;
  const lines: string[] = [
    '# Strategic Context Replay Report',
    '',
    `- Total scenarios: ${outputs.length}`,
    `- Passed assertions: ${passed}/${outputs.length}`,
    '',
    '| Scenario | Competition Type | Search Quality | Trusted Sources | Quant Coverage | Usable | Assertions |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const output of outputs) {
    const context = output.context;
    const assertions = output.assertions.length === 0
      ? 'n/a'
      : output.assertions.every((item) => item.pass)
        ? 'pass'
        : 'fail';
    lines.push(
      `| ${output.scenarioName} | ${context?.competition_type ?? ''} | ${context?.source_meta?.search_quality ?? ''} | ${context?.source_meta?.trusted_source_count ?? 0} | ${countStrategicQuantitativeCoverage(context?.quantitative ?? null)} | ${hasUsableStrategicContext(context) ? 'yes' : 'no'} | ${assertions} |`,
    );
  }

  lines.push('');
  lines.push('## Details');
  lines.push('');

  for (const output of outputs) {
    const context = output.context;
    lines.push(`### ${output.scenarioName}`);
    lines.push(`- success: ${String(output.success)}`);
    lines.push(`- competition_type: ${context?.competition_type ?? ''}`);
    lines.push(`- search_quality: ${context?.source_meta?.search_quality ?? ''}`);
    lines.push(`- trusted_source_count: ${context?.source_meta?.trusted_source_count ?? 0}`);
    lines.push(`- quantitative_coverage: ${countStrategicQuantitativeCoverage(context?.quantitative ?? null)}`);
    lines.push(`- usable: ${String(hasUsableStrategicContext(context))}`);
    lines.push(`- summary_en: ${context?.summary ?? ''}`);
    lines.push(`- summary_vi: ${context?.summary_vi ?? ''}`);
    lines.push(`- ai_condition: ${context?.ai_condition ?? ''}`);
    if (context?.source_meta?.sources?.length) {
      lines.push(`- source_domains: ${context.source_meta.sources.map((source) => source.domain).join(', ')}`);
    }
    if (output.error) {
      lines.push(`- error: ${output.error}`);
    }
    if (output.assertions.length > 0) {
      lines.push(`- assertions: ${output.assertions.every((item) => item.pass) ? 'pass' : 'fail'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = readdirSync(args.dirPath)
    .filter((name) => extname(name).toLowerCase() === '.json')
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    throw new Error(`No JSON scenarios found in ${args.dirPath}`);
  }

  const outputs: StrategicScenarioRunOutput[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const scenario = JSON.parse(
      await import('node:fs/promises').then((fs) => fs.readFile(join(args.dirPath, file), 'utf8')),
    ) as StrategicContextScenario;

    let output = await runScenario(scenario);
    let attempts = 0;
    while (!output.success && attempts < args.retries) {
      attempts++;
      if (args.delayMs > 0) {
        await sleep(args.delayMs);
      }
      output = await runScenario(scenario);
    }

    outputs.push(output);
    if (args.delayMs > 0 && i < files.length - 1) {
      await sleep(args.delayMs);
    }
  }

  const summary = {
    dir: args.dirPath,
    total: outputs.length,
    passed: outputs.filter((item) => item.allPassed).length,
    outputs,
  };

  if (args.reportJsonPath) {
    mkdirSync(dirname(args.reportJsonPath), { recursive: true });
    writeFileSync(args.reportJsonPath, JSON.stringify(summary, null, 2));
  }
  if (args.reportMdPath) {
    mkdirSync(dirname(args.reportMdPath), { recursive: true });
    writeFileSync(args.reportMdPath, buildMarkdownReport(outputs));
  }

  console.log(JSON.stringify(summary, null, 2));
  if (outputs.some((item) => !item.allPassed)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
