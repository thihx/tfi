# Live Data Provider Fusion Contract

**Status:** Phase A implemented; multi-provider fusion still draft
**Updated:** 2026-06-09
**Scope:** thiet ke lop hop nhat nhieu provider cho live score/events/stats/odds truoc khi dua vao live recommendation pipeline.

## Ly Do

API-Football dang cho thay mot rui ro kien truc: mot tran lon co the co broadcast, odds va thong ke o cac nguon khac, nhung provider hien tai lai:

- tra live clock cham hon broadcast nhieu phut;
- co score/events nhung khong co fixture statistics;
- khien pipeline phai di vao evidence degraded du provider khac co the co du lieu tot hon.

Live recommendation la money-critical, nen he thong khong duoc tin tuyet doi vao mot feed duy nhat. Tuy nhien cung khong duoc hop nhat du lieu tuy tien lam LLM bi ao tuong. Contract nay dinh nghia cach nhan, danh gia, chon canonical snapshot va downgrade khi provider conflict.

## Muc Tieu

- Giam rui ro khi mot provider thieu stats, lag clock, stale odds, hoac sai event.
- Cho phep them provider moi ma khong lam vo prompt/policy/save flow.
- Ghi ro provenance cho tung field: score, minute, events, stats, odds.
- De pipeline quyet dinh bang `freshness`, `coverage`, va `consensus`, khong phai bang "co/khong co API-Football".
- Neu du lieu conflict thi conservative no-action/shadow, khong save keo tien.

Khong muc tieu:

- Khong de browser goi provider truc tiep.
- Khong tron odds tu mot provider voi stats/score tu provider khac ma khong co provenance.
- Khong dung broadcast/manual screen data lam official input neu chua co ingestion va audit contract rieng.
- Khong mo market moi hay relax policy chi vi co provider moi.

## Provider Roles

Provider khong bat buoc phai cung cap moi loai du lieu. Moi provider duoc khai bao theo role:

- `fixture_score`: fixture identity, status, minute, score.
- `event_timeline`: goals, cards, substitutions, VAR/penalty events.
- `fixture_statistics`: possession, shots, shots on target, corners, cards, passes, xG neu co.
- `live_odds`: tradable live odds/line.
- `reference_odds`: prematch/reference odds only, khong tradable live.
- `lineups`: starter/formation/bench.

API-Football co the tiep tuc lam baseline fixture provider, nhung khong con la nguon canonical duy nhat cho live recommendation.

## Canonical Snapshot Contract

Moi lan pipeline phan tich mot match, he thong phai tao `LiveProviderFusionSnapshot` truoc khi build prompt:

```ts
interface LiveProviderFusionSnapshot {
  matchId: string;
  generatedAt: string;
  canonical: {
    status: string;
    minute: number | null;
    score: { home: number | null; away: number | null };
    events: ProviderEvent[];
    statistics: ProviderStatistics | null;
    odds: CanonicalOdds | null;
  };
  fieldSources: {
    status: ProviderFieldSource;
    minute: ProviderFieldSource;
    score: ProviderFieldSource;
    events: ProviderFieldSource;
    statistics: ProviderFieldSource;
    odds: ProviderFieldSource;
  };
  providerHealth: ProviderHealth[];
  consensus: ProviderConsensus;
  evidenceMode: LiveAnalysisEvidenceMode;
  warnings: string[];
}
```

Field source:

```ts
interface ProviderFieldSource {
  provider: string;
  fetchedAt: string | null;
  freshness: 'fresh' | 'stale' | 'missing' | 'conflicted';
  coverage: 'complete' | 'partial' | 'empty' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
}
```

Provider health:

