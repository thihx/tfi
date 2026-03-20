# Core Pipeline Implementation Checklist

## Purpose

Checklist này dùng cho các thay đổi core của pipeline live monitor, đặc biệt các thay đổi liên quan tới:

- fetch stats / odds
- fallback provider
- AI prompt / AI parse
- replay harness
- provider observability / data sampling

Mục tiêu là tránh kiểu "đã code xong nhưng còn sót edge case, chưa có evidence, hoặc chưa tự audit lại".

## Working Rules

- Không tick item nếu chưa có `evidence`.
- `Evidence` phải là một trong các loại sau:
  - file/path + line ref
  - test name
  - command đã chạy
  - query DB
  - sample payload / screenshot log
- Nếu item có code nhưng chưa có test hoặc smoke verification thì vẫn coi là chưa xong.
- Mọi thay đổi core phải đi qua 2 lượt:
  - `Implementation pass`
  - `Post-implementation audit pass`

## Status Legend

- `[ ]` Pending
- `[x]` Completed with evidence
- `BLOCKED` Không làm tiếp được nếu thiếu prerequisite

## Scope For Current Workstream

- replay harness chạy production code path
- replay với `LLM thật`
- so sánh provider cho odds và stats
- lưu dữ liệu provider-level để quyết định có đổi provider hay không

---

## Phase 0: Baseline And Guardrails

- [ ] Tạo branch/workstream note rõ ràng cho hạng mục này
  Evidence:

- [ ] Xác nhận baseline hiện tại đang xanh:
  - `npm run typecheck`
  - `npm run typecheck --prefix packages/server`
  - `npm run test --prefix packages/server`
  Evidence:

- [ ] Xác nhận exact-event odds fallback hiện tại vẫn pass full regression
  Evidence:

- [ ] Xác nhận không có thay đổi unrelated nào bị gộp vào task này ngoài những file đã hiểu rõ
  Evidence:

---

## Phase 1: Replay Harness

- [ ] Chọn entrypoint replay dùng đúng production path, không viết logic song song riêng
  Evidence:

- [ ] Tạo harness replay chạy được với mode:
  - `llm=real`
  - `llm=mock`
  - `odds=recorded`
  - `odds=live`
  - `odds=mock`
  Evidence:

- [ ] Replay mặc định chạy ở `shadow mode`
  - không gửi notify
  - không ghi recommendation production
  Evidence:

- [ ] Scenario schema được định nghĩa rõ ràng
  Bắt buộc có khả năng chứa:
  - watchlist entry
  - fixture
  - statistics
  - events
  - API-Sports live odds raw
  - The Odds events raw
  - The Odds event-odds raw
  - expected assertions
  Evidence:

- [ ] Tạo ít nhất 5 scenario simulation chuẩn
  - live odds shape `odds[]`
  - The Odds fallback hit
  - no odds
  - poor stats
  - force analyze
  Evidence:

- [ ] Tạo ít nhất 2 scenario replay từ payload thật nếu có
  Evidence:

- [ ] Có test xác nhận replay harness thật sự dùng production code path
  Evidence:

- [ ] Có test xác nhận `shadow mode` không notify / không save production recommendation
  Evidence:

---

## Phase 2: Provider Sampling Storage

- [ ] Quyết định mô hình lưu dữ liệu:
  - mở rộng bảng hiện có
  - hoặc thêm bảng `provider_stats_samples`
  - hoặc thêm bảng `provider_odds_samples`
  Evidence:

- [ ] Document rõ lý do chọn mô hình lưu dữ liệu
  Evidence:

- [ ] Nếu thêm migration:
  - schema có index hợp lý
  - không overwrite sai dữ liệu khi nhiều provider cùng tồn tại
  Evidence:

- [ ] Với odds samples, mỗi record phải lưu được tối thiểu:
  - `match_id`
  - `match_minute`
  - `provider`
  - `captured_at`
  - `success`
  - `latency_ms`
  - `source`
  - `raw_payload`
  - `normalized_payload`
  - `market/line/price_1/price_2/price_x` nếu parse được
  Evidence:

