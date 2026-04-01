export interface ConditionEvaluationContext {
  minute: number | null;
  homeGoals: number;
  awayGoals: number;
  stats: ConditionStatsSnapshot;
}

export interface ConditionStatsSnapshot {
  possession?: { home: string | null; away: string | null };
  shots?: { home: string | null; away: string | null };
  shots_on_target?: { home: string | null; away: string | null };
  corners?: { home: string | null; away: string | null };
}

export interface ConditionEvaluationResult {
  supported: boolean;
  matched: boolean;
  summary: string;
}

const STAT_ALIASES: Record<string, { key: keyof ConditionStatsSnapshot; side: 'home' | 'away' }> = {
  possession_home: { key: 'possession', side: 'home' },
  possession_away: { key: 'possession', side: 'away' },
  shots_home: { key: 'shots', side: 'home' },
  shots_away: { key: 'shots', side: 'away' },
  shots_on_target_home: { key: 'shots_on_target', side: 'home' },
  shots_on_target_away: { key: 'shots_on_target', side: 'away' },
  corners_home: { key: 'corners', side: 'home' },
  corners_away: { key: 'corners', side: 'away' },
  home_shots_on_target: { key: 'shots_on_target', side: 'home' },
  away_shots_on_target: { key: 'shots_on_target', side: 'away' },
};

function normalizeConditionText(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripClauseParens(value: string): string {
  let out = value.trim();
  while (out.startsWith('(') && out.endsWith(')')) {
    const inner = out.slice(1, -1).trim();
    if (!inner) break;
    out = inner;
  }
  return out;
}

function toNumber(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/%/g, '').trim();
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function compare(left: number, operator: string, right: number): boolean {
  switch (operator) {
    case '>=':
      return left >= right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '<':
      return left < right;
    case '=':
    case '==':
      return left === right;
    default:
      return false;
  }
}

function evaluateStateAtom(atom: string, context: ConditionEvaluationContext): boolean | null {
  const normalized = atom.toLowerCase();
  if (normalized === 'draw') return context.homeGoals === context.awayGoals;
  if (normalized === 'home leading') return context.homeGoals > context.awayGoals;
  if (normalized === 'away leading') return context.awayGoals > context.homeGoals;
  return null;
}

function evaluateNumericAtom(atom: string, context: ConditionEvaluationContext): boolean | null {
  const minuteMatch = atom.match(/^minute\s*(>=|<=|>|<|==|=)\s*(\d+)$/i);
  if (minuteMatch) {
    if (context.minute == null) return null;
    return compare(context.minute, minuteMatch[1]!, Number(minuteMatch[2]));
  }

  const totalGoalsMatch = atom.match(/^total goals\s*(>=|<=|>|<|==|=)\s*(\d+)$/i);
  if (totalGoalsMatch) {
    return compare(context.homeGoals + context.awayGoals, totalGoalsMatch[1]!, Number(totalGoalsMatch[2]));
  }

  const statMatch = atom.match(/^([a-z_ ]+?)\s*(>=|<=|>|<|==|=)\s*(-?\d+(?:\.\d+)?)$/i);
  if (!statMatch) return null;

  const left = statMatch[1]!
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/^home_/, 'home_')
    .replace(/^away_/, 'away_');

  const alias = STAT_ALIASES[left];
  if (!alias) return null;

  const statPair = context.stats[alias.key];
  const rawValue = statPair?.[alias.side] ?? null;
  const numericValue = toNumber(rawValue);
  if (numericValue == null) return null;

  return compare(numericValue, statMatch[2]!, Number(statMatch[3]));
}

function evaluateAtom(atom: string, context: ConditionEvaluationContext): boolean | null {
  const trimmed = stripClauseParens(atom);
  const notMatch = trimmed.match(/^NOT\s+(.+)$/i);
  if (notMatch) {
    const inner = evaluateAtom(notMatch[1]!, context);
    return inner == null ? null : !inner;
  }

  const state = evaluateStateAtom(trimmed, context);
  if (state != null) return state;

  return evaluateNumericAtom(trimmed, context);
}

export function evaluateCustomConditionText(
  conditionText: string,
  context: ConditionEvaluationContext,
): ConditionEvaluationResult {
  const normalized = normalizeConditionText(conditionText);
  if (!normalized) {
    return { supported: true, matched: true, summary: 'No custom condition text' };
  }

  if (/\bOR\b/i.test(normalized)) {
    return { supported: false, matched: false, summary: 'Unsupported OR operator' };
  }

  const clauses = normalized.split(/\s+AND\s+/i).map(stripClauseParens).filter(Boolean);
  if (clauses.length === 0) {
    return { supported: false, matched: false, summary: 'No evaluable condition clauses' };
  }

  for (const clause of clauses) {
    const result = evaluateAtom(clause, context);
    if (result == null) {
      return { supported: false, matched: false, summary: `Unsupported clause: ${clause}` };
    }
    if (!result) {
      return { supported: true, matched: false, summary: `Condition not matched: ${clause}` };
    }
  }

  return { supported: true, matched: true, summary: `Condition matched: ${clauses.join(' AND ')}` };
}
