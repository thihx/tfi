# API-Football Odds & Stats Provider Audit - 2026-06-04

## Ket luan ngan

TFI dang dung dung provider boundary: browser khong goi API-Sports truc tiep, server goi qua `packages/server/src/lib/football-api.ts`. Tuy nhien odds va statistics hien tai chi "partial aligned" voi cach API-Football v3 thiet ke.

Van de odds chat luong thap khong nam o mot cho duy nhat. Co 4 nguyen nhan chinh:

1. TFI luon goi `/odds/live` truoc, roi moi fallback `/odds` neu live odds rong.
2. Trong live recommendation pipeline, `freshnessMode: real_required` khong cho fallback sang pre-match khi tran da live, nen nhieu tran se `oddsSource=none` neu `/odds/live` khong co gia.
3. TFI canonical hoa market bang `bet.name` heuristic thay vi dung mapping official bet IDs rieng cho pre-match va live.
4. TFI khong luu/khong khai thac coverage flags cua `/leagues` de biet league/season co `odds`, `statistics_fixtures`, `statistics_players`, `lineups` hay khong.

Voi World Cup, rui ro lon hon: du provider co nhieu du lieu hon cho tran lon, TFI hien chua dung half statistics, player statistics, va coverage-aware routing. He thong van chay, nhung se khong tan dung het du lieu va co the van silent neu live odds khong co/khong canonical duoc.

## Provider docs doi chieu

Nguon chinh:

- API-Sports Football v3 docs: https://api-sports.io/documentation/football/v3
- API-Football docs mirror: https://www.api-football.com/documentation-v3
- API-Football public coverage page: https://www.api-football.com/coverage
- API-Football odds/live docs section: https://www.api-football.com/documentation-v3#tag/Odds-(In-Play)/operation/get-odds-live
- API-Football pre-match odds docs section: https://www.api-football.com/documentation-v3#tag/Odds-(Pre-Match)/operation/get-odds
- API-Football fixtures/statistics docs section: https://www.api-football.com/documentation-v3#tag/Fixtures/operation/get-fixtures-statistics

Docs noi ro cac diem sau:

- `/odds/live` la in-play odds cho fixtures dang/gan live. Fixture duoc them khoang 15-5 phut truoc gio dau va bi xoa 5-20 phut sau khi ket thuc. Khong co history. Update 5-60 giay.
- `/odds` la pre-match odds, co truoc tran 1-14 ngay, giu history 7 ngay, update moi 3 gio.
- `/odds/live/bets` va `/odds/bets` la hai he bet ID rieng. Live bet IDs khong compatible voi pre-match odds.
- Live odds co `status.stopped`, `status.blocked`, `status.finished`, va value-level `main`, `suspended`. Neu co nhieu value giong nhau cho cung bet, `main=true` la value provider khuyen dung.
- `/fixtures/statistics` co `half=true` tu season 2024 de lay fulltime, first half, second half stats.
- Coverage cua competition co the thay doi theo season; `coverage=true` khong dam bao 100% tran co du lieu. Friendlies la exception, du lieu co the khac nhau theo tung match.

## TFI hien dang xu ly odds the nao

Code lien quan:

- `packages/server/src/lib/football-api.ts`
- `packages/server/src/lib/odds-resolver.ts`
- `packages/server/src/lib/server-pipeline.ts`
- `packages/server/src/lib/provider-coverage-audit.ts`

### Diem dung

- Provider call duoc centralize trong `football-api.ts`.
- TFI co ca hai ham:
  - `fetchLiveOdds(fixtureId)` -> `/odds/live?fixture=...`
  - `fetchPreMatchOdds(fixtureId)` -> `/odds?fixture=...`
- TFI normalize duoc hai shape:
  - pre-match: `bookmakers[].bets[]`
  - live: `odds[]`, convert thanh synthetic bookmaker `Live Odds`
- TFI co filter `suspended=true` va odd <= 1.
- TFI co implied margin validation de loai market phi ly.
- TFI co provider odds sample/cache va `provider:coverage-audit` de phan biet raw provider market vs canonical tradable market.

### Lech voi provider semantics

1. Resolver luon thu live odds truoc:

`resolveMatchOddsFromProviders()` goi `fetchLiveOdds()` truoc bat ke match status. Neu live rong, non-live/stale-safe moi goi pre-match. Theo docs, `/odds/live` chi co y nghia trong cua so live/gan live; voi pre-match/upcoming, nen route sang `/odds` truoc.

