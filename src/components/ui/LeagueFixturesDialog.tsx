import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { fetchLeagueFixtures } from '@/lib/services/api';
import { useAppState } from '@/hooks/useAppState';
import { formatLocalDateTimeFull } from '@/lib/utils/helpers';
import type { League, LeagueFixture } from '@/types';

interface Props {
  league: League | null;
  onClose: () => void;
}

function statusLabel(short: string, elapsed: number | null): string {
  if (short === 'NS') return 'Not Started';
  if (short === 'FT') return 'FT';
  if (short === 'HT') return 'HT';
  if (['1H', '2H'].includes(short)) return `${elapsed ?? '?'}'`;
  if (short === 'PST') return 'Postponed';
  if (short === 'CANC') return 'Cancelled';
  return short;
}

const CURRENT_YEAR = new Date().getFullYear();
const AUTO_SEASON = new Date().getMonth() < 7 ? CURRENT_YEAR - 1 : CURRENT_YEAR;

export function LeagueFixturesDialog({ league, onClose }: Props) {
  const { state } = useAppState();
  const config = state.config;
  const [fixtures, setFixtures] = useState<LeagueFixture[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [season, setSeason] = useState(AUTO_SEASON);

  useEffect(() => {
    if (!league) return;
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError('');
      setFixtures([]);
      fetchLeagueFixtures(config, league.league_id, season, 10)
        .then((data) => { if (!cancelled) setFixtures(data); })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [league, season, config]);

  if (!league) return null;

  const title = `${league.league_name} — Upcoming Fixtures`;

  return (
    <Modal open={!!league} title={title} onClose={onClose} size="lg">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {league.logo && <img src={league.logo} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />}
        <span style={{ color: '#64748b', fontSize: 13 }}>
          {league.country} · {league.type} · Season:
        </span>
        <select
          value={season}
          onChange={(e) => setSeason(Number(e.target.value))}
          style={{ fontSize: 13, padding: '2px 6px', borderRadius: 4, border: '1px solid #e2e8f0' }}
        >
          {[CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2].map((y) => (
            <option key={y} value={y}>{y}/{y + 1}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#64748b' }}>
          <span className="inline-spinner" style={{ width: 20, height: 20, display: 'inline-block', marginRight: 8 }} />
          Loading fixtures…
        </div>
      )}

      {error && (
        <div style={{ color: '#dc2626', background: '#fef2f2', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && !error && fixtures.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 14 }}>
          No upcoming fixtures found for this season.
        </div>
      )}

      {!loading && fixtures.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#94a3b8', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Date</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>Home</th>
              <th style={{ textAlign: 'center', padding: '4px 8px', fontWeight: 600, width: 80 }}>Score</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Away</th>
              <th style={{ textAlign: 'center', padding: '4px 8px', fontWeight: 600 }}>Status</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Round</th>
            </tr>
          </thead>
          <tbody>
            {fixtures.map((f) => {
              const isLive = ['1H', '2H', 'HT', 'ET', 'P'].includes(f.fixture.status.short);
              const isFt = f.fixture.status.short === 'FT';
              const hasScore = f.goals.home !== null;
              return (
                <tr key={f.fixture.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 8px', color: '#475569', whiteSpace: 'nowrap' }}>
                    {formatLocalDateTimeFull(f.fixture.date)}
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                      <span style={{ fontWeight: f.teams.home.winner ? 600 : 400 }}>{f.teams.home.name}</span>
                      <img src={f.teams.home.logo} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                    </span>
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 600, fontSize: 14 }}>
                    {hasScore
                      ? <span style={{ color: isLive ? '#16a34a' : '#1e293b' }}>{f.goals.home} – {f.goals.away}</span>
                      : <span style={{ color: '#94a3b8' }}>vs</span>
                    }
                  </td>
                  <td style={{ padding: '8px 8px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <img src={f.teams.away.logo} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                      <span style={{ fontWeight: f.teams.away.winner ? 600 : 400 }}>{f.teams.away.name}</span>
                    </span>
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11,
                      background: isLive ? '#dcfce7' : isFt ? '#f1f5f9' : '#eff6ff',
                      color: isLive ? '#16a34a' : isFt ? '#64748b' : '#3b82f6',
                      fontWeight: isLive ? 600 : 400,
                    }}>
                      {statusLabel(f.fixture.status.short, f.fixture.status.elapsed)}
                    </span>
                  </td>
                  <td style={{ padding: '8px 8px', color: '#94a3b8', fontSize: 12 }}>
                    {f.league.round}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
