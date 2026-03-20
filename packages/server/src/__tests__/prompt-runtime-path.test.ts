import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function collectRuntimeFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...collectRuntimeFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\./.test(entry.name)) continue;
    files.push(fullPath);
  }

  return files;
}

describe('runtime prompt path', () => {
  test('keeps ai-prompt.service out of runtime imports', () => {
    const repoRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
    const runtimeRoots = [
      path.join(repoRoot, 'packages', 'server', 'src'),
      path.join(repoRoot, 'src'),
    ];

    const offenders = runtimeRoots
      .flatMap((root) => collectRuntimeFiles(root))
      .filter((file) => !file.endsWith(path.join('services', 'ai-prompt.service.ts')))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('ai-prompt.service'));

    expect(offenders).toEqual([]);
  });
});
