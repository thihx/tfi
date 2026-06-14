# Multi-Provider Architecture Contract

**Status:** Implementation contract for provider-agnostic migration
**Updated:** 2026-06-13
**Scope:** Chuyen TFI tu kien truc phu thuoc API-Football shape sang provider-agnostic, fusion-first architecture cho live recommendation, watch insights, stats-only signals, odds, va audit.

## 1. Executive Decision

TFI se khong xem bat ky provider nao la canonical truth vinh vien. API-Football, Sportmonks, va cac provider tuong lai chi la data sources sau adapter. TFI phai so huu canonical domain contract cua rieng minh.

Target flow:

```text
Provider raw data
  -> Provider Adapter
  -> TFI Canonical Domain Model
  -> Provider Fusion Snapshot
  -> Evidence Mode
  -> Recommendation Pipeline
  -> Save / Push / Audit
```

Current transition state:

```text
API-Football shape
  -> existing provider cache / odds resolver
  -> server-pipeline

Sportmonks raw
  -> Sportmonks normalizer
  -> API-Football-compatible stats/events fallback
  -> server-pipeline
```

This contract defines the migration path from the transition state to the target state.

## 2. Non-Negotiable Principles

1. **No provider raw schema in the pipeline.**
   `server-pipeline.ts`, prompt builders, policy, and save logic must consume TFI canonical objects or fusion snapshots only.

2. **Every field has provenance.**
   Score, minute, events, statistics, odds, lineups, and standings must record provider source, fetched time, freshness, coverage, confidence, and warnings.

3. **Conflict is conservative.**
   Score conflict, severe minute conflict, low-confidence fixture mapping, stale live odds, or missing odds provenance must downgrade evidence and block money save.

4. **Provider count does not relax policy.**
   Adding Sportmonks or another provider can improve evidence quality, but cannot bypass market normalization, odds guards, evidence allowlist, recommendation policy, dedupe, bankroll, or delivery guards.

5. **Cost is a first-class architecture dimension.**
   Orchestration must consider subscriber interest, match tier, provider health, quota, and endpoint cost before calling secondary providers.

6. **Shadow before promotion.**
   New canonical/fusion behavior must be observable in shadow mode before it changes production recommendation inputs.

7. **Coverage gates are mandatory.**
   Each phase must include tests. New provider/fusion modules must meet coverage targets before phase completion.

## 3. Coverage And Test Contract

User intent is treated as **90-95% coverage**:

- Minimum for new provider architecture modules: **90% line coverage and 90% branch coverage**.
- Money-critical modules: **95% line coverage and 95% branch coverage**.
- Money-critical modules include:
  - fixture mapping confidence;
  - provider source selection;
  - score/minute/event consensus;
  - odds canonicalization and odds source selection;
  - evidence mode downgrade;
  - save/push eligibility gates affected by fusion.

Backend currently has strong unit tests but no dedicated server coverage gate in `packages/server/package.json`. Phase 0/1 must add coverage tooling before code promotion:

```text
packages/server:
  test:coverage
  test:coverage:provider-fusion
  check:coverage:provider-fusion
```

Allowed implementation options:

- Vitest coverage with `@vitest/coverage-v8`;
- targeted coverage include patterns for provider architecture modules;
- CI gate that fails if thresholds are below this contract.

Coverage should focus on new code, not forcing all historical server code to immediately reach 90%.

Suggested coverage include patterns:

```text
src/lib/providers/**/*.ts
src/lib/provider-fusion/**/*.ts
src/lib/canonical/**/*.ts
src/repos/provider-*.repo.ts
src/scripts/run-provider-fusion-shadow*.ts
```

Minimum verification for every phase:

```powershell
npm run typecheck --prefix packages/server
npm run test --prefix packages/server
npm run data-driven:verify-gates-ci --prefix packages/server
npm run test:coverage:provider-fusion --prefix packages/server
npm run check:coverage:provider-fusion --prefix packages/server
```

If a phase does not yet touch data-driven behavior, `data-driven:verify-gates-ci` still runs as regression protection.

## 4. Canonical Domain Contract

Provider adapters must normalize raw responses into TFI-owned objects. These names are contractual; exact file placement can vary, but the types must not depend on API-Football or Sportmonks raw shape.

### 4.1 Provider Identity

```ts
type ProviderId = 'api-football' | 'sportmonks' | string;

type ProviderRole =
  | 'fixture_identity'
  | 'fixture_score'
  | 'event_timeline'
  | 'fixture_statistics'
  | 'live_odds'
  | 'reference_odds'
  | 'lineups'
  | 'standings'
  | 'league_coverage'
  | 'xg'
  | 'predictions';
```

### 4.2 Provider Envelope

All adapter methods must return an envelope, not a naked payload.

