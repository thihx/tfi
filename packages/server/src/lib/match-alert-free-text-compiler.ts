import { config } from '../config.js';
import { generateGeminiContent } from './gemini.js';
import type { MatchAlertRuleJson, MatchAlertRuleNode } from './match-alert-rule-engine.js';

export type MatchAlertRuleCompileSource = 'deterministic' | 'llm';

export interface MatchAlertRuleCompileResult {
  status: 'compiled' | 'unsupported';
  ruleJson?: MatchAlertRuleJson;
  source?: MatchAlertRuleCompileSource;
  model?: string;
  normalizedText: string;
  unsupportedReason?: string;
  rawText?: string;
}

const ALLOWED_FIELDS = new Set([
  'status',
  'minute',
  'score.home',
  'score.away',
  'score.total',
  'score.state',
  'score.leadingSide',
  'score.losingSide',
  'stats.shots.home',
  'stats.shots.away',
  'stats.shots_on_target.home',
  'stats.shots_on_target.away',
  'stats.corners.home',
  'stats.corners.away',
  'stats.red_cards.home',
  'stats.red_cards.away',
  'stats.yellow_cards.home',
  'stats.yellow_cards.away',
  'events.first_goal.side',
  'events.first_goal.minute',
  'events.last_goal.side',
  'events.last_goal.minute',
  'events.last_goal.type',
  'events.red_card.side',
  'events.red_card.minute',
  'derived.sot_diff.home',
  'derived.sot_diff.away',
  'derived.shots_diff.home',
  'derived.shots_diff.away',
  'derived.corners_diff.home',
  'derived.corners_diff.away',
  'derived.corners_total',
  'derived.btts',
  'derived.leading_side',
  'derived.losing_side',
]);

const ALLOWED_OPS = new Set(['=', '==', '!=', '>', '>=', '<', '<=', 'exists', 'in', 'contains', 'changed']);
const ALLOWED_SEVERITY = new Set(['info', 'medium', 'high']);
const ALLOWED_ACTION = new Set(['open_match', 'review_live_market', 'ask_ai', 'avoid_chasing']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value: string): string {
  return value
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\b(k|ko|khg|khong|hong|hok|no)\b/g, ' khong ')
    .replace(/\b(phut|ph|p)\b/g, ' minute ')
    .replace(/\b(mins?|m)\b/g, ' minute ')
    .replace(/\b(doi nha|chu nha|home team)\b/g, ' home ')
    .replace(/\b(doi khach|khach|away team)\b/g, ' away ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function slug(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'custom_condition';
}

function minuteFloor(text: string, fallback: number | null = null): number | null {
  const patterns = [
    /\b(?:after|from|since|sau|tu|>=)\s*(?:minute\s*)?(\d{1,3})\b/,
    /\b(?:minute\s*)?(?:>=|=>)\s*(\d{1,3})\b/,
    /\b(\d{1,3})\s*\+\b/,
    /\b(?:minute\s*)?(\d{1,3})\s*(?:minute)?\s*(?:tro di|onward|plus)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const minute = Number(match[1]);
      if (Number.isInteger(minute) && minute >= 0 && minute <= 130) return minute;
    }
  }
  return fallback;
}

function minuteCeiling(text: string): number | null {
  const match = text.match(/\b(?:before|until|truoc|toi|<=)\s*(?:minute\s*)?(\d{1,3})\b/);
  if (!match) return null;
  const minute = Number(match[1]);
  return Number.isInteger(minute) && minute >= 0 && minute <= 130 ? minute : null;
}

function leaf(field: string, op: string, value?: unknown): MatchAlertRuleNode {
  return value === undefined ? { field, op } : { field, op, value };
}

function withMinuteFloor(nodes: MatchAlertRuleNode[], text: string, fallback: number | null = null): MatchAlertRuleNode[] {
  const minute = minuteFloor(text, fallback);
  return minute == null ? nodes : [leaf('minute', '>=', minute), ...nodes];
}

