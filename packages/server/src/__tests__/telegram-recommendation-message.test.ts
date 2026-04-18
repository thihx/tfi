import { describe, expect, test } from 'vitest';
import { buildTelegramRecommendationMessage } from '../lib/telegram-recommendation-message.js';

describe('buildTelegramRecommendationMessage', () => {
  test('renders recommendation content in English when notification language is en', () => {
    const message = buildTelegramRecommendationMessage({
      kind: 'recommendation',
      matchDisplay: 'Brisbane Roar vs Sydney',
      league: 'A-League',
      minute: 32,
      score: '0-0',
      status: '1H',
      model: 'gemini-2.5-flash',
      mode: 'B',
      selection: 'Under 1.75 Goals',
      betMarket: 'ht_under_1.75',
      odds: 2.05,
      confidence: 6,
      stakePercent: 3,
      riskLevel: 'MEDIUM',
      valuePercent: 11,
      reasoningEn: 'Slow match with very little attacking pressure.',
      reasoningVi: 'Tran dau dien ra cham.',
      language: 'en',
      timestampLabel: '12:00 PM',
    });

    expect(message).toContain('RECOMMENDATION');
    expect(message).not.toContain('gemini-2.5-flash');
    expect(message).toContain('H1 Goals O/U · Under 1.75 Goals @2.05');
    expect(message).toContain('Minute 32\'');
    expect(message).toContain('Score 0-0');
    expect(message).toContain('Confidence: 6/10');
    expect(message).toContain('Stake: 3%');
    expect(message).toContain('Risk: MEDIUM');
    expect(message).toContain('Value: 11%');
    expect(message).toContain('Slow match with very little attacking pressure.');
    expect(message).not.toContain('Tran dau dien ra cham.');
  });

  test('renders condition content in Vietnamese when notification language is vi', () => {
    const message = buildTelegramRecommendationMessage({
      kind: 'condition',
      matchDisplay: 'Alianza Valledupar vs Deportivo Pasto',
      league: 'Primera A',
      minute: 59,
      score: '0-0',
      status: '2H',
      model: 'gemini-2.5-flash',
      mode: 'B',
      selection: 'Under 0.75 Goals',
      betMarket: 'asian_handicap_home_-0.25',
      odds: 1.9,
      confidence: 5,
      stakePercent: 2,
      conditionText: '(minute >= 50 AND score_total = 0)',
      conditionSummaryEn: 'Condition matched',
      conditionSummaryVi: 'Dieu kien da dat',
      reasoningEn: 'The match is still tight.',
      reasoningVi: 'Tran dau van rat chat che.',
      language: 'vi',
      timestampLabel: '12:00 PM',
    });

    expect(message).toContain('ĐIỀU KIỆN ĐÃ THỎA');
    expect(message).toContain('Phút 59\'');
    expect(message).toContain('Tỷ số 0-0');
    expect(message).toContain('Điều kiện:');
    expect(message).toContain('Điều kiện đạt: Dieu kien da dat');
    expect(message).toContain('Độ tin cậy: 5/10');
    expect(message).toContain('Tỷ trọng: 2%');
    expect(message).toContain('Tran dau van rat chat che.');
    expect(message).not.toContain('The match is still tight.');
  });

  test('renders bilingual reasoning and labels when notification language is both', () => {
    const message = buildTelegramRecommendationMessage({
      kind: 'condition',
      matchDisplay: 'Team A vs Team B',
      minute: 70,
      score: '0-0',
      status: '2H',
      selection: 'No bet',
      conditionText: '(minute >= 70)',
      conditionSummaryEn: 'Condition matched',
      conditionSummaryVi: 'Dieu kien da dat',
      reasoningEn: 'No fresh edge remains.',
      reasoningVi: 'Khong con loi the moi.',
      language: 'both',
      timestampLabel: '12:00 PM',
    });

    expect(message).toContain('CONDITION TRIGGERED / ĐIỀU KIỆN ĐÃ THỎA');
    expect(message).toContain('Minute / Phút 70\'');
    expect(message).toContain('Score / Tỷ số 0-0');
    expect(message).toContain('Condition / Điều kiện:');
    expect(message).toContain('Matched / Điều kiện đạt: Condition matched');
    expect(message).toContain('Dieu kien da dat');
    expect(message).toContain('No fresh edge remains.');
    expect(message).toContain('Khong con loi the moi.');
  });

  test('labels full-time European 1X2 explicitly in Vietnamese', () => {
    const message = buildTelegramRecommendationMessage({
      kind: 'recommendation',
      matchDisplay: 'Team A vs Team B',
      minute: 71,
      score: '1-0',
      status: '2H',
      selection: 'Home Win',
      betMarket: '1x2_home',
      odds: 1.82,
      confidence: 7,
      stakePercent: 3,
      reasoningVi: 'Chu nha kiem soat tran dau tot hon.',
      language: 'vi',
    });

    expect(message).toContain('Kèo Châu Âu 1X2 FT · Home Win @1.82');
  });
});
