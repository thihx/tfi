# Gemini model benchmark (same replay task)

- Generated: 2026-05-24T02:06:34.919Z
- Prompt: v10-hybrid-legacy-b
- Post-parse policy: yes
- Scenarios: 6
- Baseline: `gemini-2.5-flash`
- Candidate: `gemini-3.5-flash`

## API smoke (minimal JSON prompt)

| Model | OK | Latency ms |
| --- | --- | --- |
| gemini-2.5-flash | yes | 1247 |
| gemini-3.5-flash | yes | 1459 |

## Speed (replay pipeline)

| Metric | gemini-2.5-flash | gemini-3.5-flash | Delta (candidate - baseline) |
| --- | --- | --- | --- |
| Median LLM latency ms | 24048 | 21806 | -2241 |
| Median total latency ms | 26105 | 23832 | -2273 |
| Median prompt chars | 26643 | 26643 | 0 |
| Errors | 0 | 0 | |

## Prediction quality (settled replay cohort)

| Metric | gemini-2.5-flash | gemini-3.5-flash |
| --- | --- | --- |
| Push rate | 50.0% | 33.3% |
| Push agreement vs original | 50.0% | 66.7% |
| Directional accuracy (settled pushes) | 66.7% | 50.0% |
| Replay ROI (mock stakes) | 0.0% | 0.0% |

## Head-to-head (same scenario)

- Push decision agreement: 50.0%
- Same canonical market when both push: 16.7%
- Both win (when both pushed & settled): 1
- Baseline win only: 1
- Candidate win only: 0

## Recommendation rubric

- **Speed:** prefer candidate if median LLM latency drops ≥15% with ≤1 extra error.
- **Quality:** candidate must not lower directional accuracy by >3pp on this cohort without a compensating ROI gain.
- **Stability:** both models must pass smoke; check API errors for thinking_config / model ID.
