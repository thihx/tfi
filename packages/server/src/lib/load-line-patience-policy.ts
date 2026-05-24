import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import {
  DEFAULT_LINE_PATIENCE_CONFIG,
  mergeLinePatienceConfig,
  parseLinePatienceConfigJson,
  type LinePatienceConfig,
} from './line-patience-policy.js';

const serverPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let cached: LinePatienceConfig | undefined;

export function getLinePatienceConfig(): LinePatienceConfig {
  if (cached) return cached;
  const p = config.linePatienceConfigPath?.trim();
  if (!p) {
    cached = DEFAULT_LINE_PATIENCE_CONFIG;
    return cached;
  }
  const abs = isAbsolute(p) ? p : resolve(serverPackageRoot, p);
  if (!existsSync(abs)) {
    cached = DEFAULT_LINE_PATIENCE_CONFIG;
    return cached;
  }
  try {
    cached = mergeLinePatienceConfig(
      DEFAULT_LINE_PATIENCE_CONFIG,
      parseLinePatienceConfigJson(readFileSync(abs, 'utf8')),
    );
  } catch {
    cached = DEFAULT_LINE_PATIENCE_CONFIG;
  }
  return cached;
}

export function isLinePatienceEnabled(): boolean {
  return config.linePatienceEnabled;
}

export function resetLinePatienceConfigCacheForTests(): void {
  cached = undefined;
}
