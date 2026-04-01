// ============================================================
// WatchlistEditModal — shared edit modal for watchlist items
// Used by WatchlistTab and MatchesTab
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { ConditionBuilder } from '@/components/ui/ConditionBuilder';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { fetchMonitorConfig } from '@/features/live-monitor/config';
import { fetchLeagueProfile, fetchTeamProfile } from '@/lib/services/api';
import {
  getStrategicNarrative,
  getStrategicQuantitativeEntries,
  getStrategicRefreshMeta,
  getStrategicSourceMeta,
  isStructuredStrategicContext,
  normalizeStrategicDisplayText,
} from '@/lib/utils/strategicContext';
import type { UiLanguage } from '@/hooks/useUiLanguage';
import type { AppConfig, LeagueProfile, Match, TeamProfile, WatchlistItem } from '@/types';

function normalizeCondition(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

function humanizeCompetitionType(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function hasMeaningfulText(value: string | null | undefined): boolean {
  const normalized = normalizeStrategicDisplayText(value);
  if (!normalized) return false;
  const lowered = normalized.toLowerCase();
  return lowered !== 'no data found'
    && lowered !== 'không có dữ liệu'
    && lowered !== 'không tìm thấy dữ liệu'
    && lowered !== 'không đủ dữ liệu';
}

function formatNullableNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return 'N/A';
  return Number(value).toFixed(digits).replace(/\.00$/, '');
}

function formatRate(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'N/A';
  const scaled = value <= 1 ? value * 100 : value;
  return `${scaled.toFixed(1).replace(/\.0$/, '')}%`;
}

function humanizeEnum(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return 'N/A';
  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function compactUpdatedAt(value: string | null | undefined): string {
  return value ? formatLocalDateTime(value) : 'N/A';
}

function PriorStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="strategic-context-item">
      <span className="strategic-context-label">{label}</span>
      <span className="strategic-context-text">{value}</span>
    </div>
  );
}

function LeaguePriorCard({ profile }: { profile: LeagueProfile | null }) {
  if (!profile) {
    return (
      <div className="strategic-context-item strategic-context-summary">
        <span className="strategic-context-label">League Profile</span>
        <span className="strategic-context-text">No league profile is available for this match yet.</span>
      </div>
    );
  }

  return (
    <div className="strategic-context-item strategic-context-summary">
      <span className="strategic-context-label">League Profile</span>
      <div className="strategic-context-grid" style={{ marginTop: '8px' }}>
        <PriorStat label="Tempo" value={humanizeEnum(profile.profile.tempo_tier)} />
        <PriorStat label="Goal Tendency" value={humanizeEnum(profile.profile.goal_tendency)} />
        <PriorStat label="Volatility" value={humanizeEnum(profile.profile.volatility_tier)} />
        <PriorStat label="Reliability" value={humanizeEnum(profile.profile.data_reliability_tier)} />
        <PriorStat label="Avg Goals" value={formatNullableNumber(profile.profile.avg_goals)} />
        <PriorStat label="League Match BTTS" value={formatRate(profile.profile.btts_rate)} />
        <PriorStat label="Over 2.5" value={formatRate(profile.profile.over_2_5_rate)} />
        <PriorStat label="Late Goal 75+" value={formatRate(profile.profile.late_goal_rate_75_plus)} />
        <PriorStat label="Avg Corners" value={formatNullableNumber(profile.profile.avg_corners)} />
        <PriorStat label="Avg Cards" value={formatNullableNumber(profile.profile.avg_cards)} />
        <PriorStat label="Profile Updated" value={compactUpdatedAt(profile.updated_at)} />
      </div>
      {(profile.notes_en || profile.notes_vi) && (
        <div className="strategic-context-text" style={{ marginTop: '8px' }}>
          {profile.notes_vi || profile.notes_en}
        </div>
      )}
    </div>
  );
}

