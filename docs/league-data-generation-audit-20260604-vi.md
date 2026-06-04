# League Data Generation Audit

**Ngày audit:** 2026-06-04  
**Phạm vi:** League catalog, active/top league scope, league-team directory, derived league/team profiles, prematch expert features, và tác động tới API-Football quota / chất lượng dự đoán.

## Kết luận nhanh

League data hiện **có ích**, nhưng đang bị dùng sai scope. Vấn đề chính không phải là có nên tạo League/Profile hay không, mà là cờ `active` đang gánh quá nhiều nghĩa:

- league được hiển thị/được user bật
- league được giữ lại trong match slate
- league được sync team directory
- league được đưa vào prematch profile derivation
- league có thể kéo thêm historical fixture/event backfill

Khi hệ thống bị ngưng 1-2 tuần, cache/provider snapshots stale cùng lúc. Lúc bật lại, `sync-reference-data` có thể quét toàn bộ 155 active leagues, trong đó nhiều league không có tín hiệu sử dụng gần đây. Đây là một root-cause rất hợp lý cho cảm giác "trước đây dùng thoải mái, sau downtime thì quota hết liên tục".

## Luồng tạo dữ liệu hiện tại

### 1. League catalog

Runtime:

- `packages/server/src/lib/league-catalog.service.ts`
- `packages/server/src/repos/leagues.repo.ts`

`refreshLeagueCatalog({ mode: 'active-top' })` lấy tất cả league đang `active` hoặc `top_league`, sau đó refresh từng league stale qua `/leagues?id=...`.

Điểm ổn:

- Catalog có TTL 7 ngày, không phải nguồn tốn call hàng ngày.
- Existing `active` được preserve khi upsert, tránh provider refresh tự reset lựa chọn user.

Điểm rủi ro:

- `active` bị coi như runtime processing scope.
- Hard-coded classifier có một số rule cần rà lại theo provider ID. Ví dụ `TOP_COUNTRIES.China.tier1 = [17]` là đáng nghi vì ID 17 trong dữ liệu runtime từng xuất hiện như một giải châu Á/world-level, không phải domestic China league.

### 2. Fetch matches

Runtime:

- `packages/server/src/jobs/fetch-matches.job.ts`

Job fetch fixture theo date window `yesterday/today/tomorrow`, rồi filter bằng `getActiveLeagues()`. Active league count không làm tăng số call `/fixtures?date=...` trực tiếp, nhưng nó làm rộng match slate, kéo theo downstream processing, stats archive, watchlist candidates và live analysis candidates.

Hiện production snapshot cho thấy:

- `active_leagues = 155`
- chỉ `6` active leagues có current matches
- `74` active leagues có history 30 ngày
- `86` active leagues có history 90 ngày
- `69` active leagues không có current match và không có history 90 ngày

=> Match scope đang rộng hơn nhu cầu thực tế.

### 3. League-team directory

Runtime:

- `packages/server/src/jobs/sync-reference-data.job.ts`
- `packages/server/src/lib/league-team-directory.service.ts`
- `packages/server/src/lib/football-api.ts`

`sync-reference-data` lấy:

```text
orderedIds = topLeagues + activeLeagues
```

Sau đó gọi `refreshLeagueTeamsDirectoryNow(leagueId)` cho từng league.

Mỗi league stale có thể tạo nhiều provider calls:

- `/teams?league={id}&season={currentYear}`
- nếu empty: `/teams?league={id}&season={currentYear - 1}`
- nếu vẫn empty: `/leagues?id={id}` để lấy danh sách seasons
- fallback qua các season còn lại bằng `/teams`
- nếu có teams: `/standings?league={id}&season={season}` best-effort

Directory TTL DB là 24h, job interval là 12h. Nếu dữ liệu stale sau downtime, run đầu có thể refresh hàng loạt.

Production job history gần nhất cho thấy:

- `2026-06-03 15:23`: `candidateLeagues=155`, `refreshedLeagues=147`
- `2026-06-02 09:26`: `candidateLeagues=155`, `refreshedLeagues=148`
- `2026-05-31 16:53`: `candidateLeagues=155`, `refreshedLeagues=146`

Snapshot directory/profile:

- `active_with_directory = 155`
- `active_directory_team_rows = 7216`
- `active_with_league_profile = 58`
- `active_without_league_profile = 97`
- `active_directory_any_stale = 7` tại thời điểm query sau khi job đã chạy

=> Directory sync đang tạo dữ liệu rất rộng, nhưng không phải tất cả đều được dùng hiệu quả cho prediction.

### 4. Prematch profile derivation

Runtime:

- `packages/server/src/lib/prematch-profile-sync.ts`
- `packages/server/src/lib/prematch-profile-team-candidates.ts`

