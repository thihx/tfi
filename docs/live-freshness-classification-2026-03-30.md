# Live Freshness Classification

Date: 2026-03-30

## Goal

Phan loai ro cac path trong he thong theo 3 muc:

- `must-real`: user-facing live, khong duoc dua vao stale cache. Neu khong xac minh duoc du lieu chua doi, phai fetch real.
- `stale-while-safe`: duoc phep doc cache khi du lieu bien dong cham hoac khong anh huong truc tiep den man hinh live cua user.
- `background-prewarm`: job/flow nen chay nen de warm cache, khong duoc quyet dinh trai nghiem live cua user.

Nguyen tac chot cho he thong nay:

- Live screen cua user uu tien freshness truoc cost.
- LLM response cache khong ap dung cho live path.
- Football/live provider cache chi duoc dung khi path do khong thuoc `must-real`, hoac co co che chung minh state chua doi.

## Classification Matrix

### 1. Must-Real

Nhung path nay phai coi freshness la yeu cau cap 1.

| Path / job / flow | Consumer | Why it is `must-real` | Cache policy |
| --- | --- | --- | --- |
| `GET /api/matches` via `MatchesTab` | man hinh danh sach tran dang xem live | UI poll `3s`, user thay score, minute, cards ngay tren list | DB route co the `no-store`, nhung du lieu backing phai duoc cap nhat real; khong duoc xem `15s` stale la chap nhan duoc |
| `refresh-live-matches` | nguon cap nhat cho `/api/matches` | day la feed chinh de cap nhat live score/card trong DB | chi nen dung cache neu provider state duoc xac nhan chua doi; neu khong phai fetch real |
| `POST /api/proxy/football/scout` khi match da bat dau | `MatchScoutModal` live view | hien thi score header, events, statistics, lineups | khong duoc tra stale payload cho live fixture/events/stats/lineups |
| `POST /api/proxy/football/odds` khi status live | live analysis, live pricing UI/logic | odds la du lieu bien dong nhanh, stale va 10s tre da co the sai quyet dinh | khong duoc hit stale fallback cho live; cache chi la artifact quan sat, khong phai source tra ve |
| `POST /api/live-monitor/matches/:matchId/analyze` | manual live analysis | ket qua AI/pipeline phu thuoc truc tiep vao stats/events/odds live | input provider cua pipeline phai real-first, khong dung stale fallback cho live |
| `check-live-trigger` + `runPipelineBatch` | auto live engine | quyet dinh save recommendation / send notification | gate live va input provider phai real-first; stale chi duoc dung cho telemetry/debug, khong dung de quyet dinh user-facing |

### 2. Stale-While-Safe

Nhung path nay co the doc cache neu co TTL / validation hop ly, vi khong phai live user-facing cap cao.

| Path / flow | Consumer | Why `stale-while-safe` is acceptable | Cache policy |
| --- | --- | --- | --- |
| `GET /api/recommendations/dashboard` | `DashboardTab` | so lieu tong hop / KPI, khong phai live tick-by-tick | doc DB/cache duoc, refresh theo reload/tab open |
| `GET /api/ai-performance/stats`, `/stats/by-model` | `DashboardTab` | bao cao hieu nang lich su | cache/aggregate an toan |
| `GET /api/reports/*` | `ReportsTab` | analytics lich su, khong anh huong live screen | stale theo phut/gio la chap nhan duoc |
| `GET /api/live-monitor/status` | `LiveMonitorTab` | day la man hinh van hanh job, khong phai feed live cho bettor | stale ngan chap nhan duoc |
| `POST /api/proxy/football/scout` khi `NS` | `MatchScoutModal` prematch view | prediction, standings, H2H, prematch context khong can real-time tung giay | TTL dai hon hop ly |
| `GET /api/proxy/football/league-fixtures` | `LeagueFixturesDialog` | upcoming fixtures / season view, khong phai live board chinh | da di qua reference-data provider trung tam, cache ngan theo season / query |
| `fetch-matches` | ingest lich thi dau hom nay / ngay mai | chu yeu phuc vu schedule + archiving, khong phai tick live score chinh | adaptive polling + central cache la hop ly |
| `update-predictions` | warm prediction cho watchlist `NS` | du lieu prematch, chi can doi moi truoc gio bong lan | cache duoc, negative cache duoc |
| `auto-settle` | ket qua sau tran | sau FT, freshness cap giay khong can thiet | co the dung cached finished payload/statistics |
| `re-evaluate` | audit/chinh lai settlement | flow backoffice | co the dung cached finished payload/statistics |

