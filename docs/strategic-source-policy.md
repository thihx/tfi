# Strategic Source Policy

This policy controls how `strategic-context` classifies Google Search sources for trust filtering.

Server files:
- `packages/server/src/config/strategic-source-policy.base.json`
- `packages/server/src/config/strategic-source-policy.ts`
- `packages/server/src/lib/strategic-context.service.ts`

## Policy Buckets

- `officialDomains`
  Used for federations, leagues, clubs, and official competition sites.
- `majorNewsDomains`
  Used for tier-1 sports/news outlets.
- `statsReferenceDomains`
  Used for reputable football stats/reference sites.
- `rejectedDomainPatterns`
  Used to hard-reject weak sources such as betting tips, forums, and social/social-like domains.
- `aggregatorPatterns`
  Used for low-trust but non-rejected aggregators.

## Runtime Override

All lists can be extended without code changes via server env vars:

- `STRATEGIC_OFFICIAL_DOMAINS`
- `STRATEGIC_MAJOR_NEWS_DOMAINS`
- `STRATEGIC_STATS_REFERENCE_DOMAINS`
- `STRATEGIC_REJECTED_DOMAIN_PATTERNS`
- `STRATEGIC_AGGREGATOR_PATTERNS`

Format: comma-separated, lowercase preferred.

Example:

```env
STRATEGIC_OFFICIAL_DOMAINS=arsenal.com,chelseafc.com,afc.co.kr
STRATEGIC_STATS_REFERENCE_DOMAINS=understat.com
STRATEGIC_REJECTED_DOMAIN_PATTERNS=rumour,gossip
```

## Audit Guidance

When trust filtering looks wrong, review in this order:

1. `strategic-source-policy.base.json`
2. server env overrides
3. `strategic-source-policy.test.ts`
4. `strategic-context.service` replay report

This keeps domain-list changes auditable without touching prompt logic.
