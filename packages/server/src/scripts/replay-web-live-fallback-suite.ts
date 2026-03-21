import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import {
  countPrimaryStatPairs,
  fetchWebLiveFallback,
  type WebFallbackRequest,
  type WebLiveFallbackResult,
} from '../lib/web-live-fallback.js';
import type { StrategicSearchQuality } from '../config/strategic-source-policy.js';

interface WebFallbackScenario {
  name: string;
  request: WebFallbackRequest;
  expected?: {
    accepted?: boolean;
    minPrimaryStatPairs?: number;
    minEventCount?: number;
    minTrustedSources?: number;
    searchQualityIn?: StrategicSearchQuality[];
  };
}

interface SuiteArgs {
  dirPath: string;
  delayMs: number;
  retries: number;
  reportJsonPath?: string;
  reportMdPath?: string;
}

interface AssertionResult {
  field: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
}

interface ScenarioRunOutput {
  scenarioName: string;
  result: WebLiveFallbackResult;
  assertions: AssertionResult[];
  allPassed: boolean;
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
    throw new Error('Usage: tsx src/scripts/replay-web-live-fallback-suite.ts --dir <folder> [--delay-ms N] [--retries N] [--report-json <file>] [--report-md <file>]');
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

function evaluateAssertions(
  expected: WebFallbackScenario['expected'],
  result: WebLiveFallbackResult,
): AssertionResult[] {
  if (!expected) return [];

  const assertions: AssertionResult[] = [];
  const primaryStatPairs = result.structured ? countPrimaryStatPairs(result.structured.stats) : 0;
  const eventCount = result.structured?.events.length ?? 0;
  const trustedSources = result.sourceMeta.trusted_source_count;
  const searchQuality = result.sourceMeta.search_quality;

  if (expected.accepted !== undefined) {
    assertions.push({
      field: 'accepted',
      pass: result.validation.accepted === expected.accepted,
      expected: expected.accepted,
      actual: result.validation.accepted,
    });
  }
  if (expected.minPrimaryStatPairs !== undefined) {
    assertions.push({
      field: 'minPrimaryStatPairs',
      pass: primaryStatPairs >= expected.minPrimaryStatPairs,
      expected: expected.minPrimaryStatPairs,
      actual: primaryStatPairs,
    });
  }
  if (expected.minEventCount !== undefined) {
    assertions.push({
      field: 'minEventCount',
      pass: eventCount >= expected.minEventCount,
      expected: expected.minEventCount,
      actual: eventCount,
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
  if (expected.searchQualityIn !== undefined) {
    assertions.push({
      field: 'searchQualityIn',
      pass: expected.searchQualityIn.includes(searchQuality),
      expected: expected.searchQualityIn,
      actual: searchQuality,
    });
  }

  return assertions;
}

async function runScenario(scenario: WebFallbackScenario): Promise<ScenarioRunOutput> {
  const result = await fetchWebLiveFallback(scenario.request);
  const assertions = evaluateAssertions(scenario.expected, result);
  return {
    scenarioName: scenario.name,
    result,
    assertions,
    allPassed: assertions.every((item) => item.pass),
  };
}

function buildMarkdownReport(outputs: ScenarioRunOutput[]): string {
  const passed = outputs.filter((item) => item.allPassed).length;
  const lines: string[] = [
    '# Web Live Fallback Replay Report',
    '',
    `- Total scenarios: ${outputs.length}`,
    `- Passed assertions: ${passed}/${outputs.length}`,
    '',
    '| Scenario | Accepted | Search Quality | Trusted Sources | Primary Stat Pairs | Events | Assertions |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const output of outputs) {
    lines.push(
      `| ${output.scenarioName} | ${output.result.validation.accepted ? 'yes' : 'no'} | ${output.result.sourceMeta.search_quality} | ${output.result.sourceMeta.trusted_source_count} | ${output.result.structured ? countPrimaryStatPairs(output.result.structured.stats) : 0} | ${output.result.structured?.events.length ?? 0} | ${output.allPassed ? 'pass' : 'fail'} |`,
    );
  }

  lines.push('');
  lines.push('## Details');
  lines.push('');

  for (const output of outputs) {
    const structured = output.result.structured;
    lines.push(`### ${output.scenarioName}`);
    lines.push(`- success: ${String(output.result.success)}`);
    lines.push(`- accepted: ${String(output.result.validation.accepted)}`);
    lines.push(`- search_quality: ${output.result.sourceMeta.search_quality}`);
    lines.push(`- trusted_sources: ${output.result.sourceMeta.trusted_source_count}`);
    lines.push(`- matched_url: ${structured?.matched_url ?? ''}`);
    lines.push(`- matched_title: ${structured?.matched_title ?? ''}`);
    lines.push(`- primary_stat_pairs: ${structured ? countPrimaryStatPairs(structured.stats) : 0}`);
    lines.push(`- event_count: ${structured?.events.length ?? 0}`);
    lines.push(`- validation_reasons: ${output.result.validation.reasons.join(', ') || '(none)'}`);
    if (output.result.error) lines.push(`- error: ${output.result.error}`);
    if (output.assertions.length > 0) {
      lines.push('- assertions:');
      for (const assertion of output.assertions) {
        lines.push(`  - ${assertion.pass ? 'PASS' : 'FAIL'} ${assertion.field}: expected=${JSON.stringify(assertion.expected)} actual=${JSON.stringify(assertion.actual)}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = readdirSync(args.dirPath)
    .filter((file) => extname(file).toLowerCase() === '.json')
    .sort();

  const outputs: ScenarioRunOutput[] = [];

  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    const scenario = JSON.parse(
      await import('node:fs/promises').then((fs) => fs.readFile(resolve(args.dirPath, file), 'utf8')),
    ) as WebFallbackScenario;

    let attempt = 0;
    let output: ScenarioRunOutput | null = null;
    while (attempt <= args.retries) {
      output = await runScenario(scenario);
      if (output.result.success || attempt >= args.retries) break;
      attempt++;
      await sleep(Math.max(args.delayMs, 500));
    }
    outputs.push(output!);
    if (index < files.length - 1 && args.delayMs > 0) {
      await sleep(args.delayMs);
    }
  }

  if (args.reportJsonPath) {
    mkdirSync(dirname(args.reportJsonPath), { recursive: true });
    writeFileSync(args.reportJsonPath, JSON.stringify(outputs, null, 2), 'utf8');
  }

  const markdown = buildMarkdownReport(outputs);
  if (args.reportMdPath) {
    mkdirSync(dirname(args.reportMdPath), { recursive: true });
    writeFileSync(args.reportMdPath, markdown, 'utf8');
  }

  const failed = outputs.filter((item) => !item.allPassed).length;
  console.log(markdown);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

await main();
