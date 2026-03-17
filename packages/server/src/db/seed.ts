// ============================================================
// Seed script — imports data from Excel into PostgreSQL
// Usage: npm run seed
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transaction, closePool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// We read the Excel as JSON exported by a helper script.
// First, check if we have a pre-exported JSON, otherwise guide user.
const EXCEL_JSON_PATH = path.resolve(__dirname, '../../../../scripts/seed-data.json');
const EXCEL_PATH = path.resolve(__dirname, '../../../../scripts/Time_For_Investment.xlsx');

interface SeedData {
  leagues: Record<string, unknown>[];
  matches: Record<string, unknown>[];
  watchlist: Record<string, unknown>[];
  recommendations: Record<string, unknown>[];
}

async function loadSeedData(): Promise<SeedData> {
  if (fs.existsSync(EXCEL_JSON_PATH)) {
    console.log('📄 Loading seed data from seed-data.json...');
    return JSON.parse(fs.readFileSync(EXCEL_JSON_PATH, 'utf-8')) as SeedData;
  }

  // Try dynamic import of xlsx library
  console.log('📊 Reading directly from Excel file...');
  if (!fs.existsSync(EXCEL_PATH)) {
    throw new Error(`Excel file not found at ${EXCEL_PATH}. Place Time_For_Investment.xlsx in scripts/`);
  }

  // Use dynamic import for xlsx (optional dependency)
  let XLSX: any;
  try {
    const mod = await import('xlsx');
    XLSX = mod.default ?? mod;
  } catch {
    throw new Error(
      'xlsx package not installed. Run: npm install xlsx\n' +
        'Or export seed-data.json using: python scripts/export-seed-json.py',
    );
  }

  const workbook = XLSX.readFile(EXCEL_PATH);
  const data: SeedData = {
    leagues: [],
    matches: [],
    watchlist: [],
    recommendations: [],
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
    const key = sheetName.toLowerCase().replace(/ /g, '_') as keyof SeedData;
    if (key in data) {
      data[key] = rows;
    }
  }

  // Cache for next run
  fs.writeFileSync(EXCEL_JSON_PATH, JSON.stringify(data, null, 2));
  console.log(`  Cached to ${EXCEL_JSON_PATH}`);

  return data;
}

