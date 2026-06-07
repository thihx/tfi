export const MAX_LIVE_STREAM_PROVIDER_URLS = 12;

export function normalizeLiveStreamProviderUrl(raw: string): { url: string | null; error: string | null } {
  const candidate = raw.trim();
  if (!candidate) return { url: null, error: 'Enter a provider URL.' };
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { url: null, error: 'Provider URLs must use http or https.' };
    }
    parsed.hash = '';
    return { url: parsed.toString(), error: null };
  } catch {
    return { url: null, error: `Invalid provider URL: ${candidate}` };
  }
}

export function liveStreamProviderHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

export function formatLiveStreamCacheTtl(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${Math.round(seconds / 60)} min`;
  return `${seconds}s`;
}