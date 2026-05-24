/**
 * Line Ladder Patience (LLP): deterministic line/cushion gates after AI parse.
 * See docs/line-ladder-patience-spec.md
 */
import { normalizeMarket } from './normalize-market.js';
import { sameOddsLine } from './odds-line-utils.js';

export interface LinePatienceOuRung {
  line: number;
  over: number | null;
  under: number | null;
}

export interface LinePatienceOddsCanonical {
  ou?: LinePatienceOuRung;
  ou_adjacent?: LinePatienceOuRung;
  corners_ou?: LinePatienceOuRung;
}

export interface LinePatienceEventCompact {
  minute: number;
  type: string;
  detail: string;
}

export interface LinePatienceConfig {
  exceptionalMinConfidence: number;
  exceptionalMinEdgePercent: number;
  postEventCooldownMinutes: number;
  goalsUnderBlockedQuarterLines: number[];
  goalsUnderRemapMinMinute: number;
  goalsUnderRemapMinCushion: number;
  goalsOverRemapMaxLine: number;
  cornersOverPreferredMaxLine: number;
  ahChalkMinAbsLine: number;
  ahWaitOuMainOverLineMax: number;
  minCushionUnderByMinute: Record<string, number>;
}

export const DEFAULT_LINE_PATIENCE_CONFIG: LinePatienceConfig = {
  exceptionalMinConfidence: 9,
  exceptionalMinEdgePercent: 8,
  postEventCooldownMinutes: 3,
  goalsUnderBlockedQuarterLines: [0.5, 0.75],
  goalsUnderRemapMinMinute: 60,
  goalsUnderRemapMinCushion: 1.0,
  goalsOverRemapMaxLine: 1.0,
  cornersOverPreferredMaxLine: 7.5,
  ahChalkMinAbsLine: 0.5,
  ahWaitOuMainOverLineMax: 1.0,
  minCushionUnderByMinute: { '75+': 0.5 },
};

export interface LinePatiencePolicyInput {
  selection: string;
  betMarket: string;
  minute: number;
  score: string;
  confidence: number;
  valuePercent: number;
  evidenceMode: string;
  oddsCanonical: LinePatienceOddsCanonical;
  eventsCompact?: LinePatienceEventCompact[];
  enabled?: boolean;
  config?: LinePatienceConfig;
}

export interface LinePatiencePolicyResult {
  blocked: boolean;
  remapped: boolean;
  warnings: string[];
  selection: string;
  betMarket: string;
}

export function parseLinePatienceConfigJson(raw: string): Partial<LinePatienceConfig> {
  return JSON.parse(raw) as Partial<LinePatienceConfig>;
}

export function mergeLinePatienceConfig(
  base: LinePatienceConfig,
  override: Partial<LinePatienceConfig>,
): LinePatienceConfig {
  return {
    ...base,
    ...override,
    goalsUnderBlockedQuarterLines:
      override.goalsUnderBlockedQuarterLines ?? base.goalsUnderBlockedQuarterLines,
    minCushionUnderByMinute: {
      ...base.minCushionUnderByMinute,
      ...(override.minCushionUnderByMinute ?? {}),
    },
  };
}