2. Live pipeline khong fallback pre-match:

`server-pipeline.ts` goi:

```ts
freshnessMode: 'real_required'
```

Neu match status la live va `/odds/live` khong usable, resolver tra `oddsSource='none'` va khong dung `/odds`. Day la quyet dinh an toan, nhung tao silent behavior. Nen tach:

- `actionable_live_odds`: chi live odds moi duoc dung de bet live.
- `reference_prematch_odds`: duoc dua vao prompt nhu context, khong duoc dung de save bet live.

3. Chua dung official bet ID mapping:

TFI dang detect market bang name:

- `match winner`, `fulltime result`, `1x2`
- `over/under`, `total goals`, `match goals`
- `handicap`
- `both teams`, `btts`

Day la brittle, dac biet voi World Cup va bookmaker co nhieu market ten la: first half, second half, corners, player props, 80 minutes, alternate lines. Docs co `odds/bets` va `odds/live/bets`; hai bo ID khac nhau nen TFI nen cache mapping rieng va canonical theo `bet.id + source`.

4. Chua dung `main` cua live odds:

Docs noi `main=true` la value nen consider khi co nhieu identical values. TFI hien lay best odd/max odd across bookmakers/values. Cach nay co loi cho "best price", nhung voi live odds co the pick non-main/stale/alt rung va lam line quality kem. Can luu ca:

- `best_price`
- `main_price`
- `bookmaker_count`
- `line_source`
- `provider_main`
- `suspended/blocked/stopped`

5. Chua co bookmaker quality strategy:

TFI khong filter theo `bookmaker` va khong co config uu tien bookmaker. Voi betting online, odds chat luong nen uu tien complete pairs va bookmaker on dinh. "Best odd across all bookmakers" chi tot khi pairs va line semantics dong nhat.

## TFI hien dang xu ly statistics the nao

Code lien quan:

- `fetchFixtureStatistics()` -> `/fixtures/statistics?fixture=...`
- `fetchFixtureEvents()` -> `/fixtures/events?fixture=...`
- `fetchFixtureLineups()` -> `/fixtures/lineups?fixture=...`
- `buildStatsCompact()` trong `server-pipeline.ts`

### Diem dung

TFI dang compact duoc nhieu stat team-level ma docs cung cap:

- Ball Possession
- Total Shots
- Shots on Goal
- Corner Kicks
- Fouls
- Offsides
- Yellow/Red Cards
- Goalkeeper Saves
- Blocked Shots
- Total passes
- Passes accurate
- Shots off Goal
- Shots insidebox/outsidebox
- Passes %
- `expected_goals`, `goals_prevented` neu provider tra ve

Events cung duoc compact vao prompt, gom goal/card/substitution/VAR style events.

### Khoang trong

1. Chua dung `half=true`.

Docs support `half=true` tu 2024 de lay fulltime, first half, second half statistics. TFI hien chi goi:

```ts
/fixtures/statistics?fixture=...
```

Nen prompt khong co split first-half/second-half pressure. Day la thieu quan trong cho live bet, dac biet cac market H1/H2, HT O/U, late-game momentum.

2. Chua dung `/fixtures/players`.

Docs co endpoint players statistics by fixture, update moi phut cho fixture live. TFI hien chua co function `fetchFixturePlayers` va prompt khong co player-level live stats. Voi World Cup, player stats, rating, shots, key passes, cards, penalties co the rat huu ich.

3. League coverage provider chua duoc persist.

`ApiLeague` type va `leagues` table hien khong luu `coverage`. Vi vay TFI khong biet tu truoc league/season nao co:

- odds
- fixture statistics
- player statistics
- lineups
- injuries/predictions

Dieu nay lam he thong khong phan biet duoc "provider khong cover" voi "TFI fetch/parse hong".

## Rui ro rieng cho World Cup

World Cup la cup/international competition. Theo docs, cup fixtures co the duoc add khi xac dinh doi tham du, va coverage co the thay doi theo season. Voi international/friendly/cup context, TFI khong nen mang logic domestic league profile qua qua manh.

Rui ro hien tai:

- Neu match live nhung `/odds/live` khong co market TFI canonical duoc, pipeline se `oddsSource=none`.
- Neu provider co nhieu market World Cup hon, TFI van chi lay/canonical mot tap nho: 1X2, goals O/U, AH, BTTS, corners, HT variants.
- Neu provider co rich player stats, TFI khong lay.
- Neu provider co half split stats, TFI khong lay.
- Neu league coverage bao `statistics_players=false` hoac `odds=false`, TFI khong doc coverage de dieu chinh expectation/UI.

