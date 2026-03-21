import { describe, expect, test } from 'vitest';
import type { StrategicContext } from '@/types';
import { getStrategicNarrative, hasStrategicNarrative } from '../strategicContext';

const context: StrategicContext = {
  home_motivation: 'Home EN legacy',
  away_motivation: 'Away EN legacy',
  league_positions: 'Legacy positions',
  fixture_congestion: 'Legacy fixture congestion',
  rotation_risk: 'Legacy rotation risk',
  key_absences: 'Legacy absences',
  h2h_narrative: 'Legacy H2H',
  summary: 'Legacy summary',
  searched_at: '2026-03-21T00:00:00.000Z',
  summary_vi: 'Tom tat legacy',
  qualitative: {
    en: {
      home_motivation: 'Home EN structured',
      away_motivation: 'Away EN structured',
      league_positions: 'EN positions',
      fixture_congestion: 'EN congestion',
      rotation_risk: 'EN rotation',
      key_absences: 'EN absences',
      h2h_narrative: 'EN h2h',
      summary: 'EN summary',
    },
    vi: {
      home_motivation: 'Dong luc chu nha',
      away_motivation: 'Dong luc doi khach',
      league_positions: 'Vi tri tren bang xep hang',
      fixture_congestion: 'Lich thi dau day',
      rotation_risk: 'Rui ro xoay tua',
      key_absences: 'Vang mat quan trong',
      h2h_narrative: 'Tuong quan doi dau',
      summary: 'Tom tat tieng Viet',
    },
  },
};

describe('strategicContext utils', () => {
  test('prefers structured language-specific narrative', () => {
    expect(getStrategicNarrative(context, 'summary', 'vi')).toBe('Tom tat tieng Viet');
    expect(getStrategicNarrative(context, 'home_motivation', 'en')).toBe('Home EN structured');
  });

  test('falls back to legacy vi field then english field', () => {
    const partial = {
      ...context,
      qualitative: undefined,
      summary: 'Legacy summary',
      summary_vi: 'Tom tat legacy',
    } as StrategicContext;
    expect(getStrategicNarrative(partial, 'summary', 'vi')).toBe('Tom tat legacy');
    expect(getStrategicNarrative(partial, 'summary', 'en')).toBe('Legacy summary');
  });

  test('detects whether any strategic narrative exists for chosen language', () => {
    expect(hasStrategicNarrative(context, 'vi')).toBe(true);
    expect(hasStrategicNarrative(null, 'vi')).toBe(false);
  });
});
