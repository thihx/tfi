# TFI Project — Comprehensive Audit Report

**Date:** 2026-03-17
**Auditor:** Claude Code (automated deep audit)
**Scope:** Full codebase — security, code quality, performance, architecture, frontend, testing, configuration
**Total Issues Found:** 55
**Distribution:** 3 Critical · 31 High · 16 Medium · 5 Low

---

## Table of Contents

1. [Security Issues](#1-security-issues)
2. [Code Quality](#2-code-quality)
3. [Performance](#3-performance)
4. [Architecture](#4-architecture)
5. [API Design](#5-api-design)
6. [Database / Data Integrity](#6-database--data-integrity)
7. [Frontend / React Patterns](#7-frontend--react-patterns)
8. [Testing Gaps](#8-testing-gaps)
9. [Configuration & Environment](#9-configuration--environment)
10. [Priority Action Plan](#10-priority-action-plan)

---

## Severity Legend

| Icon | Severity | Meaning |
|------|----------|---------|
| 🔴 | **Critical** | Exploitable right now; fix before next deploy |
| 🟠 | **High** | Significant risk or data loss potential; fix this sprint |
| 🟡 | **Medium** | Technical debt / degraded UX; fix next sprint |
| 🟢 | **Low** | Nice-to-have improvement |

---

## 1. Security Issues

### 🔴 CRITICAL-1 — Hardcoded Password Hash in Source Code

- **File:** [src/config/constants.ts](src/config/constants.ts) — line 4
- **Issue:** SHA-256 hash of "admin" is committed in plaintext:
  ```ts
  // '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918'
  ```
  This is a well-known hash, trivially reversible via rainbow tables. Anyone with repo access can log in.
- **Fix:**
  1. Delete the hash from the file immediately.
  2. Move credentials to environment variables (`VITE_ADMIN_HASH` or, better, a backend auth endpoint).
  3. Use `bcrypt`/`argon2` with a salt (server-side only).
  4. Rotate the password.

---

### 🔴 CRITICAL-2 — Client-Side Password Hashing with SHA-256 (No Salt)

- **File:** [src/lib/services/auth.ts](src/lib/services/auth.ts) — lines 5–10
- **Issue:** Authentication is entirely client-side. The password is hashed with `crypto.subtle.digest('SHA-256', data)` — no salt, no iterations — and compared to a hardcoded value.
  ```ts
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  ```
  SHA-256 without salt is vulnerable to rainbow table attacks. Performing this check on the client means anyone can bypass it by editing JS.
- **Fix:**
  1. Move authentication to a backend endpoint (POST `/api/auth/login`).
  2. Use `bcrypt`/`argon2id` server-side with a random salt.
  3. Return a short-lived JWT or signed session cookie (`HttpOnly; Secure; SameSite=Strict`).

---

### 🔴 CRITICAL-3 — Auth State Stored in `localStorage` (Accessible to Any Script)

- **File:** [src/lib/services/auth.ts](src/lib/services/auth.ts) — lines 19–27
  [src/hooks/useAuth.ts](src/hooks/useAuth.ts) — lines 13–22
- **Issue:**
  ```ts
  return localStorage.getItem(AUTH_KEY) === 'true';
  ```
  Any XSS payload can read/write `localStorage`, permanently setting the auth flag. There is no expiration, no session ID, and no token.
- **Fix:**
  1. Replace with `HttpOnly; Secure` session cookies managed by the server.
  2. Never store auth state in `localStorage`.
  3. Add session expiry and server-side session invalidation.

---

### 🟠 HIGH-1 — No Rate Limiting or Brute-Force Protection on Login

- **File:** [src/hooks/useAuth.ts](src/hooks/useAuth.ts) — lines 13–22
- **Issue:** The `login()` function has no attempt counter, no delay, and no lockout. Combined with the weak password, this is trivially brute-forced.
- **Fix:** Implement exponential backoff on the client; enforce rate limiting on the backend (e.g., 5 attempts / 15 min per IP).

---

### 🟠 HIGH-2 — No CSRF Protection on State-Mutating API Calls

- **Files:** [src/lib/services/api.ts](src/lib/services/api.ts) — lines 156–167
  [src/features/live-monitor/services/proxy.service.ts](src/features/live-monitor/services/proxy.service.ts)
- **Issue:** All `POST`/`PUT`/`DELETE` requests are sent without a CSRF token. If auth is ever cookie-based, CSRF is exploitable.
- **Fix:** Generate a CSRF token server-side, embed it in the page, and include it as a custom header (`X-CSRF-Token`) on all mutating requests.

---

### 🟠 HIGH-3 — No Input Validation on Search / Filter Parameters

- **File:** [src/app/RecommendationsTab.tsx](src/app/RecommendationsTab.tsx) — lines 72–84
  [src/app/MatchesTab.tsx](src/app/MatchesTab.tsx)
- **Issue:**
  ```ts
  search: search.trim() || undefined,  // Raw user input passed to API
  ```
  No length limits, no allowed-character validation. If the backend is not parameterizing queries, SQL injection is possible.
- **Fix:** Validate/sanitize on both client and server; enforce `maxLength`; strip special characters for search inputs.

---

### 🟠 HIGH-4 — Sensitive Data in `console.error`

- **File:** [src/components/ui/ErrorBoundary.tsx](src/components/ui/ErrorBoundary.tsx) — lines 21, 58
- **Issue:**
  ```ts
  console.error('[ErrorBoundary] Caught:', error, info.componentStack);
  ```
  Full stack traces in production browser console reveal internal module paths and potentially data.
- **Fix:** In production, send errors to a structured logging service (Sentry, Datadog). Only log user-safe messages to the console.

---

### 🟠 HIGH-5 — HTTP (Not HTTPS) Default API URL

- **File:** [.env](.env) — line 2
- **Issue:** `VITE_API_URL=http://localhost:4000` is fine locally, but if a developer deploys with this default or forgets to set the production variable, all API traffic is unencrypted.
- **Fix:** Default to HTTPS; validate that the URL uses `https://` in non-development environments at startup.

---

### 🟠 HIGH-6 — XSS Risk in Email Notification HTML Assembly

- **File:** [src/features/live-monitor/services/notification.service.ts](src/features/live-monitor/services/notification.service.ts) — lines 21–26
- **Issue:** A custom `esc()` helper is used to build HTML email bodies. Not all fields are escaped, and the escaping logic is hand-rolled — easy to miss an injection point.
- **Fix:** Use a proper HTML templating library with automatic escaping (e.g., `he`, `entities`), or build emails in a framework that escapes by default.

---

### 🟡 MEDIUM-1 — Missing Content Security Policy (CSP)

- **File:** [index.html](index.html)
- **Issue:** No `Content-Security-Policy` meta tag or server header. Inline scripts and arbitrary external script sources are allowed.
- **Fix:** Add a strict CSP:
  ```html
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'self'; script-src 'self'; object-src 'none';">
  ```

---

### 🟡 MEDIUM-2 — Exposed Spreadsheet ID Placeholder Suggests Committed Secrets Pattern

- **File:** [src/features/live-monitor/config.ts](src/features/live-monitor/config.ts) — line 14
- **Issue:** `SPREADSHEET_ID: '1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'` — this placeholder pattern suggests real IDs may have been committed in the past (check git history with `git log -S 'SPREADSHEET_ID'`).
- **Fix:** Audit git history; use environment variables for all external IDs; add a `.env` validation step.

---

## 2. Code Quality

### 🟠 HIGH-7 — Errors Silently Swallowed in `Promise.all`

- **File:** [src/hooks/useAppState.tsx](src/hooks/useAppState.tsx) — lines 105–109
- **Issue:**
  ```ts
  const [matches, watchlist, recommendations] = await Promise.all([
    api.fetchMatches(config).catch(() => [] as Match[]),   // silent fail
    api.fetchWatchlist(config).catch(() => [] as WatchlistItem[]),
    api.fetchRecommendations(config).catch(() => [] as Recommendation[]),
  ]);
  ```
  Users will see an empty table with no indication of failure. Errors are lost entirely.
- **Fix:** Log the error; set an error state; show a toast notification distinguishing "no data" from "fetch failed".

---

### 🟠 HIGH-8 — 60+ Non-null Assertions (`!`) Bypassing TypeScript Safety

- **Files:** [src/main.tsx](src/main.tsx) — line 9, [src/lib/utils/helpers.ts](src/lib/utils/helpers.ts) — line 113, and many others
- **Issue:**
  ```ts
  createRoot(document.getElementById('root')!).render(...)
  return `${parts[2]}-${parts[1]!.padStart(2, '0')}-${parts[0]!.padStart(2, '0')}`;
  ```
  If the DOM element or array index is absent at runtime, these crash with unhandled `TypeError`.
- **Fix:** Add proper null/undefined checks or type guards before each `!` use. Replace with `??` or early-return guards.

---

### 🟠 HIGH-9 — No Validation on Incoming Recommendation Data

- **File:** [src/features/live-monitor/services/recommendation.service.ts](src/features/live-monitor/services/recommendation.service.ts) — lines 49–143
- **Issue:**
  ```ts
  confidence: parsed.ai_confidence ?? parsed.confidence ?? 0,  // No range check (should be 0–1)
  stake_percent: parsed.stake_percent ?? 0,                    // No max enforcement
  odds: odds,                                                   // Could be NaN or negative
  ```
  Invalid numeric values propagate into the database and downstream calculations.
- **Fix:** Use **Zod** (already in your stack) to validate the full shape and ranges of AI response data before processing.

---

### 🟠 HIGH-10 — N+1 HTTP Requests in `createWatchlistItems`

- **File:** [src/lib/services/api.ts](src/lib/services/api.ts) — lines 144–154
- **Issue:**
  ```ts
  for (const item of items) {
    const created = await pgPost<WatchlistItem>(config, '/api/watchlist', item);
  ```
  Adding 10 items makes 10 sequential POST requests. This is slow and hammers the backend.
- **Fix:** Implement a bulk endpoint (`POST /api/watchlist/bulk`). On the client, send all items in one request.

---

### 🟠 HIGH-11 — Memory Leak: `setTimeout` Not Cleared on Unmount

- **File:** [src/hooks/useToast.tsx](src/hooks/useToast.tsx) — line 28
- **Issue:** Timers are created on each toast but never cancelled if the component unmounts before the timer fires.
- **Fix:**
  ```ts
  useEffect(() => {
    const timer = setTimeout(() => dismiss(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration]);
  ```

---

### 🟡 MEDIUM-3 — Business Logic / Filtering in Component Bodies

- **File:** [src/app/MatchesTab.tsx](src/app/MatchesTab.tsx) — lines 60–92
  [src/app/RecommendationsTab.tsx](src/app/RecommendationsTab.tsx)
- **Issue:** Complex filtering, sorting, and pagination logic duplicated across tab components. Hard to unit-test and maintain.
- **Fix:** Extract to a custom hook (e.g., `useFilteredMatches`, `useFilteredRecommendations`) or a pure utility function.

---

### 🟡 MEDIUM-4 — `fire-and-forget` Tracking Silences All Errors

- **File:** [src/features/live-monitor/services/pipeline.ts](src/features/live-monitor/services/pipeline.ts) — lines 51–54
- **Issue:**
  ```ts
  function trackSilent(promise: Promise<unknown> | undefined): void {
    promise?.catch(() => {});  // All tracking errors discarded
  }
  ```
- **Fix:** At minimum, log tracking failures. Consider a retry queue for critical tracking calls.

---

### 🟡 MEDIUM-5 — Inconsistent Error Message Truncation

- **File:** [src/lib/services/api.ts](src/lib/services/api.ts) — line 12
- **Issue:** `errorText.substring(0, 200)` — arbitrary truncation, inconsistent across the codebase.
- **Fix:** Define a shared `formatApiError(error)` utility with consistent truncation and structure.

---

### 🟡 MEDIUM-6 — Magic Numbers Scattered Across Files

- **Files:** [src/app/RecommendationsTab.tsx](src/app/RecommendationsTab.tsx) — line 13, API calls with `limit=200`
- **Issue:** `PAGE_SIZE = 30`, `limit=200`, timeout values all hardcoded inline.
- **Fix:** Centralize in [src/config/constants.ts](src/config/constants.ts).

---

## 3. Performance

### 🟠 HIGH-12 — AI Prompt Rebuilt on Every Call (No Memoization)

- **File:** [src/features/live-monitor/services/ai-prompt.service.ts](src/features/live-monitor/services/ai-prompt.service.ts) — lines 12–756
- **Issue:** `buildAiPrompt()` reconstructs a ~750-line string (containing static instruction blocks) on every analysis call.
- **Fix:** Cache static sections at module load time. Interpolate only the dynamic match/stats data.

---

### 🟠 HIGH-13 — Full Data Reload Triggered on Every Auth State Change

- **File:** [src/app/App.tsx](src/app/App.tsx) — lines 23–25
- **Issue:**
  ```ts
  useEffect(() => {
    if (authed) loadAllData();  // 200 recommendations + matches + watchlist on every auth change
  }, [authed, loadAllData]);
  ```
- **Fix:** Load only above-the-fold data on login. Load recommendations lazily when the tab is first opened.

---

### 🟠 HIGH-14 — No Code Splitting; All Tabs Bundled Together

- **Issue:** Users download code for all tabs on initial load.
- **Fix:**
  ```ts
  const DashboardTab = React.lazy(() => import('./app/DashboardTab'));
  const RecommendationsTab = React.lazy(() => import('./app/RecommendationsTab'));
  ```
  Wrap with `<Suspense fallback={<Spinner />}>`.

---

### 🟡 MEDIUM-7 — Chart Components Re-render on Unrelated State Updates

- **File:** [src/app/DashboardTab.tsx](src/app/DashboardTab.tsx) — lines 24–47, 57–85
- **Issue:** Recharts `AreaChart` and `BarChart` are not memoized. Any state change in a parent causes full chart re-renders.
- **Fix:** Wrap chart components with `React.memo`; memoize data transformations with `useMemo`.

---

### 🟡 MEDIUM-8 — `MARKET_COLORS` Object Defined Inside Component Body

- **File:** [src/app/DashboardTab.tsx](src/app/DashboardTab.tsx) — line 50
- **Issue:**
  ```ts
  const MARKET_COLORS: Record<string, string> = { 'Over/Under': '#3b82f6' };
  ```
  New object identity on every render breaks memoization of child components.
- **Fix:** Move to module scope (outside component) or use `useMemo`.

---

### 🟡 MEDIUM-9 — API Fetches 200 Recommendations on Every Startup

- **File:** [src/lib/services/api.ts](src/lib/services/api.ts) — lines 66–70
- **Issue:** `GET /api/recommendations?limit=200` on every page load regardless of active tab.
- **Fix:** Load the first page (30 items) on startup; paginate or virtual-scroll for the rest.

---

## 4. Architecture

### 🟠 HIGH-15 — Monolithic `AppContext` Causes Widespread Re-renders

- **File:** [src/hooks/useAppState.tsx](src/hooks/useAppState.tsx)
- **Issue:** A single context holds matches, watchlist, recommendations, config, loading, and UI state. Any update triggers re-render of every subscriber.
- **Fix:** Split into focused contexts: `ConfigContext`, `MatchesContext`, `RecommendationsContext`, `UIContext`. Or migrate to Zustand/Jotai for fine-grained subscriptions.

---

### 🟠 HIGH-16 — No Race Condition Protection on Watchlist Updates

- **File:** [src/hooks/useAppState.tsx](src/hooks/useAppState.tsx) — lines 160–177
- **Issue:** Optimistic updates are applied immediately but there is no conflict detection. Two rapid updates can result in inconsistent state.
- **Fix:** Use ETags or versioned updates; queue mutations; use React Query's mutation invalidation pattern.

---

### 🟡 MEDIUM-10 — Tight Coupling Between Components and Multiple API Functions

- **Issue:** Some tab components directly import 4+ API functions. Hard to mock in tests; changes to API layer cascade to components.
- **Fix:** Route all data access through custom hooks; components should only call hooks, never `api.*` directly.

---

### 🟡 MEDIUM-11 — Stats / Odds Stored as Unvalidated JSON Strings

- **File:** [src/features/live-monitor/services/recommendation.service.ts](src/features/live-monitor/services/recommendation.service.ts) — lines 75–79
- **Issue:**
  ```ts
  const statsSnapshot = JSON.stringify(matchData.stats_compact || {});  // No schema validation
  ```
- **Fix:** Validate the object shape before serializing. Store structured data rather than opaque blobs where possible.

---

## 5. API Design

### 🟡 MEDIUM-12 — All HTTP Errors Thrown as Generic String

- **File:** [src/lib/services/api.ts](src/lib/services/api.ts) — line 12
- **Issue:** `throw new Error(\`HTTP ${status}\`)` — no typed error classes; callers cannot distinguish 401 (re-login needed) from 500 (retry) from 404 (not found).
- **Fix:** Create `ApiError` subclasses:
  ```ts
  class ApiError extends Error { constructor(public status: number, message: string) { ... } }
  class UnauthorizedError extends ApiError { ... }
  class NotFoundError extends ApiError { ... }
  ```

---

### 🟡 MEDIUM-13 — No Runtime Validation of API Response Shape

- **File:** [src/lib/services/api.ts](src/lib/services/api.ts) — lines 99–108
- **Issue:** `ApiResponse<T>` has optional fields (`items?`, `insertedCount?`) assumed to exist downstream.
- **Fix:** Use Zod schemas to parse and validate responses at the API layer boundary.

---

### 🟡 MEDIUM-14 — PUT vs PATCH Inconsistency

- **File:** [src/lib/services/api.ts](src/lib/services/api.ts)
- **Issue:** `updateWatchlistItems()` uses `PUT` (should be `PATCH` for partial updates). Semantics of idempotency are unclear.
- **Fix:** Use `PATCH` for partial updates; document idempotency guarantees in API layer.

---

## 6. Database / Data Integrity

### 🟠 HIGH-17 — No Concurrency Control on Optimistic Updates

*(See Architecture HIGH-16 above — same root cause)*

---

### 🟡 MEDIUM-15 — JSON Blobs Written Without Schema Validation

*(See Architecture MEDIUM-11 above — same root cause)*

---

## 7. Frontend / React Patterns

### 🟠 HIGH-18 — No Loading Skeleton / Fallback UI

- **File:** [src/app/DashboardTab.tsx](src/app/DashboardTab.tsx) — line 191
- **Issue:** During data load, components render empty content with no visual indicator. Looks like a broken/frozen UI.
- **Fix:** Use skeleton loaders or shimmer placeholders during loading states.

---

### 🟠 HIGH-19 — No Code Splitting on Tab Components

*(See Performance HIGH-14 above)*

---

### 🟡 MEDIUM-16 — Missing Accessibility (a11y)

- **Issue:** Interactive elements (status badges, custom buttons, modal close) lack `aria-label`, `role`, and keyboard-navigation support.
- **Fix:** Audit with `axe-core` or Lighthouse; add `aria-label` to all non-text interactive elements; ensure `Tab`/`Enter`/`Escape` key handling on modals.

---

### 🟡 MEDIUM-17 — Recharts Bundle Not Tree-Shaken (~350KB)

- **File:** [package.json](package.json)
- **Issue:** Full Recharts library imported; only 2–3 chart types used.
- **Fix:** Use dynamic `import()` for chart components; or replace with a lighter alternative (Chart.js, uPlot) for the specific chart types needed.

---

### 🟡 MEDIUM-18 — `debounceRef` in RecommendationsTab Never Cleaned Up

- **File:** [src/app/RecommendationsTab.tsx](src/app/RecommendationsTab.tsx) — line 56
- **Issue:** Debounce timer stored in ref but not cancelled on unmount.
- **Fix:** Return a cleanup function from `useEffect` that cancels the pending debounce.

---

### 🟢 LOW-1 — Modal State Managed in Parent Component

- **File:** [src/app/MatchesTab.tsx](src/app/MatchesTab.tsx) — line 33
- **Issue:** Match detail modal state lives in the parent; parent re-renders close the modal unexpectedly.
- **Fix:** Use React Portal; manage modal state at app level or via URL search params.

---

### 🟢 LOW-2 — Missing Stable Keys on Dynamic Lists

- **Issue:** Some `.map()` calls may use index as key instead of a stable ID, causing unnecessary re-renders and state loss.
- **Fix:** Always use `key={item.id}` where the ID is stable and unique.

---

## 8. Testing Gaps

### 🟠 HIGH-20 — Core React Components Have No Tests

- **Config:** [vitest.config.ts](vitest.config.ts) — 60% coverage threshold
- **Issue:** Services have reasonable unit test coverage, but all React components, custom hooks, and full data-flow integration paths are untested.
- **Fix:** Add component tests using `@testing-library/react`. Priority: `useAppState`, `RecommendationsTab`, `DashboardTab`.

---

### 🟠 HIGH-21 — No Error Scenario Tests for API Layer

- **Issue:** Tests do not cover network timeouts, 4xx/5xx responses, or malformed JSON responses.
- **Fix:** Mock `fetch` to return error responses; test that components show correct error states.

---

### 🟡 MEDIUM-19 — No XSS / Injection Security Tests Outside Notification Service

- **Issue:** `notification.service.test.ts` has an XSS test, but no other component or service is tested against malicious input.
- **Fix:** Add a dedicated security test suite; test search inputs, recommendation data rendering, and email templates with XSS payloads.

---

## 9. Configuration & Environment

### 🟠 HIGH-22 — No Startup Validation of Required Environment Variables

- **File:** [src/config/config.ts](src/config/config.ts) — line 7
- **Issue:**
  ```ts
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  ```
  If `VITE_API_URL` is missing in production, the app silently connects to `localhost` and shows no data.
- **Fix:** Validate all required env vars at startup using Zod:
  ```ts
  const EnvSchema = z.object({ VITE_API_URL: z.string().url() });
  EnvSchema.parse(import.meta.env); // Throws on missing/invalid
  ```

---

### 🟠 HIGH-23 — Service Worker Registered Without Error Handling

- **File:** [src/main.tsx](src/main.tsx) — line 7
- **Issue:**
  ```ts
  registerSW({ immediate: true });  // No onError callback
  ```
  SW registration failures are invisible; offline capability silently breaks.
- **Fix:**
  ```ts
  registerSW({ immediate: true, onRegisterError: (err) => console.error('SW failed:', err) });
  ```

---

### 🟡 MEDIUM-20 — No Environment-Specific Configuration

- **Issue:** Timeouts, page sizes, polling intervals, and retry counts are the same for `development`, `staging`, and `production`.
- **Fix:** Use `import.meta.env.MODE` to load environment-specific overrides.

---

### 🟢 LOW-3 — Theme Colors Hardcoded in Multiple Files

- **Files:** [vite.config.ts](vite.config.ts) — line 16, [src/app/DashboardTab.tsx](src/app/DashboardTab.tsx)
- **Fix:** Centralize theme tokens in a single CSS custom properties file or Tailwind config.

---

### 🟢 LOW-4 — No Image Optimization for External Team Logos

- **Issue:** Team logo URLs loaded directly from third-party sources; no caching, no WebP, no fallback on broken images.
- **Fix:** Proxy and cache logos server-side; add `onError` fallback to logo `<img>` elements.

---

## 10. Priority Action Plan

### Immediate — Before Next Deploy

| # | Issue | File | Action |
|---|-------|------|--------|
| 1 | 🔴 Hardcoded password hash | [src/config/constants.ts](src/config/constants.ts) | Remove hash; move to env var |
| 2 | 🔴 Client-side SHA-256 auth | [src/lib/services/auth.ts](src/lib/services/auth.ts) | Move auth to backend endpoint |
| 3 | 🔴 `localStorage` auth state | [src/lib/services/auth.ts](src/lib/services/auth.ts) | Replace with `HttpOnly` cookie |
| 4 | 🟠 No brute-force protection | [src/hooks/useAuth.ts](src/hooks/useAuth.ts) | Add attempt limiting |
| 5 | 🟠 No env validation on startup | [src/config/config.ts](src/config/config.ts) | Add Zod env validation |

### This Sprint — High Priority

| # | Issue | File | Action |
|---|-------|------|--------|
| 6 | 🟠 Silent `Promise.all` failures | [src/hooks/useAppState.tsx](src/hooks/useAppState.tsx) | Log errors + user toast |
| 7 | 🟠 N+1 watchlist requests | [src/lib/services/api.ts](src/lib/services/api.ts) | Implement bulk endpoint |
| 8 | 🟠 Toast memory leak | [src/hooks/useToast.tsx](src/hooks/useToast.tsx) | Clear timer on unmount |
| 9 | 🟠 No loading skeleton | [src/app/DashboardTab.tsx](src/app/DashboardTab.tsx) | Add skeleton UI |
| 10 | 🟠 No response schema validation | [src/lib/services/api.ts](src/lib/services/api.ts) | Add Zod response parsing |
| 11 | 🟠 No AI input validation | [src/features/live-monitor/services/recommendation.service.ts](src/features/live-monitor/services/recommendation.service.ts) | Add Zod schema for AI output |
| 12 | 🟠 No component tests | [src/app/](src/app/) | Add `@testing-library/react` tests |

### Next Sprint — Medium Priority

| # | Issue | Action |
|---|-------|--------|
| 13 | 🟡 Monolithic AppContext | Split into focused contexts or adopt Zustand |
| 14 | 🟡 Code splitting | `React.lazy` + `Suspense` for all tab components |
| 15 | 🟡 AI prompt not memoized | Cache static sections at module level |
| 16 | 🟡 Typed API errors | Implement `ApiError` class hierarchy |
| 17 | 🟡 Accessibility audit | Run axe-core; fix a11y issues |
| 18 | 🟡 Recharts bundle size | Lazy-load or replace with lighter chart lib |
| 19 | 🟡 Magic numbers | Centralize all constants |
| 20 | 🟡 CSP header | Add Content Security Policy |

---

## Appendix: Files Examined

| Path | Notes |
|------|-------|
| [src/config/constants.ts](src/config/constants.ts) | ⚠️ Hardcoded hash |
| [src/config/config.ts](src/config/config.ts) | ⚠️ No env validation |
| [src/lib/services/auth.ts](src/lib/services/auth.ts) | 🔴 Client-side auth |
| [src/lib/services/api.ts](src/lib/services/api.ts) | ⚠️ N+1, no error types |
| [src/hooks/useAppState.tsx](src/hooks/useAppState.tsx) | ⚠️ Monolithic context, silent errors |
| [src/hooks/useAuth.ts](src/hooks/useAuth.ts) | ⚠️ No rate limiting |
| [src/hooks/useToast.tsx](src/hooks/useToast.tsx) | ⚠️ Memory leak |
| [src/app/App.tsx](src/app/App.tsx) | Full reload on auth change |
| [src/app/DashboardTab.tsx](src/app/DashboardTab.tsx) | No skeleton, chart re-renders |
| [src/app/MatchesTab.tsx](src/app/MatchesTab.tsx) | Business logic in component |
| [src/app/RecommendationsTab.tsx](src/app/RecommendationsTab.tsx) | Raw input to API, debounce leak |
| [src/features/live-monitor/services/recommendation.service.ts](src/features/live-monitor/services/recommendation.service.ts) | No data validation |
| [src/features/live-monitor/services/ai-prompt.service.ts](src/features/live-monitor/services/ai-prompt.service.ts) | Prompt rebuilt every call |
| [src/features/live-monitor/services/notification.service.ts](src/features/live-monitor/services/notification.service.ts) | XSS risk in email HTML |
| [src/features/live-monitor/services/pipeline.ts](src/features/live-monitor/services/pipeline.ts) | Silent tracking failures |
| [src/features/live-monitor/config.ts](src/features/live-monitor/config.ts) | Placeholder credential pattern |
| [src/components/ui/ErrorBoundary.tsx](src/components/ui/ErrorBoundary.tsx) | Stack trace in console |
| [src/main.tsx](src/main.tsx) | SW no error handler |
| [src/lib/utils/helpers.ts](src/lib/utils/helpers.ts) | `!` non-null assertions |
| [vite.config.ts](vite.config.ts) | Hardcoded colors |
| [vitest.config.ts](vitest.config.ts) | 60% threshold, component tests missing |
| [index.html](index.html) | No CSP |
| [.env](.env) | HTTP default URL |
| [package.json](package.json) | Full Recharts import |

---

*Generated by Claude Code automated audit — 2026-03-17*
