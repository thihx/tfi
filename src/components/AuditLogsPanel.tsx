// ============================================================
// Audit Logs Panel — Displays audit trail with filters & stats
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { getToken } from '@/lib/services/auth';
import { internalApiUrl } from '@/lib/internal-api';

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

interface AuditLogEntry {
  id: number;
  timestamp: string;
  category: string;
  action: string;
  outcome: string;
  actor: string;
  match_id: string | null;
  duration_ms: number | null;
  metadata: Record<string, unknown> | null;
  error: string | null;
}

function getMatchDisplay(log: AuditLogEntry): string {
  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : null;
  const matchDisplay = typeof metadata?.matchDisplay === 'string' ? metadata.matchDisplay.trim() : '';
  if (matchDisplay) return matchDisplay;
  return log.match_id ?? '—';
}

interface AuditStats {
  totalLogs: number;
  last24h: number;
  byCategory: Record<string, number>;
  failureRate: number;
}

const OUTCOME_COLORS: Record<string, { bg: string; text: string }> = {
  SUCCESS:  { bg: '#dcfce7', text: '#166534' },
  FAILURE:  { bg: '#fee2e2', text: '#991b1b' },
  SKIPPED:  { bg: '#fef3c7', text: '#92400e' },
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  PIPELINE:        { bg: '#dbeafe', text: '#1e40af' },
  SCHEDULER:       { bg: '#e0e7ff', text: '#3730a3' },
  AI:              { bg: '#fae8ff', text: '#86198f' },
  JOB:             { bg: '#f0fdf4', text: '#166534' },
  NOTIFICATION:    { bg: '#fff7ed', text: '#9a3412' },
  RECOMMENDATION:  { bg: '#fdf2f8', text: '#9d174d' },
};