function fixedRule(
  id: string,
  label: string,
  labelVi: string,
  all: MatchAlertRuleNode[],
  severity: MatchAlertRuleJson['severity'] = 'medium',
  suggestedAction: MatchAlertRuleJson['suggestedAction'] = 'review_live_market',
): MatchAlertRuleJson {
  return { version: 1, id, label, labelVi, severity, suggestedAction, all };
}

function compileDslClause(rawClause: string): MatchAlertRuleNode | null {
  const clause = rawClause.trim().replace(/^not\s+/i, 'NOT ');
  const notMatch = clause.match(/^NOT\s+(.+)$/i);
  if (notMatch) {
    const inner = compileDslClause(notMatch[1] ?? '');
    if (!inner) return null;
    if ('field' in inner && inner.field === 'score.state' && inner.op === '=' && typeof inner.value === 'string') {
      return leaf('score.state', '!=', inner.value);
    }
    return { not: inner };
  }

  const lower = clause.toLowerCase().replace(/\s+/g, ' ').trim();
  if (lower === 'draw') return leaf('score.state', '=', 'draw');
  if (lower === 'home leading') return leaf('score.state', '=', 'home_leading');
  if (lower === 'away leading') return leaf('score.state', '=', 'away_leading');

  const minuteMatch = lower.match(/^minute\s*(>=|<=|>|<|==|=)\s*(\d+)$/);
  if (minuteMatch) return leaf('minute', minuteMatch[1]!, Number(minuteMatch[2]));

  const totalGoalsMatch = lower.match(/^total goals\s*(>=|<=|>|<|==|=)\s*(\d+)$/);
  if (totalGoalsMatch) return leaf('score.total', totalGoalsMatch[1]!, Number(totalGoalsMatch[2]));

  const statMatch = lower.match(/^(home|away)\s+(shots on target|shots|corners|red cards|yellow cards)\s*(>=|<=|>|<|==|=)\s*(-?\d+(?:\.\d+)?)$/);
  if (statMatch) {
    const side = statMatch[1]!;
    const fieldName = statMatch[2]!.replace(/\s+/g, '_');
    return leaf(`stats.${fieldName}.${side}`, statMatch[3]!, Number(statMatch[4]));
  }

  const statAliasMatch = lower.match(/^(shots_on_target|shots|corners)_(home|away)\s*(>=|<=|>|<|==|=)\s*(-?\d+(?:\.\d+)?)$/);
  if (statAliasMatch) {
    return leaf(`stats.${statAliasMatch[1]}.${statAliasMatch[2]}`, statAliasMatch[3]!, Number(statAliasMatch[4]));
  }

  return null;
}

function compileLegacyDsl(rawText: string): MatchAlertRuleJson | null {
  if (/\bOR\b/i.test(rawText)) return null;
  const clauses = rawText
    .replace(/[()]/g, '')
    .split(/\s+AND\s+/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length === 0) return null;

  const nodes = clauses.map(compileDslClause);
  if (nodes.some((node) => node == null)) return null;
  return fixedRule(
    `free_text_${slug(rawText)}`,
    'Custom condition',
    'Dieu kien tuy chinh',
    nodes as MatchAlertRuleNode[],
  );
}

