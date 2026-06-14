export type StrategicContextAuditRootCause =
  | 'usable_grounded_context'
  | 'grounded_but_claim_traceability_missing'
  | 'grounded_sparse_quantitative'
  | 'provider_fallback_after_gateway_blocked'
  | 'provider_fallback_after_grounding_sparse'
  | 'provider_fallback_provider_only_supported'
  | 'missing_context'
  | 'unknown';

export type StrategicContextDecisionUsefulness =
  | 'none'
  | 'fixture_only'
  | 'weak_transparency_only'
  | 'useful_but_unverified'
  | 'decision_relevant';

export interface StrategicContextAuditSourceInput {
  domain?: string | null;
  url?: string | null;
  trust_tier?: string | null;
  source_type?: string | null;
}

export interface StrategicContextAuditInput {
  refreshStatus?: string | null;
  searchQuality?: string | null;
  sourceMode?: string | null;
  trustedSourceCount?: number | null;
  sourceCount?: number | null;
  queryCount?: number | null;
  quantitativeCount?: number | null;
  lastError?: string | null;
  summary?: string | null;
  sources?: StrategicContextAuditSourceInput[] | null;
  gateway?: {
    groundedStartedCount?: number | null;
    groundedSucceededCount?: number | null;
    groundedBlockedCount?: number | null;
    structuredSucceededCount?: number | null;
    repairSucceededCount?: number | null;
    latestReason?: string | null;
  } | null;
}

export interface StrategicContextAuditDiagnostics {
  rootCause: StrategicContextAuditRootCause;
  decisionUsefulness: StrategicContextDecisionUsefulness;
  hasProviderFallback: boolean;
  hasConcreteSourceUrls: boolean;
  concreteSourceUrlCount: number;
  genericSourceUrlCount: number;
  claimTraceability: 'missing' | 'domain_only' | 'source_url_only' | 'unknown';
  quantitativeIntegrity: 'none' | 'values_without_attribution' | 'sparse_without_attribution' | 'unknown';
  gatewayCorrelation: {
    groundedStartedCount: number;
    groundedSucceededCount: number;
    groundedBlockedCount: number;
    structuredSucceededCount: number;
    repairSucceededCount: number;
    latestReason: string;
  };
  reasonCodes: string[];
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function lower(value: unknown): string {
  return clean(value).toLowerCase();
}

function countFinite(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function isGenericDomainUrl(source: StrategicContextAuditSourceInput): boolean {
  const domain = lower(source.domain).replace(/^www\./, '');
  const url = lower(source.url).replace(/\/+$/, '');
  if (!domain || !url) return false;
  return url === `https://${domain}` || url === `http://${domain}` || url === `https://www.${domain}` || url === `http://www.${domain}`;
}

function isConcreteSourceUrl(source: StrategicContextAuditSourceInput): boolean {
  const url = clean(source.url);
  if (!url) return false;
  if (isGenericDomainUrl(source)) return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/+$/, '').length > 0 || parsed.search.length > 0;
  } catch {
    return false;
  }
}

function looksGatewayBlocked(lastError: string, summary: string): boolean {
  const text = `${lastError} ${summary}`.toLowerCase();
  return text.includes('gateway') || text.includes('breaker') || text.includes('blocked') || text.includes('loop_detected');
}

