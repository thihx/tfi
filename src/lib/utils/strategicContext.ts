import type { StrategicContext } from '@/types';
import type { UiLanguage } from '@/hooks/useUiLanguage';

type NarrativeField =
  | 'home_motivation'
  | 'away_motivation'
  | 'league_positions'
  | 'fixture_congestion'
  | 'home_fixture_congestion'
  | 'away_fixture_congestion'
  | 'rotation_risk'
  | 'key_absences'
  | 'home_key_absences'
  | 'away_key_absences'
  | 'h2h_narrative'
  | 'summary';

const STRATEGIC_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/khÃ´ng cÃ³ dá»¯ liá»‡u/gi, 'Không có dữ liệu'],
  [/khÃ´ng Ä‘á»§ dá»¯ liá»‡u/gi, 'Không đủ dữ liệu'],
  [/khong tim thay du lieu/gi, 'Không tìm thấy dữ liệu'],
  [/khong co du lieu/gi, 'Không có dữ liệu'],
  [/khong du du lieu/gi, 'Không đủ dữ liệu'],
  [/khong co xoay tua lon/gi, 'Không có xoay tua lớn'],
  [/khong co vang mat lon/gi, 'Không có vắng mặt lớn'],
  [/khong ro/gi, 'Không rõ'],
  [/mo hinh truoc tran nghieng ve/gi, 'Mô hình trước trận nghiêng về'],
  [/diem form 5 tran gan nhat/gi, 'Điểm form 5 trận gần nhất'],
  [/tran doi dau gan nhat/gi, 'trận đối đầu gần nhất'],
];

export function normalizeStrategicDisplayText(value: unknown): string {
  if (typeof value !== 'string') return '';
  let normalized = value.trim();
  if (!normalized) return '';
  for (const [pattern, replacement] of STRATEGIC_TEXT_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return normalizeStrategicDisplayText(value);
}

const QUANTITATIVE_LABELS: Record<string, string> = {
  home_last5_points: 'Home last 5 points',
  away_last5_points: 'Away last 5 points',
  home_last5_goals_for: 'Home last 5 goals for',
  away_last5_goals_for: 'Away last 5 goals for',
  home_last5_goals_against: 'Home last 5 goals against',
  away_last5_goals_against: 'Away last 5 goals against',
  home_home_goals_avg: 'Home goals avg (home)',
  away_away_goals_avg: 'Away goals avg (away)',
  home_over_2_5_rate_last10: 'Home over 2.5 rate',
  away_over_2_5_rate_last10: 'Away over 2.5 rate',
  home_btts_rate_last10: 'Home BTTS rate',
  away_btts_rate_last10: 'Away BTTS rate',
  home_clean_sheet_rate_last10: 'Home clean sheet rate',
  away_clean_sheet_rate_last10: 'Away clean sheet rate',
  home_failed_to_score_rate_last10: 'Home failed-to-score rate',
  away_failed_to_score_rate_last10: 'Away failed-to-score rate',
};

export function isStructuredStrategicContext(
  context: StrategicContext | null | undefined,
): boolean {
  return !!context
    && context.version === 2
    && !!context.source_meta
    && typeof context.source_meta === 'object';
}

export function getStrategicNarrative(
  context: StrategicContext | null | undefined,
  field: NarrativeField,
  language: UiLanguage,
): string {
  if (!context) return '';
  const preferred = normalizeText(context.qualitative?.[language]?.[field]);
  if (preferred) return preferred;
  if (language === 'vi') {
    const legacyVi = normalizeText(context[`${field}_vi` as keyof StrategicContext]);
    if (legacyVi) return legacyVi;
  }
  return normalizeText(context[field]);
}

export function hasStrategicNarrative(
  context: StrategicContext | null | undefined,
  language: UiLanguage,
): boolean {
  if (!context) return false;
  return [
    'summary',
    'home_motivation',
    'away_motivation',
    'league_positions',
    'fixture_congestion',
    'home_fixture_congestion',
    'away_fixture_congestion',
    'rotation_risk',
    'key_absences',
    'home_key_absences',
    'away_key_absences',
    'h2h_narrative',
  ].some((field) => getStrategicNarrative(context, field as NarrativeField, language));
}

export function getStrategicSourceMeta(
  context: StrategicContext | null | undefined,
): StrategicContext['source_meta'] | null {
  return context?.source_meta ?? null;
}

export function getStrategicRefreshMeta(
  context: StrategicContext | null | undefined,
): StrategicContext['_meta'] | null {
  return context?._meta ?? null;
}

export function getStrategicQuantitativeEntries(
  context: StrategicContext | null | undefined,
): Array<{ key: string; label: string; value: number }> {
  if (!context?.quantitative || typeof context.quantitative !== 'object') return [];
  return Object.entries(context.quantitative)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => ({
      key,
      label: QUANTITATIVE_LABELS[key] ?? key,
      value: value as number,
    }));
}
