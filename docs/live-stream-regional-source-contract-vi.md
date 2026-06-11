# Live Stream Regional Source Contract

## Mục Tiêu

Tính năng live stream phải chọn nguồn phát theo vùng của người dùng để ưu tiên nguồn/provider hợp lệ tại quốc gia đó. Frontend không tự quyết định quyền hiển thị theo country; backend là nơi xác định vùng, lọc source, và enforce lại khi lookup/phát stream.

Contract này áp dụng cho tính năng live stream/tivi trong Matches/Settings, không áp dụng cho live recommendation pipeline.

## Vấn Đề Hiện Tại

Runtime hiện có:

- Admin cấu hình `providerUrls` trong `Settings -> Live Streams`.
- Backend lưu qua `/api/settings/live-stream-locator`.
- Matches tab gọi `/api/matches/live-streams/lookup`.
- Server scan homepage provider rồi match tên đội để trả về link live.

Giới hạn:

- `providerUrls` chưa biết nguồn nào hợp lệ ở country nào.
- UI hiện link theo kết quả lookup chung, không phân vùng.
- Nếu một provider bị chặn hoặc không có quyền phát ở Việt Nam, user Việt Nam vẫn có thể thấy hoặc cố mở link đó.

## Nguyên Tắc

1. Backend là nguồn sự thật cho country.
2. UI chỉ hiển thị sources backend trả về.
3. Source phải khai báo country bằng ISO 3166-1 alpha-2, ví dụ `VN`, `KR`, `TH`.
4. Không dùng text tự do như `Vietnam`, `Korea`, `Việt Nam`.
5. Region filtering phải chạy ở cả lookup list và stream/open endpoint nếu có.
6. Nếu không xác định được country, dùng fallback rõ ràng, không mặc định mở toàn bộ nguồn theo vùng.
7. Không dùng giải pháp này để lách bản quyền hoặc phát lại nguồn không có quyền sử dụng.

## Data Model

Thay `providerUrls: string[]` bằng `sources: LiveStreamSource[]`. Giữ `providerUrls` trong một giai đoạn chuyển tiếp để backward compatibility.

```ts
export interface LiveStreamSource {
  id: string;
  name: string;
  url: string;
  countries: string[];
  priority: number;
  active: boolean;
  sourceType: 'provider_homepage' | 'direct_hls' | 'external_page';
  notes?: string;
}
```

Ý nghĩa:

- `id`: định danh ổn định, do server tạo nếu admin không truyền.
- `name`: tên hiển thị trong Settings và title button, ví dụ `VTV Official`, `K League TV`.
- `url`: homepage/provider URL hoặc direct stream URL tùy `sourceType`.
- `countries`: danh sách country được phép. Dùng `['VN']`, `['KR']`, hoặc `['*']` cho global fallback.
- `priority`: số nhỏ hơn được ưu tiên trước.
- `active`: source tắt thì không dùng cho lookup.
- `sourceType`: giúp backend biết cách xử lý URL.

Validation:

- `url` chỉ nhận `http` hoặc `https`.
- `countries` chỉ nhận `*` hoặc mã 2 chữ cái uppercase.
- Mỗi source phải có ít nhất một country.
- Tối đa mặc định 50 sources.
- Không cho duplicate cùng `url + countries + sourceType`.

Ví dụ:

```json
{
  "enabled": true,
  "sources": [
    {
      "id": "vn-vtv-official",
      "name": "VTV Official",
      "url": "https://example.vn/live/",
      "countries": ["VN"],
      "priority": 10,
      "active": true,
      "sourceType": "provider_homepage"
    },
    {
      "id": "kr-official",
      "name": "Korea Official Provider",
      "url": "https://example.kr/live/",
      "countries": ["KR"],
      "priority": 10,
      "active": true,
      "sourceType": "provider_homepage"
    },
    {
      "id": "global-fallback",
      "name": "Global Fallback",
      "url": "https://global.example/live/",
      "countries": ["*"],
      "priority": 100,
      "active": true,
      "sourceType": "external_page"
    }
  ],
  "timeoutMs": 3500,
  "cacheTtlMs": 180000,
  "maxMatches": 30
}
```

## Country Resolver

Backend thêm helper:

```ts
export interface ResolvedViewerRegion {
  country: string | null;
  source: 'cloudflare' | 'trusted_proxy_header' | 'geoip' | 'override' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
}
```

