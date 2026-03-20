param([string]$Tag = "v1.0.21")

Set-Location c:\tfi
$ErrorActionPreference = "Stop"

Write-Host "=== Git Status ===" -ForegroundColor Cyan
git status --short

Write-Host "`n=== Adding files ===" -ForegroundColor Cyan
git add packages/server/src/jobs/auto-settle.job.ts
git add packages/server/src/jobs/re-evaluate.job.ts
git add packages/server/src/__tests__/auto-settle.test.ts
git add packages/server/src/__tests__/auto-settle.integration.test.ts
git add packages/server/src/__tests__/re-evaluate.test.ts
git add packages/server/src/repos/recommendations.repo.ts
git add src/features/live-monitor/services/recommendation.service.ts
git add src/features/live-monitor/types.ts
git add src/features/live-monitor/services/match-merger.service.ts
git add src/components/ui/MatchDetailModal.tsx
git add src/app/MatchesTab.tsx
git add packages/server/src/repos/matches.repo.ts
git add packages/server/src/jobs/fetch-matches.job.ts
git add src/types/index.ts

Write-Host "`n=== Committing ===" -ForegroundColor Cyan
git commit -m "feat: AI-based auto-settle + save bug fix ($Tag)

- Replace expression-based evaluateBet() with AI-based settleWithAI()
- AI (Gemini) evaluates all market types with match stats + Vietnamese explanation
- Fix save bug: settled_at='' crashes PostgreSQL, now sends null
- Update re-evaluate job to use AI settlement
- All unit + integration tests updated and passing"

Write-Host "`n=== Done ===" -ForegroundColor Cyan
git log --oneline -3
