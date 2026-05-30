import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAnalysisPanel } from './AiAnalysisPanel';
import type { ServerMatchPipelineResult } from '@/features/live-monitor/services/server-monitor.service';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Test User', email: 't@example.com' } }),
}));

vi.mock('@/hooks/useUiLanguage', () => ({
  useUiLanguage: () => 'vi',
}));

vi.mock('@/hooks/useAskAiQuickPromptList', () => ({
  useAskAiQuickPromptList: () => [
    { id: 'ou', text: 'Is the current over/under reasonable?' },
  ],
}));

function buildResult(overrides: Partial<ServerMatchPipelineResult> = {}): ServerMatchPipelineResult {
  return {
    success: true,
    decisionKind: 'no_bet',
    confidence: 0,
    score: '1-1',
    minute: 68,
    status: '2H',
    selection: '',
    debug: {
      parsed: {
        should_push: false,
        selection: '',
        bet_market: '',
        confidence: 0,
        reasoning_en: 'English reasoning',
        reasoning_vi: 'Phân tích tiếng Việt',
        warnings: ['MARKET_UNRESOLVED', 'HIGH_ODDS_RISK: Historical win rate is low.'],
        value_percent: 0,
        risk_level: 'MEDIUM',
        stake_percent: 0,
        market_chosen_reason: '',
      },
      prematchStrength: 'strong',
      promptDataLevel: 'advanced-upgraded',
      evidenceMode: 'full_live_data',
      advisoryOnly: true,
    },
    ...overrides,
  } as ServerMatchPipelineResult;
}

describe('AiAnalysisPanel', () => {
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

  it('hides technical context tags and pipeline warning codes', () => {
    render(
      <AiAnalysisPanel
        entry={{
          matchId: '1',
          matchDisplay: 'PSG vs Arsenal',
          result: buildResult(),
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText('Strong prematch context')).not.toBeInTheDocument();
    expect(screen.queryByText('Expanded analysis')).not.toBeInTheDocument();
    expect(screen.queryByText('MARKET_UNRESOLVED')).not.toBeInTheDocument();
    expect(screen.getByText('Phân tích tiếng Việt')).toBeInTheDocument();
    expect(screen.getByText(/Historical win rate is low/)).toBeInTheDocument();
  });

  it('shows collapsible quick prompts when follow-up is enabled', () => {
    render(
      <AiAnalysisPanel
        entry={{
          matchId: '1',
          matchDisplay: 'PSG vs Arsenal',
          result: buildResult(),
        }}
        onClose={() => {}}
        onFollowUp={async () => {}}
      />,
    );

    expect(screen.getByText('Quick prompts')).toBeInTheDocument();
    expect(screen.queryByText('Is the current over/under reasonable?')).not.toBeVisible();
  });
});