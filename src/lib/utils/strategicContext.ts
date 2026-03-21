import type { StrategicContext } from '@/types';
import type { UiLanguage } from '@/hooks/useUiLanguage';

type NarrativeField =
  | 'home_motivation'
  | 'away_motivation'
  | 'league_positions'
  | 'fixture_congestion'
  | 'rotation_risk'
  | 'key_absences'
  | 'h2h_narrative'
  | 'summary';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    'rotation_risk',
    'key_absences',
    'h2h_narrative',
  ].some((field) => getStrategicNarrative(context, field as NarrativeField, language));
}

