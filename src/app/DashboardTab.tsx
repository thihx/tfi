import { useMemo } from 'react';
import { useAppState } from '@/hooks/useAppState';

export function DashboardTab() {
  const { state } = useAppState();
  const { matches, watchlist, recommendations } = state;

  const stats = useMemo(() => {
    const settled = recommendations.filter((r) => r.result === 'won' || r.result === 'lost');
    const won = settled.filter((r) => r.result === 'won');
    const totalBets = settled.length;
    const winRate = totalBets > 0 ? ((won.length / totalBets) * 100).toFixed(1) : '0';
    const totalPnL = settled.reduce((sum, r) => sum + (parseFloat(String(r.pnl ?? 0))), 0);
    const totalStaked = settled.reduce((sum, r) => sum + (parseFloat(String(r.stake_amount ?? 0))), 0);
    const roi = totalStaked > 0 ? ((totalPnL / totalStaked) * 100).toFixed(1) : '0';
    return { totalBets, winRate, totalPnL, roi: parseFloat(roi) };
  }, [recommendations]);

  const recentItems = recommendations.slice(0, 5);

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Bets</div>
          <div className="stat-value">{stats.totalBets}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Win Rate</div>
          <div className="stat-value">{stats.winRate}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total P/L</div>
          <div className={`stat-value ${stats.totalPnL >= 0 ? 'positive' : 'negative'}`}>
            {stats.totalPnL >= 0 ? '+' : ''}${stats.totalPnL.toFixed(2)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">ROI</div>
          <div className={`stat-value ${stats.roi >= 0 ? 'positive' : 'negative'}`}>
            {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">📈 Recent Activity</div>
        </div>
        <div style={{ padding: '20px' }}>
          <p style={{ color: 'var(--gray-600)', marginBottom: '15px' }}>
            📊 {matches.length} matches | 👁️ {watchlist.length} watchlist | 🎯 {recommendations.length} recommendations
          </p>
        </div>
        {recentItems.length > 0 && (
          <div style={{ borderTop: '1px solid var(--gray-200)' }}>
            <h4 style={{ padding: '15px 20px', margin: 0 }}>Recent Recommendations:</h4>
            {recentItems.map((r, i) => (
              <div key={i} style={{ padding: '15px 20px', borderBottom: '1px solid var(--gray-200)' }}>
                <strong>{r.match_display || 'N/A'}</strong><br />
                <small style={{ color: 'var(--gray-500)' }}>
                  {r.bet_type}: {r.selection} @ {r.odds} -{' '}
                  <span style={{ color: r.result === 'won' ? 'var(--success)' : r.result === 'lost' ? 'var(--danger)' : 'var(--gray-500)' }}>
                    {r.result || 'pending'}
                  </span>
                </small>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
