function parseCanonicalMarket(value: string | null | undefined): {
  canonical: string;
  periodLabel: string;
  familyLabel: string;
} {
  const canonical = String(value ?? '').trim();
  const isH1 = canonical.startsWith('ht_');
  const base = isH1 ? canonical.slice(3) : canonical;
  const periodLabel = isH1 ? 'H1' : 'FT';

  if (base === '1x2_home' || base === '1x2_draw' || base === '1x2_away') {
    return { canonical, periodLabel, familyLabel: 'European 1X2' };
  }
  if (base.startsWith('asian_handicap_')) {
    return { canonical, periodLabel, familyLabel: 'Asian Handicap' };
  }
  if (base.startsWith('over_') || base.startsWith('under_')) {
    return { canonical, periodLabel, familyLabel: 'Goals O/U' };
  }
  if (base.startsWith('corners_over_') || base.startsWith('corners_under_')) {
    return { canonical, periodLabel, familyLabel: 'Corners O/U' };
  }
  if (base === 'btts_yes' || base === 'btts_no') {
    return { canonical, periodLabel, familyLabel: 'BTTS' };
  }
  return { canonical, periodLabel, familyLabel: 'Match Market' };
}

function formatSelection(selection: string | null | undefined, odds?: number | null): string {
  const trimmed = String(selection ?? '').trim();
  if (!trimmed) return '';
  if (odds == null || trimmed.includes('@')) return trimmed;
  return `${trimmed} @${odds}`;
}

export function formatCanonicalMarketLabel(betMarket: string | null | undefined): string {
  const parsed = parseCanonicalMarket(betMarket);
  if (!parsed.canonical) return 'Match Market';
  return `${parsed.periodLabel} ${parsed.familyLabel}`;
}

export function formatSelectionWithMarketContext(args: {
  selection?: string | null;
  betMarket?: string | null;
  odds?: number | null;
}): string {
  const selection = formatSelection(args.selection, args.odds);
  const marketLabel = formatCanonicalMarketLabel(args.betMarket);
  if (!selection) return marketLabel;
  return `${marketLabel} · ${selection}`;
}
