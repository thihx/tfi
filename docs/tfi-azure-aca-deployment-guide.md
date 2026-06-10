# TFI Azure Container Apps Deployment Guide

Version: 0.1
Date: 2026-06-10
Owner: TFI Engineering
Scope: Agent-friendly deployment guide for TFI on Azure Container Apps.

## 1. What This Deploys

TFI is deployed as **one container**:

- Frontend: React/Vite SPA from `src/`.
- Backend: Fastify API from `packages/server/src/`.
- Scheduler/jobs: started inside the Fastify process.
- Runtime port: `4000`.
- Health endpoint: `/api/health`.
- Dockerfile: `Dockerfile`.
- Image repository: `tfi`.

The production image builds the SPA, builds the server, copies the SPA to `/app/client`, and runs:

```text
node dist/index.js
```

## 2. Agent Boot Sequence

Before deploying:

1. Read `AGENTS.md`.
2. Read `docs/agent-onboarding.md`.
3. Read this guide end to end.
4. Inspect current deploy script behavior:

   ```powershell
   Get-Content scripts\azure\deploy.ps1
   ```

5. Check the worktree. Do not revert unrelated changes:

   ```powershell
   git status --short
   ```

6. Confirm target subscription/resource names with the user or the environment request.

## 3. Current Default Azure Target

The existing deploy scripts default to:

| Item | Default |
|---|---|
| Resource group | `fkr_resource` |
| ACR | `vocs2026` |
| Container App | `tfi-app` |
| Container Apps environment | `managedEnvironment-fkrresource-afef` |
| Location | `koreacentral` |
| Image repo | `tfi` |
| Env file | `.env.azure` |

Override these with PowerShell flags:

```powershell
.\scripts\azure\deploy.ps1 `
  -ResourceGroup <resource-group> `
  -AcrName <acr-name> `
  -ContainerAppName <container-app-name> `
  -ManagedEnv <aca-env-name> `
  -Location <azure-region> `
  -EnvFile <env-file>
```

Or with the npm wrapper:

```powershell
npm run deploy:azure -- `
  -ResourceGroup <resource-group> `
  -AcrName <acr-name> `
  -ContainerAppName <container-app-name> `
  -ManagedEnv <aca-env-name> `
  -EnvFile <env-file>
```

## 4. Azure CLI Context Isolation

When multiple agents or multiple subscriptions are active, isolate Azure CLI state.

PowerShell:

```powershell
$env:AZURE_CONFIG_DIR = "$HOME\.azure-tfi-prod"
az login
az account set --subscription "<subscription-id-or-name>"
az account show --query "{name:name,id:id,user:user.name}" -o json
```

Do not rely on the global Azure CLI default subscription. Re-check `az account show` immediately before deploy.

For a second environment, use a different profile:

```powershell
$env:AZURE_CONFIG_DIR = "$HOME\.azure-tfi-uat"
```

## 5. New Subscription Bootstrap

The deploy script can build and update an app, but a clean subscription still needs Azure foundation resources first.

Minimum resources:

- Resource group.
- ACR.
- Log Analytics workspace.
- Container Apps environment.
- Container App.
- Managed identity or registry credentials for pulling the private ACR image.
- PostgreSQL database.
- Redis.
- DNS/custom domain if required.

Recommended names:

| Item | Example |
|---|---|
| Resource group | `rg-tfi-app-prd-krc-001` |
| ACR | `actfiprdkrc001` |
| Log Analytics | `log-tfi-prd-krc-001` |
| ACA environment | `cae-tfi-prd-krc-001` |
| Container App | `ca-tfi-app-prd-krc-001` |
| PostgreSQL DB | `tfi` |
| Redis prefix/database | dedicated Redis instance preferred; shared Redis only with explicit key/prefix discipline |

Bootstrap example:

```powershell
$SUB = "<subscription-id>"
$RG = "rg-tfi-app-prd-krc-001"
$LOC = "koreacentral"
$ACR = "actfiprdkrc001"
$LOG = "log-tfi-prd-krc-001"
$CAE = "cae-tfi-prd-krc-001"
$APP = "ca-tfi-app-prd-krc-001"

az account set --subscription $SUB
az group create -n $RG -l $LOC
az acr create -g $RG -n $ACR --sku Standard
az monitor log-analytics workspace create -g $RG -n $LOG -l $LOC

$LOG_ID = az monitor log-analytics workspace show -g $RG -n $LOG --query customerId -o tsv
$LOG_KEY = az monitor log-analytics workspace get-shared-keys -g $RG -n $LOG --query primarySharedKey -o tsv
az containerapp env create -g $RG -n $CAE -l $LOC --logs-workspace-id $LOG_ID --logs-workspace-key $LOG_KEY
```

Pre-create the Container App with a public placeholder image, then configure managed identity and ACR pull. This avoids the common stuck point where the script creates an app that cannot pull from a private ACR.

```powershell
az containerapp create `
  -g $RG `
  -n $APP `
  --environment $CAE `
  --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest `
  --target-port 80 `
  --ingress external `
  --cpu 0.5 `
  --memory 1Gi `
  --min-replicas 1 `
  --max-replicas 1

