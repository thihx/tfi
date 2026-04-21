import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import {
  activateRecommendationStudioRelease,
  cancelRecommendationStudioReplayRun,
  cloneRecommendationStudioPrompt,
  cloneRecommendationStudioRuleSet,
  cloneRollbackRecommendationStudioRelease,
  compileRecommendationStudioPromptPreview,
  createRecommendationStudioPrompt,
  createRecommendationStudioRelease,
  createRecommendationStudioReplayRun,
  createRecommendationStudioRuleSet,
  fetchRecommendationStudioBootstrap,
  fetchRecommendationStudioPromptDiff,
  fetchRecommendationStudioPrompt,
  fetchRecommendationStudioReleaseDiff,
  fetchRecommendationStudioReplayRun,
  fetchRecommendationStudioReplayRunItems,
  fetchRecommendationStudioRuleSetDiff,
  fetchRecommendationStudioRuleSet,
  previewRecommendationStudioPrompt,
  rollbackRecommendationStudioRelease,
  updateRecommendationStudioPrompt,
  updateRecommendationStudioRuleSet,
  type RecommendationStudioBootstrap,
  type RecommendationStudioPromptSection,
  type RecommendationStudioPromptTemplate,
  type RecommendationStudioReplayRunItem,
  type RecommendationStudioRule,
  type RecommendationStudioRuleSet,
} from '@/lib/services/api';

type StudioSubTab = 'prompts' | 'rules' | 'replays' | 'releases';

const studioSubTabs: Array<{ id: StudioSubTab; label: string }> = [
  { id: 'prompts', label: 'Prompt' },
  { id: 'rules', label: 'Rules' },
  { id: 'replays', label: 'Replay Lab' },
  { id: 'releases', label: 'Releases' },
];

function commaListToArray(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function commaListToNumberArray(value: string): number[] {
  return commaListToArray(value)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? '');
  }
}

const TOKEN_PATTERN = /\{\{([A-Z0-9_]+)\}\}/g;

function extractTokens(text: string): string[] {
  return [...String(text ?? '').matchAll(TOKEN_PATTERN)]
    .map((match) => String(match[1] ?? '').trim())
    .filter(Boolean);
}

