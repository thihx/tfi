# Operational Call Burn Audit Contract - 2026-06-06

## Mục tiêu

Giảm tình trạng đốt API-Football/LLM quota khi số trận theo dõi ít, nhưng vẫn giữ màn hình Matches live cập nhật nhanh cho các trận có người dùng thật sự quan tâm.

## Dữ liệu vận hành đã kiểm tra

Nguồn dữ liệu production:

- `api_football_request_ledger`
- `ai_gateway_logs`
- `ai_gateway_incidents`
- `ai_gateway_breakers`
- `provider_odds_samples`
- `provider_stats_samples`
- `job_run_history`
- `audit_logs`
- `recommendations`
- `user_match_alert_deliveries`

## Findings

### F1. API-Football quota burn đến từ live refresh và live trigger

Trong 24h gần nhất, ledger cho thấy call lớn nhất:

- `refresh-live-matches /fixtures/statistics`: 1457 calls.
- `refresh-live-matches /fixtures`: 1395 calls.
- `check-live-trigger /fixtures/events`: 931 calls.
- `check-live-trigger /fixtures/statistics`: 930 calls.
- `check-live-trigger /fixtures`: 538 calls.
- `check-live-trigger /odds/live`: 338 calls.
- `check-live-trigger /odds`: 284 calls.

Tại `/status`, provider báo `requests.current=6613`, `requests.limit_day=7500` trước khi hệ thống bắt đầu skip vì `football_api_daily_limit`.

Kết luận: quota burn chủ yếu không phải do số trận user chủ động watch nhiều, mà do cadence live/public refresh và pipeline trigger đang quá dày.

### F2. Public live refresh default bị regression

Tài liệu quota audit cũ yêu cầu `JOB_REFRESH_LIVE_MATCHES_MAX_PUBLIC_MATCHES=0`, nhưng code/config/example đang cho default hoặc deploy example là `20`.

Hậu quả: hệ thống refresh public live/near-live candidates mỗi tick 5s/15s dù user không subscriber trận đó.

### F3. Khái niệm active operational watchlist quá rộng cho 5s refresh

`getActiveOperationalWatchlist()` bao gồm monitored row live/near-live kể cả khi `subscriber_count=0`. Dùng danh sách này cho job 5s làm job tưởng nhiều trận có interest thật.

Kỳ vọng mới: 5s score/status refresh chỉ dành cho match có subscription/subscriber thật. Public refresh chỉ chạy khi operator explicitly opt-in bằng env cap > 0.

### F4. AI live trigger không nên chạy cùng nhịp UI live

Màn hình Matches cần score/status nhanh. AI recommendation trigger cần provider stats/events/odds và tốn call nhiều hơn. Hai cadence này phải tách nhau.

Kỳ vọng mới: `JOB_CHECK_LIVE_MS` default 120s. Score/status vẫn 5s cho subscribed matches.

### F5. LLM loop đã có dữ liệu định danh rõ

24h gần nhất:

- `match_alert_condition_llm / match_alert.adjudicate / match 1546317`: 246 log entries.
- `tfi.unknown / gemini.generate_content`: bị kill-switch block 61 lần.

Kết luận: AI Gateway đủ để định vị LLM burn. Remaining risk là các call không có feature key (`tfi.unknown`) cần được xử lý riêng ở các caller thiếu `aiGatewayContext`.

## Contract thay đổi

1. `refresh-live-matches` dùng subscribed watchlist (`getAutoPipelineOperationalWatchlist`) cho 5s live refresh.
2. Public live refresh default về `0`; chỉ bật bằng `JOB_REFRESH_LIVE_MATCHES_MAX_PUBLIC_MATCHES=N`.
3. `JOB_CHECK_LIVE_MS` default về `120000`.
4. Env examples phải phản ánh default chống quota burn.
5. Unit tests khóa:
   - Default public cap là 0.
   - Default AI live trigger cadence là 120s.
   - Refresh job không gọi provider khi không có subscribed interest và public cap = 0.
   - Refresh job không kéo thêm public candidate khi public cap disabled.

## Expected post-deploy metrics

Sau deploy, kiểm trong `api_football_request_ledger`:

```sql
SELECT coalesce(job_name,'(none)') AS job_name,
       endpoint,
       count(*) AS calls
FROM api_football_request_ledger
WHERE requested_at > now() - interval '2 hours'
GROUP BY 1, 2
ORDER BY calls DESC;
```

Kỳ vọng nếu chỉ có 1 subscribed live match:

- `refresh-live-matches /fixtures`: khoảng 720 calls/hour tối đa ở 5s cadence nếu provider cache buộc real refresh; thấp hơn nếu cache hit.
- `refresh-live-matches /fixtures/statistics`: không vượt quá stats TTL, không còn public/unsubscribed fan-out.
- `check-live-trigger` giảm khoảng 4 lần so với 30s cadence.

Nếu vẫn chạm daily limit sớm:

```sql
SELECT requested_at, job_name, endpoint, params, success, daily_limit, status_code, error
FROM api_football_request_ledger
WHERE requested_at > now() - interval '24 hours'
ORDER BY requested_at DESC
LIMIT 100;
```

Nếu ledger dưới quota nhưng provider dashboard vẫn hết quota, API key có consumer ngoài TFI hoặc provider tính request khác ledger; cần đối chiếu dashboard API-Sports.
