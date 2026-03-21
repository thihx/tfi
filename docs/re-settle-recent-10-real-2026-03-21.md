# Re-settle Recent 10 Matches with Real Settle Path

- Ran at: 2026-03-21T02:03:46.006Z
- Matches: 10
- Recommendations: 18
- Updated rows: 13
- Corrected rows: 2
- Provenance refreshed rows: 11
- Unresolved rows: 0
- Source counts: rules=13, ai=0, unknown=0

## Skipped Matches
- 1388541: missing_history (2 rows)
- 1379263: missing_history (1 rows)
- 1379266: missing_history (1 rows)
- 1378150: missing_history (1 rows)

## Matches
### Nagoya Grampus vs Sanfrecce Hiroshima [1504713] 2-1 (FT)
- Stats rows fetched: 18
- #11011 Corners Over 9.5 @1.9 | old=loss/-6 (legacy) -> new=win/5.4 via rules [updated]

### Avispa Fukuoka vs Shimizu S-pulse [1504710] 1-1 (PEN)
- Stats rows fetched: 18
- #11010 Under 2.25 Goals @1.97 | old=win/3.88 (legacy) -> new=half_win/1.94 via rules [updated]
- #11008 BTTS No @1.94 | old=loss/-4 (legacy) -> new=loss/-4 via rules [updated]

### Pisa vs Cagliari [1378149] 3-1 (FT)
- Stats rows fetched: 18
- #2211 Corners Over 7 @1.727 | old=loss/-4 (legacy) -> new=loss/-4 via rules [updated]
- #2209 Over 4.5 Goals @1.85 | old=loss/-4 (legacy) -> new=loss/-4 via rules [updated]
- #2202 Over 3.5 Goals @1.615 | old=win/3.08 (legacy) -> new=win/3.08 via rules [updated]
- #2199 BTTS Yes @1.533 | old=win/2.13 (legacy) -> new=win/2.13 via rules [updated]

### Dundee vs Dundee Utd [1382842] 2-2 (FT)
- Stats rows fetched: 18
- #2207 Over 2.5 Goals @1.727 | old=win/2.91 (legacy) -> new=win/2.91 via rules [updated]
- #2203 Over 1.5 Goals @1.571 | old=win/2.28 (legacy) -> new=win/2.28 via rules [updated]

### Manchester United vs Aston Villa [1379265] 3-1 (FT)
- Stats rows fetched: 18
- #2206 Over 3.5 Goals @1.666 | old=win/2.66 (legacy) -> new=win/2.66 via rules [updated]
- #2201 BTTS No @1.571 | old=loss/-4 (legacy) -> new=loss/-4 via rules [updated]

### AZ Alkmaar vs Heracles [1381102] 4-0 (FT)
- Stats rows fetched: 18
- #2198 Under 3.5 Goals @1.65 | old=loss/-3 (legacy) -> new=loss/-3 via rules [updated]
- #2195 BTTS No @1.5 | old=win/2 (legacy) -> new=win/2 via rules [updated]

## AI Fallback Probe
- #2018 Home -1 @1.833 | raw=ah_home_-1 | normalized=ah_home_-1 | source=rules | result=win
- #1962 Home -1 @1.666 | raw=ah_home_-1 | normalized=ah_home_-1 | source=rules | result=win
- #1879 Home -1 @1.833 | raw=ah_home_-1 | normalized=ah_home_-1 | source=rules | result=push
- #1446 Home 0 @1.875 | raw=ah_home_0 | normalized=ah_home_0 | source=rules | result=loss
- #1018 Home 0 @1.575 | raw=ah_home_0 | normalized=ah_home_0 | source=rules | result=push
- #946 Home -1.0 @1.666 | raw=ah_home_-1 | normalized=ah_home_-1 | source=rules | result=win
- #916 AZ Alkmaar -0.5 @ 1.55 | raw=(empty) | normalized=az_alkmaar_0_5_1_55 | source=ai | result=loss
- #820 Barcelona -1.0 Asian Handicap @2.50 | raw=(empty) | normalized=asian_handicap_home_-1 | source=rules | result=push

## Post-run Corrections
- #11010: Quarter-line correction verified and persisted -> half_win / 1.94 via rules
- #916: Legacy malformed market label re-settled with real Gemini -> loss / -3 via ai (v2-strict-settle)
