import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MatchLiveStreamControls, getLiveStreamTooltip } from './MatchLiveStreamControls';
import type { MatchLiveStreamLink } from '@/lib/services/api';

const link = (url: string, sourceName: string): MatchLiveStreamLink => ({
  url,
  sourceName,
  sourceUrl: `https://${sourceName}/`,
  title: 'Test match',
  verificationStatus: 'team_match',
  liveHint: true,
});

describe('MatchLiveStreamControls', () => {
  it('renders nothing when there are no links', () => {
    const { container } = render(<MatchLiveStreamControls links={[]} onOpen={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels multiple streams as Live 1 and Live 2', () => {
    render(
      <MatchLiveStreamControls
        links={[
          link('https://xoilacztu.tv/a', 'xoilacztu.tv'),
          link('https://socolive16.cv/b', 'socolive16.cv'),
        ]}
        onOpen={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Live 1 · xoilacztu.tv' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Live 2 · socolive16.cv' })).toBeInTheDocument();
  });

  it('opens the selected stream link', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const selected = link('https://xoilacztu.tv/a', 'xoilacztu.tv');

    render(<MatchLiveStreamControls links={[selected]} onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'Live · xoilacztu.tv' }));

    expect(onOpen).toHaveBeenCalledWith(selected);
  });

  it('builds numbered tooltips', () => {
    expect(getLiveStreamTooltip(link('https://a', 'xoilacztu.tv'), 0, 2)).toBe('Live 1 · xoilacztu.tv');
    expect(getLiveStreamTooltip(link('https://b', 'socolive16.cv'), 1, 2)).toBe('Live 2 · socolive16.cv');
    expect(getLiveStreamTooltip(link('https://a', 'xoilacztu.tv'), 0, 1)).toBe('Live · xoilacztu.tv');
  });
});