```ts
interface ProviderEnvelope<T> {
  provider: ProviderId;
  role: ProviderRole;
  providerFixtureId?: string | null;
  matchId?: string | null;
  fetchedAt: string;
  latencyMs: number | null;
  success: boolean;
  statusCode: number | null;
  raw: unknown;
  normalized: T | null;
  coverage: ProviderCoverageFlags;
  freshness: ProviderFreshnessState;
  quota: ProviderQuotaState;
  error: string;
  warnings: string[];
}
```

Rules:

- `raw` can be stored for audit/sample tables but must not flow into prompt/policy.
- `normalized=null` with `success=true` is allowed when provider returned a valid empty response.
- Empty response is not the same as fetch error.
- Tokens, auth headers, and secret query params must be redacted before ledger/sample storage.

### 4.3 Provider Health

```ts
type ProviderQuotaState = 'ok' | 'elevated' | 'high' | 'critical' | 'daily_limit' | 'hourly_limit' | 'unknown';
type ProviderFreshnessState = 'fresh' | 'stale' | 'missing' | 'conflicted' | 'unknown';
type ProviderCoverageLevel = 'complete' | 'partial' | 'empty' | 'missing' | 'unknown';
type ProviderReliability = 'good' | 'degraded' | 'bad' | 'unknown';

interface ProviderHealth {
  provider: ProviderId;
  roles: ProviderRole[];
  reachable: boolean;
  lastFetchedAt: string | null;
  statusCode: number | null;
  quotaState: ProviderQuotaState;
  latencyMs: number | null;
  reliability: ProviderReliability;
  warnings: string[];
}
```

### 4.4 Canonical Fixture And Clock

```ts
interface CanonicalFixtureIdentity {
  matchId: string;
  providerFixtureIds: Record<ProviderId, string>;
  kickoffAtUtc: string | null;
  league: CanonicalLeagueRef;
  home: CanonicalTeamRef;
  away: CanonicalTeamRef;
  mappingConfidence: 'verified' | 'high' | 'medium' | 'low' | 'unknown';
}

interface CanonicalScoreClock {
  status: string;
  minute: number | null;
  injuryTime: number | null;
  period: 'pre' | '1h' | 'ht' | '2h' | 'et' | 'pen' | 'ft' | 'unknown';
  score: { home: number | null; away: number | null };
  wallClockMinuteEstimate: number | null;
  providerClockLagMinutes: number | null;
}
```

### 4.5 Canonical Events

```ts
type CanonicalEventType =
  | 'goal'
  | 'card'
  | 'substitution'
  | 'penalty'
  | 'var'
  | 'period'
  | 'other';

interface CanonicalMatchEvent {
  minute: number | null;
  extra: number | null;
  teamSide: 'home' | 'away' | 'unknown';
  team: CanonicalTeamRef | null;
  playerName: string | null;
  assistName: string | null;
  type: CanonicalEventType;
  detail: string;
  sourceEventId?: string | null;
}
```

Rules:

- Goal timeline must reconcile with canonical score where provider coverage claims complete event timeline.
- If score is 2-1 and goal events are missing, event source coverage is `partial`, `empty`, or `missing`, not `complete`.

### 4.6 Canonical Statistics

```ts
interface CanonicalSideValue<T = number | string | null> {
  home: T;
  away: T;
}

interface CanonicalTeamStatistics {
  possessionPct?: CanonicalSideValue<number | null>;
  shotsTotal?: CanonicalSideValue<number | null>;
  shotsOnTarget?: CanonicalSideValue<number | null>;
  corners?: CanonicalSideValue<number | null>;
  fouls?: CanonicalSideValue<number | null>;
  yellowCards?: CanonicalSideValue<number | null>;
  redCards?: CanonicalSideValue<number | null>;
  expectedGoals?: CanonicalSideValue<number | null>;
  passes?: CanonicalSideValue<number | null>;
  attacks?: CanonicalSideValue<number | null>;
  dangerousAttacks?: CanonicalSideValue<number | null>;
  rawTypeMap: Record<string, unknown>;
}
```

Rules:

- Provider-specific names like `Shots on Goal`, `Shots on target`, or `On Target` must map to canonical `shotsOnTarget`.
- Unknown statistics must go into `rawTypeMap`; they must not silently disappear.
- xG requires provider entitlement and must carry explicit source.

### 4.7 Canonical Odds

```ts
type CanonicalOddsKind = 'live' | 'reference' | 'prematch' | 'unknown';

interface CanonicalOddsSelection {
  market: string;
  selection: string;
  line: number | null;
  price: number;
  bookmaker: string | null;
  provider: ProviderId;
  kind: CanonicalOddsKind;
  fetchedAt: string;
  suspended: boolean;
}

interface CanonicalOddsSnapshot {
  matchId: string;
  generatedAt: string;
  selections: CanonicalOddsSelection[];
  sourceProvider: ProviderId | null;
  sourceKind: CanonicalOddsKind;
  warnings: string[];
}
```

