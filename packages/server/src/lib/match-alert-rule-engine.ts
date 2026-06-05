export type MatchAlertKind = 'match_start' | 'condition_signal';
export type MatchAlertSeverity = 'info' | 'medium' | 'high';
export type MatchAlertSuggestedAction = 'open_match' | 'review_live_market' | 'ask_ai' | 'avoid_chasing';

export interface MatchAlertContext {
  matchId: string;
  status: string;
  minute: number | null;
  kickoffAtUtc: string | null;
  nowIso?: string;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  score: {
    home: number;
    away: number;
    total: number;
    state: 'draw' | 'home_leading' | 'away_leading';
    leadingSide: 'home' | 'away' | null;
    losingSide: 'home' | 'away' | null;
  };
  stats: Record<string, unknown>;
  events: Record<string, unknown>;
  derived: Record<string, unknown>;
  dataFreshness?: {
    snapshotAgeSeconds: number | null;
  };
}

export type MatchAlertRuleNode =
  | { all: MatchAlertRuleNode[] }
  | { any: MatchAlertRuleNode[] }
  | { not: MatchAlertRuleNode }
  | { field: string; op: string; value?: unknown };

export interface MatchAlertRuleJson {
  version?: number;
  id?: string;
  label?: string;
  labelVi?: string;
  severity?: MatchAlertSeverity;
  suggestedAction?: MatchAlertSuggestedAction;
  all?: MatchAlertRuleNode[];
  any?: MatchAlertRuleNode[];
  not?: MatchAlertRuleNode;
  field?: string;
  op?: string;
  value?: unknown;
}

export interface MatchAlertEvaluationResult {
  matched: boolean;
  supported: boolean;
  triggerKey: string | null;
  summaryEn: string;
  summaryVi: string;
  severity: MatchAlertSeverity;
  suggestedAction: MatchAlertSuggestedAction;
  facts: Record<string, unknown>;
  unsupportedReason?: string;
}

const COMPARISON_OPS = new Set(['=', '==', '!=', '>', '>=', '<', '<=', 'exists', 'in', 'contains', 'changed']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getPath(root: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/%/g, '').trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function compareValues(left: unknown, op: string, right: unknown): boolean | null {
  if (!COMPARISON_OPS.has(op)) return null;
  if (op === 'exists') return left !== undefined && left !== null && left !== '';
  if (op === 'changed') return Boolean(left);
  if (op === 'in') {
    if (!Array.isArray(right)) return null;
    return right.includes(left);
  }
  if (op === 'contains') {
    if (Array.isArray(left)) return left.includes(right);
    if (typeof left === 'string' && typeof right === 'string') {
      return left.toLowerCase().includes(right.toLowerCase());
    }
    return null;
  }

  if (op === '=' || op === '==') return left === right;
  if (op === '!=') return left !== right;

  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber == null || rightNumber == null) return null;
  if (op === '>') return leftNumber > rightNumber;
  if (op === '>=') return leftNumber >= rightNumber;
  if (op === '<') return leftNumber < rightNumber;
  if (op === '<=') return leftNumber <= rightNumber;
  return null;
}

function evaluateNode(node: MatchAlertRuleNode, context: MatchAlertContext): { supported: boolean; matched: boolean; reason?: string } {
  if ('all' in node) {
    if (!Array.isArray(node.all)) return { supported: false, matched: false, reason: 'Invalid all clause' };
    for (const child of node.all) {
      const result = evaluateNode(child, context);
      if (!result.supported) return result;
      if (!result.matched) return { supported: true, matched: false };
    }
    return { supported: true, matched: true };
  }

  if ('any' in node) {
    if (!Array.isArray(node.any)) return { supported: false, matched: false, reason: 'Invalid any clause' };
    let sawSupported = false;
    const unsupportedReasons: string[] = [];
    for (const child of node.any) {
      const result = evaluateNode(child, context);
      if (result.supported) sawSupported = true;
      else if (result.reason) unsupportedReasons.push(result.reason);
      if (result.supported && result.matched) return { supported: true, matched: true };
    }
    if (!sawSupported) {
      return { supported: false, matched: false, reason: unsupportedReasons[0] ?? 'No supported any clause' };
    }
    return { supported: true, matched: false };
  }

  if ('not' in node) {
    const result = evaluateNode(node.not, context);
    return result.supported
      ? { supported: true, matched: !result.matched }
      : result;
  }

  if (!('field' in node) || typeof node.field !== 'string' || typeof node.op !== 'string') {
    return { supported: false, matched: false, reason: 'Invalid leaf clause' };
  }

  const left = getPath(context, node.field);
  const matched = compareValues(left, node.op, node.value);
  if (matched == null) {
    return { supported: false, matched: false, reason: `Unsupported clause: ${node.field} ${node.op}` };
  }
  return { supported: true, matched };
}

