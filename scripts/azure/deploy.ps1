# ============================================================
# TFI - Azure Container Apps deployment script
#
# Prerequisites: Azure CLI (`az`), logged in (`az login`), rights on RG/ACR/Container App.
# No local Docker required — image builds in ACR (`az acr build --no-wait`).
#
# Usage:
#   .\scripts\azure\deploy.ps1
#   .\scripts\azure\deploy.ps1 -ReleaseTag "prod-20260409-1cb1ae2"
#   .\scripts\azure\deploy.ps1 -ReleaseTag "v1.0.0" -SkipBuild
#   Copy .env.azure.example -> .env.azure and fill secrets before first deploy.
# ============================================================
param(
  [string]$ReleaseTag = "",

  [string]$ResourceGroup = "fkr_resource",
  [string]$AcrName = "vocs2026",
  [string]$ContainerAppName = "tfi-app",
  [string]$ManagedEnv = "managedEnvironment-fkrresource-afef",
  [string]$Location = "koreacentral",

  [string]$EnvFile = "",
  [switch]$SkipBuild,
  [switch]$SkipEnvSync
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

# Reduce Azure CLI (Python) Unicode issues on Windows consoles (e.g. charmap / ✓ in logs).
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch { }

# Ensure we always run from the repo root (the directory that contains Dockerfile)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent (Split-Path -Parent $ScriptDir)
Set-Location $RepoRoot

if ([string]::IsNullOrWhiteSpace($ReleaseTag)) {
  $short = (& git -C $RepoRoot rev-parse --short HEAD 2>$null)
  if ([string]::IsNullOrWhiteSpace($short)) {
    throw "ReleaseTag is empty and git short hash is unavailable. Pass -ReleaseTag explicitly."
  }
  $ReleaseTag = "prod-{0}-{1}" -f (Get-Date -Format "yyyyMMdd"), $short.Trim()
  Write-Host "[deploy] Auto ReleaseTag: $ReleaseTag"
}

$repo = "tfi"
$acrLoginServer = az acr show -n $AcrName --query loginServer -o tsv
if ([string]::IsNullOrWhiteSpace($acrLoginServer)) {
  throw "Cannot resolve ACR login server for '$AcrName'."
}

$image = "$acrLoginServer/${repo}:${ReleaseTag}"
Write-Host "[deploy] ResourceGroup = $ResourceGroup"
Write-Host "[deploy] ACR           = $acrLoginServer"
Write-Host "[deploy] Image         = $image"
Write-Host "[deploy] ContainerApp  = $ContainerAppName"

# ── Step 1: Build & push image to ACR ────────────────────────
if (-not $SkipBuild) {
  Write-Host "[deploy][build] Queuing ACR build (no local Docker; use --no-wait - full logs stay in ACR portal)..."
  az acr build -g $ResourceGroup -r $AcrName -t "${repo}:${ReleaseTag}" -f Dockerfile . --no-wait --only-show-errors
  if ($LASTEXITCODE -ne 0) {
    throw "az acr build failed to queue (exit $LASTEXITCODE). Check az login and registry name."
  }

  Write-Host "[deploy][build] Waiting for ACR build to complete..."
  $deadline = (Get-Date).AddMinutes(30)
  $ready = $false
  while (-not $ready) {
    if ((Get-Date) -gt $deadline) {
      throw "Build timeout: image '${repo}:${ReleaseTag}' not available in ACR within 30 minutes."
    }
    Start-Sleep -Seconds 10
    # Avoid double-quoted --query: PS treats `[...]` as type literals. Build JMESPath with single-quoted segments.
    $jmes = '[?name==''' + $ReleaseTag + '''] | [0]'
    $tag = az acr repository show-tags -n $AcrName --repository $repo --detail --orderby time_desc --top 10 `
      --query $jmes -o json 2>$null
    if (-not [string]::IsNullOrWhiteSpace($tag) -and $tag -ne "null") {
      $ready = $true
      Write-Host "[deploy][build] Image ready: $image"
    }
  }
}

# ── Step 2: Create or update Container App ───────────────────
$appExists = az containerapp show -g $ResourceGroup -n $ContainerAppName --query name -o tsv 2>$null
if ([string]::IsNullOrWhiteSpace($appExists)) {
  Write-Host "[deploy] Creating new Container App '$ContainerAppName'..."
  az containerapp create `
    -g $ResourceGroup `
    -n $ContainerAppName `
    --environment $ManagedEnv `
    --image $image `
    --target-port 4000 `
    --ingress external `
    --cpu 0.5 `
    --memory 1Gi `
    --min-replicas 1 `
    --max-replicas 1 `
    --registry-server $acrLoginServer 1>$null
} else {
  Write-Host "[deploy] Updating Container App '$ContainerAppName'..."
  az containerapp update -g $ResourceGroup -n $ContainerAppName --image $image 1>$null
  az containerapp revision set-mode -g $ResourceGroup -n $ContainerAppName --mode single 1>$null
}

# ── Step 3: Sync environment variables ───────────────────────
if (-not $SkipEnvSync) {
  if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $EnvFile = ".env.azure"
  }

  if (Test-Path -LiteralPath $EnvFile) {
    Write-Host "[deploy][env] Syncing env vars from '$EnvFile'..."
    $pairs = @()
    Get-Content -LiteralPath $EnvFile | ForEach-Object {
      $line = $_.Trim()
      if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) { return }
      if ($line -notmatch "^[A-Za-z_][A-Za-z0-9_]*=") { return }
      $parts = $line -split "=", 2
      $key = $parts[0].Trim()
      $value = $parts[1]
      # Strip surrounding quotes
      if ($value.Length -ge 2) {
        $first = $value[0]; $last = $value[$value.Length - 1]
        if (($first -eq "'" -and $last -eq "'") -or ($first -eq '"' -and $last -eq '"')) {
          $value = $value.Substring(1, $value.Length - 2)
        }
      }
      $pairs += "$key=$value"
    }

    # Always override these
    $pairs += "NODE_ENV=production"
    $pairs += "PORT=4000"

    if ($pairs.Count -gt 0) {
      # Batch in groups of 15
      for ($i = 0; $i -lt $pairs.Count; $i += 15) {
        $end = [Math]::Min($i + 14, $pairs.Count - 1)
        $chunk = $pairs[$i..$end]
        az containerapp update -g $ResourceGroup -n $ContainerAppName --set-env-vars $chunk 1>$null
        Write-Host "[deploy][env] Applied batch $($i+1)-$($end+1) / $($pairs.Count)"
      }
    }
  } else {
    Write-Host "[deploy][env] WARNING: Env file '$EnvFile' not found, skipping env sync."
    Write-Host "[deploy][env] Create '$EnvFile' with your production env vars or use -SkipEnvSync."
  }
}

# ── Step 4: Smoke test ───────────────────────────────────────
Write-Host "[deploy][smoke] Checking app status..."
Start-Sleep -Seconds 5

$fqdn = az containerapp ingress show -g $ResourceGroup -n $ContainerAppName --query fqdn -o tsv
if (-not [string]::IsNullOrWhiteSpace($fqdn)) {
  $healthUrl = "https://$fqdn/api/health"
  Write-Host "[deploy][smoke] GET $healthUrl"
  try {
    $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 30
    Write-Host "[deploy][smoke] Status: $($resp.StatusCode) - $($resp.Content)"
  } catch {
    Write-Host "[deploy][smoke] WARNING: Health check failed - $($_.Exception.Message)"
    Write-Host "[deploy][smoke] The app may need a moment to start. Check logs with:"
    Write-Host "  az containerapp logs show -g $ResourceGroup -n $ContainerAppName --tail 50"
  }
}

$appUrl = "https://$fqdn"
Write-Host ""
Write-Host "[deploy] SUCCESS: $ContainerAppName deployed with tag '$ReleaseTag'."
Write-Host "[deploy] URL: $appUrl"
