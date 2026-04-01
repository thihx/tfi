import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { formatLocalDate } from '@/lib/utils/helpers';
import type { League, LeagueProfile, LeagueTier, LeagueProfileData } from '@/types';

interface LeagueProfileDraft {
  profile: LeagueProfileData;
  notes_en: string;
  notes_vi: string;
}

const DEFAULT_LEAGUE_PROFILE_DRAFT: LeagueProfileDraft = {
  profile: {
    tempo_tier: 'balanced',
    goal_tendency: 'balanced',
    home_advantage_tier: 'balanced',
    corners_tendency: 'balanced',
    cards_tendency: 'balanced',
    volatility_tier: 'balanced',
    data_reliability_tier: 'balanced',
    avg_goals: null,
    over_2_5_rate: null,
    btts_rate: null,
    late_goal_rate_75_plus: null,
    avg_corners: null,
    avg_cards: null,
  },
  notes_en: '',
  notes_vi: '',
};

const TIERS: LeagueTier[] = ['low', 'balanced', 'high'];
const TIER_COLORS: Record<LeagueTier, string> = {
  low: '#3b82f6',
  balanced: '#10b981',
  high: '#f59e0b',
};
const TIER_LABELS: Record<LeagueTier, string> = {
  low: 'Low',
  balanced: 'Balanced',
  high: 'High',
};

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
          style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
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
          onChange={(e) => onChange(TIERS[parseInt(e.target.value, 10)]!)}
          style={{
            '--slider-color': color,
            '--slider-fill': `${fillPct}%`,
          } as React.CSSProperties}
          aria-label={label}
        />
        <div className="tier-slider-labels">
          {TIERS.map((tier) => (
            <span
              key={tier}
              style={{ color: tier === value ? color : undefined, fontWeight: tier === value ? 700 : 400 }}
            >
              {TIER_LABELS[tier]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function parseNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
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
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {label}
        </span>
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
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.8px',
        color: 'var(--gray-400)',
        borderBottom: '1px solid var(--gray-100)',
        paddingBottom: 6,
        marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}

interface LeagueProfileModalProps {
  league: League | null;
  profile: LeagueProfile | null;
  loading: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: LeagueProfileDraft) => void;
  onDelete: () => void;
}

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
        <div style={{ display: 'grid', gap: 20 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${profile ? 4 : 3}, minmax(0, 1fr))`,
              gap: 8,
            }}
          >
            {[
              { label: 'League', value: league.league_name },
              { label: 'Country', value: league.country || '—' },
              { label: 'Tier / Type', value: `${league.tier} / ${league.type}` },
              ...(profile ? [{ label: 'Last Updated', value: formatLocalDate(profile.updated_at) }] : []),
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--gray-200)',
                  background: 'var(--gray-50)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-900)' }}>{value}</div>
              </div>
            ))}
          </div>

          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              fontSize: 12,
              color: '#1e40af',
              lineHeight: 1.6,
            }}
          >
            League profile core is auto-derived from structured historical data. Deep Research import is intentionally retired here so one-off LLM output cannot overwrite the competition prior.
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <SectionLabel>Qualitative</SectionLabel>
            <div className="profile-stat-grid">
              <TierSlider label="Tempo" value={draft.profile.tempo_tier} onChange={(v) => setProfileField('tempo_tier', v)} />
              <TierSlider label="Goal Tendency" value={draft.profile.goal_tendency} onChange={(v) => setProfileField('goal_tendency', v)} />
              <TierSlider label="Home Advantage" value={draft.profile.home_advantage_tier} onChange={(v) => setProfileField('home_advantage_tier', v)} />
              <TierSlider label="Corners" value={draft.profile.corners_tendency} onChange={(v) => setProfileField('corners_tendency', v)} />
              <TierSlider label="Cards" value={draft.profile.cards_tendency} onChange={(v) => setProfileField('cards_tendency', v)} />
              <TierSlider label="Volatility" value={draft.profile.volatility_tier} onChange={(v) => setProfileField('volatility_tier', v)} />
              <TierSlider label="Data Reliability" value={draft.profile.data_reliability_tier} onChange={(v) => setProfileField('data_reliability_tier', v)} />
            </div>
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <SectionLabel>Statistics</SectionLabel>
            <div className="profile-stat-grid">
              <StatInput label="Avg Goals" hint="per match" value={draft.profile.avg_goals} onChange={(v) => setProfileField('avg_goals', v)} />
              <StatInput label="Over 2.5 Rate" hint="%" value={draft.profile.over_2_5_rate} onChange={(v) => setProfileField('over_2_5_rate', v)} />
              <StatInput label="BTTS Rate" hint="%" value={draft.profile.btts_rate} onChange={(v) => setProfileField('btts_rate', v)} />
              <StatInput label="Late Goal 75+" hint="%" value={draft.profile.late_goal_rate_75_plus} onChange={(v) => setProfileField('late_goal_rate_75_plus', v)} />
              <StatInput label="Avg Corners" hint="per match" value={draft.profile.avg_corners} onChange={(v) => setProfileField('avg_corners', v)} />
              <StatInput label="Avg Cards" hint="per match" value={draft.profile.avg_cards} onChange={(v) => setProfileField('avg_cards', v)} />
            </div>
          </div>

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
    </Modal>
  );
}