- [ ] Với stats samples, mỗi record phải lưu được tối thiểu:
  - `match_id`
  - `match_minute`
  - `provider`
  - `captured_at`
  - `success`
  - `latency_ms`
  - `raw_payload`
  - `normalized_payload`
  - `coverage flags`
  Evidence:

- [ ] Có cờ bật/tắt sampling để tránh spam DB ngoài ý muốn
  Evidence:

- [ ] Lỗi sampling không được làm crash pipeline
  Evidence:

- [ ] Có test cho persistence layer + route/repo nếu có
  Evidence:

---

## Phase 3: Odds / Stats Collection Wiring

- [ ] Sampling được gắn đúng vào chỗ fetch provider, không chỉ sau khi pipeline đã normalize xong
  Evidence:

- [ ] Có thể phân biệt được:
  - API-Sports live success/fail
  - The Odds success/fail
  - pre-match fallback
  - no usable odds
  Evidence:

- [ ] Có thể phân biệt được stats coverage theo provider
  Evidence:

- [ ] Pipeline canonical state vẫn tiếp tục lưu vào:
  - `match_snapshots`
  - `odds_movements`
  Evidence:

- [ ] Việc thêm sampling không thay đổi behavior recommendation path ngoài mục đích observability
  Evidence:

---

## Phase 4: Automated Tests

- [ ] `npm run typecheck` pass
  Evidence:

- [ ] `npm run typecheck --prefix packages/server` pass
  Evidence:

- [ ] `npm run test --prefix packages/server` pass
  Evidence:

- [ ] Targeted tests cho replay harness pass
  Evidence:

- [ ] Targeted tests cho provider sampling pass
  Evidence:

- [ ] Targeted tests cho odds resolver / provider fallback pass
  Evidence:

- [ ] Targeted tests cho frontend live-monitor contract pass
  Evidence:

- [ ] Có regression test cho:
  - source order thống nhất
  - live odds raw shape `odds[]`
  - The Odds exact-event match
  - shadow mode
  - sampling failure isolation
  Evidence:

---

## Phase 5: Smoke Test With Real Integrations

- [ ] Gọi thật `/api/proxy/football/odds`
  Evidence:

- [ ] Gọi thật `/api/proxy/ai/analyze`
  Evidence:

- [ ] Chạy ít nhất 1 replay với `llm=real`
  Evidence:

- [ ] Chạy ít nhất 1 replay với `llm=real + odds=recorded`
  Evidence:

- [ ] Nếu có trận live thật, chạy ít nhất 1 `shadow run` end-to-end
  Evidence:

- [ ] Xác nhận DB có sample stats / odds sau smoke test
  Evidence:

- [ ] Xác nhận smoke test không gửi notify ngoài ý muốn
  Evidence:

- [ ] Xác nhận smoke test không tạo recommendation production ngoài ý muốn
  Evidence:

---

## Phase 6: Post-Implementation Audit

- [ ] Review diff như một reviewer độc lập, không dựa vào trí nhớ lúc code
  Evidence:

- [ ] So lại mọi item trong checklist, item nào không có evidence thì revert về pending
  Evidence:

- [ ] Review schema/index/unique key để chắc side-by-side provider comparison không bị ghi đè
  Evidence:

- [ ] Query DB để xác nhận dữ liệu thực tế có shape đúng
  Evidence:

- [ ] Query DB để đo các tỷ lệ sau:
  - `% snapshot có stats usable`
  - `% snapshot có odds usable`
  - `% odds_source = live`
  - `% odds_source = the-odds-api`
  - `% odds_source = pre-match`
  - `% no usable odds`
  Evidence:

- [ ] Kiểm tra log lỗi provider có thể group theo nguyên nhân thật, không chỉ `unknown`
  Evidence:

- [ ] Kiểm tra replay result và smoke result không có lệch bất thường
  Evidence:

- [ ] Viết summary audit cuối cùng: `pass / fail / open issues`
  Evidence:

---

## Suggested Queries

### Match snapshots coverage

```sql
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE stats <> '{}'::jsonb) AS rows_with_stats,
  COUNT(*) FILTER (WHERE odds <> '{}'::jsonb) AS rows_with_odds
FROM match_snapshots;
```

### Odds source distribution

