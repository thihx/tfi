import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { closePool } from '../db/pool.js';
import { applyLegacyWatchlistCleanup, previewLegacyWatchlistCleanup } from '../lib/legacy-watchlist-cleanup.js';
import { config } from '../config.js';

const argv = process.argv.slice(2);
let staleDays = config.legacyWatchlistStaleDays;
let apply = false;
let outJson: string | undefined;

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--stale-days' && argv[i + 1]) {
    staleDays = Math.max(1, Number(argv[i + 1]) || staleDays);
    i++;
  } else if (argv[i] === '--apply') {
    apply = true;
  } else if (argv[i] === '--out-json' && argv[i + 1]) {
    outJson = resolve(process.cwd(), argv[i + 1]!);
    i++;
  }
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: tsx preview-legacy-watchlist-cleanup.ts [--stale-days 7] [--apply] [--out-json path]');
  process.exit(0);
}

try {
  const preview = await previewLegacyWatchlistCleanup(staleDays);
  const payload = apply
    ? { preview, apply: await applyLegacyWatchlistCleanup(staleDays) }
    : { preview, apply: null };
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (outJson) {
    mkdirSync(dirname(outJson), { recursive: true });
    writeFileSync(outJson, text, 'utf8');
  }
  process.stdout.write(text);
} finally {
  await closePool();
}
