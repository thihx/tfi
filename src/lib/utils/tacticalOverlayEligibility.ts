import type { League } from '@/types';

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

const QUALIFIER_PATTERNS = [/\bqualification\b/i, /\bqualifier\b/i, /\bqualifying\b/i];
const FRIENDLY_PATTERNS = [/\bfriendly\b/i, /\bfriendlies\b/i];

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function isOverlayEligibleLeague(league: Pick<League, 'league_name' | 'country' | 'type' | 'top_league'> | null | undefined): boolean {
  if (!league) return false;
  if (league.top_league) return true;

  const combined = `${normalize(league.league_name)} ${normalize(league.country)} ${normalize(league.type)}`.trim();
  if (matchesAny(combined, FRIENDLY_PATTERNS)) return false;
  if (matchesAny(combined, CONTINENTAL_CLUB_PATTERNS)) return true;
  if (matchesAny(combined, INTERNATIONAL_TOURNAMENT_PATTERNS)) return true;
  if ((normalize(league.type) === 'international' || normalize(league.country) === 'world') && matchesAny(combined, QUALIFIER_PATTERNS)) {
    return true;
  }
  return false;
}

