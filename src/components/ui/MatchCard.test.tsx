import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MatchCard } from './MatchCard';
import type { Match } from '@/types';

const BASE_MATCH: Match = {
  match_id: 'm_001',
  date: '2026-01-15',
  kickoff: '20:00:00',
  league_id: 39,
  league_name: 'Premier League',
  home_team: 'Arsenal',
  away_team: 'Chelsea',
  home_logo: 'https://cdn.example.com/arsenal.png',
  away_logo: 'https://cdn.example.com/chelsea.png',
  home_score: null,
  away_score: null,
  status: 'NS',
  current_minute: undefined,
  prediction: undefined,
};

const LIVE_MATCH: Match = {
  ...BASE_MATCH,
  status: '2H',
  home_score: 1,
  away_score: 0,
  current_minute: '67',
};

describe('MatchCard', () => {
  it('renders team names', () => {
    render(<MatchCard match={BASE_MATCH} />);
    expect(screen.getByText('Arsenal')).toBeInTheDocument();
    expect(screen.getByText('Chelsea')).toBeInTheDocument();
  });

  it('renders league name', () => {
    render(<MatchCard match={BASE_MATCH} />);
    expect(screen.getByText('Premier League')).toBeInTheDocument();
  });

  it('renders NS status badge', () => {
    render(<MatchCard match={BASE_MATCH} />);
    expect(screen.getByText('NS')).toBeInTheDocument();
  });

  it('renders kickoff time for NS matches', () => {
    render(<MatchCard match={BASE_MATCH} />);
    expect(screen.getByText('20:00')).toBeInTheDocument();
  });

  it('shows "vs" when no score available', () => {
    render(<MatchCard match={BASE_MATCH} />);
    expect(screen.getByText('vs')).toBeInTheDocument();
  });

  it('renders live score', () => {
    render(<MatchCard match={LIVE_MATCH} />);
    expect(screen.getByText('1 – 0')).toBeInTheDocument();
  });

  it('renders live minute', () => {
    render(<MatchCard match={LIVE_MATCH} />);
    expect(screen.getByText("67'")).toBeInTheDocument();
  });

  it('renders live status badge', () => {
    render(<MatchCard match={LIVE_MATCH} />);
    expect(screen.getByText('2H')).toBeInTheDocument();
  });

  it('renders FT status badge', () => {
    const ft: Match = { ...BASE_MATCH, status: 'FT', home_score: 2, away_score: 1 };
    render(<MatchCard match={ft} />);
    expect(screen.getByText('FT')).toBeInTheDocument();
  });

  it('renders prediction badge when present', () => {
    const m: Match = { ...BASE_MATCH, prediction: 'Over 2.5' };
    render(<MatchCard match={m} />);
    expect(screen.getByText('🤖 Over 2.5')).toBeInTheDocument();
  });

  it('does not render prediction section when absent', () => {
    render(<MatchCard match={BASE_MATCH} />);
    expect(screen.queryByText(/🤖/)).not.toBeInTheDocument();
  });

  it('renders team logo images', () => {
    render(<MatchCard match={BASE_MATCH} />);
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute('alt', 'Arsenal');
    expect(imgs[1]).toHaveAttribute('alt', 'Chelsea');
  });

  it('renders without logos when not provided', () => {
    const m: Match = { ...BASE_MATCH, home_logo: '', away_logo: '' };
    render(<MatchCard match={m} />);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<MatchCard match={BASE_MATCH} onClick={onClick} />);
    fireEvent.click(screen.getByText('Arsenal'));
    expect(onClick).toHaveBeenCalledWith(BASE_MATCH);
  });

  it('does not crash when onClick is not provided', () => {
    render(<MatchCard match={BASE_MATCH} />);
    fireEvent.click(screen.getByText('Arsenal'));
    // no error
  });

  it('renders action buttons', () => {
    const onAction = vi.fn();
    render(
      <MatchCard
        match={BASE_MATCH}
        actions={[
          { label: 'Ask AI', onClick: onAction, variant: 'primary' },
          { label: 'Watch', onClick: vi.fn(), variant: 'secondary' },
        ]}
      />,
    );
    expect(screen.getByText('Ask AI')).toBeInTheDocument();
    expect(screen.getByText('Watch')).toBeInTheDocument();
  });

  it('fires action callback with match data', () => {
    const onAction = vi.fn();
    render(<MatchCard match={BASE_MATCH} actions={[{ label: 'Ask AI', onClick: onAction }]} />);
    fireEvent.click(screen.getByText('Ask AI'));
    expect(onAction).toHaveBeenCalledWith(BASE_MATCH);
  });

  it('action click does not propagate to card onClick', () => {
    const cardClick = vi.fn();
    const actionClick = vi.fn();
    render(
      <MatchCard
        match={BASE_MATCH}
        onClick={cardClick}
        actions={[{ label: 'Ask AI', onClick: actionClick }]}
      />,
    );
    fireEvent.click(screen.getByText('Ask AI'));
    expect(actionClick).toHaveBeenCalled();
    expect(cardClick).not.toHaveBeenCalled();
  });

  it('disables action button when disabled=true', () => {
    render(<MatchCard match={BASE_MATCH} actions={[{ label: 'Ask AI', onClick: vi.fn(), disabled: true }]} />);
    expect(screen.getByText('Ask AI')).toBeDisabled();
  });

  it('applies highlighted outline style', () => {
    const { container } = render(<MatchCard match={BASE_MATCH} highlighted />);
    const card = container.querySelector('.card') as HTMLElement;
    expect(card.style.outline).toBe('2px solid var(--primary)');
  });

  it('shows progress bar only for live matches', () => {
    const { container: liveContainer } = render(<MatchCard match={LIVE_MATCH} />);
    const { container: nsContainer } = render(<MatchCard match={BASE_MATCH} />);
    // Live match has a progress bar div (height 3px)
    const liveProgressDivs = liveContainer.querySelectorAll('[style*="height: 3px"]');
    const nsProgressDivs = nsContainer.querySelectorAll('[style*="height: 3px"]');
    expect(liveProgressDivs.length).toBeGreaterThan(0);
    expect(nsProgressDivs.length).toBe(0);
  });
});
