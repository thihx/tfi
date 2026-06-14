import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type MetricName = 'lines' | 'branches' | 'functions' | 'statements';

interface CoverageMetric {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

type CoverageEntry = Record<MetricName, CoverageMetric>;

interface CoverageSummary {
  total: CoverageEntry;
  [filePath: string]: CoverageEntry;
}

interface CoverageGate {
  pathIncludes?: string;
  lines?: number;
  branches?: number;
  functions?: number;
  statements?: number;
}

interface CoverageGateConfig {
  summary?: CoverageGate;
  files?: CoverageGate[];
}

const metricNames: MetricName[] = ['lines', 'branches', 'functions', 'statements'];

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return fallback;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function thresholdFor(gate: CoverageGate, metric: MetricName): number | null {
  const value = gate[metric];
  return typeof value === 'number' ? value : null;
}

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function checkEntry(label: string, entry: CoverageEntry, gate: CoverageGate): string[] {
  const failures: string[] = [];
  for (const metric of metricNames) {
    const threshold = thresholdFor(gate, metric);
    if (threshold == null) continue;
    const pct = entry[metric]?.pct;
    if (typeof pct !== 'number' || pct < threshold) {
      failures.push(`${label} ${metric}: ${formatPct(pct ?? 0)} < ${threshold}%`);
    }
  }
  return failures;
}

const summaryPath = resolve(argValue('summary', 'coverage/provider-fusion/coverage-summary.json'));
const configPath = resolve(argValue('config', 'provider-fusion-coverage-gates.json'));

const summary = loadJson<CoverageSummary>(summaryPath);
const config = loadJson<CoverageGateConfig>(configPath);
const failures: string[] = [];

if (config.summary) {
  failures.push(...checkEntry('total', summary.total, config.summary));
}

for (const gate of config.files ?? []) {
  if (!gate.pathIncludes) continue;
  const match = Object.entries(summary)
    .find(([filePath]) => filePath !== 'total' && filePath.replace(/\\/g, '/').includes(gate.pathIncludes!.replace(/\\/g, '/')));
  if (!match) {
    failures.push(`Missing coverage entry matching "${gate.pathIncludes}"`);
    continue;
  }
  failures.push(...checkEntry(gate.pathIncludes, match[1], gate));
}

if (failures.length > 0) {
  console.error('[provider-fusion-coverage] Coverage gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.info('[provider-fusion-coverage] Coverage gate passed.');
