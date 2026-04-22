import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const showToast = vi.fn();
const stableConfig = { apiUrl: 'http://localhost:4000', defaultMode: 'B' };
const stableToast = { showToast };

const apiMocks = vi.hoisted(() => ({
  fetchRecommendationStudioBootstrap: vi.fn(),
  fetchRecommendationStudioPrompt: vi.fn(),
  fetchRecommendationStudioRuleSet: vi.fn(),
  fetchRecommendationStudioReplayRunItems: vi.fn(),
  updateRecommendationStudioPrompt: vi.fn(),
  createRecommendationStudioPrompt: vi.fn(),
  updateRecommendationStudioRuleSet: vi.fn(),
  createRecommendationStudioRuleSet: vi.fn(),
  createRecommendationStudioRelease: vi.fn(),
  activateRecommendationStudioRelease: vi.fn(),
  cancelRecommendationStudioReplayRun: vi.fn(),
  cloneRollbackRecommendationStudioRelease: vi.fn(),
  compileRecommendationStudioPromptPreview: vi.fn(),
  rollbackRecommendationStudioRelease: vi.fn(),
  fetchRecommendationStudioPromptDiff: vi.fn(),
  fetchRecommendationStudioReleaseDiff: vi.fn(),
  previewRecommendationStudioPrompt: vi.fn(),
  fetchRecommendationStudioRuleSetDiff: vi.fn(),
  createRecommendationStudioReplayRun: vi.fn(),
  fetchRecommendationStudioReplayRun: vi.fn(),
  cloneRecommendationStudioPrompt: vi.fn(),
  cloneRecommendationStudioRuleSet: vi.fn(),
}));

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({
    state: {
      config: stableConfig,
    },
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => stableToast,
}));

vi.mock('@/lib/services/api', () => apiMocks);

const { RecommendationStudioPanel } = await import('./RecommendationStudioPanel');

const BOOTSTRAP_BASE = {
  promptVersions: ['v10-hybrid-legacy-b'],
  tokenCatalog: [
    { key: 'MATCH_CONTEXT', label: 'Match Context', description: 'ctx' },
    { key: 'LIVE_STATS_COMPACT', label: 'Live Stats', description: 'stats' },
  ],
  sectionDefinitions: [],
  ruleMeta: { stages: ['pre_prompt', 'post_parse'], marketFamilies: ['corners'], periodKinds: ['ft', 'h1'] },
  replayGuardrails: { maxItems: 20, llmModel: 'gemini-2.5-flash' },
  prompts: [
    { id: 11, template_key: 'prompt-1', name: 'Prompt 1', base_prompt_version: 'v10-hybrid-legacy-b', status: 'draft', notes: '', advanced_appendix: '', created_by: null, updated_by: null, created_at: '', updated_at: '' },
  ],
  ruleSets: [
    { id: 21, rule_set_key: 'rules-1', name: 'Rules 1', status: 'draft', notes: '', created_by: null, updated_by: null, created_at: '', updated_at: '' },
  ],
  releases: [
    { id: 31, release_key: 'rel-1', name: 'Release 1', prompt_template_id: 11, rule_set_id: 21, status: 'candidate', activation_scope: 'global', replay_validation_status: 'not_validated', notes: '', is_active: false, activated_by: null, activated_at: null, rollback_of_release_id: null, created_by: null, updated_by: null, created_at: '', updated_at: '' },
  ],
  activeRelease: null,
  replayRuns: [
    {
      id: 41,
      run_key: 'run-1',
      name: 'Replay 1',
      release_id: 31,
      prompt_template_id: 11,
      rule_set_id: 21,
      status: 'completed',
      source_filters: {},
      release_snapshot_json: {},
      summary_json: {
        pushRate: 0.6,
        noBetRate: 0.4,
        goalsUnderShare: 0.5,
        accuracy: 0.55,
        avgOdds: 1.92,
        avgBreakEvenRate: 0.52,
        totalStaked: 5,
        totalPnl: 1.75,
        roi: 0.35,
      },
      total_items: 1,
      completed_items: 1,
      error_message: null,
      llm_mode: 'real',
      llm_model: 'gemini-2.5-flash',
      created_by: null,
      created_at: '',
      started_at: '',
      completed_at: '',
    },
  ],
  auditLogs: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.fetchRecommendationStudioBootstrap.mockResolvedValue(BOOTSTRAP_BASE);
  apiMocks.fetchRecommendationStudioPrompt.mockResolvedValue({
    id: 11,
    template_key: 'prompt-1',
    name: 'Prompt 1',
    base_prompt_version: 'v10-hybrid-legacy-b',
    status: 'draft',
    notes: '',
    advanced_appendix: '',
    created_by: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
    sections: [
      { id: 101, template_id: 11, section_key: 'section_a', label: 'Section A', content: '', enabled: true, sort_order: 0, created_at: '', updated_at: '' },
    ],
  });
  apiMocks.fetchRecommendationStudioRuleSet.mockResolvedValue({
    id: 21,
    rule_set_key: 'rules-1',
    name: 'Rules 1',
    status: 'draft',
    notes: '',
    created_by: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
    rules: [],
  });
  apiMocks.fetchRecommendationStudioReplayRunItems.mockResolvedValue([
    {
      id: 501,
      run_id: 41,
      source_kind: 'recommendation',
      source_ref: 'recommendation:123',
      recommendation_id: 123,
      snapshot_id: null,
      match_id: '9001',
      status: 'completed',
      original_decision_json: { originalSelection: 'Under 2.5', originalBetMarket: 'Goals O/U' },
      replayed_decision_json: { selection: 'Over 2.5', betMarket: 'Goals O/U' },
      evaluation_json: { decisionChanged: true, pnlDelta: 1.5 },
      output_summary: {},
      error_message: null,
      created_at: '',
      completed_at: '',
    },
  ]);
  apiMocks.previewRecommendationStudioPrompt.mockResolvedValue({ release: { id: 31 }, prompt: 'compiled' });
});

