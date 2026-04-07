# Web Live Fallback Benchmark 2026-03-22 (archived)

This document described deterministic web scrapers (Sofascore, ESPN, K League portal) and a Gemini-grounded **web live stats fallback** used alongside API-Football.

**Status (2026-04): removed from the codebase.** The server no longer ships `web-live-fallback`, related extractors, or Live Score API integration. Live match statistics and events for the pipeline come **only from API-Football (API-Sports)**.

The tables and recommendations below are kept only as historical context for why the feature was retired (latency, token cost, maintenance burden, uneven league coverage).

---

## Original scope (historical)

Real probes for deterministic trusted-source spiders after adding:

- Sofascore deterministic `team search -> team events -> event id -> incidents/statistics`
- ESPN deterministic `scoreboard -> summary -> matchstats`

## Real deterministic extractor coverage (historical)

| League | Match | Source | Result | Stat pairs | Events |
| --- | --- | --- | --- | --- | --- |
| Chinese Super League | Liaoning Tieren vs Tianjin Jinmen Tiger | ESPN | success | 7 | 4 |
| Japanese J1 League | Kashima Antlers vs JEF United Chiba | ESPN | success | 7 | 3 |
| Australian A-League Men | Perth Glory vs Melbourne City FC | ESPN | success | 7 | 1 |
| AFC Champions League Elite | Vissel Kobe vs FC Seoul | ESPN | success | 7 | 3 |
| AFC Champions League Elite | Sanfrecce Hiroshima vs Johor Darul Ta'zim | ESPN | success | 7 | 1 |

## End-to-end web fallback replay (historical)

| Match | Accepted | Elapsed | Matched URL | Search Quality | Trusted Sources | Stat Pairs | Events | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kashima Antlers vs JEF United Chiba | yes | 60.5s | Sofascore | high | 3 | 6 | 15 | accepted via deterministic Sofascore path |
| Liaoning Tieren vs Tianjin Jinmen Tiger | yes | 58.8s | Sofascore | high | 3 | 7 | 16 | accepted via deterministic Sofascore path |
| Ulsan Hyundai FC vs Gimcheon Sangmu FC | no | 96.3s | none | high | 7 | 0 | 0 | K League gap remains |
| FC Seoul vs Gwangju FC | no | 94.9s | none | medium | 1 | 0 | 0 | K League gap remains; structured Gemini fallback still brittle |