Rules:

- Prematch/reference odds must never be treated as tradable live odds.
- Odds without provider, bookmaker/source, fetchedAt, price, and market identity are not actionable.
- If odds are fresh but score/minute source is stale or conflicted, evidence must downgrade.

## 5. Adapter Plugin Contract

Each provider adapter must declare capabilities and return envelopes.

```ts
interface FootballDataProvider {
  id: ProviderId;
  displayName: string;
  roles: ProviderRole[];
  costTier: 'low' | 'medium' | 'high' | 'enterprise';

  getFixtureByProviderId?(providerFixtureId: string): Promise<ProviderEnvelope<CanonicalFixtureIdentity>>;
  findFixtures?(input: ProviderFixtureSearchInput): Promise<ProviderEnvelope<CanonicalFixtureIdentity[]>>;
  getLiveUpdatedFixtures?(input: ProviderLiveUpdateInput): Promise<ProviderEnvelope<CanonicalFixtureIdentity[]>>;
  getScoreClock?(input: ProviderFixtureRef): Promise<ProviderEnvelope<CanonicalScoreClock>>;
  getEvents?(input: ProviderFixtureRef): Promise<ProviderEnvelope<CanonicalMatchEvent[]>>;
  getStatistics?(input: ProviderFixtureRef): Promise<ProviderEnvelope<CanonicalTeamStatistics>>;
  getLiveOdds?(input: ProviderFixtureRef): Promise<ProviderEnvelope<CanonicalOddsSnapshot>>;
  getReferenceOdds?(input: ProviderFixtureRef): Promise<ProviderEnvelope<CanonicalOddsSnapshot>>;
  getHealth(): Promise<ProviderHealth>;
}
```

Adapter rules:

- Must not import `server-pipeline.ts`.
- Must not call LLM.
- Must not save recommendations or stage notifications.
- Must redact credentials in logs and ledgers.
- Must handle 401/403 entitlement errors as provider capability/entitlement warnings.
- Must return valid empty coverage for successful empty provider responses.
- Must write request telemetry through generic provider request ledger.

## 6. Fixture Mapping Contract

TFI match id may remain API-Football fixture id during migration, but provider mapping is mandatory for every non-API-Football provider.

Mapping row must include:

```text
match_id
provider
provider_fixture_id
confidence
mapping_method
evidence
first_seen_at
last_seen_at
```

Allowed mapping methods:

- `manual_verified`
- `provider_cross_reference`
- `kickoff_team_league_match`
- `date_team_match`
- `imported`

Confidence rules:

- `verified`: manual or provider cross-reference verified.
- `high`: home/away names match, kickoff within tolerance, league compatible.
- `medium`: teams match but league or kickoff has mild uncertainty.
- `low`: fuzzy candidate only; cannot affect production money decisions.
- `unknown`: cannot be used outside shadow diagnostics.

Production fallback requires:

- mapping confidence `high` or `verified`;
- no score conflict;
- no severe minute conflict;
- event timeline does not contradict score.

## 7. Provider Orchestration Contract

Provider calls must be selected by role, cost, and need.

Match tiers:

```text
Tier A: World Cup / major subscribed match / high active users
  Can query primary + secondary providers for score, events, stats, and odds roles.

Tier B: watched match with subscriber interest
  Query primary provider first, secondary provider only on missing/degraded fields or sampled shadow cadence.

Tier C: public board / low interest
  Primary provider only unless sampled for provider health benchmark.

Tier D: manual operator / Ask AI enrichment
  Allow explicit on-demand multi-provider enrichment with audit metadata.
```

Budget controls required before production promotion:

- max calls per provider per run;
- max calls per provider per match per time bucket;
- quota-state circuit;
- entitlement-error circuit;
- repeated-5xx circuit;
- operator-visible request ledger.

## 8. Fusion Snapshot Contract

Each pipeline analysis should eventually consume `LiveProviderFusionSnapshot`.

```ts
interface LiveProviderFusionSnapshot {
  matchId: string;
  generatedAt: string;
  canonical: {
    fixture: CanonicalFixtureIdentity | null;
    scoreClock: CanonicalScoreClock | null;
    events: CanonicalMatchEvent[];
    statistics: CanonicalTeamStatistics | null;
    odds: CanonicalOddsSnapshot | null;
  };
  fieldSources: {
    fixture: ProviderFieldSource;
    scoreClock: ProviderFieldSource;
    events: ProviderFieldSource;
    statistics: ProviderFieldSource;
    odds: ProviderFieldSource;
  };
  providerHealth: ProviderHealth[];
  consensus: ProviderConsensus;
  evidenceMode: LiveAnalysisEvidenceMode;
  warnings: string[];
  moneyGuard: ProviderMoneyGuard;
}
```

Field source:

