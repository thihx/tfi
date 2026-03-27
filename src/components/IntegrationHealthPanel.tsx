import { useState, useEffect, useCallback } from 'react';
import { internalApiUrl, resolveInternalApiBaseUrl } from '@/lib/internal-api';
import { getToken } from '@/lib/services/auth';

// ── Types ─────────────────────────────────────────────────────

type IntegrationStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'NOT_CONFIGURED';

interface ServiceResult {
  id: string;
  label: string;
  description: string;
  status: IntegrationStatus;
  latencyMs: number;
  message?: string;
  checkedAt: string;
}

interface HealthSnapshot {
  overall: IntegrationStatus;
  checkedAt: string;
  durationMs: number;
  services: ServiceResult[];
}

// ── Helpers ───────────────────────────────────────────────────

const API_URL = resolveInternalApiBaseUrl();

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const STATUS_CONFIG: Record<IntegrationStatus, { color: string; bg: string; border: string; dot: string; label: string }> = {
  HEALTHY:        { color: '#059669', bg: '#f0fdf4', border: '#bbf7d0', dot: '#10b981', label: 'Healthy' },
  DEGRADED:       { color: '#d97706', bg: '#fffbeb', border: '#fde68a', dot: '#f59e0b', label: 'Degraded' },
  DOWN:           { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', dot: '#ef4444', label: 'Down' },
  NOT_CONFIGURED: { color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb', dot: '#9ca3af', label: 'Not configured' },
};

function StatusBadge({ status }: { status: IntegrationStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
      {cfg.label}
    </span>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ animation: spinning ? 'spin 0.8s linear infinite' : 'none' }}
    >
      <polyline points="23 4 23 10 17 10"/>
      <polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  );
}

// ── Main Component ────────────────────────────────────────────

export function IntegrationHealthPanel() {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(internalApiUrl('/api/integrations/health', API_URL), {
        headers: authHeaders(),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSnapshot(await res.json());
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSingle = useCallback(async (id: string) => {
    setRefreshingId(id);
    try {
      const res = await fetch(`${internalApiUrl('/api/integrations/health', API_URL)}?service=${encodeURIComponent(id)}`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: ServiceResult = await res.json();
      setSnapshot((prev) => {
        if (!prev) return prev;
        const services = prev.services.map((s) => (s.id === id ? updated : s));
        const active = services.filter((s) => s.status !== 'NOT_CONFIGURED');
        const overall: IntegrationStatus =
          active.some((s) => s.status === 'DOWN') ? 'DOWN' :
          active.some((s) => s.status === 'DEGRADED') ? 'DEGRADED' :
          active.length === 0 ? 'NOT_CONFIGURED' : 'HEALTHY';
        return { ...prev, services, overall, checkedAt: updated.checkedAt };
      });
    } catch {
      // silent — individual refresh failure doesn't crash whole panel
    } finally {
      setRefreshingId(null);
    }
  }, []);

  // Auto-load on mount
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const downCount = snapshot?.services.filter((s) => s.status === 'DOWN').length ?? 0;
  const healthyCount = snapshot?.services.filter((s) => s.status === 'HEALTHY').length ?? 0;
  const configuredCount = snapshot?.services.filter((s) => s.status !== 'NOT_CONFIGURED').length ?? 0;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gray-600)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--gray-800)' }}>Integration Health</span>
          {snapshot && <StatusBadge status={snapshot.overall} />}
        </div>
        <button
          className="btn btn-secondary"
          onClick={fetchAll}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
        >
          <RefreshIcon spinning={loading} />
          Check all
        </button>
      </div>

      {/* ── Stats ── */}
      {snapshot && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', marginBottom: '20px' }}>
          {[
            { label: 'Total', value: snapshot.services.length, color: 'var(--gray-700)' },
            { label: 'Configured', value: configuredCount, color: 'var(--gray-700)' },
            { label: 'Healthy', value: healthyCount, color: '#059669' },
            { label: 'Down', value: downCount, color: downCount > 0 ? '#dc2626' : 'var(--gray-400)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              padding: '12px 14px', borderRadius: '8px',
              background: 'var(--gray-50)', border: '1px solid var(--gray-100)',
            }}>
              <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginBottom: '4px' }}>{label}</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{
          padding: '12px 14px', borderRadius: '8px', marginBottom: '16px',
          background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: '13px',
        }}>
          Failed to check integrations: {error}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {!snapshot && loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '12px' }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} style={{
              height: '88px', borderRadius: '10px',
              background: 'var(--gray-100)', animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          ))}
        </div>
      )}

      {/* ── Service cards ── */}
      {snapshot && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '12px' }}>
          {snapshot.services.map((svc) => {
            const cfg = STATUS_CONFIG[svc.status];
            const isRefreshing = refreshingId === svc.id;
            return (
              <div key={svc.id} style={{
                padding: '14px 16px', borderRadius: '10px',
                background: cfg.bg,
                border: `1px solid ${cfg.border}`,
                position: 'relative',
              }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: cfg.dot, flexShrink: 0, marginTop: '2px',
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--gray-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {svc.label}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginTop: '1px' }}>
                        {svc.description}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <StatusBadge status={svc.status} />
                    <button
                      onClick={() => refreshSingle(svc.id)}
                      disabled={isRefreshing}
                      title="Refresh this service"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--gray-400)', padding: '2px', display: 'flex', alignItems: 'center',
                      }}
                    >
                      <RefreshIcon spinning={isRefreshing} />
                    </button>
                  </div>
                </div>

                {/* Bottom row */}
                <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: 'var(--gray-500)' }}>
                  {svc.latencyMs > 0 && (
                    <span style={{ fontWeight: 500 }}>{svc.latencyMs}ms</span>
                  )}
                  {svc.message && (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {svc.message}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Last check time ── */}
      {snapshot && (
        <div style={{ marginTop: '14px', fontSize: '11px', color: 'var(--gray-400)', textAlign: 'right' }}>
          Last checked: {new Date(snapshot.checkedAt).toLocaleTimeString()} · {snapshot.durationMs}ms total
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}
