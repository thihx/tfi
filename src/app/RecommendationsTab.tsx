import { useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';

const PAGE_SIZE = 30;

export function RecommendationsTab() {
  const { state, loadAllData } = useAppState();
  const { recommendations } = state;
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(recommendations.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = recommendations.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">🎯 Recommendations</div>
        <button className="btn btn-primary btn-sm" onClick={loadAllData}>🔄 Refresh</button>
      </div>

      <div className="table-container table-cards">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Match</th>
              <th>Bet Type</th>
              <th>Selection</th>
              <th>Odds</th>
              <th>Confidence</th>
              <th>Stake</th>
              <th>Result</th>
              <th>P/L</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={9} className="empty-state">
                <div className="empty-state-icon">🎯</div>
                <p>No recommendations yet</p>
                <p><small>Add matches to watchlist for AI analysis</small></p>
              </td></tr>
            ) : pageItems.map((rec, i) => {
              const pnl = rec.pnl ? `${Number(rec.pnl) >= 0 ? '+' : ''}$${parseFloat(String(rec.pnl)).toFixed(2)}` : '-';
              const confidence = rec.confidence ? `${(parseFloat(String(rec.confidence)) * 100).toFixed(0)}%` : '-';
              return (
                <tr key={i}>
                  <td data-label="Time"><span className="cell-value">{rec.created_at ? new Date(rec.created_at).toLocaleString('vi-VN') : '-'}</span></td>
                  <td data-label="Match"><span className="cell-value match-cell">{rec.match_display || 'N/A'}</span></td>
                  <td data-label="Bet Type"><span className="cell-value">{rec.bet_type || '-'}</span></td>
                  <td data-label="Selection"><span className="cell-value"><strong>{rec.selection || '-'}</strong></span></td>
                  <td data-label="Odds"><span className="cell-value"><strong>{rec.odds || '-'}</strong></span></td>
                  <td data-label="Confidence"><span className="cell-value">{confidence}</span></td>
                  <td data-label="Stake"><span className="cell-value">${rec.stake_amount || '0'}</span></td>
                  <td data-label="Result"><span className="cell-value">{rec.result ? <StatusBadge status={rec.result.toUpperCase()} /> : '-'}</span></td>
                  <td data-label="P/L">
                    <span className="cell-value" style={{ fontWeight: 700, color: Number(rec.pnl) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {pnl}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}
