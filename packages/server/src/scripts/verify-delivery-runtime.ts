import { Client } from 'pg';
import { config } from '../config.js';
import { signToken } from '../lib/jwt.js';
import {
  summarizeDeliveryRuntimeVerification,
  type DeliveryRuntimeChannelRow,
} from '../lib/delivery-runtime-verifier.js';

interface VerifyArgs {
  matchId?: string;
  candidateLimit: number;
  waitMs: number;
  userId: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  name: string;
}

interface AttemptResult {
  matchId: string;
  home: string | null;
  away: string | null;
  status: number;
  success: boolean | null;
  saved: boolean | null;
  shouldPush: boolean | null;
  decisionKind: string | null;
}

type VerificationStatus = 'confirmed' | 'partial' | 'no_saved_recommendation';

function parseArgs(argv: string[]): VerifyArgs {
  let matchId: string | undefined;
  let candidateLimit = 8;
  let waitMs = 12_000;
  let userId = 'b8fe0d0e-30f1-4a0f-90f7-6158ddfdc301';
  let email = 'huynhxuanthi@gmail.com';
  let role: VerifyArgs['role'] = 'admin';
  let name = 'huynhxuanthi@gmail.com';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--match-id' && next) {
      matchId = next.trim();
      index += 1;
      continue;
    }
    if (arg === '--candidate-limit' && next) {
      candidateLimit = Math.max(1, Number(next) || candidateLimit);
      index += 1;
      continue;
    }
    if (arg === '--wait-ms' && next) {
      waitMs = Math.max(0, Number(next) || waitMs);
      index += 1;
      continue;
    }
    if (arg === '--user-id' && next) {
      userId = next.trim();
      index += 1;
      continue;
    }
    if (arg === '--email' && next) {
      email = next.trim();
      index += 1;
      continue;
    }
    if (arg === '--role' && next && (next === 'owner' || next === 'admin' || next === 'member')) {
      role = next;
      index += 1;
      continue;
    }
    if (arg === '--name' && next) {
      name = next;
      index += 1;
    }
  }

  return { matchId, candidateLimit, waitMs, userId, email, role, name };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildBearerToken(args: VerifyArgs): string {
  return signToken(
    {
      sub: args.userId,
      email: args.email,
      role: args.role,
      name: args.name,
      picture: '',
    },
    config.jwtSecret,
    config.jwtExpiresInSeconds,
  );
}

async function loadChannelReadiness(client: Client, userId: string) {
  const telegramResult = await client.query<{ ready: boolean }>(
    `SELECT EXISTS(
       SELECT 1
       FROM user_notification_channel_configs
       WHERE user_id = $1::uuid
         AND channel_type = 'telegram'
         AND enabled = TRUE
         AND status <> 'disabled'
         AND address IS NOT NULL
         AND BTRIM(address) <> ''
     ) AS ready`,
    [userId],
  );
  const webPushResult = await client.query<{ ready: boolean }>(
    `SELECT EXISTS(
       SELECT 1
       FROM push_subscriptions
       WHERE user_id = $1::text
     ) AS ready`,
    [userId],
  );

  return {
    telegram: Boolean(telegramResult.rows[0]?.ready),
    webPush: Boolean(webPushResult.rows[0]?.ready),
  };
}

async function loadCandidates(client: Client, args: VerifyArgs): Promise<Array<{ matchId: string; home: string | null; away: string | null; latestRecommendationId: number }>> {
  if (args.matchId) {
    const existing = await client.query<{ latest_id: string }>(
      'SELECT COALESCE(MAX(id), 0)::text AS latest_id FROM recommendations WHERE match_id = $1',
      [args.matchId],
    );
    return [{
      matchId: args.matchId,
      home: null,
      away: null,
      latestRecommendationId: Number(existing.rows[0]?.latest_id ?? 0),
    }];
  }

  const result = await client.query<{
    match_id: string;
    home_team: string | null;
    away_team: string | null;
    latest_id: string;
  }>(
    `SELECT
       match_id,
       MAX(home_team) AS home_team,
       MAX(away_team) AS away_team,
       MAX(id)::text AS latest_id
     FROM recommendations
     GROUP BY match_id
     ORDER BY MAX(id) DESC
     LIMIT $1`,
    [args.candidateLimit],
  );

  return result.rows.map((row) => ({
    matchId: row.match_id,
    home: row.home_team,
    away: row.away_team,
    latestRecommendationId: Number(row.latest_id),
  }));
}