function Badge({ label, colors }: { label: string; colors?: { bg: string; text: string } }) {
  const c = colors ?? { bg: '#f3f4f6', text: '#374151' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '11px',
        fontWeight: 600,
        background: c.bg,
        color: c.text,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

const PAGE_SIZE = 25;

export function AuditLogsPanel() {
  const { state } = useAppState();
  const apiUrl = state.config.apiUrl;

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filters
  const [filterCategory, setFilterCategory] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterPrematchStrength, setFilterPrematchStrength] = useState('');
  const [filterPrematchNoiseMin, setFilterPrematchNoiseMin] = useState('');

  // Expanded row
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchStats = useCallback(async () => {
    if (apiUrl == null) return;
    try {
      const res = await fetch(internalApiUrl('/api/audit-logs/stats', apiUrl), {
        headers: authHeaders(),
        credentials: 'include',
      });
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ }
  }, [apiUrl]);

  const fetchLogs = useCallback(async () => {
    if (apiUrl == null) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String((page - 1) * PAGE_SIZE));
      if (filterCategory) params.set('category', filterCategory);
      if (filterOutcome) params.set('outcome', filterOutcome);
      if (filterAction) params.set('action', filterAction);
      if (filterPrematchStrength) params.set('prematchStrength', filterPrematchStrength);
      if (filterPrematchNoiseMin) params.set('prematchNoiseMin', filterPrematchNoiseMin);

      const res = await fetch(`${internalApiUrl('/api/audit-logs', apiUrl)}?${params.toString()}`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.rows ?? data.logs);
        setTotal(data.total);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [apiUrl, page, filterCategory, filterOutcome, filterAction, filterPrematchStrength, filterPrematchNoiseMin]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void fetchStats();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [fetchStats]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void fetchLogs();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  const handleExport = async () => {
    if (apiUrl == null) return;
    try {
      const params = new URLSearchParams();
      params.set('limit', '5000');
      if (filterCategory) params.set('category', filterCategory);
      if (filterOutcome) params.set('outcome', filterOutcome);
      if (filterAction) params.set('action', filterAction);
      if (filterPrematchStrength) params.set('prematchStrength', filterPrematchStrength);
      if (filterPrematchNoiseMin) params.set('prematchNoiseMin', filterPrematchNoiseMin);

      const res = await fetch(`${internalApiUrl('/api/audit-logs', apiUrl)}?${params.toString()}`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      const rows = ((data.rows ?? data.logs) as AuditLogEntry[]).map((l) => ({
        id: l.id,
        timestamp: l.timestamp,
        category: l.category,
        action: l.action,
        outcome: l.outcome,
        actor: l.actor,
        match_id: l.match_id ?? '',
        duration_ms: l.duration_ms ?? '',
        error: l.error ?? '',
        metadata: l.metadata ? JSON.stringify(l.metadata) : '',
      }));

      const headers = Object.keys(rows[0] ?? {});
      const csv = [
        headers.join(','),
        ...rows.map((r) =>
          headers.map((h) => `"${String((r as Record<string, unknown>)[h]).replace(/"/g, '""')}"`).join(','),
        ),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  if (apiUrl == null) {
    return <p style={{ color: 'var(--gray-500)' }}>Backend URL not configured</p>;
  }

  return (
    <div>
      {/* Stats cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          <div className="stat-card" style={{ padding: '12px', background: 'var(--gray-50)', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: 700 }}>{stats.totalLogs.toLocaleString()}</div>
            <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Total Logs</div>
          </div>
          <div className="stat-card" style={{ padding: '12px', background: 'var(--gray-50)', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: 700 }}>{stats.last24h.toLocaleString()}</div>
            <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Last 24h</div>
          </div>
          <div className="stat-card" style={{ padding: '12px', background: 'var(--gray-50)', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: stats.failureRate > 10 ? '#dc2626' : 'inherit' }}>
              {stats.failureRate.toFixed(1)}%
            </div>
            <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Failure Rate</div>
          </div>
          {Object.entries(stats.byCategory).map(([cat, count]) => (
            <div key={cat} className="stat-card" style={{ padding: '12px', background: 'var(--gray-50)', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '22px', fontWeight: 700 }}>{count}</div>
              <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>{cat}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
        <select
          className="job-interval-select"
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
          style={{ minWidth: '130px' }}
        >
          <option value="">All Categories</option>
          {['PIPELINE', 'SCHEDULER', 'AI', 'JOB', 'NOTIFICATION', 'RECOMMENDATION'].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          className="job-interval-select"
          value={filterOutcome}
          onChange={(e) => { setFilterOutcome(e.target.value); setPage(1); }}
          style={{ minWidth: '120px' }}
        >
          <option value="">All Outcomes</option>
          {['SUCCESS', 'FAILURE', 'SKIPPED'].map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter action..."
          value={filterAction}
          onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
          style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--gray-300)', fontSize: '13px', minWidth: '150px' }}
        />
        <select
          className="job-interval-select"
          value={filterPrematchStrength}
          onChange={(e) => { setFilterPrematchStrength(e.target.value); setPage(1); }}
          style={{ minWidth: '150px' }}
        >
          <option value="">All Prematch Strength</option>
          {['strong', 'moderate', 'weak', 'none'].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select
          className="job-interval-select"
          value={filterPrematchNoiseMin}
          onChange={(e) => { setFilterPrematchNoiseMin(e.target.value); setPage(1); }}
          style={{ minWidth: '150px' }}
        >
          <option value="">Any Prematch Noise</option>
          <option value="25">Noise &gt;= 25</option>
          <option value="50">Noise &gt;= 50</option>
          <option value="75">Noise &gt;= 75</option>
        </select>
        <button className="btn btn-sm" onClick={() => { setFilterCategory(''); setFilterOutcome(''); setFilterAction(''); setFilterPrematchStrength(''); setFilterPrematchNoiseMin(''); setPage(1); }}>
          Clear
        </button>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-sm" onClick={handleExport}>📥 Export CSV</button>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--gray-200)', textAlign: 'left' }}>
              <th style={{ padding: '8px 6px', fontWeight: 600 }}>Time</th>
              <th style={{ padding: '8px 6px', fontWeight: 600 }}>Category</th>
              <th style={{ padding: '8px 6px', fontWeight: 600 }}>Action</th>
              <th style={{ padding: '8px 6px', fontWeight: 600 }}>Outcome</th>
              <th style={{ padding: '8px 6px', fontWeight: 600 }}>Actor</th>
              <th style={{ padding: '8px 6px', fontWeight: 600 }}>Duration</th>
              <th style={{ padding: '8px 6px', fontWeight: 600 }}>Match</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: 'var(--gray-500)' }}>Loading...</td></tr>
            )}
            {!loading && logs.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: 'var(--gray-500)' }}>No audit logs found</td></tr>
            )}
            {!loading && logs.map((log) => (
              <tr
                key={log.id}
                onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                style={{
                  borderBottom: '1px solid var(--gray-100)',
                  cursor: 'pointer',
                  background: expandedId === log.id ? 'var(--gray-50)' : 'transparent',
                }}
              >
                <td style={{ padding: '6px', whiteSpace: 'nowrap', fontSize: '12px' }}>
                  {formatLocalDateTime(log.timestamp)}
                </td>
                <td style={{ padding: '6px' }}>
                  <Badge label={log.category} colors={CATEGORY_COLORS[log.category]} />
                </td>
                <td style={{ padding: '6px', fontFamily: 'monospace', fontSize: '12px' }}>{log.action}</td>
                <td style={{ padding: '6px' }}>
                  <Badge label={log.outcome} colors={OUTCOME_COLORS[log.outcome]} />
                </td>
                <td style={{ padding: '6px', fontSize: '12px' }}>{log.actor}</td>
                <td style={{ padding: '6px', fontSize: '12px', textAlign: 'right' }}>
                  {log.duration_ms != null ? `${log.duration_ms}ms` : '—'}
                </td>
                <td style={{ padding: '6px', fontSize: '12px', fontFamily: 'monospace' }}>
                  {getMatchDisplay(log)}
                </td>
              </tr>
            ))}
            {!loading && logs.map((log) =>
              expandedId === log.id ? (
                <tr key={`detail-${log.id}`}>
                  <td colSpan={7} style={{ padding: '12px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)' }}>
                    {log.error && (
                      <div style={{ marginBottom: '8px', color: '#dc2626', fontSize: '12px' }}>
                        <strong>Error:</strong> {log.error}
                      </div>
                    )}
                    {log.metadata && Object.keys(log.metadata).length > 0 ? (
                      <div style={{ fontSize: '12px' }}>
                        <strong>Metadata:</strong>
                        <pre style={{
                          margin: '4px 0 0',
                          padding: '8px',
                          background: 'var(--gray-100)',
                          borderRadius: '6px',
                          fontSize: '11px',
                          overflow: 'auto',
                          maxHeight: '200px',
                        }}>
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </div>
                    ) : (
                      <div style={{ color: 'var(--gray-500)', fontSize: '12px' }}>No additional metadata</div>
                    )}
                  </td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', fontSize: '13px' }}>
        <span style={{ color: 'var(--gray-500)' }}>
          {total > 0
            ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`
            : 'No results'}
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span style={{ padding: '4px 8px', color: 'var(--gray-600)' }}>{page} / {totalPages}</span>
          <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      </div>

      {/* Refresh */}
      <div style={{ marginTop: '12px', textAlign: 'right' }}>
        <button className="btn btn-sm" onClick={() => { fetchLogs(); fetchStats(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh</button>
      </div>
    </div>
  );
}
