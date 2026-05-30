import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { formatLocalDate } from '@/lib/utils/helpers';
import type { TeamProfile, TeamProfileData } from '@/types';
import {
  buildTeamProfileDeepResearchPrompt,
  DEFAULT_TEAM_PROFILE_DRAFT,
  parseImportedTeamProfile,
  summarizeDraft,
  type ImportFieldResult,
  type TeamProfileDraft,
  type ParseImportResult,
} from '@/lib/utils/teamProfileDeepResearch';

// ── Tier option definitions ───────────────────────────────────────────────────

const ATTACK_STYLE_OPTIONS = [
  { value: 'counter',    label: 'Counter',    color: '#3b82f6' },
  { value: 'direct',     label: 'Direct',     color: '#f59e0b' },
  { value: 'possession', label: 'Possession', color: '#10b981' },
  { value: 'mixed',      label: 'Mixed',      color: '#6b7280' },
] as const;

const TIER3_OPTIONS = [
  { value: 'low',    label: 'Low',    color: '#3b82f6' },
  { value: 'medium', label: 'Medium', color: '#f59e0b' },
  { value: 'high',   label: 'High',   color: '#ef4444' },
] as const;

const HOME_STRENGTH_OPTIONS = [
  { value: 'weak',   label: 'Weak',   color: '#6b7280' },
  { value: 'normal', label: 'Normal', color: '#3b82f6' },
  { value: 'strong', label: 'Strong', color: '#ef4444' },
] as const;

const FORM_CONSISTENCY_OPTIONS = [
  { value: 'volatile',     label: 'Volatile',     color: '#ef4444' },
  { value: 'inconsistent', label: 'Inconsistent', color: '#f59e0b' },
  { value: 'consistent',   label: 'Consistent',   color: '#10b981' },
] as const;

const SQUAD_DEPTH_OPTIONS = [
  { value: 'shallow', label: 'Shallow', color: '#ef4444' },
  { value: 'medium',  label: 'Medium',  color: '#f59e0b' },
  { value: 'deep',    label: 'Deep',    color: '#10b981' },
] as const;

