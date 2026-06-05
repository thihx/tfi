# Live Recommendation Guard Relaxation Contract

**Updated:** 2026-06-06  
**Scope:** contract bat buoc truoc khi noi, shadow, promote, hoac go bo guard trong AI live recommendation pipeline.

Tai lieu nay bo sung cho [live-recommendation-pipeline-vi.md](./live-recommendation-pipeline-vi.md). Neu co mau thuan, source of truth runtime van la `live-recommendation-pipeline-vi.md` va code hien hanh.

## 1. Muc tieu

Moi thay doi guard/policy phai phuc vu it nhat mot muc tieu do duoc:

- Tang so luong recommendation hop le trong live betting ma khong bien pipeline thanh spam keo.
- Giam `no_bet_intentional` do prompt/policy qua chat khi co edge live ro rang.
- Giu nguyen tinh dung cua market normalization, canonical odds, save integrity, same-thesis exposure, va bankroll discipline.
- Khong tang dot bien provider call hoac LLM quota. Mac dinh benchmark dung DB/audit/mock; real LLM chi chay khi duoc phep ro rang.

## 2. Nguyen tac betting

Pipeline khong duoc dong nhat "keo tot" voi "odds cao". Trong live betting, nhieu edge tot nam o vung odds `1.55-1.90`, dac biet khi:

- full live stats va live odds deu san sang;
- score/minute tao ra cua so entry ngan;
- market co line ro rang va settle duoc;
- selection co cushion hoac protection hop ly;
- stake duoc cap thap.

Vi vay, noi guard phai theo **pocket cu the**, khong ha global threshold mot cach rong:

- Khong giam global `PIPELINE_MIN_CONFIDENCE` neu khong co replay/settlement evidence manh.
- Khong tat `applyRecommendationPolicy`.
- Khong tat evidence allowlist, line patience, same-thesis cap, segment blocklist, hoac save integrity.
- Khong cho model tu do invent market/odds.

## 3. Hard Guards Khong Duoc Noi

Nhung guard sau la bat bien tru khi co migration/rfc rieng:

- `normalizeMarket(...) === 'unknown'` thi khong save.
- Odds unavailable, unmapped, suspicious toan feed, hoac below min odds thi khong save.
- Browser khong duoc goi provider truc tiep; provider access di qua backend va `packages/server/src/lib/football-api.ts`.
- Prompt official van la `v10-hybrid-legacy-g`; khong tao prompt ung vien/shadow moi neu chua co baseline contract rieng.
- Strict JSON output contract cua prompt khong duoc pha.
- Advisory/manual prompt-only flow khong save/notify nhu auto recommendation.
- Same-thesis count/stake cap van hoat dong.
- Segment blocklist co quyen override bat ky pocket nao.
- High-risk market khong duoc promote khi evidence khong phai `full_live_data`.
- `1x2_draw` van bi block.

## 4. Guard Co The Review

Nhung guard sau duoc phep review, nhung chi bang pocket va benchmark:

| Guard / Warning | Trang thai mac dinh | Cach review hop le |
| --- | --- | --- |
| `REQUIRED_CONDITIONS_NOT_MET` | Review | Tao pocket theo market/minute/score/evidence/odds/confidence/edge |
| `POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL` | Review | Chi noi neu edge thuc te va settlement pocket duong |
| `OVER_1_5_BLOCKED_LATE_MIDGAME` | Review | Chi cho 60-84, one-goal margin, full-live, stake cap |
| AH small-line guard | Review | Chi voi line `+/-0.25` den `+/-0.75`, full-live, stake cap |
| `odds_events_only_degraded` auto block | Shadow only | Chi xem O/U hoac AH, confidence/stake cap thap, khong props |
| Goals Under thin cushion | Very strict | Mac dinh giu; chi rescue pocket voi cushion/score/minute cuc ro |
| BTTS No pre60 / goal-margin | Very strict | Mac dinh giu; chi shadow sau khi co settlement sample |
| Corners hot-zone | Very strict | Mac dinh giu; props can sample rieng va stake nho |

## 5. Pocket Specification Template

Moi pocket moi phai co spec dung mau nay trong PR/doc/test:

```text
Pocket ID:
Owner / date:
Reason:

Market family:
Canonical markets:
Minute band:
Score state:
Evidence mode:
Allowed odds range:
Minimum confidence:
Minimum value_percent:
Risk-level rule:
Required live signals:
Forbidden contexts:
Stake cap:
Warning key:
Kill switch / env:

Before benchmark path:
After benchmark path:
Promotion evidence:
Rollback condition:
```

Yeu cau them:

- Pocket phai co warning key rieng, vi du `POLICY_MATCH_BALANCED_LIVE_VALUE_POCKET`.
- Pocket phai co stake cap rieng neu no noi odds thap hon rule cu.
- Pocket phai co test cho case duoc noi va case van bi block.
- Pocket khong duoc dua vao text selection tu do; phai dua tren canonical market.

## 6. Benchmark Bat Buoc

Truoc khi merge thay doi runtime policy/prompt:

1. Chay liveness/no-save neu dang audit production inactivity:

```powershell
npm run data-driven:pipeline-liveness --prefix packages/server -- --lookback-hours 336 --out-json <dir>/pipeline-liveness.json --out-md <dir>/pipeline-liveness.md
npm run data-driven:current-runtime-no-save --prefix packages/server -- --lookback-hours 336 --out-json <dir>/current-runtime-no-save.json --out-md <dir>/current-runtime-no-save.md
```

