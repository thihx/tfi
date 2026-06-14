# Sportmonks Provider Fusion POC Design

**Status:** Implemented through controlled provider-2 stats/events fallback; odds/xG/predictions remain disabled
**Updated:** 2026-06-12
**Scope:** POC them Sportmonks vao TFI nhu provider thu 2 de danh gia chat luong du lieu, coverage, freshness, cost, va kha nang mo rong multi-provider truoc khi cho phep anh huong live recommendation production.

## 1. Ly do

Van de can giai khong phai chi la "API-Football thieu live odds". Van de lon hon la live recommendation hien dang bi phu thuoc vao mot provider cho cac input money-critical:

- fixture identity, status, minute, score;
- events: goal, card, substitution, penalty, VAR;
- fixture statistics: shots, shots on target, corners, possession, fouls, cards;
- live odds va prematch/reference odds;
- lineups/standings/scout context;
- provider freshness, quota, va clock lag.

Khi mot provider tra rong, stale, clock lag, hoac coverage khong nhu ky vong, pipeline co the bi degrade/no-action du provider khac co du data hon. Nguoc lai, neu them provider moi sai cach, he thong co the hop nhat du lieu tuy tien, lam LLM ao tuong va save recommendation tren du lieu conflict.

Muc tieu cua POC nay la xay **provider reliability architecture**, khong phai chi them mot API fallback.

## 2. Nguon tham chieu Sportmonks

Thong tin duoi day la can cu thiet ke, da doi chieu voi API smoke test va email Sportmonks ngay 2026-06-12:

- Sportmonks pricing cong khai: trial 14 ngay, Starter/Growth/Pro theo so league va API calls per entity per hour; Enterprise cho all 2300+ leagues va capacity cao hon. See <https://www.sportmonks.com/football-api/plans-pricing/>.
- Sportmonks noi all plans co cung professional-grade data features; khac nhau chu yeu o so leagues va API call capacity. Same source.
- Fixtures/livescores/statistics/events/lineups/standings la first-class football data; pricing page liet ke fixtures, live scores, match events, standings, season statistics, detailed match statistics, lineups. Same source.
- World Cup 2026 khong nam trong standard trial. Sportmonks xac nhan World Cup data can World Cup special package va khong co trial period.
- World Cup special core data gom fixtures, live scores, match results, standings, related team/player statistics, tournament progression.
- Odds, xG, predictions can All-in package/add-on. Do do TFI khong duoc bat `SPORTMONKS_ALLOW_ODDS_FALLBACK` cho production khi chua co entitlement that.
- World Cup special co 2,500 API calls per entity per hour theo email Sportmonks. Cost routing phai van theo call budget/job budget, khong duoc polling tran lan.
- Sportmonks API 3.0 ho tro `include` de enrich response va tranh nhieu API calls rieng le. See <https://docs.sportmonks.com/v3/api/request-options/includes>.
- Fixture statistics co the lay qua fixture endpoint voi `include=statistics`; doc noi match statistics included in base plans, advanced metrics nhu xG/Pressure Index can add-on. See <https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/statistics/fixture-statistics>.
- `inplayOdds`/premium odds must be treated as entitlement-gated. Phase 1 script defaults to no in-play odds include; use `--include-inplay-odds` only after the account is confirmed to have access.
- Livescores latest endpoint tra fixtures co update trong 10 giay gan nhat; co the dung lam trigger/polling source. See <https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/livescores/get-latest-updated-livescores>.
- Sportmonks best practices khuyen nghi throttle, handle 429, log request metadata, cache entities, dung filters/includes can than. See <https://docs.sportmonks.com/v3/welcome/best-practices>.

## 3. Current-state inventory trong TFI

### 3.1 Provider boundary hien tai

`packages/server/src/lib/football-api.ts` la boundary duy nhat cho outbound API-Football. Module nay:

- dung `config.footballApiBaseUrl`, default `https://v3.football.api-sports.io`;
- gui header `x-apisports-key`;
- co timeout 15s, retry 2 lan;
- co daily limit/circuit breaker qua `football-api-circuit.ts` va `football-api-quota.ts`;
- log request vao `api_football_request_ledger`;
- expose API-Football-shaped functions:
  - `fetchFixturesByIds`
  - `fetchLiveOdds`
  - `fetchPreMatchOdds`
  - `fetchFixtureEvents`
  - `fetchFixtureStatistics`
  - `fetchFixtureLineups`
  - `fetchStandings`
  - league/team helpers.

