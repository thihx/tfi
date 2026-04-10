import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  evaluateDataDrivenSegmentGates,
  type DataDrivenSegmentGateConfig,
} from '../lib/data-driven-segment-gates.js';
import type { HotspotReportPayload } from '../lib/replay-segment-hotspots.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');

function loadConfig(path: string): DataDrivenSegmentGateConfig {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (typeof j.hotspotPath !== 'string' || !Array.isArray(j.rules)) {
    throw new Error('Config must include hotspotPath (string) and rules (array)');
  }
  return j as unknown as DataDrivenSegmentGateConfig;
}

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = resolve(SERVER_ROOT, 'data-driven-segment-gates.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) {
      configPath = resolve(process.cwd(), argv[i + 1]!);
      i++;
    }
  }
  return { configPath };
}

function main(): void {
  const { configPath } = parseArgs(process.argv.slice(2));
  if (!existsSync(configPath)) {
    console.error(`[data-driven-segment-gates] Config not found: ${configPath}`);
    process.exit(1);
  }
  const config = loadConfig(configPath);
  const hotspotAbs = resolve(SERVER_ROOT, config.hotspotPath);
  if (!existsSync(hotspotAbs)) {
    console.error(`[data-driven-segment-gates] hotspotPath not found: ${hotspotAbs}`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(hotspotAbs, 'utf8')) as HotspotReportPayload;
  const result = evaluateDataDrivenSegmentGates(config, report);
  if (result.report) {
    const r = result.report;
    console.log(
      `[data-driven-segment-gates] ${r.promptVersion}: totalCases=${r.totalCases} segments=${r.bySegment.length}`,
    );
  }
  if (result.ok) {
    console.log('[data-driven-segment-gates] OK');
    process.exit(0);
  }
  console.error('[data-driven-segment-gates] FAILED:');
  for (const line of result.failures) console.error(`  - ${line}`);
  process.exit(1);
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) main();
