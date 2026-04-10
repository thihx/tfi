import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateDataDrivenDeltaGates, type DataDrivenDeltaGateConfig } from '../lib/data-driven-replay-gates.js';
import type { ReplayVsOriginalSummary } from '../lib/replay-vs-original-analysis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');

function loadConfig(path: string): DataDrivenDeltaGateConfig {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (typeof j.deltaPath !== 'string' || typeof j.promptVersion !== 'string') {
    throw new Error('Config must include deltaPath and promptVersion');
  }
  return j as unknown as DataDrivenDeltaGateConfig;
}

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = resolve(SERVER_ROOT, 'data-driven-replay-gates.json');
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
    console.error(`[data-driven-gates] Config not found: ${configPath}`);
    process.exit(1);
  }
  const config = loadConfig(configPath);
  const deltaAbs = resolve(SERVER_ROOT, config.deltaPath);
  if (!existsSync(deltaAbs)) {
    console.error(`[data-driven-gates] deltaPath not found: ${deltaAbs}`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(deltaAbs, 'utf8')) as { variants: ReplayVsOriginalSummary[] };
  const result = evaluateDataDrivenDeltaGates(config, report);
  if (result.variant) {
    const v = result.variant;
    const L = v.onOriginalDirectionalLoss;
    const W = v.onOriginalDirectionalWin;
    console.log(
      `[data-driven-gates] ${v.promptVersion}: scenarios=${v.scenarioCount} lossCohort=${L.replayPushed}/${L.total} accPush=${L.replayAccAmongPushed.toFixed(4)} winCohort=${W.replayPushed}/${W.total}`,
    );
  }
  if (result.ok) {
    console.log('[data-driven-gates] OK');
    process.exit(0);
  }
  console.error('[data-driven-gates] FAILED:');
  for (const line of result.failures) console.error(`  - ${line}`);
  process.exit(1);
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) main();
