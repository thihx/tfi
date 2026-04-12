type MarketDisplayLanguage = 'en' | 'vi';

function parseCanonicalMarket(value: string | null | undefined): {
  canonical: string;
  periodLabelEn: string;
  periodLabelVi: string;
  familyLabelEn: string;
  familyLabelVi: string;
} {
  const canonical = String(value ?? '').trim();
  const isH1 = canonical.startsWith('ht_');
  const base = isH1 ? canonical.slice(3) : canonical;
  const periodLabelEn = isH1 ? 'H1' : 'FT';
  const periodLabelVi = isH1 ? 'H1' : 'FT';

  if (base === '1x2_home' || base === '1x2_draw' || base === '1x2_away') {
    return {
      canonical,
      periodLabelEn,
      periodLabelVi,
      familyLabelEn: 'European 1X2',
      familyLabelVi: 'Kèo Châu Âu 1X2',
    };
  }
  if (base.startsWith('asian_handicap_')) {
    return {
      canonical,
      periodLabelEn,
      periodLabelVi,
      familyLabelEn: 'Asian Handicap',
      familyLabelVi: 'Kèo Châu Á',
    };
  }
  if (base.startsWith('over_') || base.startsWith('under_')) {
    return {
      canonical,
      periodLabelEn,
      periodLabelVi,
      familyLabelEn: 'Goals O/U',
      familyLabelVi: 'Tài/Xỉu Bàn Thắng',
    };
  }
  if (base.startsWith('corners_over_') || base.startsWith('corners_under_')) {
    return {
      canonical,
      periodLabelEn,
      periodLabelVi,
      familyLabelEn: 'Corners O/U',
      familyLabelVi: 'Tài/Xỉu Góc',
    };
  }
  if (base === 'btts_yes' || base === 'btts_no') {
    return {
      canonical,
      periodLabelEn,
      periodLabelVi,
      familyLabelEn: 'BTTS',
      familyLabelVi: 'Cả Hai Đội Ghi Bàn',
    };
  }
  return {
    canonical,
    periodLabelEn,
    periodLabelVi,
    familyLabelEn: 'Match Market',
    familyLabelVi: 'Loại Kèo',
  };
}

function formatSelection(selection: string | null | undefined, odds: number | null | undefined): string {
  const trimmed = String(selection ?? '').trim();
  if (!trimmed) return '';
  if (odds == null || trimmed.includes('@')) return trimmed;
  return `${trimmed} @${odds}`;
}

export function formatCanonicalMarketLabel(
  betMarket: string | null | undefined,
  language: MarketDisplayLanguage = 'en',
): string {
  const parsed = parseCanonicalMarket(betMarket);
  if (!parsed.canonical) return language === 'vi' ? 'Loại Kèo' : 'Match Market';
  return language === 'vi'
    ? `${parsed.familyLabelVi} ${parsed.periodLabelVi}`
    : `${parsed.periodLabelEn} ${parsed.familyLabelEn}`;
}

export function formatSelectionWithMarketContext(args: {
  selection?: string | null;
  betMarket?: string | null;
  odds?: number | null;
  language?: MarketDisplayLanguage;
}): string {
  const selection = formatSelection(args.selection, args.odds);
  const marketLabel = formatCanonicalMarketLabel(args.betMarket, args.language ?? 'en');
  if (!selection) return marketLabel;
  return `${marketLabel} · ${selection}`;
}
