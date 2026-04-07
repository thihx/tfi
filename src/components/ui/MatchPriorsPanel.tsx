// ============================================================
// League + team profile priors (TFI) — Match hub TFI tab
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { fetchLeagueProfile, fetchTeamProfile } from '@/lib/services/api';
import type { AppConfig, LeagueProfile, TeamProfile } from '@/types';

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
      <div className="strategic-context-grid strategic-context-grid--offset-top">
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
        <div className="strategic-context-text strategic-context-text--offset-top">
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
      <div className="strategic-context-grid strategic-context-grid--offset-top">
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
        <div className="strategic-context-text strategic-context-text--offset-top">
          Tactical overlay season: {profile.tactical_overlay_source_season}
        </div>
      )}
      {(profile.notes_en || profile.notes_vi) && (
        <div className="strategic-context-text strategic-context-text--offset-top">
          {profile.notes_vi || profile.notes_en}
        </div>
      )}
    </div>
  );
}

export interface MatchPriorsPanelProps {
  open: boolean;
  active: boolean;
  config: AppConfig;
  leagueId?: number | null;
  homeTeamId?: string | number | null;
  awayTeamId?: string | number | null;
  homeTeamName: string;
  awayTeamName: string;
}

export function MatchPriorsPanel({
  open,
  active,
  config,
  leagueId,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
}: MatchPriorsPanelProps) {
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [leagueProfile, setLeagueProfile] = useState<LeagueProfile | null>(null);
  const [homeTeamProfile, setHomeTeamProfile] = useState<TeamProfile | null>(null);
  const [awayTeamProfile, setAwayTeamProfile] = useState<TeamProfile | null>(null);
  const lastProfileFetchKeyRef = useRef('');

  useEffect(() => {
    if (!open || !active) {
      if (!open) {
        lastProfileFetchKeyRef.current = '';
        setLeagueProfile(null);
        setHomeTeamProfile(null);
        setAwayTeamProfile(null);
        setProfileError(null);
        setProfileLoading(false);
      }
      return;
    }

    const lid = leagueId ?? null;
    const homeId = homeTeamId != null && homeTeamId !== '' ? String(homeTeamId) : '';
    const awayId = awayTeamId != null && awayTeamId !== '' ? String(awayTeamId) : '';
    const fetchKey = [String(lid ?? ''), homeId, awayId, config.apiUrl].join('|');

    if (lastProfileFetchKeyRef.current === fetchKey) {
      return;
    }

    if (!lid && !homeId && !awayId) {
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
      lid ? fetchLeagueProfile(config, lid) : Promise.resolve(null),
      homeId ? fetchTeamProfile(config, homeId) : Promise.resolve(null),
      awayId ? fetchTeamProfile(config, awayId) : Promise.resolve(null),
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
  }, [open, active, config.apiUrl, leagueId, homeTeamId, awayTeamId]);

  if (!active) return null;

  return (
    <div className="form-group form-group--mb-0">
      <div className="strategic-context-box">
        <div className="strategic-context-header">Profile Priors</div>
        <div className="strategic-context-priors-intro">
          These priors come from the real league profile and team profiles used in match analysis. They are slower-moving priors, separate from match-specific enrichment.
        </div>
        {profileLoading ? (
          <div className="strategic-context-item strategic-context-summary">
            <span className="strategic-context-label">Loading</span>
            <span className="strategic-context-text">Loading league and team profile priors...</span>
          </div>
        ) : (
          <div className="strategic-context-priors-stack">
            {profileError && (
              <div className="strategic-context-item strategic-context-summary">
                <span className="strategic-context-label">Profile Status</span>
                <span className="strategic-context-text">{profileError}</span>
              </div>
            )}
            <LeaguePriorCard profile={leagueProfile} />
            <div className="strategic-context-priors-team-grid">
              <TeamPriorCard title={`${homeTeamName} Team Profile`} teamName={homeTeamName} profile={homeTeamProfile} />
              <TeamPriorCard title={`${awayTeamName} Team Profile`} teamName={awayTeamName} profile={awayTeamProfile} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
