import { describe, expect, test } from 'vitest';
import {
  buildExpectedDeliveryChannels,
  normalizeChannelArray,
  normalizeChannelCsv,
  summarizeDeliveryRuntimeVerification,
} from '../lib/delivery-runtime-verifier.js';

describe('delivery runtime verifier helpers', () => {
  test('normalizes channel values defensively', () => {
    expect(normalizeChannelCsv('telegram,web_push,invalid,telegram')).toEqual(['telegram', 'web_push']);
    expect(normalizeChannelArray(['web_push', 'telegram', 'other', 'telegram'])).toEqual(['web_push', 'telegram']);
  });

  test('builds expected channels from readiness', () => {
    expect(buildExpectedDeliveryChannels({ telegram: true, webPush: false })).toEqual(['telegram']);
    expect(buildExpectedDeliveryChannels({ telegram: true, webPush: true })).toEqual(['telegram', 'web_push']);
  });

  test('summarizes independent channel state for a recommendation', () => {
    const summary = summarizeDeliveryRuntimeVerification({
      readiness: { telegram: true, webPush: true },
      rows: [
        { channelType: 'telegram', channelStatus: 'pending' },
        { channelType: 'web_push', channelStatus: 'delivered' },
      ],
      snapshot: {
        notificationChannels: 'web_push',
        deliveryChannels: ['web_push'],
      },
    });

    expect(summary.expectedChannels).toEqual(['telegram', 'web_push']);
    expect(summary.observedChannels).toEqual(['telegram', 'web_push']);
    expect(summary.deliveredChannels).toEqual(['web_push']);
    expect(summary.pendingChannels).toEqual(['telegram']);
    expect(summary.missingChannels).toEqual([]);
    expect(summary.hasExpectedChannelRows).toBe(true);
    expect(summary.fullyDelivered).toBe(false);
  });

  test('flags missing expected channels', () => {
    const summary = summarizeDeliveryRuntimeVerification({
      readiness: { telegram: true, webPush: true },
      rows: [{ channelType: 'web_push', channelStatus: 'delivered' }],
      snapshot: {
        notificationChannels: 'web_push',
        deliveryChannels: ['web_push'],
      },
    });

    expect(summary.missingChannels).toEqual(['telegram']);
    expect(summary.hasExpectedChannelRows).toBe(false);
  });
});
