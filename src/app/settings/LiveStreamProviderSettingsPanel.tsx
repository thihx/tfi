import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import {
  formatLiveStreamCacheTtl,
  liveStreamProviderHostname,
  MAX_LIVE_STREAM_PROVIDER_URLS,
  normalizeLiveStreamProviderUrl,
} from '@/lib/live-stream-provider-url';
import {
  fetchLiveStreamLocatorSettings,
  testLiveStreamProviders,
  updateLiveStreamLocatorSettings,
  type LiveStreamLocatorSettings,
  type LiveStreamProviderProbeResult,
} from '@/lib/services/api';

type LiveStreamSettingsDraft = {
  enabled: boolean;
  providerUrls: string[];
  timeoutMs: string;
  cacheTtlSeconds: string;
  maxMatches: string;
};

function draftFromLiveStreamSettings(settings: LiveStreamLocatorSettings): LiveStreamSettingsDraft {
  return {
    enabled: settings.enabled,
    providerUrls: [...settings.providerUrls],
    timeoutMs: String(settings.timeoutMs),
    cacheTtlSeconds: String(Math.round(settings.cacheTtlMs / 1000)),
    maxMatches: String(settings.maxMatches),
  };
}

function draftsEqual(a: LiveStreamSettingsDraft | null, b: LiveStreamSettingsDraft | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildLiveStreamSettingsPayload(draft: LiveStreamSettingsDraft): { payload: LiveStreamLocatorSettings | null; error: string | null } {
  const providerUrls: string[] = [];
  for (const raw of draft.providerUrls) {
    const normalized = normalizeLiveStreamProviderUrl(raw);
    if (!normalized.url) {
      return { payload: null, error: normalized.error ?? `Invalid provider URL: ${raw}` };
    }
    if (!providerUrls.includes(normalized.url)) providerUrls.push(normalized.url);
  }

  if (draft.enabled && providerUrls.length === 0) {
    return { payload: null, error: 'Add at least one provider URL or disable lookup.' };
  }
  if (providerUrls.length > MAX_LIVE_STREAM_PROVIDER_URLS) {
    return { payload: null, error: `Provider URL list supports at most ${MAX_LIVE_STREAM_PROVIDER_URLS} entries.` };
  }

  const timeoutMs = Number(draft.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15_000) {
    return { payload: null, error: 'Request timeout must be from 500 to 15000 ms.' };
  }

  const cacheTtlSeconds = Number(draft.cacheTtlSeconds);
  if (!Number.isInteger(cacheTtlSeconds) || cacheTtlSeconds < 15 || cacheTtlSeconds > 3600) {
    return { payload: null, error: 'Cache TTL must be from 15 to 3600 seconds.' };
  }

  const maxMatches = Number(draft.maxMatches);
  if (!Number.isInteger(maxMatches) || maxMatches < 1 || maxMatches > 100) {
    return { payload: null, error: 'Max matches must be from 1 to 100.' };
  }

  return {
    payload: {
      enabled: draft.enabled,
      providerUrls,
      timeoutMs,
      cacheTtlMs: cacheTtlSeconds * 1000,
      maxMatches,
    },
    error: null,
  };
}

function probeSummary(result: LiveStreamProviderProbeResult): string {
  if (!result.reachable) return result.error ?? 'Unreachable';
  const parsers = result.detectedParsers.length > 0 ? result.detectedParsers.join(', ') : 'no known parsers';
  return `HTTP ${result.httpStatus ?? '?'} · ${parsers} · ${result.anchorLinkCount} links`;
}

export function LiveStreamProviderSettingsPanel() {
  const { state } = useAppState();
  const { showToast } = useToast();
  const apiConfig = state.config;
  const apiUrl = typeof apiConfig.apiUrl === 'string' ? apiConfig.apiUrl : '';
  const [draft, setDraft] = useState<LiveStreamSettingsDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<LiveStreamSettingsDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addUrlValue, setAddUrlValue] = useState('');
  const [addUrlError, setAddUrlError] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<Map<string, LiveStreamProviderProbeResult>>(new Map());
  const [probeCheckedAt, setProbeCheckedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const settings = await fetchLiveStreamLocatorSettings(apiConfig);
      const nextDraft = draftFromLiveStreamSettings(settings);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setProbeResults(new Map());
      setProbeCheckedAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load live stream settings.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDraft = useCallback(<K extends keyof LiveStreamSettingsDraft>(key: K, value: LiveStreamSettingsDraft[K]) => {
    setDraft((prev) => prev ? { ...prev, [key]: value } : prev);
  }, []);

  const isDirty = useMemo(() => !draftsEqual(draft, savedDraft), [draft, savedDraft]);

  const handleAddProvider = useCallback(() => {
    if (!draft) return;
    const normalized = normalizeLiveStreamProviderUrl(addUrlValue);
    if (!normalized.url) {
      setAddUrlError(normalized.error);
      return;
    }
    if (draft.providerUrls.some((url) => normalizeLiveStreamProviderUrl(url).url === normalized.url)) {
      setAddUrlError('This provider URL is already in the list.');
      return;
    }
    if (draft.providerUrls.length >= MAX_LIVE_STREAM_PROVIDER_URLS) {
      setAddUrlError(`Provider URL list supports at most ${MAX_LIVE_STREAM_PROVIDER_URLS} entries.`);
      return;
    }
    updateDraft('providerUrls', [...draft.providerUrls, normalized.url]);
    setAddUrlValue('');
    setAddUrlError(null);
  }, [addUrlValue, draft, updateDraft]);

  const handleRemoveProvider = useCallback((url: string) => {
    if (!draft) return;
    updateDraft('providerUrls', draft.providerUrls.filter((item) => item !== url));
    setProbeResults((prev) => {
      const next = new Map(prev);
      next.delete(url);
      return next;
    });
  }, [draft, updateDraft]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    const built = buildLiveStreamSettingsPayload(draft);
    if (!built.payload) {
      setError(built.error);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = await updateLiveStreamLocatorSettings(apiConfig, built.payload);
      const nextDraft = draftFromLiveStreamSettings(saved);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      showToast('Live stream settings saved.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save live stream settings.');
    } finally {
      setSaving(false);
    }
  }, [apiUrl, draft, showToast]);

  const handleTestProviders = useCallback(async () => {
    if (!draft) return;
    const built = buildLiveStreamSettingsPayload(draft);
    if (!built.payload) {
      setError(built.error);
      return;
    }
    if (built.payload.providerUrls.length === 0) {
      setError('Add at least one provider URL to test.');
      return;
    }

    setTesting(true);
    setError(null);
    try {
      const response = await testLiveStreamProviders(apiConfig, built.payload.providerUrls, built.payload.timeoutMs);
      setProbeResults(new Map(response.results.map((result) => [result.url, result])));
      setProbeCheckedAt(response.checkedAt);
      showToast('Provider probe finished.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test live stream providers.');
    } finally {
      setTesting(false);
    }
  }, [apiUrl, draft, showToast]);

  if (loading && !draft) {
    return <p className="text-muted">Loading live stream settings...</p>;
  }

  const cacheTtlSeconds = Number(draft?.cacheTtlSeconds ?? '0');
  const providerCount = draft?.providerUrls.length ?? 0;

  return (
    <div className="settings-section settings-live-panel">
      <div className="settings-live-header">
        <div>
          <h3 className="settings-live-title">Live stream lookup</h3>
          <p className="settings-live-lead">
            Scans configured provider homepages when a match is live on the Matches tab, then matches team names to stream links.
          </p>
        </div>
        <label className="settings-inline-check settings-live-enabled">
          <input
            type="checkbox"
            checked={draft?.enabled ?? false}
            disabled={!draft || saving || testing}
            onChange={(event) => updateDraft('enabled', event.target.checked)}
          />
          <span>Enabled</span>
        </label>
      </div>

      <div className="settings-live-status" aria-live="polite">
        <span>{providerCount} provider{providerCount === 1 ? '' : 's'}</span>
        <span aria-hidden="true">·</span>
        <span>{draft?.enabled ? 'Lookup ON' : 'Lookup OFF'}</span>
        <span aria-hidden="true">·</span>
        <span>Cache {formatLiveStreamCacheTtl(Number.isFinite(cacheTtlSeconds) ? cacheTtlSeconds : 0)}</span>
        {isDirty ? <span className="settings-live-status__dirty">Unsaved changes</span> : null}
      </div>

      {error ? <div className="settings-banner settings-banner--error" role="alert">{error}</div> : null}

      <section className="settings-live-section" aria-labelledby="settings-live-providers-heading">
        <div className="settings-live-section__header">
          <h4 id="settings-live-providers-heading" className="settings-live-section__title">Providers</h4>
          <div className="settings-live-section__actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void load(); }} disabled={loading || saving || testing}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void handleTestProviders(); }} disabled={!draft || saving || testing || providerCount === 0}>
              {testing ? 'Testing...' : 'Test providers'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { void handleSave(); }} disabled={!draft || saving || testing || !isDirty}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {providerCount === 0 ? (
          <div className="settings-live-empty">
            <p>No provider URLs yet. Add a homepage URL to start matching live streams.</p>
          </div>
        ) : (
          <ul className="settings-live-provider-list">
            {draft?.providerUrls.map((url) => {
              const probe = probeResults.get(url);
              return (
                <li key={url} className="settings-live-provider-card">
                  <div className="settings-live-provider-card__main">
                    <div className="settings-live-provider-card__identity">
                      <span className="settings-live-provider-card__host">{liveStreamProviderHostname(url)}</span>
                      <span className="settings-live-provider-card__url">{url}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm settings-live-provider-card__remove"
                      onClick={() => handleRemoveProvider(url)}
                      disabled={saving || testing}
                      aria-label={`Remove ${liveStreamProviderHostname(url)}`}
                    >
                      Remove
                    </button>
                  </div>
                  {probe ? (
                    <p className={`settings-live-provider-card__probe ${probe.reachable ? 'is-ok' : 'is-error'}`}>
                      {probeSummary(probe)}
                    </p>
                  ) : probeCheckedAt ? (
                    <p className="settings-live-provider-card__probe is-muted">Not tested in the latest run.</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="settings-live-add">
          <label className="settings-field-label settings-live-add__field">
            <span>Add provider URL</span>
            <input
              type="url"
              className="filter-input"
              aria-label="Add provider URL"
              placeholder="https://example.tv/"
              value={addUrlValue}
              disabled={!draft || saving || testing || providerCount >= MAX_LIVE_STREAM_PROVIDER_URLS}
              onChange={(event) => {
                setAddUrlValue(event.target.value);
                if (addUrlError) setAddUrlError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleAddProvider();
                }
              }}
            />
          </label>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddProvider} disabled={!draft || saving || testing || providerCount >= MAX_LIVE_STREAM_PROVIDER_URLS}>
            Add URL
          </button>
        </div>
        {addUrlError ? <p className="settings-live-add__error" role="alert">{addUrlError}</p> : null}
      </section>

      <details className="settings-live-advanced">
        <summary>Advanced tuning</summary>
        <div className="settings-live-grid">
          <label className="settings-field-label">
            <span>Request timeout (ms)</span>
            <input
              type="number"
              className="filter-input"
              aria-label="Request timeout"
              min={500}
              max={15000}
              step={100}
              value={draft?.timeoutMs ?? ''}
              disabled={!draft || saving || testing}
              onChange={(event) => updateDraft('timeoutMs', event.target.value)}
            />
          </label>
          <label className="settings-field-label">
            <span>Cache TTL (seconds)</span>
            <input
              type="number"
              className="filter-input"
              aria-label="Cache TTL"
              min={15}
              max={3600}
              step={15}
              value={draft?.cacheTtlSeconds ?? ''}
              disabled={!draft || saving || testing}
              onChange={(event) => updateDraft('cacheTtlSeconds', event.target.value)}
            />
          </label>
          <label className="settings-field-label">
            <span>Max matches per scan</span>
            <input
              type="number"
              className="filter-input"
              aria-label="Max matches per scan"
              min={1}
              max={100}
              step={1}
              value={draft?.maxMatches ?? ''}
              disabled={!draft || saving || testing}
              onChange={(event) => updateDraft('maxMatches', event.target.value)}
            />
          </label>
        </div>
      </details>

      <aside className="settings-live-info" aria-label="How live stream matching works">
        <h4 className="settings-live-info__title">How matching works</h4>
        <ul className="settings-live-info__list">
          <li>Only live matches visible on the current Matches page are scanned.</li>
          <li>Each provider homepage is fetched, then team names are matched against links, JSON, or grid listings.</li>
          <li>New URLs are picked up after Save; cache is cleared automatically.</li>
          <li>Sites with different HTML may need code updates to team aliases or parsers.</li>
        </ul>
      </aside>
    </div>
  );
}