const RELIABILITY_OPTIONS = [
  { value: 'low',    label: 'Low',    color: '#ef4444' },
  { value: 'medium', label: 'Medium', color: '#f59e0b' },
  { value: 'high',   label: 'High',   color: '#10b981' },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseNullableNumber(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toInputValue(v: number | null): string {
  return v == null ? '' : String(v);
}

function getInitialDraft(profile: TeamProfile | null): TeamProfileDraft {
  if (!profile) return { ...DEFAULT_TEAM_PROFILE_DRAFT };
  return {
    profile: profile.profile,
    notes_en: profile.notes_en,
    notes_vi: profile.notes_vi,
    overlay_metadata: {
      source_mode: profile.tactical_overlay_source_mode ?? 'default_neutral',
      source_confidence: profile.tactical_overlay_source_confidence ?? null,
      source_urls: profile.tactical_overlay_source_urls ?? [],
      source_season: profile.tactical_overlay_source_season ?? null,
    },
  };
}

// ── Shared option type ────────────────────────────────────────────────────────

type TierOption = { value: string; label: string; color: string };

// ── TierSegment — buttons, used only for categorical (non-ordinal) fields ─────

function TierSegment({ label, options, value, onChange }: {
  label: string; options: readonly TierOption[]; value: string; onChange: (v: string) => void;
}) {
  const active = options.find((o) => o.value === value);
  return (
    <div className="tier-segment">
      <div className="tier-segment__head">
        <span className="tier-slider-label">{label}</span>
        {active && (
          <span
            className="tier-slider-badge"
            style={{ background: active.color + '20', color: active.color, border: `1px solid ${active.color}40` }}
          >
            {active.label}
          </span>
        )}
      </div>
      <div className="tier-segment__buttons">
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              title={opt.label}
              className={`tier-segment-btn${isActive ? ' tier-segment-btn--active' : ''}`}
              style={isActive ? ({ '--tier-color': opt.color } as React.CSSProperties) : undefined}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── TierSlider — range input, used for ordinal 3-level fields ─────────────────

function TierSlider({ label, options, value, onChange }: {
  label: string; options: readonly TierOption[]; value: string; onChange: (v: string) => void;
}) {
  const idx = options.findIndex((o) => o.value === value);
  const safeIdx = idx >= 0 ? idx : 0;
  const color = options[safeIdx]?.color ?? '#10b981';
  const fillPct = options.length > 1 ? (safeIdx / (options.length - 1)) * 100 : 50;

  return (
    <div className="tier-slider">
      <div className="tier-slider-header">
        <span className="tier-slider-label">{label}</span>
        <span
          className="tier-slider-badge"
          style={{ background: color + '20', color, border: `1px solid ${color}40` }}
        >
          {options[safeIdx]?.label}
        </span>
      </div>
      <div className="tier-slider-track">
        <input
          type="range"
          min={0}
          max={options.length - 1}
          step={1}
          value={safeIdx}
          onChange={(e) => onChange(options[parseInt(e.target.value)]!.value)}
          style={{ '--slider-color': color, '--slider-fill': `${fillPct}%` } as React.CSSProperties}
          aria-label={label}
        />
        <div className="tier-slider-labels">
          {options.map((o) => (
            <span
              key={o.value}
              style={{ color: o.value === value ? color : undefined, fontWeight: o.value === value ? 700 : 400 }}
            >
              {o.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── StatInput ────────────────────────────────────────────────────────────────

function StatInput({ label, hint, value, onChange }: {
  label: string; hint?: string; value: number | null; onChange: (v: number | null) => void;
}) {
  return (
    <label className="profile-stat-input">
      <div className="profile-stat-input__head">
        <span className="profile-stat-input__label">{label}</span>
        {hint && <span className="profile-stat-input__hint">{hint}</span>}
      </div>
      <input
        className="filter-input"
        type="number"
        step="0.01"
        min="0"
        value={toInputValue(value)}
        onChange={(e) => onChange(parseNullableNumber(e.target.value))}
      />
    </label>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="profile-section-label">{children}</div>;
}

// ── Inner tabs ────────────────────────────────────────────────────────────────

type InnerTab = 'profile' | 'research';

function InnerTabBar({ active, onChange }: { active: InnerTab; onChange: (t: InnerTab) => void }) {
  const tabs: { id: InnerTab; label: string }[] = [
    { id: 'profile',  label: 'Profile Data' },
    { id: 'research', label: 'Tactical Overlay Research' },
  ];
  return (
    <div className="modal-inner-tab-bar" role="tablist">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`modal-inner-tab-button${isActive ? ' modal-inner-tab-button--active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Wizard step indicator ─────────────────────────────────────────────────────

const WIZARD_STEPS = ['Copy Prompt', 'Paste JSON', 'Review & Apply'];

function WizardSteps({ current }: { current: number }) {
  return (
    <div className="wizard-steps">
      {WIZARD_STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} className="wizard-step">
            <div className="wizard-step__node">
              <div className={`wizard-step__circle${done ? ' wizard-step__circle--done' : active ? ' wizard-step__circle--active' : ''}`}>
                {done ? '✓' : step}
              </div>
              <span className={`wizard-step__label${done ? ' wizard-step__label--done' : active ? ' wizard-step__label--active' : ''}`}>
                {label}
              </span>
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div className={`wizard-step__connector${done ? ' wizard-step__connector--done' : ''}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Import result review ──────────────────────────────────────────────────────

function ImportReview({ summary, repaired }: { summary: ImportFieldResult[]; repaired: boolean }) {
  const setCount = summary.filter((r) => r.status === 'set').length;
  return (
    <div>
      {repaired && (
        <div className="import-review-banner">
          JSON had formatting issues and was auto-repaired before parsing.
        </div>
      )}
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
        <strong style={{ color: '#10b981' }}>{setCount}</strong> of {summary.length} fields set automatically
        {' · '}{summary.length - setCount} using defaults
      </div>
      <div className="import-review-grid">
        {summary.map((r) => (
          <div key={r.label} className="import-review-row">
            <span className="text-muted" style={{ fontSize: 11 }}>{r.label}</span>
            <span style={{ fontWeight: 600, color: r.status === 'set' ? '#10b981' : 'var(--gray-300)', fontSize: 11 }}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Profile data form ─────────────────────────────────────────────────────────

function ProfileForm({
  draft,
  onChange,
}: {
  draft: TeamProfileDraft;
  onChange: (d: TeamProfileDraft) => void;
}) {
  const p = draft.profile;
  const setP = (patch: Partial<TeamProfileData>) =>
    onChange({ ...draft, profile: { ...p, ...patch } });

  return (
    <div className="profile-form-stack">
      <div className="profile-form-section">
        <SectionLabel>Tactical Identity</SectionLabel>
        <TierSegment label="Attack Style"       options={ATTACK_STYLE_OPTIONS}    value={p.attack_style}       onChange={(v) => setP({ attack_style: v as TeamProfileData['attack_style'] })} />
        <TierSlider  label="Defensive Line"     options={TIER3_OPTIONS}            value={p.defensive_line}     onChange={(v) => setP({ defensive_line: v as TeamProfileData['defensive_line'] })} />
        <TierSlider  label="Pressing Intensity" options={TIER3_OPTIONS}            value={p.pressing_intensity} onChange={(v) => setP({ pressing_intensity: v as TeamProfileData['pressing_intensity'] })} />
        <TierSlider  label="Set Piece Threat"   options={TIER3_OPTIONS}            value={p.set_piece_threat}   onChange={(v) => setP({ set_piece_threat: v as TeamProfileData['set_piece_threat'] })} />
      </div>

      <div className="profile-form-section">
        <SectionLabel>Results Profile</SectionLabel>
        <TierSlider  label="Home Strength"      options={HOME_STRENGTH_OPTIONS}    value={p.home_strength}      onChange={(v) => setP({ home_strength: v as TeamProfileData['home_strength'] })} />
        <TierSlider  label="Form Consistency"   options={FORM_CONSISTENCY_OPTIONS} value={p.form_consistency}   onChange={(v) => setP({ form_consistency: v as TeamProfileData['form_consistency'] })} />
        <TierSlider  label="Squad Depth"        options={SQUAD_DEPTH_OPTIONS}      value={p.squad_depth}        onChange={(v) => setP({ squad_depth: v as TeamProfileData['squad_depth'] })} />
        <TierSlider  label="Data Reliability"   options={RELIABILITY_OPTIONS}      value={p.data_reliability_tier} onChange={(v) => setP({ data_reliability_tier: v as TeamProfileData['data_reliability_tier'] })} />
      </div>

      <div className="profile-form-section">
        <SectionLabel>Goals (per match)</SectionLabel>
        <div className="profile-stat-grid">
          <StatInput label="Scored"       hint="/90"  value={p.avg_goals_scored}   onChange={(v) => setP({ avg_goals_scored: v })} />
          <StatInput label="Conceded"     hint="/90"  value={p.avg_goals_conceded} onChange={(v) => setP({ avg_goals_conceded: v })} />
          <StatInput label="Clean Sheet"  hint="%"    value={p.clean_sheet_rate}   onChange={(v) => setP({ clean_sheet_rate: v })} />
          <StatInput label="BTTS"         hint="%"    value={p.btts_rate}          onChange={(v) => setP({ btts_rate: v })} />
          <StatInput label="Over 2.5"     hint="%"    value={p.over_2_5_rate}      onChange={(v) => setP({ over_2_5_rate: v })} />
          <StatInput label="First Goal"   hint="%"    value={p.first_goal_rate}    onChange={(v) => setP({ first_goal_rate: v })} />
          <StatInput label="Late Goal"    hint="≥76%" value={p.late_goal_rate}     onChange={(v) => setP({ late_goal_rate: v })} />
        </div>
      </div>

      <div className="profile-form-section">
        <SectionLabel>Corners & Discipline</SectionLabel>
        <div className="profile-stat-grid">
          <StatInput label="Corners For"     hint="/90" value={p.avg_corners_for}     onChange={(v) => setP({ avg_corners_for: v })} />
          <StatInput label="Corners Against" hint="/90" value={p.avg_corners_against} onChange={(v) => setP({ avg_corners_against: v })} />
          <StatInput label="Cards"           hint="/90" value={p.avg_cards}           onChange={(v) => setP({ avg_cards: v })} />
        </div>
      </div>

      <div className="profile-form-section">
        <SectionLabel>Analyst Notes</SectionLabel>
        <label className="profile-notes-field">
          <span className="profile-stat-input__label">English</span>
          <textarea
            className="profile-textarea"
            value={draft.notes_en}
            onChange={(e) => onChange({ ...draft, notes_en: e.target.value })}
            rows={3}
            placeholder="Key betting considerations: home/away splits, set-piece danger, fatigue patterns, rivalry effects…"
          />
        </label>
        <label className="profile-notes-field">
          <span className="profile-stat-input__label">Tiếng Việt</span>
          <textarea
            className="profile-textarea"
            value={draft.notes_vi}
            onChange={(e) => onChange({ ...draft, notes_vi: e.target.value })}
            rows={3}
            placeholder="Ghi chú phân tích bằng tiếng Việt…"
          />
        </label>
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface TeamProfileModalProps {
  team: { id: string; name: string; logo?: string } | null;
  leagueName?: string;
  overlayEligible?: boolean;
  profile: TeamProfile | null;
  loading: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (teamId: string, draft: TeamProfileDraft) => Promise<void>;
  onDelete: (teamId: string) => Promise<void>;
}

export function TeamProfileModal({
  team, leagueName, overlayEligible = false, profile, loading, saving, onClose, onSave, onDelete,
}: TeamProfileModalProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>('profile');
  const [draft, setDraft] = useState<TeamProfileDraft>(() => getInitialDraft(profile));
  const [wizardStep, setWizardStep]     = useState(1);
  const [jsonInput, setJsonInput]       = useState('');
  const [parseResult, setParseResult]   = useState<ParseImportResult | null>(null);
  const [parseError, setParseError]     = useState('');
  const [copied, setCopied]             = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!team) return null;

  const hasProfile = profile != null;
  const { set, total } = summarizeDraft(draft);
  const prompt = buildTeamProfileDeepResearchPrompt(team.name, leagueName);

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); setWizardStep(2); }, 1200);
    });
  };

  const handleParseJson = () => {
    setParseError('');
    try {
      const result = parseImportedTeamProfile(jsonInput, team.name, draft);
      setParseResult(result);
      setWizardStep(3);
    } catch (err) {
      setParseError((err as Error).message);
    }
  };

  const handleApplyImport = () => {
    if (!parseResult) return;
    setDraft(parseResult.draft);
    setInnerTab('profile');
    setWizardStep(1);
    setJsonInput('');
    setParseResult(null);
  };

  const handleSave = async () => {
    await onSave(team.id, draft);
  };

  const handleDelete = async () => {
    await onDelete(team.id);
    setConfirmDelete(false);
  };

  const titleStr = `Team Profile — ${team.name}${hasProfile ? ` (${set}/${total} fields)` : ''}`;

  return (
    <Modal
      open
      title={titleStr}
      onClose={onClose}
      size="lg"
      footer={
        <div className="modal-footer-split">
          <div>
            {hasProfile && !confirmDelete && (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete Profile</button>
            )}
            {confirmDelete && (
              <div className="modal-footer-actions">
                <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>Delete profile?</span>
                <button type="button" className="btn btn-danger btn-sm" onClick={handleDelete} disabled={saving}>Confirm</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            )}
          </div>
          <div className="modal-footer-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
              {saving ? 'Saving…' : hasProfile ? 'Update Profile' : 'Create Profile'}
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="loading-panel">
          <div className="loading-spinner" />
          <p>Loading profile…</p>
        </div>
      ) : (
        <>
          <div
            className="profile-info-strip"
            style={{
              gridTemplateColumns: `repeat(${
                [
                  true,
                  !!leagueName,
                  !!profile,
                  !!(profile && profile.tactical_overlay_source_mode && profile.tactical_overlay_source_mode !== 'default_neutral'),
                ].filter(Boolean).length
              }, minmax(0, 1fr))`,
            }}
          >
            {[
              { label: 'Team', value: team.name },
              ...(leagueName ? [{ label: 'League', value: leagueName }] : []),
              ...(profile ? [{ label: 'Last Updated', value: formatLocalDate(profile.updated_at) }] : []),
              ...(profile && profile.tactical_overlay_source_mode && profile.tactical_overlay_source_mode !== 'default_neutral'
                ? [{
                    label: 'Overlay Source',
                    value: [
                      profile.tactical_overlay_source_mode.replace(/_/g, ' '),
                      profile.tactical_overlay_source_confidence ? `(${profile.tactical_overlay_source_confidence})` : '',
                      profile.tactical_overlay_source_season ? `- ${profile.tactical_overlay_source_season}` : '',
                    ].filter(Boolean).join(' '),
                  }]
                : []),
            ].map(({ label, value }) => (
              <div key={label} className="profile-info-chip">
                <div className="profile-info-chip__label">{label}</div>
                <div className="profile-info-chip__value">{value}</div>
              </div>
            ))}
          </div>

          <InnerTabBar active={innerTab} onChange={(t) => { setInnerTab(t); setWizardStep(1); }} />

          {innerTab === 'profile' && (
            <ProfileForm draft={draft} onChange={setDraft} />
          )}

          {innerTab === 'research' && (
            <div>
              <WizardSteps current={wizardStep} />

              {wizardStep === 1 && (
                <div className="profile-form-section">
                  {!overlayEligible && (
                    <div className="alert-banner alert-banner--warning">
                      Tactical overlay refresh is intended for approved competition contexts only: top domestic leagues, continental club competitions, and major international tournaments or qualifiers. You can still review the prompt, but backend save validation may reject this context.
                    </div>
                  )}
                  <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                    Copy this prompt and paste it into a research assistant (ChatGPT Deep Research, Gemini, Perplexity, etc.) to generate a tactical overlay with source audit. Quantitative core metrics stay unchanged.
                  </p>
                  <pre className="code-block-pre">{prompt}</pre>
                  <button type="button" className="btn btn-primary" onClick={handleCopyPrompt} style={{ alignSelf: 'flex-start' }}>
                    {copied ? '✓ Copied!' : 'Copy Prompt'}
                  </button>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="profile-form-section">
                  <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                    Paste the JSON response from the research tool below. The expected contract is versioned and target-specific so it stays aligned with the tactical overlay schema.
                  </p>
                  <textarea
                    className={`code-block-textarea${parseError ? ' code-block-textarea--error' : ''}`}
                    value={jsonInput}
                    onChange={(e) => { setJsonInput(e.target.value); setParseError(''); }}
                    rows={12}
                    placeholder='{ "profile": { "attack_style": "counter", ... } }'
                  />
                  {parseError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{parseError}</p>}
                  <div className="modal-footer-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setWizardStep(1)}>← Back</button>
                    <button type="button" className="btn btn-primary" onClick={handleParseJson} disabled={!jsonInput.trim()}>
                      Parse JSON →
                    </button>
                  </div>
                </div>
              )}

              {wizardStep === 3 && parseResult && (
                <div className="profile-form-section">
                  {parseResult.warnings.length > 0 && (
                    <div className="alert-banner alert-banner--warning">
                      {parseResult.warnings.join(' ')}
                    </div>
                  )}
                  <ImportReview summary={parseResult.summary} repaired={parseResult.repaired} />
                  <div className="modal-footer-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setWizardStep(2)}>← Back</button>
                    <button type="button" className="btn btn-primary" onClick={handleApplyImport}>
                      Apply to Profile →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