describe('RecommendationStudioPanel', () => {
  test('inserts tokens through the token picker into the focused section', async () => {
    const user = userEvent.setup();
    render(<RecommendationStudioPanel />);

    // Wait for prompt to load; Section A textarea should appear
    const sectionTextarea = await screen.findByLabelText('Section content for Section A');
    await user.click(sectionTextarea);

    // Token button is enabled once a section is focused
    const tokenBtn = await screen.findByRole('button', { name: '{{MATCH_CONTEXT}}' });
    await user.click(tokenBtn);

    await waitFor(() => {
      expect((sectionTextarea as HTMLTextAreaElement).value).toContain('{{MATCH_CONTEXT}}');
    });
  });

  test('renders replay delta details at case level', async () => {
    const user = userEvent.setup();
    render(<RecommendationStudioPanel />);

    // Navigate to Replay Lab tab
    await user.click(await screen.findByRole('tab', { name: 'Replay Lab' }));

    // The pre-existing run "Replay 1" is auto-selected; click View Items to load items
    const viewItemsBtn = await screen.findByRole('button', { name: /View Items/i });
    await user.click(viewItemsBtn);

    // Wait for items to load and verify the mock was called
    await waitFor(() => {
      expect(apiMocks.fetchRecommendationStudioReplayRunItems).toHaveBeenCalledWith(stableConfig, 41);
    });

    // Items render in the DOM after loading — check for source_ref and original selection
    expect(await screen.findByText('recommendation:123')).toBeInTheDocument();
    expect(await screen.findByText(/Under 2\.5 \/ Goals O\/U/i)).toBeInTheDocument();
  });

  test('compiles preview with the selected rule set', async () => {
    const user = userEvent.setup();
    apiMocks.compileRecommendationStudioPromptPreview.mockResolvedValue({
      release: { id: 31, prompt_template_id: 11, rule_set_id: 21 },
      prompt: 'compiled prompt output',
    });

    render(<RecommendationStudioPanel />);

    await user.click(await screen.findByRole('button', { name: 'Preview Compiled Prompt' }));

    await waitFor(() => {
      expect(apiMocks.compileRecommendationStudioPromptPreview).toHaveBeenCalledWith(
        stableConfig,
        11,
        expect.objectContaining({
          ruleSetId: 21,
          recommendationIds: [],
          snapshotIds: [],
        }),
      );
    });

    expect(await screen.findByDisplayValue('compiled prompt output')).toBeInTheDocument();
  });

  test('renders replay summary metrics from backend summary keys', async () => {
    const user = userEvent.setup();
    render(<RecommendationStudioPanel />);

    await user.click(await screen.findByRole('tab', { name: 'Replay Lab' }));

    expect(await screen.findByText('0.50')).toBeInTheDocument();
    expect(await screen.findByText('5.00')).toBeInTheDocument();
    expect(await screen.findByText('1.75')).toBeInTheDocument();
  });

  test('disables activation for releases without replay validation', async () => {
    const user = userEvent.setup();
    render(<RecommendationStudioPanel />);

    await user.click(await screen.findByRole('tab', { name: 'Releases' }));

    // Release 1 is not_validated — Activate Globally button should be disabled
    const activateBtn = await screen.findByRole('button', { name: 'Activate Globally' });
    expect(activateBtn).toBeDisabled();
  });

  test('shows prompt and rule set names in the active release bar', async () => {
    apiMocks.fetchRecommendationStudioBootstrap.mockResolvedValue({
      ...BOOTSTRAP_BASE,
      activeRelease: {
        id: 31,
        release_key: 'rel-1',
        name: 'Release 1',
        prompt_template_id: 11,
        rule_set_id: 21,
        status: 'active',
        activation_scope: 'global',
        replay_validation_status: 'validated',
        notes: '',
        is_active: true,
        activated_by: null,
        activated_at: '',
        rollback_of_release_id: null,
        created_by: null,
        updated_by: null,
        created_at: '',
        updated_at: '',
        promptTemplate: {
          id: 11,
          template_key: 'prompt-1',
          name: 'Prompt 1',
          base_prompt_version: 'v10-hybrid-legacy-b',
          status: 'draft',
          notes: '',
          advanced_appendix: '',
          created_by: null,
          updated_by: null,
          created_at: '',
          updated_at: '',
        },
        ruleSet: {
          id: 21,
          rule_set_key: 'rules-1',
          name: 'Rules 1',
          status: 'draft',
          notes: '',
          created_by: null,
          updated_by: null,
          created_at: '',
          updated_at: '',
        },
      },
    });

    render(<RecommendationStudioPanel />);

    expect(await screen.findByText('Release 1')).toBeInTheDocument();
    expect(await screen.findByText('Prompt:')).toBeInTheDocument();
    expect(await screen.findByText('Rule set:')).toBeInTheDocument();
    expect(screen.getAllByText('Prompt 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rules 1').length).toBeGreaterThan(0);
  });
});
