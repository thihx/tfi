export interface RuntimeShadowSegmentMetadataInput {
  matchId?: unknown;
  leagueId?: unknown;
  leagueName?: unknown;
  homeTeamId?: unknown;
  homeTeamName?: unknown;
  awayTeamId?: unknown;
  awayTeamName?: unknown;
}

export interface RuntimeShadowSegmentMetadata {
  leagueId: string;
  leagueName: string;
  leagueSegmentKey: string;
  homeTeamId: string;
  homeTeamName: string;
  homeTeamSegmentKey: string;
  awayTeamId: string;
  awayTeamName: string;
  awayTeamSegmentKey: string;
  teamSegmentKeys: string[];
  matchSegmentKey: string;
}

function cleanString(value: unknown): string {
  return String(value ?? '').trim();
}

function cleanId(value: unknown): string {
  if (value == null || value === '') return '';
  const raw = cleanString(value);
  return raw && raw !== '0' ? raw : '';
}

function segmentSlug(value: unknown): string {
  const slug = cleanString(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return slug || 'unknown';
}

function segmentKey(prefix: 'league' | 'team', id: unknown, name: unknown): string {
  const idPart = cleanId(id);
  return `${prefix}:${idPart || segmentSlug(name)}`;
}

export function buildRuntimeShadowSegmentMetadata(
  input: RuntimeShadowSegmentMetadataInput,
): RuntimeShadowSegmentMetadata {
  const leagueId = cleanId(input.leagueId);
  const leagueName = cleanString(input.leagueName);
  const homeTeamId = cleanId(input.homeTeamId);
  const homeTeamName = cleanString(input.homeTeamName);
  const awayTeamId = cleanId(input.awayTeamId);
  const awayTeamName = cleanString(input.awayTeamName);
  const leagueSegmentKey = segmentKey('league', leagueId, leagueName);
  const homeTeamSegmentKey = segmentKey('team', homeTeamId, homeTeamName);
  const awayTeamSegmentKey = segmentKey('team', awayTeamId, awayTeamName);
  const matchId = cleanId(input.matchId);

  return {
    leagueId,
    leagueName,
    leagueSegmentKey,
    homeTeamId,
    homeTeamName,
    homeTeamSegmentKey,
    awayTeamId,
    awayTeamName,
    awayTeamSegmentKey,
    teamSegmentKeys: Array.from(new Set([homeTeamSegmentKey, awayTeamSegmentKey])),
    matchSegmentKey: matchId
      ? `match:${matchId}`
      : `match:${homeTeamSegmentKey}:vs:${awayTeamSegmentKey}`,
  };
}

export function readRuntimeShadowSegmentMetadata(
  metadata: Record<string, unknown>,
): RuntimeShadowSegmentMetadata {
  return buildRuntimeShadowSegmentMetadata({
    matchId: metadata.matchId,
    leagueId: metadata.leagueId,
    leagueName: metadata.leagueName ?? metadata.league,
    homeTeamId: metadata.homeTeamId,
    homeTeamName: metadata.homeTeamName ?? metadata.homeName,
    awayTeamId: metadata.awayTeamId,
    awayTeamName: metadata.awayTeamName ?? metadata.awayName,
  });
}
