# LLM Centralization Phase 1 - 2026-03-30

## Goal

Create one shared Gemini transport layer before attempting response-cache or request-dedupe.

This phase intentionally does **not** claim that all LLM outputs are cached.

## What Was Centralized

Shared Gemini `generateContent` transport now lives in:

- [gemini.ts](C:/tfi/packages/server/src/lib/gemini.ts)

This shared layer now owns:

- request URL construction
- timeout handling
- common request body building
- `thinkingConfig` retry fallback on Gemini 400 schema errors
- raw `generateContent` response retrieval

## Call Paths Moved Onto The Shared Layer

These paths now use the same transport:

- plain prompt calls via `callGemini`
- pipeline AI path
- proxy AI analyze path
- auto-settle AI fallback
- grounded strategic-context Gemini requests
- web-live-fallback Gemini requests

Concretely:

- [gemini.ts](C:/tfi/packages/server/src/lib/gemini.ts)
- [strategic-context.service.ts](C:/tfi/packages/server/src/lib/strategic-context.service.ts)
- [web-live-fallback.ts](C:/tfi/packages/server/src/lib/web-live-fallback.ts)

## What Is Not Claimed Yet

Not done in phase 1:

- prompt/result cache across LLM calls
- in-flight dedupe for identical prompts
- shared persistence for LLM request/response artifacts
- normalization of all non-Gemini providers
- policy-level cache TTL by prompt type

Those require prompt-class-specific semantics and should not be faked with a blanket cache.

## Why This Phase Comes First

Without one transport layer, later work on:

- audit
- retry policy
- response caching
- rate limiting
- provider failover

would have to be duplicated across multiple bespoke Gemini implementations.

## Verification

Validated after refactor:

- `npm test --prefix packages/server -- src/__tests__/re-evaluate.test.ts src/__tests__/strategic-context.service.test.ts src/__tests__/web-live-fallback.test.ts src/__tests__/proxy.routes.test.ts src/__tests__/server-pipeline.test.ts`
- `npm run typecheck --prefix packages/server`
