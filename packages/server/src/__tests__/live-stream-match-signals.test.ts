import { describe, expect, test } from 'vitest';
import {
  aliasesMentioned,
  mentionsMatchWithContext,
  providerTextMatchesDate,
  providerTextMatchesKickoff,
  providerTextMatchesLeague,
} from '../lib/live-stream-match-signals.js';
import type { MatchRow } from '../repos/matches.repo.js';

function friendlyMatch(): MatchRow {
  return {
    match_id: '900',
    date: '2026-06-07',
    kickoff: '23:30',
    league_id: 10,
    league_name: 'Friendlies',
    home_team: 'Denmark',
    away_team: 'Ukraine',
    home_logo: '',
    away_logo: '',
    venue: '',
    status: '1H',
    home_score: 0,
    away_score: 0,
    current_minute: 4,
    last_updated: '2026-06-07T16:30:00.000Z',
  };
}

describe('live stream match signals', () => {
  test('detects provider slug date and kickoff hints', () => {
    const text = 'dan mach vs ukraine luc 2330 ngay 07 06 2026';
    const match = friendlyMatch();
    expect(providerTextMatchesDate(text, match)).toBe(true);
    expect(providerTextMatchesKickoff(text, match)).toBe(true);
  });

  test('detects friendly league hints in provider text', () => {
    expect(providerTextMatchesLeague('giao huu quoc te dan mach ukraine', 'Friendlies')).toBe(true);
  });

  test('accepts one-team match when date and kickoff corroborate', () => {
    const match = friendlyMatch();
    const text = 'ukraine luc 2330 ngay 07 06 2026';
    const strict = () => false;
    expect(aliasesMentioned(text, ['ukraine'])).toBe(true);
    expect(mentionsMatchWithContext(text, match, ['denmark'], ['ukraine'], strict)).toBe(true);
  });
});
