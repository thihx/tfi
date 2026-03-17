import { memo, useState } from 'react';
import type { Recommendation } from '@/types';
import { StatusBadge } from './StatusBadge';
import { formatLocalDateTime } from '@/lib/utils/helpers';

const RISK_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  LOW:    { bg: 'var(--gray-100)', color: 'var(--gray-600)',  border: 'var(--gray-200)' },
  MEDIUM: { bg: 'var(--gray-100)', color: '#92400e',          border: 'var(--gray-200)' },
  HIGH:   { bg: '#fee2e220',       color: '#b91c1c',          border: '#fca5a520' },
};

interface Props {
  rec: Recommendation;
  onViewMatch?: (matchId: string, display: string) => void;
}

function RecommendationCardBase({ rec, onViewMatch }: Props) {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [warningsExpanded, setWarningsExpanded] = useState(false);

  const pnlVal = rec.pnl != null ? parseFloat(String(rec.pnl)) : null;
  const pnlPositive = pnlVal != null && pnlVal >= 0;
  const conf = rec.confidence != null ? parseFloat(String(rec.confidence)) : null;
  const riskStyle = rec.risk_level ? (RISK_COLORS[rec.risk_level] ?? null) : null;
  const ts = rec.timestamp || rec.created_at;
  const display = rec.home_team && rec.away_team
    ? `${rec.home_team} vs ${rec.away_team}`
    : rec.match_display || 'N/A';
  // Only show LIVE when there's no final result yet
  const isLive = rec.minute != null && (!rec.result || rec.result === 'pending');
  // Validate score looks like "N-N", not a match_id
  const displayScore = rec.score && /^\d{1,3}-\d{1,3}$/.test(rec.score.trim()) ? rec.score : '';

  return (
    <div className="card" style={{ padding: '0', marginBottom: '12px', overflow: 'hidden' }}>

      {/* Header: Match + League + Time */}
      <div style={{
        padding: '14px 18px 12px',
        borderBottom: '1px solid var(--gray-200)',
        background: 'linear-gradient(180deg, #fafbfc 0%, #ffffff 100%)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: rec.match_id && onViewMatch ? 'var(--gray-800)' : 'var(--gray-900)',
              cursor: rec.match_id && onViewMatch ? 'pointer' : undefined,
              letterSpacing: '-0.2px',
              marginBottom: '3px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            onClick={() => rec.match_id && onViewMatch?.(rec.match_id, display)}
            title={display}
          >
            {display}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--gray-500)', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {rec.league && <span>{rec.league}</span>}
            {rec.league && ts && <span style={{ color: 'var(--gray-300)' }}>·</span>}
            {ts && <span>{formatLocalDateTime(ts)}</span>}
          </div>
        </div>

        {/* Live badge + score/minute */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {isLive && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span className="badge badge-live" style={{ fontSize: '11px', padding: '2px 7px' }}>LIVE</span>
              {displayScore && <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--gray-900)' }}>{displayScore}</span>}
              <span style={{ fontSize: '12px', color: 'var(--gray-500)' }}>{rec.minute}&apos;</span>
            </span>
          )}
          {rec.result && <StatusBadge status={rec.result.toUpperCase()} />}
        </div>
      </div>

      {/* Core Bet Info */}
      <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '12px' }}>

        {/* Selection */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '3px' }}>Selection</div>
          <div style={{ fontWeight: 600, color: 'var(--gray-900)', fontSize: '13px' }}>{rec.selection || '—'}</div>
          {(rec.bet_market || rec.bet_type) && (
            <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '2px' }}>{rec.bet_market || rec.bet_type}</div>
          )}
        </div>

        {/* Odds */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '3px' }}>Odds</div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--gray-800)' }}>{rec.odds || '—'}</div>
        </div>

        {/* Confidence */}
        {conf != null && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '3px' }}>Confidence</div>
            <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--gray-700)' }}>
              {conf}/10
            </div>
            <div style={{ height: '3px', background: 'var(--gray-200)', borderRadius: '2px', marginTop: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${conf * 10}%`, height: '100%', background: 'var(--gray-400)', borderRadius: '2px', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* Risk */}
        {rec.risk_level && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '5px' }}>Risk</div>
            <span style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
              fontSize: '11px', fontWeight: 600,
              color: riskStyle?.color ?? 'var(--gray-600)',
              background: riskStyle?.bg ?? 'var(--gray-100)',
              border: `1px solid ${riskStyle?.border ?? 'var(--gray-200)'}`,
            }}>
              {rec.risk_level}
            </span>
          </div>
        )}

        {/* Value % */}
        {rec.value_percent != null && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '3px' }}>Value</div>
            <div style={{ fontWeight: 600, color: 'var(--gray-700)', fontSize: '13px' }}>
              +{parseFloat(String(rec.value_percent)).toFixed(1)}%
            </div>
          </div>
        )}

        {/* Stake */}
        {rec.stake_percent != null && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '3px' }}>Stake</div>
            <div style={{ fontWeight: 600, color: 'var(--gray-700)', fontSize: '13px' }}>
              {parseFloat(String(rec.stake_percent)).toFixed(0)}%
            </div>
          </div>
        )}

        {/* P/L */}
        {pnlVal != null && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '3px' }}>P/L</div>
            <div style={{ fontWeight: 600, fontSize: '13px', color: pnlPositive ? '#15803d' : '#b91c1c' }}>
              {pnlPositive ? '+' : ''}${pnlVal.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {/* Key Factors */}
      {rec.key_factors && (
        <div style={{ padding: '8px 18px', borderTop: '1px solid var(--gray-100)', display: 'flex', gap: '8px', alignItems: 'baseline' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', flexShrink: 0 }}>
            Factors
          </div>
          <div style={{ fontSize: '12px', color: 'var(--gray-600)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rec.key_factors}</div>
        </div>
      )}

      {/* Warnings — collapsible, hidden when empty */}
      {rec.warnings && !(Array.isArray(rec.warnings) && rec.warnings.length === 0) && String(rec.warnings) !== '[]' && String(rec.warnings).trim() !== '' && (
        <div style={{ borderTop: '1px solid var(--gray-100)' }}>
          <button
            style={{
              width: '100%', padding: '9px 18px', background: 'none', border: 'none',
              cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
            onClick={() => setWarningsExpanded((v) => !v)}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#92400e' }}>Warnings</span>
            <span style={{ fontSize: '10px', color: 'var(--gray-400)' }}>{warningsExpanded ? '▲' : '▼'}</span>
          </button>
          {warningsExpanded && (
            <div style={{ padding: '0 18px 14px', fontSize: '12px', color: '#92400e', lineHeight: 1.6 }}>
              {String(rec.warnings)}
            </div>
          )}
        </div>
      )}

      {/* AI Reasoning (collapsible) */}
      {rec.reasoning && (
        <div style={{ borderTop: '1px solid var(--gray-100)' }}>
          <button
            style={{
              width: '100%', padding: '9px 18px', background: 'none', border: 'none',
              cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
            onClick={() => setReasoningExpanded((v) => !v)}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-500)' }}>
              AI Reasoning
              {rec.ai_model && <span style={{ fontWeight: 400, color: 'var(--gray-400)' }}> · {rec.ai_model}</span>}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--gray-400)' }}>{reasoningExpanded ? '▲' : '▼'}</span>
          </button>
          {reasoningExpanded && (
            <div style={{ padding: '0 18px 14px', fontSize: '13px', color: 'var(--gray-600)', lineHeight: 1.6 }}>
              {rec.reasoning}
            </div>
          )}
        </div>
      )}

      {/* Outcome / FT score footer */}
      {(rec.ft_score || rec.actual_outcome) && (
        <div style={{
          padding: '9px 18px', borderTop: '1px solid var(--gray-200)',
          background: 'linear-gradient(180deg, #ffffff 0%, #fafbfc 100%)',
          display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap',
        }}>
          {rec.ft_score && (
            <span style={{ fontSize: '12px', color: 'var(--gray-600)', fontWeight: 600 }}>
              FT: <span style={{ color: 'var(--gray-900)' }}>{rec.ft_score}</span>
            </span>
          )}
          {rec.actual_outcome && (
            <span style={{ fontSize: '12px', color: 'var(--gray-500)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rec.actual_outcome}>
              {rec.actual_outcome}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const RecommendationCard = memo(RecommendationCardBase);