```ts
interface ProviderFieldSource {
  provider: ProviderId | null;
  providerFixtureId: string | null;
  fetchedAt: string | null;
  freshness: ProviderFreshnessState;
  coverage: ProviderCoverageLevel;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  notes: string[];
}
```

Consensus:

```ts
interface ProviderConsensus {
  scoreAgreement: 'agree' | 'single_source' | 'conflict' | 'unknown';
  minuteAgreement: 'agree' | 'single_source' | 'lag_detected' | 'conflict' | 'unknown';
  eventAgreement: 'agree' | 'single_source' | 'partial' | 'conflict' | 'unknown';
  statsAgreement: 'agree' | 'single_source' | 'missing' | 'conflict' | 'unknown';
  oddsAgreement: 'agree' | 'single_source' | 'missing' | 'conflict' | 'unknown';
}
```

Money guard:

```ts
interface ProviderMoneyGuard {
  canUseForMoneyDecision: boolean;
  canSaveRecommendation: boolean;
  canPushStatsOnlySignal: boolean;
  hardBlockReasons: string[];
  softWarnings: string[];
}
```

## 9. Fusion Selection Rules

### 9.1 Score And Clock

Selection priority:

1. Fresh provider with high-confidence mapping.
2. Score reconciles with event timeline.
3. Lowest clock lag.
4. Existing production source during shadow parity phase.

Hard blocks:

- live score conflict;
- provider clock lag critical;
- provider mapping below production threshold.

### 9.2 Events

Selection priority:

1. Timeline reconciles with score.
2. Higher event coverage and richer details.
3. Freshness.

Hard blocks:

- event timeline contradicts canonical score;
- source says complete but goal count does not reconcile.

### 9.3 Statistics

Selection priority:

1. Complete or partial stats from trusted mapped provider.
2. Both teams represented.
3. Key stat pairs available: shots, shots on target, corners, possession, cards.

Rules:

- API-Football empty stats plus Sportmonks usable stats can select Sportmonks.
- Non-empty API-Football stats should not be overwritten unless fusion rules prove Sportmonks is fresher/better and feature flag allows it.

### 9.4 Odds

Selection priority:

1. Tradable live odds with provider/bookmaker/fetchedAt.
2. Market normalized by existing canonical odds parser.
3. Score/minute source fresh and non-conflicted.

Hard blocks:

- no live odds;
- reference/prematch odds only;
- odds provider source stale;
- score/minute conflicted or stale;
- selected market/line cannot be normalized.

## 10. Evidence Mode Contract

Fusion layer may set evidence mode but must not relax policy.

Allowed mapping:

```text
full_live_data:
  fresh score/minute, usable events, complete/partial stats, tradable live odds.

stats_only:
  fresh score/minute, usable events, complete/partial stats, no tradable live odds.

odds_events_only:
  fresh score/minute/events/live odds, stats missing from all trusted providers.

events_only_degraded:
  fresh score/minute/events, no stats, no live odds.

low_evidence:
  conflict, stale score/minute, low mapping confidence, no meaningful event context, or provider health bad.

none:
  no usable provider data.
```

Money recommendation may save only from modes allowed by existing recommendation policy. Stats-only signals remain no-save.

## 11. Phase Plan And Gates

### Phase 0: Contract And Coverage Tooling

Status: implemented on 2026-06-12 for the current provider-fusion transition modules.

Goal:

- Create this contract and align docs.
- Add backend coverage tooling and provider-fusion coverage gates.

Behavior impact:

- None.

Required tests:

- Coverage tooling smoke test.
- Existing backend test suite.

Coverage gate:

- Gate script exists and fails on a synthetic below-threshold sample or is verified against current provider-fusion modules.

Done when:

- `test:coverage:provider-fusion` and `check:coverage:provider-fusion` exist.
- This document is linked from live provider fusion docs.
- Coverage gate enforces 90% total lines/branches/functions/statements for provider-fusion coverage scope.
- Coverage gate enforces 95% lines/branches/functions/statements for the money-critical Sportmonks fallback module.
- No runtime behavior change.

### Phase 1: Canonical Types And Runtime Validators

Status: implemented on 2026-06-12 as standalone canonical domain module; no adapter or runtime pipeline migration yet.

Goal:

- Add TFI-owned canonical types and runtime builders/validators.
- No adapter migration yet.

Behavior impact:

- None.

Required tests:

- canonical score/clock builder;
- canonical event builder;
- canonical stats builder;
- canonical odds snapshot builder;
- empty/missing/conflict coverage classification;
- runtime validator rejects malformed canonical objects.

Coverage gate:

- `src/lib/canonical/**`: 95% line and branch.

Done when:

- No provider raw type is required to construct canonical objects.
- Canonical tests pass and coverage gate passes.
- `src/lib/canonical/provider-domain.ts` is covered by provider-fusion coverage gate at 95%+ lines/branches/functions/statements.
- Existing pipeline behavior remains unchanged because no runtime imports were moved to the canonical module in this phase.

