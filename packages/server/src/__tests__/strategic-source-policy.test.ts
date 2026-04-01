import { describe, expect, test } from 'vitest';

import { classifyStrategicSourceDomain } from '../config/strategic-source-policy.js';

describe('strategic source policy', () => {
  test('treats common country-specific stats-reference brand domains as trusted stats sources', () => {
    expect(classifyStrategicSourceDomain('flashscoreusa.com')).toEqual({
      trustTier: 'tier_2',
      sourceType: 'stats_reference',
    });
    expect(classifyStrategicSourceDomain('ng.soccerway.com')).toEqual({
      trustTier: 'tier_2',
      sourceType: 'stats_reference',
    });
    expect(classifyStrategicSourceDomain('id.sofascore.com')).toEqual({
      trustTier: 'tier_2',
      sourceType: 'stats_reference',
    });
  });
});