async function analyzeCandidate(matchId: string, token: string): Promise<{ status: number; payload: unknown }> {
  const res = await fetch(`http://127.0.0.1:3001/api/live-monitor/matches/${encodeURIComponent(matchId)}/analyze`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  const text = await res.text();
  try {
    return { status: res.status, payload: JSON.parse(text) as unknown };
  } catch {
    return { status: res.status, payload: { raw: text } };
  }
}

async function loadRecommendationVerification(client: Client, matchId: string, previousMaxId: number) {
  const recResult = await client.query<{
    id: number;
    match_id: string;
    home_team: string | null;
    away_team: string | null;
    notified: string | null;
    notification_channels: string | null;
  }>(
    `SELECT id, match_id, home_team, away_team, notified, notification_channels
     FROM recommendations
     WHERE match_id = $1 AND id > $2
     ORDER BY id DESC
     LIMIT 1`,
    [matchId, previousMaxId],
  );
  const recommendation = recResult.rows[0] ?? null;
  if (!recommendation) return null;

  const deliveryResult = await client.query<{
    delivery_id: number;
    delivery_status: string;
    delivery_channels: unknown;
    channel_type: string | null;
    channel_status: string | null;
    delivered_at: string | null;
    attempt_count: number;
    last_error: string | null;
  }>(
    `SELECT
       d.id AS delivery_id,
       d.delivery_status,
       d.delivery_channels,
       c.channel_type,
       c.status AS channel_status,
       c.delivered_at,
       c.attempt_count,
       c.last_error
     FROM user_recommendation_deliveries d
     LEFT JOIN user_recommendation_delivery_channels c
       ON c.delivery_id = d.id
     WHERE d.recommendation_id = $1
     ORDER BY d.id DESC, c.channel_type ASC`,
    [recommendation.id],
  );

  return {
    recommendation,
    deliveries: deliveryResult.rows,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = buildBearerToken(args);
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    const readiness = await loadChannelReadiness(client, args.userId);
    const candidates = await loadCandidates(client, args);
    const attempts: AttemptResult[] = [];

    for (const candidate of candidates) {
      const analyzed = await analyzeCandidate(candidate.matchId, token);
      const result = (typeof analyzed.payload === 'object' && analyzed.payload && 'result' in analyzed.payload)
        ? (analyzed.payload as { result?: Record<string, unknown> }).result ?? null
        : null;

      const attempt: AttemptResult = {
        matchId: candidate.matchId,
        home: candidate.home,
        away: candidate.away,
        status: analyzed.status,
        success: typeof result?.success === 'boolean' ? result.success : null,
        saved: typeof result?.saved === 'boolean' ? result.saved : null,
        shouldPush: typeof result?.shouldPush === 'boolean' ? result.shouldPush : null,
        decisionKind: typeof result?.decisionKind === 'string' ? result.decisionKind : null,
      };
      attempts.push(attempt);

      if (!attempt.saved) continue;

      await sleep(args.waitMs);
      const verification = await loadRecommendationVerification(client, candidate.matchId, candidate.latestRecommendationId);
      const rows: DeliveryRuntimeChannelRow[] = (verification?.deliveries ?? [])
        .filter((row) => row.channel_type && row.channel_status)
        .map((row) => ({
          channelType: String(row.channel_type),
          channelStatus: String(row.channel_status),
        }));
      const deliverySummary = summarizeDeliveryRuntimeVerification({
        readiness,
        rows,
        snapshot: verification?.deliveries[0]
          ? {
              notificationChannels: verification.recommendation?.notification_channels ?? null,
              deliveryChannels: verification.deliveries[0].delivery_channels,
            }
          : {
              notificationChannels: verification?.recommendation?.notification_channels ?? null,
              deliveryChannels: [],
            },
      });
      const status: VerificationStatus = deliverySummary.fullyDelivered
        ? 'confirmed'
        : 'partial';

      console.log(JSON.stringify({
        status,
        readiness,
        trigger: attempt,
        recommendation: verification?.recommendation ?? null,
        deliveries: verification?.deliveries ?? [],
        deliverySummary,
        attempts,
      }, null, 2));
      return;
    }

    console.log(JSON.stringify({
      status: 'no_saved_recommendation' as VerificationStatus,
      readiness,
      attempts,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
