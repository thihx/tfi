# Native App Setup Runbook

**Updated:** 2026-06-14
**Contract:** `docs/native-push-critical-fallback-contract-vi.md`

## Build And Sync

```powershell
npm run cap:sync
```

Open native projects:

```powershell
npm run cap:open:android
npm run cap:open:ios
```

## Firebase Files

Do not commit production Firebase credential files from another project by accident.

Required before device testing:

- Android: place real `google-services.json` at `android/app/google-services.json`.
- iOS: add real `GoogleService-Info.plist` to `ios/App/App/GoogleService-Info.plist` and include it in the Xcode app target.

The backend sends through FCM HTTP v1. The native client must register an FCM token with:

```http
POST /api/me/native-push/devices
```

The app bridge does this automatically after login when running on a native Capacitor platform.

## Backend Cost Estimate Env

Set these to the current Twilio route estimates before enabling paid fallback in production:

```env
CRITICAL_FALLBACK_SMS_ESTIMATED_UNIT_COST_USD=0
CRITICAL_FALLBACK_VOICE_CALL_ESTIMATED_UNIT_COST_USD=0
NATIVE_PUSH_DEVICE_KEEP_DAYS=180
```

## Android Checks

`android/app/src/main/AndroidManifest.xml` must contain:

- `POST_NOTIFICATIONS`
- `SCHEDULE_EXACT_ALARM`
- `USE_EXACT_ALARM`
- FCM default channel id `critical_alerts`
- FCM default icon `@drawable/ic_stat_name`

The app creates notification channel `critical_alerts` on startup.

## iOS Checks

Xcode project must enable:

- Push Notifications capability.
- Background Modes -> Remote notifications, if silent/background handling is required.
- Time Sensitive Notifications, if time-sensitive alert behavior is required.

The generated `AppDelegate.swift` forwards APNs token and remote notification events to Capacitor/Firebase Messaging.

## Manual Smoke

1. Login in the native app.
2. Grant notification permission.
3. Confirm `/api/me/native-push/status` returns `deviceCount > 0`.
4. Trigger a test native push from Profile -> Notifications -> Native Push -> Send test, or call:

```http
POST /api/me/native-push/test
```

5. Enable a kickoff match alert.
6. Confirm local notification is scheduled from `/api/me/native-push/local-match-start-alerts`.
7. Background or kill the app and confirm the local alarm fires.
8. Tap notification and confirm the match opens in Matches.

## SMS/Voice Verification Smoke

1. Open Profile -> Notifications.
2. Enter an E.164 phone number, for example `+15551234567`.
3. Click `Send code`.
4. Enter the 6-digit code received by SMS.
5. Click `Verify SMS` or `Verify Voice Call`.
6. Confirm the channel status becomes critical fallback ready.

The delivery policy blocks SMS/call when `phoneVerificationStatus` is not `verified`.
Direct `PUT /api/me/notification-channels/sms|voice_call` enable must return `PHONE_VERIFICATION_REQUIRED`.

## Ops Verification

After native push and fallback smoke, confirm admin/owner `GET /api/ops/overview` includes:

- `notifications.fcmConfigured`
- `notifications.nativeDevicesByPlatform`
- `notifications.channelBreakdown`
- `notifications.criticalFallbackCostEstimateUsd24h`
