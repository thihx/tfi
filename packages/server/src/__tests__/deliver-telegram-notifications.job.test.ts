import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockReportJobProgress = vi.fn();
const mockGetPendingTelegramDeliveries = vi.fn();
const mockMarkDeliveryRowsDelivered = vi.fn();
const mockMarkRecommendationDeliveriesDelivered = vi.fn();
const mockMarkRecommendationNotified = vi.fn();
const mockSendTelegramMessage = vi.fn();

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: mockReportJobProgress,
}));

vi.mock('../repos/recommendation-deliveries.repo.js', () => ({
  getPendingTelegramDeliveries: mockGetPendingTelegramDeliveries,
  markDeliveryRowsDelivered: mockMarkDeliveryRowsDelivered,
  markRecommendationDeliveriesDelivered: mockMarkRecommendationDeliveriesDelivered,
}));

vi.mock('../repos/recommendations.repo.js', () => ({
  markRecommendationNotified: mockMarkRecommendationNotified,
}));

vi.mock('../lib/telegram.js', () => ({
  sendTelegramMessage: mockSendTelegramMessage,
}));

vi.mock('../lib/time.js', () => ({
  formatOperationalTimestamp: vi.fn(() => '12:00 PM'),
}));

vi.mock('../config.js', () => ({
  config: {
    telegramBotToken: 'bot-token',
  },
}));

const { deliverTelegramNotificationsJob } = await import('../jobs/deliver-telegram-notifications.job.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPendingTelegramDeliveries.mockResolvedValue([]);
  mockMarkDeliveryRowsDelivered.mockResolvedValue(1);
  mockMarkRecommendationDeliveriesDelivered.mockResolvedValue(1);
  mockMarkRecommendationNotified.mockResolvedValue({ id: 1 });
  mockSendTelegramMessage.mockResolvedValue(undefined);
});

