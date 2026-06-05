# Live Recommendation Telemetry Readiness

**Updated:** 2026-06-06  
**Scope:** buoc bat buoc truoc khi promote bat ky pocket live recommendation nao tu shadow/counterfactual sang runtime save/notify.

Tai lieu nay bo sung cho:

- [live-recommendation-pipeline-vi.md](./live-recommendation-pipeline-vi.md)
- [live-recommendation-guard-relaxation-contract-vi.md](./live-recommendation-guard-relaxation-contract-vi.md)
- [live-recommendation-pocket-specs-vi.md](./live-recommendation-pocket-specs-vi.md)

## Muc tieu

Truoc khi noi guard, phai chung minh audit data khong con bi mu:

- minute va score co mat;
- evidence mode co mat;
- value_percent va risk_level co mat;
- best rejected candidate duoc ghi trong cung LLM response;
- shadow candidate duoc map ve canonical market/odds neu co line that;
- khong tang provider call hoac LLM call.

## Shadow Candidate Contract

Prompt yeu cau model luon tra ve `shadow_candidate`:

```json
{
  "shadow_candidate": {
    "selection": "Over 2.5 Goals @1.85",
    "bet_market": "over_2.5",
    "confidence": 6,
    "value_percent": 5,
    "risk_level": "MEDIUM",
    "stake_percent": 1,
    "reason_code": "thin_edge",
    "reason_en": "Projected edge is too thin for an automatic bet.",
    "reason_vi": "Edge du kien qua mong cho keo tu dong."
  }
}
```

Quy tac:

- `shadow_candidate` la telemetry only.
- Khong save, khong notify, khong set `should_push=true` chi de surface candidate.
- Parser map candidate bang canonical odds snapshot; odds invent/unmapped se hien `shadowCandidateMarketResolutionStatus != resolved`.
- Neu khong co candidate nao dang can nhac, dung `reason_code="no_viable_candidate"` va de trong `selection`/`bet_market`.

## Lenh Theo Doi

Sau deploy 48h:

```powershell
npm run data-driven:live-telemetry-readiness --prefix packages/server -- --short-hours 48 --long-hours 168 --out-json <dir>/live-telemetry-readiness.json --out-md <dir>/live-telemetry-readiness.md
```

Neu can xem sample chi tiet:

```powershell
npm run data-driven:current-runtime-no-save --prefix packages/server -- --lookback-hours 48 --out-json <dir>/current-runtime-no-save.json --out-md <dir>/current-runtime-no-save.md
```

## No-Promote Rules

Khong promote pocket neu report co bat ky `noPromoteReasons` nao:

- `no_audit_rows`
- `missing_minute`
- `missing_score`
- `missing_evidence_mode`
- `missing_value_percent`
- `missing_risk_level`
- `missing_shadow_candidate`
- `resolved_shadow_candidates_below_20`

Khong promote neu shadow candidates resolved du 20 nhung:

- ROI counterfactual am sau stake cap;
- loss cluster tap trung vao mot match/league;
- high-risk/degraded evidence dang chiem ty trong lon;
- same-thesis/segment warnings tang;
- market-resolution/save-integrity warnings tang.

## Handoff Checklist

Moi lan review pocket tiep theo phai gom:

- readiness report path 48h/168h;
- current-runtime no-save report path;
- blocked-selection/settlement report path neu co candidate;
- count shadow candidate present/resolved;
- top reason_code va canonical market;
- no-promote reasons;
- quota impact: so LLM call va provider call khong duoc tang dot bien;
- rollback/kill switch neu pocket da duoc bat opt-in.

