import { config } from '../config.js';
import { upsertPendingThesisWatch } from '../repos/thesis-watch.repo.js';
import { buildThesisWatchIntentFromLlpBlock } from './thesis-watch-gates.js';
import type { LinePatienceOddsCanonical } from './line-patience-policy.js';

export function isThesisWatchEnabled(): boolean {
  if (!config.thesisWatchEnabled) return false;
  return config.linePatienceEnabled;
}

export function isThesisWatchPipelineActive(options: {
  shadowMode?: boolean;
  advisoryOnly?: boolean;
}): boolean {
  if (options.shadowMode || options.advisoryOnly) return false;
  return isThesisWatchEnabled();
}

export async function registerThesisWatchFromLlpBlock(args: {
  matchId: string;
  minute: number;
  shadowMode?: boolean;
  advisoryOnly?: boolean;
  warnings: string[];
  selection: string;
  betMarket: string;
  confidence: number;
  valuePercent: number;
  stakePercent: number;
  riskLevel: string;
  reasoningEn: string;
  reasoningVi: string;
  oddsCanonical: LinePatienceOddsCanonical;
}): Promise<void> {
  if (!isThesisWatchPipelineActive({ shadowMode: args.shadowMode, advisoryOnly: args.advisoryOnly })) {
    return;
  }

  const intent = buildThesisWatchIntentFromLlpBlock({
    warnings: args.warnings,
    selection: args.selection,
    betMarket: args.betMarket,
    confidence: args.confidence,
    valuePercent: args.valuePercent,
    stakePercent: args.stakePercent,
    riskLevel: args.riskLevel,
    reasoningEn: args.reasoningEn,
    reasoningVi: args.reasoningVi,
    oddsCanonical: args.oddsCanonical,
  });
  if (!intent) return;

  const ttlMinutes = Number.isFinite(config.thesisWatchTtlMinutes)
    ? config.thesisWatchTtlMinutes
    : 45;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
  const matchTtlCap = Math.max(0, (85 - args.minute) * 60_000);
  if (matchTtlCap > 0 && expiresAt.getTime() > Date.now() + matchTtlCap) {
    expiresAt.setTime(Date.now() + matchTtlCap);
  }

  try {
    await upsertPendingThesisWatch(args.matchId, intent, expiresAt);
  } catch (err) {
    console.warn(
      '[thesis-watch] Failed to persist pending watch:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
