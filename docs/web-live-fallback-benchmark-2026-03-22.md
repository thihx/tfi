# Web Live Fallback Benchmark 2026-03-22

## Scope

Real probes for deterministic trusted-source spiders after adding:

- `Sofascore` deterministic `team search -> team events -> event id -> incidents/statistics`
- `ESPN` deterministic `scoreboard -> summary -> matchstats`

This benchmark measures current coverage across multiple Asian leagues and nearby markets.

## Real deterministic extractor coverage

| League | Match | Source | Result | Stat pairs | Events |
| --- | --- | --- | --- | --- | --- |
| Chinese Super League | Liaoning Tieren vs Tianjin Jinmen Tiger | ESPN | success | 7 | 4 |
| Japanese J1 League | Kashima Antlers vs JEF United Chiba | ESPN | success | 7 | 3 |
| Australian A-League Men | Perth Glory vs Melbourne City FC | ESPN | success | 7 | 1 |
| AFC Champions League Elite | Vissel Kobe vs FC Seoul | ESPN | success | 7 | 3 |
| AFC Champions League Elite | Sanfrecce Hiroshima vs Johor Darul Ta'zim | ESPN | success | 7 | 1 |

Notes:

- ESPN deterministic extraction is now usable for `J1`, `CSL`, `A-League`, and `AFC Champions`.
- Sofascore remains useful mainly for `events`, especially where ESPN is missing or partial.

## End-to-end web fallback replay on representative matches

| Match | Accepted | Elapsed | Matched URL | Search Quality | Trusted Sources | Stat Pairs | Events | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kashima Antlers vs JEF United Chiba | yes | 60.5s | Sofascore | high | 3 | 6 | 15 | accepted via deterministic Sofascore path |
| Liaoning Tieren vs Tianjin Jinmen Tiger | yes | 58.8s | Sofascore | high | 3 | 7 | 16 | accepted via deterministic Sofascore path |
| Ulsan Hyundai FC vs Gimcheon Sangmu FC | no | 96.3s | none | high | 7 | 0 | 0 | K League gap remains |
| FC Seoul vs Gwangju FC | no | 94.9s | none | medium | 1 | 0 | 0 | K League gap remains; structured Gemini fallback still brittle |

## Key findings

1. Deterministic trusted spiders are now strong enough to recover `stats + events` for several leagues:
   - `J1`
   - `CSL`
   - `A-League`
   - `AFC Champions`

2. `K League` is still the main unresolved gap.
   - ESPN does not expose K League via the tested public site API slugs.
   - Sofascore resolves some events but not enough reliable stats for the tested K League cases.

3. Current dev fallback path still burns too much time and tokens.
   - `fetchWebLiveFallback(...)` still begins with Gemini grounded search.
   - Even matches that deterministic spiders can solve still take ~`59-60s`.
   - Failed K League cases still spend ~`95s` before ending unresolved.

4. The next highest-ROI improvement is architectural:
   - move deterministic spiders (`Sofascore`, `ESPN`) ahead of the first grounded Gemini call
   - only fall back to Gemini search when deterministic sources fail

## Recommendation

Next workstream:

1. Reorder `web-live-fallback` to run deterministic spiders first.
2. Keep `Gemini grounded search` as last resort only.
3. Continue source-specific investigation for `K League`.