### Phase 2: API-Football Canonical Adapter

Status: implemented on 2026-06-13 as standalone shadow adapter; no runtime pipeline input migration yet.

Goal:

- Wrap current API-Football responses into canonical envelopes.
- Preserve existing production behavior.

Behavior impact:

- Shadow output only.

Required tests:

- fixture identity mapping;
- score/minute/status conversion;
- events conversion;
- statistics conversion;
- live odds conversion;
- prematch odds marked reference only;
- provider empty response vs fetch error distinction;
- request ledger redacts secrets.

Coverage gate:

- API-Football adapter: 90% overall, 95% for odds conversion/guard helpers.

Done when:

- API-Football adapter can build canonical envelopes for a recorded fixture without changing pipeline output.
- Fixture identity, score/clock, events, statistics, live odds, reference-only prematch odds, provider-empty response, provider fetch error, and ledger redaction paths have focused unit coverage.
- API-Football adapter coverage gate enforces 90%+ lines/branches/functions/statements.
- API-Football odds adapter coverage gate enforces 95%+ lines/branches/functions/statements.
- Existing pipeline behavior remains unchanged because no runtime imports were moved to the canonical adapter in this phase.

### Phase 3: Sportmonks Canonical Adapter

Status: implemented on 2026-06-13 as standalone shadow adapter; no runtime pipeline input migration yet.

Goal:

- Move Sportmonks normalization into canonical model.
- Keep current API-Football-compatible fallback until fusion promotion replaces it.

Behavior impact:

- None or shadow only.

Required tests:

- Sportmonks fixture/participant home-away conversion;
- score extraction;
- event taxonomy conversion;
- statistics taxonomy conversion;
- entitlement-gated odds include handling;
- World Cup locked/no-access response handling;
- API token redaction;
- provider rate-limit metadata parsing.

Coverage gate:

- Sportmonks adapter: 95%+ lines/branches/functions/statements for the Phase 3 canonical adapter.

Done when:

- Sportmonks canonical adapter can produce canonical score/events/stats envelopes from recorded raw payloads.
- Sportmonks canonical adapter can produce canonical fixture identity and live-odds envelopes with entitlement/no-access warnings preserved.
- Sportmonks period, event taxonomy, statistic taxonomy, odds fallback fields, empty response, failed response, access-error, token redaction, and quota-boundary paths have focused unit coverage.
- Sportmonks adapter coverage gate enforces 95%+ lines/branches/functions/statements in the provider-fusion coverage suite.
- Existing runtime behavior remains unchanged because fusion promotion starts in Phase 5.

### Phase 4: Provider Fixture Mapping

Status: implemented on 2026-06-13 as a formal mapping service used by the Sportmonks fallback path; no broader fusion source promotion yet.

Goal:

- Make fixture mapping a formal service with confidence scoring.

Behavior impact:

- Existing fallback may use service, but no broader production source selection yet.

Required tests:

- exact/manual mapping;
- date/team/kickoff matching;
- home/away alias handling;
- wrong team rejected;
- kickoff outside tolerance rejected;
- low-confidence mapping cannot be used for money;
- mapping evidence stored.

Coverage gate:

- Mapping service: 95% line and branch.

Done when:

- Every non-primary provider lookup goes through mapping service.
- Provider fixture mapping service resolves stored verified mappings, provider cross-references, kickoff/team/league candidates, alias-based home/away names, and date candidates with explicit confidence and evidence.
- Wrong-team, reversed-side, and kickoff-outside-tolerance candidates are rejected and not stored as safe mappings.
- `medium`, `low`, and `unknown` mappings remain audit-visible but cannot feed production money-impacting fallback data.
- Sportmonks fallback uses the mapping service before any non-primary provider fixture data is used.
- Mapping service coverage gate enforces 95%+ lines/branches/functions/statements in the provider-fusion coverage suite.

### Phase 5: Shadow Fusion Snapshot Builder

Status: implemented on 2026-06-13 as a shadow-only `LiveProviderFusionSnapshot` builder and CLI; recommendation runtime input is unchanged.

Goal:

- Build `LiveProviderFusionSnapshot` from API-Football and Sportmonks adapters.
- Persist or audit the snapshot.
- Do not change recommendation inputs.

Behavior impact:

- Audit/shadow only.

Required tests:

- single-source API-Football snapshot;
- API-Football + Sportmonks agreement;
- score conflict downgrades to low evidence;
- API-Football empty stats + Sportmonks stats selects Sportmonks in shadow;
- Sportmonks no-access does not fail pipeline;
- quota/circuit warnings included;
- no raw payload leaks into snapshot canonical fields.

Coverage gate:

- Fusion builder and source selection: 95% line and branch.

Done when:

- Script can run:

```powershell
npm run provider:fusion-shadow --prefix packages/server -- --match-id <api-football-fixture-id>
```