function defaultPromptSection(index: number): RecommendationStudioPromptSection {
  return {
    id: -index - 1,
    template_id: 0,
    section_key: `section_${index + 1}`,
    label: `Section ${index + 1}`,
    content: index === 0 ? '{{MATCH_CONTEXT}}\n{{LIVE_STATS_COMPACT}}\n{{LIVE_ODDS_CANONICAL}}' : '',
    enabled: true,
    sort_order: index,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

function defaultRule(index: number): RecommendationStudioRule {
  return {
    id: -index - 1,
    rule_set_id: 0,
    name: `Rule ${index + 1}`,
    stage: 'post_parse',
    priority: 100,
    enabled: true,
    conditions_json: {},
    actions_json: {},
    notes: '',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

export function RecommendationStudioPanel() {
  const { state } = useAppState();
  const { showToast } = useToast();
  const config = state.config;

  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<StudioSubTab>('prompts');
  const [bootstrap, setBootstrap] = useState<RecommendationStudioBootstrap | null>(null);

  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);
  const [selectedRuleSetId, setSelectedRuleSetId] = useState<number | null>(null);
  const [selectedReleaseId, setSelectedReleaseId] = useState<number | null>(null);
  const [selectedReplayRunId, setSelectedReplayRunId] = useState<number | null>(null);

  const [promptDraft, setPromptDraft] = useState<RecommendationStudioPromptTemplate | null>(null);
  const [ruleSetDraft, setRuleSetDraft] = useState<RecommendationStudioRuleSet | null>(null);
  const [releaseDraft, setReleaseDraft] = useState({
    name: '',
    promptTemplateId: 0,
    ruleSetId: 0,
    notes: '',
  });
  const [previewTarget, setPreviewTarget] = useState({
    recommendationIdsText: '',
    snapshotIdsText: '',
  });
  const [previewPrompt, setPreviewPrompt] = useState<string>('');
  const [promptDiff, setPromptDiff] = useState<Record<string, unknown> | null>(null);
  const [ruleSetDiff, setRuleSetDiff] = useState<Record<string, unknown> | null>(null);
  const [releaseDiff, setReleaseDiff] = useState<Record<string, unknown> | null>(null);
  const [promptDiffAgainstId, setPromptDiffAgainstId] = useState<number>(0);
  const [ruleSetDiffAgainstId, setRuleSetDiffAgainstId] = useState<number>(0);
  const [activeTokenTarget, setActiveTokenTarget] = useState<{ kind: 'appendix' | 'section'; index?: number } | null>(null);
  const [replayDraft, setReplayDraft] = useState({
    name: '',
    releaseId: 0,
    promptTemplateId: 0,
    ruleSetId: 0,
    recommendationIdsText: '',
    snapshotIdsText: '',
    dateFrom: '',
    dateTo: '',
    league: '',
    marketFamily: '',
    periodKind: '',
    result: '',
    riskLevel: '',
  });
  const [replayItems, setReplayItems] = useState<RecommendationStudioReplayRunItem[]>([]);

  const loadBootstrap = async () => {
    setLoading(true);
    try {
      const data = await fetchRecommendationStudioBootstrap(config);
      setBootstrap(data);
      setSelectedPromptId((prev) => prev ?? data.prompts[0]?.id ?? null);
      setSelectedRuleSetId((prev) => prev ?? data.ruleSets[0]?.id ?? null);
      setSelectedReleaseId((prev) => prev ?? data.activeRelease?.id ?? data.releases[0]?.id ?? null);
      setSelectedReplayRunId((prev) => prev ?? data.replayRuns[0]?.id ?? null);
      setReleaseDraft((prev) => ({
        ...prev,
        promptTemplateId: prev.promptTemplateId || data.prompts[0]?.id || 0,
        ruleSetId: prev.ruleSetId || data.ruleSets[0]?.id || 0,
      }));
      setReplayDraft((prev) => ({
        ...prev,
        releaseId: prev.releaseId || data.activeRelease?.id || data.releases[0]?.id || 0,
        promptTemplateId: prev.promptTemplateId || data.prompts[0]?.id || 0,
        ruleSetId: prev.ruleSetId || data.ruleSets[0]?.id || 0,
      }));
    } catch (error) {
      showToast(`Failed to load Recommendation Studio: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBootstrap();
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedPromptId) return;
    void fetchRecommendationStudioPrompt(config, selectedPromptId)
      .then(setPromptDraft)
      .catch((error) => showToast(`Failed to load prompt template: ${error instanceof Error ? error.message : String(error)}`, 'error'));
  }, [config, selectedPromptId, showToast]);

  useEffect(() => {
    if (!selectedRuleSetId) return;
    void fetchRecommendationStudioRuleSet(config, selectedRuleSetId)
      .then(setRuleSetDraft)
      .catch((error) => showToast(`Failed to load rule set: ${error instanceof Error ? error.message : String(error)}`, 'error'));
  }, [config, selectedRuleSetId, showToast]);

  useEffect(() => {
    if (!selectedReplayRunId) return;
    void fetchRecommendationStudioReplayRunItems(config, selectedReplayRunId)
      .then(setReplayItems)
      .catch((error) => showToast(`Failed to load replay items: ${error instanceof Error ? error.message : String(error)}`, 'error'));
  }, [config, selectedReplayRunId, showToast]);

  const activeRelease = bootstrap?.activeRelease ?? null;
  const promptLocked = Boolean(activeRelease && promptDraft && promptDraft.id > 0 && activeRelease.prompt_template_id === promptDraft.id);
  const ruleSetLocked = Boolean(activeRelease && ruleSetDraft && ruleSetDraft.id > 0 && activeRelease.rule_set_id === ruleSetDraft.id);
  const selectedReplayRun = useMemo(
    () => bootstrap?.replayRuns.find((run) => run.id === selectedReplayRunId) ?? null,
    [bootstrap?.replayRuns, selectedReplayRunId],
  );
  const allowedTokens = useMemo(() => new Set((bootstrap?.tokenCatalog ?? []).map((token) => token.key)), [bootstrap?.tokenCatalog]);

  const promptValidationIssues = useMemo(() => {
    if (!promptDraft) return [];
    const issues: string[] = [];
    for (const token of extractTokens(promptDraft.advanced_appendix)) {
      if (!allowedTokens.has(token)) issues.push(`Unknown appendix token: {{${token}}}`);
    }
    for (const [index, section] of (promptDraft.sections ?? []).entries()) {
      for (const token of extractTokens(section.content)) {
        if (!allowedTokens.has(token)) issues.push(`Unknown token in ${section.label || section.section_key || `section ${index + 1}`}: {{${token}}}`);
      }
    }
    return issues;
  }, [allowedTokens, promptDraft]);

  const insertToken = (tokenKey: string) => {
    const token = `{{${tokenKey}}}`;
    if (!promptDraft || !activeTokenTarget) return;
    if (activeTokenTarget.kind === 'appendix') {
      setPromptDraft({ ...promptDraft, advanced_appendix: `${promptDraft.advanced_appendix}${promptDraft.advanced_appendix ? '\n' : ''}${token}` });
      return;
    }
    const index = activeTokenTarget.index ?? -1;
    if (index < 0) return;
    setPromptDraft({
      ...promptDraft,
      sections: (promptDraft.sections ?? []).map((section, sectionIndex) => (
        sectionIndex === index
          ? { ...section, content: `${section.content}${section.content ? '\n' : ''}${token}` }
          : section
      )),
    });
  };

  const savePrompt = async () => {
    if (!promptDraft) return;
    if (promptLocked) {
      showToast('Active prompt template cannot be edited directly. Clone it to a draft first.', 'error');
      return;
    }
    if (promptValidationIssues.length > 0) {
      showToast(promptValidationIssues[0]!, 'error');
      return;
    }
    try {
      const payload = {
        name: promptDraft.name,
        basePromptVersion: promptDraft.base_prompt_version,
        status: promptDraft.status,
        notes: promptDraft.notes,
        advancedAppendix: promptDraft.advanced_appendix,
        sections: (promptDraft.sections ?? []).map((section) => ({
          id: section.id > 0 ? section.id : undefined,
          section_key: section.section_key,
          label: section.label,
          content: section.content,
          enabled: section.enabled,
          sort_order: section.sort_order,
        })),
      };
      const saved = promptDraft.id > 0
        ? await updateRecommendationStudioPrompt(config, promptDraft.id, payload)
        : await createRecommendationStudioPrompt(config, payload);
      setPromptDraft(saved);
      setSelectedPromptId(saved.id);
      await loadBootstrap();
      showToast('Prompt template saved', 'success');
    } catch (error) {
      showToast(`Failed to save prompt template: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const saveRuleSet = async () => {
    if (!ruleSetDraft) return;
    if (ruleSetLocked) {
      showToast('Active rule set cannot be edited directly. Clone it to a draft first.', 'error');
      return;
    }
    try {
      const payload = {
        name: ruleSetDraft.name,
        status: ruleSetDraft.status,
        notes: ruleSetDraft.notes,
        rules: (ruleSetDraft.rules ?? []).map((rule) => ({
          name: rule.name,
          stage: rule.stage,
          priority: rule.priority,
          enabled: rule.enabled,
          conditions_json: rule.conditions_json,
          actions_json: rule.actions_json,
          notes: rule.notes,
        })),
      };
      const saved = ruleSetDraft.id > 0
        ? await updateRecommendationStudioRuleSet(config, ruleSetDraft.id, payload)
        : await createRecommendationStudioRuleSet(config, payload);
      setRuleSetDraft(saved);
      setSelectedRuleSetId(saved.id);
      await loadBootstrap();
      showToast('Rule set saved', 'success');
    } catch (error) {
      showToast(`Failed to save rule set: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const createRelease = async () => {
    try {
      const created = await createRecommendationStudioRelease(config, releaseDraft);
      setSelectedReleaseId(created.id);
      await loadBootstrap();
      showToast('Release created', 'success');
    } catch (error) {
      showToast(`Failed to create release: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const activateRelease = async (releaseId: number) => {
    try {
      await activateRecommendationStudioRelease(config, releaseId);
      await loadBootstrap();
      showToast('Release activated', 'success');
    } catch (error) {
      showToast(`Failed to activate release: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const rollbackRelease = async (releaseId: number) => {
    try {
      await rollbackRecommendationStudioRelease(config, releaseId);
      await loadBootstrap();
      showToast('Release rolled back', 'success');
    } catch (error) {
      showToast(`Failed to rollback release: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const cloneRollbackRelease = async (releaseId: number) => {
    try {
      const cloned = await cloneRollbackRecommendationStudioRelease(config, releaseId);
      setSelectedReleaseId(cloned.id);
      await loadBootstrap();
      showToast('Rollback release cloned', 'success');
    } catch (error) {
      showToast(`Failed to clone rollback release: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const runPreview = async () => {
    try {
      const result = promptDraft?.id
        ? await compileRecommendationStudioPromptPreview(config, promptDraft.id, {
          ruleSetId: ruleSetDraft?.id ?? undefined,
          recommendationIds: commaListToNumberArray(previewTarget.recommendationIdsText),
          snapshotIds: commaListToNumberArray(previewTarget.snapshotIdsText),
        })
        : await previewRecommendationStudioPrompt(config, {
          promptTemplateId: promptDraft?.id ?? undefined,
          ruleSetId: ruleSetDraft?.id ?? undefined,
          recommendationIds: commaListToNumberArray(previewTarget.recommendationIdsText),
          snapshotIds: commaListToNumberArray(previewTarget.snapshotIdsText),
        });
      setPreviewPrompt(result.prompt ?? '');
      showToast('Prompt preview generated', 'success');
    } catch (error) {
      showToast(`Failed to generate preview: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const runReplay = async () => {
    try {
      const created = await createRecommendationStudioReplayRun(config, {
        ...replayDraft,
        recommendationIds: commaListToNumberArray(replayDraft.recommendationIdsText),
        snapshotIds: commaListToNumberArray(replayDraft.snapshotIdsText),
        selectionFilters: {
          dateFrom: replayDraft.dateFrom || undefined,
          dateTo: replayDraft.dateTo || undefined,
          league: replayDraft.league || undefined,
          marketFamily: replayDraft.marketFamily || undefined,
          periodKind: replayDraft.periodKind || undefined,
          result: replayDraft.result || undefined,
          riskLevel: replayDraft.riskLevel || undefined,
        },
      });
      setSelectedReplayRunId(created.id);
      await loadBootstrap();
      showToast('Replay run queued', 'success');
    } catch (error) {
      showToast(`Failed to create replay run: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const refreshReplayRun = async () => {
    if (!selectedReplayRunId) return;
    try {
      const [run, items] = await Promise.all([
        fetchRecommendationStudioReplayRun(config, selectedReplayRunId),
        fetchRecommendationStudioReplayRunItems(config, selectedReplayRunId),
      ]);
      setBootstrap((prev) => prev ? {
        ...prev,
        replayRuns: prev.replayRuns.map((existing) => existing.id === run.id ? run : existing),
      } : prev);
      setReplayItems(items);
    } catch (error) {
      showToast(`Failed to refresh replay run: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const cancelReplayRun = async () => {
    if (!selectedReplayRunId) return;
    try {
      const run = await cancelRecommendationStudioReplayRun(config, selectedReplayRunId);
      setBootstrap((prev) => prev ? {
        ...prev,
        replayRuns: prev.replayRuns.map((existing) => existing.id === run.id ? run : existing),
      } : prev);
      await refreshReplayRun();
      showToast('Replay run canceled', 'success');
    } catch (error) {
      showToast(`Failed to cancel replay run: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const loadDiff = async (releaseId: number) => {
    try {
      const diff = await fetchRecommendationStudioReleaseDiff(config, releaseId, activeRelease?.id);
      setReleaseDiff(diff);
    } catch (error) {
      showToast(`Failed to load release diff: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const loadPromptDiff = async () => {
    if (!selectedPromptId || !promptDiffAgainstId) return;
    try {
      const diff = await fetchRecommendationStudioPromptDiff(config, selectedPromptId, promptDiffAgainstId);
      setPromptDiff(diff);
    } catch (error) {
      showToast(`Failed to load prompt diff: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const loadRuleSetDiff = async () => {
    if (!selectedRuleSetId || !ruleSetDiffAgainstId) return;
    try {
      const diff = await fetchRecommendationStudioRuleSetDiff(config, selectedRuleSetId, ruleSetDiffAgainstId);
      setRuleSetDiff(diff);
    } catch (error) {
      showToast(`Failed to load rule diff: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  if (loading && !bootstrap) {
    return <div style={{ color: 'var(--gray-500)' }}>Loading Recommendation Studio...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {studioSubTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`btn ${subTab === tab.id ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setSubTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadBootstrap()}>
          Refresh
        </button>
      </div>

      {subTab === 'prompts' && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 16 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Prompt Templates</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bootstrap?.prompts.map((prompt) => (
                <button
                  key={prompt.id}
                  type="button"
                  className={`btn ${selectedPromptId === prompt.id ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  onClick={() => setSelectedPromptId(prompt.id)}
                >
                  {prompt.name}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPromptDraft({
                  id: 0,
                  template_key: '',
                  name: 'New Prompt',
                  base_prompt_version: (bootstrap?.promptVersions[0] ?? 'v10-hybrid-legacy-b'),
                  status: 'draft',
                  notes: '',
                  advanced_appendix: '',
                  created_by: null,
                  updated_by: null,
                  created_at: new Date(0).toISOString(),
                  updated_at: new Date(0).toISOString(),
                  sections: [defaultPromptSection(0)],
                })}
              >
                New
              </button>
              {selectedPromptId ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void cloneRecommendationStudioPrompt(config, selectedPromptId).then(loadBootstrap)}>
                  Clone
                </button>
              ) : null}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            {promptDraft ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {promptLocked ? (
                  <div style={{ padding: 10, borderRadius: 10, background: 'rgba(245, 158, 11, 0.12)', color: 'var(--gray-700)' }}>
                    This prompt template belongs to the active release and is read-only. Clone it to a draft before editing.
                  </div>
                ) : null}
                {promptValidationIssues.length > 0 ? (
                  <div style={{ padding: 10, borderRadius: 10, background: 'rgba(239, 68, 68, 0.08)', color: 'var(--danger-700, #b91c1c)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Prompt validation issues</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {promptValidationIssues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  </div>
                ) : null}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Name</span>
                    <input value={promptDraft.name} onChange={(e) => setPromptDraft({ ...promptDraft, name: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Base Prompt Version</span>
                    <select value={promptDraft.base_prompt_version} onChange={(e) => setPromptDraft({ ...promptDraft, base_prompt_version: e.target.value })}>
                      {(bootstrap?.promptVersions ?? []).map((version) => <option key={version} value={version}>{version}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Status</span>
                    <select value={promptDraft.status} onChange={(e) => setPromptDraft({ ...promptDraft, status: e.target.value as RecommendationStudioPromptTemplate['status'] })}>
                      {['draft', 'validated', 'candidate', 'active', 'archived'].map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Notes</span>
                    <input value={promptDraft.notes} onChange={(e) => setPromptDraft({ ...promptDraft, notes: e.target.value })} />
                  </label>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>Advanced Appendix</span>
                  <textarea
                    rows={6}
                    value={promptDraft.advanced_appendix}
                    onFocus={() => setActiveTokenTarget({ kind: 'appendix' })}
                    onChange={(e) => setPromptDraft({ ...promptDraft, advanced_appendix: e.target.value })}
                  />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>Token Picker</div>
                  <div style={{ color: 'var(--gray-500)', fontSize: 13 }}>
                    Select a section content or the advanced appendix, then insert only supported runtime tokens.
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(bootstrap?.tokenCatalog ?? []).map((token) => (
                      <button key={token.key} type="button" className="btn btn-secondary btn-sm" onClick={() => insertToken(token.key)}>
                        {token.key}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ fontWeight: 600 }}>Sections</div>
                {(promptDraft.sections ?? []).map((section, index) => (
                  <div key={`${section.id}-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                      <input value={section.section_key} placeholder="section_key" onChange={(e) => setPromptDraft({
                        ...promptDraft,
                        sections: (promptDraft.sections ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, section_key: e.target.value } : row),
                      })} />
                      <input value={section.label} placeholder="Label" onChange={(e) => setPromptDraft({
                        ...promptDraft,
                        sections: (promptDraft.sections ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, label: e.target.value } : row),
                      })} />
                      <input type="number" value={section.sort_order} placeholder="Sort order" onChange={(e) => setPromptDraft({
                        ...promptDraft,
                        sections: (promptDraft.sections ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, sort_order: Number(e.target.value) } : row),
                      })} />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={section.enabled} onChange={(e) => setPromptDraft({
                          ...promptDraft,
                          sections: (promptDraft.sections ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, enabled: e.target.checked } : row),
                        })} />
                        Enabled
                      </label>
                    </div>
                    <textarea
                      rows={5}
                      value={section.content}
                      onFocus={() => setActiveTokenTarget({ kind: 'section', index })}
                      onChange={(e) => setPromptDraft({
                        ...promptDraft,
                        sections: (promptDraft.sections ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, content: e.target.value } : row),
                      })}
                    />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPromptDraft({
                      ...promptDraft,
                      sections: (promptDraft.sections ?? []).filter((_, rowIndex) => rowIndex !== index),
                    })}>
                      Remove Section
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPromptDraft({
                    ...promptDraft,
                    sections: [...(promptDraft.sections ?? []), defaultPromptSection((promptDraft.sections ?? []).length)],
                  })} disabled={promptLocked}>
                    Add Section
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void savePrompt()} disabled={promptLocked || promptValidationIssues.length > 0}>
                    Save Prompt
                  </button>
                </div>

                <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>Prompt Preview</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                    <input placeholder="Recommendation IDs: 123,124" value={previewTarget.recommendationIdsText} onChange={(e) => setPreviewTarget({ ...previewTarget, recommendationIdsText: e.target.value })} />
                    <input placeholder="Snapshot IDs: 88,89" value={previewTarget.snapshotIdsText} onChange={(e) => setPreviewTarget({ ...previewTarget, snapshotIdsText: e.target.value })} />
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void runPreview()}>
                    Generate Preview
                  </button>
                  <textarea rows={14} value={previewPrompt} readOnly />
                </div>

                <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>Prompt Diff</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select value={promptDiffAgainstId} onChange={(e) => setPromptDiffAgainstId(Number(e.target.value))}>
                      <option value={0}>Compare against prompt...</option>
                      {(bootstrap?.prompts ?? [])
                        .filter((prompt) => prompt.id !== selectedPromptId)
                        .map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.name}</option>)}
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadPromptDiff()} disabled={!selectedPromptId || !promptDiffAgainstId}>
                      Load Prompt Diff
                    </button>
                  </div>
                  {promptDiff ? <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{prettyJson(promptDiff)}</pre> : null}
                </div>
              </div>
            ) : <div style={{ color: 'var(--gray-500)' }}>Select a prompt template.</div>}
          </div>
        </div>
      )}

      {subTab === 'rules' && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 16 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Rule Sets</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bootstrap?.ruleSets.map((ruleSet) => (
                <button
                  key={ruleSet.id}
                  type="button"
                  className={`btn ${selectedRuleSetId === ruleSet.id ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  onClick={() => setSelectedRuleSetId(ruleSet.id)}
                >
                  {ruleSet.name}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRuleSetDraft({
                id: 0,
                rule_set_key: '',
                name: 'New Rule Set',
                status: 'draft',
                notes: '',
                created_by: null,
                updated_by: null,
                created_at: new Date(0).toISOString(),
                updated_at: new Date(0).toISOString(),
                rules: [defaultRule(0)],
              })}>
                New
              </button>
              {selectedRuleSetId ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void cloneRecommendationStudioRuleSet(config, selectedRuleSetId).then(loadBootstrap)}>
                  Clone
                </button>
              ) : null}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            {ruleSetDraft ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {ruleSetLocked ? (
                  <div style={{ padding: 10, borderRadius: 10, background: 'rgba(245, 158, 11, 0.12)', color: 'var(--gray-700)' }}>
                    This rule set belongs to the active release and is read-only. Clone it to a draft before editing.
                  </div>
                ) : null}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Name</span>
                    <input value={ruleSetDraft.name} onChange={(e) => setRuleSetDraft({ ...ruleSetDraft, name: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Status</span>
                    <select value={ruleSetDraft.status} onChange={(e) => setRuleSetDraft({ ...ruleSetDraft, status: e.target.value as RecommendationStudioRuleSet['status'] })}>
                      {['draft', 'validated', 'candidate', 'active', 'archived'].map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Notes</span>
                    <input value={ruleSetDraft.notes} onChange={(e) => setRuleSetDraft({ ...ruleSetDraft, notes: e.target.value })} />
                  </label>
                </div>

                {(ruleSetDraft.rules ?? []).map((rule, index) => (
                  <div key={`${rule.id}-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                      <input value={rule.name} placeholder="Rule name" onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, name: e.target.value } : row),
                      })} />
                      <select value={rule.stage} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, stage: e.target.value as RecommendationStudioRule['stage'] } : row),
                      })}>
                        <option value="pre_prompt">pre_prompt</option>
                        <option value="post_parse">post_parse</option>
                      </select>
                      <input type="number" value={rule.priority} placeholder="Priority" onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, priority: Number(e.target.value) } : row),
                      })} />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={rule.enabled} onChange={(e) => setRuleSetDraft({
                          ...ruleSetDraft,
                          rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, enabled: e.target.checked } : row),
                        })} />
                        Enabled
                      </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                      <input placeholder="minuteBands: 30-44,45-59" value={(rule.conditions_json.minuteBands ?? []).join(', ')} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, conditions_json: { ...row.conditions_json, minuteBands: commaListToArray(e.target.value) } } : row),
                      })} />
                      <input placeholder="scoreStates" value={(rule.conditions_json.scoreStates ?? []).join(', ')} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, conditions_json: { ...row.conditions_json, scoreStates: commaListToArray(e.target.value) } } : row),
                      })} />
                      <input placeholder="evidenceModes" value={(rule.conditions_json.evidenceModes ?? []).join(', ')} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, conditions_json: { ...row.conditions_json, evidenceModes: commaListToArray(e.target.value) } } : row),
                      })} />
                      <input placeholder="prematchStrengths" value={(rule.conditions_json.prematchStrengths ?? []).join(', ')} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, conditions_json: { ...row.conditions_json, prematchStrengths: commaListToArray(e.target.value) } } : row),
                      })} />
                      <input placeholder="promptVersions" value={(rule.conditions_json.promptVersions ?? []).join(', ')} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, conditions_json: { ...row.conditions_json, promptVersions: commaListToArray(e.target.value) } } : row),
                      })} />
                      <input placeholder="releaseIds" value={(rule.conditions_json.releaseIds ?? []).join(', ')} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, conditions_json: { ...row.conditions_json, releaseIds: commaListToNumberArray(e.target.value) } } : row),
                      })} />
                      <input placeholder="releaseKeys" value={(rule.conditions_json.releaseKeys ?? []).join(', ')} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, conditions_json: { ...row.conditions_json, releaseKeys: commaListToArray(e.target.value) } } : row),
                      })} />
                      <input placeholder="marketFamilies" value={(rule.conditions_json.marketFamilies ?? []).join(', ')} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, conditions_json: { ...row.conditions_json, marketFamilies: commaListToArray(e.target.value) } } : row),
                      })} />
                      <input placeholder="periodKinds: ft,h1" value={(rule.conditions_json.periodKinds ?? []).join(', ')} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, conditions_json: { ...row.conditions_json, periodKinds: commaListToArray(e.target.value) as Array<'ft' | 'h1'> } } : row),
                      })} />
                      <input placeholder="canonicalMarketPrefixes" value={(rule.conditions_json.canonicalMarketPrefixes ?? []).join(', ')} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, conditions_json: { ...row.conditions_json, canonicalMarketPrefixes: commaListToArray(e.target.value) } } : row),
                      })} />
                      <input placeholder="hideMarketFamiliesFromPrompt" value={(rule.actions_json.hideMarketFamiliesFromPrompt ?? []).join(', ')} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, actions_json: { ...row.actions_json, hideMarketFamiliesFromPrompt: commaListToArray(e.target.value) } } : row),
                      })} />
                      <input placeholder="warning" value={rule.actions_json.warning ?? ''} onChange={(e) => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, actions_json: { ...row.actions_json, warning: e.target.value } } : row),
                      })} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={rule.actions_json.block === true} onChange={(e) => setRuleSetDraft({
                          ...ruleSetDraft,
                          rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, actions_json: { ...row.actions_json, block: e.target.checked } } : row),
                        })} />
                        Block
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={rule.actions_json.forceNoBet === true} onChange={(e) => setRuleSetDraft({
                          ...ruleSetDraft,
                          rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, actions_json: { ...row.actions_json, forceNoBet: e.target.checked } } : row),
                        })} />
                        Force No Bet
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span>Cap Confidence</span>
                        <input type="number" value={rule.actions_json.capConfidence ?? ''} onChange={(e) => setRuleSetDraft({
                          ...ruleSetDraft,
                          rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, actions_json: { ...row.actions_json, capConfidence: e.target.value === '' ? null : Number(e.target.value) } } : row),
                        })} />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span>Cap Stake %</span>
                        <input type="number" value={rule.actions_json.capStakePercent ?? ''} onChange={(e) => setRuleSetDraft({
                          ...ruleSetDraft,
                          rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, actions_json: { ...row.actions_json, capStakePercent: e.target.value === '' ? null : Number(e.target.value) } } : row),
                        })} />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span>Raise Min Edge %</span>
                        <input type="number" value={rule.actions_json.raiseMinEdge ?? ''} onChange={(e) => setRuleSetDraft({
                          ...ruleSetDraft,
                          rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, actions_json: { ...row.actions_json, raiseMinEdge: e.target.value === '' ? null : Number(e.target.value) } } : row),
                        })} />
                      </label>
                    </div>

                    <textarea rows={3} placeholder="appendInstruction" value={rule.actions_json.appendInstruction ?? ''} onChange={(e) => setRuleSetDraft({
                      ...ruleSetDraft,
                      rules: (ruleSetDraft.rules ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, actions_json: { ...row.actions_json, appendInstruction: e.target.value } } : row),
                    })} />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRuleSetDraft({
                      ...ruleSetDraft,
                      rules: (ruleSetDraft.rules ?? []).filter((_, rowIndex) => rowIndex !== index),
                    })}>
                      Remove Rule
                    </button>
                  </div>
                ))}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRuleSetDraft({
                    ...ruleSetDraft,
                    rules: [...(ruleSetDraft.rules ?? []), defaultRule((ruleSetDraft.rules ?? []).length)],
                  })} disabled={ruleSetLocked}>
                    Add Rule
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveRuleSet()} disabled={ruleSetLocked}>
                    Save Rule Set
                  </button>
                </div>

                <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>Rule Set Diff</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select value={ruleSetDiffAgainstId} onChange={(e) => setRuleSetDiffAgainstId(Number(e.target.value))}>
                      <option value={0}>Compare against rule set...</option>
                      {(bootstrap?.ruleSets ?? [])
                        .filter((ruleSet) => ruleSet.id !== selectedRuleSetId)
                        .map((ruleSet) => <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</option>)}
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadRuleSetDiff()} disabled={!selectedRuleSetId || !ruleSetDiffAgainstId}>
                      Load Rule Diff
                    </button>
                  </div>
                  {ruleSetDiff ? <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{prettyJson(ruleSetDiff)}</pre> : null}
                </div>
              </div>
            ) : <div style={{ color: 'var(--gray-500)' }}>Select a rule set.</div>}
          </div>
        </div>
      )}

      {subTab === 'releases' && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 16 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Releases</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bootstrap?.releases.map((release) => (
                <button
                  key={release.id}
                  type="button"
                  className={`btn ${selectedReleaseId === release.id ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  onClick={() => setSelectedReleaseId(release.id)}
                >
                  {release.name}{release.is_active ? ' (active)' : ''}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Create Release</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                <input placeholder="Release name" value={releaseDraft.name} onChange={(e) => setReleaseDraft({ ...releaseDraft, name: e.target.value })} />
                <select value={releaseDraft.promptTemplateId} onChange={(e) => setReleaseDraft({ ...releaseDraft, promptTemplateId: Number(e.target.value) })}>
                  <option value={0}>Select prompt</option>
                  {(bootstrap?.prompts ?? []).map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.name}</option>)}
                </select>
                <select value={releaseDraft.ruleSetId} onChange={(e) => setReleaseDraft({ ...releaseDraft, ruleSetId: Number(e.target.value) })}>
                  <option value={0}>Select rule set</option>
                  {(bootstrap?.ruleSets ?? []).map((ruleSet) => <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</option>)}
                </select>
                <input placeholder="Notes" value={releaseDraft.notes} onChange={(e) => setReleaseDraft({ ...releaseDraft, notes: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void createRelease()}>
                  Create Release
                </button>
              </div>
            </div>

            <div className="card" style={{ padding: 16 }}>
              {selectedReleaseId ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Selected Release</div>
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{prettyJson(bootstrap?.releases.find((release) => release.id === selectedReleaseId) ?? null)}</pre>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void activateRelease(selectedReleaseId)}
                      disabled={bootstrap?.releases.find((release) => release.id === selectedReleaseId)?.replay_validation_status !== 'validated'}
                    >
                      Activate
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void cloneRollbackRelease(selectedReleaseId)}>
                      Clone Rollback
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void rollbackRelease(selectedReleaseId)}
                      disabled={bootstrap?.releases.find((release) => release.id === selectedReleaseId)?.replay_validation_status !== 'validated'}
                    >
                      Rollback To This Release
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadDiff(selectedReleaseId)}>
                      Compare With Active
                    </button>
                  </div>
                  {releaseDiff ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>Diff</div>
                      {Array.isArray((releaseDiff as { promptSectionDiffs?: unknown[] }).promptSectionDiffs) ? (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontWeight: 600 }}>Prompt Section Changes</div>
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {((releaseDiff as { promptSectionDiffs?: Array<{ sectionKey: string; changeType: string }> }).promptSectionDiffs ?? []).map((entry) => (
                              <li key={`${entry.sectionKey}-${entry.changeType}`}>{entry.changeType}: {entry.sectionKey}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {Array.isArray((releaseDiff as { ruleDiffs?: unknown[] }).ruleDiffs) ? (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontWeight: 600 }}>Rule Changes</div>
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {((releaseDiff as { ruleDiffs?: Array<{ ruleKey: string; changeType: string }> }).ruleDiffs ?? []).map((entry) => (
                              <li key={`${entry.ruleKey}-${entry.changeType}`}>{entry.changeType}: {entry.ruleKey}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{prettyJson(releaseDiff)}</pre>
                    </div>
                  ) : null}
                  {bootstrap?.auditLogs?.length ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent Audit Trail</div>
                      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                        {prettyJson(bootstrap.auditLogs.slice(0, 12))}
                      </pre>
                    </div>
                  ) : null}
                </>
              ) : <div style={{ color: 'var(--gray-500)' }}>Select a release.</div>}
            </div>
          </div>
        </div>
      )}

      {subTab === 'replays' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 16 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Replay Runs</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(bootstrap?.replayRuns ?? []).map((run) => (
                <button
                  key={run.id}
                  type="button"
                  className={`btn ${selectedReplayRunId === run.id ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  onClick={() => setSelectedReplayRunId(run.id)}
                >
                  {run.name} [{run.status}]
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Create Replay Run</div>
              <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: 'rgba(59, 130, 246, 0.08)', color: 'var(--gray-700)' }}>
                Replay uses the real LLM model <strong>{bootstrap?.replayGuardrails.llmModel ?? 'n/a'}</strong> and incurs cost. Limit each run to at most <strong>{bootstrap?.replayGuardrails.maxItems ?? 0}</strong> recommendations/snapshots.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                <input placeholder="Run name" value={replayDraft.name} onChange={(e) => setReplayDraft({ ...replayDraft, name: e.target.value })} />
                <select value={replayDraft.releaseId} onChange={(e) => setReplayDraft({ ...replayDraft, releaseId: Number(e.target.value) })}>
                  <option value={0}>No release</option>
                  {(bootstrap?.releases ?? []).map((release) => <option key={release.id} value={release.id}>{release.name}</option>)}
                </select>
                <select value={replayDraft.promptTemplateId} onChange={(e) => setReplayDraft({ ...replayDraft, promptTemplateId: Number(e.target.value) })}>
                  <option value={0}>Select prompt</option>
                  {(bootstrap?.prompts ?? []).map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.name}</option>)}
                </select>
                <select value={replayDraft.ruleSetId} onChange={(e) => setReplayDraft({ ...replayDraft, ruleSetId: Number(e.target.value) })}>
                  <option value={0}>Select rule set</option>
                  {(bootstrap?.ruleSets ?? []).map((ruleSet) => <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</option>)}
                </select>
                <input placeholder="Recommendation IDs: 123,124" value={replayDraft.recommendationIdsText} onChange={(e) => setReplayDraft({ ...replayDraft, recommendationIdsText: e.target.value })} />
                <input placeholder="Snapshot IDs: 77,78" value={replayDraft.snapshotIdsText} onChange={(e) => setReplayDraft({ ...replayDraft, snapshotIdsText: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 8 }}>
                <input type="date" value={replayDraft.dateFrom} onChange={(e) => setReplayDraft({ ...replayDraft, dateFrom: e.target.value })} />
                <input type="date" value={replayDraft.dateTo} onChange={(e) => setReplayDraft({ ...replayDraft, dateTo: e.target.value })} />
                <input placeholder="League filter" value={replayDraft.league} onChange={(e) => setReplayDraft({ ...replayDraft, league: e.target.value })} />
                <select value={replayDraft.marketFamily} onChange={(e) => setReplayDraft({ ...replayDraft, marketFamily: e.target.value })}>
                  <option value="">Any market family</option>
                  {(bootstrap?.ruleMeta.marketFamilies ?? []).map((family) => <option key={family} value={family}>{family}</option>)}
                </select>
                <select value={replayDraft.periodKind} onChange={(e) => setReplayDraft({ ...replayDraft, periodKind: e.target.value })}>
                  <option value="">Any period</option>
                  <option value="ft">Full-time</option>
                  <option value="h1">H1</option>
                </select>
                <input placeholder="Result filter" value={replayDraft.result} onChange={(e) => setReplayDraft({ ...replayDraft, result: e.target.value })} />
                <input placeholder="Risk level" value={replayDraft.riskLevel} onChange={(e) => setReplayDraft({ ...replayDraft, riskLevel: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void runReplay()}>
                  Run Replay With Real LLM
                </button>
              </div>
            </div>

            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>Replay Detail</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refreshReplayRun()}>
                    Refresh Selected Run
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void cancelReplayRun()}
                    disabled={!selectedReplayRun || !['queued', 'running'].includes(selectedReplayRun.status)}
                  >
                    Cancel Replay
                  </button>
                </div>
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{prettyJson(selectedReplayRun)}</pre>
              {replayItems.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Run Items</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {replayItems.map((item) => (
                      <div key={item.id} style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>{item.source_ref} [{item.status}]</div>
                        <div style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 8 }}>
                          Original: {String(item.original_decision_json.originalSelection ?? 'n/a')} / {String(item.original_decision_json.originalBetMarket ?? 'n/a')}
                          {' -> '}
                          Replay: {String(item.replayed_decision_json.selection ?? 'n/a')} / {String(item.replayed_decision_json.betMarket ?? 'n/a')}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 8 }}>
                          Decision changed: {String(item.evaluation_json.decisionChanged ?? 'n/a')} | P/L delta: {String(item.evaluation_json.pnlDelta ?? 'n/a')}
                        </div>
                        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{prettyJson(item)}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
