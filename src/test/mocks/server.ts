import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * MSW handlers for mocking the Google Apps Script API.
 * Default handlers return empty success responses.
 * Override per-test with `server.use(...)`.
 */
const defaultHandlers = [
  // GET - fetch data
  http.get('https://script.google.com/macros/s/*/exec', ({ request }) => {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    switch (action) {
      case 'getMatches':
        return HttpResponse.json({ success: true, data: [] });
      case 'getWatchlist':
        return HttpResponse.json({ success: true, data: [] });
      case 'getRecommendations':
        return HttpResponse.json({ success: true, data: [] });
      case 'getApprovedLeagues':
        return HttpResponse.json({ success: true, data: [] });
      default:
        return HttpResponse.json({ success: true, data: [] });
    }
  }),

  // POST - mutations
  http.post('https://script.google.com/macros/s/*/exec', () => {
    return HttpResponse.json({ success: true });
  }),
];

export const server = setupServer(...defaultHandlers);

/**
 * Helper to create a match fixture for tests.
 */
export function createMatchFixture(overrides: Record<string, unknown> = {}) {
  return {
    match_id: '12345',
    date: '2026-03-16',
    kickoff: '20:00',
    home_team: 'Manchester United',
    away_team: 'Liverpool',
    league_id: 39,
    league_name: 'Premier League',
    status: 'NS',
    home_score: null,
    away_score: null,
    current_minute: null,
    ...overrides,
  };
}

/**
 * Helper to create a watchlist item fixture for tests.
 */
export function createWatchlistFixture(overrides: Record<string, unknown> = {}) {
  return {
    match_id: '12345',
    date: '2026-03-16',
    league: 'Premier League',
    league_id: 39,
    home_team: 'Manchester United',
    away_team: 'Liverpool',
    kickoff: '20:00',
    mode: 'B',
    priority: 2,
    custom_conditions: '',
    status: 'pending',
    ...overrides,
  };
}

/**
 * Helper to create a recommendation fixture for tests.
 */
export function createRecommendationFixture(overrides: Record<string, unknown> = {}) {
  return {
    match_id: '12345',
    date: '2026-03-16',
    home_team: 'Manchester United',
    away_team: 'Liverpool',
    bet_type: 'Match Result',
    selection: 'Home Win',
    odds: 1.85,
    confidence: 75,
    stake: 2,
    result: 'win',
    pnl: 1.7,
    ...overrides,
  };
}
