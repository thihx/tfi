// ============================================================
// Job: Fetch Matches
// Mirrors: Apps Script fetchMatchesJob()
//
// 1. Read active approved leagues from DB
// 2. Call API-Football for today + tomorrow fixtures
// 3. Filter by league + status
// 4. Full-refresh matches table
// ============================================================

import { config } from '../config.js';
import { fetchFixturesForDate, type ApiFixture } from '../lib/football-api.js';
import * as leagueRepo from '../repos/leagues.repo.js';
import * as matchRepo from '../repos/matches.repo.js';
import { archiveFinishedMatches } from '../repos/matches-history.repo.js';

const ALLOWED_STATUSES = ['NS', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'];

function toDateString(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)!.value;
  return `${p('year')}-${p('month')}-${p('day')}`;
}

function fixtureToMatchRow(f: ApiFixture): matchRepo.MatchRow {
  const parts = String(f.fixture.date).split('T');
  const datePart = parts[0] || '';
  const kickoff = (parts[1] || '').substring(0, 5);

  return {
    match_id: String(f.fixture.id),
    date: datePart,
    kickoff,
    league_id: f.league.id,
    league_name: f.league.name,
    home_team: f.teams.home.name,
    away_team: f.teams.away.name,
    home_logo: f.teams.home.logo,
    away_logo: f.teams.away.logo,
    venue: f.fixture.venue?.name || 'TBD',
    status: f.fixture.status.short,
    home_score: f.goals.home,
    away_score: f.goals.away,
    current_minute: f.fixture.status.elapsed,
    last_updated: new Date().toISOString(),
  };
}

export async function fetchMatchesJob(): Promise<{ saved: number; leagues: number }> {
  // 1. Get active league IDs
  const activeLeagues = await leagueRepo.getActiveLeagues();
  if (activeLeagues.length === 0) {
    console.log('[fetchMatchesJob] No active leagues, skip.');
    return { saved: 0, leagues: 0 };
  }
  const leagueIdSet = new Set(activeLeagues.map((l) => l.league_id));

  // 2. Calculate today + tomorrow
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateFrom = toDateString(now, config.timezone);
  const dateTo = toDateString(tomorrow, config.timezone);

  // 3. Fetch from API-Football
  const [todayFixtures, tomorrowFixtures] = await Promise.all([
    fetchFixturesForDate(dateFrom),
    fetchFixturesForDate(dateTo),
  ]);
  const allFixtures = todayFixtures.concat(tomorrowFixtures);
  console.log(`[fetchMatchesJob] Raw: today=${todayFixtures.length} tomorrow=${tomorrowFixtures.length} total=${allFixtures.length}`);

  // 4. Filter by approved leagues
  const leagueFiltered = allFixtures.filter((f) => leagueIdSet.has(f.league.id));

  // 5. Filter by status
  const statusFiltered = leagueFiltered.filter((f) => ALLOWED_STATUSES.includes(f.fixture.status.short));

  console.log(`[fetchMatchesJob] After league filter: ${leagueFiltered.length}, after status filter: ${statusFiltered.length}`);

  // 6. Transform to rows
  const rows = statusFiltered.map(fixtureToMatchRow);

  // 7. Archive finished matches before TRUNCATE
  const allCurrentMatches = await matchRepo.getAllMatches();
  const archivedCount = await archiveFinishedMatches(allCurrentMatches);
  if (archivedCount > 0) {
    console.log(`[fetchMatchesJob] Archived ${archivedCount} FT matches to history`);
  }

  // 8. Full-refresh matches table
  const saved = await matchRepo.replaceAllMatches(rows);
  const uniqueLeagues = new Set(rows.map((r) => r.league_id)).size;

  console.log(`[fetchMatchesJob] ✅ Saved ${saved} matches from ${uniqueLeagues} leagues`);
  return { saved, leagues: uniqueLeagues };
}