export function diagnoseStrategicContextQuality(input: StrategicContextAuditInput): StrategicContextAuditDiagnostics {
  const refreshStatus = lower(input.refreshStatus);
  const searchQuality = lower(input.searchQuality);
  const sourceMode = lower(input.sourceMode);
  const lastError = clean(input.lastError);
  const summary = clean(input.summary);
  const trustedSourceCount = countFinite(input.trustedSourceCount);
  const sourceCount = countFinite(input.sourceCount);
  const queryCount = countFinite(input.queryCount);
  const quantitativeCount = countFinite(input.quantitativeCount);
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const gateway = input.gateway ?? {};
  const gatewayCorrelation = {
    groundedStartedCount: countFinite(gateway.groundedStartedCount),
    groundedSucceededCount: countFinite(gateway.groundedSucceededCount),
    groundedBlockedCount: countFinite(gateway.groundedBlockedCount),
    structuredSucceededCount: countFinite(gateway.structuredSucceededCount),
    repairSucceededCount: countFinite(gateway.repairSucceededCount),
    latestReason: clean(gateway.latestReason),
  };
  const hasProviderFallback = sourceMode === 'provider_fallback';
  const concreteSourceUrlCount = sources.filter(isConcreteSourceUrl).length;
  const genericSourceUrlCount = sources.filter(isGenericDomainUrl).length;
  const hasConcreteSourceUrls = concreteSourceUrlCount > 0;
  const reasonCodes: string[] = [];

  if (refreshStatus === 'missing' || searchQuality === 'missing') reasonCodes.push('context_missing_or_legacy');
  if (hasProviderFallback) reasonCodes.push('provider_fallback');
  if (searchQuality === 'low' || searchQuality === 'unknown') reasonCodes.push(`source_quality_${searchQuality}`);
  if (trustedSourceCount < 2) reasonCodes.push('trusted_sources_lt_2');
  if (quantitativeCount === 0) reasonCodes.push('quantitative_empty');
  if (quantitativeCount > 0 && quantitativeCount < 4) reasonCodes.push('quantitative_sparse');
  if (sourceCount === 0) reasonCodes.push('sources_empty');
  if (queryCount === 0) reasonCodes.push('queries_empty');
  if (genericSourceUrlCount > 0) reasonCodes.push('generic_domain_urls');
  if (sourceCount > 0 && !hasConcreteSourceUrls) reasonCodes.push('no_concrete_source_urls');
  if (quantitativeCount > 0 && !hasConcreteSourceUrls) reasonCodes.push('numeric_values_without_source_url');
  if (gatewayCorrelation.groundedSucceededCount > 0) reasonCodes.push('gateway_grounded_succeeded');
  if (gatewayCorrelation.structuredSucceededCount > 0) reasonCodes.push('gateway_structured_succeeded');
  if (gatewayCorrelation.repairSucceededCount > 0) reasonCodes.push('gateway_repair_succeeded');
  if (gatewayCorrelation.groundedBlockedCount > 0) reasonCodes.push('gateway_grounded_blocked');

  let rootCause: StrategicContextAuditRootCause = 'unknown';
  if (refreshStatus === 'missing' || searchQuality === 'missing') {
    rootCause = 'missing_context';
  } else if (
    hasProviderFallback
    && (
      looksGatewayBlocked(lastError, summary)
      || (
        gatewayCorrelation.groundedBlockedCount > 0
        && gatewayCorrelation.groundedSucceededCount === 0
      )
    )
  ) {
    rootCause = 'provider_fallback_after_gateway_blocked';
  } else if (hasProviderFallback && gatewayCorrelation.groundedSucceededCount > 0) {
    rootCause = 'provider_fallback_after_grounding_sparse';
  } else if (hasProviderFallback && trustedSourceCount <= 1 && quantitativeCount === 0 && queryCount === 0) {
    rootCause = 'provider_fallback_provider_only_supported';
  } else if (hasProviderFallback) {
    rootCause = 'provider_fallback_after_grounding_sparse';
  } else if (quantitativeCount > 0 && !hasConcreteSourceUrls) {
    rootCause = 'grounded_but_claim_traceability_missing';
  } else if (quantitativeCount > 0 && quantitativeCount < 4) {
    rootCause = 'grounded_sparse_quantitative';
  } else if ((searchQuality === 'high' || searchQuality === 'medium') && trustedSourceCount >= 2 && quantitativeCount >= 4) {
    rootCause = 'usable_grounded_context';
  }

  let decisionUsefulness: StrategicContextDecisionUsefulness = 'none';
  if (hasProviderFallback && trustedSourceCount <= 1 && quantitativeCount === 0) {
    decisionUsefulness = 'fixture_only';
  } else if (hasProviderFallback) {
    decisionUsefulness = 'weak_transparency_only';
  } else if (quantitativeCount >= 4 && hasConcreteSourceUrls && trustedSourceCount >= 2) {
    decisionUsefulness = 'decision_relevant';
  } else if (quantitativeCount >= 4) {
    decisionUsefulness = 'useful_but_unverified';
  } else if (trustedSourceCount > 0 || sourceCount > 0) {
    decisionUsefulness = 'weak_transparency_only';
  }

  let claimTraceability: StrategicContextAuditDiagnostics['claimTraceability'] = 'unknown';
  if (sourceCount === 0) {
    claimTraceability = 'missing';
  } else if (!hasConcreteSourceUrls) {
    claimTraceability = 'domain_only';
  } else {
    claimTraceability = 'source_url_only';
  }

  let quantitativeIntegrity: StrategicContextAuditDiagnostics['quantitativeIntegrity'] = 'unknown';
  if (quantitativeCount === 0) {
    quantitativeIntegrity = 'none';
  } else if (quantitativeCount < 4) {
    quantitativeIntegrity = 'sparse_without_attribution';
  } else {
    quantitativeIntegrity = 'values_without_attribution';
  }

  return {
    rootCause,
    decisionUsefulness,
    hasProviderFallback,
    hasConcreteSourceUrls,
    concreteSourceUrlCount,
    genericSourceUrlCount,
    claimTraceability,
    quantitativeIntegrity,
    gatewayCorrelation,
    reasonCodes: Array.from(new Set(reasonCodes)),
  };
}