describe('deliverTelegramNotificationsJob', () => {
  test('returns early when there is nothing pending', async () => {
    const result = await deliverTelegramNotificationsJob();

    expect(result).toEqual({ pending: 0, delivered: 0, failed: 0 });
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });

  test('delivers saved recommendation rows and marks them delivered', async () => {
    mockGetPendingTelegramDeliveries.mockResolvedValue([
      {
        deliveryId: 11,
        userId: 'user-1',
        chatId: 'chat-1',
        notificationLanguage: 'en',
        recommendationId: 42,
        matchId: '100',
        metadata: {},
        createdAt: '2026-04-02T10:00:00.000Z',
        recommendationTimestamp: '2026-04-02T10:00:00.000Z',
        recommendationMinute: 32,
        recommendationScore: '0-0',
        recommendationBetType: 'AI',
        recommendationSelection: 'Under 1.75 Goals @2.05',
        recommendationBetMarket: 'under_1.75',
        recommendationOdds: 2.05,
        recommendationConfidence: 6,
        recommendationValuePercent: 11,
        recommendationRiskLevel: 'MEDIUM',
        recommendationStakePercent: 3,
        recommendationReasoning: 'Slow match.',
        recommendationReasoningVi: 'Tran dau dien ra cham.',
        recommendationWarnings: '',
        recommendationHomeTeam: 'Brisbane Roar',
        recommendationAwayTeam: 'Sydney',
        recommendationLeague: 'A-League',
        recommendationStatus: '1H',
        recommendationAiModel: 'gemini-3-pro-preview',
        recommendationMode: 'B',
      },
    ]);

    const result = await deliverTelegramNotificationsJob();

    expect(result).toEqual({ pending: 1, delivered: 1, failed: 0 });
    expect(mockSendTelegramMessage).toHaveBeenCalledOnce();
    expect(mockSendTelegramMessage.mock.calls[0]?.[1]).toContain('AI RECOMMENDATION');
    expect(mockMarkRecommendationDeliveriesDelivered).toHaveBeenCalledWith(42, ['user-1'], 'telegram');
    expect(mockMarkRecommendationNotified).toHaveBeenCalledWith(42, 'telegram');
  });

  test('delivers condition-only rows and includes condition details', async () => {
    mockGetPendingTelegramDeliveries.mockResolvedValue([
      {
        deliveryId: 99,
        userId: 'user-1',
        chatId: 'chat-1',
        notificationLanguage: 'vi',
        recommendationId: null,
        matchId: '200',
        metadata: {
          delivery_kind: 'condition_only',
          custom_condition_text: '(minute >= 50 AND score_total = 0)',
          condition_evaluation_summary: 'Dieu kien da dat',
          recommendation_reasoning_vi: 'Tran dau van rat chat che.',
          recommendation_ai_model: 'gemini-3-pro-preview',
          recommendation_mode: 'B',
        },
        createdAt: '2026-04-02T10:00:00.000Z',
        recommendationTimestamp: '2026-04-02T10:00:00.000Z',
        recommendationMinute: 59,
        recommendationScore: '0-0',
        recommendationBetType: 'CONDITION_ONLY',
        recommendationSelection: 'Under 0.75 Goals @1.90',
        recommendationBetMarket: 'under_0.75',
        recommendationOdds: 1.9,
        recommendationConfidence: 5,
        recommendationValuePercent: null,
        recommendationRiskLevel: 'MEDIUM',
        recommendationStakePercent: 2,
        recommendationReasoning: '',
        recommendationReasoningVi: 'Tran dau van rat chat che.',
        recommendationWarnings: '',
        recommendationHomeTeam: 'Alianza Valledupar',
        recommendationAwayTeam: 'Deportivo Pasto',
        recommendationLeague: 'Primera A',
        recommendationStatus: '2H',
        recommendationAiModel: null,
        recommendationMode: null,
      },
    ]);

    const result = await deliverTelegramNotificationsJob();

    expect(result).toEqual({ pending: 1, delivered: 1, failed: 0 });
    expect(mockSendTelegramMessage.mock.calls[0]?.[1]).toContain('ĐIỀU KIỆN ĐÃ THỎA');
    expect(mockSendTelegramMessage.mock.calls[0]?.[1]).toContain('Điều kiện:');
    expect(mockSendTelegramMessage.mock.calls[0]?.[1]).toContain('Điều kiện đạt:');
    expect(mockMarkDeliveryRowsDelivered).toHaveBeenCalledWith([99], 'telegram');
    expect(mockMarkRecommendationNotified).not.toHaveBeenCalled();
  });

  test('chunks long messages instead of sending one oversized Telegram payload', async () => {
    mockGetPendingTelegramDeliveries.mockResolvedValue([
      {
        deliveryId: 77,
        userId: 'user-1',
        chatId: 'chat-1',
        notificationLanguage: 'both',
        recommendationId: null,
        matchId: '300',
        metadata: {
          delivery_kind: 'condition_only',
          custom_condition_text: '(minute >= 70)',
        },
        createdAt: '2026-04-02T10:00:00.000Z',
        recommendationTimestamp: '2026-04-02T10:00:00.000Z',
        recommendationMinute: 70,
        recommendationScore: '0-0',
        recommendationBetType: 'CONDITION_ONLY',
        recommendationSelection: 'No bet',
        recommendationBetMarket: '',
        recommendationOdds: null,
        recommendationConfidence: 0,
        recommendationValuePercent: null,
        recommendationRiskLevel: '',
        recommendationStakePercent: 0,
        recommendationReasoning: '',
        recommendationReasoningVi: 'A'.repeat(5000),
        recommendationWarnings: '',
        recommendationHomeTeam: 'Team A',
        recommendationAwayTeam: 'Team B',
        recommendationLeague: 'League',
        recommendationStatus: '2H',
        recommendationAiModel: null,
        recommendationMode: null,
      },
    ]);

    await deliverTelegramNotificationsJob();

    expect(mockSendTelegramMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
