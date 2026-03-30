import type { MatchPipelineResult, PipelineResult } from '../lib/server-pipeline.js';

const MAX_GENERIC_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 300;

type JsonLike =
  | string
  | number
  | boolean
  | null
  | JsonLike[]
  | { [key: string]: JsonLike };

function truncateString(value: string, max = MAX_STRING_LENGTH): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function compactPipelineMatchResult(result: MatchPipelineResult): Record<string, JsonLike> {
  const output: Record<string, JsonLike> = {
    matchId: result.matchId,
    matchDisplay: result.matchDisplay ?? '',
    homeName: result.homeName ?? '',
    awayName: result.awayName ?? '',
    league: result.league ?? '',
    minute: result.minute ?? null,
    score: result.score ?? '',
    status: result.status ?? '',
    success: result.success,
    decisionKind: result.decisionKind,
    shouldPush: result.shouldPush,
    selection: truncateString(result.selection ?? ''),
    confidence: result.confidence,
    saved: result.saved,
    notified: result.notified,
    error: result.error ? truncateString(result.error) : '',
  };
  if (result.debug) {
    const debug: Record<string, JsonLike> = {
      shadowMode: result.debug.shadowMode,
      prematchNoisePenalty: result.debug.prematchNoisePenalty ?? null,
    };
    if (result.debug.analysisRunId) debug.analysisRunId = result.debug.analysisRunId;
    if (result.debug.skippedAt) debug.skippedAt = result.debug.skippedAt;
    if (result.debug.skipReason) debug.skipReason = truncateString(result.debug.skipReason);
    if (result.debug.analysisMode) debug.analysisMode = String(result.debug.analysisMode);
    if (result.debug.oddsSource) debug.oddsSource = result.debug.oddsSource;
    if (typeof result.debug.oddsAvailable === 'boolean') debug.oddsAvailable = result.debug.oddsAvailable;
    if (typeof result.debug.statsAvailable === 'boolean') debug.statsAvailable = result.debug.statsAvailable;
    if (result.debug.statsSource) debug.statsSource = String(result.debug.statsSource);
    if (result.debug.evidenceMode) debug.evidenceMode = String(result.debug.evidenceMode);
    if (typeof result.debug.statsFallbackUsed === 'boolean') debug.statsFallbackUsed = result.debug.statsFallbackUsed;
    if (result.debug.statsFallbackReason) debug.statsFallbackReason = truncateString(result.debug.statsFallbackReason);
    if (result.debug.promptVersion) debug.promptVersion = result.debug.promptVersion;
    if (result.debug.promptDataLevel) debug.promptDataLevel = String(result.debug.promptDataLevel);
    if (typeof result.debug.llmLatencyMs === 'number') debug.llmLatencyMs = result.debug.llmLatencyMs;
    if (typeof result.debug.totalLatencyMs === 'number') debug.totalLatencyMs = result.debug.totalLatencyMs;
    output.debug = debug;
  }
  return output;
}

function compactPipelineResults(results: PipelineResult[]): JsonLike[] {
  return results.map((batch) => ({
    totalMatches: batch.totalMatches,
    processed: batch.processed,
    errors: batch.errors,
    results: batch.results.map(compactPipelineMatchResult),
  }));
}

function summarizePipelineResults(results: PipelineResult[]): Record<string, JsonLike> {
  const flattened = results.flatMap((batch) => batch.results);
  return {
    batches: results.length,
    processed: results.reduce((sum, batch) => sum + Number(batch.processed ?? 0), 0),
    errors: results.reduce((sum, batch) => sum + Number(batch.errors ?? 0), 0),
    savedRecommendations: flattened.filter((row) => row.saved).length,
    pushedNotifications: flattened.filter((row) => row.notified).length,
    successfulAnalyses: flattened.filter((row) => row.success).length,
  };
}

function compactGeneric(value: unknown, depth = 0): JsonLike {
  if (value == null) return null;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= 2) return value.length;
    return value.slice(0, MAX_GENERIC_ARRAY_ITEMS).map((entry) => compactGeneric(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const output: Record<string, JsonLike> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (Array.isArray(entry)) {
        output[`${key}Count`] = entry.length;
        if (depth < 1 && entry.length > 0) {
          output[key] = entry.slice(0, MAX_GENERIC_ARRAY_ITEMS).map((item) => compactGeneric(item, depth + 1));
        }
        continue;
      }
      if (entry && typeof entry === 'object') {
        if (depth >= 2) {
          output[key] = '[object]';
        } else {
          output[key] = compactGeneric(entry, depth + 1);
        }
        continue;
      }
      output[key] = compactGeneric(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function compactJobResultForProgress(name: string, result: unknown): JsonLike {
  const record = asObject(result);
  if (name === 'check-live-trigger' && record && Array.isArray(record.pipelineResults)) {
    return {
      liveCount: Number(record.liveCount ?? 0),
      candidateCount: Number(record.candidateCount ?? 0),
      pipelineResults: compactPipelineResults(record.pipelineResults as PipelineResult[]),
    };
  }

  if (name === 're-evaluate' && record && Array.isArray(record.discrepancies)) {
    return {
      total: Number(record.total ?? 0),
      evaluated: Number(record.evaluated ?? 0),
      corrected: Number(record.corrected ?? 0),
      newlySettled: Number(record.newlySettled ?? 0),
      skippedNoScore: Number(record.skippedNoScore ?? 0),
      discrepancyCount: record.discrepancies.length,
      discrepancies: record.discrepancies
        .slice(0, MAX_GENERIC_ARRAY_ITEMS)
        .map((entry) => compactGeneric(entry, 1)),
    };
  }

  return compactGeneric(result);
}

export function summarizeJobResultForAudit(name: string, result: unknown): Record<string, JsonLike> | null {
  if (result == null) return null;
  const record = asObject(result);

  if (name === 'check-live-trigger' && record && Array.isArray(record.pipelineResults)) {
    return {
      liveCount: Number(record.liveCount ?? 0),
      candidateCount: Number(record.candidateCount ?? 0),
      ...summarizePipelineResults(record.pipelineResults as PipelineResult[]),
    };
  }

  if (name === 're-evaluate' && record && Array.isArray(record.discrepancies)) {
    return {
      total: Number(record.total ?? 0),
      evaluated: Number(record.evaluated ?? 0),
      corrected: Number(record.corrected ?? 0),
      newlySettled: Number(record.newlySettled ?? 0),
      skippedNoScore: Number(record.skippedNoScore ?? 0),
      discrepancyCount: record.discrepancies.length,
    };
  }

  const compacted = compactGeneric(result);
  const compactedObject = asObject(compacted);
  return compactedObject ? compactedObject as Record<string, JsonLike> : { value: compacted };
}
