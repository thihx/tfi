# Native Push, Local Alarm, SMS/Call Fallback Contract

**Updated:** 2026-06-14
**Scope:** hoan thien trien khai kenh canh bao manh hon Telegram/Web Push cho match alerts va recommendation critical alerts.

## Muc Tieu

TFI canh bao nguoi dung bang nhieu kenh theo do tin cay tang dan:

1. `web_push`: kenh web/PWA hien co, sticky cho alert critical.
2. `native_push`: push qua native app bang FCM, dung cho live trigger can den may nhanh hon Telegram.
3. `local_notifications`: alarm tren chinh thiet bi cho kickoff da biet truoc.
4. `sms`: fallback tra phi cho alert critical.
5. `voice_call`: fallback manh nhat cho alert cuc quan trong/tier cao.

Backend hien da co delivery channel model, nen phan nay phai mo rong model hien co thay vi tao mot luong thong bao rieng biet.

## Nguyen Tac Bat Buoc

- Khong goi sports provider truc tiep tu mobile/web client.
- Native client chi dang ky device token, lay lich local alarm, va mo deep link vao app.
- Backend van la noi quyet dinh rule match alert, recommendation critical, entitlement, dedupe va delivery state.
- `native_push`, `sms`, `voice_call` phai di qua `user_notification_channel_configs` va delivery channel rows.
- SMS/call chi duoc dung cho critical fallback, phai co entitlement, enabled config, address hop le, va cost/rate guard.
- Local alarm chi dung cho cac kickoff alert co thoi gian biet truoc; live condition trigger van phai di qua backend push.
- APNs direct chua la duong runtime chinh. Native app nen dung Firebase Messaging/FCM cho ca Android va iOS trong phase hien tai.

## Trang Thai Backend Hien Co

Da co trong codebase:

- Migration `064_native_push_sms_voice_channels.sql`.
- Table `native_push_devices`.
- Channel types: `native_push`, `sms`, `voice_call`.
- Route native device:
  - `GET /api/me/native-push/status`
  - `POST /api/me/native-push/devices`
  - `DELETE /api/me/native-push/devices/:deviceId`
  - `GET /api/me/native-push/local-match-start-alerts?lookaheadHours=48`
  - `POST /api/me/native-push/test`
- FCM sender: `packages/server/src/lib/native-push.ts`.
- Twilio SMS/call sender: `packages/server/src/lib/twilio.ts`.
- Match alert delivery flush them `native_push`, `sms`, `voice_call`.
- Recommendation critical fallback delivery flush them `native_push`, `sms`, `voice_call`.
- Capacitor config, Android project, iOS project, native bridge, FCM token registration, and local kickoff alarm scheduling.
- SMS/voice critical fallback policy guard: default off, E.164 phone validation, per-user/day limit, global/day cost guard.
- SMS/voice phone verification flow:
  - `POST /api/me/notification-channels/:channelType/phone-verification/start`
  - `POST /api/me/notification-channels/:channelType/phone-verification/verify`
- Backend rejects direct `PUT /api/me/notification-channels/sms|voice_call` enable; SMS/call must be enabled through phone verification.
- Ops overview includes notification channel breakdown, FCM configured status, native device counts by platform/provider, invalid token failure count, and SMS/voice estimated daily cost.

Native setup/runbook: [native-app-setup-runbook-vi.md](native-app-setup-runbook-vi.md).

## Phase 0 - Production Backend Readiness

Phai lam truoc khi bat native/SMS/call cho user that:

1. Chay migration:

```powershell
npm run migrate --prefix packages/server
```

2. Cau hinh FCM:

```env
FCM_SERVICE_ACCOUNT_JSON=
```

Hoac dung 3 bien tach:

```env
FCM_PROJECT_ID=
FCM_CLIENT_EMAIL=
FCM_PRIVATE_KEY=
```