He thong hien tai dung provider-neutral wording o mot so noi, nhung type va response shape van la API-Football.

### 3.2 Cache/insight layer hien tai

`packages/server/src/lib/provider-insight-cache.ts` la cache boundary cho fixture/stats/events/lineups/standings. No dung cac repo:

- `provider_fixture_cache`
- `provider_fixture_stats_cache`
- `provider_fixture_events_cache`
- `provider_fixture_lineups_cache`
- `provider_league_standings_cache`

Gioi han thiet ke hien tai:

- cac cache table key theo `match_id`, chua co `provider`;
- payload la API-Football shape;
- update se overwrite canonical cache row cua match;
- TTL/freshness co san (`fresh`, `stale_ok`, `stale_degraded`, `missing`), nhung freshness la cho mot provider duy nhat;
- `ensureMatchInsight` tra `MatchInsightResult` gom fixture/statistics/events, chua co field-level provenance.

### 3.3 Odds resolver hien tai

`packages/server/src/lib/odds-resolver.ts`:

- goi `fetchLiveOdds` truoc cho live status;
- neu live odds missing trong `real_required`, co the fetch prematch odds de gan `referenceResponse`, nhung `oddsSource` van `none`;
- ghi `provider_odds_cache`, `provider_odds_samples`;
- `provider_source` co gia tri nhu `api-football-live`, `api-football-prematch`, `none`;
- cache key van theo `match_id`, khong support nhieu provider song song;
- sample provider hien tai hard-code `api-football` hoac `resolver`.

Gan day pipeline da co stats-only AI advisory khi live odds missing, nhung day chi giam im lang; no khong giai quyet du lieu provider missing/conflict.

### 3.4 Recommendation pipeline hien tai

`packages/server/src/lib/server-pipeline.ts` hien:

- load fixture tu `ensureFixturesForMatchIds`;
- load stats/events qua `ensureMatchInsight`;
- build `statsCompact` bang `buildStatsCompact`;
- build `eventsCompact` bang `buildEventsCompact`;
- `type StatsSource = 'api-football'`;
- `buildProviderHealthSnapshot` chi danh gia mot provider;
- `classifyLiveEvidence` chi nhin `statsAvailable`, `oddsAvailable`, `eventCount`;
- `providerCoverageStatus` hien co cac trang thai nhu `full`, `no_live_stats`, `clock_lag`, `clock_lag_no_live_stats`, `provider_unavailable`;
- prompt nhan `providerHealth`, `providerWarnings`, `providerClockLagMinutes`, `providerCoverageStatus`;
- snapshot luu vao `match_snapshots` gom stats/events/odds canonical, nhung chua luu provider provenance.

Gioi han quan trong:

- pipeline chua co khainiem score consensus;
- chua co field-level source cho score/minute/events/statistics/odds;
- neu API-Football stats empty, pipeline chi co the degrade theo providerHealth, khong co provider khac de thay the;
- neu odds tu provider khac nhung score/minute tu API-Football stale, chua co fusion guard de prevent bad save.

### 3.5 Jobs/routes hien tai

`refresh-live-matches.job.ts`:

- refresh live/near-live fixture rows qua `ensureFixturesForMatchIds`;
- refresh stats cho watched live fixtures qua `ensureFixtureStatistics`;
- update `matches` rows bang API-Football fixture shape.

`refresh-provider-insights.job.ts`:

- prewarm watched non-live insight;
- dung API-Football quota budget;
- bo qua live candidates.

`proxy.routes.ts`:

- browser dung backend routes, khong call provider truc tiep;
- `/api/proxy/football/live-fixtures` goi `ensureFixturesForMatchIds`;
- `/api/proxy/football/odds` goi `resolveMatchOdds`;
- `/api/proxy/football/scout` goi `ensureScoutInsight`.

POC Sportmonks phai giu rule nay: browser khong goi Sportmonks truc tiep.

### 3.6 Observability/co so du lieu san co

San co:

- `provider_stats_samples`
- `provider_odds_samples`
- `api_football_request_ledger`
- `league_provider_coverage` columns tren `leagues`
- `league_provider_coverage_history`
- ops monitoring da doc provider samples de tinh coverage.

