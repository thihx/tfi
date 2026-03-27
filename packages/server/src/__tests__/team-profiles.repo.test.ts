import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import { getAllTeamProfiles } from '../repos/team-profiles.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('team profiles repository', () => {
  test('lists one row per shared team profile using stable metadata joins', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{
        team_id: '33',
        profile: { attack_style: 'mixed' },
        notes_en: '',
        notes_vi: '',
        created_at: '2026-03-25T00:00:00.000Z',
        updated_at: '2026-03-25T00:00:00.000Z',
        team_name: 'Manchester United',
        team_logo: 'https://logo/33.png',
      }],
    } as never);

    const result = await getAllTeamProfiles();

    expect(result).toHaveLength(1);
    expect(result[0]?.team_name).toBe('Manchester United');
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain('FROM team_profiles tp');
    expect(sql).toContain('LEFT JOIN teams t');
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('LIMIT 1');
  });
});