az containerapp identity assign -g $RG -n $APP --system-assigned
$PRINCIPAL_ID = az containerapp show -g $RG -n $APP --query identity.principalId -o tsv
$ACR_ID = az acr show -g $RG -n $ACR --query id -o tsv
az role assignment create --assignee-object-id $PRINCIPAL_ID --assignee-principal-type ServicePrincipal --scope $ACR_ID --role AcrPull
$ACR_LOGIN = az acr show -g $RG -n $ACR --query loginServer -o tsv
az containerapp registry set -g $RG -n $APP --server $ACR_LOGIN --identity system
```

After this bootstrap, use the normal deployment command.

## 6. Environment File Contract

Use `.env.azure.example` as the source template.

Required for non-local deployments:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `FRONTEND_URL`
- `CORS_ORIGIN`

Required for full product behavior:

- `FOOTBALL_API_KEY`
- `GEMINI_API_KEY`

Recommended production safety keys:

- `FOOTBALL_API_DAILY_LIMIT`
- `FOOTBALL_API_CIRCUIT_ENABLED=true`
- quota-tuned job intervals from `.env.azure.example`
- `ALLOW_EXPENSIVE_GEMINI_MODELS=false`
- `AI_GATEWAY_MODE=observe` until UAT confirms control-plane behavior
- `AI_GATEWAY_ALERTS_ENABLED=true`

Non-local startup guard:

The server exits if:

- `FRONTEND_URL` is not local and `JWT_SECRET` is missing.
- `FRONTEND_URL` is not local and Google OAuth client id/secret are missing.
- only one of `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` is set.
- PostgreSQL cannot answer `SELECT 1`.
- Redis cannot answer `PING`.

Keep `.env.azure` uncommitted. It is already ignored by `.gitignore`.

## 7. Preflight Checklist

Run this before a deploy:

```powershell
# 1. Azure context
az account show --query "{name:name,id:id,user:user.name}" -o json

# 2. Azure resources
az group show -n <resource-group> --query name -o tsv
az acr show -n <acr-name> --query loginServer -o tsv
az containerapp env show -g <resource-group> -n <aca-env-name> --query name -o tsv
az containerapp show -g <resource-group> -n <container-app-name> --query name -o tsv

# 3. Local repo checks
npm run verify:ci

# 4. Env file exists
Test-Path .env.azure
```

For a faster doc-only or emergency check, at least run:

```powershell
npm run typecheck
npm run typecheck --prefix packages/server
```

## 8. Deploy Commands

### Standard deploy

```powershell
$TAG = "prod-$(Get-Date -Format 'yyyyMMdd-HHmm')"

npm run deploy:azure -- `
  -ReleaseTag $TAG `
  -ResourceGroup <resource-group> `
  -AcrName <acr-name> `
  -ContainerAppName <container-app-name> `
  -ManagedEnv <aca-env-name> `
  -Location <azure-region> `
  -EnvFile .env.azure
```

### Reuse an existing image tag

```powershell
npm run deploy:azure -- `
  -ReleaseTag <existing-tag> `
  -SkipBuild `
  -ResourceGroup <resource-group> `
  -AcrName <acr-name> `
  -ContainerAppName <container-app-name> `
  -ManagedEnv <aca-env-name> `
  -EnvFile .env.azure
```

### Image-only update without env sync

Use only when Azure already has correct env vars:

```powershell
npm run deploy:azure -- `
  -ReleaseTag <tag> `
  -SkipEnvSync `
  -ResourceGroup <resource-group> `
  -AcrName <acr-name> `
  -ContainerAppName <container-app-name> `
  -ManagedEnv <aca-env-name>
