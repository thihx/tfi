// ============================================================
// Market Normalizer - Derive canonical bet_market from selection text
// ============================================================

/**
 * Normalize a bet market to a canonical key like "1x2_home", "over_2.5", "btts_yes".
 * Uses bet_market if available, otherwise parses the selection text.
 */
export function normalizeMarket(selection: string, betMarket?: string): string {
  const selectionText = selection.trim();
  const betMarketText = (betMarket ?? '').trim();

  if (betMarketText !== '') {
    const fromBetMarket = parseCanonicalMarket(betMarketText, selectionText);
    if (fromBetMarket !== 'unknown') return fromBetMarket;
  }

  return parseCanonicalMarket(selectionText);
}

function parseCanonicalMarket(primaryText: string, secondaryText = ''): string {
  const primary = primaryText.toLowerCase().trim();
  const secondary = secondaryText.toLowerCase().trim();
  const combined = `${primary} ${secondary}`.trim();
  if (!combined) return 'unknown';

  const totalsAlias = primary.match(/^(over|under)_(\d+(?:\.\d+)?)$/);
  if (totalsAlias) {
    return `${totalsAlias[1]}_${formatUnsignedLine(totalsAlias[2]!)}`;
  }

  const cornersAlias = primary.match(/^corners_(over|under)_(\d+(?:\.\d+)?)$/);
  if (cornersAlias) {
    return `corners_${cornersAlias[1]}_${formatUnsignedLine(cornersAlias[2]!)}`;
  }

  if (primary === 'btts' || primary === 'btts_yes' || primary === 'btts_no') {
    if (primary === 'btts_yes' || primary === 'btts_no') return primary;
    return /\bno\b/.test(secondary) ? 'btts_no' : 'btts_yes';
  }

  if (/^1x2_(home|away|draw)$/.test(primary)) return primary;

  const ahAlias = primary.match(/^ah_(home|away)(?:_([^\s]+))?$/);
  if (ahAlias) {
    const side = ahAlias[1]!;
    const line = normalizeSignedLine(ahAlias[2] ?? extractLineFromText(secondary, true));
    return line ? `asian_handicap_${side}_${line}` : `asian_handicap_${side}`;
  }

  const canonicalAh = primary.match(/^asian_handicap_(home|away)(?:_([^\s]+))?$/);
  if (canonicalAh) {
    const side = canonicalAh[1]!;
    const line = normalizeSignedLine(canonicalAh[2] ?? extractLineFromText(secondary, true));
    return line ? `asian_handicap_${side}_${line}` : `asian_handicap_${side}`;
  }

  if (/corner/i.test(combined)) {
    const direction = extractDirection(primary, secondary, ['over', 'under']);
    const line = extractLineFromText(primary, false) ?? extractLineFromText(secondary, false);
    if (direction && line) return `corners_${direction}_${formatUnsignedLine(line)}`;
    return 'corners';
  }

  if (/asian\s*handicap|\bah\b/.test(combined)) {
    const side = /\baway\b/.test(combined) ? 'away' : 'home';
    const line = extractLineFromText(primary, true) ?? extractLineFromText(secondary, true);
    if (side && line) return `asian_handicap_${side}_${normalizeSignedLine(line)!}`;
    if (side) return `asian_handicap_${side}`;
  }

  if (/btts|both\s*teams?\s*(to\s+)?scor/.test(combined)) {
    return /\bno\b/.test(combined) ? 'btts_no' : 'btts_yes';
  }

  if (/full\s*time\s*result|\b1x2\b/.test(combined)) {
    const outcome = inferMatchResultOutcome(secondary || primary);
    if (outcome) return outcome;
  }

  const totalDirection = extractDirection(primary, secondary, ['over', 'under']);
  const totalLine = extractLineFromText(primary, false) ?? extractLineFromText(secondary, false);
  if (totalDirection && totalLine) {
    return `${totalDirection}_${formatUnsignedLine(totalLine)}`;
  }

  if (/\bdraw\b/.test(combined)) return '1x2_draw';
  if (/\baway\b/.test(combined)) return '1x2_away';
  if (/\b(home|win)\b/.test(combined)) return '1x2_home';

  return primary !== ''
    ? primary.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'
    : 'unknown';
}

function inferMatchResultOutcome(text: string): '1x2_home' | '1x2_away' | '1x2_draw' | null {
  const normalized = text.toLowerCase();
  if (/\bdraw\b/.test(normalized)) return '1x2_draw';
  if (/\baway\b/.test(normalized)) return '1x2_away';
  if (/\bhome\b/.test(normalized) || /\bwin\b/.test(normalized)) return '1x2_home';
  return null;
}

function extractDirection(
  primary: string,
  secondary: string,
  allowed: Array<'over' | 'under'>,
): 'over' | 'under' | null {
  for (const text of [secondary, primary]) {
    if (!text) continue;
    const hasOver = /\bover\b/.test(text);
    const hasUnder = /\bunder\b/.test(text);
    if (hasOver && hasUnder) continue;
    for (const candidate of allowed) {
      if (new RegExp(`\\b${candidate}\\b`).test(text)) return candidate;
    }
  }
  return null;
}

function extractLineFromText(text: string, signed: boolean): string | null {
  if (!text) return null;

  const quarterNotation = text.match(/([+-]?\d+(?:\.\d+)?)\s*[,/]\s*([+-]?\d+(?:\.\d+)?)/);
  if (quarterNotation) {
    const first = Number(quarterNotation[1]);
    const second = Number(quarterNotation[2]);
    if (Number.isFinite(first) && Number.isFinite(second)) {
      const average = (first + second) / 2;
      return signed ? formatSignedLine(average) : formatUnsignedLine(average);
    }
  }

  const regex = signed ? /[+-]?\d+(?:\.\d+)?/ : /\d+(?:\.\d+)?/;
  const match = text.match(regex);
  if (!match) return null;
  return signed ? formatSignedLine(Number(match[0])) : formatUnsignedLine(Number(match[0]));
}

function normalizeSignedLine(raw: string | null): string | null {
  if (!raw) return null;

  const quarterNotation = raw.match(/([+-]?\d+(?:\.\d+)?)\s*[,/]\s*([+-]?\d+(?:\.\d+)?)/);
  if (quarterNotation) {
    const first = Number(quarterNotation[1]);
    const second = Number(quarterNotation[2]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    return formatSignedLine((first + second) / 2);
  }

  const value = Number(raw);
  return Number.isFinite(value) ? formatSignedLine(value) : null;
}

function formatSignedLine(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Object.is(value, -0)) value = 0;

  const abs = Math.abs(value);
  const formatted = Number.isInteger(abs) ? String(abs) : stripTrailingZeroes(abs.toFixed(2));
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '-'}${formatted}`;
}

function formatUnsignedLine(value: number | string): string {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return '0';
  return Number.isInteger(num) ? String(num) : stripTrailingZeroes(num.toFixed(2));
}

function stripTrailingZeroes(value: string): string {
  return value.replace(/\.?0+$/, '');
}

/**
 * Build the dedup key: same match + same normalized market = same bet.
 * AI can recommend the SAME market multiple times for the same match,
 * but only the first record counts. Subsequent ones should UPDATE, not INSERT.
 */
export function buildDedupKey(matchId: string, selection: string, betMarket?: string): string {
  return `${matchId}_${normalizeMarket(selection, betMarket)}`;
}