Can mo rong:

- generic request ledger cho nhieu provider, hoac them `provider` vao ledger moi;
- provider-specific shadow cache hoac cache key co `provider`;
- provider fixture mapping table;
- fusion snapshot/audit payload.

## 4. Nguyen tac thiet ke

1. **Provider moi khong duoc lam vo runtime cu.** Phase dau la shadow-only.
2. **Khong merge du lieu mieu ta.** Moi field canonical phai co provider provenance.
3. **Conflict thi conservative.** Score/minute/event conflict phai downgrade, khong save money recommendation.
4. **Cost-aware by design.** Goi Sportmonks theo tier, subscriber interest, va provider gap, khong goi moi fixture moi tick.
5. **Adapter plugin-first.** API-Football va Sportmonks deu la adapters sau cung mot interface.
6. **Canonical shape truoc prompt.** Prompt/policy khong nen biet provider raw shape.
7. **POC do chat luong du lieu truoc khi fallback.** Khong bat production fallback cho den khi co shadow metrics.

## 5. Target architecture

```text
API-Football Adapter
Sportmonks Adapter
Future Provider Adapter
        |
        v
Provider Orchestrator
        |
        v
Provider Fusion Snapshot Builder
        |
        v
Canonical Live Snapshot
        |
        v
Evidence Mode -> Prompt -> Policy -> Save/Push
```

### 5.1 Provider roles

Moi adapter khai bao supported roles:

```ts
type ProviderRole =
  | 'fixture_identity'
  | 'fixture_score'
  | 'event_timeline'
  | 'fixture_statistics'
  | 'lineups'
  | 'live_odds'
  | 'reference_odds'
  | 'standings'
  | 'league_coverage';
```

POC Sportmonks target roles:

- `fixture_identity`
- `fixture_score`
- `event_timeline`
- `fixture_statistics`
- `lineups`
- `standings`
- `live_odds` / `reference_odds` only as measured POC first, not production canonical at phase 1.

### 5.2 Adapter interface

```ts
interface FootballDataProvider {
  id: 'api-football' | 'sportmonks' | string;
  displayName: string;
  roles: ProviderRole[];
  costTier: 'low' | 'medium' | 'high' | 'enterprise';

  getFixtureByProviderId(providerFixtureId: string): Promise<ProviderFixtureEnvelope>;
  findFixtures(input: ProviderFixtureSearchInput): Promise<ProviderFixtureEnvelope[]>;
  getLiveUpdatedFixtures?(input: ProviderLiveUpdateInput): Promise<ProviderFixtureEnvelope[]>;
  getFixtureEvents(providerFixtureId: string): Promise<ProviderEventsEnvelope>;
  getFixtureStatistics(providerFixtureId: string): Promise<ProviderStatisticsEnvelope>;
  getFixtureLineups?(providerFixtureId: string): Promise<ProviderLineupsEnvelope>;
  getLiveOdds?(providerFixtureId: string): Promise<ProviderOddsEnvelope>;
  getPreMatchOdds?(providerFixtureId: string): Promise<ProviderOddsEnvelope>;
  getLeagueCoverage?(providerLeagueId: string, season: string): Promise<ProviderLeagueCoverageEnvelope>;
  getHealth(): Promise<ProviderHealth>;
}
```

Moi method tra envelope gom:

```ts
interface ProviderEnvelope<T> {
  provider: string;
  providerFixtureId?: string;
  fetchedAt: string;
  latencyMs: number;
  success: boolean;
  statusCode: number | null;
  raw: unknown;
  normalized: T | null;
  coverage: ProviderCoverageFlags;
  error: string;
  quota: ProviderQuotaState;
}
```

### 5.3 Provider-neutral normalized shapes

Adapter khong duoc de raw Sportmonks/API-Football shape leak vao pipeline. Normalize ve:

```ts
interface NormalizedFixture {
  providerFixtureId: string;
  status: string;
  minute: number | null;
  score: { home: number | null; away: number | null };
  kickoffAtUtc: string | null;
  periodStartUtc?: string | null;
  league: ProviderLeagueRef;
  home: ProviderTeamRef;
  away: ProviderTeamRef;
}

interface NormalizedEvent {
  minute: number | null;
  extra: number | null;
  teamSide: 'home' | 'away' | 'unknown';
  teamName: string;
  type: 'goal' | 'card' | 'substitution' | 'penalty' | 'var' | 'other';
  detail: string;
  playerName?: string | null;
}

interface NormalizedStatistics {
  possession?: SideValue;
  shots?: SideValue;
  shots_on_target?: SideValue;
  corners?: SideValue;
  fouls?: SideValue;
  yellow_cards?: SideValue;
  red_cards?: SideValue;
  expected_goals?: SideValue;
  rawTypeMap?: Record<string, unknown>;
}
```

