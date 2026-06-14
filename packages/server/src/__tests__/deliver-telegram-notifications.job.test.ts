import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockReportJobProgress = vi.fn();
const mockGetPendingCriticalFallbackDeliveries = vi.fn();
const mockGetPendingTelegramDeliveries = vi.fn();
const mockMarkDeliveryRowsFailed = vi.fn();
const mockMarkDeliveryRowsDelivered = vi.fn();
const mockMarkDeliveryRowsSuppressed = vi.fn();
const mockMarkRecommendationDeliveriesDelivered = vi.fn();
const mockMarkRecommendationNotified = vi.fn();
const mockSendTelegramMessage = vi.fn();
const mockGetNativePushDevicesByUserId = vi.fn();
const mockDeleteNativePushDeviceByToken = vi.fn();
const mockSendFcmNotification = vi.fn();
const mockSendSmsNotification = vi.fn();
const mockSendVoiceNotification = vi.fn();
const mockEvaluateCriticalFallbackPolicy = vi.fn();

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: mockReportJobProgress,
}));

vi.mock('../repos/recommendation-deliveries.repo.js', () => ({
  getPendingCriticalFallbackDeliveries: mockGetPendingCriticalFallbackDeliveries,
  getPendingTelegramDeliveries: mockGetPendingTelegramDeliveries,
  markDeliveryRowsFailed: mockMarkDeliveryRowsFailed,
  markDeliveryRowsDelivered: mockMarkDeliveryRowsDelivered,
  markDeliveryRowsSuppressed: mockMarkDeliveryRowsSuppressed,
  markRecommendationDeliveriesDelivered: mockMarkRecommendationDeliveriesDelivered,
}));

vi.mock('../repos/recommendations.repo.js', () => ({
  markRecommendationNotified: mockMarkRecommendationNotified,
}));

vi.mock('../lib/telegram.js', () => ({
  sendTelegramMessage: mockSendTelegramMessage,
}));

vi.mock('../repos/native-push-devices.repo.js', () => ({
  getNativePushDevicesByUserId: mockGetNativePushDevicesByUserId,
  deleteNativePushDeviceByToken: mockDeleteNativePushDeviceByToken,
}));

vi.mock('../lib/native-push.js', () => ({
  sendFcmNotification: mockSendFcmNotification,
}));

vi.mock('../lib/twilio.js', () => ({
  sendSmsNotification: mockSendSmsNotification,
  sendVoiceNotification: mockSendVoiceNotification,
}));