function TeamPriorCard({
  title,
  teamName,
  profile,
}: {
  title: string;
  teamName: string;
  profile: TeamProfile | null;
}) {
  if (!profile) {
    return (
      <div className="strategic-context-item strategic-context-summary">
        <span className="strategic-context-label">{title}</span>
        <span className="strategic-context-text">No team profile is available yet for {teamName}.</span>
      </div>
    );
  }

  const overlayMode = profile.tactical_overlay_source_mode
    && profile.tactical_overlay_source_mode !== 'default_neutral'
    ? `${humanizeEnum(profile.tactical_overlay_source_mode)}${profile.tactical_overlay_source_confidence ? ` (${humanizeEnum(profile.tactical_overlay_source_confidence)})` : ''}`
    : 'Default Neutral';

  return (
    <div className="strategic-context-item strategic-context-summary">
      <span className="strategic-context-label">{title}</span>
      <div className="strategic-context-grid" style={{ marginTop: '8px' }}>
        <PriorStat label="Attack Style" value={humanizeEnum(profile.profile.attack_style)} />
        <PriorStat label="Defensive Line" value={humanizeEnum(profile.profile.defensive_line)} />
        <PriorStat label="Pressing" value={humanizeEnum(profile.profile.pressing_intensity)} />
        <PriorStat label="Squad Depth" value={humanizeEnum(profile.profile.squad_depth)} />
        <PriorStat label="Home Strength" value={humanizeEnum(profile.profile.home_strength)} />
        <PriorStat label="Form" value={humanizeEnum(profile.profile.form_consistency)} />
        <PriorStat label="Reliability" value={humanizeEnum(profile.profile.data_reliability_tier)} />
        <PriorStat label="Avg Goals For" value={formatNullableNumber(profile.profile.avg_goals_scored)} />
        <PriorStat label="Avg Goals Against" value={formatNullableNumber(profile.profile.avg_goals_conceded)} />
        <PriorStat label="Clean Sheet Rate" value={formatRate(profile.profile.clean_sheet_rate)} />
        <PriorStat label="Team Match BTTS" value={formatRate(profile.profile.btts_rate)} />
        <PriorStat label="Over 2.5" value={formatRate(profile.profile.over_2_5_rate)} />
        <PriorStat label="First Goal Rate" value={formatRate(profile.profile.first_goal_rate)} />
        <PriorStat label="Late Goal Rate" value={formatRate(profile.profile.late_goal_rate)} />
        <PriorStat label="Overlay" value={overlayMode} />
        <PriorStat label="Profile Updated" value={compactUpdatedAt(profile.updated_at)} />
      </div>
      {profile.tactical_overlay_source_season && (
        <div className="strategic-context-text" style={{ marginTop: '8px' }}>
          Tactical overlay season: {profile.tactical_overlay_source_season}
        </div>
      )}
      {(profile.notes_en || profile.notes_vi) && (
        <div className="strategic-context-text" style={{ marginTop: '8px' }}>
          {profile.notes_vi || profile.notes_en}
        </div>
      )}
    </div>
  );
}

interface WatchlistEditModalProps {
  item: WatchlistItem | null;
  match?: Match | null;
  config: AppConfig;
  defaultMode: string;
  uiLanguage: UiLanguage;
  onClose: () => void;
  onSave: (changes: {
    mode: string;
    priority: number;
    status: string;
    custom_conditions: string;
    auto_apply_recommended_condition: boolean;
  }) => void;
}

