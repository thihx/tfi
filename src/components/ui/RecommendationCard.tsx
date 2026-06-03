import { memo, useState, type ReactNode } from 'react';
import type { Recommendation } from '@/types';
import { StatusBadge } from './StatusBadge';
import { formatLocalDateTime } from '@/lib/utils/helpers';

const RISK_CLASS: Record<string, string> = {
  LOW: 'rec-card__risk--low',
  MEDIUM: 'rec-card__risk--medium',
  HIGH: 'rec-card__risk--high',
};

const SIGNAL_CLASS: Record<NonNullable<Recommendation['signal_kind']>, string> = {
  bet: 'badge-won',
  watch: 'badge-pending',
  no_action: 'badge-draw',
};

interface Props {
  rec: Recommendation;
  lang?: 'en' | 'vi' | 'both';
  onViewMatch?: (matchId: string, display: string) => void;
  adminAction?: ReactNode;
}

const FINAL_RESULTS = new Set(['win', 'loss', 'push', 'void', 'half_win', 'half_loss']);

function hasFinalResult(result: string | null | undefined): boolean {
  return FINAL_RESULTS.has(String(result));
}

const SCORE_PAIR_RE = /^\d{1,3}-\d{1,3}$/;

function isValidScorePair(s: string | null | undefined): boolean {
  return Boolean(s && SCORE_PAIR_RE.test(s.trim()));
}

