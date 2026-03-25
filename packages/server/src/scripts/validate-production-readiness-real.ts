import 'dotenv/config';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Fastify from 'fastify';
import { closePool, query } from '../db/pool.js';
import { proxyRoutes } from '../routes/proxy.routes.js';
import { fetchFixturesByIds } from '../lib/football-api.js';
import {
  runPipelineBatch,
  runPipelineForFixture,
  type MatchPipelineResult,
} from '../lib/server-pipeline.js';
import { enrichWatchlistJob } from '../jobs/enrich-watchlist.job.js';
import { autoSettleJob } from '../jobs/auto-settle.job.js';
import * as matchesRepo from '../repos/matches.repo.js';
import * as settingsRepo from '../repos/settings.repo.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';

type LiveMode = 'auto' | 'system_force' | 'manual_force';

interface LiveRunRecord {
  matchId: string;
  match: string;
  league: string;
  status: string;
  minute: number | null;
  mode: LiveMode;
  shadowMode: boolean;
  success: boolean;
  decisionKind: MatchPipelineResult['decisionKind'];
  shouldPush: boolean;
  selection: string;
  confidence: number;
  saved: boolean;
  notified: boolean;
  error?: string;
  oddsSource?: string;
  statsSource?: string;
  evidenceMode?: string;
  statsFallbackUsed?: boolean;
  statsFallbackReason?: string;
}

interface UpcomingEnrichmentRecord {
  matchId: string;
  match: string;
  league: string;
  enrichedAt: string | null;
  sourceQuality: string;
  trustedSourceCount: number;
  quantitativeCoverage: number;
  hasUsableSummary: boolean;
}

