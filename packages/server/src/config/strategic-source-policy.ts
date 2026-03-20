import 'dotenv/config';
import basePolicy from './strategic-source-policy.base.json';

export type StrategicSearchQuality = 'high' | 'medium' | 'low' | 'unknown';
export type StrategicSourceTrustTier = 'tier_1' | 'tier_2' | 'tier_3' | 'rejected';
export type StrategicSourceType =
  | 'official'
  | 'major_news'
  | 'stats_reference'
  | 'aggregator'
  | 'unknown'
  | 'rejected';

export interface StrategicSourceClassification {
  trustTier: StrategicSourceTrustTier;
  sourceType: StrategicSourceType;
}

export interface StrategicSourcePolicy {
  officialDomains: string[];
  majorNewsDomains: string[];
  statsReferenceDomains: string[];
  rejectedDomainPatterns: string[];
  aggregatorPatterns: string[];
}

export const STRATEGIC_SOURCE_POLICY_ENV_KEYS = {
  officialDomains: 'STRATEGIC_OFFICIAL_DOMAINS',
  majorNewsDomains: 'STRATEGIC_MAJOR_NEWS_DOMAINS',
  statsReferenceDomains: 'STRATEGIC_STATS_REFERENCE_DOMAINS',
  rejectedDomainPatterns: 'STRATEGIC_REJECTED_DOMAIN_PATTERNS',
  aggregatorPatterns: 'STRATEGIC_AGGREGATOR_PATTERNS',
} as const;

function parseCsvEnv(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function mergeUnique(base: string[], extra: string[]): string[] {
  return Array.from(new Set([...base, ...extra].map((item) => item.trim().toLowerCase()).filter(Boolean)));
}

function matchesDomain(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

export const strategicSourcePolicy: StrategicSourcePolicy = {
  officialDomains: mergeUnique(basePolicy.officialDomains, parseCsvEnv(process.env[STRATEGIC_SOURCE_POLICY_ENV_KEYS.officialDomains])),
  majorNewsDomains: mergeUnique(basePolicy.majorNewsDomains, parseCsvEnv(process.env[STRATEGIC_SOURCE_POLICY_ENV_KEYS.majorNewsDomains])),
  statsReferenceDomains: mergeUnique(basePolicy.statsReferenceDomains, parseCsvEnv(process.env[STRATEGIC_SOURCE_POLICY_ENV_KEYS.statsReferenceDomains])),
  rejectedDomainPatterns: mergeUnique(basePolicy.rejectedDomainPatterns, parseCsvEnv(process.env[STRATEGIC_SOURCE_POLICY_ENV_KEYS.rejectedDomainPatterns])),
  aggregatorPatterns: mergeUnique(basePolicy.aggregatorPatterns, parseCsvEnv(process.env[STRATEGIC_SOURCE_POLICY_ENV_KEYS.aggregatorPatterns])),
};

export function classifyStrategicSourceDomain(domain: string): StrategicSourceClassification {
  const normalizedDomain = domain.trim().toLowerCase();
  if (!normalizedDomain) return { trustTier: 'rejected', sourceType: 'rejected' };

  if (strategicSourcePolicy.rejectedDomainPatterns.some((pattern) => normalizedDomain.includes(pattern))) {
    return { trustTier: 'rejected', sourceType: 'rejected' };
  }
  if (strategicSourcePolicy.officialDomains.some((candidate) => matchesDomain(normalizedDomain, candidate))) {
    return { trustTier: 'tier_1', sourceType: 'official' };
  }
  if (strategicSourcePolicy.majorNewsDomains.some((candidate) => matchesDomain(normalizedDomain, candidate))) {
    return { trustTier: 'tier_1', sourceType: 'major_news' };
  }
  if (strategicSourcePolicy.statsReferenceDomains.some((candidate) => matchesDomain(normalizedDomain, candidate))) {
    return { trustTier: 'tier_2', sourceType: 'stats_reference' };
  }
  if (strategicSourcePolicy.aggregatorPatterns.some((pattern) => normalizedDomain.includes(pattern))) {
    return { trustTier: 'tier_3', sourceType: 'aggregator' };
  }
  return { trustTier: 'tier_3', sourceType: 'unknown' };
}

export function getStrategicSourcePolicyAuditSnapshot(): StrategicSourcePolicy & {
  envKeys: typeof STRATEGIC_SOURCE_POLICY_ENV_KEYS;
} {
  return {
    officialDomains: [...strategicSourcePolicy.officialDomains].sort(),
    majorNewsDomains: [...strategicSourcePolicy.majorNewsDomains].sort(),
    statsReferenceDomains: [...strategicSourcePolicy.statsReferenceDomains].sort(),
    rejectedDomainPatterns: [...strategicSourcePolicy.rejectedDomainPatterns].sort(),
    aggregatorPatterns: [...strategicSourcePolicy.aggregatorPatterns].sort(),
    envKeys: STRATEGIC_SOURCE_POLICY_ENV_KEYS,
  };
}