### 5.4 Provider fixture mapping

TFI `match_id` hien la API-Football fixture id. Sportmonks co fixture id rieng, nen can mapping:

```sql
provider_fixture_mappings (
  id bigserial primary key,
  tfi_match_id text not null,
  provider text not null,
  provider_fixture_id text not null,
  provider_league_id text,
  provider_season_id text,
  provider_home_team_id text,
  provider_away_team_id text,
  mapping_method text not null, -- exact_id, kickoff_team_fuzzy, manual, imported
  confidence numeric(5,2) not null,
  verified boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw_match jsonb not null default '{}'::jsonb,
  unique(provider, provider_fixture_id),
  unique(tfi_match_id, provider)
)
```

Mapping heuristic:

1. Same date/kickoff within tolerance, same league if mapped.
2. Team name similarity home/away, including aliases.
3. Score/status cross-check once live.
4. Manual override for high-value fixtures.

Hard rule: no production fallback when mapping confidence below threshold.

## 6. POC architecture

### Phase 0: Design only

Deliverables:

- this document;
- implementation checklist;
- no runtime behavior change.

### Phase 1: Sportmonks shadow adapter

Status: implemented.

Add:

- `packages/server/src/lib/providers/sportmonks-api.ts`
- `packages/server/src/lib/providers/football-provider.types.ts`
- config keys:
  - `SPORTMONKS_ENABLED=false`
  - `SPORTMONKS_API_TOKEN`
  - `SPORTMONKS_BASE_URL=https://api.sportmonks.com/v3/football` (`SPORTMONKS_API_BASE_URL` is accepted as an alias)
  - `SPORTMONKS_SHADOW_ENABLED=false`
  - `SPORTMONKS_MAX_CALLS_PER_RUN` / `SPORTMONKS_SHADOW_MAX_CALLS_PER_RUN`
  - `SPORTMONKS_PRIORITY_LEAGUE_IDS`

Do not change `server-pipeline.ts` decision inputs yet.

### Phase 2: Generic provider observability

Status: implemented for Sportmonks POC.

Add generic request ledger:

```sql
provider_request_ledger (
  id bigserial primary key,
  provider text not null,
  job_name text,
  consumer text,
  endpoint text not null,
  params jsonb not null default '{}'::jsonb,
  attempt int not null default 1,
  success boolean not null,
  status_code int,
  latency_ms int,
  result_count int,
  quota_current int,
  quota_limit int,
  rate_limited boolean not null default false,
  error text not null default '',
  requested_at timestamptz not null default now()
)
```

Keep `api_football_request_ledger` for compatibility, but new providers use generic ledger. Later API-Football can dual-write.

Add shadow sample tables or extend sample rows:

- current `provider_stats_samples` and `provider_odds_samples` already have `provider`, good enough for POC stats/odds;
- add `provider_fixture_samples` / `provider_event_samples` if we want score/event lag metrics without overloading stats samples.

### Phase 3: Shadow benchmark job

Status: implemented as manual/operator script; scheduler flag is documented but remains disabled by default.

Add job disabled by default:

```text
JOB_SPORTMONKS_SHADOW_POC_MS=0
SPORTMONKS_POC_MAX_MATCHES_PER_RUN=10
SPORTMONKS_POC_MAX_CALLS_PER_RUN=30
```

Candidate selection:

1. active watchlist live matches;
2. high-subscriber matches;
3. priority leagues/tournaments;
4. recent matches where API-Football provider health is degraded;
5. manual fixture list for World Cup/key games.

Shadow job records:

- fixture match result and mapping confidence;
- score/minute/status comparison;
- events coverage and lag;
- stats coverage;
- lineups availability;
- odds coverage if enabled;
- latency;
- quota/cost counters.

No prompt, no recommendation save, no user notification from shadow job.

### Phase 4: Fusion snapshot builder shadow-only

