import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Sorted scenario JSON basenames (e.g. `foo.json`). If `_manifest.json` exists (from export), only
 * those names are used so leftover files in the folder cannot inflate replay cohorts.
 */
export function listReplayScenarioJsonBasenames(dirPath: string): string[] {
  const manifestPath = join(dirPath, '_manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const raw = readFileSync(manifestPath, 'utf8');
      const j = JSON.parse(raw) as { scenarios?: Array<{ name?: string }> };
      const names = (j.scenarios ?? [])
        .map((s) => (typeof s.name === 'string' && s.name.length > 0 ? `${s.name}.json` : null))
        .filter((x): x is string => x != null);
      if (names.length > 0) {
        return names.filter((f) => existsSync(join(dirPath, f))).sort((a, b) => a.localeCompare(b));
      }
    } catch {
      /* use directory listing */
    }
  }
  return readdirSync(dirPath)
    .filter((name) => extname(name).toLowerCase() === '.json' && !name.startsWith('_'))
    .sort((a, b) => a.localeCompare(b));
}
