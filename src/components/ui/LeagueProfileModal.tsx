import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import type { League, LeagueProfile } from '@/types';
import {
  buildLeagueProfileDeepResearchPrompt,
  DEFAULT_LEAGUE_PROFILE_DRAFT,
  parseImportedLeagueProfile,
  type LeagueProfileDraft,
} from '@/lib/utils/leagueProfileDeepResearch';

// ── Tier option definitions ──────────────────────────────────────────────────

const TIER5_OPTIONS = [
  { value: 'very_low',  label: 'Very Low',  color: '#6b7280' },
  { value: 'low',       label: 'Low',        color: '#3b82f6' },
  { value: 'balanced',  label: 'Balanced',   color: '#10b981' },
  { value: 'high',      label: 'High',       color: '#f59e0b' },
  { value: 'very_high', label: 'Very High',  color: '#ef4444' },
] as const;

const TIER3_OPTIONS = [
  { value: 'low',    label: 'Low',    color: '#3b82f6' },
  { value: 'medium', label: 'Medium', color: '#f59e0b' },
  { value: 'high',   label: 'High',   color: '#ef4444' },
] as const;

const HOME_ADV_OPTIONS = [
  { value: 'low',    label: 'Low',    color: '#3b82f6' },
  { value: 'normal', label: 'Normal', color: '#10b981' },
  { value: 'high',   label: 'High',   color: '#ef4444' },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function toInputValue(value: number | null): string {
  return value == null ? '' : String(value);
}

// ── TierSegment component ────────────────────────────────────────────────────

type TierOption = { value: string; label: string; color: string };

function TierSegment({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly TierOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const active = options.find((o) => o.value === value);
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {label}
        </span>
        {active && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
            background: active.color + '20', color: active.color, border: `1px solid ${active.color}40`,
          }}>
            {active.label}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              title={opt.label}
              style={{
                flex: 1, padding: '5px 0', fontSize: 10, fontWeight: isActive ? 700 : 400,
                borderRadius: 5, border: `1px solid ${isActive ? opt.color : 'var(--gray-200)'}`,
                background: isActive ? opt.color + '18' : 'var(--gray-50)',
                color: isActive ? opt.color : 'var(--gray-400)',
                cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap', overflow: 'hidden',
              }}
            >
              {opt.label.replace('Very ', 'V.')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── StatInput component ──────────────────────────────────────────────────────

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

// ── Props ────────────────────────────────────────────────────────────────────

interface LeagueProfileModalProps {
  league: League | null;
  profile: LeagueProfile | null;
  loading: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: LeagueProfileDraft) => void;
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
  const [draft, setDraft] = useState<LeagueProfileDraft>(DEFAULT_LEAGUE_PROFILE_DRAFT);
  const [innerTab, setInnerTab] = useState<InnerTab>('profile');
  const [copyStatus, setCopyStatus] = useState('');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');

  useEffect(() => {
    if (!league) return;
    if (profile) {
      const { league_id: _leagueId, created_at: _createdAt, updated_at: _updatedAt, ...rest } = profile;
      setDraft(rest);
    } else {
      setDraft(DEFAULT_LEAGUE_PROFILE_DRAFT);
    }
    setImportText('');
    setImportError('');
    setImportSuccess('');
    setCopyStatus('');
    setInnerTab('profile');
  }, [league, profile]);

  const promptTemplate = league ? buildLeagueProfileDeepResearchPrompt(league) : '';

  async function handleCopyPrompt() {
    if (!promptTemplate) return;
    try {
      await navigator.clipboard.writeText(promptTemplate);
      setCopyStatus('Prompt copied!');
      setTimeout(() => setCopyStatus(''), 2500);
    } catch {
      setCopyStatus('Copy failed');
    }
  }

  function handleApplyImport() {
    if (!league) return;
    try {
      const imported = parseImportedLeagueProfile(importText, league);
      setDraft(imported);
      setImportError('');
      setImportSuccess('Profile data applied — review the fields below, then save.');
      setInnerTab('profile');
    } catch (err) {
      setImportSuccess('');
      setImportError(err instanceof Error ? err.message : 'Failed to import profile');
    }
  }

  function set<K extends keyof LeagueProfileDraft>(key: K, value: LeagueProfileDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
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
            display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8,
            marginBottom: 16,
          }}>
            {[
              { label: 'League',     value: league.league_name },
              { label: 'Country',    value: league.country || '—' },
              { label: 'Tier / Type', value: `${league.tier} / ${league.type}` },
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
          <InnerTabBar active={innerTab} onChange={setInnerTab} />

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

              {/* Qualitative tiers */}
              <div style={{ display: 'grid', gap: 14 }}>
                <SectionLabel>Qualitative</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
                  <TierSegment label="Tempo"         options={TIER5_OPTIONS}   value={draft.tempo_tier}          onChange={(v) => set('tempo_tier', v as LeagueProfileDraft['tempo_tier'])} />
                  <TierSegment label="Goal Tendency" options={TIER5_OPTIONS}   value={draft.goal_tendency}       onChange={(v) => set('goal_tendency', v as LeagueProfileDraft['goal_tendency'])} />
                  <TierSegment label="Home Advantage" options={HOME_ADV_OPTIONS} value={draft.home_advantage_tier} onChange={(v) => set('home_advantage_tier', v as LeagueProfileDraft['home_advantage_tier'])} />
                  <TierSegment label="Corners"       options={TIER5_OPTIONS}   value={draft.corners_tendency}    onChange={(v) => set('corners_tendency', v as LeagueProfileDraft['corners_tendency'])} />
                  <TierSegment label="Cards"         options={TIER5_OPTIONS}   value={draft.cards_tendency}      onChange={(v) => set('cards_tendency', v as LeagueProfileDraft['cards_tendency'])} />
                  <TierSegment label="Volatility"    options={TIER3_OPTIONS}   value={draft.volatility_tier}     onChange={(v) => set('volatility_tier', v as LeagueProfileDraft['volatility_tier'])} />
                  <TierSegment label="Data Reliability" options={TIER3_OPTIONS} value={draft.data_reliability_tier} onChange={(v) => set('data_reliability_tier', v as LeagueProfileDraft['data_reliability_tier'])} />
                </div>
              </div>

              {/* Quantitative stats */}
              <div style={{ display: 'grid', gap: 14 }}>
                <SectionLabel>Statistics</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                  <StatInput label="Avg Goals"      hint="per match"  value={draft.avg_goals}           onChange={(v) => set('avg_goals', v)} />
                  <StatInput label="Over 2.5 Rate"  hint="%"          value={draft.over_2_5_rate}       onChange={(v) => set('over_2_5_rate', v)} />
                  <StatInput label="BTTS Rate"       hint="%"          value={draft.btts_rate}           onChange={(v) => set('btts_rate', v)} />
                  <StatInput label="Late Goal 75+"   hint="%"          value={draft.late_goal_rate_75_plus} onChange={(v) => set('late_goal_rate_75_plus', v)} />
                  <StatInput label="Avg Corners"    hint="per match"  value={draft.avg_corners}         onChange={(v) => set('avg_corners', v)} />
                  <StatInput label="Avg Cards"      hint="per match"  value={draft.avg_cards}           onChange={(v) => set('avg_cards', v)} />
                </div>
              </div>

              {/* Notes */}
              <div style={{ display: 'grid', gap: 14 }}>
                <SectionLabel>Notes</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>English</span>
                    <textarea
                      rows={4}
                      className="filter-input"
                      value={draft.notes_en}
                      onChange={(e) => set('notes_en', e.target.value)}
                      style={{ resize: 'vertical', fontSize: 12 }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tiếng Việt</span>
                    <textarea
                      rows={4}
                      className="filter-input"
                      value={draft.notes_vi}
                      onChange={(e) => set('notes_vi', e.target.value)}
                      style={{ resize: 'vertical', fontSize: 12 }}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ── Deep Research tab ── */}
          {innerTab === 'research' && (
            <div style={{ display: 'grid', gap: 20 }}>

              {/* Prompt section */}
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <SectionLabel>Prompt Template</SectionLabel>
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    onClick={handleCopyPrompt}
                    style={{ flexShrink: 0 }}
                  >
                    {copyStatus || 'Copy Prompt'}
                  </button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.5 }}>
                  Copy this prompt and run it in <strong>Google AI Studio → Deep Research</strong> (or Gemini Deep Research).
                  Then paste the JSON response in the Import section below.
                </div>
                <textarea
                  readOnly
                  rows={12}
                  className="filter-input"
                  value={promptTemplate}
                  aria-label="Deep Research Prompt Template"
                  style={{ fontSize: 11, fontFamily: 'monospace', resize: 'vertical', background: 'var(--gray-50)' }}
                />
              </div>

              {/* Import section */}
              <div style={{ display: 'grid', gap: 10 }}>
                <SectionLabel>Import JSON Response</SectionLabel>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.5 }}>
                  Paste the strict JSON returned by Deep Research. The form fields will be populated automatically.
                </div>
                <textarea
                  rows={8}
                  className="filter-input"
                  value={importText}
                  onChange={(e) => {
                    setImportText(e.target.value);
                    if (importError) setImportError('');
                    if (importSuccess) setImportSuccess('');
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
                <div>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={handleApplyImport}
                    disabled={!importText.trim()}
                  >
                    Apply Import
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