interface ValidationReport {
  generatedAt: string;
  migrationStatus: {
    pending: string[];
    appliedTail: string[];
  };
  liveMatches: Array<Record<string, unknown>>;
  upcomingMatches: Array<Record<string, unknown>>;
  enrichment: {
    selectedMatchIds: string[];
    jobResult: { checked: number; enriched: number };
    records: UpcomingEnrichmentRecord[];
  };
  askAi: {
    matchId: string | null;
    httpStatus: number | null;
    responseLength: number | null;
    error?: string;
  };
  liveRuns: LiveRunRecord[];
  batchRun: {
    matchIds: string[];
    totalMatches: number;
    processed: number;
    errors: number;
    pushedNotifications: number;
    savedRecommendations: number;
  } | null;
  saveAndNotify: {
    matchId: string | null;
    result: LiveRunRecord | null;
    recommendationRow: Record<string, unknown> | null;
  };
  providerSamples: {
    stats: Array<Record<string, unknown>>;
    odds: Array<Record<string, unknown>>;
  };
  settle: {
    autoSettle: { settled: number; skipped: number; errors: number };
    recentReportExists: boolean;
  };
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function quantitativeCoverage(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0;
  return Object.values(raw as Record<string, unknown>).filter((value) => typeof value === 'number').length;
}

function hasUsableSummary(summary: unknown): boolean {
  const text = String(summary ?? '').trim().toLowerCase();
  return !!text && !text.startsWith('no data');
}

function toLiveRecord(
  matchId: string,
  match: string,
  league: string,
  status: string,
  minute: number | null,
  mode: LiveMode,
  shadowMode: boolean,
  result: MatchPipelineResult,
): LiveRunRecord {
  return {
    matchId,
    match,
    league,
    status,
    minute,
    mode,
    shadowMode,
    success: result.success,
    decisionKind: result.decisionKind,
    shouldPush: result.shouldPush,
    selection: result.selection,
    confidence: result.confidence,
    saved: result.saved,
    notified: result.notified,
    error: result.error,
    oddsSource: result.debug?.oddsSource,
    statsSource: result.debug?.statsSource,
    evidenceMode: result.debug?.evidenceMode,
    statsFallbackUsed: result.debug?.statsFallbackUsed,
    statsFallbackReason: result.debug?.statsFallbackReason,
  };
}

function buildMarkdown(report: ValidationReport): string {
  const lines: string[] = [
    '# Real Production Readiness Validation',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Pending migrations: ${report.migrationStatus.pending.length}`,
    `- Live matches tested: ${report.liveMatches.length}`,
    `- Upcoming enrichment matches tested: ${report.enrichment.selectedMatchIds.length}`,
    '',
    '## Migrations',
    '',
    `- Pending: ${report.migrationStatus.pending.length ? report.migrationStatus.pending.join(', ') : '(none)'}`,
    `- Applied tail: ${report.migrationStatus.appliedTail.join(', ')}`,
    '',
    '## Enrichment',
    '',
    `- Job result: checked=${report.enrichment.jobResult.checked}, enriched=${report.enrichment.jobResult.enriched}`,
    '',
    '| Match ID | Match | Source Quality | Trusted Sources | Quant Coverage | Usable Summary |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.enrichment.records.map((row) => `| ${row.matchId} | ${row.match} | ${row.sourceQuality} | ${row.trustedSourceCount} | ${row.quantitativeCoverage} | ${row.hasUsableSummary ? 'yes' : 'no'} |`),
    '',
    '## Ask AI',
    '',
    `- matchId: ${report.askAi.matchId ?? '(none)'}`,
    `- httpStatus: ${report.askAi.httpStatus ?? '(none)'}`,
    `- responseLength: ${report.askAi.responseLength ?? '(none)'}`,
    ...(report.askAi.error ? [`- error: ${report.askAi.error}`] : []),
    '',
    '## Live Pipeline',
    '',
    '| Match ID | Mode | Shadow | Status | Minute | Decision | Notify | Selection | Saved | Notified | Odds Source | Stats Source | Evidence | Error |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.liveRuns.map((row) => `| ${row.matchId} | ${row.mode} | ${row.shadowMode ? 'yes' : 'no'} | ${row.status} | ${row.minute ?? ''} | ${row.decisionKind} | ${row.shouldPush ? 'yes' : 'no'} | ${row.selection || ''} | ${row.saved ? 'yes' : 'no'} | ${row.notified ? 'yes' : 'no'} | ${row.oddsSource ?? ''} | ${row.statsSource ?? ''} | ${row.evidenceMode ?? ''} | ${row.error ?? ''} |`),
    '',
    '## Batch Run',
    '',
    ...(report.batchRun
      ? [
          `- matchIds: ${report.batchRun.matchIds.join(', ')}`,
          `- totalMatches=${report.batchRun.totalMatches}, processed=${report.batchRun.processed}, errors=${report.batchRun.errors}, pushedNotifications=${report.batchRun.pushedNotifications}, savedRecommendations=${report.batchRun.savedRecommendations}`,
        ]
      : ['- not run']),
    '',
    '## Save And Notify',
    '',
    `- matchId: ${report.saveAndNotify.matchId ?? '(none)'}`,
    ...(report.saveAndNotify.result
      ? [
          `- pipelineResult: push=${report.saveAndNotify.result.shouldPush}, saved=${report.saveAndNotify.result.saved}, notified=${report.saveAndNotify.result.notified}, selection=${report.saveAndNotify.result.selection || '(none)'}`,
        ]
      : ['- pipelineResult: (none)']),
    `- recommendationRow: ${report.saveAndNotify.recommendationRow ? JSON.stringify(report.saveAndNotify.recommendationRow) : '(none)'}`,
    '',
    '## Provider Samples',
    '',
    `- stats: ${JSON.stringify(report.providerSamples.stats)}`,
    `- odds: ${JSON.stringify(report.providerSamples.odds)}`,
    '',
    '## Settle',
    '',
    `- autoSettle: settled=${report.settle.autoSettle.settled}, skipped=${report.settle.autoSettle.skipped}, errors=${report.settle.autoSettle.errors}`,
    `- recent real re-settle report exists: ${report.settle.recentReportExists ? 'yes' : 'no'}`,
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const generatedAt = toIsoNow();
  const liveMatches = (await matchesRepo.getMatchesByStatus(['1H', 'HT', '2H', 'INT'])).slice(0, 3);
  const upcomingMatches = (await matchesRepo.getMatchesByStatus(['NS'])).slice(0, 3);
  const liveIds = liveMatches.map((row) => row.match_id);
  const upcomingIds = upcomingMatches.map((row) => row.match_id);

  const migrationsDir = resolve(process.cwd(), 'src', 'db', 'migrations');
  const allMigrationFiles = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  const appliedRows = await query<{ name: string }>('SELECT name FROM _migrations ORDER BY id');
  const appliedNames = appliedRows.rows.map((row) => row.name);
  const appliedSet = new Set(appliedNames);
  const pending = allMigrationFiles.filter((file) => !appliedSet.has(file));

  const liveFixtures = await fetchFixturesByIds(liveIds);
  const fixtureMap = new Map(liveFixtures.map((fixture) => [String(fixture.fixture?.id), fixture]));

  const liveRuns: LiveRunRecord[] = [];
  let batchRun: ValidationReport['batchRun'] = null;
  let askAi: ValidationReport['askAi'] = { matchId: null, httpStatus: null, responseLength: null };
  let saveAndNotify: ValidationReport['saveAndNotify'] = { matchId: null, result: null, recommendationRow: null };

  const settingsBackup = await settingsRepo.getSettings();
  const activeOperationalRows = await watchlistRepo.getActiveOperationalWatchlist();
  const activeOperationalIds = activeOperationalRows.map((row) => row.match_id);
  const activeOperationalMatches = activeOperationalIds.length > 0
    ? await matchesRepo.getMatchesByIds(activeOperationalIds)
    : [];
  const activeOperationalStatusMap = new Map(
    activeOperationalMatches.map((row) => [row.match_id, row.status] as const),
  );
  const heldIds = activeOperationalRows
    .map((row) => row.match_id)
    .filter((matchId) => activeOperationalStatusMap.get(matchId) === 'NS' && !upcomingIds.includes(matchId));

  try {
    if (heldIds.length > 0) {
      await Promise.all(
        heldIds.map((matchId) =>
          watchlistRepo.updateOperationalWatchlistEntry(matchId, { status: 'temp_hold_real_validation' } as never)),
      );
    }
    if (upcomingIds.length > 0) {
      await Promise.all(
        upcomingIds.map((matchId) =>
          watchlistRepo.updateOperationalWatchlistEntry(matchId, {
            strategic_context: null as never,
            strategic_context_at: null,
          } as never)),
      );
    }

    const enrichmentJobResult = await enrichWatchlistJob();
    const enrichedRows = await Promise.all(upcomingIds.map((matchId) => watchlistRepo.getOperationalWatchlistByMatchId(matchId)));
    const enrichmentRecords: UpcomingEnrichmentRecord[] = enrichedRows.map((row, index) => {
      const strategicContext = (row?.strategic_context as Record<string, unknown> | null) ?? null;
      const sourceMeta = (strategicContext?.['source_meta'] as Record<string, unknown> | null) ?? null;
      return {
        matchId: upcomingIds[index]!,
        match: `${row?.home_team || upcomingMatches[index]?.home_team || ''} vs ${row?.away_team || upcomingMatches[index]?.away_team || ''}`,
        league: row?.league || upcomingMatches[index]?.league_name || '',
        enrichedAt: row?.strategic_context_at ?? null,
        sourceQuality: String(sourceMeta?.['search_quality'] ?? 'unknown'),
        trustedSourceCount: Number(sourceMeta?.['trusted_source_count'] ?? 0),
        quantitativeCoverage: quantitativeCoverage(strategicContext?.['quantitative']),
        hasUsableSummary: hasUsableSummary(strategicContext?.['summary']),
      };
    });

    const askAiTargetId = liveIds[0] ?? null;
    if (askAiTargetId) {
      const app = Fastify({ logger: false });
      await app.register(proxyRoutes);
      const response = await app.inject({
        method: 'POST',
        url: '/api/proxy/ai/analyze',
        payload: {
          matchId: askAiTargetId,
          provider: 'gemini',
          forceAnalyze: true,
        },
      });
      const body = response.json() as { text?: string; error?: string };
      askAi = {
        matchId: askAiTargetId,
        httpStatus: response.statusCode,
        responseLength: typeof body.text === 'string' ? body.text.length : null,
        error: body.error,
      };
      await app.close();
    }

    for (const liveRow of liveMatches) {
      const fixture = fixtureMap.get(liveRow.match_id);
      const watchlistEntry = await watchlistRepo.getOperationalWatchlistByMatchId(liveRow.match_id);
      if (!fixture || !watchlistEntry) continue;
      const matchDisplay = `${watchlistEntry.home_team} vs ${watchlistEntry.away_team}`;

      const autoResult = await runPipelineForFixture(liveRow.match_id, fixture, watchlistEntry, {
        shadowMode: true,
        sampleProviderData: true,
      });
      liveRuns.push(toLiveRecord(liveRow.match_id, matchDisplay, watchlistEntry.league, liveRow.status, liveRow.current_minute, 'auto', true, autoResult));

      const originalMode = watchlistEntry.mode;
      await watchlistRepo.updateOperationalWatchlistEntry(liveRow.match_id, { mode: 'F' } as never);
      const forcedEntry = await watchlistRepo.getOperationalWatchlistByMatchId(liveRow.match_id);
      if (forcedEntry) {
        const systemForceResult = await runPipelineForFixture(liveRow.match_id, fixture, forcedEntry, {
          shadowMode: true,
          sampleProviderData: true,
        });
        liveRuns.push(toLiveRecord(liveRow.match_id, matchDisplay, forcedEntry.league, liveRow.status, liveRow.current_minute, 'system_force', true, systemForceResult));
      }
      await watchlistRepo.updateOperationalWatchlistEntry(liveRow.match_id, { mode: originalMode } as never);

      const manualResult = await runPipelineForFixture(liveRow.match_id, fixture, watchlistEntry, {
        shadowMode: true,
        sampleProviderData: true,
        forceAnalyze: true,
        skipProceedGate: true,
        skipStalenessGate: true,
      });
      liveRuns.push(toLiveRecord(liveRow.match_id, matchDisplay, watchlistEntry.league, liveRow.status, liveRow.current_minute, 'manual_force', true, manualResult));
    }

    const nonShadowCandidate = liveRuns.find((row) => row.shadowMode && row.shouldPush);
    if (nonShadowCandidate) {
      const fixture = fixtureMap.get(nonShadowCandidate.matchId);
      const originalEntry = await watchlistRepo.getOperationalWatchlistByMatchId(nonShadowCandidate.matchId);
      if (fixture && originalEntry) {
        const originalMode = originalEntry.mode;
        const shouldForceViaMode = nonShadowCandidate.mode === 'system_force';
        if (shouldForceViaMode) {
          await watchlistRepo.updateOperationalWatchlistEntry(nonShadowCandidate.matchId, { mode: 'F' } as never);
        }
        const targetEntry = await watchlistRepo.getOperationalWatchlistByMatchId(nonShadowCandidate.matchId);
        if (targetEntry) {
          const nonShadowResult = await runPipelineForFixture(nonShadowCandidate.matchId, fixture, targetEntry, {
            shadowMode: false,
            sampleProviderData: true,
            forceAnalyze: nonShadowCandidate.mode === 'manual_force',
            skipProceedGate: nonShadowCandidate.mode === 'manual_force',
            skipStalenessGate: nonShadowCandidate.mode === 'manual_force',
          });
          const record = toLiveRecord(nonShadowCandidate.matchId, `${targetEntry.home_team} vs ${targetEntry.away_team}`, targetEntry.league, fixture.fixture?.status?.short || '', fixture.fixture?.status?.elapsed ?? null, nonShadowCandidate.mode, false, nonShadowResult);
          liveRuns.push(record);
          saveAndNotify.matchId = nonShadowCandidate.matchId;
          saveAndNotify.result = record;
          const recRow = await query<Record<string, unknown>>(
            `SELECT id, match_id, selection, notified, notification_channels, prompt_version, odds, confidence
             FROM recommendations
             WHERE match_id = $1
             ORDER BY id DESC
             LIMIT 1`,
            [nonShadowCandidate.matchId],
          );
          saveAndNotify.recommendationRow = recRow.rows[0] ?? null;
        }
        if (shouldForceViaMode) {
          await watchlistRepo.updateOperationalWatchlistEntry(nonShadowCandidate.matchId, { mode: originalMode } as never);
        }
      }
    }

    if (liveIds.length > 0) {
      await settingsRepo.saveSettings({
        ...settingsBackup,
        TELEGRAM_CHAT_ID: '',
      });
      const batchResult = await runPipelineBatch(liveIds);
      batchRun = {
        matchIds: liveIds,
        totalMatches: batchResult.totalMatches,
        processed: batchResult.processed,
        errors: batchResult.errors,
        pushedNotifications: batchResult.results.filter((row) => row.notified).length,
        savedRecommendations: batchResult.results.filter((row) => row.saved).length,
      };
      await settingsRepo.saveSettings(settingsBackup);
    }

    const providerStatsRows = await query<Record<string, unknown>>(
      `SELECT provider, consumer, COUNT(*)::int AS sample_count
       FROM provider_stats_samples
       WHERE match_id = ANY($1)
         AND captured_at >= NOW() - INTERVAL '2 hours'
       GROUP BY provider, consumer
       ORDER BY provider, consumer`,
      [liveIds],
    );
    const providerOddsRows = await query<Record<string, unknown>>(
      `SELECT provider, source, consumer, COUNT(*)::int AS sample_count
       FROM provider_odds_samples
       WHERE match_id = ANY($1)
         AND captured_at >= NOW() - INTERVAL '2 hours'
       GROUP BY provider, source, consumer
       ORDER BY provider, source, consumer`,
      [liveIds],
    );

    const settleStats = await autoSettleJob();
    const recentReportExists = !!readdirSync(resolve(process.cwd(), '..', '..', 'docs'))
      .find((file) => /^re-settle-recent-10-real-2026-03-21\.(md|json)$/.test(file));

    const report: ValidationReport = {
      generatedAt,
      migrationStatus: {
        pending,
        appliedTail: appliedNames.slice(-5),
      },
      liveMatches: liveMatches.map((row) => ({
        matchId: row.match_id,
        league: row.league_name,
        match: `${row.home_team} vs ${row.away_team}`,
        status: row.status,
        minute: row.current_minute,
        score: `${row.home_score ?? 0}-${row.away_score ?? 0}`,
      })),
      upcomingMatches: upcomingMatches.map((row) => ({
        matchId: row.match_id,
        league: row.league_name,
        match: `${row.home_team} vs ${row.away_team}`,
        kickoff: `${row.date} ${row.kickoff}`,
      })),
      enrichment: {
        selectedMatchIds: upcomingIds,
        jobResult: enrichmentJobResult,
        records: enrichmentRecords,
      },
      askAi,
      liveRuns,
      batchRun,
      saveAndNotify,
      providerSamples: {
        stats: providerStatsRows.rows,
        odds: providerOddsRows.rows,
      },
      settle: {
        autoSettle: settleStats,
        recentReportExists,
      },
    };

    const docsDir = resolve(process.cwd(), '..', '..', 'docs');
    mkdirSync(docsDir, { recursive: true });
    const jsonPath = join(docsDir, 'production-readiness-real-2026-03-21.json');
    const mdPath = join(docsDir, 'production-readiness-real-2026-03-21.md');
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    writeFileSync(mdPath, buildMarkdown(report), 'utf8');
    console.log(JSON.stringify({ jsonPath, mdPath, liveRuns: liveRuns.length }, null, 2));
  } finally {
    if (heldIds.length > 0) {
      await Promise.all(
        heldIds.map((matchId) =>
          watchlistRepo.updateOperationalWatchlistEntry(matchId, { status: 'active' } as never)),
      );
    }
    await settingsRepo.saveSettings(settingsBackup);
    await closePool().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
