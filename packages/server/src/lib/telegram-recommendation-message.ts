import { formatSelectionWithMarketContext } from './market-display.js';

export type TelegramNotificationLanguage = 'vi' | 'en' | 'both';

export interface TelegramRecommendationMessageInput {
  kind: 'recommendation' | 'condition' | 'analysis';
  matchDisplay: string;
  league?: string | null;
  minute?: string | number | null;
  score?: string | null;
  status?: string | null;
  model?: string | null;
  mode?: string | null;
  selection?: string | null;
  betMarket?: string | null;
  odds?: number | null;
  confidence?: number | null;
  stakePercent?: number | null;
  riskLevel?: string | null;
  valuePercent?: number | null;
  reasoningEn?: string | null;
  reasoningVi?: string | null;
  warnings?: string | null;
  conditionText?: string | null;
  conditionSummaryEn?: string | null;
  conditionSummaryVi?: string | null;
  footerLabelEn?: string | null;
  footerLabelVi?: string | null;
  timestampLabel?: string | null;
  language: TelegramNotificationLanguage;
}

function safeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pickLocalizedText(
  lang: TelegramNotificationLanguage,
  english: string | null | undefined,
  vietnamese: string | null | undefined,
): string {
  const en = typeof english === 'string' ? english.trim() : '';
  const vi = typeof vietnamese === 'string' ? vietnamese.trim() : '';
  if (lang === 'en') return en || vi;
  if (lang === 'both') return [en, vi].filter(Boolean).join('\n\n');
  return vi || en;
}

function localizedLabel(
  lang: TelegramNotificationLanguage,
  english: string,
  vietnamese: string,
): string {
  if (lang === 'en') return english;
  if (lang === 'both') return `${english} / ${vietnamese}`;
  return vietnamese;
}

function localizedHeading(kind: TelegramRecommendationMessageInput['kind'], lang: TelegramNotificationLanguage): string {
  if (kind === 'condition') return localizedLabel(lang, 'CONDITION TRIGGERED', 'ĐIỀU KIỆN ĐÃ THỎA');
  if (kind === 'recommendation') return localizedLabel(lang, 'RECOMMENDATION', 'KHUYẾN NGHỊ');
  return localizedLabel(lang, 'MATCH ANALYSIS', 'PHÂN TÍCH TRẬN ĐẤU');
}

function getMetricLine(input: TelegramRecommendationMessageInput): string {
  const confidence = Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0;
  const stake = Number.isFinite(Number(input.stakePercent)) ? Number(input.stakePercent) : 0;
  const segments: string[] = [
    `${localizedLabel(input.language, 'Confidence', 'Độ tin cậy')}: ${confidence}/10`,
    `${localizedLabel(input.language, 'Stake', 'Tỷ trọng')}: ${stake}%`,
  ];
  if (input.kind === 'recommendation' && input.riskLevel) {
    segments.push(`${localizedLabel(input.language, 'Risk', 'Rủi ro')}: ${input.riskLevel}`);
  }
  if (input.kind === 'recommendation' && input.valuePercent != null && Number.isFinite(Number(input.valuePercent))) {
    segments.push(`${localizedLabel(input.language, 'Value', 'Lợi thế')}: ${Number(input.valuePercent)}%`);
  }
  return segments.join(' | ');
}

export function buildTelegramRecommendationMessage(input: TelegramRecommendationMessageInput): string {
  const lines: string[] = [];
  const heading = localizedHeading(input.kind, input.language);
  const minuteLabel = localizedLabel(input.language, 'Minute', 'Phút');
  const scoreLabel = localizedLabel(input.language, 'Score', 'Tỷ số');
  const conditionLabel = localizedLabel(input.language, 'Condition', 'Điều kiện');
  const matchedLabel = localizedLabel(input.language, 'Matched', 'Điều kiện đạt');
  const warningsLabel = localizedLabel(input.language, 'Warnings', 'Lưu ý');

  lines.push(`<b>${heading}</b>`);
  lines.push(`<b>${safeHtml(input.matchDisplay)}</b>`);
  if (input.league?.trim()) lines.push(safeHtml(input.league.trim()));

  const summaryParts = [
    input.minute != null && input.minute !== '' ? `${minuteLabel} ${safeHtml(String(input.minute))}'` : '',
    input.score?.trim() ? `${scoreLabel} ${safeHtml(input.score.trim())}` : '',
    input.status?.trim() ? safeHtml(input.status.trim()) : '',
  ].filter(Boolean);
  if (summaryParts.length > 0) lines.push(summaryParts.join(' | '));

  if (input.kind === 'condition' && input.conditionText?.trim()) {
    lines.push('');
    lines.push(`<b>${conditionLabel}:</b> ${safeHtml(input.conditionText.trim())}`);
  }

  const selection = formatSelectionWithMarketContext({
    selection: input.selection ?? '',
    betMarket: input.betMarket,
    odds: input.odds,
    language: input.language === 'vi' ? 'vi' : 'en',
  });
  if (selection) {
    lines.push('');
    lines.push(`<b>${safeHtml(selection)}</b>`);
  }

  const isNoBet = /^no bet\b/i.test(selection);
  if (selection && (!isNoBet || (Number(input.confidence ?? 0) > 0 || Number(input.stakePercent ?? 0) > 0))) {
    lines.push(getMetricLine(input));
  }

  const matchedSummary = pickLocalizedText(input.language, input.conditionSummaryEn, input.conditionSummaryVi);
  if (input.kind === 'condition' && matchedSummary) {
    lines.push(`${matchedLabel}: ${safeHtml(matchedSummary)}`);
  }

  const reasoning = pickLocalizedText(input.language, input.reasoningEn, input.reasoningVi);
  if (reasoning) {
    lines.push('');
    lines.push(safeHtml(reasoning));
  }

  const warningItems = (input.warnings ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (warningItems.length > 0) {
    lines.push('');
    lines.push(`${warningsLabel}: ${safeHtml(warningItems.join(' | '))}`);
  }

  const footer = pickLocalizedText(input.language, input.footerLabelEn, input.footerLabelVi);
  if (footer || input.timestampLabel?.trim()) {
    lines.push('');
    lines.push(`<i>${safeHtml([footer, input.timestampLabel?.trim() ?? ''].filter(Boolean).join(' | '))}</i>`);
  }

  return lines.filter((line, index, arr) => {
    if (line !== '') return true;
    const prev = arr[index - 1];
    return prev !== '';
  }).join('\n');
}
