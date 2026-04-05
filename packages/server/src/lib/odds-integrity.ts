export interface OddsCanonicalLike {
  ou?: { line: number; over: number | null; under: number | null };
  corners_ou?: { line: number; over: number | null; under: number | null };
}

export interface OddsContaminationCheck {
  contaminated: boolean;
  reason: string;
}

export function detectGoalsCornersLineContamination(
  canonical: OddsCanonicalLike,
  currentTotalGoals: number,
): OddsContaminationCheck {
  const goalsLine = canonical.ou?.line;
  const cornersLine = canonical.corners_ou?.line;
  if (typeof goalsLine !== 'number' || typeof cornersLine !== 'number') {
    return { contaminated: false, reason: '' };
  }

  if (goalsLine !== cornersLine) {
    return { contaminated: false, reason: '' };
  }

  if (goalsLine - currentTotalGoals < 4) {
    return { contaminated: false, reason: '' };
  }

  return {
    contaminated: true,
    reason: `Removed goals O/U market from prompt: goals line ${goalsLine} exactly matches corners line ${cornersLine} while current total goals are only ${currentTotalGoals}, which strongly suggests corners-market contamination or malformed odds canonicalization.`,
  };
}
