// Shared panels for MatchHubModal (strategic context, picks, bets)
import type { ReactNode } from 'react';
import { RecommendationCard } from '@/components/ui/RecommendationCard';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { useUiLanguage } from '@/hooks/useUiLanguage';
import type { Recommendation, WatchlistItem } from '@/types';
import {
  getStrategicNarrative,
  getStrategicQuantitativeEntries,
  getStrategicRefreshMeta,
  getStrategicSourceMeta,
  hasStrategicNarrative,
  isStructuredStrategicContext,
} from '@/lib/utils/strategicContext';
import type { BetRecord } from '@/lib/services/api';
import { BET_RESULT_BADGES } from '@/config/constants';

export function MatchHubContextView({ watchlist, recs }: { watchlist: WatchlistItem | null; recs: Recommendation[] }) {
  const uiLanguage = useUiLanguage();
  const latestRec = recs.length > 0
    ? [...recs].sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())[0]
    : null;

  const ctx = watchlist?.strategic_context;
  const hasContext = hasStrategicNarrative(ctx, uiLanguage);
  const hasConditions = !!(watchlist?.custom_conditions || watchlist?.recommended_custom_condition);
  const hasReasoning = !!(latestRec?.reasoning || latestRec?.key_factors || latestRec?.warnings);
  const summary = getStrategicNarrative(ctx, 'summary', uiLanguage);
  const homeMotivation = getStrategicNarrative(ctx, 'home_motivation', uiLanguage);
  const awayMotivation = getStrategicNarrative(ctx, 'away_motivation', uiLanguage);
  const leaguePositions = getStrategicNarrative(ctx, 'league_positions', uiLanguage);
  const fixtureCongestion = getStrategicNarrative(ctx, 'fixture_congestion', uiLanguage);
  const homeFixtureCongestion = getStrategicNarrative(ctx, 'home_fixture_congestion', uiLanguage);
  const awayFixtureCongestion = getStrategicNarrative(ctx, 'away_fixture_congestion', uiLanguage);
  const rotationRisk = getStrategicNarrative(ctx, 'rotation_risk', uiLanguage);
  const keyAbsences = getStrategicNarrative(ctx, 'key_absences', uiLanguage);
  const homeKeyAbsences = getStrategicNarrative(ctx, 'home_key_absences', uiLanguage);
  const awayKeyAbsences = getStrategicNarrative(ctx, 'away_key_absences', uiLanguage);
  const h2hNarrative = getStrategicNarrative(ctx, 'h2h_narrative', uiLanguage);
  const sourceMeta = getStrategicSourceMeta(ctx);
  const refreshMeta = getStrategicRefreshMeta(ctx);
  const quantitativeEntries = getStrategicQuantitativeEntries(ctx);
  const structuredContext = isStructuredStrategicContext(ctx);
  const trustedDomains = Array.from(new Set((sourceMeta?.sources || []).map((source) => source.domain).filter(Boolean)));
  const searchQueries = (sourceMeta?.web_search_queries || []).filter(Boolean);

  if (!watchlist && !latestRec) {
    return (
      <MatchHubEmptyState
        icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
        message="No context data available for this match"
      />
    );
  }

  return (
    <div className="match-hub-stack">
      {hasConditions && (
        <HubSection title="Betting Conditions">
          <div className="strategic-context-stack-grid">
            {watchlist?.custom_conditions && (
              <InfoBlock label="Custom Condition" value={watchlist.custom_conditions} />
            )}
            {watchlist?.recommended_custom_condition && (
              <InfoBlock label="Suggested condition" value={watchlist.recommended_custom_condition} highlight />
            )}
            {watchlist?.recommended_condition_reason_vi && (
              <InfoBlock label="Reason (VI)" value={watchlist.recommended_condition_reason_vi} colSpan />
            )}
            {watchlist?.recommended_condition_reason && !watchlist?.recommended_condition_reason_vi && (
              <InfoBlock label="Reason" value={watchlist.recommended_condition_reason} colSpan />
            )}
          </div>
        </HubSection>
      )}

      {hasContext && ctx && (
        <HubSection title="Strategic Context">
          {(structuredContext || refreshMeta) && (
            <div className="strategic-context-stack-grid strategic-context-stack-grid--tight strategic-context-stack-grid--meta">
              {structuredContext && (
                <>
                  <InfoBlock label="Source Quality" value={sourceMeta?.search_quality || 'unknown'} />
                  <InfoBlock label="Trusted Sources" value={String(sourceMeta?.trusted_source_count ?? 0)} />
                  {ctx.competition_type && <InfoBlock label="Competition Type" value={ctx.competition_type} />}
                </>
              )}
              {refreshMeta?.refresh_status && <InfoBlock label="Refresh Status" value={refreshMeta.refresh_status} />}
              {refreshMeta?.retry_after && <InfoBlock label="Retry After" value={formatLocalDateTime(refreshMeta.retry_after)} />}
              {refreshMeta?.last_error && <InfoBlock label="Last Error" value={refreshMeta.last_error} colSpan warn />}
            </div>
          )}
          {summary && (
            <div className="strategic-context-lede">
              {summary}
            </div>
          )}
          <div className="strategic-context-stack-grid strategic-context-stack-grid--tight">
            {homeMotivation && <InfoBlock label="Home Motivation" value={homeMotivation} />}
            {awayMotivation && <InfoBlock label="Away Motivation" value={awayMotivation} />}
            {leaguePositions && <InfoBlock label="League Positions" value={leaguePositions} />}
            {homeFixtureCongestion && <InfoBlock label={`Home Congestion (${watchlist?.home_team || 'Home'})`} value={homeFixtureCongestion} />}
            {awayFixtureCongestion && <InfoBlock label={`Away Congestion (${watchlist?.away_team || 'Away'})`} value={awayFixtureCongestion} />}
            {fixtureCongestion && <InfoBlock label="Fixture Congestion Summary" value={fixtureCongestion} />}
            {rotationRisk && <InfoBlock label="Rotation Risk" value={rotationRisk} />}
            {homeKeyAbsences && <InfoBlock label={`Home Absences (${watchlist?.home_team || 'Home'})`} value={homeKeyAbsences} />}
            {awayKeyAbsences && <InfoBlock label={`Away Absences (${watchlist?.away_team || 'Away'})`} value={awayKeyAbsences} />}
            {keyAbsences && <InfoBlock label="Key Absences Summary" value={keyAbsences} />}
            {h2hNarrative && <InfoBlock label="H2H Narrative" value={h2hNarrative} colSpan />}
            {ctx.ai_condition && <InfoBlock label="Condition signal" value={ctx.ai_condition} highlight />}
            {ctx.ai_condition_reason_vi && <InfoBlock label="Condition Reason (VI)" value={ctx.ai_condition_reason_vi} colSpan />}
            {structuredContext && quantitativeEntries.length > 0 && (
              <InfoBlock
                label="Quantitative Priors"
                value={quantitativeEntries.map((entry) => `${entry.label}: ${entry.value}`).join(' | ')}
                colSpan
              />
            )}
            {structuredContext && trustedDomains.length > 0 && (
              <InfoBlock label="Trusted Domains" value={trustedDomains.join(', ')} colSpan />
            )}
            {structuredContext && searchQueries.length > 0 && (
              <InfoBlock label="Search Queries" value={searchQueries.join(' | ')} colSpan />
            )}
            {!structuredContext && (
              <InfoBlock
                label="Trust Note"
                value="Legacy context detected. Trust metadata is missing, so this context should be refreshed before relying on it."
                colSpan
                warn
              />
            )}
          </div>
          {ctx.searched_at && (
            <div className="strategic-context-footnote">
              Context captured: {formatLocalDateTime(ctx.searched_at)}
            </div>
          )}
        </HubSection>
      )}

      {hasReasoning && latestRec && (
        <HubSection title={`Latest analysis${latestRec.minute != null ? ` @ ${latestRec.minute}'` : ''}`}>
          {latestRec.reasoning && (
            <InfoBlock label="Reasoning" value={latestRec.reasoning} colSpan />
          )}
          {latestRec.key_factors && (
            <InfoBlock label="Key Factors" value={latestRec.key_factors} colSpan />
          )}
          {latestRec.warnings && (
            <InfoBlock label="Warnings" value={latestRec.warnings} colSpan warn />
          )}
          <div className="strategic-context-footnote strategic-context-footnote--neutral">
            {latestRec.ai_model && <span>Model: {latestRec.ai_model} · </span>}
            {latestRec.created_at && <span>Generated: {formatLocalDateTime(latestRec.created_at)}</span>}
          </div>
        </HubSection>
      )}

      {!hasContext && !hasConditions && !hasReasoning && (
        <MatchHubEmptyState
          icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
          message="No enriched context available yet — run Enrich Watchlist job to populate"
        />
      )}
    </div>
  );
}

function HubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="strategic-context-subtitle">{title}</div>
      {children}
    </div>
  );
}

function InfoBlock({ label, value, highlight, warn, colSpan }: {
  label: string; value: string; highlight?: boolean; warn?: boolean; colSpan?: boolean;
}) {
  const valueCls = [
    'strategic-context-stack-value',
    highlight && 'strategic-context-stack-value--highlight',
    warn && 'strategic-context-stack-value--warn',
  ].filter(Boolean).join(' ');
  return (
    <div className={colSpan ? 'strategic-context-stack--span' : undefined}>
      <div className="strategic-context-label strategic-context-label--block">{label}</div>
      <div className={valueCls}>{value}</div>
    </div>
  );
}

export function MatchHubRecsView({ recs }: { recs: Recommendation[] }) {
  if (!recs.length) {
    return (
      <MatchHubEmptyState
        icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>}
        message="No recommendations for this match yet"
      />
    );
  }
  return (
    <div className="match-hub-scroll-panel">
      {recs.map((rec, i) => (
        <RecommendationCard key={rec.id ?? i} rec={rec} />
      ))}
    </div>
  );
}

export function MatchHubBetsView({ bets }: { bets: BetRecord[] }) {
  if (!bets.length) {
    return (
      <MatchHubEmptyState
        icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>}
        message="No bets recorded for this match"
      />
    );
  }

  const totalPnl = bets
    .filter((b) => b.result !== 'pending')
    .reduce((s, b) => s + (b.pnl ?? 0), 0);

  return (
    <div>
      <div className="match-hub-bets-meta">
        <span className="match-hub-bets-meta-muted">{bets.length} bet{bets.length !== 1 ? 's' : ''}</span>
        <span className="match-hub-bets-meta-muted match-hub-bets-meta-icons">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> {bets.filter((b) => b.result === 'win').length}W ·{' '}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> {bets.filter((b) => b.result === 'loss').length}L ·{' '}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> {bets.filter((b) => b.result === 'pending').length} open
        </span>
        {bets.some((b) => b.result !== 'pending') && (
          <span
            className={`match-hub-bets-meta-pnl ${totalPnl >= 0 ? 'match-hub-bets-meta-pnl--pos' : 'match-hub-bets-meta-pnl--neg'}`}
          >
            P/L: {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
          </span>
        )}
      </div>

      <div className="table-container match-hub-bets-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th>Selection</th>
              <th className="match-hub-bets-th-center">Odds</th>
              <th className="match-hub-bets-th-center">Stake</th>
              <th>Bookmaker</th>
              <th className="match-hub-bets-th-center">Result</th>
              <th className="match-hub-bets-th-right">P/L</th>
            </tr>
          </thead>
          <tbody>
            {bets.map((bet) => {
              const badge = BET_RESULT_BADGES[bet.result] ?? { cls: '', label: bet.result };
              const pnl = bet.pnl ?? 0;
              return (
                <tr key={bet.id}>
                  <td className="match-hub-bets-td-muted">{bet.market || '—'}</td>
                  <td className="match-hub-bets-td-strong">{bet.selection}</td>
                  <td className="match-hub-bets-td-odds">{bet.odds}</td>
                  <td className="match-hub-bets-td-center">${bet.stake.toFixed(2)}</td>
                  <td className="match-hub-bets-td-muted">{bet.bookmaker || '—'}</td>
                  <td className="match-hub-bets-td-center">
                    <span className={`badge ${badge.cls} match-hub-bets-badge`}>{badge.label}</span>
                  </td>
                  <td
                    className={`match-hub-bets-td-pnl ${
                      bet.result === 'pending'
                        ? ''
                        : pnl >= 0
                          ? 'match-hub-bets-td-pnl--pos'
                          : 'match-hub-bets-td-pnl--neg'
                    }`}
                  >
                    {bet.result === 'pending' ? '—' : `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MatchHubEmptyState({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="match-hub-empty">
      <div className="match-hub-empty-icon">{icon}</div>
      <p>{message}</p>
    </div>
  );
}