- Existing pipeline output remains unchanged.
- Snapshot builder selects canonical fixture, score/clock, events, statistics, and odds from provider envelopes with field-level provenance.
- API-Football-only, API-Football/Sportmonks agreement, score conflict, minute conflict, missing odds, Sportmonks entitlement failure, quota warnings, and no-raw-leak paths have focused unit coverage.
- API-Football empty statistics plus Sportmonks usable statistics selects Sportmonks in the shadow snapshot only.
- `provider:fusion-shadow` writes JSON output and can persist an audit sample without embedding provider raw payloads.
- Fusion builder coverage gate enforces 95%+ lines/branches/functions/statements in the provider-fusion coverage suite.

### Phase 6: Pipeline Read Abstraction Shadow Parity

Goal:

- Introduce an abstraction so `server-pipeline.ts` can read live inputs from fusion snapshot while still comparing against legacy cache inputs.

Implementation status:

- Implemented as `packages/server/src/lib/provider-fusion-pipeline-read.ts`.
- Runtime hook is opt-in through:

```text
PROVIDER_FUSION_ENABLED=true
PROVIDER_FUSION_SHADOW_ENABLED=true
PROVIDER_FUSION_PROMOTION_ENABLED=false
```

- The hook emits `PIPELINE_PROVIDER_FUSION_SHADOW_DIFF` audit rows with compact legacy-vs-fusion read views, changed fields, money guard diff, and compact fusion snapshot provenance.
- Phase 6 does not call an extra provider from `server-pipeline.ts`; it only re-reads data already resolved by the legacy provider/cache path.
- Phase 6 does not feed fusion data into the prompt and does not change recommendation save/push behavior.

Behavior impact:

- Shadow parity only by default.

Required tests:

- legacy path output unchanged;
- fusion path produces equivalent prompt data for API-Football-only cases;
- audit records legacy-vs-fusion diff;
- no save/push change when `PROVIDER_FUSION_PROMOTION_ENABLED=false`.

Coverage gate:

- Pipeline adapter layer: 90% overall.
- Money guard diff logic: 95%.

Done when:

- Runtime can emit fusion shadow diff for watched matches without changing save/push behavior.

### Phase 7: Controlled Stats/Events Promotion

Status: implemented on 2026-06-14 as controlled provider-fusion stats/events promotion.

Implementation notes:

- Added `packages/server/src/lib/provider-fusion-stats-events-promotion.ts` as the pure decision layer for stats/events promotion.
- Promotion requires `PROVIDER_FUSION_ENABLED=true` and `PROVIDER_FUSION_STATS_EVENTS_PROMOTION=true`.
- During standalone Phase 7 rollout, keep `PROVIDER_FUSION_ODDS_PROMOTION=false`; after Phase 9 is enabled, stats/events promotion and odds promotion may run together under their independent guards.
- `server-pipeline.ts` builds the Phase 6 fusion read when shadow audit or stats/events promotion is enabled, then only replaces prompt/snapshot/staleness stats/events when the Phase 7 decision is `promoted`.
- Promotion is blocked for API-Football-present data, score/minute conflicts, low Sportmonks mapping confidence, unusable coverage, and missing fusion data.
- This layer never promotes odds. The decision audit always reports `oddsPolicy=unchanged` and `savePolicyChanged=false`; odds promotion remains controlled by the Phase 9 guard.
- Pipeline audit action `PIPELINE_PROVIDER_FUSION_STATS_EVENTS_PROMOTION` records promoted/blocked status and source provenance without raw provider payloads.
- Stats-only no-odds behavior remains push-only/no-save via the existing stats-only signal path.

Goal:

- Allow fusion-selected stats/events into prompt when API-Football is missing/degraded and Sportmonks is trusted.

Behavior impact:

- Prompt data may improve; odds/save policy unchanged.

Required flags:

```text
PROVIDER_FUSION_ENABLED=true
PROVIDER_FUSION_STATS_EVENTS_PROMOTION=true
```

For the official combined provider mode after Phase 9:

```text
PROVIDER_FUSION_ENABLED=true
PROVIDER_FUSION_STATS_EVENTS_PROMOTION=true
PROVIDER_FUSION_ODDS_PROMOTION=true
```

Required tests:

- API-Football stats present -> no overwrite by default;
- API-Football stats empty + Sportmonks stats usable -> stats source Sportmonks;
- score conflict -> no fusion promotion;
- low mapping confidence -> no fusion promotion;
- stats-only signal can push but not save;
- money recommendation still blocked if odds unavailable.

Coverage gate:

- Stats/events promotion path: 95% line and branch.
- Implemented gate: `src/lib/provider-fusion-stats-events-promotion.ts` requires 95%+ lines/branches/functions/statements in the provider-fusion coverage suite.

Done when:

- Production can use Sportmonks stats/events with full provenance and no odds relaxation.

