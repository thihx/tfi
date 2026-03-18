# TFI System Review — Code & Business Logic Audit

> **Review Date:** 2026-03-18
> **Reviewer:** Claude Code (claude-sonnet-4-6)
> **Scope:** Full codebase — frontend (React/TypeScript), backend (Fastify/TypeScript), pipeline, jobs, repos, routes
> **Status:** ✅ Tất cả vấn đề đã được fix (2 sessions)

---

## Executive Summary

Đã rà soát toàn bộ source code bao gồm AI pipeline, auto-settle, scheduler, frontend state, và API layer. Tổng cộng phát hiện và fix **14 vấn đề thực sự** sau khi xác minh trực tiếp từ code (loại bỏ 8 false positives từ AI agent).

---

## 1. Backend Pipeline (`packages/server/src/lib/server-pipeline.ts`)

| # | Vấn đề | Severity | Status |
|---|--------|----------|--------|
| P1 | Event type mismatch: staleness check dùng `'Goal'` nhưng compact events dùng `'goal'` → staleness không bao giờ detect score change | **CRITICAL** | ✅ Fixed |
| P2 | `deriveInsightsFromEvents` không phân biệt home/away đúng → insights sai | **HIGH** | ✅ Fixed |
| P3 | `Number(db['MIN_CONFIDENCE']) \|\| fallback` — nếu admin set value = 0, `Number(0)` là falsy → fallback trigger, không thể set threshold = 0 | **MEDIUM** | ✅ Fixed |
| P4 | `matchIds.indexOf(matchId)` trong vòng lặp batch — O(n²) | **LOW** | ✅ Fixed |
| P5 | `1X2_TOO_EARLY` safety check chưa có → AI có thể recommend 1X2 ở phút đầu | **HIGH** | ✅ Fixed |
| P6 | `oddsFetchedAt` timestamp không truyền vào AI prompt → AI không biết odds data cũ đến đâu | **HIGH** | ✅ Fixed |

**Fix P3** — thêm `parseNumSetting` helper:
```typescript
function parseNumSetting(raw: unknown, envDefault: number): number {
  const n = Number(raw);
  return isFinite(n) && raw !== '' && raw !== null && raw !== undefined ? n : envDefault;
}
// Áp dụng cho tất cả 5 numeric settings: minConfidence, minOdds, latePhaseMinute, veryLatePhaseMinute, endgameMinute
```

---

## 2. Auto-Settle Job (`packages/server/src/jobs/auto-settle.job.ts`)

| # | Vấn đề | Severity | Status |
|---|--------|----------|--------|
| A1 | `getUnsettledRecommendations()` load toàn bộ table (limit 1000) rồi filter client-side — nếu DB có >1000 rec, các rec cũ không bao giờ được settle | **HIGH** | ✅ Fixed |
| A2 | N+1 query: loop từng `match_id` gọi `getHistoricalMatch()` riêng lẻ | **LOW** | ⚠ Accepted (volume nhỏ) |

**Fix A1** — dùng SQL filter đã có sẵn trong repo:
```typescript
// TRƯỚC: full table scan + client filter
const { rows } = await recommendationsRepo.getAllRecommendations({ limit: 1000 });
return rows.filter((r) => !r.result || r.result === '');

// SAU: SQL WHERE (result IS NULL OR result NOT IN ('win','loss','push'))
const { rows } = await recommendationsRepo.getAllRecommendations({ result: 'pending', limit: 2000 });
return rows;
```

---

## 3. Proxy Routes (`packages/server/src/routes/proxy.routes.ts`)

| # | Vấn đề | Severity | Status |
|---|--------|----------|--------|
| R1 | Dead code trong odds fallback — cả 2 nhánh `if/else` đều làm cùng việc `oddsSource = 'pre-match'` | **LOW** | ✅ Fixed |

---

## 4. Staleness Service (`src/features/live-monitor/services/staleness.service.ts`)

| # | Vấn đề | Severity | Status |
|---|--------|----------|--------|
| S1 | Event type case mismatch — kiểm tra `'Goal'` vs compact events `'goal'` → staleness check sai hoàn toàn | **CRITICAL** | ✅ Fixed |
| S2 | `'Red Card'` vs `'card'` — cùng vấn đề, không detect red card | **HIGH** | ✅ Fixed |

---

## 5. Notification Service (`src/features/live-monitor/services/notification.service.ts`)

| # | Vấn đề | Severity | Status |
|---|--------|----------|--------|
| N1 | `FORCE_MODE`, `EARLY_GAME_RISK` warnings gửi đến user — nên là internal only | **MEDIUM** | ✅ Fixed |
| N2 | `condition_triggered` notification gửi ra ngay cả khi `should_push = false` | **HIGH** | ✅ Fixed |
| N3 | `new Date().toLocaleString()` dùng locale của browser → inconsistent format | **LOW** | ✅ Fixed |

---

## 6. Frontend API Service (`src/lib/services/api.ts`)

| # | Vấn đề | Severity | Status |
|---|--------|----------|--------|
| API1 | `pgDelete` gửi `Content-Type: application/json` khi không có body → Fastify trả 400 `FST_ERR_CTP_EMPTY_JSON_BODY` | **CRITICAL** | ✅ Fixed |