Thứ tự resolve khuyến nghị:

1. Trusted CDN header, ví dụ `CF-IPCountry`, nếu deploy sau Cloudflare.
2. Trusted proxy header nội bộ, ví dụ `X-TFI-Country`, chỉ tin khi request đi qua proxy đã kiểm soát.
3. GeoIP lookup từ client IP.
4. Dev/admin override chỉ bật ở non-production hoặc theo allowlist.
5. Unknown.

Không dùng browser locale/timezone để enforce quyền phát.

Config env đề xuất:

```env
LIVE_STREAM_REGION_ENABLED=true
LIVE_STREAM_REGION_UNKNOWN_POLICY=global_only
LIVE_STREAM_TRUST_CF_IPCOUNTRY=true
LIVE_STREAM_TRUSTED_COUNTRY_HEADER=
LIVE_STREAM_DEV_COUNTRY_OVERRIDE=
```

`LIVE_STREAM_REGION_UNKNOWN_POLICY`:

- `global_only`: chỉ dùng source `countries: ['*']`.
- `hide_all`: không trả source nào.
- `allow_all`: chỉ dùng trong dev/test, không dùng production.

## Filtering Rules

Backend lọc source theo thứ tự:

1. `enabled === true`
2. `source.active === true`
3. source country match:
   - exact country match, ví dụ user `VN` và source có `VN`
   - hoặc global source có `*`
4. sort theo:
   - exact country trước global
   - `priority` tăng dần
   - `name` tăng dần để deterministic

Nếu user ở `VN`:

- Source `countries: ['VN']` được dùng.
- Source `countries: ['KR']` không được dùng.
- Source `countries: ['*']` chỉ dùng như fallback/global.

## API Contract

### Admin Settings

`GET /api/settings/live-stream-locator`

Response mới:

```json
{
  "enabled": true,
  "sources": [],
  "providerUrls": [],
  "timeoutMs": 3500,
  "cacheTtlMs": 180000,
  "maxMatches": 30,
  "regionFiltering": {
    "enabled": true,
    "unknownPolicy": "global_only"
  }
}
```

Compatibility:

- `providerUrls` vẫn trả về trong giai đoạn chuyển tiếp.
- Nếu DB chỉ có `LIVE_STREAM_PROVIDER_URLS`, server tự materialize thành `sources` với `countries: ['*']`, `sourceType: 'provider_homepage'`, `active: true`.

`PUT /api/settings/live-stream-locator`

Request mới nhận `sources`. Trong giai đoạn chuyển tiếp, vẫn nhận `providerUrls`.

Rules:

- Nếu request có `sources`, server lưu `LIVE_STREAM_SOURCES`.
- Nếu request chỉ có `providerUrls`, server lưu theo format cũ và tự resolve sang sources khi đọc.
- Sau khi lưu, clear live stream lookup cache.

### Provider Test

`POST /api/settings/live-stream-locator/test-providers`

Request mới:

```json
{
  "sources": [],
  "country": "VN",
  "timeoutMs": 3500
}
```

Rules:

- `country` optional.
- Nếu có `country`, backend test các source match country đó.
- Nếu không có `country`, backend test tất cả active sources.
- Response giữ field hiện tại và thêm `sourceId`, `countries`, `regionEligible`.

### Match Lookup

`POST /api/matches/live-streams/lookup`

Request giữ nguyên:

```json
{
  "matchIds": ["123"]
}
```

Response thêm region metadata:

```json
{
  "viewerRegion": {
    "country": "VN",
    "source": "cloudflare",
    "confidence": "high"
  },
  "results": [
    {
      "matchId": "123",
      "found": true,
      "status": "found",
      "url": "https://example.vn/match",
      "sourceName": "VTV Official",
      "sourceUrl": "https://example.vn/live/",
      "title": "Live stream",
      "links": [
        {
          "url": "https://example.vn/match",
          "sourceId": "vn-vtv-official",
          "sourceName": "VTV Official",
          "sourceUrl": "https://example.vn/live/",
          "countries": ["VN"],
          "title": "Live stream",
          "verificationStatus": "team_match",
          "liveHint": true
        }
      ],
      "checkedAt": "2026-06-11T00:00:00.000Z"
    }
  ]
}
```

Compatibility:

