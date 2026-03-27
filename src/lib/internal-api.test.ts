import { describe, expect, test } from 'vitest';

import { internalApiUrl, resolveInternalApiBaseUrl } from './internal-api';

describe('internal API helpers', () => {
  test('normalizes explicit backend base URLs', () => {
    expect(resolveInternalApiBaseUrl('http://localhost:4000/')).toBe('http://localhost:4000');
  });

  test('builds backend api urls only', () => {
    expect(internalApiUrl('/api/jobs', 'http://localhost:4000/')).toBe('http://localhost:4000/api/jobs');
  });

  test('rejects non-api runtime paths', () => {
    expect(() => internalApiUrl('/health', 'http://localhost:4000')).toThrow(
      'Frontend runtime requests must use backend /api routes only',
    );
  });

  test('supports same-origin backend routing', () => {
    expect(internalApiUrl('/api/auth/me', '')).toBe('/api/auth/me');
  });
});