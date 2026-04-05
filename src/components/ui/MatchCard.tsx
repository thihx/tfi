import { memo, useState, type ReactNode } from 'react';
import { formatLocalTime } from '@/lib/utils/helpers';
import type { Match } from '@/types';

function CardBadge({ count, type, flashGen }: { count: number; type: 'yellow' | 'red'; flashGen: number }) {
  if (count <= 0) return null;
  const isYellow = type === 'yellow';
  return (
    <span
      key={flashGen}
      className={flashGen ? (isYellow ? 'flash-yellow-card' : 'flash-red-card') : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 700,
        background: isYellow ? '#f5c518' : '#e53935',
        color: isYellow ? '#1a1a1a' : '#fff',
        borderRadius: 3, padding: '1px 5px', flexShrink: 0,
      }}
    >
      {count}
    </span>
  );
}

const STATUS_LIVE = new Set(['1H', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
const STATUS_FT   = new Set(['FT', 'AET', 'PEN']);

function getStatusClass(status: string): string {
  if (STATUS_LIVE.has(status)) return 'badge-live';
  if (STATUS_FT.has(status))   return 'badge-ft';
  if (status === 'NS')         return 'badge-ns';
  return 'badge-pending';
}

function TeamLogo({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={28}
      height={28}
      style={{ objectFit: 'contain', borderRadius: '4px', flexShrink: 0 }}
      onError={(e) => {
        // Replace broken logo with a neutral placeholder
        (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
      }}
    />
  );
}

interface MatchCardAction {
  label: string;
  icon?: ReactNode;
  title?: string;
  onClick: (match: Match) => void;
  variant?: 'primary' | 'secondary' | 'success' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}

interface WatchedAction {
  onRemove: () => void;
  isPendingRemove: boolean;
  isPlaying: boolean;
}

interface Props {
  match: Match;
  actions?: MatchCardAction[];
  /** Highlight the card (e.g. selected in watchlist) */
  highlighted?: boolean;
  /** Interactive eye button for watched matches (handles unwatch with hover state) */
  watchedAction?: WatchedAction;
  /** Flash generation counters for live events */
  flashMap?: Map<string, number>;
  onClick?: (match: Match) => void;
}

function MatchCardBase({ match, actions, highlighted, watchedAction, flashMap, onClick }: Props) {
  const [eyeHovered, setEyeHovered] = useState(false);
  const isLive = STATUS_LIVE.has(match.status);
  const hasScore = match.home_score != null && match.away_score != null;

  const minuteNum = match.current_minute ? parseInt(String(match.current_minute), 10) : 0;
  const minuteDisplay = match.status === 'HT' ? 'HT' : (minuteNum > 0 ? `${minuteNum}'` : '');

  const id = match.match_id;
  const scoreFlashGen  = flashMap?.get(`${id}:score`) ?? 0;
  const homeYellowGen  = flashMap?.get(`${id}:hy`) ?? 0;
  const awayYellowGen  = flashMap?.get(`${id}:ay`) ?? 0;
  const homeRedGen     = flashMap?.get(`${id}:hr`) ?? 0;
  const awayRedGen     = flashMap?.get(`${id}:ar`) ?? 0;

  const leagueName = match.league_name || match.league || '';
  const kickoffTime = match.kickoff_at_utc ? formatLocalTime(match.kickoff_at_utc) : (match.kickoff ? match.kickoff.slice(0, 5) : '');

  return (
    <div
      className={`card${isLive ? ' match-is-live' : ''}`}
      style={{
        padding: '0',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : undefined,
        outline: highlighted ? '2px solid var(--primary)' : undefined,
        transition: 'box-shadow 0.2s, outline 0.15s',
      }}
      onClick={() => onClick?.(match)}
    >
      <div style={{ padding: '14px 16px' }}>

        {/* League + Status row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '11px', color: 'var(--gray-400)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
            {leagueName}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {isLive && minuteDisplay && (
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-500)' }}>{minuteDisplay}</span>
            )}
            {!isLive && kickoffTime && match.status === 'NS' && (
              <span style={{ fontSize: '12px', color: 'var(--gray-500)' }}>{kickoffTime}</span>
            )}
            <span className={`badge ${getStatusClass(match.status)}`} style={{ fontSize: '11px', padding: '2px 8px' }}>
              {match.status}
            </span>
          </div>
        </div>

        {/* Teams + Score */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>

          {/* Home team */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
            {match.home_logo && <TeamLogo src={match.home_logo} alt={match.home_team} />}
            <span style={{ fontWeight: 500, fontSize: '13px', color: 'var(--gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {match.home_team}
            </span>
          </div>

          {/* Score or vs */}
          <div style={{ flexShrink: 0, textAlign: 'center', minWidth: '48px' }}>
            {hasScore ? (
              <span key={scoreFlashGen} className={scoreFlashGen ? 'flash-goal' : undefined} style={{ fontWeight: 700, fontSize: '15px', color: 'var(--gray-900)', letterSpacing: '0.5px' }}>
                {match.home_score} – {match.away_score}
              </span>
            ) : (
              <span style={{ fontSize: '12px', color: 'var(--gray-400)', fontWeight: 400 }}>vs</span>
            )}
          </div>

          {/* Away team */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
            <span style={{ fontWeight: 500, fontSize: '13px', color: 'var(--gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
              {match.away_team}
            </span>
            {match.away_logo && <TeamLogo src={match.away_logo} alt={match.away_team} />}
          </div>
        </div>

        {/* Cards row — only shown when any cards exist */}
        {((match.home_yellows ?? 0) > 0 || (match.home_reds ?? 0) > 0 || (match.away_yellows ?? 0) > 0 || (match.away_reds ?? 0) > 0) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', padding: '0 2px' }}>
            <div style={{ display: 'flex', gap: '3px' }}>
              <CardBadge count={match.home_yellows ?? 0} type="yellow" flashGen={homeYellowGen} />
              <CardBadge count={match.home_reds ?? 0} type="red" flashGen={homeRedGen} />
            </div>
            <div style={{ display: 'flex', gap: '3px' }}>
              <CardBadge count={match.away_reds ?? 0} type="red" flashGen={awayRedGen} />
              <CardBadge count={match.away_yellows ?? 0} type="yellow" flashGen={awayYellowGen} />
            </div>
          </div>
        )}

        {/* Prediction badge */}
        {match.prediction && (
          <div style={{ marginTop: '8px', textAlign: 'center' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 500,
              background: 'var(--gray-100)', color: 'var(--gray-500)',
            }}>
              {match.prediction}
            </span>
          </div>
        )}

        {/* Actions */}
        {(watchedAction || (actions && actions.length > 0)) && (
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
            {watchedAction && (
              <button
                className={`btn btn-sm watch-btn${watchedAction.isPlaying && !eyeHovered && !watchedAction.isPendingRemove ? ' eye-live-pulse' : ''}`}
                onClick={watchedAction.isPendingRemove ? undefined : watchedAction.onRemove}
                onMouseEnter={() => setEyeHovered(true)}
                onMouseLeave={() => setEyeHovered(false)}
                disabled={watchedAction.isPendingRemove}
                title={watchedAction.isPendingRemove ? 'Removing…' : watchedAction.isPlaying ? 'AI is watching — click to unwatch' : 'Click to unwatch'}
                aria-label={watchedAction.isPendingRemove ? 'Removing…' : 'Unwatch this match'}
                style={{
                  background: eyeHovered ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                  border: `1px solid ${eyeHovered ? 'rgba(239,68,68,0.35)' : 'rgba(16,185,129,0.35)'}`,
                  color: eyeHovered ? '#ef4444' : '#10b981',
                  transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                }}
              >
                {watchedAction.isPendingRemove
                  ? <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
                  : eyeHovered
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block' }}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block' }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><path d="M9 12l2 2 4-4" strokeWidth="2.5"/></svg>
                }
              </button>
            )}
            {actions && actions.map((action) => (
              <button
                key={action.label}
                className={`btn btn-sm btn-${action.variant ?? 'secondary'} ${action.loading ? 'btn-loading' : ''}`}
                onClick={() => !action.disabled && !action.loading && action.onClick(match)}
                disabled={action.disabled || action.loading}
                aria-busy={action.loading}
                title={action.title}
                aria-label={action.title ?? action.label}
              >
                {action.loading ? action.label : (action.icon ?? action.label)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const MatchCard = memo(MatchCardBase);
