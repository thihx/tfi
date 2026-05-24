import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    thesisWatchEnabled: true,
    linePatienceEnabled: true,
  },
}));

vi.mock('../config.js', () => ({
  config: mockConfig,
}));

import { isThesisWatchPipelineActive } from '../lib/thesis-watch.service.js';

describe('isThesisWatchPipelineActive', () => {
  beforeEach(() => {
    mockConfig.thesisWatchEnabled = true;
    mockConfig.linePatienceEnabled = true;
  });

  it('is inactive in shadow mode', () => {
    expect(isThesisWatchPipelineActive({ shadowMode: true })).toBe(false);
  });

  it('is inactive in advisory-only mode', () => {
    expect(isThesisWatchPipelineActive({ advisoryOnly: true })).toBe(false);
  });

  it('is active for normal live pipeline when enabled', () => {
    expect(isThesisWatchPipelineActive({ shadowMode: false, advisoryOnly: false })).toBe(true);
  });

  it('is inactive when thesis watch env disabled', () => {
    mockConfig.thesisWatchEnabled = false;
    expect(isThesisWatchPipelineActive({})).toBe(false);
  });
});