```

## 9. Database Migration

The application uses SQL migrations under:

```text
packages/server/src/db/migrations
```

Run migrations before or immediately after the first deploy:

```powershell
npm run migrate:server
```

This command uses `DATABASE_URL` from the server environment. For a deployment machine, load the correct env first:

```powershell
cd packages/server
node -r dotenv/config dist/db/migrate.js
```

Safer local path:

```powershell
cd D:\tfi
$env:DATABASE_URL = "<target-database-url>"
npm run migrate --prefix packages/server
```

Do not run migrations against PRD unless `az account show`, database host, and change window are confirmed.

## 10. Post-Deploy Verification

Resolve the ACA URL:

```powershell
$FQDN = az containerapp ingress show -g <resource-group> -n <container-app-name> --query fqdn -o tsv
$BASE = "https://$FQDN"
```

Health:

```powershell
Invoke-WebRequest "$BASE/api/health" -UseBasicParsing
```

Expected:

```json
{"status":"ok","timestamp":"..."}
```

Integration health:

```powershell
Invoke-WebRequest "$BASE/api/integrations/health" -UseBasicParsing
```

If auth blocks the integration route, verify via UI after login or inspect logs.

Logs:

```powershell
az containerapp logs show -g <resource-group> -n <container-app-name> --tail 100
```

Revision:

```powershell
az containerapp revision list -g <resource-group> -n <container-app-name> -o table
```

Smoke through browser:

- Open app base URL.
- Login with Google OAuth.
- Confirm `/api/auth/me` returns an authenticated user.
- Open Settings -> System or Integration Health.
- Confirm PostgreSQL, Redis, Football API, Gemini, and Google OAuth status.
- Confirm Jobs page shows scheduler activity.

## 11. Common Stuck Points

### ACR build queued but no image appears

Check ACR run:

```powershell
az acr task list-runs -g <resource-group> -r <acr-name> -o table
az acr task logs -g <resource-group> -r <acr-name> --run-id <run-id>
```

Usually caused by build context upload, npm install failure, or TypeScript build failure.

### Container App cannot pull image

Check registry config and identity:

```powershell
az containerapp show -g <resource-group> -n <container-app-name> --query "identity"
az containerapp registry list -g <resource-group> -n <container-app-name> -o table
```

Fix:

```powershell
$PRINCIPAL_ID = az containerapp show -g <resource-group> -n <container-app-name> --query identity.principalId -o tsv
$ACR_ID = az acr show -g <resource-group> -n <acr-name> --query id -o tsv
az role assignment create --assignee-object-id $PRINCIPAL_ID --assignee-principal-type ServicePrincipal --scope $ACR_ID --role AcrPull
az containerapp registry set -g <resource-group> -n <container-app-name> --server <acr-login-server> --identity system
```

### App starts then exits

Most likely:

- Missing `JWT_SECRET`.
- Missing Google OAuth id/secret.
- PostgreSQL unavailable.
- Redis unavailable.
- Bad `DATABASE_URL` or `REDIS_URL`.

Check logs:

```powershell
az containerapp logs show -g <resource-group> -n <container-app-name> --tail 100
```

### Health works but login fails

Check Google OAuth redirect URI:

```text
<FRONTEND_URL>/api/auth/google/callback
```

Also confirm:

- `FRONTEND_URL` equals the public URL users open.
- `CORS_ORIGIN` equals the public URL.
- cookie path/domain is not blocked by browser policy.

### Football API quota burns too fast

Confirm `.env.azure` includes quota controls:

- `FOOTBALL_API_CIRCUIT_ENABLED=true`
- `JOB_AUTO_ADD_TOP_LEAGUE_WATCHLIST_MS=0`
- `JOB_REFRESH_LIVE_MATCHES_PUBLIC_MS=15000`
- `JOB_FETCH_MATCHES_MS=120000`
- `JOB_REFRESH_PROVIDER_INSIGHTS_MS=300000`
- `REFRESH_PROVIDER_INSIGHTS_API_BUDGET=30`

Monitor integration health and Settings -> Jobs.

### Env sync fails with special characters

The current deploy script passes env vars to `az containerapp update --set-env-vars` in batches. If a value contains shell-sensitive characters and sync fails:

1. Put the value in quotes in `.env.azure`.
2. Retry.
3. If it still fails, set that env var directly in Azure Portal/CLI and deploy with `-SkipEnvSync`.
4. Document the manual setting in the release notes.

## 12. Rollback

Rollback to a previous image tag:

```powershell
npm run deploy:azure -- `
  -ReleaseTag <previous-known-good-tag> `
  -SkipBuild `
  -SkipEnvSync `
  -ResourceGroup <resource-group> `
  -AcrName <acr-name> `
  -ContainerAppName <container-app-name> `
  -ManagedEnv <aca-env-name>
```

If rollback requires env change, remove `-SkipEnvSync` only after verifying `.env.azure` matches the intended rollback config.

Do not rollback database migrations without a migration-specific plan.

## 13. Final Handoff Template

After deploy, report:

```text
Environment:
Subscription:
Resource group:
Container App:
ACA FQDN:
Public URL:
Image:
Release tag:
Health result:
Integration health summary:
Migration status:
Rollback tag:
Known risks:
```

## 14. Current Gaps to Fix Later

These are not blockers for using the guide, but they are good hardening items:

- Add a dedicated preflight script that validates Azure context, resource existence, `.env.azure`, DB, Redis, and auth env before deploy.
- Make deploy script fail-fast on all critical `az containerapp create/update` calls.
- Store secrets as ACA secrets or Key Vault references instead of plain env vars.
- Normalize `scripts/azure/deploy.sh` encoding to UTF-8 if it needs to be used by Linux/WSL agents.
- Add a manifest file so resource names and canonical URLs are not spread across flags and docs.