Status: partially implemented as pipeline `providerFusion` audit metadata for stats/events provenance.

Add:

```ts
buildLiveProviderFusionSnapshot(matchId, options): Promise<LiveProviderFusionSnapshot>
```

In shadow-only phase:

- call current API-Football path as normal;
- call Sportmonks for POC candidates;
- produce `providerFusion` object;
- audit it in pipeline metadata or dedicated `provider_fusion_snapshots`;
- do not change `statsCompact`, `eventsCompact`, `oddsCanonical`, or evidence mode.

### Phase 5: Controlled stats/events fallback

Status: implemented behind kill-switch flags:

```text
SPORTMONKS_ENABLED=true
SPORTMONKS_ALLOW_STATS_FALLBACK=true
SPORTMONKS_ALLOW_EVENTS_FALLBACK=true
SPORTMONKS_ALLOW_ODDS_FALLBACK=false
```

Current behavior:

- TFI continues to use API-Football as default fixture/score/minute provider.
- Sportmonks is called only when the API-Football stats/events payload is empty/missing.
- Existing non-empty API-Football stats/events are not overwritten.
- Sportmonks data is accepted only after fixture mapping by provider mapping table or date/team/kickoff heuristic.
- Score conflict between API-Football and Sportmonks hard-blocks the supplement.
- Accepted stats/events are written into the existing provider insight caches in API-Football-compatible shape, with `coverage_flags.provider=sportmonks`, mapping metadata, and `fallback_from=api-football`.
- `server-pipeline.ts` emits `providerFusion` metadata so audit rows can show whether statistics/events came from `api-football`, `sportmonks`, or mixed source.
- This phase does not save recommendations only because Sportmonks exists; normal odds, evidence, market, policy, dedupe, and save guards still apply.

Only after shadow gates pass:

- if API-Football stats empty/missing and Sportmonks stats complete/partial;
- if score/minute consensus is agree or single trusted source with low lag;
- if mapping confidence is high;
- use Sportmonks statistics as canonical field source.

No live odds fallback yet.

### Phase 6: Controlled odds fallback

Only after stats/events fallback stable:

- use Sportmonks live odds only if canonical score/minute/events are fresh;
- market normalization must pass existing `buildOddsCanonical` / `normalizeMarket` gates;
- prematch/reference odds remain reference only;
- provider source must be stored in odds snapshot and audit.

## 7. Fusion rules

### 7.1 Field source selection

For each field:

```text
score/minute/status: prefer provider with fresh fixture, low clock lag, score-event consistency.
events: prefer provider with recent timeline, goal count matching score, card/substitution detail.
statistics: prefer provider with both teams and meaningful tracked stat pairs.
odds: prefer live odds with current score/minute context and canonical market coverage.
lineups: prefer confirmed lineups; use probable/expected only as prematch context, not live certainty.
```

### 7.2 Hard downgrades

Money recommendation cannot save when:

- score conflict between providers;
- minute conflict over threshold;
- Sportmonks/API-Football mapping confidence below threshold;
- events do not reconcile with score and no provider explicitly marks events partial;
- odds provider has live odds but score/minute source is stale;
- provider quota/circuit is critical and only stale cache remains.

### 7.3 Evidence mode mapping

Fusion evidence mode should replace current simple classifier eventually:

```text
full_live_data:
  fresh score/minute, usable events, complete/partial stats, tradable live odds.

stats_only:
  fresh score/minute, usable events, complete/partial stats, no tradable live odds.

odds_events_only_degraded:
  fresh score/minute/events/live odds, stats missing from all trusted providers.

events_only_degraded:
  fresh score/minute/events, no stats, no live odds.

low_evidence:
  conflict/stale/mapping low confidence/no meaningful event context.
```

## 8. Cost routing

Do not call Sportmonks for every match.

### Match tiers

```text
Tier A: World Cup, UCL, EPL, major subscribed matches
  - call API-Football + Sportmonks during live window.

Tier B: watched match with user/subscriber interest
  - call Sportmonks only when API-Football missing/degraded OR on slower audit cadence.

Tier C: public board/no subscriber
  - API-Football only unless manually sampled for benchmark.

Tier D: manual Ask AI/high-value operator check
  - allow on-demand Sportmonks enrichment with explicit audit.
```

### Request budget

Implement separate buckets:

