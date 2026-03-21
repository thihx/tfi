# Live Smoke Real API + Real LLM

## auto: Necaxa vs Club Tijuana [1492562]
- League: Liga MX
- Status: HT 45
- success=true shouldPush=false selection=(none) confidence=0
- analysisMode=auto oddsSource=undefined statsSource=api-football evidenceMode=undefined
- statsAvailable=true oddsAvailable=undefined statsFallbackUsed=false
- provider samples: stats=4, odds=2

## system: San Martin S.J. vs San Martin Tucuman [1498392]
- League: Primera Nacional
- Status: 2H 71
- success=true shouldPush=true selection=Under 1.5 Goals @1.525 confidence=6
- analysisMode=system_force oddsSource=live statsSource=api-football evidenceMode=odds_events_only_degraded
- statsAvailable=false oddsAvailable=true statsFallbackUsed=false
- statsFallbackReason=Live Score fallback rejected: api_pairs=0, live_pairs=1, live_quality=VERY_POOR
- provider samples: stats=2, odds=1

## early: Auckland vs Macarthur [1469683]
- League: A-League
- Status: 1H 6
- success=true shouldPush=false selection=(none) confidence=0
- analysisMode=auto oddsSource=live statsSource=api-football evidenceMode=full_live_data
- statsAvailable=true oddsAvailable=true statsFallbackUsed=false
- provider samples: stats=2, odds=1

## manual: San Martin S.J. vs San Martin Tucuman [1498392]
- League: Primera Nacional
- Status: 2H 75
- success=true shouldPush=false selection=(none) confidence=0
- analysisMode=manual_force oddsSource=live statsSource=api-football evidenceMode=odds_events_only_degraded
- statsAvailable=false oddsAvailable=true statsFallbackUsed=false
- statsFallbackReason=Live Score fallback rejected: api_pairs=0, live_pairs=1, live_quality=VERY_POOR
- provider samples: stats=2, odds=1

## Transient Failures Observed
- manual: San Francisco FC vs Tauro FC [1510098] -> This operation was aborted
- manual: Cienciano vs FC Cajamarca [1512546] -> This operation was aborted
