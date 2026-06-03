import { normalizeMarket } from './normalize-market.js';

export type RuntimePolicyShadowPocketId =
  | 'btts_yes_60_74_two_plus'
  | 'late_under_45_two_plus'
  | 'over_15_60_74_one_goal';

export type RuntimePolicyShadowMarketAvailabilityBucket =
  | 'playable_side_market'
  | 'side_market_unplayable'
  | 'totals_only'
  | 'limited_odds';

export interface RuntimePolicyShadowInput {
  selection: string;
  betMarket: string;
  minute: number;
  score: string;
  odds: number | null;
  confidence: number | null;
  policyBlocked: boolean;
  policyWarnings: string[];
  evidenceMode: string;
  marketResolutionStatus?: string;
  prematchStrength: string;
  oddsCanonical: Record<string, unknown> | null | undefined;
  minOdds: number;
}

export interface RuntimePolicyShadowPocket {
  id: RuntimePolicyShadowPocketId;
  label: string;
  stakeCapPercent: number;
  reason: string;
}

export interface RuntimePolicyShadowSignal {
  hasPolicyBlockedSelection: boolean;
  canonicalMarket: string;
  minuteBand: string;
  scoreState: string;
  odds: number | null;
  confidence: number | null;
  evidenceMode: string;
  marketResolutionStatus: string;
  prematchStrength: string;
  marketAvailabilityBucket: RuntimePolicyShadowMarketAvailabilityBucket;
  policyWarnings: string[];
  matchedPockets: RuntimePolicyShadowPocket[];
  skippedReason: string;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getMinuteBand(minute: number): '00-29' | '30-44' | '45-59' | '60-74' | '75+' {
  if (minute <= 29) return '00-29';
  if (minute <= 44) return '30-44';
  if (minute <= 59) return '45-59';
  if (minute <= 74) return '60-74';
  return '75+';
}

function getScoreState(score: string): 'unknown' | '0-0' | 'level' | 'one-goal-margin' | 'two-plus-margin' {
  const match = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return 'unknown';
  const home = Number(match[1] ?? 0);
  const away = Number(match[2] ?? 0);
  const diff = Math.abs(home - away);
  if (home === 0 && away === 0) return '0-0';
  if (diff === 0) return 'level';
  if (diff === 1) return 'one-goal-margin';
  return 'two-plus-margin';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasPair(row: Record<string, unknown>, first: string, second: string): boolean {
  return toNumber(row[first]) != null && toNumber(row[second]) != null;
}

function hasPlayablePair(
  row: Record<string, unknown>,
  first: string,
  second: string,
  minOdds: number,
): boolean {
  const a = toNumber(row[first]);
  const b = toNumber(row[second]);
  return (a != null && a >= minOdds) || (b != null && b >= minOdds);
}

function classifyRuntimeMarketAvailability(
  oddsCanonical: Record<string, unknown> | null | undefined,
  minOdds: number,
): RuntimePolicyShadowMarketAvailabilityBucket {
  const oc = asRecord(oddsCanonical);
  const oneX2 = asRecord(oc['1x2']);
  const ah = asRecord(oc.ah);
  const htOneX2 = asRecord(oc.ht_1x2);
  const htAh = asRecord(oc.ht_ah);

  const playableSide = (
    hasPlayablePair(oneX2, 'home', 'away', minOdds)
    || hasPlayablePair(ah, 'home', 'away', minOdds)
    || hasPlayablePair(htOneX2, 'home', 'away', minOdds)
    || hasPlayablePair(htAh, 'home', 'away', minOdds)
  );
  if (playableSide) return 'playable_side_market';

  const sideExists = (
    hasPair(oneX2, 'home', 'away')
    || hasPair(ah, 'home', 'away')
    || hasPair(htOneX2, 'home', 'away')
    || hasPair(htAh, 'home', 'away')
  );
  if (sideExists) return 'side_market_unplayable';

  const totalsExists = (
    hasPair(asRecord(oc.ou), 'over', 'under')
    || hasPair(asRecord(oc.ou_adjacent), 'over', 'under')
    || Array.isArray(oc.ou_extra) && oc.ou_extra.some((row) => hasPair(asRecord(row), 'over', 'under'))
    || hasPair(asRecord(oc.corners_ou), 'over', 'under')
    || hasPair(asRecord(oc.ht_ou), 'over', 'under')
    || hasPair(asRecord(oc.ht_ou_adjacent), 'over', 'under')
    || Array.isArray(oc.ht_ou_extra) && oc.ht_ou_extra.some((row) => hasPair(asRecord(row), 'over', 'under'))
  );
  return totalsExists ? 'totals_only' : 'limited_odds';
}

function pocket(
  id: RuntimePolicyShadowPocketId,
  label: string,
  reason: string,
): RuntimePolicyShadowPocket {
  return {
    id,
    label,
    stakeCapPercent: 1,
    reason,
  };
}

function skipReason(args: {
  canonicalMarket: string;
  minuteBand: string;
  scoreState: string;
  evidenceMode: string;
  prematchStrength: string;
  marketAvailabilityBucket: string;
  odds: number | null;
}): string {
  const oddsText = args.odds == null ? 'unknown' : String(args.odds);
  if (args.canonicalMarket === 'btts_yes') {
    if (args.odds == null || args.odds < 2.05) {
      return `BTTS Yes shadow excluded: requires odds >= 2.05; actual odds=${oddsText}.`;
    }
    return `BTTS Yes shadow excluded: requires minuteBand=60-74, scoreState=two-plus-margin, evidenceMode=full_live_data, prematchStrength=strong, marketAvailabilityBucket=totals_only; actual minuteBand=${args.minuteBand}, scoreState=${args.scoreState}, evidenceMode=${args.evidenceMode}, prematchStrength=${args.prematchStrength}, marketAvailabilityBucket=${args.marketAvailabilityBucket}.`;
  }
  if (args.canonicalMarket === 'under_4.5') {
    return `Late Under 4.5 shadow excluded: requires minuteBand=75+, scoreState=two-plus-margin, evidenceMode=full_live_data, odds >= 2.00; actual minuteBand=${args.minuteBand}, scoreState=${args.scoreState}, evidenceMode=${args.evidenceMode}, odds=${oddsText}.`;
  }
  if (args.canonicalMarket === 'over_1.5') {
    return `Over 1.5 shadow excluded: requires minuteBand=60-74, scoreState=one-goal-margin, evidenceMode=full_live_data, odds >= 1.50; actual minuteBand=${args.minuteBand}, scoreState=${args.scoreState}, evidenceMode=${args.evidenceMode}, odds=${oddsText}.`;
  }
  return 'Policy-blocked selection did not match any configured runtime shadow pocket.';
}

export function buildRuntimePolicyShadowSignal(input: RuntimePolicyShadowInput): RuntimePolicyShadowSignal {
  const canonicalMarket = normalizeMarket(input.selection ?? '', input.betMarket ?? '');
  const minuteBand = getMinuteBand(input.minute);
  const scoreState = getScoreState(input.score);
  const odds = input.odds != null && Number.isFinite(input.odds) && input.odds > 1 ? input.odds : null;
  const confidence = input.confidence != null && Number.isFinite(input.confidence) ? input.confidence : null;
  const evidenceMode = String(input.evidenceMode || 'unknown');
  const marketResolutionStatus = String(input.marketResolutionStatus || 'unknown');
  const prematchStrength = String(input.prematchStrength || 'unknown');
  const marketAvailabilityBucket = classifyRuntimeMarketAvailability(input.oddsCanonical, input.minOdds);
  const hasPolicyBlockedSelection = input.policyBlocked
    && !!String(input.selection || '').trim()
    && canonicalMarket !== 'unknown'
    && odds != null;
  const matchedPockets: RuntimePolicyShadowPocket[] = [];

  if (hasPolicyBlockedSelection) {
    if (
      canonicalMarket === 'btts_yes'
      && minuteBand === '60-74'
      && scoreState === 'two-plus-margin'
      && evidenceMode === 'full_live_data'
      && prematchStrength === 'strong'
      && marketAvailabilityBucket === 'totals_only'
      && odds >= 2.05
    ) {
      matchedPockets.push(pocket(
        'btts_yes_60_74_two_plus',
        'BTTS Yes 60-74 two-plus clean context shadow',
        'Runtime shadow only: mirrors the strict 114-case replay pocket; no save/notify promotion.',
      ));
    }
    if (
      canonicalMarket === 'under_4.5'
      && minuteBand === '75+'
      && scoreState === 'two-plus-margin'
      && evidenceMode === 'full_live_data'
      && odds >= 2
    ) {
      matchedPockets.push(pocket(
        'late_under_45_two_plus',
        'Late Under 4.5 75+ two-plus shadow',
        'Runtime shadow only: mirrors replay late-under candidate; no save/notify promotion.',
      ));
    }
    if (
      canonicalMarket === 'over_1.5'
      && minuteBand === '60-74'
      && scoreState === 'one-goal-margin'
      && evidenceMode === 'full_live_data'
      && odds >= 1.5
    ) {
      matchedPockets.push(pocket(
        'over_15_60_74_one_goal',
        'Over 1.5 60-74 one-goal shadow',
        'Runtime shadow only: mirrors replay over candidate; no save/notify promotion.',
      ));
    }
  }

  return {
    hasPolicyBlockedSelection,
    canonicalMarket,
    minuteBand,
    scoreState,
    odds,
    confidence,
    evidenceMode,
    marketResolutionStatus,
    prematchStrength,
    marketAvailabilityBucket,
    policyWarnings: [...input.policyWarnings],
    matchedPockets,
    skippedReason: hasPolicyBlockedSelection && matchedPockets.length === 0
      ? skipReason({
          canonicalMarket,
          minuteBand,
          scoreState,
          evidenceMode,
          prematchStrength,
          marketAvailabilityBucket,
          odds,
        })
      : '',
  };
}
