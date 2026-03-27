import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { formatLocalDate } from '@/lib/utils/helpers';
import type { League, LeagueProfile, LeagueTier, LeagueProfileData } from '@/types';
import {
  buildLeagueProfileDeepResearchPrompt,
  DEFAULT_LEAGUE_PROFILE_DRAFT,
  parseImportedLeagueProfile,
  summarizeDraft,
  type ImportFieldResult,
  type LeagueProfileDraft,
  type ParseImportResult,
} from '@/lib/utils/leagueProfileDeepResearch';

// ── Tier definitions ─────────────────────────────────────────────────────────

const TIERS: LeagueTier[] = ['low', 'balanced', 'high'];
const TIER_COLORS: Record<LeagueTier, string> = {
  low:      '#3b82f6',
  balanced: '#10b981',
  high:     '#f59e0b',
};
const TIER_LABELS: Record<LeagueTier, string> = {
  low:      'Low',
  balanced: 'Balanced',
  high:     'High',
};

// ── TierSlider component ─────────────────────────────────────────────────────

function TierSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: LeagueTier;
  onChange: (v: LeagueTier) => void;
}) {
  const idx = TIERS.indexOf(value);
  const color = TIER_COLORS[value];
  const fillPct = (idx / (TIERS.length - 1)) * 100;

  return (
    <div className="tier-slider">
      <div className="tier-slider-header">
        <span className="tier-slider-label">{label}</span>
        <span
          className="tier-slider-badge"
          style={{ background: color + '20', color, border: `1px solid ${color}40` }}
        >
          {TIER_LABELS[value]}
        </span>
      </div>
      <div className="tier-slider-track">
        <input
          type="range"
          min={0}
          max={2}
          step={1}
          value={idx}
          onChange={(e) => onChange(TIERS[parseInt(e.target.value)]!)}
          style={{
            '--slider-color': color,
            '--slider-fill': `${fillPct}%`,
          } as React.CSSProperties}
          aria-label={label}
        />
        <div className="tier-slider-labels">
          {TIERS.map((t) => (
            <span
              key={t}
              style={{ color: t === value ? color : undefined, fontWeight: t === value ? 700 : 400 }}
            >
              {TIER_LABELS[t]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── StatInput component ──────────────────────────────────────────────────────

function parseNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function toInputValue(value: number | null): string {
  return value == null ? '' : String(value);
}

function toLeagueProfileDraft(profile: LeagueProfile): LeagueProfileDraft {
  const next = { ...profile } as LeagueProfileDraft & Partial<LeagueProfile>;
  delete next.league_id;
  delete next.created_at;
  delete next.updated_at;
  return next;
}

function getInitialDraft(profile: LeagueProfile | null): LeagueProfileDraft {
  return profile ? toLeagueProfileDraft(profile) : DEFAULT_LEAGUE_PROFILE_DRAFT;
}

function StatInput({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
        {hint && <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>{hint}</span>}
      </div>
      <input
        className="filter-input"
        type="number"
        step="0.01"
        min="0"
        value={toInputValue(value)}
        onChange={(e) => onChange(parseNullableNumber(e.target.value))}
        style={{ fontSize: 13, padding: '6px 8px' }}
      />
    </label>
  );
}

// ── Section header ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px',
      color: 'var(--gray-400)', borderBottom: '1px solid var(--gray-100)',
      paddingBottom: 6, marginBottom: 2,
    }}>
      {children}
    </div>
  );
}

// ── Inner tab bar ────────────────────────────────────────────────────────────

type InnerTab = 'profile' | 'research';

function InnerTabBar({ active, onChange }: { active: InnerTab; onChange: (t: InnerTab) => void }) {
  const tabs: { id: InnerTab; label: string }[] = [
    { id: 'profile',  label: 'Profile Data' },
    { id: 'research', label: 'Deep Research' },
  ];
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--gray-200)', marginBottom: 16 }}>
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            style={{
              padding: '7px 16px', fontSize: 13, fontWeight: isActive ? 600 : 400,
              color: isActive ? '#2563eb' : 'var(--gray-500)',
              background: 'none', border: 'none',
              borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer', marginBottom: -1, transition: 'color 0.15s',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Wizard step indicator ────────────────────────────────────────────────────

const WIZARD_STEPS = ['Copy Prompt', 'Paste JSON', 'Review & Apply'];

function WizardSteps({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
      {WIZARD_STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} style={{ display: 'flex', alignItems: 'flex-start', flex: i < WIZARD_STEPS.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: done ? '#2563eb' : active ? '#eff6ff' : 'var(--gray-100)',
                color: done ? 'white' : active ? '#2563eb' : 'var(--gray-400)',
                border: `2px solid ${done ? '#2563eb' : active ? '#2563eb' : 'var(--gray-200)'}`,
                flexShrink: 0,
              }}>
                {done ? '✓' : step}
              </div>
              <div style={{ fontSize: 10, fontWeight: active ? 700 : 400, color: active ? '#2563eb' : done ? '#2563eb' : 'var(--gray-400)', whiteSpace: 'nowrap' }}>
                {label}
              </div>
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? '#2563eb' : 'var(--gray-200)', marginTop: 13, marginLeft: 4, marginRight: 4 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Import summary table ─────────────────────────────────────────────────────

function ImportSummaryGrid({ fields }: { fields: ImportFieldResult[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
      {fields.map((f) => (
        <div key={f.label} style={{
          padding: '7px 10px', borderRadius: 6,
          border: `1px solid ${f.status === 'set' ? '#bbf7d0' : 'var(--gray-200)'}`,
          background: f.status === 'set' ? '#f0fdf4' : 'var(--gray-50)',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: f.status === 'set' ? '#166534' : 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            {f.label}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: f.status === 'set' ? '#15803d' : 'var(--gray-300)' }}>
            {f.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

interface LeagueProfileModalProps {
  league:   League | null;
  profile:  LeagueProfile | null;
  loading:  boolean;
  saving:   boolean;
  onClose:  () => void;
  onSave:   (draft: LeagueProfileDraft) => void;
  onDelete: () => void;
}

// ── Main component ───────────────────────────────────────────────────────────

export function LeagueProfileModal({
  league,
  profile,
  loading,
  saving,
  onClose,
  onSave,
  onDelete,
}: LeagueProfileModalProps) {
  const [draft, setDraft] = useState<LeagueProfileDraft>(() => getInitialDraft(profile));
  const [innerTab, setInnerTab] = useState<InnerTab>('profile');
  const [copyStatus, setCopyStatus] = useState('');
  const [importSuccess, setImportSuccess] = useState('');

  // Wizard state
  const [wizardStep, setWizardStep] = useState(1);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [parsedResult, setParsedResult] = useState<ParseImportResult | null>(null);

  const promptTemplate = league ? buildLeagueProfileDeepResearchPrompt(league) : '';

  async function handleCopyPrompt() {
    if (!promptTemplate) return;
    try {
      await navigator.clipboard.writeText(promptTemplate);
      setCopyStatus('Copied!');
      setTimeout(() => setCopyStatus(''), 2500);
    } catch {
      setCopyStatus('Copy failed');
    }
  }

  function handleValidateJson() {
    if (!league) return;
    try {
      const result = parseImportedLeagueProfile(importText, league);
      setParsedResult(result);
      setImportError('');
      setWizardStep(3);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to parse JSON');
      setParsedResult(null);
    }
  }

  function handleApplyImport() {
    if (!parsedResult) return;
    setDraft(parsedResult.draft);
    setImportSuccess(`Profile data applied from Deep Research — ${summarizeDraft(parsedResult.draft).filter((f) => f.status === 'set').length} fields populated.`);
    setInnerTab('profile');
    setWizardStep(1);
    setImportText('');
    setParsedResult(null);
    setImportError('');
  }

  function setProfileField<K extends keyof LeagueProfileData>(key: K, value: LeagueProfileData[K]) {
    setDraft((prev) => ({ ...prev, profile: { ...prev.profile, [key]: value } }));
  }

  const footer = (
    <>
      {profile && (
        <button className="btn btn-danger" onClick={onDelete} disabled={saving}>
          Delete
        </button>
      )}
      <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
        Close
      </button>
      <button
        className="btn btn-primary"
        onClick={() => onSave(draft)}
        disabled={saving || loading || !league}
      >
        {saving ? 'Saving…' : profile ? 'Update Profile' : 'Create Profile'}
      </button>
    </>
  );

  return (
    <Modal
      open={!!league}
      title={league ? `League Profile — ${league.league_name}` : 'League Profile'}
      onClose={onClose}
      size="lg"
      footer={footer}
    >
      {!league ? null : loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-500)' }}>
          Loading…
        </div>
      ) : (
        <div>
          {/* League info strip */}
          <div style={{
            display: 'grid', gridTemplateColumns: `repeat(${profile ? 4 : 3}, minmax(0, 1fr))`, gap: 8,
            marginBottom: 16,
          }}>
            {[
              { label: 'League',      value: league.league_name },
              { label: 'Country',     value: league.country || '—' },
              { label: 'Tier / Type', value: `${league.tier} / ${league.type}` },
              ...(profile ? [{ label: 'Last Updated', value: formatLocalDate(profile.updated_at) }] : []),
            ].map(({ label, value }) => (
              <div key={label} style={{
                padding: '8px 12px', borderRadius: 8,
                border: '1px solid var(--gray-200)', background: 'var(--gray-50)',
              }}>
                <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-900)' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Inner tabs */}
          <InnerTabBar active={innerTab} onChange={(t) => { setInnerTab(t); setImportSuccess(''); }} />

          {/* ── Profile Data tab ── */}
          {innerTab === 'profile' && (
            <div style={{ display: 'grid', gap: 20 }}>

              {importSuccess && (
                <div style={{
                  padding: '8px 12px', borderRadius: 6,
                  background: '#f0fdf4', border: '1px solid #bbf7d0',
                  fontSize: 12, color: '#166534',
                }}>
                  ✓ {importSuccess}
                </div>
              )}

              {/* Qualitative tiers — sliders */}
              <div style={{ display: 'grid', gap: 14 }}>
                <SectionLabel>Qualitative</SectionLabel>
                <div className="profile-stat-grid">
                  <TierSlider label="Tempo"            value={draft.profile.tempo_tier}            onChange={(v) => setProfileField('tempo_tier', v)} />
                  <TierSlider label="Goal Tendency"    value={draft.profile.goal_tendency}         onChange={(v) => setProfileField('goal_tendency', v)} />
                  <TierSlider label="Home Advantage"   value={draft.profile.home_advantage_tier}   onChange={(v) => setProfileField('home_advantage_tier', v)} />
                  <TierSlider label="Corners"          value={draft.profile.corners_tendency}      onChange={(v) => setProfileField('corners_tendency', v)} />
                  <TierSlider label="Cards"            value={draft.profile.cards_tendency}        onChange={(v) => setProfileField('cards_tendency', v)} />
                  <TierSlider label="Volatility"       value={draft.profile.volatility_tier}       onChange={(v) => setProfileField('volatility_tier', v)} />
                  <TierSlider label="Data Reliability" value={draft.profile.data_reliability_tier} onChange={(v) => setProfileField('data_reliability_tier', v)} />
                </div>
              </div>

              {/* Quantitative stats */}
              <div style={{ display: 'grid', gap: 14 }}>
                <SectionLabel>Statistics</SectionLabel>
                <div className="profile-stat-grid">
                  <StatInput label="Avg Goals"     hint="per match"  value={draft.profile.avg_goals}            onChange={(v) => setProfileField('avg_goals', v)} />
                  <StatInput label="Over 2.5 Rate" hint="%"          value={draft.profile.over_2_5_rate}        onChange={(v) => setProfileField('over_2_5_rate', v)} />
                  <StatInput label="BTTS Rate"     hint="%"          value={draft.profile.btts_rate}            onChange={(v) => setProfileField('btts_rate', v)} />
                  <StatInput label="Late Goal 75+" hint="%"          value={draft.profile.late_goal_rate_75_plus} onChange={(v) => setProfileField('late_goal_rate_75_plus', v)} />
                  <StatInput label="Avg Corners"   hint="per match"  value={draft.profile.avg_corners}          onChange={(v) => setProfileField('avg_corners', v)} />
                  <StatInput label="Avg Cards"     hint="per match"  value={draft.profile.avg_cards}            onChange={(v) => setProfileField('avg_cards', v)} />
                </div>
              </div>

              {/* Notes */}
              <div style={{ display: 'grid', gap: 14 }}>
                <SectionLabel>Notes</SectionLabel>
                <div className="profile-notes-grid">
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>English</span>
                    <textarea
                      rows={4}
                      className="filter-input"
                      value={draft.notes_en}
                      onChange={(e) => setDraft((prev) => ({ ...prev, notes_en: e.target.value }))}
                      style={{ resize: 'vertical', fontSize: 12 }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tiếng Việt</span>
                    <textarea
                      rows={4}
                      className="filter-input"
                      value={draft.notes_vi}
                      onChange={(e) => setDraft((prev) => ({ ...prev, notes_vi: e.target.value }))}
                      style={{ resize: 'vertical', fontSize: 12 }}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ── Deep Research tab (Wizard) ── */}
          {innerTab === 'research' && (
            <div style={{ display: 'grid', gap: 16 }}>
              <WizardSteps current={wizardStep} />

              {/* Step 1: Copy Prompt */}
              {wizardStep === 1 && (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: '#eff6ff', border: '1px solid #bfdbfe',
                    fontSize: 12, color: '#1e40af', lineHeight: 1.6,
                  }}>
                    <strong>How to use:</strong> Copy the prompt below and paste it into{' '}
                    <strong>Google AI Studio → Deep Research</strong> (or Gemini / ChatGPT Deep Research).
                    Let it research the league and return a JSON response, then continue to the next step.
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={handleCopyPrompt}
                      style={{ minWidth: 130 }}
                    >
                      {copyStatus || '📋 Copy Prompt'}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    rows={14}
                    className="filter-input"
                    value={promptTemplate}
                    aria-label="Deep Research Prompt Template"
                    style={{ fontSize: 11, fontFamily: 'monospace', resize: 'vertical', background: 'var(--gray-50)' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => setWizardStep(2)}
                    >
                      I've got the JSON result →
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Paste JSON */}
              {wizardStep === 2 && (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: '#eff6ff', border: '1px solid #bfdbfe',
                    fontSize: 12, color: '#1e40af', lineHeight: 1.6,
                  }}>
                    Paste the JSON returned by the Deep Research tool. We'll automatically repair minor formatting issues before parsing.
                  </div>
                  <textarea
                    rows={14}
                    className="filter-input"
                    value={importText}
                    onChange={(e) => {
                      setImportText(e.target.value);
                      if (importError) setImportError('');
                    }}
                    placeholder='Paste the JSON response here…'
                    aria-label="Import League Profile JSON"
                    style={{ fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }}
                  />
                  {importError && (
                    <div style={{
                      padding: '8px 12px', borderRadius: 6,
                      background: '#fef2f2', border: '1px solid #fecaca',
                      fontSize: 12, color: '#b91c1c',
                    }}>
                      ✗ {importError}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => { setWizardStep(1); setImportError(''); }}
                    >
                      ← Back
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={handleValidateJson}
                      disabled={!importText.trim()}
                    >
                      Validate & Continue →
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Review & Apply */}
              {wizardStep === 3 && parsedResult && (
                <div style={{ display: 'grid', gap: 14 }}>
                  {parsedResult.repaired && (
                    <div style={{
                      padding: '8px 12px', borderRadius: 6,
                      background: '#fffbeb', border: '1px solid #fde68a',
                      fontSize: 12, color: '#92400e',
                    }}>
                      ⚡ Auto-repaired minor JSON issues (e.g. missing field values). Data below reflects the corrected result.
                    </div>
                  )}
                  <div>
                    <SectionLabel>Parsed Fields</SectionLabel>
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-500)', marginBottom: 10 }}>
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#bbf7d0', border: '1px solid #86efac', marginRight: 5 }} />
                      Green = value set by AI &nbsp;&nbsp;
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--gray-100)', border: '1px solid var(--gray-200)', marginRight: 5 }} />
                      Gray = using default
                    </div>
                    <ImportSummaryGrid fields={parsedResult.summary} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => { setWizardStep(2); setParsedResult(null); }}
                    >
                      ← Back
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={handleApplyImport}
                    >
                      ✓ Apply to Profile
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