## De xuat sua theo thu tu uu tien

### P0 - Audit va routing odds dung semantics

1. Sua resolver routing theo status:
   - `NS/TBD`: goi `/odds` truoc, cache 3h.
   - `1H/2H/HT/ET/LIVE`: goi `/odds/live` truoc, cache 5-30s.
   - live odds missing: cho phep fetch `/odds` lam `reference_prematch_context`, nhung khong set `oddsAvailable=true` cho bet live.

2. Tach output:
   - `actionableOddsCanonical`
   - `referenceOddsCanonical`
   - `oddsActionable=false` neu chi co pre-match trong live.

3. Audit stored samples:
   - live missing by league/status/minute
   - raw_has_* vs canonical_has_*
   - reject reason: missing pair, invalid margin, unsupported name, suspended, non-main.

### P1 - Official bet mapping

1. Them cached reference endpoints:
   - `/odds/bets`
   - `/odds/live/bets`
   - `/odds/bookmakers`

2. Tao mapping rieng:
   - `prematchBetMap`
   - `liveBetMap`

3. Canonical market bang `source + bet.id`, fallback name chi la defensive.

### P1 - World Cup coverage readiness

1. Luu `coverage` tu `/leagues` vao DB:
   - `coverage_odds`
   - `coverage_fixtures_events`
   - `coverage_fixtures_lineups`
   - `coverage_statistics_fixtures`
   - `coverage_statistics_players`

2. Them provider readiness report theo competition:
   - World Cup league ID/season
   - fixtures count
   - odds coverage
   - live odds sample success
   - stats/events/lineups/player stats availability

Status 2026-06-04:

- Added migration `060_league_provider_coverage.sql`.
- Added migration `061_league_provider_coverage_history.sql` because provider coverage is dynamic, not fixed. Current columns in `leagues` are only the latest known state; `league_provider_coverage_history` stores deduplicated snapshots by coverage hash.
- `refreshLeagueCatalog()` now persists `seasons[].coverage` from `/leagues` into `leagues.provider_coverage` plus queryable booleans:
  - `coverage_odds`
  - `coverage_fixtures_events`
  - `coverage_fixtures_lineups`
  - `coverage_fixtures_statistics`
  - `coverage_fixtures_players`
  - `coverage_players`
  - `coverage_predictions`
  - `coverage_standings`
- Added odds quality report:

```powershell
npm run provider:odds-quality-report --prefix packages/server -- --lookback-days 30 --limit 5000 --out-json replay-work/audit/provider-odds-quality.json --out-md replay-work/audit/provider-odds-quality.md
```

Run league catalog refresh/sync before relying on coverage columns. Until then, historical samples can still show raw/canonical odds quality, but `coverage_*` fields may be `null`.

For historical odds samples, prefer `provider:odds-quality-report` over direct joins to `leagues`. The report uses coverage history as-of `provider_odds_samples.captured_at`, then falls back to current league coverage only when no historical snapshot exists.

Coverage refresh command:

```powershell
npm run provider:coverage-refresh --prefix packages/server -- --mode active-top
```

Targeted single-league probe:

```powershell
npm run provider:coverage-refresh --prefix packages/server -- --mode ids --ids 39 --force
```

Status 2026-06-04 23:13 KST: API-Football circuit is still open until `2026-06-05T00:00:00Z`, so coverage refresh currently fails fast without calling the provider. Run the command after quota reset.

### P2 - Rich stats for live signal quality

1. Them `fetchFixtureStatistics(fixtureId, { half: true })`.
2. Compact first-half/second-half stats vao prompt:
   - H1 shots, shots on target, corners, possession, xG, cards.
   - H2 delta/current pressure.
3. Them `/fixtures/players` cho high-value competitions only, co cache TTL va quota guard.
4. Prompt rules: player stats la secondary live evidence, khong override odds/score/status.

## Ket luan

TFI khong "sai endpoint" o muc co ban, nhung dang sai/lech o muc product semantics:

- dung live endpoint qua rong,
- khong route theo status,
- khong dung official bet mapping,
- khong tan dung `main`,
- khong dung provider coverage de dat expectation,
- chua khai thac half/player stats cho tran lon.

Neu muon tang chat luong odds va san sang World Cup, nen uu tien P0/P1 truoc khi tiep tuc prompt tuning.
