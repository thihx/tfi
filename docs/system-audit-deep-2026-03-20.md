# TFI Deep Comprehensive Audit (Validated)

Date: 2026-03-20

## Scope and method

This audit is based on:
- Static review of frontend + backend source paths in this workspace.
- Existing run artifacts in workspace logs (test/build/audit outputs).
- Cross-check against previous audit to keep only findings still valid in current code.

Primary evidence files:
- [test-result.txt](test-result.txt)
- [audit-result-v2.txt](audit-result-v2.txt)
- [build-log.txt](build-log.txt)

## Executive summary

- Total validated findings: 4
- Severity split: 2 High, 2 Medium
- Current fix status: 3/4 findings fixed in code, 1/4 pending (dependency vulnerability remediation).
- Release readiness now: significantly improved; CI determinism and auth hardening landed.

## Validated findings

### F1 (High) - Frontend test suite is red due contract drift between tests and implementation

Status: Fixed

Impact:
- CI signal is noisy; real regressions can be hidden by known failures.
- Developer confidence is reduced because test failures are not tied to runtime breakages.

Evidence:
- Failing assertion for nullable settlement field: [test-result.txt#L15](test-result.txt#L15)
- Failing snapshot mapping assertion mismatch: [test-result.txt#L23](test-result.txt#L23), [test-result.txt#L24](test-result.txt#L24)
- Implementation now returns `settled_at: null`: [src/features/live-monitor/services/recommendation.service.ts#L141](src/features/live-monitor/services/recommendation.service.ts#L141)
- Implementation now includes richer snapshot shape: [src/features/live-monitor/services/proxy.service.ts#L179](src/features/live-monitor/services/proxy.service.ts#L179), [src/features/live-monitor/services/proxy.service.ts#L187](src/features/live-monitor/services/proxy.service.ts#L187), [src/features/live-monitor/services/proxy.service.ts#L189](src/features/live-monitor/services/proxy.service.ts#L189)
- Tests still assert old expectations: [src/features/live-monitor/__tests__/recommendation.service.test.ts#L118](src/features/live-monitor/__tests__/recommendation.service.test.ts#L118), [src/features/live-monitor/__tests__/proxy-context.test.ts#L112](src/features/live-monitor/__tests__/proxy-context.test.ts#L112)

Root cause:
- Service contracts evolved, but assertions were not updated.

Fix plan:
1. Update tests to match current contract (`settled_at` nullable, richer snapshot fields).
2. Add a lightweight contract test around proxy snapshot schema to prevent future drift.
3. Keep one compatibility assertion if backward compatibility is required by consumers.

---

### F2 (High) - Default test run includes real LLM integration/audit tests, causing unstable and very slow CI

Status: Fixed

Impact:
- Test runs can exceed 50 minutes and occasionally timeout/fail on network/model variance.
- Non-deterministic LLM behavior can flip pass/fail for rule checks, producing flaky pipelines.

Evidence:
- Default include pattern runs all `*.test.ts(x)`: [vitest.config.ts#L22](vitest.config.ts#L22)
- Real LLM tests are in default tree and active when key exists: [src/features/live-monitor/__tests__/ai-integration.test.ts#L115](src/features/live-monitor/__tests__/ai-integration.test.ts#L115), [src/features/live-monitor/__tests__/ai-prompt-audit.test.ts#L143](src/features/live-monitor/__tests__/ai-prompt-audit.test.ts#L143)
- Tests directly call Gemini API: [src/features/live-monitor/__tests__/ai-integration.test.ts#L41](src/features/live-monitor/__tests__/ai-integration.test.ts#L41), [src/features/live-monitor/__tests__/ai-prompt-audit.test.ts#L41](src/features/live-monitor/__tests__/ai-prompt-audit.test.ts#L41)
- Very long durations observed: [test-result.txt#L153](test-result.txt#L153), [test-result.txt#L559](test-result.txt#L559), [audit-result-v2.txt#L338](audit-result-v2.txt#L338)
- Timeout observed in audit run: [audit-result-v2.txt#L38](audit-result-v2.txt#L38), [audit-result-v2.txt#L316](audit-result-v2.txt#L316)
- Inconsistent outcomes across runs (3 failed vs 0 failed): [test-result.txt#L177](test-result.txt#L177), [audit-result-v2.txt#L82](audit-result-v2.txt#L82)

Root cause:
- Deterministic unit test command is mixed with network-bound model-behavior validation.

Fix plan:
1. Split test tiers:
   - Unit/contract tests in default `npm test` (deterministic, no network).
   - LLM integration/audit in separate command (example: `test:llm`).
2. Gate LLM suites behind explicit env flag (not just API key presence).
3. Publish LLM audit as periodic job (nightly/manual), not merge-blocking CI gate.

---

### F3 (Medium) - OAuth JWT is still delivered to frontend URL fragment and stored in localStorage

Status: Fixed

Impact:
- Token is exposed to browser context and can be exfiltrated via XSS.
- URL fragment is safer than query string, but still appears in browser history until replaced and is readable by client scripts.

Evidence:
- Backend redirects with token in URL hash: [packages/server/src/routes/auth.routes.ts#L40](packages/server/src/routes/auth.routes.ts#L40), [packages/server/src/routes/auth.routes.ts#L206](packages/server/src/routes/auth.routes.ts#L206)
- Frontend reads token from URL and persists it: [src/hooks/useAuth.ts#L24](src/hooks/useAuth.ts#L24)
- Token storage is localStorage-based: [src/lib/services/auth.ts#L16](src/lib/services/auth.ts#L16), [src/lib/services/auth.ts#L20](src/lib/services/auth.ts#L20)

Root cause:
- Auth flow optimized for frontend simplicity over stronger browser token isolation.

Fix plan:
1. Move to HttpOnly, Secure, SameSite cookie session for auth token.
2. Replace hash-token redirect with short-lived one-time auth code exchange.
3. Add CSP hardening to reduce XSS blast radius if localStorage must remain temporarily.

---

### F4 (Medium) - High-severity dependency vulnerabilities are still reported in build pipeline

Status: Pending

Impact:
- Known high CVEs in dependency tree increase supply-chain risk.
- Security posture may block enterprise deployment/compliance checks.

Evidence:
- Build log reports: [build-log.txt#L80](build-log.txt#L80)

Root cause:
- Dependency updates have not fully addressed transitive vulnerabilities.

Fix plan:
1. Run `npm audit` and `npm audit --prefix packages/server` as part of security tasking.
2. Patch direct dependencies first, then review transitive upgrades.
3. Add weekly dependency review policy with lockfile refresh and smoke tests.

## What was re-validated as already fixed (not reopened)

The following previously critical areas appear improved in current code and are not reopened in this report:
- Auth bootstrap fail-open risk mitigated by stricter startup checks: [packages/server/src/index.ts#L85](packages/server/src/index.ts#L85)
- OAuth `state` handling exists: [packages/server/src/routes/auth.routes.ts#L112](packages/server/src/routes/auth.routes.ts#L112), [packages/server/src/routes/auth.routes.ts#L137](packages/server/src/routes/auth.routes.ts#L137)
- Match archival path now explicitly handles freshly finished fixtures: [packages/server/src/jobs/fetch-matches.job.ts#L197](packages/server/src/jobs/fetch-matches.job.ts#L197)
- AI performance tracking from pipeline path exists: [packages/server/src/lib/server-pipeline.ts#L1006](packages/server/src/lib/server-pipeline.ts#L1006)

## Suggested execution order for another developer

1. Fix F1 first (quickest, restores baseline CI trust).
2. Fix F2 second (largest reliability/time win for team velocity).
3. Implement F3 auth hardening (security uplift).
4. Execute F4 dependency remediation with controlled upgrade/testing window.

## Acceptance criteria (ready-to-close)

- `npm test` completes in predictable time without network calls and without flaky failures.
- Frontend tests no longer fail on stale contract assertions.
- Auth flow no longer places JWT in URL or localStorage.
- No High/Critical vulnerabilities remain in dependency audit for approved environments.