Scope hiện tại:

```text
prematchProfileLeagueIds = topLeagues + activeLeagues eligible by tactical-overlay classification
```

Job history cho thấy mỗi run đang derive khoảng:

- `candidateLeagues = 85`
- `candidateTeams ~= 1417-1421`
- `refreshedLeagueProfiles ~= 55`
- `refreshedTeamProfiles ~= 856-865`

Nếu history coverage thiếu, `syncDerivedPrematchProfiles` có thể backfill:

- `/fixtures?league={id}&season={season}` cho league/season thiếu coverage
- event summary hydration qua `ensureMatchInsight(... includeStartedDetails=true, refreshOdds=false)`, có thể kéo fixture, statistics, events tùy cache/freshness

Điểm tích cực:

- Có quota-tier guard: nếu Football API tier `high` hoặc `critical`, backfill/event hydration sẽ skip.
- Dữ liệu profile được đưa vào prompt như secondary prior, không được phép override live evidence.

Điểm chưa tối ưu:

- Profile derivation chạy trên scope rộng, không dựa đủ mạnh vào utility signal như current matches, active watch, recent history, hoặc replay lift.
- 85 league / 1.4k team candidates mỗi run là lớn so với giá trị thực tế nếu đa số trận live không thuộc các league đó.

## Dữ liệu League có hữu ích cho dự đoán không?

Có, nhưng chỉ trong vai trò **prematch prior mềm**:

- League profile giúp calibrate goal tempo, BTTS, late-goal, corners/cards, volatility.
- Team profile giúp build `PREMATCH_EXPERT_FEATURES_V1`, gồm projected goal environment, pressure, set-piece/card/corner tendencies, reliability/noise penalty.
- Prompt đã có rule rõ: live stats/events/odds vẫn là primary evidence.

Điểm yếu hiện tại là chưa có bằng chứng replay riêng cho incremental lift của League/Profile layer. Vì vậy không nên để layer này mở rộng provider scope quá rộng cho tới khi có measurement:

- replay có profile vs replay không profile
- segment ROI/hit-rate theo `prematchAvailability`
- no-save / policy-block cases có profile mạnh nhưng bị block
- market families nào thật sự hưởng lợi từ league/team priors: totals, BTTS, corners, cards, AH

## Đối chiếu provider docs

API-Football documentation nêu các endpoint league/team/fixture/standings có recommended call cadence theo loại dữ liệu, nhiều endpoint reference không-live ở mức khoảng 1 lần/ngày hoặc chỉ khi cần. Tài liệu chính: https://www.api-football.com/documentation-v3

TFI hiện không sai về mặt endpoint, nhưng scope quá rộng: daily-ish refresh cho 155 league directories và recurring prematch profile sync cho 85 league / 1.4k teams là chưa tương xứng với runtime value đang quan sát.

## Root-cause nhận định

Root cause có khả năng cao:

1. `active` bị overloaded thành processing scope.
2. `sync-reference-data` dùng `top + active` quá rộng cho team directory.
3. Prematch profile sync dùng `top + approved active` quá rộng cho derived profile.
4. Sau downtime, cache stale đồng loạt khiến refresh hàng loạt xảy ra trong vài run.
5. League/Profile layer chưa có measurement chứng minh scope rộng hiện tại tạo lift đủ bù quota/cost.

Root cause này khác với fix quota ledger trước đó: ledger giúp đo đúng, còn audit này chỉ ra một nguồn tiêu thụ thật trong reference-data generation.

## Kế hoạch cải thiện đề xuất

### Phase 1 - Giảm quota burn nhưng giữ an toàn prediction

Tách runtime scope khỏi `active`.

Thêm helper `resolveReferenceDataLeagueScope()` với 3 nhóm:

- `directoryScope`: top leagues + active leagues có current match + active leagues có history 30/90 ngày + explicit watched/favorite leagues.
- `profileScope`: top leagues + eligible active leagues có current/history utility signal.
- `catalogScope`: vẫn active/top như hiện tại, vì catalog nhẹ hơn và TTL 7 ngày.

Không nên tắt toàn bộ active leagues khỏi match fetch ngay, vì user vẫn cần thấy trận. Nhưng reference-data/profile sync nên dùng scope hẹp hơn.

### Phase 2 - Thêm budget/cooldown

Thêm env:

```text
SYNC_REFERENCE_DATA_MAX_DIRECTORY_REFRESH_PER_RUN=40
SYNC_REFERENCE_DATA_MAX_PROFILE_LEAGUES_PER_RUN=40
SYNC_REFERENCE_DATA_RECENT_HISTORY_DAYS=90
SYNC_REFERENCE_DATA_IDLE_CUP_COOLDOWN_DAYS=30
```