2. Neu co selection bi block, chay blocked-selection review:

```powershell
npm run data-driven:current-runtime-blocked-selection --prefix packages/server -- --lookback-hours 336 --out-json <dir>/current-runtime-blocked-selection.json --out-md <dir>/current-runtime-blocked-selection.md
```

3. Neu thay doi co replay cohort, chay mock replay:

```powershell
npm run data-driven:improvement-run --prefix packages/server
```

4. Neu chi thay doi policy pocket, them deterministic smoke/counterfactual report. Report phai noi ro:

- sample size;
- settled/unsettled rows;
- before allowed vs after allowed;
- P/L va ROI counterfactual neu co settlement;
- telemetry gap, neu thieu minute/value/confidence/edge;
- cac excluded reasons.

Real LLM benchmark chi duoc chay khi user/deployer cho phep ro rang:

```powershell
npm run data-driven:improvement-run-real --prefix packages/server
```

## 7. Unit Test Bat Buoc

Moi pocket hoac guard relaxation can test toi thieu:

- Case duoc allow dung pocket.
- Case gan giong nhung sai market/minute/score/evidence bi block.
- Case degraded evidence bi block neu pocket chi danh cho full-live.
- Stake cap duoc ap dung.
- Warning key pocket xuat hien.
- Prompt text khong day model quay lai no-bet toan bo vung odds duoc noi.

Focused test khuyen dung:

```powershell
npm run test --prefix packages/server -- src/__tests__/recommendation-policy.test.ts src/__tests__/live-analysis-prompt.test.ts src/__tests__/server-pipeline-gates.test.ts src/__tests__/server-pipeline.test.ts
npm run typecheck --prefix packages/server
npm run data-driven:verify-gates-ci --prefix packages/server
```

## 8. Rollout Va Kill Switch

Moi pocket moi nen co kill switch hoac config rieng:

```env
POLICY_<POCKET>_ENABLED=true
POLICY_<POCKET>_MIN_ODDS=
POLICY_<POCKET>_MAX_ODDS=
POLICY_<POCKET>_MIN_CONFIDENCE=
POLICY_<POCKET>_MIN_EDGE=
POLICY_<POCKET>_MAX_STAKE_PERCENT=
```

Rollout mac dinh:

1. Merge sau khi tests va mock/counterfactual report pass.
2. Deploy voi pocket enabled neu sample/risk duoc chap nhan.
3. Sau deploy, chay:

```powershell
npm run data-driven:pipeline-liveness --prefix packages/server -- --lookback-hours 48 --out-json <dir>/pipeline-liveness.json --out-md <dir>/pipeline-liveness.md
npm run data-driven:current-runtime-no-save --prefix packages/server -- --lookback-hours 48 --out-json <dir>/current-runtime-no-save.json --out-md <dir>/current-runtime-no-save.md
npm run data-driven:prompt-adoption --prefix packages/server -- --lookback-days 3 --out-json <dir>/prompt-adoption.json --out-md <dir>/prompt-adoption.md
```

4. Neu saved recommendation moi xuat hien, theo doi settlement truoc khi noi tiep.
5. Tat pocket neu:
   - `savedRecommendations` tang dot bien nhung hit-rate/ROI xau;
   - duplicate/same-thesis warnings tang;
   - provider/LLM call tang vuot budget;
   - market-resolution/save-integrity warnings tang.

## 9. Promotion Gate

Mot pocket tu shadow/counterfactual sang production can co toi thieu:

- Sample settled du so voi rui ro market. Mac dinh can `>=20` settled rows; pocket cuc hep co the chap nhan it hon nhung phai ghi ro ly do.
- ROI counterfactual khong am sau stake cap.
- Loss cluster khong tap trung vao mot match/league duy nhat.
- Khong mo market family moi ngoai evidence allowlist.
- Khong lam tang high-risk hoac same-thesis exposure.
- Co before/after report path trong PR/final handoff.

Neu sample chua du:

- Duoc merge telemetry/shadow/reporting.
- Khong duoc promote runtime save/notify mac dinh.

## 10. Handoff Checklist

Moi lan thay doi guard, final handoff phai gom:

- Files changed.
- Pocket ID va warning key.
- Hard guards da giu.
- Unit tests da chay.
- Benchmark before path.
- Benchmark after path.
- Ket qua chinh: before allowed, after allowed, P/L/ROI neu co.
- LLM/provider quota impact.
- Rollback/kill switch.

## 11. Current Near-Term Review Queue

Thu tu uu tien tiep theo:

1. `POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL`
   - Ly do: co tin hieu bi chan qua tay trong audit nho.
   - Huong dung: stake cap thap, chi full-live, edge toi thieu theo market.

2. `OVER_1_5_BLOCKED_LATE_MIDGAME`
   - Ly do: live betting thuc chien hay co edge trong one-goal state.
   - Huong dung: phut 60-84, one-goal margin, odds 1.65-2.00, full-live.

3. AH small-line
   - Ly do: line `+/-0.25` den `+/-0.75` la nhom live protection/actionable.
   - Huong dung: full-live, confidence/edge cao, stake cap 1-2%.

4. `odds_events_only_degraded`
   - Ly do: audit co nhieu row degraded; co the dang qua all-or-nothing.
   - Huong dung: shadow only truoc, chi O/U va AH, khong save mac dinh.

5. Goals Under thin cushion
   - Ly do: co ca missed winners va saved-loss patterns.
   - Huong dung: giu strict, chi rescue pocket rat hep neu settlement ung ho.