function getRuleRoot(rule: MatchAlertRuleJson): MatchAlertRuleNode | null {
  if (Array.isArray(rule.all)) return { all: rule.all as MatchAlertRuleNode[] };
  if (Array.isArray(rule.any)) return { any: rule.any as MatchAlertRuleNode[] };
  if (isRecord(rule.not)) return { not: rule.not as MatchAlertRuleNode };
  if (typeof rule.field === 'string' && typeof rule.op === 'string') {
    return rule as MatchAlertRuleNode;
  }
  return null;
}

function getSideFromValue(value: unknown): 'home' | 'away' | null {
  return value === 'home' || value === 'away' ? value : null;
}

function deriveTriggerKey(alertKind: MatchAlertKind, rule: MatchAlertRuleJson, context: MatchAlertContext): string {
  const ruleId = String(rule.id || alertKind);
  if (alertKind === 'match_start') {
    return `match_start:${context.matchId}`;
  }

  const redSide = getSideFromValue(getPath(context, 'events.red_card.side'));
  const redMinute = toNumber(getPath(context, 'events.red_card.minute'));
  if (ruleId.includes('red_card') && redSide && redMinute != null) {
    return `${ruleId}:${context.matchId}:${redSide}:${redMinute}`;
  }

  const firstGoalSide = getSideFromValue(getPath(context, 'events.first_goal.side'));
  const firstGoalMinute = toNumber(getPath(context, 'events.first_goal.minute'));
  if (ruleId.includes('scores_first') && firstGoalSide) {
    return `${ruleId}:${context.matchId}:${firstGoalSide}:${firstGoalMinute ?? context.minute ?? 'unknown'}`;
  }

  const lastGoalMinute = toNumber(getPath(context, 'events.last_goal.minute'));
  if (ruleId.includes('goal') && lastGoalMinute != null) {
    return `${ruleId}:${context.matchId}:${lastGoalMinute}`;
  }

  return `${ruleId}:${context.matchId}:${context.minute ?? 'unknown'}:${context.score.home}-${context.score.away}`;
}

function buildSummary(alertKind: MatchAlertKind, rule: MatchAlertRuleJson, context: MatchAlertContext): { en: string; vi: string } {
  if (alertKind === 'match_start') {
    return {
      en: `${context.homeTeam} vs ${context.awayTeam} has started.`,
      vi: `${context.homeTeam} vs ${context.awayTeam} đã bắt đầu.`,
    };
  }

  const label = String(rule.label || rule.id || 'Live signal');
  const labelVi = String(rule.labelVi || label);
  const score = `${context.score.home}-${context.score.away}`;
  const minute = context.minute == null ? '' : `${context.minute}'`;
  return {
    en: `${label} matched at ${minute}. Score ${score}.`,
    vi: `${labelVi} đã thỏa ở phút ${minute}. Tỷ số ${score}.`,
  };
}

export function evaluateMatchAlertRule(
  alertKind: MatchAlertKind,
  rawRule: unknown,
  context: MatchAlertContext,
): MatchAlertEvaluationResult {
  const rule = isRecord(rawRule) ? rawRule as MatchAlertRuleJson : {};
  const root = getRuleRoot(rule);
  const severity: MatchAlertSeverity =
    rule.severity === 'high' || rule.severity === 'medium' || rule.severity === 'info'
      ? rule.severity
      : (alertKind === 'match_start' ? 'info' : 'medium');
  const suggestedAction: MatchAlertSuggestedAction =
    rule.suggestedAction === 'ask_ai'
      || rule.suggestedAction === 'avoid_chasing'
      || rule.suggestedAction === 'open_match'
      || rule.suggestedAction === 'review_live_market'
      ? rule.suggestedAction
      : (alertKind === 'match_start' ? 'open_match' : 'review_live_market');

  if (!root) {
    return {
      matched: false,
      supported: false,
      triggerKey: null,
      summaryEn: 'Unsupported alert rule',
      summaryVi: 'Rule cảnh báo chưa được hỗ trợ',
      severity,
      suggestedAction,
      facts: {},
      unsupportedReason: 'Rule has no evaluable root clause',
    };
  }

  const result = evaluateNode(root, context);
  if (!result.supported || !result.matched) {
    return {
      matched: false,
      supported: result.supported,
      triggerKey: null,
      summaryEn: result.reason ?? 'Alert condition not matched',
      summaryVi: result.reason ?? 'Điều kiện cảnh báo chưa thỏa',
      severity,
      suggestedAction,
      facts: {},
      unsupportedReason: result.supported ? undefined : result.reason,
    };
  }

  const summary = buildSummary(alertKind, rule, context);
  return {
    matched: true,
    supported: true,
    triggerKey: deriveTriggerKey(alertKind, rule, context),
    summaryEn: summary.en,
    summaryVi: summary.vi,
    severity,
    suggestedAction,
    facts: {
      minute: context.minute,
      status: context.status,
      score: context.score,
      events: context.events,
      derived: context.derived,
      dataFreshness: context.dataFreshness,
    },
  };
}
