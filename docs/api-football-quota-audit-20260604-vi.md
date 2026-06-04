# API-Football Quota Audit - 2026-06-04

## Context

TFI đang dùng API-Football Pro với ngân sách khoảng 7,000 request/ngày. Sau một giai đoạn hệ thống ít hoặc không hoạt động trong 1-2 tuần, quota bắt đầu hết liên tục dù người vận hành không watch nhiều trận.

Audit này không gọi API-Football trực tiếp. Các số liệu bên dưới lấy từ production DB/Redis và code runtime.

## Timeline Quan Trọng

- `2026-06-03T21:30:17Z`: hệ thống bắt đầu ghi nhận `football_api_daily_limit`, circuit mở đến `2026-06-04T00:00:00Z`.
- `2026-06-04T00:00:02Z`: sau khi circuit cũ hết hạn, `fetch-matches` là job đầu tiên probe lại provider và fail với `Both fixture API calls failed`.
- `2026-06-04T00:00:17Z`: circuit mới mở đến `2026-06-05T00:00:00Z`.
- Redis counter nội bộ `football-api:daily-count:2026-06-04` chỉ khoảng `8`, trong khi provider/circuit báo daily limit. Điều này chứng minh counter cũ undercount nặng hoặc API key còn bị tiêu bởi consumer khác.

## Findings

1. `refresh-live-matches` trước đây refresh public live/near-live candidates, không phụ thuộc hoàn toàn vào watchlist. Vì vậy người dùng không mở watch trận nào vẫn có thể tiêu API nếu DB đang có live/near-live rows.

2. `refresh-live-matches` có default public limit `40`. Với interval live job dày và cache TTL live chỉ khoảng 30-45 giây, vài trận live có thể tạo call đều đặn cả ngày. Job history lại sampling success mỗi 20 lần, nên nhìn history thưa hơn thực tế.

3. `fetch-matches` quét 3 ngày `yesterday/today/tomorrow` theo toàn bộ active leagues. Production hiện có `155` active leagues. Khi cache lạnh/stale sau downtime, job này không chỉ lấy fixtures mà còn có thể kéo stats cho live/finished playable matches.

4. Counter quota cũ chỉ increment sau response success trong `apiGet`. Nó không đếm `/status`, 429, daily-limit response, failed response, retry attempts, hoặc request bị provider tính quota nhưng app xử lý là failure.

5. Khi daily-limit circuit hết hạn, probe đầu tiên không phải một request nhẹ có kiểm soát mà là full job `fetch-matches`. Nếu provider vẫn báo limit hoặc quota reset lệch, job đó có thể mở circuit lại ngay và không để lại đủ chi tiết endpoint-level.

## Changes Implemented

- Added `api_football_request_ledger` table to record every outbound API-Football attempt.
- Added scheduler request context so ledger can attribute calls by `job_name`.
- Changed quota counting to count outbound attempts, including failure/status/daily-limit attempts.
- Changed `refresh-live-matches` to watch-first behavior:
  - default `JOB_REFRESH_LIVE_MATCHES_MAX_PUBLIC_MATCHES=0`
  - no active watch interest means no public live refresh
  - watched matches are still refreshed normally

## How To Read The New Ledger

```sql
SELECT date_trunc('hour', requested_at) AS hour,
       job_name,
       endpoint,
       COUNT(*) AS calls,
       COUNT(*) FILTER (WHERE daily_limit) AS daily_limit_hits,
       COUNT(*) FILTER (WHERE success) AS success_calls
FROM api_football_request_ledger
WHERE requested_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1, 2, 3
ORDER BY hour DESC, calls DESC;
```

```sql
SELECT requested_at, job_name, endpoint, params, attempt, status_code,
       success, daily_limit, quota_current, quota_limit, error
FROM api_football_request_ledger
WHERE requested_at >= NOW() - INTERVAL '24 hours'
ORDER BY requested_at DESC
LIMIT 100;
```

## Remaining Open Question

Nếu sau khi ledger chạy mà provider vẫn báo hết quota trong khi ledger không ghi gần đủ 7,000 attempts/ngày, khả năng cao API key đang bị dùng bởi consumer khác ngoài TFI hoặc provider dashboard tính request theo cách khác cần đối chiếu với `/status` và dashboard API-Sports.
