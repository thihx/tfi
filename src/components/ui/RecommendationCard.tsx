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
  lang?: 'en' | 'vi' | 'both';
  onViewMatch?: (matchId: string, display: string) => void;
}

function pickReasoning(rec: Recommendation, lang?: 'en' | 'vi' | 'both'): string {
  const en = rec.reasoning ?? '';
  const vi = rec.reasoning_vi ?? '';
  if (lang === 'en') return en || vi;
  if (lang === 'both') {
    if (en && vi && en !== vi) return `${en}\n\n${vi}`;
    return en || vi;
  }
  // default: 'vi'
  return vi || en;
}

function RecommendationCardBase({ rec, lang, onViewMatch }: Props) {
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
  const isLive = rec.minute != null && (!rec.result || rec.result === 'pending');
  const displayScore = rec.score && /^\d{1,3}-\d{1,3}$/.test(rec.score.trim()) ? rec.score : '';
  const reasoning = pickReasoning(rec, lang);

  return (
    <div className="card" style={{ padding: '0', marginBottom: '8px', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: '1px solid var(--gray-200)',
        background: 'linear-gradient(180deg, #fafbfc 0%, #ffffff 100%)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '10px',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: rec.match_id && onViewMatch ? 'var(--gray-800)' : 'var(--gray-900)',
              cursor: rec.match_id && onViewMatch ? 'pointer' : undefined,
              letterSpacing: '-0.2px',
              marginBottom: '2px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            onClick={() => rec.match_id && onViewMatch?.(rec.match_id, display)}
            title={display}
          >
            {display}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--gray-500)', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {rec.league && <span>{rec.league}</span>}
            {rec.league && ts && <span style={{ color: 'var(--gray-300)' }}>·</span>}
            {ts && <span>{formatLocalDateTime(ts)}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {isLive && (
            <span
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: rec.match_id && onViewMatch ? 'pointer' : undefined }}
              onClick={() => rec.match_id && onViewMatch?.(rec.match_id, display)}
              title="Click to view match details"
            >
              <span className="badge badge-live" style={{ fontSize: '10px', padding: '2px 6px' }}>LIVE</span>
              {displayScore && <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--gray-900)' }}>{displayScore}</span>}
              <span style={{ fontSize: '11px', color: 'var(--gray-500)' }}>{rec.minute}&apos;</span>
            </span>
          )}
          {rec.result && <StatusBadge status={rec.result.toUpperCase()} />}
        </div>
      </div>

      {/* Core Bet Info */}
      <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '8px' }}>

        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '2px' }}>Selection</div>
          <div style={{ fontWeight: 600, color: 'var(--gray-900)', fontSize: '12px' }}>{rec.selection || '—'}</div>
          {(rec.bet_market || rec.bet_type) && (
            <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>{rec.bet_market || rec.bet_type}</div>
          )}
        </div>

        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '2px' }}>Odds</div>
          <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--gray-800)' }}>{rec.odds || '—'}</div>
        </div>

        {conf != null && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '2px' }}>Confidence</div>
            <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--gray-700)' }}>{conf}/10</div>
            <div style={{ height: '3px', background: 'var(--gray-200)', borderRadius: '2px', marginTop: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${conf * 10}%`, height: '100%', background: 'var(--gray-400)', borderRadius: '2px', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {rec.risk_level && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '4px' }}>Risk</div>
            <span style={{
              display: 'inline-block', padding: '1px 7px', borderRadius: '4px',
              fontSize: '11px', fontWeight: 600,
              color: riskStyle?.color ?? 'var(--gray-600)',
              background: riskStyle?.bg ?? 'var(--gray-100)',
              border: `1px solid ${riskStyle?.border ?? 'var(--gray-200)'}`,
            }}>
              {rec.risk_level}
            </span>
          </div>
        )}

        {rec.value_percent != null && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '2px' }}>Value</div>
            <div style={{ fontWeight: 600, color: 'var(--gray-700)', fontSize: '12px' }}>
              +{parseFloat(String(rec.value_percent)).toFixed(1)}%
            </div>
          </div>
        )}

        {rec.stake_percent != null && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '2px' }}>Stake</div>
            <div style={{ fontWeight: 600, color: 'var(--gray-700)', fontSize: '12px' }}>
              {parseFloat(String(rec.stake_percent)).toFixed(0)}%
            </div>
          </div>
        )}

        {pnlVal != null && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', marginBottom: '2px' }}>P/L</div>
            <div style={{ fontWeight: 600, fontSize: '12px', color: pnlPositive ? '#15803d' : '#b91c1c' }}>
              {pnlPositive ? '+' : ''}${pnlVal.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {/* Key Factors */}
      {rec.key_factors && (
        <div style={{ padding: '6px 14px', borderTop: '1px solid var(--gray-100)', display: 'flex', gap: '8px', alignItems: 'baseline' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)', flexShrink: 0 }}>
            Factors
          </div>
          <div style={{ fontSize: '11px', color: 'var(--gray-600)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rec.key_factors}</div>
        </div>
      )}

      {/* Warnings */}
      {rec.warnings && !(Array.isArray(rec.warnings) && rec.warnings.length === 0) && String(rec.warnings) !== '[]' && String(rec.warnings).trim() !== '' && (
        <div style={{ borderTop: '1px solid var(--gray-100)' }}>
          <button
            style={{
              width: '100%', padding: '7px 14px', background: 'none', border: 'none',
              cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
            onClick={() => setWarningsExpanded((v) => !v)}
          >
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#92400e' }}>Warnings</span>
            <span style={{ fontSize: '10px', color: 'var(--gray-400)' }}>{warningsExpanded ? '▲' : '▼'}</span>
          </button>
          {warningsExpanded && (
            <div style={{ padding: '0 14px 10px', fontSize: '11px', color: '#92400e', lineHeight: 1.6 }}>
              {String(rec.warnings)}
            </div>
          )}
        </div>
      )}

      {/* AI Reasoning */}
      {reasoning && (
        <div style={{ borderTop: '1px solid var(--gray-100)' }}>
          <button
            style={{
              width: '100%', padding: '7px 14px', background: 'none', border: 'none',
              cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
            onClick={() => setReasoningExpanded((v) => !v)}
          >
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)' }}>AI Reasoning</span>
            <span style={{ fontSize: '10px', color: 'var(--gray-400)' }}>{reasoningExpanded ? '▲' : '▼'}</span>
          </button>
          {reasoningExpanded && (
            <div style={{ padding: '0 14px 10px', fontSize: '12px', color: 'var(--gray-600)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {reasoning}
            </div>
          )}
        </div>
      )}

      {/* Outcome / FT score footer */}
      {(rec.ft_score || rec.actual_outcome) && (
        <div style={{
          padding: '7px 14px', borderTop: '1px solid var(--gray-200)',
          background: 'linear-gradient(180deg, #ffffff 0%, #fafbfc 100%)',
          display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap',
        }}>
          {rec.ft_score && (
            <span style={{ fontSize: '11px', color: 'var(--gray-600)', fontWeight: 600 }}>
              FT: <span style={{ color: 'var(--gray-900)' }}>{rec.ft_score}</span>
            </span>
          )}
          {rec.actual_outcome && (
            <span style={{ fontSize: '11px', color: 'var(--gray-500)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rec.actual_outcome}>
              {rec.actual_outcome}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const RecommendationCard = memo(RecommendationCardBase);