function compileDeterministic(rawText: string): MatchAlertRuleJson | null {
  const text = normalizeText(rawText);
  const dsl = compileLegacyDsl(rawText);
  if (dsl) return dsl;

  const hasNoGoalIntent = (
    /\b(0\s*-\s*0|0\s*0|nil\s*nil|zero\s*zero)\b/.test(text)
    || (/\b(khong|no)\b/.test(text) && /\b(goal|goals|ban thang|ghi ban)\b/.test(text))
    || /\b(goalless|scoreless)\b/.test(text)
  );
  if (hasNoGoalIntent) {
    return fixedRule(
      'free_text_no_goals_after_minute',
      'No goals after selected minute',
      'Khong co ban thang sau phut da chon',
      withMinuteFloor([leaf('score.total', '=', 0)], text, 70),
      'medium',
      'review_live_market',
    );
  }

  if (/\b(red card|the do|rc)\b/.test(text)) {
    if (/\b(leading|dang dan|doi dang dan)\b/.test(text)) {
      return {
        version: 1,
        id: 'free_text_leading_team_red_card',
        label: 'Leading team red card',
        labelVi: 'Doi dang dan nhan the do',
        severity: 'high',
        suggestedAction: 'review_live_market',
        any: [
          { all: [leaf('events.red_card.side', '=', 'home'), leaf('score.leadingSide', '=', 'home')] },
          { all: [leaf('events.red_card.side', '=', 'away'), leaf('score.leadingSide', '=', 'away')] },
        ],
      };
    }
    if (/\bhome\b/.test(text)) {
      return fixedRule('free_text_home_red_card', 'Home red card', 'Chu nha nhan the do', [leaf('events.red_card.side', '=', 'home')], 'high');
    }
    if (/\baway\b/.test(text)) {
      return fixedRule('free_text_away_red_card', 'Away red card', 'Doi khach nhan the do', [leaf('events.red_card.side', '=', 'away')], 'high');
    }
    return fixedRule('free_text_red_card', 'Red card', 'Co the do', [leaf('events.red_card.side', 'exists')], 'high');
  }

  if (/\b(first goal|score first|scores first|ghi ban truoc|mo ty so)\b/.test(text)) {
    if (/\baway\b/.test(text)) {
      return fixedRule('free_text_away_scores_first', 'Away scores first', 'Doi khach ghi ban truoc', [leaf('events.first_goal.side', '=', 'away')], 'high');
    }
    if (/\bhome\b/.test(text)) {
      return fixedRule('free_text_home_scores_first', 'Home scores first', 'Chu nha ghi ban truoc', [leaf('events.first_goal.side', '=', 'home')], 'high');
    }
  }

  if (/\b(equalizer|go hoa|can bang)\b/.test(text)) {
    return fixedRule(
      'free_text_equalizer_after_minute',
      'Equalizer after selected minute',
      'Ban go hoa sau phut da chon',
      withMinuteFloor([leaf('events.last_goal.type', '=', 'equalizer')], text, 60),
    );
  }

  if (/\b(late goal|goal after|ban thang sau|co ban sau)\b/.test(text)) {
    const minute = minuteFloor(text, 75);
    return fixedRule(
      'free_text_goal_after_minute',
      'Goal after selected minute',
      'Co ban thang sau phut da chon',
      [leaf('events.last_goal.minute', '>=', minute ?? 75)],
      'medium',
      minute != null && minute >= 75 ? 'avoid_chasing' : 'review_live_market',
    );
  }

  if (/\b(btts|both teams scored|hai doi deu ghi ban)\b/.test(text)) {
    return fixedRule(
      'free_text_btts_after_minute',
      'Both teams scored after selected minute',
      'Hai doi deu ghi ban sau phut da chon',
      withMinuteFloor([leaf('derived.btts', '=', true)], text, null),
    );
  }

  if (/\bpressure|ep|ap luc\b/.test(text)) {
    if (/\b0\s*-\s*0|0\s*0\b/.test(text)) {
      return {
        version: 1,
        id: 'free_text_zero_zero_pressure',
        label: '0-0 pressure',
        labelVi: '0-0 co ap luc',
        severity: 'medium',
        suggestedAction: 'review_live_market',
        all: [
          ...withMinuteFloor([leaf('score.total', '=', 0)], text, 55),
          {
            any: [
              leaf('derived.corners_total', '>=', 8),
              leaf('stats.shots_on_target.home', '>=', 3),
              leaf('stats.shots_on_target.away', '>=', 3),
            ],
          },
        ],
      };
    }
    if (/\bhome\b/.test(text)) {
      return fixedRule(
        'free_text_home_pressure_no_lead',
        'Home pressure, no lead',
        'Chu nha ep nhung chua dan',
        withMinuteFloor([
          leaf('derived.sot_diff.home', '>=', 3),
          leaf('score.state', '!=', 'home_leading'),
        ], text, 25),
      );
    }
    if (/\baway\b/.test(text)) {
      return fixedRule(
        'free_text_away_pressure_no_lead',
        'Away pressure, no lead',
        'Doi khach ep nhung chua dan',
        withMinuteFloor([
          leaf('derived.sot_diff.away', '>=', 3),
          leaf('score.state', '!=', 'away_leading'),
        ], text, 25),
      );
    }
  }

  if (/\bcorner|corners|phat goc|goc\b/.test(text)) {
    const threshold = Number(text.match(/\b(\d{1,2})\s*(?:corner|corners|goc)\b/)?.[1] ?? NaN);
    if (Number.isFinite(threshold)) {
      const ceiling = minuteCeiling(text);
      return fixedRule(
        'free_text_corner_count',
        'Corner count signal',
        'Tin hieu phat goc',
        [
          ...(ceiling == null ? [] : [leaf('minute', '<=', ceiling)]),
          leaf('derived.corners_total', '>=', threshold),
        ],
      );
    }
  }

  return null;
}