export function WatchlistEditModal({ item, match, config, defaultMode, uiLanguage, onClose, onSave }: WatchlistEditModalProps) {
  const [editMode, setEditMode] = useState(() => item?.mode || defaultMode);
  const [editPriority, setEditPriority] = useState(() => String(item?.priority || 2));
  const [editStatus, setEditStatus] = useState(() => item?.status || 'active');
  const [editConditions, setEditConditions] = useState(() => item?.custom_conditions || '');
  const [autoApplyRecommendedCondition, setAutoApplyRecommendedCondition] = useState(() => item?.auto_apply_recommended_condition ?? true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [leagueProfile, setLeagueProfile] = useState<LeagueProfile | null>(null);
  const [homeTeamProfile, setHomeTeamProfile] = useState<TeamProfile | null>(null);
  const [awayTeamProfile, setAwayTeamProfile] = useState<TeamProfile | null>(null);
  const lastProfileFetchKeyRef = useRef('');

  useEffect(() => {
    if (!item) return;
    let cancelled = false;

    if (item.auto_apply_recommended_condition != null) {
      return;
    }

    void fetchMonitorConfig()
      .then((monitorConfig) => {
        if (cancelled) return;
        setAutoApplyRecommendedCondition(monitorConfig.AUTO_APPLY_RECOMMENDED_CONDITION !== false);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [item]);

  useEffect(() => {
    if (!item || !match) {
      lastProfileFetchKeyRef.current = '';
      setLeagueProfile(null);
      setHomeTeamProfile(null);
      setAwayTeamProfile(null);
      setProfileError(null);
      setProfileLoading(false);
      return;
    }

    const leagueId = item.league_id ?? match.league_id;
    const homeTeamId = match.home_team_id ? String(match.home_team_id) : '';
    const awayTeamId = match.away_team_id ? String(match.away_team_id) : '';
    const fetchKey = [
      String(item.match_id || ''),
      String(leagueId || ''),
      homeTeamId,
      awayTeamId,
      config.apiUrl,
    ].join('|');

    if (lastProfileFetchKeyRef.current === fetchKey) {
      return;
    }

    if (!leagueId && !homeTeamId && !awayTeamId) {
      lastProfileFetchKeyRef.current = fetchKey;
      setLeagueProfile(null);
      setHomeTeamProfile(null);
      setAwayTeamProfile(null);
      setProfileError('No league/team profile identifiers are available for this match.');
      setProfileLoading(false);
      return;
    }

    let cancelled = false;
    lastProfileFetchKeyRef.current = fetchKey;
    setProfileLoading(true);
    setProfileError(null);

    void Promise.all([
      leagueId ? fetchLeagueProfile(config, leagueId) : Promise.resolve(null),
      homeTeamId ? fetchTeamProfile(config, homeTeamId) : Promise.resolve(null),
      awayTeamId ? fetchTeamProfile(config, awayTeamId) : Promise.resolve(null),
    ])
      .then(([league, home, away]) => {
        if (cancelled) return;
        setLeagueProfile(league);
        setHomeTeamProfile(home);
        setAwayTeamProfile(away);
      })
      .catch(() => {
        if (cancelled) return;
        setProfileError('Unable to load profile priors right now.');
      })
      .finally(() => {
        if (cancelled) return;
        setProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    config.apiUrl,
    item,
    item?.match_id,
    item?.league_id,
    match,
    match?.league_id,
    match?.home_team_id,
    match?.away_team_id,
  ]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    const recommendedCondition = normalizeCondition(item.recommended_custom_condition || '');
    const currentCondition = normalizeCondition(editConditions);
    const safeToAutoApply = !currentCondition || currentCondition === recommendedCondition;
    onSave({
      mode: editMode,
      priority: parseInt(editPriority),
      status: editStatus,
      custom_conditions: autoApplyRecommendedCondition && recommendedCondition && safeToAutoApply
        ? recommendedCondition
        : editConditions,
      auto_apply_recommended_condition: autoApplyRecommendedCondition,
    });
  }

  const matchTitle = item ? `${item.home_team} vs ${item.away_team}` : '';

  return (
    <Modal open={!!item} title={matchTitle || 'Edit Watchlist Item'} onClose={onClose} size="lg">
      {item && (
        <form onSubmit={handleSubmit}>
          {(() => {
            const ctx = item.strategic_context;
            const homeMotivation = getStrategicNarrative(ctx, 'home_motivation', uiLanguage);
            const awayMotivation = getStrategicNarrative(ctx, 'away_motivation', uiLanguage);
            const leaguePositions = getStrategicNarrative(ctx, 'league_positions', uiLanguage);
            const keyAbsences = getStrategicNarrative(ctx, 'key_absences', uiLanguage);
            const homeKeyAbsences = getStrategicNarrative(ctx, 'home_key_absences', uiLanguage);
            const awayKeyAbsences = getStrategicNarrative(ctx, 'away_key_absences', uiLanguage);
            const rotationRisk = getStrategicNarrative(ctx, 'rotation_risk', uiLanguage);
            const fixtureCongestion = getStrategicNarrative(ctx, 'fixture_congestion', uiLanguage);
            const homeFixtureCongestion = getStrategicNarrative(ctx, 'home_fixture_congestion', uiLanguage);
            const awayFixtureCongestion = getStrategicNarrative(ctx, 'away_fixture_congestion', uiLanguage);
            const h2hNarrative = getStrategicNarrative(ctx, 'h2h_narrative', uiLanguage);
            const summary = getStrategicNarrative(ctx, 'summary', uiLanguage);
            const sourceMeta = getStrategicSourceMeta(ctx);
            const refreshMeta = getStrategicRefreshMeta(ctx);
            const quantitativeEntries = getStrategicQuantitativeEntries(ctx);
            const structuredContext = isStructuredStrategicContext(ctx);
            const trustedDomains = Array.from(new Set((sourceMeta?.sources || []).map((s) => s.domain).filter(Boolean)));
            const searchQueries = (sourceMeta?.web_search_queries || []).filter(Boolean);
            return (
              <>
                <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 160px), 1fr))', gap: '12px' }}>
                  <div className="form-group">
                    <label>Mode:</label>
                    <select value={editMode} onChange={(e) => setEditMode(e.target.value)}>
                      <option value="A">A - Aggressive</option>
                      <option value="B">B - Balanced</option>
                      <option value="C">C - Conservative</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Priority:</label>
                    <select value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                      <option value="1">1 - Low</option>
                      <option value="2">2 - Medium</option>
                      <option value="3">3 - High</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Status:</label>
                    <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                      <option value="pending">Pending</option>
                      <option value="active">Active</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <div className="strategic-context-box">
                    <div className="strategic-context-header">Profile Priors</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary, #666)', marginBottom: '12px', lineHeight: 1.55 }}>
                      These priors come from the real league profile and team profiles used by AI analysis. They are slower-moving priors, separate from match-specific enrichment.
                    </div>
                    {profileLoading ? (
                      <div className="strategic-context-item strategic-context-summary">
                        <span className="strategic-context-label">Loading</span>
                        <span className="strategic-context-text">Loading league and team profile priors...</span>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gap: '12px' }}>
                        {profileError && (
                          <div className="strategic-context-item strategic-context-summary">
                            <span className="strategic-context-label">Profile Status</span>
                            <span className="strategic-context-text">{profileError}</span>
                          </div>
                        )}
                        <LeaguePriorCard profile={leagueProfile} />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                          <TeamPriorCard title={`${item.home_team} Team Profile`} teamName={item.home_team} profile={homeTeamProfile} />
                          <TeamPriorCard title={`${item.away_team} Team Profile`} teamName={item.away_team} profile={awayTeamProfile} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Match-specific enrichment context */}
                {item.strategic_context && (
                  <div className="form-group">
                    <div className="strategic-context-box">
                      <div className="strategic-context-header">Match Context</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary, #666)', marginBottom: '12px', lineHeight: 1.55 }}>
                        This section shows match-specific enrichment for this watch item. League profile, team profile, and tactical overlay priors are used by AI analysis, but they are not edited here.
                      </div>
                      {(structuredContext || refreshMeta) && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px', marginBottom: '14px' }}>
                          {structuredContext && (
                            <>
                              <div className="strategic-context-item">
                                <span className="strategic-context-label">Source Quality</span>
                                <span className="strategic-context-text">{sourceMeta?.search_quality || 'unknown'}</span>
                              </div>
                              <div className="strategic-context-item">
                                <span className="strategic-context-label">Trusted Sources</span>
                                <span className="strategic-context-text">{sourceMeta?.trusted_source_count ?? 0}</span>
                              </div>
                              {ctx?.competition_type && (
                                <div className="strategic-context-item">
                                  <span className="strategic-context-label">Competition</span>
                                  <span className="strategic-context-text">{humanizeCompetitionType(ctx.competition_type)}</span>
                                </div>
                              )}
                            </>
                          )}
                          {refreshMeta?.refresh_status && (
                            <div className="strategic-context-item">
                              <span className="strategic-context-label">Refresh Status</span>
                              <span className="strategic-context-text">{refreshMeta.refresh_status}</span>
                            </div>
                          )}
                          {refreshMeta?.retry_after && (
                            <div className="strategic-context-item">
                              <span className="strategic-context-label">Retry After</span>
                              <span className="strategic-context-text">{formatLocalDateTime(refreshMeta.retry_after)}</span>
                            </div>
                          )}
                          {item.strategic_context_at && (
                            <div className="strategic-context-item">
                              <span className="strategic-context-label">Context Updated</span>
                              <span className="strategic-context-text">{formatLocalDateTime(item.strategic_context_at)}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {hasMeaningfulText(summary) && (
                        <div className="strategic-context-item strategic-context-summary" style={{ marginBottom: '12px' }}>
                          <span className="strategic-context-label">Summary</span>
                          <span className="strategic-context-text">{summary}</span>
                        </div>
                      )}
                      <div style={{ display: 'grid', gap: '12px' }}>
                        {(homeMotivation || awayMotivation || leaguePositions) && (
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary, #666)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '8px' }}>
                              Match Importance
                            </div>
                            <div className="strategic-context-grid">
                              {homeMotivation && <div className="strategic-context-item"><span className="strategic-context-label">{item.home_team}</span><span className="strategic-context-text">{homeMotivation}</span></div>}
                              {awayMotivation && <div className="strategic-context-item"><span className="strategic-context-label">{item.away_team}</span><span className="strategic-context-text">{awayMotivation}</span></div>}
                              {leaguePositions && <div className="strategic-context-item"><span className="strategic-context-label">Positions</span><span className="strategic-context-text">{leaguePositions}</span></div>}
                            </div>
                          </div>
                        )}

                        {(homeKeyAbsences || awayKeyAbsences || keyAbsences || rotationRisk) && (
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary, #666)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '8px' }}>
                              Availability & Rotation
                            </div>
                            <div className="strategic-context-grid">
                              {homeKeyAbsences && hasMeaningfulText(homeKeyAbsences) && <div className="strategic-context-item"><span className="strategic-context-label">{item.home_team} Absences</span><span className="strategic-context-text">{homeKeyAbsences}</span></div>}
                              {awayKeyAbsences && hasMeaningfulText(awayKeyAbsences) && <div className="strategic-context-item"><span className="strategic-context-label">{item.away_team} Absences</span><span className="strategic-context-text">{awayKeyAbsences}</span></div>}
                              {keyAbsences && hasMeaningfulText(keyAbsences) && <div className="strategic-context-item"><span className="strategic-context-label">Absence Summary</span><span className="strategic-context-text">{keyAbsences}</span></div>}
                              {rotationRisk && hasMeaningfulText(rotationRisk) && <div className="strategic-context-item"><span className="strategic-context-label">Rotation</span><span className="strategic-context-text">{rotationRisk}</span></div>}
                            </div>
                          </div>
                        )}

                        {(homeFixtureCongestion || awayFixtureCongestion || fixtureCongestion || h2hNarrative) && (
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary, #666)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '8px' }}>
                              Schedule & Matchup
                            </div>
                            <div className="strategic-context-grid">
                              {homeFixtureCongestion && hasMeaningfulText(homeFixtureCongestion) && <div className="strategic-context-item"><span className="strategic-context-label">{item.home_team} Congestion</span><span className="strategic-context-text">{homeFixtureCongestion}</span></div>}
                              {awayFixtureCongestion && hasMeaningfulText(awayFixtureCongestion) && <div className="strategic-context-item"><span className="strategic-context-label">{item.away_team} Congestion</span><span className="strategic-context-text">{awayFixtureCongestion}</span></div>}
                              {fixtureCongestion && hasMeaningfulText(fixtureCongestion) && <div className="strategic-context-item"><span className="strategic-context-label">Congestion Summary</span><span className="strategic-context-text">{fixtureCongestion}</span></div>}
                              {h2hNarrative && hasMeaningfulText(h2hNarrative) && <div className="strategic-context-item"><span className="strategic-context-label">H2H</span><span className="strategic-context-text">{h2hNarrative}</span></div>}
                            </div>
                          </div>
                        )}

                        {structuredContext && quantitativeEntries.length > 0 && (
                          <div className="strategic-context-item strategic-context-summary">
                            <span className="strategic-context-label">Structured Snapshot</span>
                            <span className="strategic-context-text">{quantitativeEntries.map((e) => `${e.label}: ${e.value}`).join(' | ')}</span>
                          </div>
                        )}

                        {!structuredContext && (
                          <div className="strategic-context-item strategic-context-summary">
                            <span className="strategic-context-label">Context Status</span>
                            <span className="strategic-context-text">Legacy context detected. Trust metadata is missing, so this context should be refreshed before relying on it.</span>
                          </div>
                        )}

                        {(refreshMeta?.last_error || trustedDomains.length > 0 || searchQueries.length > 0) && (
                          <details style={{ border: '1px solid var(--border-color, #e0e0e0)', borderRadius: '8px', padding: '10px 12px', background: 'var(--bg-secondary, #fafafa)' }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-primary, #222)' }}>
                              Research Trace
                            </summary>
                            <div style={{ display: 'grid', gap: '10px', marginTop: '10px' }}>
                              {trustedDomains.length > 0 && (
                                <div className="strategic-context-item strategic-context-summary">
                                  <span className="strategic-context-label">Trusted Domains</span>
                                  <span className="strategic-context-text">{trustedDomains.join(', ')}</span>
                                </div>
                              )}
                              {searchQueries.length > 0 && (
                                <div className="strategic-context-item strategic-context-summary">
                                  <span className="strategic-context-label">Search Queries</span>
                                  <span className="strategic-context-text">{searchQueries.join(' | ')}</span>
                                </div>
                              )}
                              {refreshMeta?.last_error && (
                                <div className="strategic-context-item strategic-context-summary">
                                  <span className="strategic-context-label">Last Error</span>
                                  <span className="strategic-context-text">{refreshMeta.last_error}</span>
                                </div>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* AI Recommended Condition */}
                {item.recommended_custom_condition && (
                  <div className="form-group">
                    <div className="ai-recommended-box">
                      <div className="ai-recommended-header">AI Recommended Condition</div>
                      <div className="ai-recommended-content">
                        <div className="ai-recommended-item">
                          <label>Condition:</label>
                          <div className="ai-recommended-value">{item.recommended_custom_condition}</div>
                        </div>
                        {item.recommended_condition_reason_vi && (
                          <div className="ai-recommended-item">
                            <label>Reason:</label>
                            <div className="ai-recommended-value">{item.recommended_condition_reason_vi}</div>
                          </div>
                        )}
                      </div>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => {
                        const current = editConditions.trim();
                        if (current && current.includes(item.recommended_custom_condition!)) return;
                        const rec = item.recommended_custom_condition!;
                        setEditConditions(current ? `${current} OR (${rec})` : `(${rec})`);
                      }}>
                        Apply Recommended Condition
                      </button>
                    </div>
                  </div>
                )}

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '6px', background: 'var(--bg-secondary, #f8f8f8)', border: '1px solid var(--border-color, #e0e0e0)', cursor: 'pointer', userSelect: 'none', marginBottom: '16px' }}>
                  <input
                    type="checkbox"
                    checked={autoApplyRecommendedCondition}
                    onChange={(e) => setAutoApplyRecommendedCondition(e.target.checked)}
                    style={{ margin: 0, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary, #555)' }}>
                    Auto-apply recommended condition for this match
                  </span>
                </label>

                <ConditionBuilder initialValue={editConditions} onChange={setEditConditions} />
                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>Save Changes</button>
              </>
            );
          })()}
        </form>
      )}
    </Modal>
  );
}