function formatSettledMatchScores(rec: Recommendation): string | null {
  const ft = isValidScorePair(rec.ft_score ?? undefined) ? rec.ft_score!.trim() : '';
  const ht = isValidScorePair(rec.ht_score ?? undefined) ? rec.ht_score!.trim() : '';
  const cr = isValidScorePair(rec.corners_ft ?? undefined) ? rec.corners_ft!.trim() : '';

  const parts: string[] = [];
  if (ft) {
    parts.push(ht ? `FT ${ft} (HT ${ht})` : `FT ${ft}`);
  } else if (ht) {
    parts.push(`HT ${ht}`);
  }
  if (cr) {
    parts.push(`Cr ${cr}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function pickReasoning(rec: Recommendation, lang?: 'en' | 'vi' | 'both'): string {
  const en = rec.reasoning ?? '';
  const vi = rec.reasoning_vi ?? '';
  if (lang === 'en') return en || vi;
  if (lang === 'both') {
    if (en && vi && en !== vi) return `${en}\n\n${vi}`;
    return en || vi;
  }
  return vi || en;
}

function formatBankrollAmount(value: unknown, rec: Recommendation): string {
  const amount = parseFloat(String(value ?? 0));
  if (!Number.isFinite(amount) || amount <= 0) return '';
  const currency = rec.bankroll_currency ?? '';
  const multiplier = Number(rec.bankroll_unit_multiplier ?? 1);
  const display = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  if (Number.isFinite(multiplier) && multiplier > 1) {
    const full = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount * multiplier);
    return currency ? `${display} (${full} ${currency})` : `${display} (${full})`;
  }
  return currency ? `${display} ${currency}` : display;
}

function parseFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function confidenceBarClass(conf: number): string {
  if (conf >= 8) return 'rec-card__conf-fill--high';
  if (conf >= 5) return 'rec-card__conf-fill--mid';
  return 'rec-card__conf-fill--low';
}

function RecommendationCardBase({ rec, lang, onViewMatch, adminAction }: Props) {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [warningsExpanded, setWarningsExpanded] = useState(false);

  const pnlVal = rec.pnl != null ? parseFloat(String(rec.pnl)) : null;
  const pnlPositive = pnlVal != null && pnlVal >= 0;
  const conf = parseFiniteNumber(rec.confidence);
  const ts = rec.timestamp || rec.created_at;
  const display = rec.home_team && rec.away_team
    ? `${rec.home_team} vs ${rec.away_team}`
    : rec.match_display || 'N/A';
  const isLive = rec.minute != null && (!rec.result || rec.result === 'pending');
  const displayScore = rec.score && /^\d{1,3}-\d{1,3}$/.test(rec.score.trim()) ? rec.score : '';
  const reasoning = pickReasoning(rec, lang);
  const showReviewBadge = rec.settlement_status === 'unresolved' && hasFinalResult(rec.result ?? null);
  const showPendingNote = rec.settlement_status === 'unresolved' && !hasFinalResult(rec.result ?? null);
  const settledScoreLine = formatSettledMatchScores(rec);
  const stakeAmountText = formatBankrollAmount(rec.stake_amount, rec);
  const bankrollText = formatBankrollAmount(rec.bankroll_balance_before, rec);
  const valuePercent = parseFiniteNumber(rec.value_percent);
  const stakePercent = parseFiniteNumber(rec.stake_percent);
  const signalKind = rec.signal_kind;
  const signalLabel = rec.signal_label || (
    signalKind === 'watch' ? 'Watch' : signalKind === 'no_action' ? 'No Action' : signalKind === 'bet' ? 'Bet' : ''
  );
  const selectionLabel = signalKind === 'watch'
    ? 'Watch Signal'
    : signalKind === 'no_action'
      ? 'Status'
      : 'Selection';

  return (
    <div className="card rec-card">

      <div className="rec-card__header">
        <div className="rec-card__header-main">
          <div
            className={`rec-card__match${onViewMatch ? ' rec-card__match--link' : ''}`}
            onClick={() => onViewMatch?.(rec.match_id ?? '', display)}
            title={display}
          >
            {display}
          </div>
          {(rec.league || ts) && (
            <div
              className="rec-card__meta"
              title={[rec.league, ts ? formatLocalDateTime(ts) : ''].filter(Boolean).join(' · ')}
            >
              {[rec.league, ts ? formatLocalDateTime(ts) : ''].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        <div className="rec-card__header-actions">
          {isLive && (
            <span
              className={onViewMatch ? 'rec-card__live rec-card__live--link' : 'rec-card__live'}
              onClick={() => onViewMatch?.(rec.match_id ?? '', display)}
              title="Click to view match details"
            >
              {displayScore && <span className="rec-card__live-score">{displayScore}</span>}
            </span>
          )}
          {rec.result && <StatusBadge status={rec.result.toUpperCase()} />}
          {signalKind && signalLabel && (
            <span className={`badge ${SIGNAL_CLASS[signalKind]}`}>
              {signalLabel}
            </span>
          )}
          {showReviewBadge && (
            <span className="badge badge-pending">Review</span>
          )}
          {adminAction}
        </div>
      </div>

      <div className="rec-card__primary">
        <div className="rec-card__field rec-card__field--selection">
          <div className="rec-card__label">{selectionLabel}</div>
          <div className="rec-card__value rec-card__value--strong">{rec.selection || '—'}</div>
          {rec.signal_detail && signalKind && signalKind !== 'bet' && (
            <div className="rec-card__meta" title={rec.signal_detail}>{rec.signal_detail}</div>
          )}
        </div>
        <div className="rec-card__field">
          <div className="rec-card__label">Odds</div>
          <div className="rec-card__value rec-card__value--odds">{rec.odds || '—'}</div>
        </div>
        {pnlVal != null && (
          <div className="rec-card__field">
            <div className="rec-card__label">P/L</div>
            <div className={`rec-card__value ${pnlPositive ? 'text-positive' : 'text-negative'}`}>
              {pnlPositive ? '+' : ''}${pnlVal.toFixed(2)}
            </div>
          </div>
        )}
        {rec.minute != null && (
          <div className="rec-card__field">
            <div className="rec-card__label">Minute</div>
            <div className="rec-card__value">{rec.minute}&apos;</div>
          </div>
        )}
      </div>

      <div className="rec-card__secondary">
        {conf != null && (
          <div className="rec-card__field">
            <div className="rec-card__label">Confidence</div>
            <div className="rec-card__value">{conf}/10</div>
            <div className="rec-card__conf-bar">
              <div className={`rec-card__conf-fill ${confidenceBarClass(conf)}`} style={{ width: `${conf * 10}%` }} />
            </div>
          </div>
        )}

        {rec.risk_level && (
          <div className="rec-card__field">
            <div className="rec-card__label">Risk</div>
            <span className={`rec-card__risk ${RISK_CLASS[rec.risk_level] ?? ''}`}>
              {rec.risk_level}
            </span>
          </div>
        )}

        {valuePercent != null && (
          <div className="rec-card__field">
            <div className="rec-card__label">Value</div>
            <div className="rec-card__value">
              {valuePercent >= 0 ? '+' : ''}{valuePercent.toFixed(1)}%
            </div>
          </div>
        )}

        {stakePercent != null && (
          <div className="rec-card__field">
            <div className="rec-card__label">Stake</div>
            <div className="rec-card__value">
              {stakePercent.toFixed(0)}%
            </div>
          </div>
        )}

        {stakeAmountText && (
          <div className="rec-card__field">
            <div className="rec-card__label">Bet Amount</div>
            <div className="rec-card__value">{stakeAmountText}</div>
          </div>
        )}

        {bankrollText && (
          <div className="rec-card__field">
            <div className="rec-card__label">Bankroll</div>
            <div className="rec-card__value">{bankrollText}</div>
          </div>
        )}
      </div>

      {rec.key_factors && (
        <div className="rec-card__factors">
          <div className="rec-card__label">Factors</div>
          <div className="rec-card__factors-text">{rec.key_factors}</div>
        </div>
      )}

      {rec.warnings && !(Array.isArray(rec.warnings) && rec.warnings.length === 0) && String(rec.warnings) !== '[]' && String(rec.warnings).trim() !== '' && (
        <div className="rec-card__expand">
          <button
            type="button"
            className="rec-card__expand-btn rec-card__expand-btn--warnings"
            onClick={() => setWarningsExpanded((v) => !v)}
            aria-expanded={warningsExpanded}
          >
            <span className="rec-card__expand-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Warnings
            </span>
            <span className="rec-card__expand-caret" aria-hidden>{warningsExpanded ? '▲' : '▼'}</span>
          </button>
          {warningsExpanded && (
            <div className="rec-card__expand-body rec-card__expand-body--warnings">
              {String(rec.warnings)}
            </div>
          )}
        </div>
      )}

      {reasoning && (
        <div className="rec-card__expand">
          <button
            type="button"
            className="rec-card__expand-btn"
            onClick={() => setReasoningExpanded((v) => !v)}
            aria-expanded={reasoningExpanded}
          >
            <span className="rec-card__expand-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="12" y1="2" x2="12" y2="3"/><path d="M12 6a6 6 0 0 1 6 6c0 2.5-1.5 4.5-3.5 5.5V19a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1.5C7.5 16.5 6 14.5 6 12a6 6 0 0 1 6-6z"/><line x1="9" y1="21" x2="15" y2="21"/></svg>
              Reasoning
            </span>
            <span className="rec-card__expand-caret" aria-hidden>{reasoningExpanded ? '▲' : '▼'}</span>
          </button>
          {reasoningExpanded && (
            <div className="rec-card__expand-body">
              {reasoning}
            </div>
          )}
        </div>
      )}

      {(settledScoreLine || rec.actual_outcome || ((showReviewBadge || showPendingNote) && rec.settlement_note)) && (
        <div className="rec-card__footer">
          {settledScoreLine && (
            <span
              className="rec-card__footer-score"
              title="Kết quả trận (FT/HT bàn thắng; Cr = phạt góc cả trận nếu có trong dữ liệu)"
            >
              {settledScoreLine}
            </span>
          )}
          {rec.actual_outcome && (
            <span className="rec-card__footer-outcome" title={rec.actual_outcome}>
              {rec.actual_outcome}
            </span>
          )}
          {showReviewBadge && rec.settlement_note && (
            <span className="rec-card__footer-note rec-card__footer-note--review" title={rec.settlement_note}>
              Review: {rec.settlement_note}
            </span>
          )}
          {showPendingNote && rec.settlement_note && (
            <span className="rec-card__footer-note" title={rec.settlement_note}>
              Pending: {rec.settlement_note}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const RecommendationCard = memo(RecommendationCardBase);
