import type { MatchAlertRuleJson } from './match-alert-rule-engine.js';

export interface SystemConditionAlertPreset {
  id: string;
  label: string;
  labelVi: string;
  description: string;
  category: 'big_event' | 'pressure' | 'trap_warning';
  enabled: boolean;
  defaultCooldownMinutes: number;
  defaultOncePerMatch: boolean;
  sortOrder: number;
  ruleJson: MatchAlertRuleJson;
}

export const SYSTEM_CONDITION_ALERT_PRESETS: SystemConditionAlertPreset[] = [
  {
    id: 'away_scores_first',
    label: 'Away scores first',
    labelVi: 'Đội khách ghi bàn trước',
    description: 'Useful for momentum flip, BTTS, Over, and handicap review.',
    category: 'big_event',
    enabled: true,
    defaultCooldownMinutes: 0,
    defaultOncePerMatch: true,
    sortOrder: 10,
    ruleJson: {
      version: 1,
      id: 'away_scores_first',
      label: 'Away scores first',
      labelVi: 'Đội khách ghi bàn trước',
      severity: 'high',
      suggestedAction: 'review_live_market',
      all: [
        { field: 'events.first_goal.side', op: '=', value: 'away' },
        { field: 'minute', op: '<=', value: 70 },
      ],
    },
  },
  {
    id: 'red_card',
    label: 'Red card',
    labelVi: 'Có thẻ đỏ',
    description: 'Major live-state change; review side, minute, score, and current market.',
    category: 'big_event',
    enabled: true,
    defaultCooldownMinutes: 0,
    defaultOncePerMatch: false,
    sortOrder: 20,
    ruleJson: {
      version: 1,
      id: 'red_card',
      label: 'Red card',
      labelVi: 'Có thẻ đỏ',
      severity: 'high',
      suggestedAction: 'review_live_market',
      all: [
        { field: 'events.red_card.side', op: 'exists' },
      ],
    },
  },
  {
    id: 'leading_team_red_card',
    label: 'Leading team red card',
    labelVi: 'Đội đang dẫn nhận thẻ đỏ',
    description: 'Can create comeback, draw, or no-bet review windows.',
    category: 'big_event',
    enabled: true,
    defaultCooldownMinutes: 0,
    defaultOncePerMatch: false,
    sortOrder: 30,
    ruleJson: {
      version: 1,
      id: 'leading_team_red_card',
      label: 'Leading team red card',
      labelVi: 'Đội đang dẫn nhận thẻ đỏ',
      severity: 'high',
      suggestedAction: 'review_live_market',
      any: [
        {
          all: [
            { field: 'events.red_card.side', op: '=', value: 'home' },
            { field: 'score.leadingSide', op: '=', value: 'home' },
          ],
        },
        {
          all: [
            { field: 'events.red_card.side', op: '=', value: 'away' },
            { field: 'score.leadingSide', op: '=', value: 'away' },
          ],
        },
      ],
    },
  },
  {
    id: 'equalizer_after_60',
    label: 'Equalizer after 60',
    labelVi: 'Bàn gỡ hòa sau phút 60',
    description: 'Late equalizers can change Over/BTTS and momentum pricing.',
    category: 'big_event',
    enabled: true,
    defaultCooldownMinutes: 0,
    defaultOncePerMatch: false,
    sortOrder: 40,
    ruleJson: {
      version: 1,
      id: 'equalizer_after_60',
      label: 'Equalizer after 60',
      labelVi: 'Bàn gỡ hòa sau phút 60',
      severity: 'medium',
      suggestedAction: 'review_live_market',
      all: [
        { field: 'events.last_goal.type', op: '=', value: 'equalizer' },
        { field: 'events.last_goal.minute', op: '>=', value: 60 },
      ],
    },
  },
  {
    id: 'late_goal_after_75',
    label: 'Late goal after 75',
    labelVi: 'Có bàn thắng sau phút 75',
    description: 'Late goal signal; avoid chasing unless odds and context remain favorable.',
    category: 'big_event',
    enabled: true,
    defaultCooldownMinutes: 0,
    defaultOncePerMatch: false,
    sortOrder: 50,
    ruleJson: {
      version: 1,
      id: 'late_goal_after_75',
      label: 'Late goal after 75',
      labelVi: 'Có bàn thắng sau phút 75',
      severity: 'medium',
      suggestedAction: 'avoid_chasing',
      all: [
        { field: 'events.last_goal.minute', op: '>=', value: 75 },
      ],
    },
  },
  {
    id: 'zero_zero_pressure_after_55',
    label: '0-0 pressure after 55',
    labelVi: '0-0 nhưng áp lực lớn sau phút 55',
    description: 'Useful for late goal watch. This is a signal, not an automatic bet.',
    category: 'pressure',
    enabled: true,
    defaultCooldownMinutes: 10,
    defaultOncePerMatch: true,
    sortOrder: 60,
    ruleJson: {
      version: 1,
      id: 'zero_zero_pressure_after_55',
      label: '0-0 pressure after 55',
      labelVi: '0-0 nhưng áp lực lớn sau phút 55',
      severity: 'medium',
      suggestedAction: 'review_live_market',
      all: [
        { field: 'minute', op: '>=', value: 55 },
        { field: 'score.total', op: '=', value: 0 },
        {
          any: [
            { field: 'derived.corners_total', op: '>=', value: 8 },
            { field: 'stats.shots_on_target.home', op: '>=', value: 3 },
            { field: 'stats.shots_on_target.away', op: '>=', value: 3 },
          ],
        },
      ],
    },
  },
  {
    id: 'home_pressure_no_goal',
    label: 'Home pressure, no lead',
    labelVi: 'Chủ nhà ép nhưng chưa dẫn',
    description: 'Home side has stronger live pressure while not leading.',
    category: 'pressure',
    enabled: false,
    defaultCooldownMinutes: 10,
    defaultOncePerMatch: true,
    sortOrder: 70,
    ruleJson: {
      version: 1,
      id: 'home_pressure_no_goal',
      label: 'Home pressure, no lead',
      labelVi: 'Chủ nhà ép nhưng chưa dẫn',
      severity: 'medium',
      suggestedAction: 'review_live_market',
      all: [
        { field: 'minute', op: '>=', value: 25 },
        { field: 'derived.sot_diff.home', op: '>=', value: 3 },
        { field: 'score.state', op: '!=', value: 'home_leading' },
      ],
    },
  },
  {
    id: 'away_pressure_no_goal',
    label: 'Away pressure, no lead',
    labelVi: 'Đội khách ép nhưng chưa dẫn',
    description: 'Away side has stronger live pressure while not leading.',
    category: 'pressure',
    enabled: false,
    defaultCooldownMinutes: 10,
    defaultOncePerMatch: true,
    sortOrder: 80,
    ruleJson: {
      version: 1,
      id: 'away_pressure_no_goal',
      label: 'Away pressure, no lead',
      labelVi: 'Đội khách ép nhưng chưa dẫn',
      severity: 'medium',
      suggestedAction: 'review_live_market',
      all: [
        { field: 'minute', op: '>=', value: 25 },
        { field: 'derived.sot_diff.away', op: '>=', value: 3 },
        { field: 'score.state', op: '!=', value: 'away_leading' },
      ],
    },
  },
  {
    id: 'corner_pressure',
    label: 'Corner pressure',
    labelVi: 'Áp lực phạt góc cao',
    description: 'High early corner count for corners-market review.',
    category: 'pressure',
    enabled: false,
    defaultCooldownMinutes: 10,
    defaultOncePerMatch: true,
    sortOrder: 90,
    ruleJson: {
      version: 1,
      id: 'corner_pressure',
      label: 'Corner pressure',
      labelVi: 'Áp lực phạt góc cao',
      severity: 'medium',
      suggestedAction: 'review_live_market',
      all: [
        { field: 'minute', op: '<=', value: 60 },
        { field: 'derived.corners_total', op: '>=', value: 7 },
      ],
    },
  },
  {
    id: 'early_red_card_trap',
    label: 'Early red card trap',
    labelVi: 'Bẫy thẻ đỏ sớm',
    description: 'Early red cards can break pre-match assumptions. Slow down and re-check.',
    category: 'trap_warning',
    enabled: true,
    defaultCooldownMinutes: 0,
    defaultOncePerMatch: false,
    sortOrder: 100,
    ruleJson: {
      version: 1,
      id: 'early_red_card_trap',
      label: 'Early red card trap',
      labelVi: 'Bẫy thẻ đỏ sớm',
      severity: 'high',
      suggestedAction: 'avoid_chasing',
      all: [
        { field: 'events.red_card.minute', op: '<=', value: 35 },
      ],
    },
  },
];

export function getSystemConditionAlertPreset(id: string): SystemConditionAlertPreset | null {
  return SYSTEM_CONDITION_ALERT_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function buildMatchStartRuleJson(): MatchAlertRuleJson {
  return {
    version: 1,
    id: 'match_start',
    label: 'Match started',
    labelVi: 'Trận đấu bắt đầu',
    severity: 'info',
    suggestedAction: 'open_match',
    any: [
      { field: 'status', op: 'in', value: ['1H', '2H', 'HT', 'LIVE', 'ET', 'BT', 'P', 'INT'] },
      { field: 'minute', op: '>=', value: 1 },
    ],
  };
}
