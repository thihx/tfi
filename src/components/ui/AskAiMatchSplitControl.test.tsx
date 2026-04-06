import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AskAiMatchSplitControl } from './AskAiMatchSplitControl';

describe('AskAiMatchSplitControl', () => {
  it('calls onOpenQuestion when the chat button is clicked (no dropdown step)', async () => {
    const user = userEvent.setup();
    const onQuick = vi.fn();
    const onOpenQuestion = vi.fn();

    render(
      <AskAiMatchSplitControl
        variant="table"
        hasResult={false}
        isAnalyzing={false}
        isWatched
        onQuick={onQuick}
        onOpenQuestion={onOpenQuestion}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Ask with a custom question' }));
    expect(onOpenQuestion).toHaveBeenCalledTimes(1);
    expect(onQuick).not.toHaveBeenCalled();
  });

  it('exposes tooltip text on the chat button via title', () => {
    render(
      <AskAiMatchSplitControl
        variant="table"
        hasResult={false}
        isAnalyzing={false}
        isWatched
        onQuick={vi.fn()}
        onOpenQuestion={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Ask with a custom question' })).toHaveAttribute(
      'title',
      'Ask with a custom question…',
    );
  });

  it('uses jump-to-chat label when cached result exists', () => {
    render(
      <AskAiMatchSplitControl
        variant="table"
        hasResult
        isAnalyzing={false}
        isWatched
        onQuick={vi.fn()}
        onOpenQuestion={vi.fn()}
      />,
    );

    const chat = screen.getByRole('button', { name: 'Jump to match chat' });
    expect(chat).toHaveAttribute('title', 'Jump to match chat');
  });

  it('disables both buttons when not watched', () => {
    const { container } = render(
      <AskAiMatchSplitControl
        variant="table"
        hasResult={false}
        isAnalyzing={false}
        isWatched={false}
        onQuick={vi.fn()}
        onOpenQuestion={vi.fn()}
      />,
    );

    const split = container.querySelector('.ask-ai-split');
    expect(split).toHaveStyle({ pointerEvents: 'none' });
  });
});
