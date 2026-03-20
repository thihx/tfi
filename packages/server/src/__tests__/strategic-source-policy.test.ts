import { afterEach, describe, expect, test, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }

  delete process.env['STRATEGIC_OFFICIAL_DOMAINS'];
  delete process.env['STRATEGIC_MAJOR_NEWS_DOMAINS'];
  delete process.env['STRATEGIC_STATS_REFERENCE_DOMAINS'];
  delete process.env['STRATEGIC_REJECTED_DOMAIN_PATTERNS'];
  delete process.env['STRATEGIC_AGGREGATOR_PATTERNS'];
  vi.resetModules();
});

describe('strategic-source-policy', () => {
  test('loads auditable base policy and merges env extensions', async () => {
    process.env['STRATEGIC_OFFICIAL_DOMAINS'] = 'arsenal.com, chelseafc.com';
    process.env['STRATEGIC_MAJOR_NEWS_DOMAINS'] = 'nytimes.com';
    process.env['STRATEGIC_STATS_REFERENCE_DOMAINS'] = 'understat.com';
    process.env['STRATEGIC_REJECTED_DOMAIN_PATTERNS'] = 'rumour, gossip';
    process.env['STRATEGIC_AGGREGATOR_PATTERNS'] = 'fixture,results';

    const {
      STRATEGIC_SOURCE_POLICY_ENV_KEYS,
      getStrategicSourcePolicyAuditSnapshot,
    } = await import('../config/strategic-source-policy.js');

    const snapshot = getStrategicSourcePolicyAuditSnapshot();

    expect(snapshot.officialDomains).toContain('arsenal.com');
    expect(snapshot.officialDomains).toContain('chelseafc.com');
    expect(snapshot.majorNewsDomains).toContain('nytimes.com');
    expect(snapshot.statsReferenceDomains).toContain('understat.com');
    expect(snapshot.rejectedDomainPatterns).toContain('rumour');
    expect(snapshot.aggregatorPatterns).toContain('fixture');
    expect(snapshot.envKeys).toEqual(STRATEGIC_SOURCE_POLICY_ENV_KEYS);
  });

  test('classifies domains from centralized trust policy buckets', async () => {
    const { classifyStrategicSourceDomain } = await import('../config/strategic-source-policy.js');

    expect(classifyStrategicSourceDomain('www.premierleague.com')).toEqual({
      trustTier: 'tier_1',
      sourceType: 'official',
    });
    expect(classifyStrategicSourceDomain('news.skysports.com')).toEqual({
      trustTier: 'tier_1',
      sourceType: 'major_news',
    });
    expect(classifyStrategicSourceDomain('www.fbref.com')).toEqual({
      trustTier: 'tier_2',
      sourceType: 'stats_reference',
    });
    expect(classifyStrategicSourceDomain('best-betting-tips.example.com')).toEqual({
      trustTier: 'rejected',
      sourceType: 'rejected',
    });
    expect(classifyStrategicSourceDomain('matchscore.example.com')).toEqual({
      trustTier: 'tier_3',
      sourceType: 'aggregator',
    });
    expect(classifyStrategicSourceDomain('club-press.example.com')).toEqual({
      trustTier: 'tier_3',
      sourceType: 'unknown',
    });
  });
});