Nếu source được lưu ở sample table hoặc metadata:

```sql
SELECT odds_source, COUNT(*)
FROM provider_odds_samples
GROUP BY odds_source
ORDER BY COUNT(*) DESC;
```

### Provider failure rate

```sql
SELECT provider, success, COUNT(*)
FROM provider_odds_samples
GROUP BY provider, success
ORDER BY provider, success;
```

---

## Sign-Off Gate

Không được coi là hoàn tất nếu còn bất kỳ item nào dưới đây chưa có evidence:

- replay harness với `LLM thật`
- provider sampling cho odds
- provider sampling cho stats
- smoke test thật
- post-implementation audit summary

---

## Evidence Log

### Entry 1

- Date:
- Item:
- Evidence:
- Notes:

### Entry 2

- Date:
- Item:
- Evidence:
- Notes:

### Entry 3

- Date:
- Item:
- Evidence:
- Notes:

---

## Current Status (2026-03-20)

Completed in this implementation pass:

- Provider-level storage added with append-only migrations and repos:
  - `packages/server/src/db/migrations/009_provider_samples.sql`
  - `packages/server/src/repos/provider-stats-samples.repo.ts`
  - `packages/server/src/repos/provider-odds-samples.repo.ts`
- Provider sampling wired into production fetch paths:
  - stats/events sampled in `packages/server/src/lib/server-pipeline.ts`
  - odds attempts sampled per source in `packages/server/src/lib/odds-resolver.ts`
  - The Odds trace path added in `packages/server/src/lib/the-odds-api.ts`
- Replay harness added on top of production pipeline path:
  - `packages/server/src/lib/pipeline-replay.ts`
  - `packages/server/src/scripts/replay-pipeline.ts`
  - sample scenarios in `packages/server/src/__fixtures__/replay/`
- Shadow replay guardrails added:
  - no recommendation save
  - no Telegram send
  - no snapshot save
  - no audit write
  - optional provider sampling disabled by default in replay

Verification evidence:

- Baseline before changes:
  - `npm run typecheck`
  - `npm run typecheck --prefix packages/server`
  - `npm run test --prefix packages/server`
- Post-change verification:
  - `npm run typecheck --prefix packages/server`
  - `npm run test --prefix packages/server`
  - `npm run typecheck`
  - `npm run test -- src/features/live-monitor/__tests__/football-api.service.test.ts src/features/live-monitor/__tests__/pipeline.integration.test.ts src/features/live-monitor/__tests__/pipeline.simulation.test.ts`
  - `npm run replay:pipeline --prefix packages/server -- --scenario src/__fixtures__/replay/live-odds.json`
- Targeted regression files added/updated:
  - `packages/server/src/__tests__/odds-resolver.test.ts`
  - `packages/server/src/__tests__/pipeline-replay.test.ts`
  - `packages/server/src/__tests__/provider-samples.repo.test.ts`
  - `packages/server/src/__tests__/provider-sampling.test.ts`
  - `packages/server/src/__tests__/server-pipeline.test.ts`
  - `packages/server/src/__tests__/proxy.routes.test.ts`
  - `src/features/live-monitor/__tests__/football-api.service.test.ts`

Real smoke evidence on DB test:

- Runtime source of truth:
  - commands must be run from `packages/server` to use `packages/server/.env`
  - running `npm run ... --prefix packages/server` from repo root may use a different `.env`
- Migration reconciliation on DB test:
  - inspected schema confirmed `007_audit_logs.sql` and `008_match_enrichment.sql` effects already existed
  - inserted missing markers for `007_audit_logs.sql` and `008_match_enrichment.sql` into `_migrations`
  - ran `npm run migrate` from `packages/server`
  - result: `009_provider_samples.sql applied`
- Real `/api/proxy/football/odds`:
  - live candidate resolved successfully on fixture `1516000`
  - match: `Sogdiana vs Pakhtakor`
  - result: `statusCode=200`, `odds_source=live`, `response_count=1`, `bookmakers=1`
  - sample bet names included:
    - `Asian Handicap`
    - `Fulltime Result`
    - `Over/Under Line`