function getMarketLine(canonicalMarket: string): number | null {
  const match = String(canonicalMarket || '').trim().match(/_(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const line = Number(match[1]);
  return Number.isFinite(line) ? line : null;
}

function getTotalGoals(score: string): number | null {
  const m = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) return null;
  const home = Number(m[1] ?? 0);
  const away = Number(m[2] ?? 0);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return home + away;
}

function getMinuteBand(minute: number): string {
  if (minute <= 29) return '00-29';
  if (minute <= 44) return '30-44';
  if (minute <= 59) return '45-59';
  if (minute <= 74) return '60-74';
  return '75+';
}

function getAhHomeLine(canonicalMarket: string): number | null {
  const prefix = 'asian_handicap_home_';
  if (!canonicalMarket.startsWith(prefix)) return null;
  const n = Number(canonicalMarket.slice(prefix.length));
  return Number.isFinite(n) ? n : null;
}

function getAhAwayLine(canonicalMarket: string): number | null {
  const prefix = 'asian_handicap_away_';
  if (!canonicalMarket.startsWith(prefix)) return null;
  const n = Number(canonicalMarket.slice(prefix.length));
  return Number.isFinite(n) ? n : null;
}

function formatUnsignedLine(line: number): string {
  return Number.isInteger(line) ? String(line) : String(line);
}

export function formatSelectionForMarket(canonicalMarket: string): string {
  if (canonicalMarket.startsWith('under_')) {
    const line = getMarketLine(canonicalMarket);
    return line != null ? `Under ${formatUnsignedLine(line)} Goals` : 'Under Goals';
  }
  if (canonicalMarket.startsWith('over_')) {
    const line = getMarketLine(canonicalMarket);
    return line != null ? `Over ${formatUnsignedLine(line)} Goals` : 'Over Goals';
  }
  if (canonicalMarket.startsWith('corners_over_')) {
    const line = getMarketLine(canonicalMarket);
    return line != null ? `Over ${formatUnsignedLine(line)} Corners` : 'Over Corners';
  }
  if (canonicalMarket.startsWith('corners_under_')) {
    const line = getMarketLine(canonicalMarket);
    return line != null ? `Under ${formatUnsignedLine(line)} Corners` : 'Under Corners';
  }
  if (canonicalMarket.startsWith('asian_handicap_home_')) {
    const line = getAhHomeLine(canonicalMarket);
    return line != null ? `Asian Handicap Home ${line}` : 'Asian Handicap Home';
  }
  if (canonicalMarket.startsWith('asian_handicap_away_')) {
    const line = getAhAwayLine(canonicalMarket);
    return line != null ? `Asian Handicap Away ${line}` : 'Asian Handicap Away';
  }
  return canonicalMarket;
}

function hasUsablePrice(price: number | null | undefined): boolean {
  return price != null && Number.isFinite(price) && price > 0;
}

interface GoalsOuLineQuote {
  line: number;
  over: number | null;
  under: number | null;
}

function listGoalsOuQuotes(canonical: LinePatienceOddsCanonical): GoalsOuLineQuote[] {
  const rows: GoalsOuLineQuote[] = [];
  if (canonical.ou?.line != null) {
    rows.push({
      line: canonical.ou.line,
      over: canonical.ou.over ?? null,
      under: canonical.ou.under ?? null,
    });
  }
  if (canonical.ou_adjacent?.line != null) {
    const adj = canonical.ou_adjacent;
    if (!rows.some((r) => sameOddsLine(r.line, adj.line))) {
      rows.push({ line: adj.line, over: adj.over ?? null, under: adj.under ?? null });
    }
  }
  return rows.sort((a, b) => a.line - b.line);
}

function findBestUnderLine(
  canonical: LinePatienceOddsCanonical,
  minLine: number,
): number | null {
  const quotes = listGoalsOuQuotes(canonical)
    .filter((q) => q.line >= minLine && hasUsablePrice(q.under));
  if (quotes.length === 0) return null;
  return quotes[0]!.line;
}

function findBestOverLine(
  canonical: LinePatienceOddsCanonical,
  maxLine: number,
): number | null {
  const quotes = listGoalsOuQuotes(canonical)
    .filter((q) => q.line <= maxLine && hasUsablePrice(q.over))
    .sort((a, b) => b.line - a.line);
  return quotes.length > 0 ? quotes[0]!.line : null;
}

function hasGoalsOverLineAtMost(canonical: LinePatienceOddsCanonical, maxLine: number): boolean {
  return listGoalsOuQuotes(canonical).some(
    (q) => q.line <= maxLine && hasUsablePrice(q.over),
  );
}

function isQuarterLine(line: number, quarters: number[]): boolean {
  return quarters.some((q) => sameOddsLine(line, q));
}

function isExceptional(
  input: LinePatiencePolicyInput,
  config: LinePatienceConfig,
): boolean {
  return (
    String(input.evidenceMode ?? '').trim() === 'full_live_data'
    && input.confidence >= config.exceptionalMinConfidence
    && input.valuePercent >= config.exceptionalMinEdgePercent
  );
}

function hadRecentShockEvent(
  events: LinePatienceEventCompact[] | undefined,
  currentMinute: number,
  cooldownMinutes: number,
): boolean {
  if (!events?.length || cooldownMinutes <= 0) return false;
  for (const ev of events) {
    const evMinute = Number(ev.minute);
    if (!Number.isFinite(evMinute) || currentMinute - evMinute > cooldownMinutes) continue;
    const type = String(ev.type ?? '').toLowerCase();
    const detail = String(ev.detail ?? '').toLowerCase();
    if (type.includes('goal') || detail.includes('goal')) return true;
    if (detail.includes('red card') || detail.includes('red_card') || detail === 'red card') {
      return true;
    }
  }
  return false;
}

function isPatienceSensitiveMarket(canonicalMarket: string): boolean {
  return (
    canonicalMarket.startsWith('under_')
    || canonicalMarket.startsWith('over_')
    || canonicalMarket.startsWith('corners_over_')
    || canonicalMarket.startsWith('asian_handicap_')
  );
}

function getMinCushionUnder(minute: number, config: LinePatienceConfig): number | null {
  const band = getMinuteBand(minute);
  const v = config.minCushionUnderByMinute[band];
  return v != null && Number.isFinite(v) ? v : null;
}

export function applyLinePatiencePolicy(input: LinePatiencePolicyInput): LinePatiencePolicyResult {
  const config = input.config ?? DEFAULT_LINE_PATIENCE_CONFIG;
  const selection = String(input.selection ?? '').trim();
  const betMarket = String(input.betMarket ?? '').trim();
  const canonicalMarket = normalizeMarket(selection, betMarket);

  const base: LinePatiencePolicyResult = {
    blocked: false,
    remapped: false,
    warnings: [],
    selection,
    betMarket: canonicalMarket !== 'unknown' ? canonicalMarket : betMarket,
  };

  if (input.enabled === false || canonicalMarket === 'unknown' || !canonicalMarket) {
    return base;
  }

  if (!isPatienceSensitiveMarket(canonicalMarket)) {
    return base;
  }

  const exceptional = isExceptional(input, config);
  const warnings: string[] = [];
  let blocked = false;
  let remapped = false;
  let nextMarket = canonicalMarket;
  let nextSelection = selection;

  const block = (code: string) => {
    blocked = true;
    warnings.push(code);
  };

  const remapTo = (market: string, code: string) => {
    nextMarket = market;
    nextSelection = formatSelectionForMarket(market);
    remapped = true;
    warnings.push(code);
  };

  const marketLine = getMarketLine(canonicalMarket);
  const totalGoals = getTotalGoals(input.score);
  const minute = Number.isFinite(input.minute) ? input.minute : 0;

  if (
    !exceptional
    && hadRecentShockEvent(input.eventsCompact, minute, config.postEventCooldownMinutes)
    && isPatienceSensitiveMarket(canonicalMarket)
  ) {
    block('LLP_BLOCK_POST_EVENT_COOLDOWN');
    return { blocked, remapped, warnings, selection: nextSelection, betMarket: nextMarket };
  }

  // Goals Under — quarter lines
  if (canonicalMarket.startsWith('under_') && marketLine != null) {
    if (
      !exceptional
      && isQuarterLine(marketLine, config.goalsUnderBlockedQuarterLines)
    ) {
      const conservativeLine = findBestUnderLine(input.oddsCanonical, 1.0);
      if (conservativeLine != null && conservativeLine > marketLine) {
        remapTo(`under_${formatUnsignedLine(conservativeLine)}`, 'LLP_REMAP_UNDER_CONSERVATIVE_LINE');
      } else {
        block('LLP_BLOCK_UNDER_QUARTER_LINE');
      }
    } else if (
      !exceptional
      && minute >= config.goalsUnderRemapMinMinute
      && totalGoals != null
      && marketLine - totalGoals < config.goalsUnderRemapMinCushion
    ) {
      const conservativeLine = findBestUnderLine(input.oddsCanonical, 1.0);
      if (
        conservativeLine != null
        && conservativeLine > marketLine
        && hasUsablePrice(
          listGoalsOuQuotes(input.oddsCanonical).find((q) => sameOddsLine(q.line, conservativeLine))?.under,
        )
      ) {
        remapTo(`under_${formatUnsignedLine(conservativeLine)}`, 'LLP_REMAP_UNDER_CONSERVATIVE_LINE');
      }
    }

    const effectiveLine = getMarketLine(nextMarket);
    const minCushion = getMinCushionUnder(minute, config);
    if (
      !blocked
      && !exceptional
      && effectiveLine != null
      && totalGoals != null
      && minCushion != null
      && effectiveLine - totalGoals < minCushion
    ) {
      block('LLP_BLOCK_LOW_CUSHION');
    }
  }

  // Goals Over — remap down or block
  if (!blocked && canonicalMarket.startsWith('over_') && marketLine != null) {
    if (!exceptional && marketLine > config.goalsOverRemapMaxLine) {
      const targetLine = findBestOverLine(input.oddsCanonical, config.goalsOverRemapMaxLine);
      if (targetLine != null && targetLine < marketLine) {
        remapTo(`over_${formatUnsignedLine(targetLine)}`, 'LLP_REMAP_OVER_CONSERVATIVE_LINE');
      } else {
        block('LLP_BLOCK_OVER_AGGRESSIVE_LINE');
      }
    }

    const effectiveLine = getMarketLine(nextMarket);
    if (
      !blocked
      && !exceptional
      && effectiveLine != null
      && totalGoals != null
      && minute >= 75
      && effectiveLine - totalGoals < 0.5
    ) {
      block('LLP_BLOCK_LOW_CUSHION');
    }
  }

  // Corners Over — single rung in feed
  if (!blocked && canonicalMarket.startsWith('corners_over_') && marketLine != null) {
    const mainLine = input.oddsCanonical.corners_ou?.line ?? null;
    if (
      !exceptional
      && (
        (mainLine != null && marketLine > mainLine)
        || marketLine > config.cornersOverPreferredMaxLine
        || (mainLine != null && sameOddsLine(marketLine, mainLine) && marketLine > config.cornersOverPreferredMaxLine)
      )
    ) {
      block('LLP_BLOCK_CORNERS_OVER_AGGRESSIVE_LINE');
    }
  }

  // Asian Handicap chalk — wait for O/U over line to compress
  if (!blocked && canonicalMarket.startsWith('asian_handicap_')) {
    const homeLine = getAhHomeLine(canonicalMarket);
    const awayLine = getAhAwayLine(canonicalMarket);
    const chalkAbs =
      homeLine != null && homeLine <= -config.ahChalkMinAbsLine
        ? Math.abs(homeLine)
        : awayLine != null && awayLine >= config.ahChalkMinAbsLine
          ? Math.abs(awayLine)
          : null;

    if (!exceptional && chalkAbs != null) {
      const mainOuLine = input.oddsCanonical.ou?.line ?? null;
      const ouStillHigh =
        mainOuLine != null && mainOuLine > config.ahWaitOuMainOverLineMax;
      const hasCompressedOver = hasGoalsOverLineAtMost(
        input.oddsCanonical,
        config.ahWaitOuMainOverLineMax,
      );
      if (ouStillHigh && !hasCompressedOver) {
        block('LLP_BLOCK_AH_WAIT_OU_OVER_LINE');
      }
    }
  }

  return {
    blocked,
    remapped,
    warnings,
    selection: nextSelection,
    betMarket: nextMarket,
  };
}
