# AI Gateway runbook

## Scope

AI Gateway protects TFI LLM calls by recording policy decisions, estimated cost, breaker state, and incidents. The first integrated surface is **Ops Monitoring -> LLM Cost Guard**.

## Deploy

After deploying a release that includes the gateway migration, run:

```powershell
npm run migrate --prefix packages/server
```

Start UAT/PRD with:

```env
AI_GATEWAY_MODE=observe
AI_GATEWAY_MAX_INPUT_TOKENS=80000
AI_GATEWAY_MAX_ESTIMATED_COST_USD_PER_CALL=0.5
AI_GATEWAY_LOOP_WINDOW_MINUTES=5
AI_GATEWAY_LOOP_CALL_THRESHOLD=6
AI_GATEWAY_ALERTS_ENABLED=true
```

Move to `AI_GATEWAY_MODE=enforce` only after Ops confirms threshold behavior in UAT.

## Emergency Controls

These kill switches block matching calls even when the gateway is in observe mode:

```env
AI_GATEWAY_DISABLED_FEATURES=tfi.live_recommendation
AI_GATEWAY_DISABLED_OPERATIONS=tfi.live_recommendation,tfi.manual_match_analysis
AI_GATEWAY_DISABLED_PROVIDERS=gemini
```

## Alerts

Gateway incidents are sent to active `owner` and `admin` users through their enabled admin notification channels:

- Telegram: `telegram_enabled=true`, Telegram channel enabled, and a verified/non-disabled chat address.
- Web Push: `web_push_enabled=true`, VAPID configured, and the admin browser has an active push subscription.

Alerts are disabled only when `AI_GATEWAY_ALERTS_ENABLED=false`.

## Operations

When an alert appears:

1. Open **Ops Monitoring -> LLM Cost Guard**.
2. Check `Open Breakers`, `Open Incidents`, `Gateway reasons`, and the recent call log.
3. Click `Ack` on the incident after an admin starts investigation.
4. If the reason is `loop_detected`, keep the breaker open and inspect the matching job/run before closing.
5. Click `Close` on the breaker only after the loop/cost issue is understood or mitigated.
6. Click `Resolve` on the incident after the breaker is closed or the issue no longer requires action.
7. If spend or token limits are too strict for a valid workflow, adjust the environment threshold and redeploy.
8. For emergency cost containment, set the matching `AI_GATEWAY_DISABLED_*` variable and redeploy immediately.