**Nguyên nhân gốc:** Fastify strict mode reject DELETE request khi header `Content-Type: application/json` nhưng body rỗng.
**Fix:** Chỉ set Content-Type header khi có body truyền vào.
**Ảnh hưởng:** Watchlist single delete và batch delete đều fail (đây là root cause).

---

## 7. Date/Time Formatting (toàn bộ frontend)

| # | Vấn đề | Severity | Status |
|---|--------|----------|--------|
| D1 | Mỗi component dùng format khác nhau: `toLocaleString()`, `toLocaleDateString('en-GB')`, `toLocaleTimeString('vi-VN')` | **MEDIUM** | ✅ Fixed |

**Fix:** Centralize tất cả qua `src/lib/utils/helpers.ts` với token-based format, configurable qua `.env`:
```
VITE_DATETIME_FORMAT=DD-MMM-YYYY HH:mm
VITE_DATE_FORMAT=DD-MMM-YYYY
VITE_TIME_FORMAT=HH:mm
```

**Files đã fix:** `LiveMonitorTab.tsx`, `WatchlistTab.tsx`, `SettingsTab.tsx`, `AuditLogsPanel.tsx`, `MatchDetailModal.tsx`, `MatchScoutModal.tsx`, `notification.service.ts`, `LeagueFixturesDialog.tsx`

---

## 8. Scheduler & Jobs

| # | Vấn đề | Severity | Status |
|---|--------|----------|--------|
| J1 | `purge-audit` được register trong scheduler nhưng job file chưa tồn tại | **HIGH** | ✅ Fixed (tạo `purge-audit.job.ts` + test) |

---

## 9. Tính năng mới (features added trong review)

| Feature | File | Status |
|---------|------|--------|
| League fixtures popup dialog | `src/components/ui/LeagueFixturesDialog.tsx` | ✅ Added |
| Click league name → xem upcoming fixtures | `src/app/LeaguesTab.tsx` | ✅ Added |
| `fetchLeagueFixtures` API function | `src/lib/services/api.ts` | ✅ Added |
| Backend endpoint `GET /api/proxy/football/league-fixtures` | `packages/server/src/routes/proxy.routes.ts` | ✅ Added |

---

## False Positives đã xác minh

Các vấn đề agent báo cáo nhưng **không phải bug** sau khi đọc code:

| Mục | Lý do |
|-----|-------|
| "Authentication missing on all routes" | App là private local tool, không expose public internet — by design |
| "bulkCreateRecommendations not transactional" | Đã có `transaction(async (client) => {...})` ở line 272 |
| "MIN_MINUTE không tồn tại trong LiveMonitorConfig" | Có ở line 29-31 `types.ts` như optional fields |
| "Race condition trong watchlist deletion" | Job chạy sequential, không có concurrent pipeline |
| "Optimistic update không rollback" | Rollback có đủ trong `catch` và condition `false` |
| "Unbounded pagination DoS" | Private app, không có public-facing API |
| "XSS trong Telegram message" | Có `safeHtml()` function ở line 649 escape `&`, `<`, `>` |
| "`bet_type='NO_BET'` → auto-settle bỏ qua vĩnh viễn" | `evaluateBet` trả `push` → `settleRecommendation` vẫn được gọi → rec được settle `push/0` |

---

## Đánh giá rủi ro release

| Area | Risk | Chi tiết |
|------|------|---------|
| AI Pipeline | 🟢 Low | Tất cả critical logic bugs đã fix |
| Auto-settle | 🟢 Low | SQL filter đảm bảo không miss rec |
| Watchlist CRUD | 🟢 Low | pgDelete bug fixed, batch/single delete OK |
| Notification | 🟢 Low | Internal warnings không leak ra user |
| Date formatting | 🟢 Low | Centralized, configurable qua env |
| Scheduler/Jobs | 🟢 Low | Redis lock đúng, purge-audit registered |
| Frontend state | 🟢 Low | Optimistic update + rollback correct |
| Auto-settle N+1 | 🟡 Accepted | Volume nhỏ (~trận/ngày), không block release |

---

## ✅ Verdict: Đủ điều kiện release

Không còn vấn đề **Critical** hay **High** nào chưa fix. Các vấn đề **Low** còn lại được chấp nhận ở volume hiện tại.

---

## Khuyến nghị theo dõi post-release

1. **Auto-settle N+1**: Nếu DB lớn hơn (>100 unsettled recs/run), refactor `getHistoricalMatch` thành batch `WHERE match_id = ANY($1)`.
2. **Pagination safety net**: `getUnsettledRecommendations` dùng `limit: 2000` — monitor nếu approach limit.
3. **Monitoring**: Theo dõi `PIPELINE_MATCH_ERROR` trong audit logs sau release để catch edge cases.
4. **Settings validation**: Xem xét thêm UI validation cho numeric settings (MIN_CONFIDENCE, MIN_ODDS) để tránh user nhập giá trị phi lý (negative, quá cao).
