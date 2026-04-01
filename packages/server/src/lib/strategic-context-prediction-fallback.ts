import { buildNoDataStrategicContext, type StrategicContext } from './strategic-context.service.js';

const NO_DATA_RE = /^(?:no data found|khong tim thay du lieu|không tìm thấy dữ liệu)$/i;

interface PredictionLike {
  predictions?: {
    advice?: string | null;
    winner?: { name?: string | null } | null;
  } | null;
  team_form?: {
    home?: string | null;
    away?: string | null;
  } | null;
  h2h_summary?: {
    total?: number | null;
    home_wins?: number | null;
    away_wins?: number | null;
    draws?: number | null;
  } | null;
}

export interface StrategicPredictionFallbackInput {
  homeTeam: string;
  awayTeam: string;
  prediction: unknown;
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function isMissingText(value: unknown): boolean {
  const text = cleanText(value);
  return !text || NO_DATA_RE.test(text);
}

function calculateRecentPoints(sequence: string | null | undefined, matches = 5): number | null {
  const form = cleanText(sequence).toUpperCase().replace(/[^WDL]/g, '');
  if (!form) return null;
  const recent = form.slice(-matches);
  if (!recent) return null;

  let points = 0;
  for (const result of recent) {
    if (result === 'W') points += 3;
    else if (result === 'D') points += 1;
  }
  return points;
}

function buildH2hNarrativeEn(homeTeam: string, awayTeam: string, h2h: PredictionLike['h2h_summary']): string {
  const total = Number(h2h?.total ?? 0);
  const homeWins = Number(h2h?.home_wins ?? 0);
  const awayWins = Number(h2h?.away_wins ?? 0);
  const draws = Number(h2h?.draws ?? 0);
  if (total <= 0) return '';
  return `Last ${total} H2H: ${homeTeam} won ${homeWins}, ${awayTeam} won ${awayWins}, draws ${draws}.`;
}

function buildH2hNarrativeVi(homeTeam: string, awayTeam: string, h2h: PredictionLike['h2h_summary']): string {
  const total = Number(h2h?.total ?? 0);
  const homeWins = Number(h2h?.home_wins ?? 0);
  const awayWins = Number(h2h?.away_wins ?? 0);
  const draws = Number(h2h?.draws ?? 0);
  if (total <= 0) return '';
  return `${total} tran doi dau gan nhat: ${homeTeam} thang ${homeWins}, ${awayTeam} thang ${awayWins}, hoa ${draws}.`;
}

function buildSummaryEn(
  homeTeam: string,
  awayTeam: string,
  prediction: PredictionLike,
  homeRecentPoints: number | null,
  awayRecentPoints: number | null,
): string {
  const winner = cleanText(prediction.predictions?.winner?.name);
  const advice = cleanText(prediction.predictions?.advice);
  const segments: string[] = [];

  if (winner) {
    segments.push(`Pre-match model leans ${winner}.`);
  } else if (advice) {
    segments.push(advice.endsWith('.') ? advice : `${advice}.`);
  }

  if (homeRecentPoints != null && awayRecentPoints != null) {
    segments.push(`Recent 5-match form points: ${homeTeam} ${homeRecentPoints}, ${awayTeam} ${awayRecentPoints}.`);
  }

  const h2hText = buildH2hNarrativeEn(homeTeam, awayTeam, prediction.h2h_summary);
  if (h2hText) segments.push(h2hText);

  return segments.join(' ').trim();
}

function buildSummaryVi(
  homeTeam: string,
  awayTeam: string,
  prediction: PredictionLike,
  homeRecentPoints: number | null,
  awayRecentPoints: number | null,
): string {
  const winner = cleanText(prediction.predictions?.winner?.name);
  const advice = cleanText(prediction.predictions?.advice);
  const segments: string[] = [];

  if (winner) {
    segments.push(`Mo hinh truoc tran nghieng ve ${winner}.`);
  } else if (advice) {
    segments.push(advice.endsWith('.') ? advice : `${advice}.`);
  }

  if (homeRecentPoints != null && awayRecentPoints != null) {
    segments.push(`Diem form 5 tran gan nhat: ${homeTeam} ${homeRecentPoints}, ${awayTeam} ${awayRecentPoints}.`);
  }

  const h2hText = buildH2hNarrativeVi(homeTeam, awayTeam, prediction.h2h_summary);
  if (h2hText) segments.push(h2hText);

  return segments.join(' ').trim();
}

export function mergeStrategicContextWithPredictionFallback(
  context: StrategicContext | null,
  input: StrategicPredictionFallbackInput,
): StrategicContext {
  const baseContext = context ?? buildNoDataStrategicContext();
  const prediction = (input.prediction && typeof input.prediction === 'object')
    ? input.prediction as PredictionLike
    : null;
  if (!prediction) return baseContext;

  const homeRecentPoints = calculateRecentPoints(prediction.team_form?.home);
  const awayRecentPoints = calculateRecentPoints(prediction.team_form?.away);
  const fallbackSummaryEn = buildSummaryEn(input.homeTeam, input.awayTeam, prediction, homeRecentPoints, awayRecentPoints);
  const fallbackSummaryVi = buildSummaryVi(input.homeTeam, input.awayTeam, prediction, homeRecentPoints, awayRecentPoints);
  const fallbackH2hEn = buildH2hNarrativeEn(input.homeTeam, input.awayTeam, prediction.h2h_summary);
  const fallbackH2hVi = buildH2hNarrativeVi(input.homeTeam, input.awayTeam, prediction.h2h_summary);

  const summaryEn = isMissingText(baseContext.summary) && fallbackSummaryEn ? fallbackSummaryEn : baseContext.summary;
  const summaryVi = isMissingText(baseContext.summary_vi) && fallbackSummaryVi ? fallbackSummaryVi : baseContext.summary_vi;
  const h2hEn = isMissingText(baseContext.h2h_narrative) && fallbackH2hEn ? fallbackH2hEn : baseContext.h2h_narrative;
  const h2hVi = isMissingText(baseContext.h2h_narrative_vi) && fallbackH2hVi ? fallbackH2hVi : baseContext.h2h_narrative_vi;
  const predictionFallbackUsed = (
    summaryEn !== baseContext.summary
    || summaryVi !== baseContext.summary_vi
    || h2hEn !== baseContext.h2h_narrative
    || h2hVi !== baseContext.h2h_narrative_vi
    || (baseContext.quantitative.home_last5_points == null && homeRecentPoints != null)
    || (baseContext.quantitative.away_last5_points == null && awayRecentPoints != null)
  );

  return {
    ...baseContext,
    summary: summaryEn,
    summary_vi: summaryVi,
    h2h_narrative: h2hEn,
    h2h_narrative_vi: h2hVi,
    qualitative: {
      en: {
        ...baseContext.qualitative.en,
        summary: isMissingText(baseContext.qualitative.en.summary) && fallbackSummaryEn ? fallbackSummaryEn : baseContext.qualitative.en.summary,
        h2h_narrative: isMissingText(baseContext.qualitative.en.h2h_narrative) && fallbackH2hEn ? fallbackH2hEn : baseContext.qualitative.en.h2h_narrative,
      },
      vi: {
        ...baseContext.qualitative.vi,
        summary: isMissingText(baseContext.qualitative.vi.summary) && fallbackSummaryVi ? fallbackSummaryVi : baseContext.qualitative.vi.summary,
        h2h_narrative: isMissingText(baseContext.qualitative.vi.h2h_narrative) && fallbackH2hVi ? fallbackH2hVi : baseContext.qualitative.vi.h2h_narrative,
      },
    },
    quantitative: {
      ...baseContext.quantitative,
      home_last5_points: baseContext.quantitative.home_last5_points ?? homeRecentPoints,
      away_last5_points: baseContext.quantitative.away_last5_points ?? awayRecentPoints,
    },
    source_meta: {
      ...baseContext.source_meta,
      prediction_fallback_used: baseContext.source_meta.prediction_fallback_used || predictionFallbackUsed,
    },
  };
}
