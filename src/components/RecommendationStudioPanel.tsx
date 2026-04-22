import { useEffect, useMemo, useReducer, useState } from 'react';
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

// ── Types ────────────────────────────────────────────────────────────────────

type StudioSubTab = 'prompts' | 'rules' | 'replays' | 'releases';

const studioSubTabs: Array<{ id: StudioSubTab; label: string }> = [
  { id: 'prompts', label: 'Prompt' },
  { id: 'rules', label: 'Rules' },
  { id: 'replays', label: 'Replay Lab' },
  { id: 'releases', label: 'Releases' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function commaListToArray(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function commaListToNumberArray(value: string): number[] {
  return commaListToArray(value)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function prettyJson(value: unknown): string {
  try { return JSON.stringify(value ?? {}, null, 2); } catch { return String(value ?? ''); }
}

const TOKEN_PATTERN = /\{\{([A-Z0-9_]+)\}\}/g;

function extractTokens(text: string): string[] {
  return [...String(text ?? '').matchAll(TOKEN_PATTERN)]
    .map((m) => String(m[1] ?? '').trim())
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

function formatReplayStatus(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case 'completed': return { label: 'Completed', color: '#166534', bg: '#dcfce7' };
    case 'running': return { label: 'Running', color: '#1d4ed8', bg: '#dbeafe' };
    case 'queued': return { label: 'Queued', color: '#92400e', bg: '#fef3c7' };
    case 'failed': return { label: 'Failed', color: '#b91c1c', bg: '#fee2e2' };
    case 'completed_with_errors': return { label: 'Partial', color: '#92400e', bg: '#fef3c7' };
    case 'canceled': return { label: 'Canceled', color: '#6b7280', bg: '#f3f4f6' };
    default: return { label: status, color: '#6b7280', bg: '#f3f4f6' };
  }
}

function formatReleaseStatus(status: string, isActive: boolean): { label: string; color: string; bg: string } {
  if (isActive) return { label: 'Active', color: '#166534', bg: '#dcfce7' };
  switch (status) {
    case 'validated': return { label: 'Validated', color: '#1d4ed8', bg: '#dbeafe' };
    case 'candidate': return { label: 'Candidate', color: '#92400e', bg: '#fef3c7' };
    case 'archived': return { label: 'Archived', color: '#6b7280', bg: '#f3f4f6' };
    default: return { label: 'Draft', color: '#6b7280', bg: '#f3f4f6' };
  }
}

function formatReplayValidation(status: string): { label: string; color: string } {
  switch (status) {
    case 'validated': return { label: 'Replay validated', color: '#166534' };
    case 'not_validated': return { label: 'Not validated', color: '#b91c1c' };
    case 'failed': return { label: 'Validation failed', color: '#b91c1c' };
    default: return { label: status, color: '#6b7280' };
  }
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 600, color, background: bg, flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-900)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)',
      color: '#92400e', fontSize: 12, lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: 'rgba(239, 68, 68, 0.07)', border: '1px solid rgba(239, 68, 68, 0.2)',
      color: '#b91c1c', fontSize: 12, lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: 'rgba(59, 130, 246, 0.07)', border: '1px solid rgba(59, 130, 246, 0.18)',
      color: '#1d4ed8', fontSize: 12, lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{
      padding: '28px 16px', textAlign: 'center',
      color: 'var(--gray-400)', fontSize: 13,
      border: '1px dashed var(--gray-200)', borderRadius: 8,
    }}>
      {message}
    </div>
  );
}

function FormRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
      {children}
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function PanelCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={{ padding: 16, ...style }}>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--gray-100)', margin: '8px 0' }} />;
}

// Active release status bar shown across all tabs
function ActiveReleaseBar({ activeRelease }: { activeRelease: RecommendationStudioBootstrap['activeRelease'] }) {
  if (!activeRelease) {
    return (
      <div style={{
        padding: '8px 12px', borderRadius: 8, marginBottom: 12,
        background: '#fff7ed', border: '1px solid #fed7aa',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
      }}>
        <span style={{ color: '#c2410c', fontWeight: 600 }}>No active release.</span>
        <span style={{ color: '#9a3412' }}>The live pipeline is running without a Studio override. Activate a validated release to enable it.</span>
      </div>
    );
  }
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 8, marginBottom: 12,
      background: '#f0fdf4', border: '1px solid #bbf7d0',
      display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap',
    }}>
      <StatusBadge label="Live" color="#166534" bg="#dcfce7" />
      <span style={{ fontWeight: 600, color: 'var(--gray-900)' }}>{activeRelease.name}</span>
      <span style={{ color: 'var(--gray-500)' }}>is the active release.</span>
      <span style={{ color: 'var(--gray-500)' }}>Prompt:</span>
      <span style={{ fontWeight: 600, color: 'var(--gray-900)' }}>
        {activeRelease.promptTemplate?.name ?? `#${activeRelease.prompt_template_id}`}
      </span>
      <span style={{ color: 'var(--gray-500)' }}>Rule set:</span>
      <span style={{ fontWeight: 600, color: 'var(--gray-900)' }}>
        {activeRelease.ruleSet?.name ?? `#${activeRelease.rule_set_id}`}
      </span>
    </div>
  );
}

// ── Prompt Tab ───────────────────────────────────────────────────────────────