- Real `/api/proxy/ai/analyze`:
  - prompt: `Reply with exactly OK_REAL_SMOKE_2026_03_20 and nothing else.`
  - result: `statusCode=200`
  - response text: `OK_REAL_SMOKE_2026_03_20`
- Replay with real LLM:
  - ran `runReplayScenario(...)` on `src/__fixtures__/replay/live-odds.json`
  - options: `llmMode=real`, `oddsMode=recorded`, `shadowMode=true`
  - result: `success=true`, `shouldPush=true`, `selection="Over 2.5 Goals @1.85"`, `confidence=6`, `saved=false`, `notified=false`
- Live shadow run end-to-end:
  - fixture: `1516000` (`Sogdiana vs Pakhtakor`)
  - executed `runPipelineForFixture(...)` with:
    - `shadowMode=true`
    - `sampleProviderData=true`
    - `previousRecommendations=[]`
    - `previousSnapshot=null`
  - result: `success=true`, `shouldPush=false`, `saved=false`, `notified=false`
  - debug: `oddsSource=live`, `oddsAvailable=true`, `statsAvailable=false`
- DB validation after smoke:
  - `provider_stats_samples` for `match_id=1516000`: `count=1`
  - `provider_odds_samples` for `match_id=1516000`: `count=2`
  - latest stats sample:
    - `provider=api-football`
    - `consumer=replay`
    - `success=true`
    - `team_count=0`
    - `event_count=2`
    - `populated_stat_pairs=0`
  - latest odds samples:
    - `consumer=proxy-route`, `source=live`, `usable=true`
    - `consumer=replay`, `source=live`, `usable=true`

Audit notes:

- Side-by-side provider comparison will not overwrite canonical pipeline state because samples are stored in new append-only tables, not in `match_snapshots` or `odds_movements`.
- Replay harness uses production gates/resolver/parser path through `runPipelineForFixture(...)` with dependency overrides, not a duplicate prompt/parsing implementation.
- In short-lived standalone scripts, fire-and-forget sampling may need a short delay before process exit to flush inserts. This does not affect the long-running server process, but it matters for smoke scripts.
- The DB test had migration-log drift for `007/008`; this pass reconciled the markers before applying `009`.
- There are unrelated workspace changes outside this workstream already present in git status; they were not reverted here.

Final audit summary:

- `PASS` Provider sampling schema and repos are live on DB test.
- `PASS` Real `/api/proxy/football/odds` works against live data.
- `PASS` Real `/api/proxy/ai/analyze` works against Gemini.
- `PASS` Replay with real LLM works in `shadowMode`.
- `PASS` Live shadow run on `Sogdiana vs Pakhtakor` executed without creating recommendations or notifications.
- `PASS` DB test contains real provider odds/stats samples after smoke.
- `OPEN NOTE` For operational consistency, migrations and smoke scripts should be run from `packages/server` so the intended `.env` is loaded.

## Live Score API benchmark extension (2026-03-20)

Implementation:

- Added benchmark-only Live Score adapter and matcher:
  - `packages/server/src/lib/live-score-api.ts`
- Added manual smoke helper:
  - `packages/server/src/scripts/benchmark-live-score.ts`
  - `packages/server/package.json` -> `benchmark:live-score`
- Wired side-by-side stats sampling into production pipeline without changing the primary decision source:
  - `packages/server/src/lib/server-pipeline.ts`
  - gate: `LIVE_SCORE_BENCHMARK_ENABLED=true`
  - default behavior remains unchanged when the flag is not enabled
- Added integration health probe:
  - `packages/server/src/lib/integration-health.ts`
- Added regression coverage:
  - `packages/server/src/__tests__/live-score-api.test.ts`
  - `packages/server/src/__tests__/server-pipeline.test.ts`
  - `packages/server/src/__tests__/integration-health.lib.test.ts`

Verification:

- `npm run typecheck --prefix packages/server`
  - result: `pass`
- `npm run test --prefix packages/server`
  - result: `pass` (`35` files, `363` tests)
- Real Live Score API auth/health:
  - checked `checkSingleIntegration('live-score-api')`
  - result: `status=HEALTHY`, `Live matches visible: 24`