3. Cau hinh Twilio:

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
CRITICAL_FALLBACK_SMS_ESTIMATED_UNIT_COST_USD=0
CRITICAL_FALLBACK_VOICE_CALL_ESTIMATED_UNIT_COST_USD=0
NATIVE_PUSH_DEVICE_KEEP_DAYS=180
```

4. Xac nhan job interval:

```env
JOB_CHECK_MATCH_ALERTS_MS=3000
```

5. Kiem tra readiness:

- `/api/push/status` phai bao Web Push VAPID ready.
- `/api/me/native-push/status` phai co `senderImplemented: true`.
- `senderConfigured` phai la `true` sau khi FCM env san sang.

## Phase 1 - Capacitor Native Shell

Mobile client phai build tu frontend hien co bang Capacitor.

Deliverables:

- Capacitor project duoc scaffold.
- Android va iOS platform duoc them.
- App co bundle id/package id production.
- Firebase config duoc them:
  - Android: `google-services.json`
  - iOS: `GoogleService-Info.plist`
- App request notification permission dung luc user bat native alerts.
- App lay FCM registration token.
- App refresh token khi Firebase rotate token.

Khong dat sports provider key vao native app.

## Phase 2 - Native Device Registration Contract

Sau khi user login trong native app, client phai goi:

```http
POST /api/me/native-push/devices
Content-Type: application/json
```

Payload:

```json
{
  "deviceId": "stable-device-id",
  "platform": "ios",
  "provider": "fcm",
  "token": "fcm-registration-token",
  "appVersion": "1.0.0",
  "deviceName": "iPhone",
  "timezone": "Asia/Bangkok",
  "localNotificationsEnabled": true,
  "metadata": {
    "capacitor": true
  }
}
```

Allowed:

- `platform`: `ios`, `android`
- `provider`: `fcm`, `apns`

Runtime phase hien tai chi dam bao delivery qua `fcm`. Neu client gui `apns`, device co the duoc luu nhung backend FCM sender khong push truc tiep APNs token.

Client phai goi lai API nay khi:

- user login,
- FCM token thay doi,
- user bat/tat local notifications,
- app version thay doi,
- app duoc mo lai sau thoi gian dai.

Khi logout:

```http
DELETE /api/me/native-push/devices/:deviceId
```

## Phase 3 - Local Kickoff Alarm Contract

Native app lay lich kickoff alarm:

```http
GET /api/me/native-push/local-match-start-alerts?lookaheadHours=48
```

Response:

```json
{
  "lookaheadHours": 48,
  "alerts": [
    {
      "ruleId": 10,
      "matchId": "100",
      "homeTeam": "Home",
      "awayTeam": "Away",
      "league": "League",
      "kickoffAtUtc": "2026-06-14T12:00:00.000Z",
      "kickoffLeadMinutes": 5,
      "fireAtUtc": "2026-06-14T11:55:00.000Z",
      "source": "manual"
    }
  ]
}
```

Client scheduling rules:

- Schedule local notification tai `fireAtUtc`.
- Notification id phai deterministic, vi du `match-start:${ruleId}:${matchId}`.
- Khi fetch lai schedule, cancel alarm cu khong con trong response.
- Khong schedule alarm co `fireAtUtc` trong qua khu.
- Sync schedule khi app open, sau login, sau user doi alert settings, va dinh ky neu platform cho phep background task.

Local notification copy:

- Title: `Kick-off alert`
- Body: `{homeTeam} vs {awayTeam} starts soon`
- Data/deep link: mo match trong Matches tab.

## Phase 4 - Live Native Push Contract

Backend se gui native push cho:

- match alert live condition,
- match start alert neu can remote push,
- recommendation critical fallback.

FCM payload phai chua:

- `title`
- `body`
- `data.matchId` khi co match context
- `data.recommendationId` khi la recommendation
- `data.channelType = native_push`
- URL/deep link neu client can routing.

Mobile app phai handle:

- foreground notification display,
- background tap,
- killed-state tap,
- token expired/invalid recovery.

Android notification channel:

- Channel id: `critical_alerts`
- Importance: high
- Sound/vibration: enabled

iOS:

- Request notification permission.
- Time-sensitive interruption level chi hieu luc neu app entitlement/platform cho phep.

## Phase 5 - SMS/Voice Critical Fallback Contract

SMS va call khong phai kenh mac dinh. Chi bat khi tat ca dieu kien sau dung:

- User tier cho phep `sms` hoac `voice_call`.
- Channel config enabled.
- `address` la so dien thoai hop le theo E.164.
- Channel metadata co `phoneVerificationStatus = verified`.
- Alert co severity critical/high theo policy.
- Chua vuot rate limit user/ngay va global cost guard.
- Khong co delivery thanh cong cung alert trong cua so dedupe neu policy yeu cau single-success.

Recommended UI:

- SMS: user nhap phone number, verify OTP truoc khi enabled.
- Voice call: tach toggle rieng, mac dinh off.
- Hien ro canh bao chi phi/critical-only cho operator/admin, khong can copy dai trong user UI.

Minimum policy truoc production:

```text
sms: max 10 critical alerts/user/day
voice_call: max 3 critical alerts/user/day
global_sms_cost_guard: required
global_voice_cost_guard: required
```

Direct HTTP enable for `sms` or `voice_call` must return `PHONE_VERIFICATION_REQUIRED`; only successful OTP verification can set the channel `enabled=true`, `status=verified`, and `metadata.phoneVerificationStatus=verified`.

## Entitlement Contract

Current migration updates:

- `pro`: `web_push`, `native_push`, `telegram`, `email`
- `premium`: `web_push`, `native_push`, `telegram`, `email`, `zalo`, `sms`, `voice_call`

Before public rollout, verify actual plan policy with product decision:

- Native push can be Pro+.
- SMS/call should be Premium/enterprise or explicitly paid add-on.
- Free tier should not get SMS/call.

## Observability Contract

Moi delivery attempt phai co du thong tin de audit:

- channel type
- status: `pending`, `delivered`, `failed`, `suppressed`
- attempt count
- last error
- last attempt time
- delivered time

Can dashboard/log cho:

- FCM configured/unconfigured.
- FCM invalid token count.
- Native device count by platform.
- SMS sent/failed.
- Voice call sent/failed.
- Cost estimate per day.
- `check-match-alerts` latency and interval.
- Critical delivery success rate by channel.

Implemented operator source: `GET /api/ops/overview` for admin/owner returns:

- `notifications.fcmConfigured`
- `notifications.nativeDevicesByPlatform`
- `notifications.channelBreakdown`
- `notifications.criticalFallbackCostEstimateUsd24h`

Housekeeping:

- Xoa native token khi FCM tra `UNREGISTERED`/invalid.
- Cleanup device khong `last_seen_at` qua nguong.
- Alert operator neu fallback failure rate tang bat thuong.

Implemented cleanup source: daily housekeeping job `purge-audit` deletes `native_push_devices` where `COALESCE(last_seen_at, updated_at, created_at)` is older than `NATIVE_PUSH_DEVICE_KEEP_DAYS` (minimum 30 days).

## Rollout Order

1. Backend migration va env production.
2. Verify Web Push sticky critical va VAPID production.
3. Verify `check-match-alerts` interval 3s hoac nguong product chon.
4. Scaffold Capacitor app.
5. Firebase Messaging token registration.
6. Local kickoff alarm scheduling.
7. Native push delivery test tren Android.
8. Native push delivery test tren iOS qua FCM.
9. Add Settings UI cho native device status.
10. Add SMS phone verification va channel config UI.
11. Enable SMS critical fallback cho internal/premium beta.
12. Enable voice call fallback sau khi co cost/rate guard.
13. Add monitoring dashboard va operator runbook.
14. Public rollout theo cohort.

## Test Gates

Focused backend:

```powershell
npm run test --prefix packages/server -- src/__tests__/native-push.routes.test.ts src/__tests__/match-alert-deliveries.repo.test.ts src/__tests__/recommendation-deliveries.repo.test.ts src/__tests__/check-match-alerts-loop.job.test.ts src/__tests__/deliver-telegram-notifications.job.test.ts -- --runInBand
```

Build:

```powershell
npm run build --prefix packages/server
npm run build
```

Mobile manual smoke:

- Login native app.
- Grant notification permission.
- Register FCM token successfully.
- `/api/me/native-push/status` shows `deviceCount > 0`.
- Trigger test native push.
- Schedule a local kickoff alarm and verify it fires when app is backgrounded/killed.
- Tap notification opens the correct match.

SMS/call smoke:

- Enable premium user with verified phone.
- Trigger critical test recommendation.
- Verify SMS delivery row delivered.
- Trigger voice call only in internal/test phone cohort.
- Verify rate limit prevents repeated calls.

## Acceptance Criteria

Feature duoc xem la hoan thien khi:

- Production VAPID/Web Push status ready.
- Critical Web Push khong tu bien mat sau 10s.
- `check-match-alerts` chay o interval thap va co watchdog/observability.
- Native app dang ky FCM token thanh cong.
- Backend gui duoc native push qua FCM cho critical/live alert.
- Backend co self-service native push smoke test qua `POST /api/me/native-push/test`.
- Native app schedule duoc local kickoff alarms tu backend schedule API.
- SMS fallback gui duoc cho critical alerts dung entitlement.
- SMS/call phone number phai verify OTP truoc khi delivery policy cho gui.
- Voice call fallback gui duoc cho critical alerts dung entitlement va rate guard.
- Invalid native tokens duoc cleanup.
- Delivery logs phan biet ro delivered/failed/suppressed theo tung channel.
- Khong co duplicate alert ngoai policy da dinh nghia.

## Open Items

- Can dat Firebase config files that vao native projects truoc khi device smoke:
  - `android/app/google-services.json`
  - `ios/App/App/GoogleService-Info.plist`
- Can operator dashboard neu rollout cho nhieu user.
- Can them APNs direct sender neu sau nay khong muon di qua FCM cho iOS.
