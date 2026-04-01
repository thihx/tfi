export type TacticalOverlayEligibilityPolicy = 'eligible_core' | 'eligible_extended' | 'ineligible';
export type TacticalOverlayEntityType = 'club' | 'national_team' | 'unknown';
export type TacticalOverlayCompetitionKind =
  | 'domestic_league'
  | 'continental_club'
  | 'international_tournament'
  | 'international_qualifier'
  | 'friendly'
  | 'other';

export interface TacticalOverlayCompetitionInput {
  leagueName: string;
  country?: string | null;
  type?: string | null;
  topLeague?: boolean | null;
}

export interface TacticalOverlayCompetitionClassification {
  eligible: boolean;
  policy: TacticalOverlayEligibilityPolicy;
  entityType: TacticalOverlayEntityType;
  competitionKind: TacticalOverlayCompetitionKind;
  reason: string;
  sortRank: number;
}

const CONTINENTAL_CLUB_PATTERNS = [
  /\bchampions league\b/i,
  /\beuropa league\b/i,
  /\bconference league\b/i,
  /\bcopa libertadores\b/i,
  /\bcopa sudamericana\b/i,
  /\brecopa\b/i,
  /\bclub world cup\b/i,
  /\bafc champions league\b/i,
  /\bconcacaf champions\b/i,
  /\bcaf champions league\b/i,
  /\bconfederation cup\b/i,
  /\bleagues cup\b/i,
];

const INTERNATIONAL_TOURNAMENT_PATTERNS = [
  /\bworld cup\b/i,
  /\beuropean championship\b/i,
  /\beuro\b/i,
  /\bcopa america\b/i,
  /\basian cup\b/i,
  /\bafrica cup of nations\b/i,
  /\bafcon\b/i,
  /\bgold cup\b/i,
  /\bnations league\b/i,
];

const QUALIFIER_PATTERNS = [
  /\bqualification\b/i,
  /\bqualifier\b/i,
  /\bqualifying\b/i,
];

const FRIENDLY_PATTERNS = [
  /\bfriendly\b/i,
  /\bfriendlies\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function classifyTacticalOverlayCompetition(
  input: TacticalOverlayCompetitionInput,
): TacticalOverlayCompetitionClassification {
  const leagueName = normalize(input.leagueName);
  const country = normalize(input.country);
  const type = normalize(input.type);
  const combined = `${leagueName} ${country} ${type}`.trim();

  if (input.topLeague) {
    return {
      eligible: true,
      policy: 'eligible_core',
      entityType: 'club',
      competitionKind: 'domestic_league',
      reason: 'top_domestic_league',
      sortRank: 400,
    };
  }

  if (matchesAny(combined, FRIENDLY_PATTERNS)) {
    return {
      eligible: false,
      policy: 'ineligible',
      entityType: country === 'world' || type === 'international' ? 'national_team' : 'unknown',
      competitionKind: 'friendly',
      reason: 'friendly_context',
      sortRank: 0,
    };
  }

  if (matchesAny(combined, CONTINENTAL_CLUB_PATTERNS)) {
    return {
      eligible: true,
      policy: 'eligible_core',
      entityType: 'club',
      competitionKind: 'continental_club',
      reason: 'continental_club_competition',
      sortRank: 320,
    };
  }

  if (matchesAny(combined, INTERNATIONAL_TOURNAMENT_PATTERNS)) {
    if (matchesAny(combined, QUALIFIER_PATTERNS)) {
      return {
        eligible: true,
        policy: 'eligible_extended',
        entityType: 'national_team',
        competitionKind: 'international_qualifier',
        reason: 'international_qualifier',
        sortRank: 280,
      };
    }
    return {
      eligible: true,
      policy: 'eligible_core',
      entityType: 'national_team',
      competitionKind: 'international_tournament',
      reason: 'international_tournament',
      sortRank: 350,
    };
  }

  if ((type === 'international' || country === 'world') && matchesAny(combined, QUALIFIER_PATTERNS)) {
    return {
      eligible: true,
      policy: 'eligible_extended',
      entityType: 'national_team',
      competitionKind: 'international_qualifier',
      reason: 'international_qualifier',
      sortRank: 280,
    };
  }

  return {
    eligible: false,
    policy: 'ineligible',
    entityType: 'unknown',
    competitionKind: 'other',
    reason: 'competition_not_approved',
    sortRank: 0,
  };
}

