export const HT_CANONICAL_PREFIX = "ht_" as const;

export function isFirstHalfApiBetName(betNameLower: string): boolean {
  const hasSecondHalfOnly =
    /2nd\s*half|second\s*half|\b2h\b/i.test(betNameLower)
    && !/1st|first/i.test(betNameLower);
  if (hasSecondHalfOnly) return false;
  return (
    /1st\s*half|first\s*half|\b1h\b/i.test(betNameLower)
    || /\bht\b/i.test(betNameLower)
    || /half[\s-]*time/i.test(betNameLower)
  );
}

export function isSecondHalfOnlyApiBetName(betNameLower: string): boolean {
  const hasFirst = /1st|first|half[\s-]*time/i.test(betNameLower);
  if (hasFirst) return false;
  return /2nd\s*half|second\s*half|\b2h\b/i.test(betNameLower);
}

export function isHtGoalsCanonicalMarket(normalizedMarket: string): boolean {
  return /^ht_(over|under)_\d/.test(normalizedMarket);
}