```ts
interface ProviderHealth {
  provider: string;
  roles: string[];
  reachable: boolean;
  lastFetchedAt: string | null;
  statusCode: number | null;
  quotaState: 'ok' | 'elevated' | 'high' | 'critical' | 'daily_limit' | 'unknown';
  fixtureClockLagMinutes: number | null;
  eventLagMinutes: number | null;
  statsCoverage: 'complete' | 'partial' | 'empty' | 'missing';
  oddsCoverage: 'complete' | 'partial' | 'empty' | 'missing';
  reliability: 'good' | 'degraded' | 'bad' | 'unknown';
  warnings: string[];
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

## Freshness And Lag Rules

### Provider Clock Lag

Khi fixture co `periods.first` hoac kickoff timestamp, tinh approximate live minute theo wall clock:

```text
wallClockMinute = floor((now - periodStart) / 60s)
providerClockLag = wallClockMinute - providerElapsed
```

Threshold:

- `< 2m`: ok.
- `2m-4m`: warning `provider_clock_lag`.
- `>= 4m`: degraded `provider_clock_lag_high`.
- `>= 7m`: bad `provider_clock_lag_critical`.

Neu provider reported minute thap hon broadcast/wall clock nhung score/events cung stale, khong cho official money recommendation.

### Score/Event Freshness

- Score va goals timeline phai tuong thich nhau. Neu score 0-2 thi event timeline phai co hai goal events hoac provider source phai ghi ro event coverage partial.
- Neu provider A score 0-2, provider B score 0-1 trong cung thoi diem, consensus = `conflict`.
- Score conflict trong live match la hard no-save guard.

### Statistics Coverage

`fixture_statistics` co `response=[]` phai duoc ghi la:

```text
provider returned no live statistics
```

Khong duoc noi nhu loi noi bo "he thong thieu so lieu" neu provider da tra 200 voi empty stats.

Coverage:

- `complete`: hai team co tracked stats co y nghia.
- `partial`: chi mot team hoac it tracked pairs.
- `empty`: provider tra 200 nhung array rong.
- `missing`: khong fetch duoc, cache miss, quota/circuit, hoac endpoint khong ho tro.

### Odds Freshness

Live odds phai co fetchedAt, bookmaker/source, line va price. Prematch odds chi la `reference_odds`; khong duoc lam actionable live price.

Neu score/minute stale nhung odds fresh, van phai downgrade vi market context phu thuoc clock/score.

## Evidence Mode Mapping

Fusion layer khong thay policy. No chi cap evidence mode chinh xac hon:

- `full_live_data`: score/minute fresh, events usable, stats complete/partial, live odds usable.
- `stats_only`: score/minute fresh, events usable, stats complete/partial, live odds missing/unusable.
- `odds_events_only_degraded`: score/events/odds usable, provider returned no live statistics.
- `events_only_degraded`: score/events usable, stats missing/empty, live odds missing/unusable.
- `low_evidence`: score/minute stale, score conflict, no events, or provider health bad.

Hard downgrade:

- score conflict -> `low_evidence`
- provider clock lag critical -> `low_evidence`
- odds stale + no stats -> `events_only_degraded` or `low_evidence`
- stats empty from one provider but complete from another trusted stats provider -> may use complete stats with field provenance.

## Recommendation Guard Contract

Money recommendation can save only when:

- canonical score/minute are fresh or accepted with low lag;
- no score conflict;
- live odds are tradable and canonical;
- selected market is allowed by resulting evidence mode;
- field provenance is recorded in audit metadata;
- save-integrity verifies provider coverage status.

If provider consensus is degraded:

- may emit `watch_insight` or `shadow_candidate`;
- no settlement/ROI row unless money guard passes;
- prompt must receive provider warnings and must not invent missing stats/odds.

## Audit Metadata

Every `PIPELINE_MATCH_ANALYZED` row should include:

```json
{
  "providerFusion": {
    "canonicalSource": {
      "score": "api-football",
      "minute": "api-football",
      "events": "api-football",
      "statistics": "sportmonks",
      "odds": "odds-provider-x"
    },
    "providerHealth": [],
    "consensus": {},
    "warnings": ["provider_clock_lag", "provider_returned_no_live_statistics"]
  }
}
```

For legacy/API-Football-only rows, still populate:

- `providerReturnedNoLiveStatistics=true` when stats endpoint returns 200 with `[]`.
- `providerClockLagMinutes` when wall-clock lag can be estimated.
- `providerCoverageStatus` with one of `full`, `no_live_stats`, `clock_lag`, `clock_lag_no_live_stats`, `provider_unavailable`.

## UI Contract

Live Monitor and Matches UI should distinguish:

- current system state;
- historical audit snapshot;
- provider coverage limitation;
- internal fetch/runtime error.

User-facing labels:

- `Provider no live stats`: provider returned no live statistics for this fixture.
- `Provider clock lag`: provider live clock appears delayed versus wall clock/broadcast.
- `Provider score conflict`: providers disagree on score.
- `Reference odds only`: prematch/reference odds are present, but no tradable live odds.

Avoid:

- "system has no stats" when provider returned an empty stats response.
- "match is too early" when the provider clock may be lagging.
- showing historical audit rows as if they are current live rows.

## Provider Candidate Evaluation

Before adding a provider to production, run a POC matrix:

- top leagues
- international friendlies
- youth/international U matches
- low-tier leagues
- live score/event lag
- stats availability
- live odds availability
- quota/cost
- endpoint latency
- provider conflict rate

Minimum acceptance for backup provider:

- fixture identity mapping can be joined to existing match ids or a stable cross-provider mapping table;
- field-level provenance can be recorded;
- rate limits are understood;
- missing data is explicit, not silently null;
- terms permit production use for the intended display/recommendation workflow.

## Implementation Phases

### Phase A: API-Football Health Instrumentation

Status: implemented for the current API-Football-only runtime.

- Detect provider clock lag from live status elapsed minute versus provider period start/wall-clock estimate.
- Classify statistics coverage as complete, partial, empty, or missing so provider `[]` is distinct from cache/fetch miss.
- Add provider coverage warnings to pipeline debug/audit metadata, LLM gateway metadata, prompt notes, Live Monitor labels, and Matches AI panel warnings.
- No schema-heavy provider fusion yet; Phase A only instruments the current provider so operators can see provider coverage/freshness limits before provider abstraction.

### Phase B: Provider Abstraction

- Create provider role interfaces.
- Move API-Football behind role-specific adapter methods.
- Keep current canonical behavior unchanged.

### Phase C: Backup Provider POC

- Add one backup provider in shadow/read-only mode.
- Compare score/minute/events/stats/odds without changing money decisions.
- Emit provider comparison reports.

### Phase D: Fusion Canonicalization

- Select canonical field by freshness/coverage/reliability rules.
- Record field provenance in audit.
- Keep money guard conservative on conflicts.

### Phase E: Production Promotion

- Allow fusion snapshot into prompt/policy.
- Add replay/operator gates.
- Roll out by league/provider segment with kill switch.

## Open Questions

- Which backup provider should be POC first: Sportmonks, Sportradar, Stats Perform/Opta, TheSports/iSportsAPI, or an odds-specialized feed?
- Do we need a cross-provider fixture mapping table, or can kickoff/team/league fuzzy matching cover MVP?
- What lag threshold should hard-block official bets by market family?
- Should operator allow manual confirmation of broadcast score, or keep provider-only input until ingestion is formalized?
