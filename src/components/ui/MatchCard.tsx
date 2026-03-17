import { memo } from 'react';
import type { Match } from '@/types';

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
  onClick: (match: Match) => void;
  variant?: 'primary' | 'secondary' | 'success';
  disabled?: boolean;
  loading?: boolean;
}

interface Props {
  match: Match;
  actions?: MatchCardAction[];
  /** Highlight the card (e.g. selected in watchlist) */
  highlighted?: boolean;
  onClick?: (match: Match) => void;
}

function MatchCardBase({ match, actions, highlighted, onClick }: Props) {
  const isLive = STATUS_LIVE.has(match.status);
  const isFt   = STATUS_FT.has(match.status);
  const hasScore = match.home_score != null && match.away_score != null;

  const minuteNum = match.current_minute ? parseInt(String(match.current_minute), 10) : 0;
  const progressPct = isLive ? Math.min(100, (minuteNum / 90) * 100) : isFt ? 100 : 0;

  const leagueName = match.league_name || match.league || '';
  const kickoffTime = match.kickoff ? match.kickoff.slice(0, 5) : '';

  return (
    <div
      className="card"
      style={{
        padding: '0',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : undefined,
        outline: highlighted ? '2px solid var(--primary)' : undefined,
        transition: 'box-shadow 0.2s, outline 0.15s',
      }}
      onClick={() => onClick?.(match)}
    >
      {/* Progress bar (live only) */}
      {isLive && (
        <div style={{ height: '3px', background: 'var(--gray-200)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${progressPct}%`,
            background: 'linear-gradient(90deg, #ef4444 0%, #f97316 100%)',
            transition: 'width 0.5s ease',
          }} />
        </div>
      )}

      <div style={{ padding: '14px 16px' }}>

        {/* League + Status row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '11px', color: 'var(--gray-400)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
            {leagueName}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {isLive && minuteNum > 0 && (
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#ef4444' }}>{minuteNum}&apos;</span>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flex: 1, minWidth: 0 }}>
            {match.home_logo && <TeamLogo src={match.home_logo} alt={match.home_team} />}
            <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {match.home_team}
            </span>
          </div>

          {/* Score or vs */}
          <div style={{ flexShrink: 0, textAlign: 'center', minWidth: '52px' }}>
            {hasScore ? (
              <span style={{ fontWeight: 800, fontSize: '18px', color: isLive ? '#ef4444' : 'var(--gray-900)', letterSpacing: '1px' }}>
                {match.home_score} – {match.away_score}
              </span>
            ) : (
              <span style={{ fontSize: '13px', color: 'var(--gray-400)', fontWeight: 500 }}>vs</span>
            )}
          </div>

          {/* Away team */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
            <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
              {match.away_team}
            </span>
            {match.away_logo && <TeamLogo src={match.away_logo} alt={match.away_team} />}
          </div>
        </div>

        {/* Prediction badge */}
        {match.prediction && (
          <div style={{ marginTop: '10px' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              padding: '3px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
              background: '#eff6ff', color: 'var(--primary)', border: '1px solid #bfdbfe',
            }}>
              🤖 {match.prediction}
            </span>
          </div>
        )}

        {/* Actions */}
        {actions && actions.length > 0 && (
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
            {actions.map((action) => (
              <button
                key={action.label}
                className={`btn btn-sm btn-${action.variant ?? 'secondary'} ${action.loading ? 'btn-loading' : ''}`}
                onClick={() => !action.disabled && !action.loading && action.onClick(match)}
                disabled={action.disabled || action.loading}
                aria-busy={action.loading}
              >
                {action.loading ? '' : action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const MatchCard = memo(MatchCardBase);