### Phase 8: Odds Provider Abstraction And Shadow

Status: implemented on 2026-06-14 as shadow-only odds provider-role audit.

Implementation notes:

- Added `packages/server/src/lib/provider-fusion-odds-shadow.ts` as the Phase 8 odds shadow guard/audit layer.
- Added `PROVIDER_FUSION_ODDS_SHADOW_ENABLED`; existing `PROVIDER_FUSION_SHADOW_ENABLED` also emits the odds shadow audit when provider fusion is enabled.
- `PROVIDER_FUSION_ODDS_PROMOTION=true` disables the Phase 8 shadow helper because odds promotion belongs to Phase 9.
- `server-pipeline.ts` emits `PIPELINE_PROVIDER_FUSION_ODDS_SHADOW` with source kind, provider fixture provenance, bookmaker list, market families, line keys, market signatures, freshness, consensus, and no-save guard reasons.
- Phase 8 does not replace `oddsCanonical`, does not feed fusion odds into the prompt, and does not alter recommendation save/push behavior.
- Shadow money guard always reports `canSaveRecommendation=false` and `productionBehaviorChanged=false`.
- Entitlement/no-access warnings are recorded as non-fatal soft warnings, while the absence of usable live odds still hard-blocks money use.

Goal:

- Move odds to provider-role architecture.
- Support API-Football plus future odds provider or Sportmonks All-in if entitled.

Behavior impact:

- Shadow only.

Required tests:

- live odds vs prematch/reference classification;
- bookmaker/source provenance;
- market normalization;
- line matching;
- stale odds downgrade;
- score/minute stale blocks odds use;
- odds source conflict produces no-save;
- entitlement/no-access handled as non-fatal.

Coverage gate:

- Odds adapter/fusion/guard: 95% line and branch.

Done when:

- Fusion snapshot can show odds provider provenance without changing save behavior.

### Phase 9: Controlled Odds Promotion

Status:

- Implemented on 2026-06-14 behind explicit rollout flags.
- Module: `packages/server/src/lib/provider-fusion-odds-promotion.ts`.
- Pipeline audit: `PIPELINE_PROVIDER_FUSION_ODDS_PROMOTION`.

Goal:

- Use fusion-selected live odds for money recommendations.

Behavior impact:

- Money-critical production path.
- Promotion only changes production behavior when fusion is enabled, shadow mode is off, kill switch is off, provider is allowlisted, rollout sampling passes, and Phase 8 odds guard reports fresh tradable live odds without score/minute/odds conflicts.
- When stats/events promotion is also enabled, the pipeline applies stats/events promotion before odds promotion so odds sanitization uses the active stats snapshot, including current corners.
- Rollback/config gates (`PROVIDER_FUSION_KILL_SWITCH=true`, empty allowlist, provider not allowlisted, rollout 0/outside sample) disable promotion without blocking the existing legacy save path.
- Money-safety blockers (`reference_odds_context_only`, no tradable live odds, stale/unknown freshness, score/minute conflict, odds source conflict, legacy/fusion odds availability mismatch, unsupported canonical markets) block recommendation save while odds promotion is active.
- Audit stores canonical market keys, line keys, provider provenance, guard reasons, rollout sample, and promoted odds availability only; raw provider payload is not written to promotion audit.

Required flags:

```text
PROVIDER_FUSION_ODDS_PROMOTION=true
PROVIDER_FUSION_ODDS_PROVIDER_ALLOWLIST=...
PROVIDER_FUSION_ROLLOUT_PERCENT=...
PROVIDER_FUSION_KILL_SWITCH=false
```

Required tests:

- all Phase 8 tests;
- recommendation save path uses canonical odds only;
- selected market and odds line match canonical market;
- no save on reference odds;
- no save on provider conflict;
- rollback disables odds promotion immediately.
- no save when canonical odds cannot be converted to supported pipeline markets;
- no raw provider payload in promotion audit;
- first-half/BTTS/AH/OU/corners ladder conversion regression coverage;
- provider identity, allowlist, rollout, freshness, and timestamp fallback regression coverage.

Coverage gate:

- 95% line, branch, function, and statement coverage on all odds promotion modules.
- `provider-fusion-coverage-gates.json` includes a per-file money-critical gate for `src/lib/provider-fusion-odds-promotion.ts`.

Done when:

- Controlled rollout passes replay gates and live audit review.

### Phase 10: Decommission API-Football Shape From Pipeline

Goal:

- `server-pipeline.ts` no longer depends on API-Football-shaped stats/events/fixtures.

Behavior impact:

- Architecture cleanup after fusion path is stable.

Required tests:

- pipeline fixture input via canonical model;
- prompt data parity;
- save/push parity;
- no imports from API-Football types in pipeline except compatibility boundary.

Coverage gate:

- Pipeline live input abstraction: 90%.
- Money-critical guard modules: 95%.

