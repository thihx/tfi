/** Line suffix parsing for goals O/U and Asian handicap bet_market keys. */

export function parseBetMarketLineSuffix(prefix: string, betMarket: string): number | null {
  if (!betMarket.startsWith(prefix)) return null;
  const raw = betMarket.slice(prefix.length);
  const line = Number(raw);
  return Number.isFinite(line) ? line : null;
}

export function sameOddsLine(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.0001;
}
