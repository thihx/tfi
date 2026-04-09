export type LiveAnalysisEvidenceMode =
  | 'full_live_data'
  | 'stats_only'
  | 'odds_events_only_degraded'
  | 'events_only_degraded'
  | 'low_evidence';

export function isMarketAllowedForEvidenceMode(
  betMarket: string,
  evidenceMode: LiveAnalysisEvidenceMode,
): boolean {
  const market = (betMarket || '').toLowerCase();
  if (!market) return false;

  switch (evidenceMode) {
    case 'full_live_data':
      return true;
    case 'stats_only':
      return false;
    case 'odds_events_only_degraded':
      return market.startsWith('over_')
        || market.startsWith('under_')
        || market.startsWith('asian_handicap_');
    case 'events_only_degraded':
    case 'low_evidence':
    default:
      return false;
  }
}
