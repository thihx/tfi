import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RecommendationCard } from './RecommendationCard';
import type { Recommendation } from '@/types';

const BASE: Recommendation = {
  id: 1,
  match_id: 'match_001',
  match_display: 'Arsenal vs Chelsea',
  home_team: 'Arsenal',
  away_team: 'Chelsea',
  league: 'Premier League',
  selection: 'Over 2.5',
  bet_type: 'INPLAY',
  bet_market: 'O/U',
  odds: 1.85,
  confidence: 7.5,
  risk_level: 'MEDIUM',
  value_percent: 8.2,
  stake_percent: 3,
  stake_amount: 30,
  result: 'pending',
  pnl: 0,
  reasoning: 'Both teams have scored in first 30 mins, expect more goals.',
  key_factors: 'High press intensity, xG divergence',
  warnings: 'Slight rain forecast',
  ai_model: 'claude-sonnet-4-6',
  timestamp: '2026-01-15T14:00:00Z',
};

describe('RecommendationCard', () => {
  it('renders match display from home/away team names', () => {
    render(<RecommendationCard rec={BASE} />);
    expect(screen.getByText('Arsenal vs Chelsea')).toBeInTheDocument();
  });

  it('renders league and timestamp together', () => {
    render(<RecommendationCard rec={BASE} />);
    const leagueAndTime = screen.getByTitle(/Premier League · 15-Jan-2026 \d{2}:00/);
    expect(leagueAndTime).toBeInTheDocument();
  });

  it('renders selection without a separate market badge', () => {
    render(<RecommendationCard rec={BASE} />);
    expect(screen.getByText('Over 2.5')).toBeInTheDocument();
    expect(screen.queryByText('O/U')).not.toBeInTheDocument();
  });

  it('renders odds prominently', () => {
    render(<RecommendationCard rec={BASE} />);
    expect(screen.getByText('1.85')).toBeInTheDocument();
  });

  it('renders confidence with bar', () => {
    render(<RecommendationCard rec={BASE} />);
    expect(screen.getByText('7.5/10')).toBeInTheDocument();
  });

  it('renders risk level badge', () => {
    render(<RecommendationCard rec={BASE} />);
    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
  });

  it('renders value percent', () => {
    render(<RecommendationCard rec={BASE} />);
    expect(screen.getByText('+8.2%')).toBeInTheDocument();
  });

  it('renders stake percent', () => {
    render(<RecommendationCard rec={BASE} />);
    expect(screen.getByText('3%')).toBeInTheDocument();
  });

  it('renders key factors section', () => {
    render(<RecommendationCard rec={BASE} />);
    expect(screen.getByText('Factors')).toBeInTheDocument();
    expect(screen.getByText('High press intensity, xG divergence')).toBeInTheDocument();
  });

  it('renders warnings section', () => {
    render(<RecommendationCard rec={BASE} />);
    fireEvent.click(screen.getByTitle('Warnings'));
    expect(screen.getByText('Slight rain forecast')).toBeInTheDocument();
  });

  it('collapses reasoning by default', () => {
    render(<RecommendationCard rec={BASE} />);
    expect(screen.queryByText('Both teams have scored in first 30 mins, expect more goals.')).not.toBeInTheDocument();
  });

  it('expands reasoning on toggle', () => {
    render(<RecommendationCard rec={BASE} />);
    fireEvent.click(screen.getByText('Reasoning'));
    expect(screen.getByText('Both teams have scored in first 30 mins, expect more goals.')).toBeInTheDocument();
  });

  it('shows Reasoning header', () => {
    render(<RecommendationCard rec={BASE} />);
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
  });

  it('calls onViewMatch when match display is clicked', () => {
    const onViewMatch = vi.fn();
    render(<RecommendationCard rec={BASE} onViewMatch={onViewMatch} />);
    fireEvent.click(screen.getByText('Arsenal vs Chelsea'));
    expect(onViewMatch).toHaveBeenCalledWith('match_001', 'Arsenal vs Chelsea');
  });

  it('does not throw when onViewMatch is not provided', () => {
    render(<RecommendationCard rec={BASE} />);
    fireEvent.click(screen.getByText('Arsenal vs Chelsea'));
  });

  it('shows score and minute when live (minute is set)', () => {
    const rec: Recommendation = { ...BASE, minute: 43, score: '1-0' };
    render(<RecommendationCard rec={rec} />);
    expect(screen.getByText('1-0')).toBeInTheDocument();
    expect(screen.getByText("43'")).toBeInTheDocument();
  });

  it('does not show score row when minute is null', () => {
    render(<RecommendationCard rec={{ ...BASE, minute: null }} />);
    expect(screen.queryByText('1-0')).not.toBeInTheDocument();
  });

  it('shows ft_score and actual_outcome in footer', () => {
    const rec: Recommendation = { ...BASE, ft_score: '2-1', actual_outcome: 'Over hit at 75th minute' };
    render(<RecommendationCard rec={rec} />);
    expect(screen.getByText('FT 2-1')).toBeInTheDocument();
    expect(screen.getByText('Over hit at 75th minute')).toBeInTheDocument();
  });

  it('shows HT and optional corner totals next to FT when present', () => {
    const rec: Recommendation = {
      ...BASE,
      ft_score: '1-0',
      ht_score: '0-0',
      corners_ft: '7-4',
      actual_outcome: 'Under cashed',
    };
    render(<RecommendationCard rec={rec} />);
    expect(screen.getByText('FT 1-0 (HT 0-0) · Cr 7-4')).toBeInTheDocument();
  });

  it('renders P/L with sign and color class', () => {
    const rec: Recommendation = { ...BASE, result: 'win', pnl: 37.5 };
    render(<RecommendationCard rec={rec} />);
    expect(screen.getByText('+$37.50')).toBeInTheDocument();
  });

  it('renders negative P/L correctly', () => {
    const rec: Recommendation = { ...BASE, result: 'loss', pnl: -30 };
    render(<RecommendationCard rec={rec} />);
    expect(screen.getByText('$-30.00')).toBeInTheDocument();
  });

  it('falls back to match_display when home/away are absent', () => {
    const rec: Recommendation = { ...BASE, home_team: undefined, away_team: undefined, match_display: 'Team A vs Team B' };
    render(<RecommendationCard rec={rec} />);
    expect(screen.getByText('Team A vs Team B')).toBeInTheDocument();
  });

  it('renders without optional fields without crashing', () => {
    const minimal: Recommendation = {
      match_display: 'X vs Y',
      selection: 'Home',
      odds: 2.0,
      confidence: 6,
      stake_amount: 20,
      result: 'pending',
      pnl: 0,
      bet_type: 'INPLAY',
    };
    render(<RecommendationCard rec={minimal} />);
    expect(screen.getByText('X vs Y')).toBeInTheDocument();
  });
});
