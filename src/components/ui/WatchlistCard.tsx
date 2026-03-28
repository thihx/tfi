import { memo } from 'react';
import { PLACEHOLDER_HOME, PLACEHOLDER_AWAY } from '@/config/constants';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { WatchlistItem, Match } from '@/types';

interface Props {
  item: WatchlistItem;
  liveMatch?: Match | null;
  homeLogo: string;
  awayLogo: string;
  timeDisplay: string;
  leagueDisplay: string;
  onEdit: () => void;
  onDelete: () => void;
  onDoubleClick: () => void;
}

function parsePrediction(raw?: string): { home: number; draw: number; away: number; winner: string } | null {
  if (!raw) return null;
  try {
    const pred = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!pred?.predictions?.percent) return null;
    const p = pred.predictions;
    return {
      home: parseInt(p.percent?.home) || 0,
      draw: parseInt(p.percent?.draw) || 0,
      away: parseInt(p.percent?.away) || 0,
      winner: p.winner?.name || '',
    };
  } catch { return null; }
}

function WatchlistCardBase({ item, liveMatch, homeLogo, awayLogo, timeDisplay, leagueDisplay, onEdit, onDelete, onDoubleClick }: Props) {
  const priority = Math.max(1, Math.min(3, parseInt(String(item.priority)) || 2));
  const pred = parsePrediction(item.prediction as string | undefined);
  const condition = item.custom_conditions?.trim();
  const isPending = (item.status || 'active') === 'pending';

  const liveStatus = liveMatch?.status;
  const liveScore = liveMatch && liveMatch.home_score != null
    ? `${liveMatch.home_score} - ${liveMatch.away_score}`
    : null;
  const liveMinute = liveMatch?.current_minute;

  return (
    <div
      className="card"
      style={{ padding: 0, overflow: 'hidden', cursor: 'pointer' }}
      onDoubleClick={onDoubleClick}
      title="Double-click to view match details"
    >
      {/* Header: time + league + badges */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid var(--gray-100)',
        background: 'var(--gray-50)', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ background: 'var(--gray-200)', padding: '3px 8px', borderRadius: 4, fontWeight: 600, color: 'var(--gray-900)', fontSize: 12 }}>
          {timeDisplay}
        </span>
        <span style={{ fontSize: 12, color: 'var(--gray-500)', flex: 1, textAlign: 'center', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {leagueDisplay}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span className="badge" style={{ background: 'var(--gray-100)', color: 'var(--gray-700)', fontSize: 11 }}>{item.mode}</span>
          <span style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 500 }}>P{priority}</span>
          {isPending
            ? <span className="badge" style={{ background: 'var(--gray-100)', color: '#b45309', border: '1px solid #fde68a', fontSize: 11 }}>Pending</span>
            : <span className="badge" style={{ background: 'var(--gray-100)', color: '#15803d', border: '1px solid #d1fae5', fontSize: 11 }}>Active</span>}
        </div>
      </div>

      {/* Teams */}
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Home */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <img src={homeLogo} loading="lazy" decoding="async" className="team-logo" alt={item.home_team}
            onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER_HOME; }} />
          <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.home_team}</span>
        </div>

        {/* Score / VS */}
        <div style={{ textAlign: 'center', flexShrink: 0, minWidth: 52 }}>
          {liveScore ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--gray-900)' }}>{liveScore}</div>
              {liveMinute && <div style={{ fontSize: 10, color: 'var(--gray-500)' }}>{liveMinute}'</div>}
            </>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>vs</span>
          )}
        </div>

        {/* Away */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{item.away_team}</span>
          <img src={awayLogo} loading="lazy" decoding="async" className="team-logo" alt={item.away_team}
            onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER_AWAY; }} />
        </div>
      </div>

      {/* Live status badge */}
      {liveStatus && (
        <div style={{ padding: '0 12px 6px', display: 'flex', justifyContent: 'center' }}>
          <StatusBadge status={liveStatus} />
        </div>
      )}

      {/* Prediction bar */}
      {pred && (
        <div style={{ padding: '4px 12px 8px' }}>
          {pred.winner && (
            <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 3, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              🏆 {pred.winner}
            </div>
          )}
          <div className="pred-bar" style={{ height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
            {pred.home > 0 && <div className="pred-seg home" style={{ width: `${pred.home}%` }} />}
            {pred.draw > 0 && <div className="pred-seg draw" style={{ width: `${pred.draw}%` }} />}
            {pred.away > 0 && <div className="pred-seg away" style={{ width: `${pred.away}%` }} />}
          </div>
          <div className="pred-percent" style={{ fontSize: 10, marginTop: 2 }}>{pred.home}% | {pred.draw}% | {pred.away}%</div>
        </div>
      )}

      {/* Condition */}
      {condition && (
        <div style={{ padding: '0 12px 8px', fontSize: 11, color: 'var(--gray-500)', borderTop: '1px solid var(--gray-100)', paddingTop: 6 }}>
          <span style={{
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          } as React.CSSProperties}>{condition}</span>
        </div>
      )}

      {/* Actions */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 12px',
        borderTop: '1px solid var(--gray-100)', justifyContent: 'flex-end',
      }}>
        <button className="btn btn-secondary btn-sm action-icon-btn" onClick={onEdit} aria-label="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
        <button className="btn btn-secondary btn-sm btn-delete-row action-icon-btn" onClick={onDelete} aria-label="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export const WatchlistCard = memo(WatchlistCardBase);