function extractCandidateText(data: Record<string, unknown>): string {
  const candidates = Array.isArray(data.candidates)
    ? data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>
    : [];
  return candidates[0]?.content?.parts?.[0]?.text ?? '';
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // Fall through to wrapped JSON recovery.
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (isRecord(parsed)) return parsed;
  }
  throw new Error('LLM compiler response was not a JSON object.');
}

function validateNode(value: unknown, depth = 0): MatchAlertRuleNode | null {
  if (!isRecord(value) || depth > 5) return null;
  if (Array.isArray(value.all)) {
    const children = value.all.map((child) => validateNode(child, depth + 1));
    if (children.length === 0 || children.some((child) => child == null)) return null;
    return { all: children as MatchAlertRuleNode[] };
  }
  if (Array.isArray(value.any)) {
    const children = value.any.map((child) => validateNode(child, depth + 1));
    if (children.length === 0 || children.some((child) => child == null)) return null;
    return { any: children as MatchAlertRuleNode[] };
  }
  if (isRecord(value.not)) {
    const child = validateNode(value.not, depth + 1);
    return child ? { not: child } : null;
  }
  if (typeof value.field === 'string' && typeof value.op === 'string') {
    if (!ALLOWED_FIELDS.has(value.field) || !ALLOWED_OPS.has(value.op)) return null;
    return 'value' in value ? { field: value.field, op: value.op, value: value.value } : { field: value.field, op: value.op };
  }
  return null;
}

export function validateCompiledRuleJson(value: unknown): MatchAlertRuleJson | null {
  if (!isRecord(value)) return null;
  const rawNodes = Array.isArray(value.all)
    ? { all: value.all }
    : Array.isArray(value.any)
      ? { any: value.any }
      : isRecord(value.not)
        ? { not: value.not }
        : typeof value.field === 'string' && typeof value.op === 'string'
          ? { field: value.field, op: value.op, value: value.value }
          : null;
  const root = validateNode(rawNodes);
  if (!root) return null;
  return {
    version: 1,
    id: typeof value.id === 'string' && value.id.trim() ? slug(value.id) : 'free_text_llm_condition',
    label: typeof value.label === 'string' && value.label.trim() ? value.label.trim().slice(0, 80) : 'Custom condition',
    labelVi: typeof value.labelVi === 'string' && value.labelVi.trim()
      ? value.labelVi.trim().slice(0, 80)
      : (typeof value.label_vi === 'string' && value.label_vi.trim() ? value.label_vi.trim().slice(0, 80) : 'Dieu kien tuy chinh'),
    severity: ALLOWED_SEVERITY.has(String(value.severity)) ? value.severity as MatchAlertRuleJson['severity'] : 'medium',
    suggestedAction: ALLOWED_ACTION.has(String(value.suggestedAction))
      ? value.suggestedAction as MatchAlertRuleJson['suggestedAction']
      : (ALLOWED_ACTION.has(String(value.suggested_action)) ? value.suggested_action as MatchAlertRuleJson['suggestedAction'] : 'review_live_market'),
    ...root,
  };
}

