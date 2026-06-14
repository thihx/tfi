import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { MatchHubContextView } from '@/components/ui/matchHubPanels';
import type { WatchlistItem } from '@/types';

const watchlist: WatchlistItem = {
  match_id: '1539002',
  date: '2026-06-15',
  league: 'World Cup',
  home_team: 'Sweden',
  away_team: 'Tunisia',
  kickoff: '21:00',
  custom_conditions: '',
  strategic_context: {
    home_motivation: '',
    away_motivation: '',
    league_positions: '',
    fixture_congestion: '',
    rotation_risk: '',
    key_absences: '',
    h2h_narrative: '',
    summary: 'Sweden attack profile is stronger, but live evidence must confirm.',
    searched_at: '2026-06-14T14:24:00.000Z',
    version: 2,
    qualitative: {
      en: {
        home_motivation: '',
        away_motivation: '',
        league_positions: '',
        fixture_congestion: '',
        rotation_risk: '',
        key_absences: '',
        h2h_narrative: '',
        summary: 'Sweden attack profile is stronger, but live evidence must confirm.',
      },
      vi: {
        home_motivation: '',
        away_motivation: '',
        league_positions: '',
        fixture_congestion: '',
        rotation_risk: '',
        key_absences: '',
        h2h_narrative: '',
        summary: 'Sweden attack profile is stronger, but live evidence must confirm.',
      },
    },
    quantitative: {
      home_last5_points: 8,
      away_last5_points: 5,
      home_last5_goals_for: 10,
      away_last5_goals_for: 2,
      home_last5_goals_against: 9,
      away_last5_goals_against: 7,
      home_home_goals_avg: 2,
      away_away_goals_avg: 0.4,
      home_over_2_5_rate_last10: 0.6,
      away_over_2_5_rate_last10: 0.4,
      home_btts_rate_last10: 0.7,
      away_btts_rate_last10: 0.6,
      home_clean_sheet_rate_last10: 0,
      away_clean_sheet_rate_last10: 0.2,
      home_failed_to_score_rate_last10: 0.3,
      away_failed_to_score_rate_last10: 0.3,
    },
    source_meta: {
      search_quality: 'high',
      web_search_queries: ['Sweden Tunisia World Cup preview'],
      sources: [
        {
          title: 'FIFA match centre',
          url: 'https://www.fifa.com/',
          domain: 'fifa.com',
          publisher: 'FIFA',
          language: 'en',
          source_type: 'official',
          trust_tier: 'tier_1',
        },
      ],
      trusted_source_count: 1,
      rejected_source_count: 0,
      rejected_domains: [],
    },
    _meta: {
      refresh_status: 'good',
      failure_count: 0,
    },
  },
};

beforeEach(() => {
  localStorage.setItem('liveMonitorConfig', JSON.stringify({ UI_LANGUAGE: 'en' }));
});

describe('MatchHubContextView', () => {
  test('keeps raw strategic diagnostics out of the user-facing context panel', () => {
    render(<MatchHubContextView watchlist={watchlist} recs={[]} />);

    expect(screen.getByText('Strategic Context')).toBeInTheDocument();
    expect(screen.getByText('Source Quality')).toBeInTheDocument();
    expect(screen.getByText('Sweden attack profile is stronger, but live evidence must confirm.')).toBeInTheDocument();
    expect(screen.queryByText('Quantitative Priors')).not.toBeInTheDocument();
    expect(screen.queryByText('Trusted Domains')).not.toBeInTheDocument();
    expect(screen.queryByText('Search Queries')).not.toBeInTheDocument();
  });
});
