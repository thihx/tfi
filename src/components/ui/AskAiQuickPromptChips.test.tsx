import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AskAiQuickPromptChips } from './AskAiQuickPromptChips';

const PROMPTS = [
  { id: '1', text: 'Is the current over/under reasonable?' },
  { id: '2', text: 'Should I prioritize Asian Handicap or Over/Under?' },
] as const;

describe('AskAiQuickPromptChips', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders collapsible summary on mobile and expands on click', async () => {
    const user = userEvent.setup();
    render(
      <AskAiQuickPromptChips
        label="Quick prompts"
        prompts={PROMPTS}
        collapsible
        onPick={() => {}}
      />,
    );

    expect(screen.getByText('Quick prompts')).toBeInTheDocument();
    expect(screen.queryByText(PROMPTS[0].text)).not.toBeVisible();

    await user.click(screen.getByText('Quick prompts'));
    expect(screen.getByText(PROMPTS[0].text)).toBeVisible();
  });
});