### 3. Background-Prewarm

Nhung path nay khong duoc coi la source su that cua live screen. Chung co the warm cache, sample data, hoac sync reference data.

| Job / flow | Role | Policy |
| --- | --- | --- |
| `refresh-provider-insights` | prewarm non-live scout domains cho watchlist | chi warm non-live; khong duoc chen vao live UI contract |
| `enrich-watchlist` | strategic context / recommended conditions | background only; duoc cache va backoff |
| `sync-reference-data` | league catalog + team directory | reference-data only |
| `integration-health` | probe external services | monitoring only |
| `health-watchdog` | watchdog scheduler | monitoring only |
| `expire-watchlist` | cleanup | khong lien quan freshness |
| `purge-audit` | retention cleanup | khong lien quan freshness |

## Current Code Reality

Sau phase freshness-mode, nhung diem sau da duoc siet lai:

### A. Live provider boundary da co semantic `real_required`

Da ap dung cho:

- `refresh-live-matches`
- live `proxy/football/scout`
- live `proxy/football/odds`
- `runPipelineBatch()`
- `runManualAnalysisForMatch()`

Hanh vi moi:

- live path khong con an `stale_fallback` tu central boundary;
- live path khong duoc tai su dung cache-hit theo TTL nhu mot shortcut "fresh enough";
- live odds khong duoc roi xuong `reference-prematch` nua khi dang o status live.

### B. Budget scheduler live mac dinh da duoc ha xuong 5s

- `JOB_REFRESH_LIVE_MATCHES_MS`: `5s`
- `JOB_CHECK_LIVE_MS`: `5s`

Ket luan:

- thuc te da tot hon muc `15s` truoc day;
- nhung freshness cuoi cung van phu thuoc provider round-trip + DB update, khong phai websocket true realtime.

### C. Reference-data path chinh da co boundary rieng

Da dua qua reference-data provider helper:

- `league-catalog.service.ts`
- `league-team-directory.service.ts`
- `GET /api/proxy/football/league-fixtures`

Ket luan:

- live insight boundary va reference-data boundary da tach ro;
- phan con lai khong nam o Football API runtime path chinh.

## Recommended Enforcement Rules

Neu tiep tuc refactor, nen ap dung policy theo consumer thay vi theo endpoint chung chung.

### Rule 1. Moi provider boundary phai nhan freshness mode

De xuat 3 mode ro rang:

- `real_required`
- `stale_safe`
- `prewarm_only`

Y nghia:

- `real_required`: khong duoc tra `stale_fallback`; cache chi duoc dung neu co bang chung state khong doi.
- `stale_safe`: duoc tra hit theo TTL va cho phep fallback khi provider loi.
- `prewarm_only`: chi warm / persist, khong duoc xem la truth source cho UI live.

### Rule 2. Tach cache artifact va response contract

Cho live path:

- van co the luu cache de observability / dedupe / so sanh;
- nhung response tra cho consumer live khong duoc lay tu stale cache.

### Rule 3. Phai budget freshness theo man hinh, khong theo job

Hien tai `MatchesTab` co budget `3s`, trong khi data source scheduler live mac dinh la `5s`.

Can chot theo consumer:

- live list / live modal / live odds / live pipeline: freshness budget < 10s
- dashboard / reports / ops monitor: budget theo phut/gio

## Concrete Classification To Use Going Forward

### Must-Real

- `MatchesTab` live row data
- `refresh-live-matches`
- live `MatchScoutModal`
- live odds
- live pipeline analyze/trigger flows

### Stale-While-Safe

- dashboard
- reports
- prematch scout
- prematch predictions
- league fixtures dialog
- auto-settle
- re-evaluate
- live monitor ops screen

### Background-Prewarm

- refresh provider insights for non-live watchlist
- enrich watchlist
- sync reference data
- monitoring/watchdog/cleanup jobs

## Bottom Line

Centralization da ton tai o nhieu hot path, nhung semantic freshness chua duoc centralize dung muc.

Van de cot loi hien tai khong con la "moi noi goi provider mot kieu" nhu truoc, ma la:

- chua co freshness contract thong nhat theo `consumer intent`
- live path van cho phep stale fallback
- live list freshness dang bi khoa boi interval job `15s`

Do do, neu muc tieu la live-first that su, phase tiep theo khong nen la them cache, ma la:

1. tach `real_required` khoi `stale_safe` trong provider boundary
2. khoa stale fallback tren live user-facing path
3. dua freshness budget cua `refresh-live-matches` xuong muc phu hop voi UX live
