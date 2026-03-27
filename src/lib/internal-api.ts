import type { AppConfig } from '@/types';

function defaultApiBaseUrl(): string {
  return import.meta.env.VITE_API_URL as string | undefined
    ?? (import.meta.env.MODE === 'production' ? '' : 'http://localhost:4000');
}

export function resolveInternalApiBaseUrl(configOrBase?: AppConfig | string | null): string {
  const rawBase = typeof configOrBase === 'string'
    ? configOrBase
    : configOrBase && typeof configOrBase === 'object'
      ? configOrBase.apiUrl
      : defaultApiBaseUrl();

  const base = (rawBase ?? '').trim();
  if (base === '') return '';
  if (!/^https?:\/\//i.test(base)) {
    throw new Error(`Invalid internal API base URL: ${base}`);
  }
  return base.replace(/\/+$/, '');
}

export function internalApiUrl(path: string, configOrBase?: AppConfig | string | null): string {
  if (!path.startsWith('/api/')) {
    throw new Error(`Frontend runtime requests must use backend /api routes only: ${path}`);
  }
  return `${resolveInternalApiBaseUrl(configOrBase)}${path}`;
}