Done when:

- API-Football shape is isolated to its adapter and legacy compatibility modules only.

Implementation status 2026-06-14:

- Status: Done.
- Production behavior changed: no betting/push behavior change intended; this is a pipeline input architecture cleanup.
- Feature flags: none new. Existing provider-fusion flags keep controlling shadow/promotion behavior.
- Provider roles affected: fixture identity, score clock, fixture statistics, event timeline, and live/reference odds source envelopes.
- Field provenance recorded: `PipelineFixtureInput.provider`, provider source envelopes, selected provider ids, provider fixture ids, mapping confidence, freshness, coverage, and warnings.
- Conflict hard-blocks unchanged: score/minute/provider odds conflicts, stale/unknown odds freshness, reference odds in money path, unsupported canonical markets, and existing policy/normalization guards.
- Tests added/updated: `pipeline-live-input.test.ts`, provider-fusion pipeline read tests, odds shadow/promotion tests, stats/events promotion tests, and server pipeline regression tests.
- Coverage achieved: `pipeline-live-input.ts` 100% statements, 97.64% branches, 100% functions, 100% lines; provider-fusion gate passed.
- Replay/data-driven gates run: `npm run data-driven:verify-gates-ci --prefix packages/server` passed.
- Rollback: revert the Phase 10 boundary/refactor files or route `server-pipeline.ts` back to legacy fixture/stat/event helpers while keeping provider-fusion flags disabled.
- Residual risk: API-Football raw shape still exists in `pipeline-live-input.ts` as the explicit compatibility boundary until provider adapters return all live inputs natively.

## 12. Phase Exit Checklist

Every implementation phase must answer:

```text
1. What production behavior changed?
2. Which feature flags control it?
3. Which provider roles are affected?
4. Which field provenance is recorded?
5. What conflicts hard-block save?
6. What tests were added?
7. What coverage percentage was achieved?
8. Which replay/data-driven gates were run?
9. How do we rollback?
10. What residual risk remains?
```

No phase is complete without this checklist in the handoff.

## 13. Regression Matrix

Minimum regression cases across phases:

```text
single_provider_api_football_full_data
single_provider_api_football_no_stats
api_football_no_stats_sportmonks_stats
api_football_events_empty_score_0_0_no_secondary_call
api_football_score_1_0_sportmonks_score_0_0_conflict
sportmonks_mapping_low_confidence
sportmonks_entitlement_403_inplay_odds
live_odds_missing_stats_available
prematch_odds_only_no_money_save
live_odds_fresh_score_stale_no_money_save
market_normalization_unknown_no_save
stats_only_signal_push_no_save
provider_quota_critical_no_secondary_call
provider_fetch_error_legacy_path_survives
provider_raw_payload_not_in_prompt
```

Each case should have at least one unit test, and money-critical cases should have pipeline-level regression tests.

## 14. Observability Contract

Every fusion snapshot or provider fallback must produce enough metadata for an operator to answer:

- Which provider supplied score?
- Which provider supplied minute?
- Which provider supplied events?
- Which provider supplied statistics?
- Which provider supplied odds?
- Were there conflicts?
- Was data missing, empty, stale, or blocked by entitlement?
- How many provider calls were used?
- Which feature flags allowed the behavior?
- Why was a recommendation saved, pushed-only, shadowed, or blocked?

Required audit keys:

```json
{
  "providerFusion": {
    "fieldSources": {},
    "providerHealth": [],
    "consensus": {},
    "evidenceMode": "",
    "moneyGuard": {},
    "warnings": []
  }
}
```

## 15. Rollback Contract

All production-impacting phases must have kill switches:

```text
PROVIDER_FUSION_ENABLED=false
PROVIDER_FUSION_STATS_EVENTS_PROMOTION=false
PROVIDER_FUSION_ODDS_PROMOTION=false
PROVIDER_FUSION_KILL_SWITCH=true
SPORTMONKS_ENABLED=false
SPORTMONKS_ALLOW_STATS_FALLBACK=false
SPORTMONKS_ALLOW_EVENTS_FALLBACK=false
SPORTMONKS_ALLOW_ODDS_FALLBACK=false
```

Rollback requirements:

- Disabling fusion must return pipeline to legacy provider-cache path.
- Disabling Sportmonks must not break API-Football-only runtime.
- Disabling odds promotion must preserve stats-only/watch insight paths.
- No rollback may require deleting data.

## 16. First Implementation Recommendation

Implement in this order:

1. Phase 0: coverage tooling + contract links.
2. Phase 1: canonical types/builders/validators.
3. Phase 2: API-Football canonical adapter.
4. Phase 3: Sportmonks canonical adapter.
5. Phase 5: shadow fusion snapshot builder.

Do not promote stats/events or odds until Phase 5 shadow snapshots show reliable mapping, source selection, warnings, and coverage.