function toText(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function toNumOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function toBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  const s = toText(val).toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

function toTimestamp(val: unknown): string | null {
  if (!val) return null;
  const s = toText(val);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toDate(val: unknown): string | null {
  if (!val) return null;
  const s = toText(val);
  if (!s) return null;
  // Handle both ISO dates and Excel serial numbers
  if (typeof val === 'number') {
    // Excel date serial number
    const d = new Date((val - 25569) * 86400 * 1000);
    return d.toISOString().split('T')[0] ?? null;
  }
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function toTime(val: unknown): string | null {
  if (!val) return null;
  const s = toText(val);
  if (!s) return null;
  // Handle HH:mm or HH:mm:ss
  const match = s.match(/(\d{1,2}:\d{2}(:\d{2})?)/);
  return match?.[1] ?? null;
}

async function seedLeagues(data: Record<string, unknown>[]): Promise<number> {
  if (data.length === 0) return 0;

  return transaction(async (client) => {
    await client.query('TRUNCATE leagues CASCADE');

    let count = 0;
    for (const row of data) {
      const leagueId = toNumOrNull(row['league_id']);
      if (leagueId === null) continue;

      await client.query(
        `INSERT INTO leagues (league_id, league_name, country, tier, active, type, logo, last_updated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
         ON CONFLICT (league_id) DO UPDATE SET
           league_name = EXCLUDED.league_name,
           country = EXCLUDED.country,
           tier = EXCLUDED.tier,
           active = EXCLUDED.active,
           type = EXCLUDED.type,
           logo = EXCLUDED.logo,
           last_updated = EXCLUDED.last_updated`,
        [
          leagueId,
          toText(row['league_name']),
          toText(row['country']),
          toText(row['tier']),
          toBool(row['active']),
          toText(row['type']),
          toText(row['logo']),
          toTimestamp(row['last_updated']),
        ],
      );
      count++;
    }
    return count;
  });
}

async function seedMatches(data: Record<string, unknown>[]): Promise<number> {
  if (data.length === 0) return 0;

  return transaction(async (client) => {
    await client.query('TRUNCATE matches CASCADE');

    let count = 0;
    for (const row of data) {
      const matchId = toText(row['match_id']);
      if (!matchId) continue;

      const leagueId = toNumOrNull(row['league_id']);
      // Skip match if league doesn't exist in leagues
      if (leagueId !== null) {
        const exists = await client.query('SELECT 1 FROM leagues WHERE league_id = $1', [leagueId]);
        if (exists.rowCount === 0) continue;
      } else {
        continue;
      }

      const dateVal = toDate(row['date']);
      const kickoffVal = toTime(row['kickoff']);
      if (!dateVal || !kickoffVal) continue;

      await client.query(
        `INSERT INTO matches (match_id, date, kickoff, league_id, league_name, home_team, away_team,
                              home_logo, away_logo, venue, status, home_score, away_score,
                              current_minute, last_updated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, COALESCE($15, NOW()))
         ON CONFLICT (match_id) DO UPDATE SET
           date=EXCLUDED.date, kickoff=EXCLUDED.kickoff, league_id=EXCLUDED.league_id,
           league_name=EXCLUDED.league_name, home_team=EXCLUDED.home_team, away_team=EXCLUDED.away_team,
           home_logo=EXCLUDED.home_logo, away_logo=EXCLUDED.away_logo, venue=EXCLUDED.venue,
           status=EXCLUDED.status, home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score,
           current_minute=EXCLUDED.current_minute, last_updated=EXCLUDED.last_updated`,
        [
          matchId,
          dateVal,
          kickoffVal,
          leagueId,
          toText(row['league_name']),
          toText(row['home_team']),
          toText(row['away_team']),
          toText(row['home_logo']),
          toText(row['away_logo']),
          toText(row['venue']) || 'TBD',
          toText(row['status']) || 'NS',
          toNumOrNull(row['home_score']),
          toNumOrNull(row['away_score']),
          toNumOrNull(row['current_minute']),
          toTimestamp(row['last_updated']),
        ],
      );
      count++;
    }
    return count;
  });
}

async function seedRecommendations(data: Record<string, unknown>[]): Promise<number> {
  if (data.length === 0) return 0;

  let count = 0;
  // Process in batches of 100
  const batchSize = 100;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    await transaction(async (client) => {
      for (const row of batch) {
        const uniqueKey = toText(row['unique_key']);
        if (!uniqueKey) continue;

        const ts = toTimestamp(row['timestamp']);
        if (!ts) continue;

        await client.query(
          `INSERT INTO recommendations (
            unique_key, match_id, timestamp, league, home_team, away_team, status,
            condition_triggered_suggestion, custom_condition_raw, execution_id,
            odds_snapshot, stats_snapshot, pre_match_prediction_summary, custom_condition_matched,
            minute, score, bet_type, selection, odds, confidence, value_percent,
            risk_level, stake_percent, stake_amount, reasoning, key_factors, warnings,
            ai_model, mode, bet_market, notified, notification_channels,
            result, actual_outcome, pnl, settled_at, _was_overridden
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
            $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37
          ) ON CONFLICT (unique_key) DO NOTHING`,
          [
            uniqueKey,
            toText(row['match_id']),
            ts,
            toText(row['league']),
            toText(row['home_team']),
            toText(row['away_team']),
            toText(row['status']),
            toText(row['condition_triggered_suggestion']),
            toText(row['custom_condition_raw']),
            toText(row['execution_id']),
            toText(row['odds_snapshot']),
            toText(row['stats_snapshot']),
            toText(row['pre_match_prediction_summary']),
            toBool(row['custom_condition_matched']),
            toNumOrNull(row['minute']),
            toText(row['score']),
            toText(row['bet_type']),
            toText(row['selection']),
            toNumOrNull(row['odds']),
            toNumOrNull(row['confidence']),
            toNumOrNull(row['value_percent']),
            toText(row['risk_level']) || 'HIGH',
            toNumOrNull(row['stake_percent']),
            toNumOrNull(row['stake_amount']),
            toText(row['reasoning']),
            toText(row['key_factors']),
            toText(row['warnings']),
            toText(row['ai_model']),
            toText(row['mode']) || 'B',
            toText(row['bet_market']),
            toText(row['notified']),
            toText(row['notification_channels']),
            toText(row['result']),
            toText(row['actual_outcome']),
            toNumOrNull(row['pnl']) ?? 0,
            toTimestamp(row['settled_at']),
            toBool(row['_was_overridden']),
          ],
        );
        count++;
      }
    });
    console.log(`  Recommendations: ${Math.min(i + batchSize, data.length)}/${data.length}`);
  }
  return count;
}

async function seed(): Promise<void> {
  console.log('🌱 Seeding database...\n');

  const data = await loadSeedData();

  const leagueCount = await seedLeagues(data.leagues);
  console.log(`✅ Leagues: ${leagueCount} rows`);

  const matchCount = await seedMatches(data.matches);
  console.log(`✅ Matches: ${matchCount} rows`);

  const recCount = await seedRecommendations(data.recommendations);
  console.log(`✅ Recommendations: ${recCount} rows`);

  console.log('\n🎉 Seed complete!');
  await closePool();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
