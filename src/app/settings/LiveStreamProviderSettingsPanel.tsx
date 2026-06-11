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
  type LiveStreamSource,
  type LiveStreamSourceType,
} from '@/lib/services/api';

const COUNTRY_OPTIONS = [
  { code: '*', label: 'Global (*)' },
  { code: 'VN', label: 'Vietnam (VN)' },
  { code: 'KR', label: 'South Korea (KR)' },
  { code: 'TH', label: 'Thailand (TH)' },
  { code: 'JP', label: 'Japan (JP)' },
  { code: 'SG', label: 'Singapore (SG)' },
  { code: 'US', label: 'United States (US)' },
] as const;

type LiveStreamSettingsDraft = {
  enabled: boolean;
  sources: LiveStreamSource[];
  timeoutMs: string;
  cacheTtlSeconds: string;
  maxMatches: string;
  regionFiltering: LiveStreamLocatorSettings['regionFiltering'];
};

function sourceFromUrl(url: string, index: number): LiveStreamSource {
  return {
    id: `source-${index + 1}`,
    name: liveStreamProviderHostname(url),
    url,
    countries: ['*'],
    priority: 100 + index,
    active: true,
    sourceType: 'provider_homepage',
  };
}

function draftFromLiveStreamSettings(settings: LiveStreamLocatorSettings): LiveStreamSettingsDraft {
  const sources = settings.sources?.length
    ? settings.sources
    : settings.providerUrls.map(sourceFromUrl);
  return {
    enabled: settings.enabled,
    sources: sources.map((source, index) => ({
      ...source,
      id: source.id || `source-${index + 1}`,
      countries: source.countries?.length ? source.countries : ['*'],
      priority: Number.isInteger(source.priority) ? source.priority : 100 + index,
      active: source.active !== false,
      sourceType: source.sourceType || 'provider_homepage',
    })),
    timeoutMs: String(settings.timeoutMs),
    cacheTtlSeconds: String(Math.round(settings.cacheTtlMs / 1000)),
    maxMatches: String(settings.maxMatches),
    regionFiltering: settings.regionFiltering ?? { enabled: true, unknownPolicy: 'global_only' },
  };
}