function PromptTab({
  bootstrap,
  config,
  onBootstrapRefresh,
}: {
  bootstrap: RecommendationStudioBootstrap;
  config: ReturnType<typeof useAppState>['state']['config'];
  onBootstrapRefresh: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(bootstrap.prompts[0]?.id ?? null);
  const [promptDraft, setPromptDraft] = useState<RecommendationStudioPromptTemplate | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRecommendationIds, setPreviewRecommendationIds] = useState('');
  const [previewSnapshotIds, setPreviewSnapshotIds] = useState('');
  const [previewRuleSetId, setPreviewRuleSetId] = useState<number>(bootstrap.activeRelease?.rule_set_id ?? bootstrap.ruleSets[0]?.id ?? 0);
  const [diffAgainstId, setDiffAgainstId] = useState(0);
  const [diffResult, setDiffResult] = useState<Record<string, unknown> | null>(null);
  const [activeTokenTarget, setActiveTokenTarget] = useState<{ kind: 'appendix' | 'section'; index?: number } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const activeRelease = bootstrap.activeRelease;
  const promptLocked = Boolean(activeRelease && promptDraft && promptDraft.id > 0 && activeRelease.prompt_template_id === promptDraft.id);
  const allowedTokens = useMemo(() => new Set(bootstrap.tokenCatalog.map((t) => t.key)), [bootstrap.tokenCatalog]);

  const validationIssues = useMemo(() => {
    if (!promptDraft) return [];
    const issues: string[] = [];
    for (const token of extractTokens(promptDraft.advanced_appendix)) {
      if (!allowedTokens.has(token)) issues.push(`Unknown appendix token: {{${token}}}`);
    }
    for (const [i, section] of (promptDraft.sections ?? []).entries()) {
      for (const token of extractTokens(section.content)) {
        if (!allowedTokens.has(token)) issues.push(`Unknown token in "${section.label || section.section_key || `section ${i + 1}`}": {{${token}}}`);
      }
    }
    return issues;
  }, [allowedTokens, promptDraft]);

  useEffect(() => {
    if (!selectedPromptId) { setPromptDraft(null); return; }
    setPromptLoading(true);
    void fetchRecommendationStudioPrompt(config, selectedPromptId)
      .then(setPromptDraft)
      .catch((err) => showToast(`Failed to load prompt: ${err instanceof Error ? err.message : String(err)}`, 'error'))
      .finally(() => setPromptLoading(false));
  }, [config, selectedPromptId, showToast]);

  useEffect(() => {
    if (previewRuleSetId > 0) return;
    setPreviewRuleSetId(bootstrap.activeRelease?.rule_set_id ?? bootstrap.ruleSets[0]?.id ?? 0);
  }, [bootstrap.activeRelease?.rule_set_id, bootstrap.ruleSets, previewRuleSetId]);

  const insertToken = (tokenKey: string) => {
    const token = `{{${tokenKey}}}`;
    if (!promptDraft || !activeTokenTarget) return;
    if (activeTokenTarget.kind === 'appendix') {
      setPromptDraft({ ...promptDraft, advanced_appendix: `${promptDraft.advanced_appendix}${promptDraft.advanced_appendix ? '\n' : ''}${token}` });
      return;
    }
    const idx = activeTokenTarget.index ?? -1;
    if (idx < 0) return;
    setPromptDraft({
      ...promptDraft,
      sections: (promptDraft.sections ?? []).map((s, i) => i === idx ? { ...s, content: `${s.content}${s.content ? '\n' : ''}${token}` } : s),
    });
  };

  const handleSave = async () => {
    if (!promptDraft || promptLocked || saving) return;
    if (validationIssues.length > 0) { showToast(validationIssues[0]!, 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        name: promptDraft.name,
        basePromptVersion: promptDraft.base_prompt_version,
        status: promptDraft.status,
        notes: promptDraft.notes,
        advancedAppendix: promptDraft.advanced_appendix,
        sections: (promptDraft.sections ?? []).map((s) => ({
          id: s.id > 0 ? s.id : undefined,
          section_key: s.section_key,
          label: s.label,
          content: s.content,
          enabled: s.enabled,
          sort_order: s.sort_order,
        })),
      };
      const saved = promptDraft.id > 0
        ? await updateRecommendationStudioPrompt(config, promptDraft.id, payload)
        : await createRecommendationStudioPrompt(config, payload);
      setPromptDraft(saved);
      setSelectedPromptId(saved.id);
      await onBootstrapRefresh();
      showToast('Prompt template saved', 'success');
    } catch (err) {
      showToast(`Failed to save prompt: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setSaving(false); }
  };

  const handleClone = async () => {
    if (!selectedPromptId) return;
    try {
      const cloned = await cloneRecommendationStudioPrompt(config, selectedPromptId);
      setSelectedPromptId(cloned.id);
      await onBootstrapRefresh();
      showToast('Prompt cloned', 'success');
    } catch (err) {
      showToast(`Failed to clone: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handlePreview = async () => {
    if (!promptDraft) return;
    if (!promptDraft.id) {
      showToast('Save the prompt before generating a compiled preview', 'error');
      return;
    }
    if (!previewRuleSetId) {
      showToast('Select a rule set for preview', 'error');
      return;
    }
    setPreviewLoading(true);
    try {
      const result = await compileRecommendationStudioPromptPreview(config, promptDraft.id, {
        ruleSetId: previewRuleSetId,
        recommendationIds: commaListToNumberArray(previewRecommendationIds),
        snapshotIds: commaListToNumberArray(previewSnapshotIds),
      });
      setPreviewText(result.prompt ?? '(empty)');
      setShowPreview(true);
    } catch (err) {
      showToast(`Preview failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setPreviewLoading(false); }
  };

  const handleDiff = async () => {
    if (!selectedPromptId || !diffAgainstId) return;
    try {
      const diff = await fetchRecommendationStudioPromptDiff(config, selectedPromptId, diffAgainstId);
      setDiffResult(diff);
      setShowDiff(true);
    } catch (err) {
      showToast(`Diff failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const newPrompt = () => {
    setSelectedPromptId(null);
    setPromptDraft({
      id: 0,
      template_key: '',
      name: 'New Prompt',
      base_prompt_version: bootstrap.promptVersions[0] ?? 'v10-hybrid-legacy-b',
      status: 'draft',
      notes: '',
      advanced_appendix: '',
      created_by: null,
      updated_by: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      sections: [defaultPromptSection(0)],
    });
  };

  return (
    <div className="studio-sidebar-grid">
      {/* Sidebar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PanelCard>
          <SectionHeader title="Prompt Templates" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {bootstrap.prompts.length === 0 && <EmptyState message="No prompt templates yet." />}
            {bootstrap.prompts.map((p) => {
              const isActive = activeRelease?.prompt_template_id === p.id;
              const isSelected = selectedPromptId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPromptId(p.id)}
                  style={{
                    textAlign: 'left', padding: '7px 10px', borderRadius: 6, border: 'none',
                    background: isSelected ? '#eff6ff' : 'transparent',
                    cursor: 'pointer', fontSize: 12, fontWeight: isSelected ? 600 : 400,
                    color: isSelected ? '#1d4ed8' : 'var(--gray-700)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  {isActive && <StatusBadge label="Live" color="#166534" bg="#dcfce7" />}
                  {!isActive && p.status !== 'draft' && <StatusBadge label={p.status} color="#92400e" bg="#fef3c7" />}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={newPrompt}>New</button>
            <button type="button" className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => void handleClone()} disabled={!selectedPromptId}>Clone</button>
          </div>
        </PanelCard>

        {/* Token Catalog reference */}
        <PanelCard>
          <SectionHeader title="Token Catalog" subtitle="Click a token to insert into the focused section." />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {bootstrap.tokenCatalog.map((token) => (
              <button
                key={token.key}
                type="button"
                title={token.description}
                className="btn btn-secondary btn-sm"
                style={{ fontSize: 10, padding: '2px 7px', fontFamily: 'monospace' }}
                onClick={() => insertToken(token.key)}
                disabled={!activeTokenTarget}
              >
                {`{{${token.key}}}`}
              </button>
            ))}
          </div>
          {!activeTokenTarget && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--gray-400)' }}>
              Click into a section or Advanced Appendix to enable token insertion.
            </div>
          )}
        </PanelCard>
      </div>

      {/* Editor area */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {promptLoading && <div style={{ padding: 20, color: 'var(--gray-500)', fontSize: 13 }}>Loading prompt...</div>}

        {!promptLoading && !promptDraft && (
          <PanelCard>
            <EmptyState message="Select a prompt template from the list, or create a new one." />
          </PanelCard>
        )}

        {!promptLoading && promptDraft && (
          <>
            {promptLocked && (
              <WarningBanner>
                <strong>Read-only.</strong> This prompt is bound to the active release. Clone it to edit.
              </WarningBanner>
            )}

            {validationIssues.length > 0 && (
              <ErrorBanner>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Validation issues ({validationIssues.length})</div>
                <ul style={{ paddingLeft: 16, margin: 0 }}>
                  {validationIssues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              </ErrorBanner>
            )}

            <PanelCard>
              <SectionHeader title="Prompt Details" />
              <FormRow>
                <FieldLabel label="Name">
                  <input
                    aria-label="Name"
                    value={promptDraft.name}
                    disabled={promptLocked}
                    onChange={(e) => setPromptDraft({ ...promptDraft, name: e.target.value })}
                  />
                </FieldLabel>
                <FieldLabel label="Base Version">
                  <select
                    value={promptDraft.base_prompt_version}
                    disabled={promptLocked}
                    onChange={(e) => setPromptDraft({ ...promptDraft, base_prompt_version: e.target.value })}
                  >
                    {bootstrap.promptVersions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </FieldLabel>
                <FieldLabel label="Status">
                  <select
                    value={promptDraft.status}
                    disabled={promptLocked}
                    onChange={(e) => setPromptDraft({ ...promptDraft, status: e.target.value as RecommendationStudioPromptTemplate['status'] })}
                  >
                    {['draft', 'validated', 'candidate', 'active', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </FieldLabel>
                <FieldLabel label="Notes">
                  <input
                    value={promptDraft.notes}
                    disabled={promptLocked}
                    onChange={(e) => setPromptDraft({ ...promptDraft, notes: e.target.value })}
                    placeholder="Optional notes"
                  />
                </FieldLabel>
              </FormRow>
            </PanelCard>

            <PanelCard>
              <SectionHeader title="Sections" subtitle="Each enabled section is appended to the base prompt at runtime in sort_order." />
              {(promptDraft.sections ?? []).length === 0 && <EmptyState message="No sections. Add a section below." />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(promptDraft.sections ?? []).map((section, idx) => (
                  <div
                    key={`${section.id}-${idx}`}
                    style={{
                      border: `1px solid ${section.enabled ? 'var(--gray-200)' : 'var(--gray-100)'}`,
                      borderRadius: 8, padding: 12, opacity: section.enabled ? 1 : 0.55,
                      background: section.enabled ? '#fff' : 'var(--gray-50)',
                    }}
                  >
                    <div className="studio-section-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                      <input
                        placeholder="section_key"
                        value={section.section_key}
                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                        disabled={promptLocked}
                        onChange={(e) => setPromptDraft({
                          ...promptDraft,
                          sections: (promptDraft.sections ?? []).map((r, i) => i === idx ? { ...r, section_key: e.target.value } : r),
                        })}
                      />
                      <input
                        placeholder="Label"
                        value={section.label}
                        disabled={promptLocked}
                        onChange={(e) => setPromptDraft({
                          ...promptDraft,
                          sections: (promptDraft.sections ?? []).map((r, i) => i === idx ? { ...r, label: e.target.value } : r),
                        })}
                      />
                      <input
                        type="number"
                        value={section.sort_order}
                        style={{ width: 60 }}
                        disabled={promptLocked}
                        onChange={(e) => setPromptDraft({
                          ...promptDraft,
                          sections: (promptDraft.sections ?? []).map((r, i) => i === idx ? { ...r, sort_order: Number(e.target.value) } : r),
                        })}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={section.enabled}
                          disabled={promptLocked}
                          onChange={(e) => setPromptDraft({
                            ...promptDraft,
                            sections: (promptDraft.sections ?? []).map((r, i) => i === idx ? { ...r, enabled: e.target.checked } : r),
                          })}
                        />
                        Enabled
                      </label>
                      {!promptLocked && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => setPromptDraft({
                            ...promptDraft,
                            sections: (promptDraft.sections ?? []).filter((_, i) => i !== idx),
                          })}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <textarea
                      aria-label={`Section content for ${section.label || section.section_key}`}
                      rows={4}
                      value={section.content}
                      style={{ fontFamily: 'monospace', fontSize: 12, width: '100%' }}
                      disabled={promptLocked}
                      onFocus={() => setActiveTokenTarget({ kind: 'section', index: idx })}
                      onChange={(e) => setPromptDraft({
                        ...promptDraft,
                        sections: (promptDraft.sections ?? []).map((r, i) => i === idx ? { ...r, content: e.target.value } : r),
                      })}
                    />
                  </div>
                ))}
              </div>

              {!promptLocked && (
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setPromptDraft({
                      ...promptDraft,
                      sections: [...(promptDraft.sections ?? []), defaultPromptSection((promptDraft.sections ?? []).length)],
                    })}
                  >
                    Add Section
                  </button>
                </div>
              )}
            </PanelCard>

            <PanelCard>
              <FieldLabel label="Advanced Appendix (optional bounded free-text)">
                <textarea
                  aria-label="Advanced Appendix"
                  rows={5}
                  value={promptDraft.advanced_appendix}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                  disabled={promptLocked}
                  onFocus={() => setActiveTokenTarget({ kind: 'appendix' })}
                  onChange={(e) => setPromptDraft({ ...promptDraft, advanced_appendix: e.target.value })}
                />
              </FieldLabel>
            </PanelCard>

            {!promptLocked && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleSave()}
                  disabled={saving || validationIssues.length > 0}
                >
                  {saving ? 'Saving...' : promptDraft.id > 0 ? 'Save Changes' : 'Create Prompt'}
                </button>
              </div>
            )}

            <Divider />

            {/* Compile Preview */}
            <PanelCard>
              <SectionHeader title="Compile Preview" subtitle="See the full prompt as it would be sent to the LLM (mock run, no cost)." />
              <FormRow>
                <FieldLabel label="Rule set">
                  <select value={previewRuleSetId} onChange={(e) => setPreviewRuleSetId(Number(e.target.value))}>
                    <option value={0}>Select rule set...</option>
                    {bootstrap.ruleSets.map((ruleSet) => (
                      <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</option>
                    ))}
                  </select>
                </FieldLabel>
                <FieldLabel label="Recommendation IDs (comma-separated)">
                  <input
                    placeholder="e.g. 123,124"
                    value={previewRecommendationIds}
                    onChange={(e) => setPreviewRecommendationIds(e.target.value)}
                  />
                </FieldLabel>
                <FieldLabel label="Snapshot IDs (comma-separated)">
                  <input
                    placeholder="e.g. 88,89"
                    value={previewSnapshotIds}
                    onChange={(e) => setPreviewSnapshotIds(e.target.value)}
                  />
                </FieldLabel>
              </FormRow>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void handlePreview()}
                  disabled={previewLoading || !promptDraft.id}
                >
                  {previewLoading ? 'Compiling...' : 'Preview Compiled Prompt'}
                </button>
                {showPreview && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowPreview(false)}>
                    Hide
                  </button>
                )}
              </div>
              {showPreview && previewText && (
                <textarea
                  rows={16}
                  value={previewText}
                  readOnly
                  style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 10, background: 'var(--gray-50)' }}
                />
              )}
            </PanelCard>

            {/* Diff */}
            <PanelCard>
              <SectionHeader title="Compare With Another Version" />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <FieldLabel label="Compare against">
                  <select value={diffAgainstId} onChange={(e) => { setDiffAgainstId(Number(e.target.value)); setShowDiff(false); }}>
                    <option value={0}>Select prompt...</option>
                    {bootstrap.prompts
                      .filter((p) => p.id !== selectedPromptId)
                      .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </FieldLabel>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void handleDiff()}
                  disabled={!selectedPromptId || !diffAgainstId}
                >
                  Show Diff
                </button>
                {showDiff && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowDiff(false)}>Hide</button>}
              </div>
              {showDiff && diffResult && (
                <div style={{ marginTop: 10 }}>
                  {Array.isArray((diffResult as { promptSectionDiffs?: unknown[] }).promptSectionDiffs) ? (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Section Changes</div>
                      {((diffResult as { promptSectionDiffs?: Array<{ sectionKey: string; changeType: string }> }).promptSectionDiffs ?? []).length === 0
                        ? <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>No section changes detected.</div>
                        : (
                          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                            {((diffResult as { promptSectionDiffs?: Array<{ sectionKey: string; changeType: string }> }).promptSectionDiffs ?? []).map((e) => (
                              <li key={`${e.sectionKey}-${e.changeType}`} style={{ color: e.changeType === 'added' ? '#166534' : e.changeType === 'removed' ? '#b91c1c' : '#92400e' }}>
                                {e.changeType.toUpperCase()}: {e.sectionKey}
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>
                  ) : (
                    <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{prettyJson(diffResult)}</pre>
                  )}
                </div>
              )}
            </PanelCard>
          </>
        )}
      </div>
    </div>
  );
}

// ── Rules Tab ────────────────────────────────────────────────────────────────

function RuleConditionRow({
  rule,
  locked,
  ruleMeta,
  onChange,
}: {
  rule: RecommendationStudioRule;
  locked: boolean;
  ruleMeta: RecommendationStudioBootstrap['ruleMeta'];
  onChange: (updated: Partial<RecommendationStudioRule>) => void;
}) {
  const cond = rule.conditions_json;
  const act = rule.actions_json;

  const updateCond = (key: string, value: unknown) => onChange({ conditions_json: { ...cond, [key]: value } });
  const updateAct = (key: string, value: unknown) => onChange({ actions_json: { ...act, [key]: value } });

  return (
    <div style={{
      border: `1px solid ${rule.enabled ? 'var(--gray-200)' : 'var(--gray-100)'}`,
      borderRadius: 8, padding: 12, opacity: rule.enabled ? 1 : 0.55,
      background: rule.enabled ? '#fff' : 'var(--gray-50)',
    }}>
      {/* Rule header row */}
      <div className="studio-rule-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <input
          placeholder="Rule name"
          value={rule.name}
          disabled={locked}
          style={{ fontWeight: 600 }}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <select
          value={rule.stage}
          disabled={locked}
          style={{ fontSize: 12 }}
          onChange={(e) => onChange({ stage: e.target.value as RecommendationStudioRule['stage'] })}
        >
          <option value="pre_prompt">pre_prompt</option>
          <option value="post_parse">post_parse</option>
        </select>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 600 }}>PRIORITY</span>
          <input
            type="number"
            value={rule.priority}
            disabled={locked}
            style={{ width: 70, fontSize: 12 }}
            onChange={(e) => onChange({ priority: Number(e.target.value) })}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={rule.enabled}
            disabled={locked}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          Enabled
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Conditions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Conditions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <FieldLabel label="Minute bands (e.g. 30-44,45-59)">
              <input
                placeholder="30-44, 45-59"
                value={(cond.minuteBands ?? []).join(', ')}
                disabled={locked}
                onChange={(e) => updateCond('minuteBands', commaListToArray(e.target.value))}
              />
            </FieldLabel>
            <FieldLabel label="Market families">
              <select
                multiple
                disabled={locked}
                size={3}
                style={{ fontSize: 12 }}
                value={cond.marketFamilies ?? []}
                onChange={(e) => updateCond('marketFamilies', Array.from(e.target.selectedOptions).map((o) => o.value))}
              >
                {ruleMeta.marketFamilies.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </FieldLabel>
            <FieldLabel label="Period">
              <select
                multiple
                disabled={locked}
                size={2}
                style={{ fontSize: 12 }}
                value={cond.periodKinds ?? []}
                onChange={(e) => updateCond('periodKinds', Array.from(e.target.selectedOptions).map((o) => o.value))}
              >
                <option value="ft">Full-time</option>
                <option value="h1">H1</option>
              </select>
            </FieldLabel>
            <FieldLabel label="Evidence modes (comma-sep)">
              <input
                placeholder="e.g. strong_live, moderate"
                value={(cond.evidenceModes ?? []).join(', ')}
                disabled={locked}
                onChange={(e) => updateCond('evidenceModes', commaListToArray(e.target.value))}
              />
            </FieldLabel>
            <FieldLabel label="Score states (comma-sep)">
              <input
                placeholder="e.g. 0-0, 1-0"
                value={(cond.scoreStates ?? []).join(', ')}
                disabled={locked}
                onChange={(e) => updateCond('scoreStates', commaListToArray(e.target.value))}
              />
            </FieldLabel>
            <FieldLabel label="Prematch strengths (comma-sep)">
              <input
                placeholder="e.g. strong, moderate"
                value={(cond.prematchStrengths ?? []).join(', ')}
                disabled={locked}
                onChange={(e) => updateCond('prematchStrengths', commaListToArray(e.target.value))}
              />
            </FieldLabel>
            <FieldLabel label="Canonical market prefixes (comma-sep)">
              <input
                placeholder="e.g. goals_ou_ft"
                value={(cond.canonicalMarketPrefixes ?? []).join(', ')}
                disabled={locked}
                onChange={(e) => updateCond('canonicalMarketPrefixes', commaListToArray(e.target.value))}
              />
            </FieldLabel>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Actions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rule.stage === 'post_parse' && (
              <>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={act.block === true} disabled={locked} onChange={(e) => updateAct('block', e.target.checked || undefined)} />
                    Block
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={act.forceNoBet === true} disabled={locked} onChange={(e) => updateAct('forceNoBet', e.target.checked || undefined)} />
                    Force No Bet
                  </label>
                </div>
                <FieldLabel label="Cap Confidence (0-1)">
                  <input
                    type="number"
                    min="0" max="1" step="0.05"
                    value={act.capConfidence ?? ''}
                    disabled={locked}
                    placeholder="e.g. 0.6"
                    onChange={(e) => updateAct('capConfidence', e.target.value === '' ? undefined : Number(e.target.value))}
                  />
                </FieldLabel>
                <FieldLabel label="Cap Stake %">
                  <input
                    type="number"
                    min="0" max="100" step="5"
                    value={act.capStakePercent ?? ''}
                    disabled={locked}
                    placeholder="e.g. 50"
                    onChange={(e) => updateAct('capStakePercent', e.target.value === '' ? undefined : Number(e.target.value))}
                  />
                </FieldLabel>
                <FieldLabel label="Raise Min Edge %">
                  <input
                    type="number"
                    min="0" step="1"
                    value={act.raiseMinEdge ?? ''}
                    disabled={locked}
                    placeholder="e.g. 5"
                    onChange={(e) => updateAct('raiseMinEdge', e.target.value === '' ? undefined : Number(e.target.value))}
                  />
                </FieldLabel>
                <FieldLabel label="Warning message">
                  <input
                    value={act.warning ?? ''}
                    disabled={locked}
                    placeholder="Shown in recommendation output"
                    onChange={(e) => updateAct('warning', e.target.value || undefined)}
                  />
                </FieldLabel>
              </>
            )}
            {rule.stage === 'pre_prompt' && (
              <>
                <FieldLabel label="Hide market families from prompt">
                  <select
                    multiple
                    disabled={locked}
                    size={3}
                    style={{ fontSize: 12 }}
                    value={act.hideMarketFamiliesFromPrompt ?? []}
                    onChange={(e) => updateAct('hideMarketFamiliesFromPrompt', Array.from(e.target.selectedOptions).map((o) => o.value))}
                  >
                    {ruleMeta.marketFamilies.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </FieldLabel>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={act.markExceptionalOnly === true}
                    disabled={locked}
                    onChange={(e) => updateAct('markExceptionalOnly', e.target.checked || undefined)}
                  />
                  Mark as exceptional-only
                </label>
                <FieldLabel label="Append instruction">
                  <textarea
                    rows={3}
                    value={act.appendInstruction ?? ''}
                    disabled={locked}
                    placeholder="Extra instruction injected before LLM call"
                    onChange={(e) => updateAct('appendInstruction', e.target.value || undefined)}
                  />
                </FieldLabel>
              </>
            )}
          </div>
        </div>
      </div>

      <FieldLabel label="Rule notes">
        <input
          value={rule.notes}
          disabled={locked}
          placeholder="Internal notes for this rule"
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </FieldLabel>
    </div>
  );
}

function RulesTab({
  bootstrap,
  config,
  onBootstrapRefresh,
}: {
  bootstrap: RecommendationStudioBootstrap;
  config: ReturnType<typeof useAppState>['state']['config'];
  onBootstrapRefresh: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const [selectedRuleSetId, setSelectedRuleSetId] = useState<number | null>(bootstrap.ruleSets[0]?.id ?? null);
  const [ruleSetDraft, setRuleSetDraft] = useState<RecommendationStudioRuleSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [diffAgainstId, setDiffAgainstId] = useState(0);
  const [diffResult, setDiffResult] = useState<Record<string, unknown> | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  const activeRelease = bootstrap.activeRelease;
  const ruleSetLocked = Boolean(activeRelease && ruleSetDraft && ruleSetDraft.id > 0 && activeRelease.rule_set_id === ruleSetDraft.id);

  useEffect(() => {
    if (!selectedRuleSetId) { setRuleSetDraft(null); return; }
    setLoading(true);
    void fetchRecommendationStudioRuleSet(config, selectedRuleSetId)
      .then(setRuleSetDraft)
      .catch((err) => showToast(`Failed to load rule set: ${err instanceof Error ? err.message : String(err)}`, 'error'))
      .finally(() => setLoading(false));
  }, [config, selectedRuleSetId, showToast]);

  const handleSave = async () => {
    if (!ruleSetDraft || ruleSetLocked || saving) return;
    setSaving(true);
    try {
      const payload = {
        name: ruleSetDraft.name,
        status: ruleSetDraft.status,
        notes: ruleSetDraft.notes,
        rules: (ruleSetDraft.rules ?? []).map((r) => ({
          name: r.name,
          stage: r.stage,
          priority: r.priority,
          enabled: r.enabled,
          conditions_json: r.conditions_json,
          actions_json: r.actions_json,
          notes: r.notes,
        })),
      };
      const saved = ruleSetDraft.id > 0
        ? await updateRecommendationStudioRuleSet(config, ruleSetDraft.id, payload)
        : await createRecommendationStudioRuleSet(config, payload);
      setRuleSetDraft(saved);
      setSelectedRuleSetId(saved.id);
      await onBootstrapRefresh();
      showToast('Rule set saved', 'success');
    } catch (err) {
      showToast(`Failed to save rule set: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setSaving(false); }
  };

  const handleClone = async () => {
    if (!selectedRuleSetId) return;
    try {
      const cloned = await cloneRecommendationStudioRuleSet(config, selectedRuleSetId);
      setSelectedRuleSetId(cloned.id);
      await onBootstrapRefresh();
      showToast('Rule set cloned', 'success');
    } catch (err) {
      showToast(`Clone failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleDiff = async () => {
    if (!selectedRuleSetId || !diffAgainstId) return;
    try {
      const diff = await fetchRecommendationStudioRuleSetDiff(config, selectedRuleSetId, diffAgainstId);
      setDiffResult(diff);
      setShowDiff(true);
    } catch (err) {
      showToast(`Diff failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const updateRule = (idx: number, updates: Partial<RecommendationStudioRule>) => {
    if (!ruleSetDraft) return;
    setRuleSetDraft({
      ...ruleSetDraft,
      rules: (ruleSetDraft.rules ?? []).map((r, i) => i === idx ? { ...r, ...updates } : r),
    });
  };

  const newRuleSet = () => {
    setSelectedRuleSetId(null);
    setRuleSetDraft({
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
    });
  };

  const prePromptRules = (ruleSetDraft?.rules ?? []).filter((r) => r.stage === 'pre_prompt');
  const postParseRules = (ruleSetDraft?.rules ?? []).filter((r) => r.stage === 'post_parse');
  const allRules = ruleSetDraft?.rules ?? [];

  return (
    <div className="studio-sidebar-grid">
      {/* Sidebar */}
      <PanelCard>
        <SectionHeader title="Rule Sets" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {bootstrap.ruleSets.length === 0 && <EmptyState message="No rule sets yet." />}
          {bootstrap.ruleSets.map((rs) => {
            const isActive = activeRelease?.rule_set_id === rs.id;
            const isSelected = selectedRuleSetId === rs.id;
            return (
              <button
                key={rs.id}
                type="button"
                onClick={() => setSelectedRuleSetId(rs.id)}
                style={{
                  textAlign: 'left', padding: '7px 10px', borderRadius: 6, border: 'none',
                  background: isSelected ? '#eff6ff' : 'transparent',
                  cursor: 'pointer', fontSize: 12, fontWeight: isSelected ? 600 : 400,
                  color: isSelected ? '#1d4ed8' : 'var(--gray-700)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rs.name}</span>
                {isActive && <StatusBadge label="Live" color="#166534" bg="#dcfce7" />}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={newRuleSet}>New</button>
          <button type="button" className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => void handleClone()} disabled={!selectedRuleSetId}>Clone</button>
        </div>
      </PanelCard>

      {/* Editor */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && <div style={{ padding: 20, color: 'var(--gray-500)', fontSize: 13 }}>Loading rule set...</div>}

        {!loading && !ruleSetDraft && (
          <PanelCard>
            <EmptyState message="Select a rule set, or create a new one." />
          </PanelCard>
        )}

        {!loading && ruleSetDraft && (
          <>
            {ruleSetLocked && (
              <WarningBanner>
                <strong>Read-only.</strong> This rule set is bound to the active release. Clone it to edit.
              </WarningBanner>
            )}

            <PanelCard>
              <SectionHeader title="Rule Set Details" />
              <FormRow>
                <FieldLabel label="Name">
                  <input
                    value={ruleSetDraft.name}
                    disabled={ruleSetLocked}
                    onChange={(e) => setRuleSetDraft({ ...ruleSetDraft, name: e.target.value })}
                  />
                </FieldLabel>
                <FieldLabel label="Status">
                  <select
                    value={ruleSetDraft.status}
                    disabled={ruleSetLocked}
                    onChange={(e) => setRuleSetDraft({ ...ruleSetDraft, status: e.target.value as RecommendationStudioRuleSet['status'] })}
                  >
                    {['draft', 'validated', 'candidate', 'active', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </FieldLabel>
                <FieldLabel label="Notes">
                  <input
                    value={ruleSetDraft.notes}
                    disabled={ruleSetLocked}
                    placeholder="Optional notes"
                    onChange={(e) => setRuleSetDraft({ ...ruleSetDraft, notes: e.target.value })}
                  />
                </FieldLabel>
              </FormRow>
            </PanelCard>

            {/* Summary counts */}
            {allRules.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ padding: '6px 12px', borderRadius: 6, background: '#eff6ff', fontSize: 12, color: '#1d4ed8', fontWeight: 600 }}>
                  {prePromptRules.length} pre_prompt rule{prePromptRules.length !== 1 ? 's' : ''}
                </div>
                <div style={{ padding: '6px 12px', borderRadius: 6, background: '#f0fdf4', fontSize: 12, color: '#166534', fontWeight: 600 }}>
                  {postParseRules.length} post_parse rule{postParseRules.length !== 1 ? 's' : ''}
                </div>
                <div style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--gray-100)', fontSize: 12, color: 'var(--gray-600)', fontWeight: 600 }}>
                  {allRules.filter((r) => !r.enabled).length} disabled
                </div>
              </div>
            )}

            {allRules.length === 0 && <EmptyState message="No rules in this set. Add a rule below." />}

            {allRules.map((rule, idx) => (
              <div key={`${rule.id}-${idx}`}>
                <RuleConditionRow
                  rule={rule}
                  locked={ruleSetLocked}
                  ruleMeta={bootstrap.ruleMeta}
                  onChange={(updates) => updateRule(idx, updates)}
                />
                {!ruleSetLocked && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: 11 }}
                      onClick={() => setRuleSetDraft({
                        ...ruleSetDraft,
                        rules: (ruleSetDraft.rules ?? []).filter((_, i) => i !== idx),
                      })}
                    >
                      Remove Rule
                    </button>
                  </div>
                )}
              </div>
            ))}

            {!ruleSetLocked && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setRuleSetDraft({
                    ...ruleSetDraft,
                    rules: [...(ruleSetDraft.rules ?? []), defaultRule((ruleSetDraft.rules ?? []).length)],
                  })}
                >
                  Add Rule
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : ruleSetDraft.id > 0 ? 'Save Rule Set' : 'Create Rule Set'}
                </button>
              </div>
            )}

            <Divider />

            <PanelCard>
              <SectionHeader title="Compare With Another Version" />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <FieldLabel label="Compare against">
                  <select value={diffAgainstId} onChange={(e) => { setDiffAgainstId(Number(e.target.value)); setShowDiff(false); }}>
                    <option value={0}>Select rule set...</option>
                    {bootstrap.ruleSets
                      .filter((rs) => rs.id !== selectedRuleSetId)
                      .map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                  </select>
                </FieldLabel>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleDiff()} disabled={!selectedRuleSetId || !diffAgainstId}>
                  Show Diff
                </button>
                {showDiff && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowDiff(false)}>Hide</button>}
              </div>
              {showDiff && diffResult && (
                <div style={{ marginTop: 10 }}>
                  {Array.isArray((diffResult as { ruleDiffs?: unknown[] }).ruleDiffs)
                    ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                        {((diffResult as { ruleDiffs?: Array<{ ruleKey: string; changeType: string }> }).ruleDiffs ?? []).map((e) => (
                          <li key={`${e.ruleKey}-${e.changeType}`} style={{ color: e.changeType === 'added' ? '#166534' : e.changeType === 'removed' ? '#b91c1c' : '#92400e' }}>
                            {e.changeType.toUpperCase()}: {e.ruleKey}
                          </li>
                        ))}
                      </ul>
                    )
                    : <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{prettyJson(diffResult)}</pre>}
                </div>
              )}
            </PanelCard>
          </>
        )}
      </div>
    </div>
  );
}

// ── Replay Tab ───────────────────────────────────────────────────────────────

function ReplayMetricRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px', borderRadius: 6, background: 'var(--gray-50)', border: '1px solid var(--gray-100)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--gray-400)' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--gray-900)' }}>
        {value == null || value === '' ? '-' : String(value)}
      </div>
    </div>
  );
}

function ReplayTab({
  bootstrap,
  config,
  onBootstrapRefresh,
}: {
  bootstrap: RecommendationStudioBootstrap;
  config: ReturnType<typeof useAppState>['state']['config'];
  onBootstrapRefresh: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(bootstrap.replayRuns[0]?.id ?? null);
  const [runItems, setRunItems] = useState<RecommendationStudioReplayRunItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [draft, setDraft] = useReducer(
    (prev: typeof initDraft, updates: Partial<typeof initDraft>) => ({ ...prev, ...updates }),
    {
      name: '',
      releaseId: bootstrap.activeRelease?.id ?? bootstrap.releases[0]?.id ?? 0,
      promptTemplateId: bootstrap.prompts[0]?.id ?? 0,
      ruleSetId: bootstrap.ruleSets[0]?.id ?? 0,
      recommendationIdsText: '',
      snapshotIdsText: '',
      dateFrom: '',
      dateTo: '',
      league: '',
      marketFamily: '',
      periodKind: '',
      result: '',
      riskLevel: '',
    },
  );

  // reference to current initDraft shape for useReducer type inference
  const initDraft = {
    name: '', releaseId: 0, promptTemplateId: 0, ruleSetId: 0,
    recommendationIdsText: '', snapshotIdsText: '',
    dateFrom: '', dateTo: '', league: '', marketFamily: '', periodKind: '', result: '', riskLevel: '',
  };

  const selectedRun = bootstrap.replayRuns.find((r) => r.id === selectedRunId) ?? null;

  const loadItems = async (runId: number) => {
    setItemsLoading(true);
    try {
      const items = await fetchRecommendationStudioReplayRunItems(config, runId);
      setRunItems(items);
      setShowItems(true);
    } catch (err) {
      showToast(`Failed to load items: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setItemsLoading(false); }
  };

  const handleRefresh = async () => {
    if (!selectedRunId) return;
    setRefreshing(true);
    try {
      const [run] = await Promise.all([fetchRecommendationStudioReplayRun(config, selectedRunId)]);
      // update bootstrap in local state via onBootstrapRefresh
      await onBootstrapRefresh();
      if (showItems) await loadItems(run.id);
    } catch (err) {
      showToast(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setRefreshing(false); }
  };

  const handleCancel = async () => {
    if (!selectedRunId) return;
    try {
      await cancelRecommendationStudioReplayRun(config, selectedRunId);
      await onBootstrapRefresh();
      showToast('Replay run canceled', 'success');
    } catch (err) {
      showToast(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const created = await createRecommendationStudioReplayRun(config, {
        ...draft,
        recommendationIds: commaListToNumberArray(draft.recommendationIdsText),
        snapshotIds: commaListToNumberArray(draft.snapshotIdsText),
        selectionFilters: {
          dateFrom: draft.dateFrom || undefined,
          dateTo: draft.dateTo || undefined,
          league: draft.league || undefined,
          marketFamily: draft.marketFamily || undefined,
          periodKind: draft.periodKind || undefined,
          result: draft.result || undefined,
          riskLevel: draft.riskLevel || undefined,
        },
      });
      setSelectedRunId(created.id);
      setRunItems([]);
      setShowItems(false);
      await onBootstrapRefresh();
      showToast('Replay run queued', 'success');
    } catch (err) {
      showToast(`Failed to start replay: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setSubmitting(false); }
  };

  const summary = selectedRun?.summary_json as Record<string, unknown> | null ?? null;
  const normalizedSummary = useMemo(() => {
    if (!summary) return null;
    return {
      pushRate: summary.pushRate,
      noBetRate: summary.noBetRate,
      underShare: summary.goalsUnderShare ?? summary.underShare,
      accuracy: summary.accuracy,
      avgOdds: summary.avgOdds,
      avgBreakEven: summary.avgBreakEvenRate ?? summary.avgBreakEven,
      totalStake: summary.totalStaked ?? summary.totalStake,
      pnl: summary.totalPnl ?? summary.pnl,
      roi: summary.roi,
    } as Record<string, unknown>;
  }, [summary]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Cost warning */}
      <InfoBanner>
        <strong>Real LLM — incurs cost.</strong> Replay calls the live model ({bootstrap.replayGuardrails.llmModel}). Limit: {bootstrap.replayGuardrails.maxItems} items per run. Start with a small batch of 3-5 settled recommendations to validate before running larger sets.
      </InfoBanner>

      <div className="studio-sidebar-grid-wide">
        {/* Run history sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PanelCard>
            <SectionHeader title="Replay Runs" />
            {bootstrap.replayRuns.length === 0 && <EmptyState message="No replay runs yet." />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {bootstrap.replayRuns.map((run) => {
                const st = formatReplayStatus(run.status);
                const isSelected = selectedRunId === run.id;
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => { setSelectedRunId(run.id); setRunItems([]); setShowItems(false); }}
                    style={{
                      textAlign: 'left', padding: '7px 10px', borderRadius: 6, border: 'none',
                      background: isSelected ? '#eff6ff' : 'transparent', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', gap: 2,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: isSelected ? 600 : 400, color: isSelected ? '#1d4ed8' : 'var(--gray-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {run.name}
                      </span>
                      <StatusBadge label={st.label} color={st.color} bg={st.bg} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                      {run.completed_items}/{run.total_items} items
                    </div>
                  </button>
                );
              })}
            </div>
          </PanelCard>
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Create new run */}
          <PanelCard>
            <SectionHeader title="New Replay Run" subtitle="Select a release or prompt+rule set to test, then choose which historical recommendations to replay." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <FormRow>
                <FieldLabel label="Run name">
                  <input value={draft.name} placeholder="e.g. Test v2 prompt on H1 goals" onChange={(e) => draft_update({ name: e.target.value })} />
                </FieldLabel>
                <FieldLabel label="Release (optional)">
                  <select value={draft.releaseId} onChange={(e) => draft_update({ releaseId: Number(e.target.value) })}>
                    <option value={0}>No release</option>
                    {bootstrap.releases.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </FieldLabel>
                <FieldLabel label="Prompt">
                  <select value={draft.promptTemplateId} onChange={(e) => draft_update({ promptTemplateId: Number(e.target.value) })}>
                    <option value={0}>Select prompt...</option>
                    {bootstrap.prompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </FieldLabel>
                <FieldLabel label="Rule set">
                  <select value={draft.ruleSetId} onChange={(e) => draft_update({ ruleSetId: Number(e.target.value) })}>
                    <option value={0}>Select rule set...</option>
                    {bootstrap.ruleSets.map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                  </select>
                </FieldLabel>
              </FormRow>

              <Divider />

              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Item Selection (explicit IDs or filters)</div>
              <FormRow>
                <FieldLabel label="Recommendation IDs">
                  <input value={draft.recommendationIdsText} placeholder="123, 124, 125" onChange={(e) => draft_update({ recommendationIdsText: e.target.value })} />
                </FieldLabel>
                <FieldLabel label="Snapshot IDs">
                  <input value={draft.snapshotIdsText} placeholder="88, 89" onChange={(e) => draft_update({ snapshotIdsText: e.target.value })} />
                </FieldLabel>
                <FieldLabel label="Date from">
                  <input type="date" value={draft.dateFrom} onChange={(e) => draft_update({ dateFrom: e.target.value })} />
                </FieldLabel>
                <FieldLabel label="Date to">
                  <input type="date" value={draft.dateTo} onChange={(e) => draft_update({ dateTo: e.target.value })} />
                </FieldLabel>
                <FieldLabel label="League">
                  <input value={draft.league} placeholder="e.g. Premier League" onChange={(e) => draft_update({ league: e.target.value })} />
                </FieldLabel>
                <FieldLabel label="Market family">
                  <select value={draft.marketFamily} onChange={(e) => draft_update({ marketFamily: e.target.value })}>
                    <option value="">Any market family</option>
                    {bootstrap.ruleMeta.marketFamilies.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </FieldLabel>
                <FieldLabel label="Period">
                  <select value={draft.periodKind} onChange={(e) => draft_update({ periodKind: e.target.value })}>
                    <option value="">Any period</option>
                    <option value="ft">Full-time</option>
                    <option value="h1">H1</option>
                  </select>
                </FieldLabel>
              </FormRow>

              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => void handleSubmit()}
                disabled={submitting}
              >
                {submitting ? 'Queuing...' : 'Run Replay With Real LLM'}
              </button>
            </div>
          </PanelCard>

          {/* Selected run detail */}
          {selectedRun && (
            <PanelCard>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-900)' }}>{selectedRun.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    {(() => { const st = formatReplayStatus(selectedRun.status); return <StatusBadge label={st.label} color={st.color} bg={st.bg} />; })()}
                    <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>{selectedRun.completed_items}/{selectedRun.total_items} items</span>
                    <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>{selectedRun.llm_model}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleRefresh()} disabled={refreshing}>
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void handleCancel()}
                    disabled={!['queued', 'running'].includes(selectedRun.status)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => { if (selectedRunId) void loadItems(selectedRunId); }}
                    disabled={itemsLoading}
                  >
                    {itemsLoading ? 'Loading...' : showItems ? 'Reload Items' : 'View Items'}
                  </button>
                  {showItems && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowItems(false)}>
                      Hide Items
                    </button>
                  )}
                </div>
              </div>

              {selectedRun.status === 'completed_with_errors' && (
                <WarningBanner>
                  Some items failed. Do not treat this as a clean validation. Review failed items before activation.
                </WarningBanner>
              )}

              {/* Summary metrics */}
              {normalizedSummary && Object.keys(normalizedSummary).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 8 }}>Summary Metrics</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6 }}>
                    {[
                      ['Push rate', normalizedSummary.pushRate],
                      ['No-bet rate', normalizedSummary.noBetRate],
                      ['Under share', normalizedSummary.underShare],
                      ['Accuracy', normalizedSummary.accuracy],
                      ['Avg odds', normalizedSummary.avgOdds],
                      ['Avg break-even', normalizedSummary.avgBreakEven],
                      ['Total stake', normalizedSummary.totalStake],
                      ['P/L', normalizedSummary.pnl],
                      ['ROI', normalizedSummary.roi],
                    ].map(([label, val]) => (
                      <ReplayMetricRow
                        key={String(label)}
                        label={String(label)}
                        value={val == null ? null : typeof val === 'number' ? val.toFixed(2) : String(val)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Case-level items */}
              {showItems && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 8 }}>
                    Case Deltas ({runItems.length} items)
                  </div>
                  {runItems.length === 0 && <EmptyState message="No items loaded yet." />}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {runItems.map((item) => {
                      const st = formatReplayStatus(item.status);
                      const decisionChanged = item.evaluation_json.decisionChanged;
                      const pnlDelta = item.evaluation_json.pnlDelta;
                      return (
                        <div
                          key={item.id}
                          style={{
                            border: `1px solid ${decisionChanged ? '#fde68a' : 'var(--gray-200)'}`,
                            borderRadius: 8, padding: 10,
                            background: decisionChanged ? '#fffbeb' : '#fff',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'monospace' }}>{item.source_ref}</span>
                            <StatusBadge label={st.label} color={st.color} bg={st.bg} />
                            {Boolean(decisionChanged) && <StatusBadge label="Decision changed" color="#92400e" bg="#fef3c7" />}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, color: 'var(--gray-600)' }}>
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--gray-400)', marginBottom: 2 }}>Original</div>
                              <div>{String(item.original_decision_json.originalSelection ?? 'n/a')} / {String(item.original_decision_json.originalBetMarket ?? 'n/a')}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--gray-400)', marginBottom: 2 }}>Replayed</div>
                              <div>{String(item.replayed_decision_json.selection ?? 'n/a')} / {String(item.replayed_decision_json.betMarket ?? 'n/a')}</div>
                            </div>
                          </div>
                          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--gray-500)' }}>
                            Decision changed: <strong>{String(decisionChanged ?? 'n/a')}</strong>
                            {' '}| P/L delta: <strong>{pnlDelta != null ? Number(pnlDelta).toFixed(2) : 'n/a'}</strong>
                          </div>
                          {item.error_message && (
                            <div style={{ marginTop: 4, fontSize: 11, color: '#b91c1c' }}>Error: {item.error_message}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </PanelCard>
          )}
        </div>
      </div>
    </div>
  );

  function draft_update(updates: Partial<typeof initDraft>) { setDraft(updates); }
}

// ── Releases Tab ─────────────────────────────────────────────────────────────

function ReleasesTab({
  bootstrap,
  config,
  onBootstrapRefresh,
}: {
  bootstrap: RecommendationStudioBootstrap;
  config: ReturnType<typeof useAppState>['state']['config'];
  onBootstrapRefresh: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const [selectedReleaseId, setSelectedReleaseId] = useState<number | null>(
    bootstrap.activeRelease?.id ?? bootstrap.releases[0]?.id ?? null,
  );
  const [releaseDiff, setReleaseDiff] = useState<Record<string, unknown> | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [activating, setActivating] = useState(false);
  const [createDraft, setCreateDraft] = useState({ name: '', promptTemplateId: 0, ruleSetId: 0, notes: '' });
  const [creating, setCreating] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  const selectedRelease = bootstrap.releases.find((r) => r.id === selectedReleaseId) ?? null;

  const handleActivate = async () => {
    if (!selectedReleaseId) return;
    setActivating(true);
    try {
      await activateRecommendationStudioRelease(config, selectedReleaseId);
      await onBootstrapRefresh();
      showToast('Release activated', 'success');
    } catch (err) {
      showToast(`Activation failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setActivating(false); }
  };

  const handleRollback = async () => {
    if (!selectedReleaseId) return;
    try {
      await rollbackRecommendationStudioRelease(config, selectedReleaseId);
      await onBootstrapRefresh();
      showToast('Rolled back', 'success');
    } catch (err) {
      showToast(`Rollback failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleCloneRollback = async () => {
    if (!selectedReleaseId) return;
    try {
      const cloned = await cloneRollbackRecommendationStudioRelease(config, selectedReleaseId);
      setSelectedReleaseId(cloned.id);
      await onBootstrapRefresh();
      showToast('Rollback clone created as new draft', 'success');
    } catch (err) {
      showToast(`Clone failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleDiff = async () => {
    if (!selectedReleaseId) return;
    try {
      const diff = await fetchRecommendationStudioReleaseDiff(config, selectedReleaseId, bootstrap.activeRelease?.id);
      setReleaseDiff(diff);
      setShowDiff(true);
    } catch (err) {
      showToast(`Diff failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleCreate = async () => {
    if (!createDraft.name || !createDraft.promptTemplateId || !createDraft.ruleSetId) {
      showToast('Name, prompt template, and rule set are required', 'error');
      return;
    }
    setCreating(true);
    try {
      const created = await createRecommendationStudioRelease(config, createDraft);
      setSelectedReleaseId(created.id);
      await onBootstrapRefresh();
      showToast('Release created', 'success');
      setCreateDraft({ name: '', promptTemplateId: 0, ruleSetId: 0, notes: '' });
    } catch (err) {
      showToast(`Create failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setCreating(false); }
  };

  const canActivate = selectedRelease?.replay_validation_status === 'validated';
  const isAlreadyActive = selectedRelease?.is_active === true;

  return (
    <div className="studio-sidebar-grid">
      {/* Sidebar */}
      <PanelCard>
        <SectionHeader title="Releases" />
        {bootstrap.releases.length === 0 && <EmptyState message="No releases yet. Create one below." />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {bootstrap.releases.map((r) => {
            const st = formatReleaseStatus(r.status, r.is_active);
            const isSelected = selectedReleaseId === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => { setSelectedReleaseId(r.id); setReleaseDiff(null); setShowDiff(false); }}
                style={{
                  textAlign: 'left', padding: '7px 10px', borderRadius: 6, border: 'none',
                  background: isSelected ? '#eff6ff' : 'transparent', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: isSelected ? 600 : 400, color: isSelected ? '#1d4ed8' : 'var(--gray-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}
                </span>
                <StatusBadge label={st.label} color={st.color} bg={st.bg} />
              </button>
            );
          })}
        </div>
      </PanelCard>

      {/* Right */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Create new release */}
        <PanelCard>
          <SectionHeader title="Create Release" subtitle="Bind a prompt template and rule set into a named release. Run replay before activating." />
          <FormRow>
            <FieldLabel label="Release name">
              <input
                value={createDraft.name}
                placeholder="e.g. v2-goals-discipline-apr"
                onChange={(e) => setCreateDraft({ ...createDraft, name: e.target.value })}
              />
            </FieldLabel>
            <FieldLabel label="Prompt template">
              <select value={createDraft.promptTemplateId} onChange={(e) => setCreateDraft({ ...createDraft, promptTemplateId: Number(e.target.value) })}>
                <option value={0}>Select prompt...</option>
                {bootstrap.prompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FieldLabel>
            <FieldLabel label="Rule set">
              <select value={createDraft.ruleSetId} onChange={(e) => setCreateDraft({ ...createDraft, ruleSetId: Number(e.target.value) })}>
                <option value={0}>Select rule set...</option>
                {bootstrap.ruleSets.map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
              </select>
            </FieldLabel>
            <FieldLabel label="Notes">
              <input
                value={createDraft.notes}
                placeholder="What changed in this release"
                onChange={(e) => setCreateDraft({ ...createDraft, notes: e.target.value })}
              />
            </FieldLabel>
          </FormRow>
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleCreate()} disabled={creating}>
              {creating ? 'Creating...' : 'Create Release'}
            </button>
          </div>
        </PanelCard>

        {/* Selected release detail */}
        {!selectedRelease && <PanelCard><EmptyState message="Select a release from the list." /></PanelCard>}

        {selectedRelease && (
          <PanelCard>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--gray-900)' }}>{selectedRelease.name}</span>
                {(() => { const st = formatReleaseStatus(selectedRelease.status, selectedRelease.is_active); return <StatusBadge label={st.label} color={st.color} bg={st.bg} />; })()}
                {(() => { const rv = formatReplayValidation(selectedRelease.replay_validation_status); return <span style={{ fontSize: 12, color: rv.color, fontWeight: 600 }}>{rv.label}</span>; })()}
              </div>
              {selectedRelease.notes && (
                <div style={{ fontSize: 12, color: 'var(--gray-600)', fontStyle: 'italic' }}>{selectedRelease.notes}</div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6, marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>
                <span style={{ fontWeight: 600, color: 'var(--gray-400)', fontSize: 10, textTransform: 'uppercase' }}>Prompt</span><br />
                {bootstrap.prompts.find((p) => p.id === selectedRelease.prompt_template_id)?.name ?? `ID ${selectedRelease.prompt_template_id}`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>
                <span style={{ fontWeight: 600, color: 'var(--gray-400)', fontSize: 10, textTransform: 'uppercase' }}>Rule set</span><br />
                {bootstrap.ruleSets.find((rs) => rs.id === selectedRelease.rule_set_id)?.name ?? `ID ${selectedRelease.rule_set_id}`}
              </div>
              {selectedRelease.activated_at && (
                <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--gray-400)', fontSize: 10, textTransform: 'uppercase' }}>Activated</span><br />
                  {new Date(selectedRelease.activated_at).toLocaleString()}
                </div>
              )}
            </div>

            {/* Activation readiness */}
            {!isAlreadyActive && (
              <div style={{ marginBottom: 12 }}>
                {!canActivate ? (
                  <WarningBanner>
                    <strong>Activation blocked.</strong> This release has not passed replay validation. Run replay and verify metrics before activating globally.
                  </WarningBanner>
                ) : (
                  <div style={{ padding: '8px 12px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 12, color: '#166534' }}>
                    Replay validation passed. Release is ready to activate.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!isAlreadyActive && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleActivate()}
                  disabled={!canActivate || activating}
                  title={!canActivate ? 'Replay validation required before activation' : undefined}
                >
                  {activating ? 'Activating...' : 'Activate Globally'}
                </button>
              )}
              {isAlreadyActive && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void handleRollback()}
                  title="Re-activate this release (effectively re-applies it)"
                >
                  Re-activate
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleCloneRollback()}>
                Clone as Draft
              </button>
              {!isAlreadyActive && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleRollback()} disabled={!canActivate}>
                  Rollback to This
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void handleDiff()}
                disabled={isAlreadyActive && !bootstrap.activeRelease}
              >
                Compare with Active
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAudit((v) => !v)}>
                {showAudit ? 'Hide Audit' : 'Audit Trail'}
              </button>
            </div>

            {/* Diff output */}
            {showDiff && releaseDiff && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Changes vs Active Release</div>
                {(releaseDiff as { promptChanged?: boolean; ruleSetChanged?: boolean }).promptChanged === false &&
                  (releaseDiff as { ruleSetChanged?: boolean }).ruleSetChanged === false ? (
                  <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>No differences detected.</div>
                ) : (
                  <>
                    {Array.isArray((releaseDiff as { promptSectionDiffs?: unknown[] }).promptSectionDiffs) && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Prompt Sections</div>
                        {((releaseDiff as { promptSectionDiffs?: Array<{ sectionKey: string; changeType: string }> }).promptSectionDiffs ?? []).length === 0
                          ? <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>No section changes.</div>
                          : (
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                              {((releaseDiff as { promptSectionDiffs?: Array<{ sectionKey: string; changeType: string }> }).promptSectionDiffs ?? []).map((e) => (
                                <li key={`${e.sectionKey}-${e.changeType}`} style={{ color: e.changeType === 'added' ? '#166534' : e.changeType === 'removed' ? '#b91c1c' : '#92400e' }}>
                                  {e.changeType.toUpperCase()}: {e.sectionKey}
                                </li>
                              ))}
                            </ul>
                          )}
                      </div>
                    )}
                    {Array.isArray((releaseDiff as { ruleDiffs?: unknown[] }).ruleDiffs) && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Rules</div>
                        {((releaseDiff as { ruleDiffs?: Array<{ ruleKey: string; changeType: string }> }).ruleDiffs ?? []).length === 0
                          ? <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>No rule changes.</div>
                          : (
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                              {((releaseDiff as { ruleDiffs?: Array<{ ruleKey: string; changeType: string }> }).ruleDiffs ?? []).map((e) => (
                                <li key={`${e.ruleKey}-${e.changeType}`} style={{ color: e.changeType === 'added' ? '#166534' : e.changeType === 'removed' ? '#b91c1c' : '#92400e' }}>
                                  {e.changeType.toUpperCase()}: {e.ruleKey}
                                </li>
                              ))}
                            </ul>
                          )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Audit trail */}
            {showAudit && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Recent Audit Trail</div>
                {bootstrap.auditLogs?.length
                  ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
                      {bootstrap.auditLogs.slice(0, 20).map((log) => (
                        <div key={log.id} style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, background: 'var(--gray-50)', border: '1px solid var(--gray-100)' }}>
                          <span style={{ fontWeight: 600, color: 'var(--gray-700)' }}>{log.action}</span>
                          {' '}<span style={{ color: 'var(--gray-500)' }}>{log.entity_type} #{log.entity_id}</span>
                          {' '}<span style={{ color: 'var(--gray-400)' }}>{new Date(log.created_at).toLocaleString()}</span>
                          {log.notes && <span style={{ color: 'var(--gray-500)', marginLeft: 4 }}>— {log.notes}</span>}
                        </div>
                      ))}
                    </div>
                  )
                  : <EmptyState message="No audit events recorded yet." />
                }
              </div>
            )}
          </PanelCard>
        )}
      </div>
    </div>
  );
}

// ── Root Panel ───────────────────────────────────────────────────────────────

export function RecommendationStudioPanel() {
  const { state } = useAppState();
  const { showToast } = useToast();
  const config = state.config;

  const [loading, setLoading] = useState(true);
  const [bootstrap, setBootstrap] = useState<RecommendationStudioBootstrap | null>(null);
  const [subTab, setSubTab] = useState<StudioSubTab>('prompts');

  const loadBootstrap = async () => {
    setLoading(true);
    try {
      const data = await fetchRecommendationStudioBootstrap(config);
      setBootstrap(data);
    } catch (err) {
      showToast(`Failed to load Recommendation Studio: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void loadBootstrap();
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !bootstrap) {
    return <div style={{ padding: 24, color: 'var(--gray-500)', fontSize: 13 }}>Loading Recommendation Studio...</div>;
  }

  if (!bootstrap) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorBanner>Failed to load Recommendation Studio. Check backend connectivity and try refreshing.</ErrorBanner>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Active release global status bar */}
      <ActiveReleaseBar activeRelease={bootstrap.activeRelease} />

      {/* Tab navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {studioSubTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={subTab === tab.id}
            className={`btn ${subTab === tab.id ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setSubTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => void loadBootstrap()}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Tab content */}
      {subTab === 'prompts' && (
        <PromptTab bootstrap={bootstrap} config={config} onBootstrapRefresh={loadBootstrap} />
      )}
      {subTab === 'rules' && (
        <RulesTab bootstrap={bootstrap} config={config} onBootstrapRefresh={loadBootstrap} />
      )}
      {subTab === 'replays' && (
        <ReplayTab bootstrap={bootstrap} config={config} onBootstrapRefresh={loadBootstrap} />
      )}
      {subTab === 'releases' && (
        <ReleasesTab bootstrap={bootstrap} config={config} onBootstrapRefresh={loadBootstrap} />
      )}
    </div>
  );
}
