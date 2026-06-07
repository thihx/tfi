import type { MatchRow } from '../repos/matches.repo.js';

const LEAGUE_HINTS: Readonly<Record<string, readonly string[]>> = {
  friend: ['giao huu', 'giao huu quoc te', 'international friendly', 'friendlies'],
  'world cup': ['world cup', 'wc', 'fifa world cup'],
  'euro championship': ['euro', 'uefa euro', 'championship euro'],
  'uefa nations league': ['nations league', 'uefa nations'],
  'copa america': ['copa america'],
  'asian cup': ['asian cup', 'cup chau a'],
  'asean championship': ['asean', 'dong nam a', 'aff cup'],
};

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/&amp;/gi, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseMatchDateParts(match: MatchRow): { year: number; month: number; day: number } | null {
  if (!match.date) return null;
  const [yearText, monthText, dayText] = match.date.split('-');
  if (!yearText || !monthText || !dayText) return null;
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

function parseKickoffParts(match: MatchRow): { hour: number; minute: number } | null {
  const raw = match.kickoff?.trim();
  if (!raw) return null;
  const [hourText, minuteText = '0'] = raw.split(':');
  if (!hourText) return null;
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function providerTextMatchesDate(normalizedText: string, match: MatchRow): boolean {
  const parts = parseMatchDateParts(match);
  if (!parts) return false;
  const dd = String(parts.day).padStart(2, '0');
  const mm = String(parts.month).padStart(2, '0');
  const yyyy = String(parts.year);
  const yy = yyyy.slice(-2);

  const candidates = [
    `${dd} ${mm} ${yyyy}`,
    `${dd} ${mm} ${yy}`,
    `ngay ${dd} ${mm} ${yyyy}`,
    `ngay ${dd} ${mm} ${yy}`,
    `${yyyy}${mm}${dd}`,
  ];
  return candidates.some((candidate) => normalizedText.includes(candidate));
}

export function providerTextMatchesKickoff(normalizedText: string, match: MatchRow): boolean {
  const parts = parseKickoffParts(match);
  if (!parts) return false;
  const hh = String(parts.hour).padStart(2, '0');
  const min = String(parts.minute).padStart(2, '0');
  const compact = `${hh}${min}`;
  const spaced = `${hh} ${min}`;
  const colon = `${hh}:${min}`;

  return normalizedText.includes(`luc ${compact}`)
    || normalizedText.includes(`luc ${spaced}`)
    || normalizedText.includes(`luc ${colon}`)
    || normalizedText.includes(` ${compact} `)
    || normalizedText.endsWith(` ${compact}`)
    || normalizedText.includes(` ${colon} `);
}

export function providerTextMatchesLeague(normalizedText: string, leagueName: string): boolean {
  const league = normalizeSearchText(leagueName);
  if (league.length >= 5 && normalizedText.includes(league)) return true;

  for (const [needle, hints] of Object.entries(LEAGUE_HINTS)) {
    if (!league.includes(needle)) continue;
    if (hints.some((hint) => normalizedText.includes(hint))) return true;
  }

  const leagueTokens = league.split(' ').filter((token) => token.length >= 5);
  return leagueTokens.some((token) => normalizedText.includes(token));
}

export function countContextSignals(normalizedText: string, match: MatchRow): number {
  let score = 0;
  if (providerTextMatchesDate(normalizedText, match)) score += 1;
  if (providerTextMatchesKickoff(normalizedText, match)) score += 1;
  if (providerTextMatchesLeague(normalizedText, match.league_name)) score += 1;
  return score;
}

export function aliasesMentioned(normalizedText: string, aliases: readonly string[]): boolean {
  for (const alias of aliases) {
    const pattern = new RegExp(`(?:^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g');
    if (pattern.test(normalizedText)) return true;
  }
  return false;
}

export function mentionsMatchWithContext(
  rawText: string,
  match: MatchRow,
  homeAliases: readonly string[],
  awayAliases: readonly string[],
  strictMatch: (text: string, home: readonly string[], away: readonly string[]) => boolean,
): boolean {
  if (strictMatch(rawText, homeAliases, awayAliases)) return true;

  const normalized = normalizeSearchText(rawText);
  const homeHit = aliasesMentioned(normalized, homeAliases);
  const awayHit = aliasesMentioned(normalized, awayAliases);
  if (!homeHit && !awayHit) return false;

  const dateOk = providerTextMatchesDate(normalized, match);
  const kickoffOk = providerTextMatchesKickoff(normalized, match);
  const leagueOk = providerTextMatchesLeague(normalized, match.league_name);

  if (homeHit && awayHit) {
    return dateOk && (kickoffOk || leagueOk);
  }

  return dateOk && (kickoffOk || leagueOk);
}
