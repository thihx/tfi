import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { listReplayScenarioJsonBasenames } from '../lib/replay-scenario-files.js';

describe('listReplayScenarioJsonBasenames', () => {
  test('uses _manifest.json when present to ignore extra json files', () => {
    const dir = join(process.cwd(), 'replay-work', '_vitest-manifest-fixture');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '_manifest.json'), JSON.stringify({ scenarios: [{ name: 'only-one' }] }));
    writeFileSync(join(dir, 'only-one.json'), '{}');
    writeFileSync(join(dir, 'stale-leak.json'), '{}');
    const files = listReplayScenarioJsonBasenames(dir);
    expect(files).toEqual(['only-one.json']);
  });
});
