import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    geminiApiKey: 'test-key',
    geminiModel: 'gemini-3.0-flash',
    geminiTimeoutMs: 5000,
  },
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gemini model normalization', () => {
  test('maps legacy gemini-3.0-flash to a supported generateContent model', async () => {
    const { generateGeminiContent } = await import('../lib/gemini.js');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ candidates: [] }),
    });

    await generateGeminiContent('hello', { model: 'gemini-3.0-flash' });

    const requestUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
    expect(requestUrl).toContain('/models/gemini-3-flash-preview:generateContent');
  });
});
