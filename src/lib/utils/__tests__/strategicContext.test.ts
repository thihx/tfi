import { describe, expect, test } from 'vitest';
import type { StrategicContext } from '@/types';
import {
  getStrategicNarrative,
  getStrategicQuantitativeEntries,
  getStrategicRefreshMeta,
  getStrategicSourceMeta,
  hasStrategicNarrative,
  isStructuredStrategicContext,
} from '../strategicContext';

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
  version: 2,
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
  quantitative: {
    home_last5_points: 10,
    away_last5_points: 6,
    home_last5_goals_for: null,
    away_last5_goals_for: null,
    home_last5_goals_against: null,
    away_last5_goals_against: null,
    home_home_goals_avg: null,
    away_away_goals_avg: null,
    home_over_2_5_rate_last10: null,
    away_over_2_5_rate_last10: null,
    home_btts_rate_last10: null,
    away_btts_rate_last10: null,
    home_clean_sheet_rate_last10: null,
    away_clean_sheet_rate_last10: null,
    home_failed_to_score_rate_last10: null,
    away_failed_to_score_rate_last10: null,
  },
  source_meta: {
    search_quality: 'medium',
    web_search_queries: [],
    sources: [],
    trusted_source_count: 1,
    rejected_source_count: 0,
    rejected_domains: [],
  },
  _meta: {
    refresh_status: 'good',
    failure_count: 0,
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

  test('returns source and refresh metadata for structured contexts', () => {
    expect(isStructuredStrategicContext(context)).toBe(true);
    expect(getStrategicSourceMeta(context)?.search_quality).toBe('medium');
    expect(getStrategicRefreshMeta(context)?.refresh_status).toBe('good');
  });

  test('returns quantitative entries with labels', () => {
    expect(getStrategicQuantitativeEntries(context)).toEqual([
      { key: 'home_last5_points', label: 'Home last 5 points', value: 10 },
      { key: 'away_last5_points', label: 'Away last 5 points', value: 6 },
    ]);
  });
});