- Manual benchmark smoke on fixture `1516000` (`Sogdiana vs Pakhtakor`):
  - command: `npm run benchmark:live-score -- --fixture 1516000`
  - result: `matched=false`, `error=NO_LIVE_SCORE_MATCH`
  - conclusion: provider does not cover this fixture well enough for stats benchmark
- Live scan across current API-Sports live fixtures found a real overlap on fixture `1521310`:
  - API-Sports: `ATK Mohun Bagan vs Mumbai City`
  - Live Score match: provider match `695742`
  - coverage: `has_possession=true`, `has_shots=true`, `has_shots_on_target=true`, `has_corners=true`
- Live shadow run with benchmark sampling enabled on fixture `1521310`:
  - result inserted both provider samples into DB test:
    - `provider=api-football`, `success=true`
    - `provider=live-score-api`, `success=true`
  - latest Live Score coverage flags:
    - `matched=true`
    - `provider_match_id=695742`
    - `provider_fixture_id=1840648`
    - `event_count=6`
    - `populated_stat_pairs=10`
    - `has_possession=true`
    - `has_shots=true`
    - `has_shots_on_target=true`
    - `has_corners=true`
- Manual benchmark script smoke on fixture `1521310`:
  - command: `npm run benchmark:live-score -- --fixture 1521310 --record`
  - result: `matched=true`, `providerMatchId=695742`, `recorded=true`
  - confirmed script can independently persist benchmark samples to DB test

Audit note:

- The full live pipeline on fixture `1521310` still hit an unrelated upstream abort (`This operation was aborted`) even when benchmark sampling was disabled. This confirms the new Live Score benchmark path did not introduce that failure.

## Live Score fallback + evidence modes (2026-03-21)

Implementation:

- Added guarded runtime fallback flag:
  - `LIVE_SCORE_STATS_FALLBACK_ENABLED=true`
  - config wired in `packages/server/src/config.ts`
- Server pipeline now:
  - keeps `API-Sports` as primary stats/events source
  - only attempts Live Score fallback when `API-Sports` stats fail the quality gate
  - only accepts fallback when Live Score passes the same quality gate and improves the core stat-pair count
  - records `statsSource`, `statsFallbackUsed`, `statsFallbackReason`, and `evidenceMode` in debug output
  - stores fallback-origin snapshots with source `server-pipeline:live-score-fallback`
- Prompt now includes machine-readable evidence context:
  - `STATS_SOURCE`
  - `EVIDENCE_MODE`
  - `Stats Fallback Note`
  - explicit degraded rules for `odds_events_only_degraded`

Files:

- `packages/server/src/lib/server-pipeline.ts`
- `packages/server/src/config.ts`
- `packages/server/src/__tests__/server-pipeline.test.ts`

Verification:

- `npm run typecheck --prefix packages/server`
  - result: `pass`
- `npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts src/__tests__/live-score-api.test.ts`
  - result: `pass`
- `npm run test --prefix packages/server`
  - result: `pass` (`35` files, `366` tests)
- `npm run typecheck`
  - result: `pass`

Real-data checks:

- Conservative non-override check:
  - fixture `1533574` (`Haras El Hodood vs Ismaily SC`)
  - result:
    - `statsSource=api-football`
    - `statsFallbackUsed=false`
    - `evidenceMode=full_live_data`
  - conclusion: Live Score does not override a healthy API-Sports stats feed
- Degraded-mode check when fallback is not good enough:
  - fixture `1445911` (`Neftchi Baku vs Imisli FK`)
  - result:
    - `statsSource=api-football`
    - `statsAvailable=false`
    - `statsFallbackUsed=false`
    - `statsFallbackReason=Live Score fallback rejected: api_pairs=0, live_pairs=1, live_quality=VERY_POOR`
    - `evidenceMode=odds_events_only_degraded`
  - conclusion: pipeline stays stable, does not trust weak fallback data, and switches prompt into degraded evidence mode instead

Open observation:

- On the current live slate sampled during this pass, no real match was found where `API-Sports` stats were unusable while `Live Score` simultaneously met the fallback acceptance threshold strongly enough to be chosen as the live stats source.
- That means:
  - the runtime fallback is implemented and test-covered
  - real production benefit still needs more live sampling across additional leagues/time windows