function draftsEqual(a: LiveStreamSettingsDraft | null, b: LiveStreamSettingsDraft | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeCountries(countries: string[]): string[] {
  const normalized = countries
    .map((country) => country.trim().toUpperCase())
    .filter((country) => country === '*' || /^[A-Z]{2}$/.test(country));
  const unique = [...new Set(normalized)];
  return unique.length > 1 ? unique.filter((country) => country !== '*') : unique;
}

function buildLiveStreamSettingsPayload(draft: LiveStreamSettingsDraft): { payload: LiveStreamLocatorSettings | null; error: string | null } {
  const sources: LiveStreamSource[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < draft.sources.length; index += 1) {
    const source = draft.sources[index]!;
    const normalizedUrl = normalizeLiveStreamProviderUrl(source.url);
    if (!normalizedUrl.url) {
      return { payload: null, error: normalizedUrl.error ?? `Invalid source URL: ${source.url}` };
    }
    const countries = normalizeCountries(source.countries);
    if (countries.length === 0) return { payload: null, error: 'Select at least one country for every source.' };
    const sourceType = source.sourceType;
    const priority = Number(source.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 10_000) {
      return { payload: null, error: 'Source priority must be from 0 to 10000.' };
    }
    const dedupeKey = `${normalizedUrl.url}|${[...countries].sort().join(',')}|${sourceType}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    sources.push({
      id: source.id || `source-${index + 1}`,
      name: source.name.trim() || liveStreamProviderHostname(normalizedUrl.url),
      url: normalizedUrl.url,
      countries,
      priority,
      active: source.active,
      sourceType,
      ...(source.notes?.trim() ? { notes: source.notes.trim() } : {}),
    });
  }

  if (draft.enabled && sources.length === 0) {
    return { payload: null, error: 'Add at least one source or disable lookup.' };
  }
  if (sources.length > 50) {
    return { payload: null, error: 'Live stream source list supports at most 50 entries.' };
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
      sources,
      providerUrls: [...new Set(sources.map((source) => source.url))],
      timeoutMs,
      cacheTtlMs: cacheTtlSeconds * 1000,
      maxMatches,
      regionFiltering: draft.regionFiltering,
    },
    error: null,
  };
}

function probeSummary(result: LiveStreamProviderProbeResult): string {
  if (!result.reachable) return result.error ?? 'Unreachable';
  const parsers = result.detectedParsers.length > 0 ? result.detectedParsers.join(', ') : 'no known parsers';
  return `HTTP ${result.httpStatus ?? '?'} / ${parsers} / ${result.anchorLinkCount} links`;
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

  const updateSource = useCallback((sourceId: string, patch: Partial<LiveStreamSource>) => {
    setDraft((prev) => prev ? {
      ...prev,
      sources: prev.sources.map((source) => source.id === sourceId ? { ...source, ...patch } : source),
    } : prev);
  }, []);

  const isDirty = useMemo(() => !draftsEqual(draft, savedDraft), [draft, savedDraft]);

  const handleAddSource = useCallback(() => {
    if (!draft) return;
    const normalized = normalizeLiveStreamProviderUrl(addUrlValue);
    if (!normalized.url) {
      setAddUrlError(normalized.error);
      return;
    }
    if (draft.sources.some((source) => normalizeLiveStreamProviderUrl(source.url).url === normalized.url)) {
      setAddUrlError('This source URL is already in the list.');
      return;
    }
    if (draft.sources.length >= MAX_LIVE_STREAM_PROVIDER_URLS) {
      setAddUrlError(`Quick add supports at most ${MAX_LIVE_STREAM_PROVIDER_URLS} source URLs.`);
      return;
    }
    updateDraft('sources', [...draft.sources, sourceFromUrl(normalized.url, draft.sources.length)]);
    setAddUrlValue('');
    setAddUrlError(null);
  }, [addUrlValue, draft, updateDraft]);

  const handleRemoveSource = useCallback((sourceId: string) => {
    if (!draft) return;
    const source = draft.sources.find((item) => item.id === sourceId);
    updateDraft('sources', draft.sources.filter((item) => item.id !== sourceId));
    if (source) {
      setProbeResults((prev) => {
        const next = new Map(prev);
        next.delete(source.url);
        return next;
      });
    }
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
    if (built.payload.sources.length === 0) {
      setError('Add at least one source to test.');
      return;
    }

    setTesting(true);
    setError(null);
    try {
      const response = await testLiveStreamProviders(apiConfig, built.payload.sources, built.payload.timeoutMs);
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
  const sourceCount = draft?.sources.length ?? 0;

  return (
    <div className="settings-section settings-live-panel">
      <div className="settings-live-header">
        <div>
          <h3 className="settings-live-title">Live stream lookup</h3>
          <p className="settings-live-lead">
            Scans configured live sources by viewer region, then matches team names to stream links.
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
        <span>{sourceCount} source{sourceCount === 1 ? '' : 's'}</span>
        <span aria-hidden="true">&middot;</span>
        <span>{draft?.enabled ? 'Lookup ON' : 'Lookup OFF'}</span>
        <span aria-hidden="true">&middot;</span>
        <span>{draft?.regionFiltering.enabled ? 'Region filter ON' : 'Region filter OFF'}</span>
        <span aria-hidden="true">&middot;</span>
        <span>Cache {formatLiveStreamCacheTtl(Number.isFinite(cacheTtlSeconds) ? cacheTtlSeconds : 0)}</span>
        {isDirty ? <span className="settings-live-status__dirty">Unsaved changes</span> : null}
      </div>

      {error ? <div className="settings-banner settings-banner--error" role="alert">{error}</div> : null}

      <section className="settings-live-section" aria-labelledby="settings-live-providers-heading">
        <div className="settings-live-section__header">
          <h4 id="settings-live-providers-heading" className="settings-live-section__title">Sources</h4>
          <div className="settings-live-section__actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void load(); }} disabled={loading || saving || testing}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void handleTestProviders(); }} disabled={!draft || saving || testing || sourceCount === 0}>
              {testing ? 'Testing...' : 'Test sources'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { void handleSave(); }} disabled={!draft || saving || testing || !isDirty}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {sourceCount === 0 ? (
          <div className="settings-live-empty">
            <p>No live stream sources yet. Add a homepage URL to start matching live streams.</p>
          </div>
        ) : (
          <ul className="settings-live-provider-list">
            {draft?.sources.map((source, index) => {
              const probe = probeResults.get(source.url);
              return (
                <li key={source.id} className="settings-live-provider-card">
                  <div className="settings-live-provider-card__main">
                    <div className="settings-live-provider-card__identity">
                      <input
                        className="filter-input settings-live-source-name"
                        aria-label={`Source name ${index + 1}`}
                        value={source.name}
                        disabled={saving || testing}
                        onChange={(event) => updateSource(source.id, { name: event.target.value })}
                      />
                      <span className="settings-live-provider-card__url">{liveStreamProviderHostname(source.url)}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm settings-live-provider-card__remove"
                      onClick={() => handleRemoveSource(source.id)}
                      disabled={saving || testing}
                      aria-label={`Remove ${source.name || liveStreamProviderHostname(source.url)}`}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="settings-live-source-grid">
                    <label className="settings-field-label">
                      <span>URL</span>
                      <input
                        type="url"
                        className="filter-input"
                        aria-label={`Source URL ${index + 1}`}
                        value={source.url}
                        disabled={saving || testing}
                        onChange={(event) => updateSource(source.id, { url: event.target.value })}
                      />
                    </label>
                    <label className="settings-field-label">
                      <span>Countries</span>
                      <select
                        multiple
                        className="filter-input settings-live-country-select"
                        aria-label={`Countries for ${source.name || `source ${index + 1}`}`}
                        value={source.countries}
                        disabled={saving || testing}
                        onChange={(event) => updateSource(source.id, {
                          countries: Array.from(event.currentTarget.selectedOptions).map((option) => option.value),
                        })}
                      >
                        {COUNTRY_OPTIONS.map((country) => (
                          <option key={country.code} value={country.code}>{country.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-field-label">
                      <span>Source type</span>
                      <select
                        className="filter-input"
                        aria-label={`Source type ${index + 1}`}
                        value={source.sourceType}
                        disabled={saving || testing}
                        onChange={(event) => updateSource(source.id, { sourceType: event.target.value as LiveStreamSourceType })}
                      >
                        <option value="provider_homepage">Provider homepage</option>
                        <option value="external_page">External page</option>
                        <option value="direct_hls">Direct HLS</option>
                      </select>
                    </label>
                    <label className="settings-field-label">
                      <span>Priority</span>
                      <input
                        type="number"
                        className="filter-input"
                        aria-label={`Priority ${index + 1}`}
                        min={0}
                        max={10000}
                        value={source.priority}
                        disabled={saving || testing}
                        onChange={(event) => updateSource(source.id, { priority: Number(event.target.value) })}
                      />
                    </label>
                    <label className="settings-inline-check settings-live-source-active">
                      <input
                        type="checkbox"
                        checked={source.active}
                        disabled={saving || testing}
                        onChange={(event) => updateSource(source.id, { active: event.target.checked })}
                      />
                      <span>Active</span>
                    </label>
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
            <span>Add source URL</span>
            <input
              type="url"
              className="filter-input"
              aria-label="Add source URL"
              placeholder="https://example.tv/"
              value={addUrlValue}
              disabled={!draft || saving || testing || sourceCount >= MAX_LIVE_STREAM_PROVIDER_URLS}
              onChange={(event) => {
                setAddUrlValue(event.target.value);
                if (addUrlError) setAddUrlError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleAddSource();
                }
              }}
            />
          </label>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddSource} disabled={!draft || saving || testing || sourceCount >= MAX_LIVE_STREAM_PROVIDER_URLS}>
            Add source
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
          <label className="settings-inline-check">
            <input
              type="checkbox"
              checked={draft?.regionFiltering.enabled ?? true}
              disabled={!draft || saving || testing}
              onChange={(event) => updateDraft('regionFiltering', {
                ...(draft?.regionFiltering ?? { enabled: true, unknownPolicy: 'global_only' }),
                enabled: event.target.checked,
              })}
            />
            <span>Region filtering</span>
          </label>
          <label className="settings-field-label">
            <span>Unknown region policy</span>
            <select
              className="filter-input"
              aria-label="Unknown region policy"
              value={draft?.regionFiltering.unknownPolicy ?? 'global_only'}
              disabled={!draft || saving || testing}
              onChange={(event) => updateDraft('regionFiltering', {
                ...(draft?.regionFiltering ?? { enabled: true, unknownPolicy: 'global_only' }),
                unknownPolicy: event.target.value as LiveStreamLocatorSettings['regionFiltering']['unknownPolicy'],
              })}
            >
              <option value="global_only">Global only</option>
              <option value="hide_all">Hide all</option>
              <option value="allow_all">Allow all</option>
            </select>
          </label>
        </div>
      </details>

      <aside className="settings-live-info" aria-label="How live stream matching works">
        <h4 className="settings-live-info__title">How matching works</h4>
        <ul className="settings-live-info__list">
          <li>Backend resolves the viewer country and filters sources before scanning.</li>
          <li>Country codes use ISO format; Global (*) is the fallback source group.</li>
          <li>New sources are picked up after Save; cache is cleared automatically.</li>
          <li>Only sources that TFI may display for the selected country should be configured.</li>
        </ul>
      </aside>
    </div>
  );
}