export function buildMatchAlertRuleCompilePrompt(conditionText: string): string {
  return [
    'You are TFI Fast Match Alert Rule Compiler.',
    'Convert one user free-text live football alert condition into a deterministic JSON rule.',
    'The user may write Vietnamese, English, no accents, abbreviations, or betting slang.',
    'Compile only observable match-state conditions. Do not create betting advice, odds rules, staking rules, or recommendations.',
    'If the request is too vague or requires unavailable data, return {"supported":false,"reason":"..."}',
    '',
    'Allowed fields:',
    Array.from(ALLOWED_FIELDS).join(', '),
    'Allowed operators: =, ==, !=, >, >=, <, <=, exists, in, contains, changed',
    'Allowed actions: open_match, review_live_market, ask_ai, avoid_chasing',
    'Return strict JSON only:',
    '{"supported":true,"id":"free_text_short_id","label":"...","label_vi":"...","severity":"info|medium|high","suggested_action":"review_live_market","all":[{"field":"minute","op":">=","value":70}]}',
    '',
    'Examples:',
    'User: "Neu 2 doi ko co ban thang sau phut 70" -> total goals is 0 and minute >= 70.',
    'User: "away scores first" -> first goal side is away.',
    'User: "rc" -> a red card exists.',
    '',
    `User condition: ${conditionText}`,
  ].join('\n');
}

export async function compileMatchAlertFreeTextRule(
  conditionText: string,
  options: { allowLlm?: boolean } = {},
): Promise<MatchAlertRuleCompileResult> {
  const normalizedText = normalizeText(conditionText);
  if (!normalizedText) {
    return { status: 'unsupported', normalizedText, unsupportedReason: 'Condition text is empty' };
  }

  const deterministic = compileDeterministic(conditionText);
  if (deterministic) {
    return { status: 'compiled', source: 'deterministic', normalizedText, ruleJson: deterministic };
  }

  const allowLlm = options.allowLlm !== false && config.matchAlertLlmEnabled && Boolean(config.geminiApiKey);
  if (!allowLlm) {
    return {
      status: 'unsupported',
      normalizedText,
      unsupportedReason: 'Condition text is not supported by the deterministic compiler',
    };
  }

  const model = config.geminiMatchAlertModel;
  try {
    const response = await generateGeminiContent(buildMatchAlertRuleCompilePrompt(conditionText), {
      model,
      timeoutMs: config.matchAlertLlmTimeoutMs,
      temperature: 0,
      maxOutputTokens: config.matchAlertLlmMaxOutputTokens,
      responseMimeType: 'application/json',
      thinkingBudget: 0,
      aiGatewayContext: {
        operation: 'match_alert.compile_free_text',
        featureKey: 'match_alert_free_text_compiler',
      },
    });
    const rawText = extractCandidateText(response);
    const parsed = extractJsonObject(rawText);
    if (parsed.supported === false) {
      return {
        status: 'unsupported',
        source: 'llm',
        model,
        normalizedText,
        rawText,
        unsupportedReason: typeof parsed.reason === 'string' ? parsed.reason : 'LLM compiler marked condition unsupported',
      };
    }
    const ruleJson = validateCompiledRuleJson(parsed);
    if (!ruleJson) {
      return {
        status: 'unsupported',
        source: 'llm',
        model,
        normalizedText,
        rawText,
        unsupportedReason: 'LLM compiler returned an invalid rule',
      };
    }
    return { status: 'compiled', source: 'llm', model, normalizedText, rawText, ruleJson };
  } catch (error) {
    return {
      status: 'unsupported',
      source: 'llm',
      model,
      normalizedText,
      unsupportedReason: error instanceof Error ? error.message : 'LLM compiler failed',
    };
  }
}