vi.mock('../lib/critical-fallback-policy.js', () => ({
  evaluateCriticalFallbackPolicy: mockEvaluateCriticalFallbackPolicy,
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
  mockGetPendingCriticalFallbackDeliveries.mockResolvedValue([]);
  mockMarkDeliveryRowsFailed.mockResolvedValue(1);
  mockMarkDeliveryRowsDelivered.mockResolvedValue(1);
  mockMarkDeliveryRowsSuppressed.mockResolvedValue(1);
  mockMarkRecommendationDeliveriesDelivered.mockResolvedValue(1);
  mockMarkRecommendationNotified.mockResolvedValue({ id: 1 });
  mockSendTelegramMessage.mockResolvedValue(undefined);
  mockGetNativePushDevicesByUserId.mockResolvedValue([]);
  mockDeleteNativePushDeviceByToken.mockResolvedValue(undefined);
  mockSendFcmNotification.mockResolvedValue({ ok: true });
  mockSendSmsNotification.mockResolvedValue({ ok: true });
  mockSendVoiceNotification.mockResolvedValue({ ok: true });
  mockEvaluateCriticalFallbackPolicy.mockResolvedValue({ allowed: true });
});

describe('deliverTelegramNotificationsJob', () => {
  test('returns early when there is nothing pending', async () => {
    const result = await deliverTelegramNotificationsJob();

    expect(result).toMatchObject({ pending: 0, delivered: 0, failed: 0 });
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
        recommendationAiModel: 'gemini-3.5-flash',
        recommendationMode: 'B',
      },
    ]);

    const result = await deliverTelegramNotificationsJob();

    expect(result).toMatchObject({ pending: 1, delivered: 1, failed: 0 });
    expect(mockSendTelegramMessage).toHaveBeenCalledOnce();
    expect(mockSendTelegramMessage.mock.calls[0]?.[1]).toContain('RECOMMENDATION');
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
          recommendation_ai_model: 'gemini-3.5-flash',
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

    expect(result).toMatchObject({ pending: 1, delivered: 1, failed: 0 });
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

  test('records a Telegram delivery failure when sending throws', async () => {
    mockGetPendingTelegramDeliveries.mockResolvedValue([
      {
        deliveryId: 88,
        userId: 'user-1',
        chatId: 'chat-1',
        notificationLanguage: 'en',
        recommendationId: null,
        matchId: '400',
        metadata: { delivery_kind: 'condition_only' },
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
        recommendationReasoningVi: '',
        recommendationWarnings: '',
        recommendationHomeTeam: 'Team A',
        recommendationAwayTeam: 'Team B',
        recommendationLeague: 'League',
        recommendationStatus: '2H',
        recommendationAiModel: null,
        recommendationMode: null,
      },
    ]);
    mockSendTelegramMessage.mockRejectedValueOnce(new Error('Telegram API down'));

    const result = await deliverTelegramNotificationsJob();

    expect(result).toMatchObject({ pending: 1, delivered: 0, failed: 1 });
    expect(mockMarkDeliveryRowsFailed).toHaveBeenCalledWith([88], 'telegram', 'Telegram API down');
  });

  test('delivers recommendation rows through native push fallback', async () => {
    mockGetPendingCriticalFallbackDeliveries.mockImplementation(async (channel: string) => (
      channel === 'native_push'
        ? [{
            deliveryId: 501,
            userId: 'user-1',
            address: null,
            channelType: 'native_push',
            recommendationId: 42,
            matchId: '100',
            metadata: {},
            createdAt: '2026-04-02T10:00:00.000Z',
            recommendationMinute: 32,
            recommendationScore: '0-0',
            recommendationSelection: 'Under 1.75 Goals @2.05',
            recommendationOdds: 2.05,
            recommendationConfidence: 6,
            recommendationHomeTeam: 'Brisbane Roar',
            recommendationAwayTeam: 'Sydney',
          }]
        : []
    ));
    mockGetNativePushDevicesByUserId.mockResolvedValue([
      { provider: 'fcm', token: 'fcm-token' },
    ]);

    const result = await deliverTelegramNotificationsJob();

    expect(result.nativePushDelivered).toBe(1);
    expect(mockSendFcmNotification).toHaveBeenCalledWith('fcm-token', expect.objectContaining({
      title: 'TFI CRITICAL ALERT',
      data: expect.objectContaining({
        channelType: 'native_push',
        recommendationId: 42,
      }),
    }));
    expect(mockMarkDeliveryRowsDelivered).toHaveBeenCalledWith([501], 'native_push');
    expect(mockMarkRecommendationNotified).toHaveBeenCalledWith(42, 'native_push');
  });

  test('suppresses SMS fallback when critical fallback policy blocks it', async () => {
    mockGetPendingCriticalFallbackDeliveries.mockImplementation(async (channel: string) => (
      channel === 'sms'
        ? [{
            deliveryId: 601,
            userId: 'user-1',
            address: '+15551234567',
            channelType: 'sms',
            recommendationId: 42,
            matchId: '100',
            metadata: {},
            createdAt: '2026-04-02T10:00:00.000Z',
            recommendationMinute: 32,
            recommendationScore: '0-0',
            recommendationSelection: 'Under 1.75 Goals @2.05',
            recommendationOdds: 2.05,
            recommendationConfidence: 8,
            recommendationHomeTeam: 'Brisbane Roar',
            recommendationAwayTeam: 'Sydney',
          }]
        : []
    ));
    mockEvaluateCriticalFallbackPolicy.mockResolvedValueOnce({
      allowed: false,
      reason: 'sms global daily cost guard is not configured',
    });

    const result = await deliverTelegramNotificationsJob();

    expect(result.smsFailed).toBe(1);
    expect(mockSendSmsNotification).not.toHaveBeenCalled();
    expect(mockMarkDeliveryRowsSuppressed).toHaveBeenCalledWith(
      [601],
      'sms',
      'sms global daily cost guard is not configured',
    );
  });
});