Xử lý stale oldest-first, không refresh tất cả trong một run.

### Phase 3 - Đo usefulness

Thêm replay experiment:

- baseline hiện tại
- profile-disabled replay
- league-profile-only replay
- team-profile-only replay

Gates cần đọc:

- saved/actionable rate
- win-rate/ROI theo market family
- policy-blocked winners
- LLM no-bet rate khi profile available vs unavailable

Chỉ giữ scope rộng cho segment có lift rõ.

### Phase 4 - UI/Product

Trong Settings/League, tách nhãn:

- `Show Matches`
- `Watch/Auto Add`
- `Reference Sync`
- `Prediction Profile`

Không để user hiểu nhầm "Active" là một toggle duy nhất.

## Next step khuyến nghị

Next code step hợp lý nhất:

1. Implement `resolveReferenceDataLeagueScope()` cho `sync-reference-data`.
2. Scope directory sync theo utility signal, không còn toàn bộ 155 active leagues.
3. Scope prematch profile sync theo approved + useful leagues.
4. Ghi summary job thêm:
   - `directoryScopeExcludedLeagues`
   - `profileScopeExcludedLeagues`
   - `excludedNoRecentSignal`
5. Chạy unit tests + deploy.

Điểm cần thận trọng: không deactivate league trong DB ở bước này. Chỉ thu hẹp background reference-data/profile work trước, vì đây là thay đổi ít rủi ro nhất đối với trải nghiệm user.

## Phase 1 implementation note

Đã triển khai bước thu hẹp background scope trong `sync-reference-data`:

- League catalog vẫn dùng active/top như cũ.
- League-team directory sync chỉ giữ top leagues và active leagues có ít nhất một utility signal:
  - current match
  - match history trong `SYNC_REFERENCE_DATA_RECENT_HISTORY_DAYS`
  - favorite-team membership
- Prematch profile derivation dùng cùng active utility scope, sau đó mới áp tactical-overlay eligibility như trước.
- Job summary ghi thêm:
  - `directoryScopeExcludedLeagues`
  - `profileScopeExcludedLeagues`
  - `excludedNoRecentSignal`
  - `favoriteSignalLeagues`
  - `currentMatchSignalLeagues`
  - `recentHistorySignalLeagues`

Dry-run production sau thay đổi:

- `activeLeagues`: 155
- `directoryScope`: 86
- `profileActiveScope`: 86
- `excludedNoRecentSignal`: 69
- `topLeagues`: 21
- `currentMatchSignalLeagues`: 6
- `recentHistorySignalLeagues`: 65
- `favoriteSignalLeagues`: 0

## Phase 2 implementation note

Đã triển khai budget/cooldown nhẹ cho `sync-reference-data`:

- Job đọc freshness của `league_team_directory` từ DB trước khi gọi provider refresh.
- League directory còn fresh được tính vào `skippedFreshLeagues` và không gọi `refreshLeagueTeamsDirectoryNow`.
- League directory stale mới được đưa vào refresh queue.
- Stale refresh queue bị giới hạn bởi `SYNC_REFERENCE_DATA_MAX_DIRECTORY_REFRESH_PER_RUN`.
- Stale league vượt budget được ghi `directoryRefreshDeferredLeagues` và để sang run sau.
- Prematch profile derivation bị giới hạn bởi `SYNC_REFERENCE_DATA_MAX_PROFILE_LEAGUES_PER_RUN`.
- Priority khi chọn stale/profile league:
  - top league
  - current match signal
  - favorite-team signal
  - recent history volume
  - older/no profile first

Env mới:

```text
SYNC_REFERENCE_DATA_MAX_DIRECTORY_REFRESH_PER_RUN=40
SYNC_REFERENCE_DATA_MAX_PROFILE_LEAGUES_PER_RUN=40
```

Job summary mới:

- `directoryStaleCandidateLeagues`
- `directoryRefreshBudget`
- `directoryRefreshAttemptedLeagues`
- `directoryRefreshDeferredLeagues`
- `profileScopeCandidateLeagues`
- `profileScopeDeferredLeagues`
- `profileScopeBudget`

Dry-run production sau Phase 2:

- `activeLeagues`: 155
- `topLeagues`: 21
- `directoryScope`: 86
- `excludedNoRecentSignal`: 69
- `directoryFresh`: 2
- `directoryStale`: 84
- `directoryRefreshBudget`: 40
- `directoryRefreshAttempted`: 40
- `directoryDeferred`: 44
- `approvedProfileCandidates`: 40
- `profileBudget`: 40
- `profileSelected`: 40
- `profileDeferred`: 0
