/**
 * Validates replay integration artifacts against replay-gates.json (economics + bias proxies).
 * Exit 0 = all gates pass; exit 1 = failure with actionable stderr.
 *
 * Usage (from packages/server):
 *   npx tsx src/scripts/check-replay-integration-gates.ts
 *   npx tsx src/scripts/check-replay-integration-gates.ts --config ../replay-gates.custom.json
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');

export interface ReplayGateConfig {
  summaryPath: string;
  selfAuditPath?: string;
  promptVersion: string;
  minScenarios?: number;
  pushRate?: { min: number; max: number };
  goalsUnderShareMax?: number;
  roiMin?: number;
  accuracyMin?: number;
  underFallbackMax?: number;
  /**
   * Per market family (goals_over, goals_under, asian_handicap, …): require min accuracy
   * when enough settled directional legs exist. Use with eval-last-summary-policy.json.
   */
  marketFamiliesAccuracy?: {
    minSettledDirectionalPerFamily: number;
    minAccuracy: number;
    /** If true, families with pushes but too few settled legs fail the gate. */
    failOnInsufficientSample?: boolean;
  };
}

interface SummaryMarketFamilyRow {
  family: string;
  pushCount: number;
  settledDirectionalCount: number;
  accuracy: number;
}

interface SummaryVariant {
  promptVersion: string;
  totalScenarios: number;
  pushRate: number;
  goalsUnderShare: number;
  roi: number;
  accuracy: number;
  byMarketFamily?: SummaryMarketFamilyRow[];
}

interface SelfAuditSummary {
  summary?: {
    underFallbackDetected?: number;
  };
}

export interface GateResult {
  ok: boolean;
  failures: string[];
  variant: SummaryVariant | null;
}

export function loadGateConfig(path: string): ReplayGateConfig {
  const raw = readFileSync(path, 'utf8');
  const j = JSON.parse(raw) as Record<string, unknown>;
  if (typeof j.summaryPath !== 'string' || typeof j.promptVersion !== 'string') {
    throw new Error('replay-gates.json must include summaryPath and promptVersion');
  }
  return j as unknown as ReplayGateConfig;
}

export function evaluateReplayGates(config: ReplayGateConfig, summary: unknown, selfAudit?: SelfAuditSummary | null): GateResult {
  const failures: string[] = [];
  const data = summary as { variants?: SummaryVariant[]; totalScenarios?: number };
  const variants = data.variants ?? [];
  const variant = variants.find((v) => v.promptVersion === config.promptVersion) ?? null;

  if (!variant) {
    return {
      ok: false,
      failures: [`No variant found for promptVersion=${config.promptVersion}`],
      variant: null,
    };
  }

  const minN = config.minScenarios ?? 1;
  if (variant.totalScenarios < minN) {
    failures.push(`totalScenarios ${variant.totalScenarios} < minScenarios ${minN}`);
  }

  if (config.pushRate) {
    if (variant.pushRate < config.pushRate.min) {
      failures.push(`pushRate ${variant.pushRate.toFixed(4)} < min ${config.pushRate.min}`);
    }
    if (variant.pushRate > config.pushRate.max) {
      failures.push(`pushRate ${variant.pushRate.toFixed(4)} > max ${config.pushRate.max}`);
    }
  }

  if (config.goalsUnderShareMax != null && variant.goalsUnderShare > config.goalsUnderShareMax) {
    failures.push(
      `goalsUnderShare ${variant.goalsUnderShare.toFixed(4)} > max ${config.goalsUnderShareMax} (directional Under bias proxy)`,
    );
  }

  if (config.roiMin != null && variant.roi < config.roiMin) {
    failures.push(`roi ${variant.roi.toFixed(4)} < roiMin ${config.roiMin}`);
  }

  if (config.accuracyMin != null && variant.accuracy < config.accuracyMin) {
    failures.push(`accuracy ${variant.accuracy.toFixed(4)} < accuracyMin ${config.accuracyMin}`);
  }

  const mfa = config.marketFamiliesAccuracy;
  if (mfa && variant.byMarketFamily?.length) {
    const failInsufficient = mfa.failOnInsufficientSample !== false;
    for (const row of variant.byMarketFamily) {
      if (row.pushCount <= 0) continue;
      const settled = row.settledDirectionalCount ?? 0;
      if (settled < mfa.minSettledDirectionalPerFamily) {
        if (failInsufficient) {
          failures.push(
            `market family "${row.family}": settledDirectionalCount ${settled} < min ${mfa.minSettledDirectionalPerFamily} (need more cohort or recorded odds to verify >= ${mfa.minAccuracy})`,
          );
        }
        continue;
      }
      const acc = row.accuracy ?? 0;
      if (acc < mfa.minAccuracy) {
        failures.push(
          `market family "${row.family}": accuracy ${acc.toFixed(4)} < per-family min ${mfa.minAccuracy}`,
        );
      }
    }
  }

  if (config.underFallbackMax != null && selfAudit?.summary && typeof selfAudit.summary.underFallbackDetected === 'number') {
    const u = selfAudit.summary.underFallbackDetected;
    if (u > config.underFallbackMax) {
      failures.push(`underFallbackDetected ${u} > underFallbackMax ${config.underFallbackMax}`);
    }
  }

  return { ok: failures.length === 0, failures, variant };
}

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = resolve(SERVER_ROOT, 'replay-gates.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') {
      const next = argv[i + 1];
      if (next) {
        configPath = resolve(process.cwd(), next);
        i++;
      }
    }
  }
  return { configPath };
}

function main(): void {
  const { configPath } = parseArgs(process.argv.slice(2));
  if (!existsSync(configPath)) {
    console.error(`[replay-gates] Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadGateConfig(configPath);
  const summaryAbs = resolve(SERVER_ROOT, config.summaryPath);
  if (!existsSync(summaryAbs)) {
    console.error(`[replay-gates] Summary not found: ${summaryAbs}`);
    process.exit(1);
  }

  const summary = JSON.parse(readFileSync(summaryAbs, 'utf8')) as unknown;

  let selfAudit: SelfAuditSummary | null = null;
  if (config.selfAuditPath) {
    const auditAbs = resolve(SERVER_ROOT, config.selfAuditPath);
    if (existsSync(auditAbs)) {
      selfAudit = JSON.parse(readFileSync(auditAbs, 'utf8')) as SelfAuditSummary;
    }
  }

  const result = evaluateReplayGates(config, summary, selfAudit);

  if (result.variant) {
    const v = result.variant;
    console.log(
      `[replay-gates] ${config.promptVersion}: n=${v.totalScenarios} pushRate=${v.pushRate.toFixed(4)} goalsUnderShare=${v.goalsUnderShare.toFixed(4)} roi=${v.roi.toFixed(4)} accuracy=${v.accuracy.toFixed(4)}`,
    );
    if (v.byMarketFamily?.length) {
      for (const row of v.byMarketFamily) {
        if (row.pushCount <= 0) continue;
        console.log(
          `[replay-gates]   family=${row.family} pushes=${row.pushCount} settled=${row.settledDirectionalCount} accuracy=${row.accuracy.toFixed(4)}`,
        );
      }
    }
  }

  if (result.ok) {
    console.log('[replay-gates] OK — all configured gates passed.');
    process.exit(0);
  }

  console.error('[replay-gates] FAILED:');
  for (const line of result.failures) {
    console.error(`  - ${line}`);
  }
  console.error('[replay-gates] Adjust prompt/policy or cohort (lookback/limit), re-run integration, then check again.');
  process.exit(1);
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  main();
}