- API-Football daily budget remains existing.
- Sportmonks hourly/entity budget:
  - one bucket per endpoint/entity group;
  - max calls per job run;
  - max calls per match per minute bucket;
  - circuit on repeated 429/5xx.

Use Sportmonks `include` carefully:

- good for fixture by id with `include=events,statistics,lineups` when a match is high priority;
- avoid heavy includes for broad polling;
- cache static entities like states/types/teams to reduce payload.

## 9. POC measurement matrix

Run for at least:

- World Cup / international;
- top club leagues;
- lower-tier leagues already in watchlist;
- matches where API-Football returned stats empty;
- matches where API-Football live odds empty;
- matches where clock lag was detected.

Per match metrics:

```text
mapping_success
mapping_confidence
score_agreement
minute_lag_api_football
minute_lag_sportmonks
event_count_api_football
event_count_sportmonks
goal_event_score_consistency
stats_team_count
stats_pair_count
stats_key_presence: shots, sot, corners, possession, cards, xg
lineups_available
live_odds_available
canonical_market_count
latency_ms_by_provider
calls_used_by_provider
cost_estimate
conflict_count
would_upgrade_evidence_mode
would_enable_money_path
would_only_enable_stats_only_advisory
```

## 10. Acceptance gates

Sportmonks may move from shadow to controlled fallback only if:

- mapping success >= 95% on priority fixtures;
- score conflict <= 1% on live priority fixtures, and every conflict downgrades no-save;
- stats coverage improves API-Football missing/empty cases by a material margin;
- event timeline matches score for high-priority fixtures;
- latency stays within live pipeline budget;
- no uncontrolled quota spikes;
- no frontend/browser direct provider access;
- audit metadata is sufficient to explain every field source.

Suggested first POC target:

```text
50-100 fixtures
7-14 days
shadow-only
no production decision impact
daily POC report
```

## 11. Implementation checklist

### Docs/config

- Add env examples for Sportmonks token and shadow flags.
- Add provider POC runbook.
- Update `live-data-provider-fusion-contract-vi.md` after POC design is accepted.

### Code

- Add provider-neutral types.
- Add Sportmonks API client.
- Add generic provider request ledger.
- Add provider fixture mapping repo/table.
- Add Sportmonks normalization functions.
- Add shadow POC job.
- Add provider fusion snapshot builder.
- Add POC report script.

### Tests

- Unit: Sportmonks fixture normalization.
- Unit: Sportmonks stats normalization.
- Unit: mapping confidence.
- Unit: fusion consensus and hard downgrade.
- Unit: cost routing/budget.
- Integration: shadow job writes samples and never changes recommendation decision.
- Regression: score conflict prevents saved recommendation.
- Regression: stats fallback cannot turn prematch odds into live odds.

## 12. Production rollout rules

Rollout must be feature-flagged:

```text
PROVIDER_FUSION_ENABLED=false
PROVIDER_FUSION_SHADOW_ONLY=true
SPORTMONKS_ENABLED=false
SPORTMONKS_SHADOW_ENABLED=false
SPORTMONKS_ALLOW_STATS_FALLBACK=false
SPORTMONKS_ALLOW_EVENTS_FALLBACK=false
SPORTMONKS_ALLOW_ODDS_FALLBACK=false
```

Promotion order:

1. Shadow-only sample.
2. Canonical fusion audit only.
3. Stats fallback for no-save/watch-only outputs.
4. Stats/events fallback for recommendation prompt, still no odds fallback.
5. Live odds fallback after market-normalization and consensus gates.
6. Broader league tiers after cost/coverage report.

## 13. Open questions

- Sportmonks plan: Starter/Growth/Pro/Enterprise?
- Selected POC leagues: World Cup only first, or World Cup + top club leagues?
- Do we buy Odds & Predictions / Premium Odds add-on during POC, or only test base inplay odds availability first?
- Should xG/Pressure Index be considered in phase 1, or later advanced-data phase?
- What is the max acceptable monthly provider spend for the first production fallback?

## 14. Recommended next step

Implement Phase 1-3 only:

```text
Sportmonks shadow adapter + fixture mapping + shadow benchmark job + POC report.
```

Do not wire Sportmonks into `server-pipeline.ts` decision inputs until the shadow report proves:

- mapping is reliable;
- data coverage materially improves current API-Football gaps;
- conflict handling works;
- cost is predictable.
