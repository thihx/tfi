/** Shared line parsing for goals O/U and Asian handicap bet_market keys (avoids circular imports). */

export function parseBetMarketLineSuffix(prefix: string, betMarket: string): number | null {
  if (!betMarket.startsWith(prefix)) return null;
  const raw = betMarket.slice(prefix.length);
  if (!raw) return null;
  const line = Number(raw);
  return Number.isFinite(line) ? line : null;
}

export function sameOddsLine(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.001;
}