- Existing frontend can keep reading `results`.
- New frontend can use `viewerRegion` for display/debug only, not for permission logic.

## Frontend Contract

Settings UI:

- Replace single URL list with source rows.
- Each row has:
  - name
  - URL
  - country multi-select
  - source type
  - active toggle
  - priority input
  - remove button
- Country selector must use known ISO options plus `Global (*)`.
- Do not accept free-text country names.

Matches UI:

- Continue showing `Live 1`, `Live 2` buttons from backend response.
- Do not locally filter by country.
- If backend returns no link because of region, show the same neutral empty state: no live stream link found yet.
- Optional admin/debug surface may show `viewerRegion.country`, but normal user UI should not expose enforcement internals.

## Cache Contract

Cache keys must include:

- source IDs/URLs
- source countries
- viewer country or unknown policy bucket
- timeout/cache settings

Reason: lookup result for `VN` must not be reused for `KR`.

Suggested salt:

```ts
[
  enabled ? 'enabled' : 'disabled',
  regionFilteringEnabled ? 'region:on' : 'region:off',
  viewerRegion.country ?? 'unknown',
  unknownPolicy,
  timeoutMs,
  cacheTtlMs,
  ...eligibleSources.map((s) => `${s.id}:${s.url}:${s.countries.join('+')}:${s.priority}:${s.active}`)
].join('|')
```

## Security And Compliance

- Hiding source links in UI is not access control. Backend filtering is mandatory.
- If a later endpoint proxies direct HLS or returns signed playback URLs, it must re-run region enforcement.
- Direct third-party URLs returned to browser may still be shared outside the app. For high-value streams, prefer signed short-lived internal URLs or official provider auth.
- Do not configure sources unless TFI has permission to display or link to them for the target country.
- Do not store provider credentials in frontend settings payloads.

## Migration Plan

Phase 1: Backend compatibility

- Add `LIVE_STREAM_SOURCES` settings key.
- Add parser/validator for `LiveStreamSource[]`.
- Resolve old `LIVE_STREAM_PROVIDER_URLS` to global sources when new key is absent.
- Add region resolver with unknown policy.
- Update lookup route to filter eligible sources server-side.

Phase 2: Frontend settings

- Update `LiveStreamProviderSettingsPanel` from URL cards to source rows.
- Add country multi-select and source type field.
- Keep backward-compatible display if server still returns only `providerUrls`.

Phase 3: Observability

- Add structured logs for:
  - `viewer_country`
  - `region_source`
  - `eligible_source_count`
  - `lookup_source_count`
  - `unknown_policy`
- Add probe/test response metadata for region eligibility.

Phase 4: Hardening

- Add CDN header support in production deploy.
- Add optional GeoIP provider.
- If direct stream playback is added, enforce region again at playback endpoint.

## Test Matrix

Backend unit tests:

- Normalizes `VN`, `kr` -> `VN`, `KR`.
- Rejects `Vietnam`, `KOREA`, empty country list, invalid URLs.
- Converts legacy `providerUrls` to global `sources`.
- Filters exact country before global fallback.
- Unknown country follows `global_only`, `hide_all`, and dev-only `allow_all`.
- Cache salt changes when country changes.

Backend route tests:

- Admin can read/write sources.
- Non-admin cannot change live stream settings.
- Lookup for `VN` only scans `VN` and `*` sources.
- Lookup for `KR` does not return `VN` links.
- Test providers can test all sources or one target country.

Frontend tests:

- Settings renders source rows with country selector.
- Save payload sends `sources`.
- Legacy `providerUrls` response still renders as global source rows.
- Matches tab keeps rendering live buttons from `results`.

Manual verification:

- Simulate `CF-IPCountry: VN` and confirm only `VN`/global sources are scanned.
- Simulate `CF-IPCountry: KR` and confirm only `KR`/global sources are scanned.
- Simulate unknown region and confirm configured unknown policy.

## Acceptance Criteria

Tính năng được coi là xong khi:

- Admin cấu hình được nhiều live stream sources với country rõ ràng.
- User ở country khác nhau nhận danh sách live links khác nhau từ backend.
- Frontend không chứa logic quyết định country entitlement.
- Lookup cache không rò kết quả giữa countries.
- Legacy `providerUrls` không làm vỡ Settings hoặc Matches tab.
- Test backend và frontend bao phủ migration, filtering, và unknown country behavior.
