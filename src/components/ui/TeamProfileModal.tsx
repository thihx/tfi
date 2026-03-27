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
            <button key={opt.value} type="button" onClick={() => onChange(opt.value)} title={opt.label}
              style={{
                flex: 1, padding: '5px 2px', fontSize: 10, fontWeight: isActive ? 700 : 400,
                borderRadius: 5, border: `1px solid ${isActive ? opt.color : 'var(--gray-200)'}`,
                background: isActive ? opt.color + '18' : 'var(--gray-50)',
                color: isActive ? opt.color : 'var(--gray-400)',
                cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px',
      color: 'var(--gray-400)', borderBottom: '1px solid var(--gray-100)', paddingBottom: 6, marginBottom: 2,
    }}>
      {children}
    </div>
  );
}

// ── Inner tabs ────────────────────────────────────────────────────────────────

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
          <button key={t.id} type="button" onClick={() => onChange(t.id)}
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

// ── Wizard step indicator ─────────────────────────────────────────────────────

const WIZARD_STEPS = ['Copy Prompt', 'Paste JSON', 'Review & Apply'];

function WizardSteps({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
      {WIZARD_STEPS.map((label, i) => {
        const step = i + 1;
        const done   = step < current;
        const active = step === current;
        return (
          <div key={step} style={{ display: 'flex', alignItems: 'flex-start', flex: i < WIZARD_STEPS.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: done ? '#10b981' : active ? '#2563eb' : 'var(--gray-100)',
                color: done || active ? '#fff' : 'var(--gray-400)',
              }}>
                {done ? '✓' : step}
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: active ? '#2563eb' : done ? '#10b981' : 'var(--gray-400)', whiteSpace: 'nowrap' }}>
                {label}
              </span>
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? '#10b981' : 'var(--gray-200)', margin: '13px 6px 0', borderRadius: 1 }} />
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
        <div style={{ padding: '6px 10px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
          ⚠️ JSON had formatting issues and was auto-repaired before parsing.
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 10 }}>
        <strong style={{ color: '#10b981' }}>{setCount}</strong> of {summary.length} fields set by AI
        {' · '}<span style={{ color: 'var(--gray-400)' }}>{summary.length - setCount} using defaults</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
        {summary.map((r) => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--gray-50)' }}>
            <span style={{ color: 'var(--gray-500)', fontSize: 11 }}>{r.label}</span>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Section 1: Tactical Identity */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionLabel>Tactical Identity</SectionLabel>
        <TierSegment label="Attack Style"       options={ATTACK_STYLE_OPTIONS}    value={p.attack_style}       onChange={(v) => setP({ attack_style: v as TeamProfileData['attack_style'] })} />
        <TierSlider  label="Defensive Line"     options={TIER3_OPTIONS}            value={p.defensive_line}     onChange={(v) => setP({ defensive_line: v as TeamProfileData['defensive_line'] })} />
        <TierSlider  label="Pressing Intensity" options={TIER3_OPTIONS}            value={p.pressing_intensity} onChange={(v) => setP({ pressing_intensity: v as TeamProfileData['pressing_intensity'] })} />
        <TierSlider  label="Set Piece Threat"   options={TIER3_OPTIONS}            value={p.set_piece_threat}   onChange={(v) => setP({ set_piece_threat: v as TeamProfileData['set_piece_threat'] })} />
      </div>

      {/* Section 2: Results Profile */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionLabel>Results Profile</SectionLabel>
        <TierSlider  label="Home Strength"      options={HOME_STRENGTH_OPTIONS}    value={p.home_strength}      onChange={(v) => setP({ home_strength: v as TeamProfileData['home_strength'] })} />
        <TierSlider  label="Form Consistency"   options={FORM_CONSISTENCY_OPTIONS} value={p.form_consistency}   onChange={(v) => setP({ form_consistency: v as TeamProfileData['form_consistency'] })} />
        <TierSlider  label="Squad Depth"        options={SQUAD_DEPTH_OPTIONS}      value={p.squad_depth}        onChange={(v) => setP({ squad_depth: v as TeamProfileData['squad_depth'] })} />
        <TierSlider  label="Data Reliability"   options={RELIABILITY_OPTIONS}      value={p.data_reliability_tier} onChange={(v) => setP({ data_reliability_tier: v as TeamProfileData['data_reliability_tier'] })} />
      </div>

      {/* Section 3: Goals */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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

      {/* Section 4: Corners & Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionLabel>Corners & Discipline</SectionLabel>
        <div className="profile-stat-grid">
          <StatInput label="Corners For"     hint="/90" value={p.avg_corners_for}     onChange={(v) => setP({ avg_corners_for: v })} />
          <StatInput label="Corners Against" hint="/90" value={p.avg_corners_against} onChange={(v) => setP({ avg_corners_against: v })} />
          <StatInput label="Cards"           hint="/90" value={p.avg_cards}           onChange={(v) => setP({ avg_cards: v })} />
        </div>
      </div>

      {/* Section 5: Notes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionLabel>Analyst Notes</SectionLabel>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>English</span>
          <textarea
            value={draft.notes_en}
            onChange={(e) => onChange({ ...draft, notes_en: e.target.value })}
            rows={3}
            placeholder="Key betting considerations: home/away splits, set-piece danger, fatigue patterns, rivalry effects…"
            style={{ width: '100%', fontSize: 13, padding: '6px 8px', border: '1px solid var(--gray-200)', borderRadius: 6, resize: 'vertical', fontFamily: 'inherit', color: 'var(--gray-700)' }}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tiếng Việt</span>
          <textarea
            value={draft.notes_vi}
            onChange={(e) => onChange({ ...draft, notes_vi: e.target.value })}
            rows={3}
            placeholder="Ghi chú phân tích bằng tiếng Việt…"
            style={{ width: '100%', fontSize: 13, padding: '6px 8px', border: '1px solid var(--gray-200)', borderRadius: 6, resize: 'vertical', fontFamily: 'inherit', color: 'var(--gray-700)' }}
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
  profile: TeamProfile | null;
  loading: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (teamId: string, draft: TeamProfileDraft) => Promise<void>;
  onDelete: (teamId: string) => Promise<void>;
}

export function TeamProfileModal({
  team, leagueName, profile, loading, saving, onClose, onSave, onDelete,
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
      const result = parseImportedTeamProfile(jsonInput, team.name);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {hasProfile && !confirmDelete && (
              <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete Profile</button>
            )}
            {confirmDelete && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#b91c1c', fontWeight: 600 }}>Delete profile?</span>
                <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={saving}>Confirm</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
              {saving ? 'Saving…' : hasProfile ? 'Update Profile' : 'Create Profile'}
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: 'var(--gray-400)' }}>Loading profile…</p>
        </div>
      ) : (
        <>
          {/* Team info strip */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${leagueName && profile ? 3 : leagueName || profile ? 2 : 1}, minmax(0, 1fr))`,
            gap: 8, marginBottom: 16,
          }}>
            {[
              { label: 'Team', value: team.name },
              ...(leagueName ? [{ label: 'League', value: leagueName }] : []),
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

          <InnerTabBar active={innerTab} onChange={(t) => { setInnerTab(t); setWizardStep(1); }} />

          {innerTab === 'profile' && (
            <ProfileForm draft={draft} onChange={setDraft} />
          )}

          {innerTab === 'research' && (
            <div>
              <WizardSteps current={wizardStep} />

              {wizardStep === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 13, color: 'var(--gray-600)' }}>
                    Copy this prompt and paste it into an AI Deep Research tool (ChatGPT Deep Research, Gemini, Perplexity, etc.) to generate a data-backed team profile.
                  </p>
                  <pre style={{
                    background: 'var(--gray-50)', border: '1px solid var(--gray-200)',
                    borderRadius: 8, padding: '12px 14px', fontSize: 11, lineHeight: 1.6,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflowY: 'auto',
                    color: 'var(--gray-700)',
                  }}>
                    {prompt}
                  </pre>
                  <button className="btn btn-primary" onClick={handleCopyPrompt} style={{ alignSelf: 'flex-start' }}>
                    {copied ? '✓ Copied!' : 'Copy Prompt'}
                  </button>
                </div>
              )}

              {wizardStep === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 13, color: 'var(--gray-600)' }}>
                    Paste the JSON response from the AI tool below.
                  </p>
                  <textarea
                    value={jsonInput}
                    onChange={(e) => { setJsonInput(e.target.value); setParseError(''); }}
                    rows={12}
                    placeholder='{ "profile": { "attack_style": "counter", ... } }'
                    style={{
                      width: '100%', fontFamily: 'monospace', fontSize: 12,
                      padding: '10px 12px', border: `1px solid ${parseError ? '#ef4444' : 'var(--gray-200)'}`,
                      borderRadius: 8, resize: 'vertical', color: 'var(--gray-700)',
                    }}
                  />
                  {parseError && <p style={{ fontSize: 12, color: '#ef4444' }}>{parseError}</p>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => setWizardStep(1)}>← Back</button>
                    <button className="btn btn-primary" onClick={handleParseJson} disabled={!jsonInput.trim()}>
                      Parse JSON →
                    </button>
                  </div>
                </div>
              )}

              {wizardStep === 3 && parseResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <ImportReview summary={parseResult.summary} repaired={parseResult.repaired} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => setWizardStep(2)}>← Back</button>
                    <button className="btn btn-primary" onClick={handleApplyImport}>
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
