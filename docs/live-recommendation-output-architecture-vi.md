# Live Recommendation Output Architecture

**Status:** Draft contract before implementation  
**Updated:** 2026-06-09  
**Scope:** thiet ke lai lop output/decision cua live recommendation pipeline, truoc khi tach code.

## Muc Tieu

Pipeline hien tai qua de roi vao trang thai nhi phan: co recommendation duoc save, hoac im lang. Muc tieu cua tai lieu nay la tach ro cac loai output de he thong co the hanh dong phu hop voi tung nhom du lieu, nhung van giu ky luat money-critical.

Ket qua mong muon:

- Tran co odds va du bang chung tot thi van co the tao `money_recommendation`.
- Tran khong co live odds nhung co stats/events manh thi co the tao `stats_only_signal`, khong save keo.
- Tran co candidate bi policy chan thi duoc luu/audit nhu `shadow_candidate`, khong notify.
- Tran khong du dieu kien thi phai co `no_action` voi reason ro rang, khong im lang.
- Moi output deu replay/audit duoc bang contract on dinh.

Khong muc tieu:

- Khong mo production bet cho cac segment chua du settlement evidence.
- Khong dung prematch odds lam live tradable odds.
- Khong de LLM tu bia odds, line, stake, hoac thong so khong co trong input.
- Khong tao prompt version moi. Official live prompt hien tai van la `v10-hybrid-legacy-g`.

## Nguyen Tac

1. **No odds, no money recommendation.** Recommendation co stake/ROI/settlement bat buoc co canonical live odds tradable.
2. **No evidence, no assertion.** Output chi duoc noi nhung gi input co: odds, stats, events, score, minute, market availability.
3. **User-facing signal khac money bet.** Tin hieu theo doi co the huu ich nhung khong duoc tron vao bang `recommendations`.
4. **Moi processed match phai co audit outcome.** Khong duoc de mot match di qua pipeline ma khong biet no dung o dau.
5. **Shadow khong phai production.** Candidate blocked duoc dung de hoc va gate, khong save/notify.
6. **ROI chi do money recommendation.** Stats-only, watch insight, shadow, no-action khong duoc lam ban settlement/ROI.
7. **Single prompt baseline.** Moi prompt work phai bat dau tu official baseline, khong khoi phuc retired prompt hay env shadow prompt selection.

## Output Kinds

### `money_recommendation`

Day la output duy nhat duoc xem la keo dau tu.

Yeu cau:

- Evidence mode cho phep market.
- Co canonical live odds va line tradable.
- Selection text va `bet_market` normalize ve cung canonical market.
- LLM strict JSON parsed thanh cong.
- `final_should_bet=true` sau policy, memory, segment guard, save-integrity guard.
- Khong bi duplicate/thesis exposure cap chan.

Hanh vi:

- Save row vao `recommendations`.
- Co stake, odds, settlement, ROI.
- Co the stage delivery qua recommendation delivery channel.
- Duoc tinh vao replay/original comparison va performance memory.

### `stats_only_signal`

Tin hieu live khi khong co usable live odds nhung stats/events du manh de canh bao nguoi dung dang watch match.

Yeu cau:

- Khong co usable live odds cho actionable bet path.
- Co deterministic trigger manh tu stats/events.
- Message noi ro can kiem tra live market/price truoc khi vao tien.
- Dedupe bang trigger key on dinh.

Hanh vi:

- Khong goi LLM mac dinh.
- Khong save vao `recommendations`.
- Khong co stake, settlement, ROI.
- Delivery qua user match alert delivery path, target active watch subscribers.
- Audit tach ro emitted, no subscriber, deduped, weak trigger, delivery blocked.

### `watch_insight`

Thong tin huu ich cho UI/operator nhung chua du manh de push notification.

Vi du:

- Evidence degraded nhung co context dang chu y.
- Market co bien dong dang theo doi nhung chua co canonical mapping an toan.
- Team pressure tang nhung trigger chua dat nguong signal.

Hanh vi:

- Mac dinh khong notify.
- Khong save recommendation.
- Khong settlement/ROI.
- Co the hien trong UI feed/dashboard sau khi co product decision rieng.

### `shadow_candidate`

Candidate ma model/policy thay co kha nang nhung production guard chan.

Vi du:

- LLM chon market nhung policy block do thin edge.
- Market nam trong pocket `odds_events_only_degraded` dang can gate.
- Same-thesis cap hoac segment blocklist chan candidate.

Hanh vi:

- Luu audit/shadow telemetry neu co du payload.
- Khong notify.
- Khong save recommendation.
- Co the settle counterfactual de danh gia, nhung khong tinh la production ROI.

### `no_action`

Ket qua intentional pass.

Yeu cau:

- Phai co `noActionReason` ro.
- Phai co evidence mode va route da chon.
- Neu co candidate nhung bi chan, nen phan loai thanh `shadow_candidate` thay vi chi `no_action`.

Hanh vi:

- Khong save.
- Khong notify.
- Khong settlement/ROI.
- Audit phai du de operator tra loi cau hoi: "vi sao khong co recommendation?"

## Evidence Modes Va Routing

### `full_live_data`

Co stats/events/odds du dung.

Default route:

```text
full_live_data -> LLM money path -> policy/save/delivery | shadow_candidate | no_action
```

Cho phep:

- `money_recommendation`
- `shadow_candidate`
- `no_action`

Khong nen:

- Emit stats-only signal thay cho money path neu live odds usable va market tradable.

### `stats_only`

Co stats/events nhung khong co usable live odds.

Default route:

```text
stats_only -> deterministic signal evaluator -> stats_only_signal | no_action
```

Cho phep:

- `stats_only_signal`
- `watch_insight`
- `no_action`

Khong cho phep:

- `money_recommendation`
- Save row vao `recommendations`
- Dung prematch odds lam live price
- Goi LLM mac dinh

### `odds_events_only_degraded`

Co odds va events, thieu stats hoac evidence quan trong.

Default route:

```text
odds_events_only_degraded -> conservative classifier -> shadow_candidate | no_action
```

Cho phep hien tai:

- `shadow_candidate`
- `watch_insight`
- `no_action`

Chi mo `money_recommendation` khi:

- Co gate settlement rieng cho pocket.
- Canonical market resolution dat nguong.
- Loss cap va ROI/P&L dat nguong.
- Co rollout flag va rollback plan.

### `odds_only`

Co odds nhung thieu stats/events can thiet.

Default route:

```text
odds_only -> no_action, tru khi co policy pocket rat hep da duoc gate
```

Cho phep:

- `no_action`
- `shadow_candidate` neu can audit market/policy

Phase 1 implementation note:

- Runtime evidence type hien tai chua co literal `odds_only`; odds-only duoc classify vao `low_evidence` voi degraded reason `odds_only_without_stats_events`.
- Khong mo rong prompt evidence enum trong Phase 1 de tranh regression prompt/policy. Neu Phase 3 can shadow pocket rieng cho odds-only thi moi them enum, prompt copy, replay gates va allowlist rieng.

### `events_only_degraded`

Co events nhung khong co odds/stats du manh.

Default route:

```text
events_only_degraded -> watch_insight | no_action
```

Khong cho phep:

- `money_recommendation`

### `none`

Khong co evidence dang tin cay.

Default route:

```text
none -> no_action
```

## Proposed Pipeline Split

Kien truc muc tieu:

```text
provider/cache inputs
  -> evidence classifier
  -> opportunity classifier
  -> output router
      -> money recommendation path
      -> stats-only signal path
      -> watch insight path
      -> shadow telemetry path
      -> no-action audit path
  -> delivery/audit/reporting
```

## Matches UI Manual Ask AI Contract

Man hinh Matches co hai control lien quan AI:

- Quick analysis: nut sparkle "Run match analysis" / "View analysis result".
- Chat/custom question: nut chat, mo dialog neu chua co analysis, hoac jump vao follow-up chat neu da co cached result.

Day la manual/advisory surface, khong phai auto production recommendation surface. Vi vay output-router refactor khong duoc lam hong cac invariant sau:

- User khong nen thay nut AI active tren cac tran ma backend biet chac se skip truoc LLM.
- Chat/follow-up phai la advisory-only: khong save recommendation, khong notify, khong settlement/ROI.
- Neu backend khong du evidence de goi LLM, UI nen hien reason/preflight message thay vi goi LLM roi nhan ve cau tra loi vo nghia.
- Cached analysis co the mo lai va chat tiep neu match context con hop le.

### Current Runtime Observation

Tinh den thoi diem viet tai lieu nay, frontend Matches gating con mong:

- `AskAiMatchSplitControl` disable khi match chua nam trong Watchlist hoac dang analyzing.
- Neu co cached `aiResults`, nut primary chi scroll ve panel, khong goi lai API.
- Chat follow-up sau khi co result gui `advisoryOnly=true`.
- Lan quick analysis dau tien tu Matches goi `/api/live-monitor/matches/:matchId/analyze` voi `advisoryOnly=false`.
- Backend manual route `runManualAnalysisForMatch` mac dinh `forceAnalyze=true` va skip staleness/proceed gates.

He qua:

- Watchlist hien la dieu kien UI chinh, nhung no khong du de quyet dinh co nen goi LLM hay khong.
- Mot tran da watch nhung qua som, da ket thuc, thieu odds/stats/events, hoac low-evidence co the van hien nut AI active.
- Backend co mot so gate truoc LLM, vi du low-evidence non-structured prematch, nhung UI khong biet truoc nen van co the tao request ton API/provider va xu ly thua.

### Desired Eligibility Source

Can co mot backend eligibility/preflight contract lam source of truth cho UI, vi frontend khong co du du lieu de quyet dinh an toan:

```ts
type MatchAskAiEligibility = {
  eligible: boolean;
  mode:
    | 'live_money_advisory'
    | 'live_stats_advisory'
    | 'structured_prematch_advisory'
    | 'cached_only'
    | 'ineligible';
  reason:
    | 'eligible_full_live_data'
    | 'eligible_stats_only_explainable'
    | 'eligible_structured_prematch'
    | 'not_in_watchlist'
    | 'match_finished'
    | 'match_too_early'
    | 'match_not_live'
    | 'low_evidence'
    | 'missing_stats_and_odds'
    | 'missing_fixture_context'
    | 'no_active_watch_subscription'
    | 'ai_quota_or_entitlement_blocked'
    | 'cached_result_available';
  userMessage: string;
  canRunInitialAnalysis: boolean;
  canRunFollowUp: boolean;
  canSaveRecommendation: boolean;
  canNotify: boolean;
  expectedOutputKind:
    | 'money_recommendation'
    | 'stats_only_signal'
    | 'watch_insight'
    | 'no_action';
};
```

Bat bien:

- `canSaveRecommendation=false` cho manual UI advisory mac dinh, tru khi product intentionally tao mot action rieng "promote to recommendation" voi guard rieng.
- `canNotify=false` cho manual UI advisory mac dinh.
- UI chi nen enable quick analysis/chat khi `eligible=true` hoac co cached result de xem lai.
- Backend route phai enforce eligibility lai, khong tin frontend.

### Recommended Eligibility Rules

Nen enable initial Ask AI khi mot trong cac nhom sau dung:

1. **Live full-data advisory**
   - Match nam trong Watchlist.
   - Status live/in-play.
   - Minute nam trong analysis window.
   - Co stats/events va canonical tradable live odds.
   - Expected output: advisory analysis, optionally displays money-like thesis, but UI manual surface should not auto-save/notify.

2. **Live stats-only advisory**
   - Match nam trong Watchlist.
   - Status live/in-play.
   - Khong co usable live odds.
   - Co deterministic stats/events trigger manh.
   - Expected output: explainable `stats_only_signal`/`watch_insight`, no stake, no recommendation save.

3. **Structured prematch advisory**
   - Status `NS`.
   - Manual force request.
   - Top league.
   - Prematch expert features availability `full` hoac `partial`.
   - Profile/strategic coverage dat nguong.
   - Expected output: cautious prematch thesis, no live pressure claims, no live recommendation save.

4. **Cached result**
   - Cached analysis co san trong Matches UI/session storage.
   - Cho phep view/jump/follow-up neu backend match context con ton tai.

Nen disable initial Ask AI va hien reason khi:

- Chua add Watchlist.
- Match finished/cancelled/abandoned.
- Match qua som cho live analysis va khong du structured prematch context.
- Low evidence: khong stats, khong odds, khong events, khong structured prematch.
- Odds only hoac events only ma chua co shadow/advisory experiment contract.
- Provider quota/entitlement/AI gateway dang block.
- Match context khong con ton tai trong backend.

### Interaction With Output Router Refactor

Output-router refactor khong nen xoa chat flow. Thay vao do:

- Manual UI Ask AI nen di qua mot route/preflight rieng hoac mot `advisoryOnly=true` path ro rang.
- `money_recommendation` production save path khong nen duoc kich hoat boi chat/follow-up.
- `stats_only_signal` co the duoc hien trong panel nhu advisory insight, nhung khong save/settle.
- `shadow_candidate` co the hien cho operator/internal neu can, nhung khong nen hien nhu keo production cho user thuong.
- `no_action` phai co copy ro: "AI not run because evidence is too thin" khac voi "AI ran and chose no bet".

Recommended implementation order:

1. Them backend eligibility/preflight function dung chung voi output router.
2. Expose eligibility trong `/api/matches` hoac endpoint nhe `/api/live-monitor/matches/:matchId/ask-ai-eligibility`.
3. UI dung eligibility de enable/disable controls va tooltip.
4. Analyze route enforce eligibility lai truoc khi goi LLM.
5. Doi initial Matches quick analysis sang advisory/manual-safe semantics neu product khong muon manual save/notify.

## Message Template Contract

Output router dung nhung message delivery moi la noi user that su cam nhan he thong. Vi vay moi output kind phai co heading, CTA, va wording rieng, khong duoc dung chung mot template roi chi thay doi vai field.

### Current Delivery Surface Audit

Tinh den thoi diem viet tai lieu nay:

- Production recommendation web push trong `server-pipeline.ts` dung title `RECOMMENDATION`, body gom selection/odds/confidence, action `Invest`.
- Telegram recommendation delivery dung `buildTelegramRecommendationMessage` voi kind `recommendation | condition | analysis`.
- Stats-only live signal di qua `user_match_alert_deliveries`, web push title hien tai la `LIVE SIGNAL`, metadata co `noActionableOdds=true`, va khong co action `Invest`.
- Match alert Telegram message dung heading `LIVE SIGNAL` cho `condition_signal`.
- Analysis-signal/no-action telemetry duoc stage vao `user_recommendation_deliveries` voi `delivery_kind=watch_signal/no_action`, `delivery_status='suppressed'`; day la audit/internal feed, khong phai user push mac dinh.

Rui ro:

- `MATCH ANALYSIS`, `LIVE SIGNAL`, `CONDITION TRIGGERED`, va `RECOMMENDATION` co the bi user hieu nhu nhau neu template khong noi ro "co/khong co keo dau tu".
- Web push ngan, nen heading/first line phai chua classification ro.
- Neu sau nay cho push stats-only signal, phai push qua match-alert signal template, khong dung recommendation template.

### Output Message Types

#### `OFFICIAL_BET_RECOMMENDATION`

Dung cho `money_recommendation` da save thanh cong hoac dang stage delivery cho saved recommendation.

Required heading:

```text
OFFICIAL BET RECOMMENDATION
KÈO CHÍNH THỨC
```

Required fields:

- Match display
- League
- Minute / score / status
- Selection
- Canonical market
- Live odds
- Confidence
- Stake percent and amount if bankroll metadata exists
- Risk level
- Value percent if available
- Reasoning
- Warnings max 3

Allowed CTA:

- `Invest`
- `Open recommendation`
- `Open match`

Forbidden:

- Missing odds
- Missing stake
- Heading `LIVE SIGNAL`
- Message without settlement/ROI eligibility context

Web push shape:

```text
Title: OFFICIAL BET RECOMMENDATION
Body:
<Home> vs <Away>
<Selection> @ <odds> | Conf <n>/10 | Stake <x>%
Open match: <url>
Action: Invest
```

Telegram shape:

```text
<b>OFFICIAL BET RECOMMENDATION / KÈO CHÍNH THỨC</b>
<b>Home vs Away</b>
League
Minute 65' | Score 1-1 | LIVE

<b>Over 2.5 @ 1.92</b>
Confidence: 8/10 | Stake: 3% | Risk: MEDIUM | Value: 6%
Bet amount: ...

Reasoning...
Warnings: ...
```

#### `LIVE_STATS_SIGNAL`

Dung cho `stats_only_signal`: co live stats/events manh nhung khong co usable live odds.

Required heading:

```text
LIVE STATS SIGNAL - NOT A BET
TÍN HIỆU LIVE - KHÔNG PHẢI KÈO
```

Required fields:

- Match display
- League
- Minute / score / status
- Signal type
- Trigger summary
- Evidence facts
- Explicit no-odds/no-stake disclaimer
- Suggested action: review live market, ask AI, avoid chasing, or open match

Allowed CTA:

- `Open match`
- `Review live market`
- `Ask AI` if eligibility allows

Forbidden:

- `Invest`
- Stake percent
- Odds as tradable price
- Settlement/ROI language
- Selection formatted like official bet

Web push shape:

```text
Title: LIVE STATS SIGNAL - NOT A BET
Body:
<Home> vs <Away>
No live odds available. <summary>
Action: Open match / Review live market
```

Telegram shape:

```text
<b>LIVE STATS SIGNAL - NOT A BET / TÍN HIỆU LIVE - KHÔNG PHẢI KÈO</b>
<b>Home vs Away</b>
League
Minute 58' | Score 0-0 | 2H

Signal: zero_zero_pressure_after_55
No usable live odds were available, so this is not a bet recommendation.
Facts: shots/corners/pressure...
Suggested action: review live market before any stake.
```

#### `WATCH_SIGNAL`

Dung cho candidate dang theo doi, runtime policy shadow pocket, hoac watch insight co y nghia nhung chua du dieu kien push bet.

Required heading:

```text
WATCH SIGNAL - NO BET STAGED
THEO DÕI - CHƯA CÓ KÈO
```

Required fields:

- Match display
- Minute / score / status
- Why watch
- Block reason: policy, market unresolved, degraded evidence, thin edge, same thesis, segment policy
- Explicit no-save/no-stake line

Allowed CTA:

- `Open match`
- `Review later`

Forbidden:

- `Invest`
- Stake amount
- "Recommendation" heading

#### `NO_ACTION_ANALYSIS`

Dung khi AI hoac deterministic route da review nhung ket luan khong co action.

Required heading:

```text
NO ACTION
KHÔNG HÀNH ĐỘNG
```

Required fields:

- Match display
- Reason group: model no-bet, weak trigger, low evidence, market unresolved, policy blocked
- Whether LLM was called
- Next condition if relevant: wait for odds, wait for minute, wait for stats, no subscriber

Forbidden:

- User push mac dinh, tru khi day la internal/operator feed.
- Any bet-like formatting.

#### `MANUAL_ADVISORY`

Dung cho Matches UI Ask AI/chat.

Required heading:

```text
MANUAL MATCH ANALYSIS - ADVISORY ONLY
PHÂN TÍCH THỦ CÔNG - CHỈ THAM KHẢO
```

Required fields:

- Match display
- Data mode: full live, stats-only, structured prematch, low evidence
- Whether live odds are available
- Clear warning if output is not production recommendation

Forbidden by default:

- Save recommendation
- Notify other users
- Settlement/ROI eligibility
- `Invest` CTA

### Template Invariants

- Only `OFFICIAL_BET_RECOMMENDATION` may use `Invest`.
- Only `OFFICIAL_BET_RECOMMENDATION` may include stake amount as an instruction.
- Only `OFFICIAL_BET_RECOMMENDATION` may enter settlement/ROI.
- Any message without usable live odds must contain "not a bet" / "không phải kèo".
- Any stats-only signal must contain "no live odds available" / "không có odds live usable".
- Any manual Ask AI output must contain "advisory only" / "chỉ tham khảo".
- Any shadow/watch output must contain "no bet staged" / "chưa có kèo".
- Notification click target for signals should open Matches/match detail, not Recommendations/Invest flow.
- Message metadata should carry `outputKind`, `messageKind`, `deliveryKind`, `oddsAvailability`, `settlementEligible`, and `roiEligible`.

### Suggested Message Metadata

```ts
type LiveMessageMetadata = {
  outputKind: 'money_recommendation' | 'stats_only_signal' | 'watch_insight' | 'shadow_candidate' | 'no_action';
  messageKind:
    | 'OFFICIAL_BET_RECOMMENDATION'
    | 'LIVE_STATS_SIGNAL'
    | 'WATCH_SIGNAL'
    | 'NO_ACTION_ANALYSIS'
    | 'MANUAL_ADVISORY';
  deliveryKind: 'recommendation' | 'match_alert' | 'analysis_signal' | 'manual_advisory';
  oddsAvailability: 'canonical_live' | 'reference_prematch_only' | 'missing' | 'unknown';
  userVisible: boolean;
  savedRecommendation: boolean;
  settlementEligible: boolean;
  roiEligible: boolean;
  cta: 'invest' | 'open_match' | 'review_live_market' | 'ask_ai' | 'none';
};
```

## Subscription, Settlement, Dashboard, Live Monitor Impact Contract

Output-router refactor khong chi la chuyen code pipeline. No cham truc tiep vao cac surface dang co y nghia business: subscription quota, notification entitlement, settlement/ROI, Dashboard/Reports, Recommendations feed, va Live Monitor.

### Subscription Va Manual Ask AI

Current runtime observation:

- `/api/proxy/ai/analyze` da enforce `requireCurrentUser`, `ai.manual.ask.enabled`, va `ai.manual.ask.daily_limit` cho non-admin/non-owner.
- `/api/live-monitor/matches/:matchId/analyze` hien goi `runManualAnalysisForMatch` nhung chua consume manual AI quota va chua co entitlement/preflight contract rieng.
- Global JWT guard co the chan request trong production, nhung route van khong biet user nao dang tieu quota, khong tra duoc reason `ai_quota_or_entitlement_blocked`, va khong phan biet admin bypass voi member quota.

Bat bien can them truoc khi coi Matches Ask AI la flow chinh thuc:

- Moi initial manual analysis tu Matches phai resolve current user.
- Non-admin/non-owner phai consume `ai.manual.ask.daily_limit` truoc khi goi LLM/provider-heavy path.
- Entitlement/quota block phai xay ra truoc LLM va truoc provider fetch khong can thiet.
- Follow-up chat phai tiep tuc advisory-only; neu tinh quota thi dung cung quota key hoac mot quota key rieng duoc document.
- Eligibility/preflight response phai surface `ai_quota_or_entitlement_blocked`.
- Admin/owner bypass neu giu lai phai explicit trong code va tests.

Notification subscription/entitlement:

- Recommendation deliveries target `user_watch_subscriptions` va phai ton trong `notify_enabled=true` semantics.
- Stats-only signal qua match-alert delivery phai respect `condition_alerts_enabled=true`.
- Notification channel entitlement (`notifications.channels.allowed_types`, `notifications.channels.max_active`) duoc enforce luc config/link channel; delivery send van phai respect channel enabled/status.
- Signal delivery khong duoc silently downgrade thanh recommendation delivery de ne channel rules.

### Settlement Va ROI

Current runtime observation:

- Auto settlement chi load pending rows tu `recommendations`, roi settle recommendation va `ai_performance` theo `recommendation_id`.
- `ai_performance` create/settle deu yeu cau `recommendation_id`.
- Analysis signal rows hien stage vao `user_recommendation_deliveries` voi `recommendation_id=NULL`, `delivery_status='suppressed'`, metadata `delivery_kind=watch_signal/no_action`.

Bat bien:

- `settlementEligible=true` chi khi co saved recommendation row va `recommendation_id` hop le.
- `roiEligible=true` chi khi `settlementEligible=true`.
- `stats_only_signal`, `watch_insight`, `shadow_candidate`, `no_action`, `manual_advisory` khong tao `recommendations`, khong tao `ai_performance`, khong vao auto-settle.
- Counterfactual shadow settlement neu co phai nam trong report/audit rieng, khong ghi vao production P/L.

Known impact risk:

- `user_recommendation_deliveries` summary/chart hien co the tinh delivery row `recommendation_id=NULL` thanh `pending` neu metadata khong co final result.
- Trong Recommendations tab feed mode `My signals`, mapped delivery khong co recommendation id co `result = delivery_status`; signal/no-action co the bi hien nhu unsettled/pending hoac co P/L = 0.
- Do do delivery summary/chart phai tach `bet` va `signal`: `pending/unsettled`, `P/L`, `Won/Lost`, `Needs Review`, `Invest`, va manual settle chi ap dung cho row co `recommendation_id`.

### Dashboard Va Reports

Current runtime observation:

- Dashboard summary lay truc tiep tu `recommendations` va filter `ACTIONABLE_NOT_DUP`.
- Reports repo cung query `recommendations`, filter `bet_type IS DISTINCT FROM 'NO_BET'`, va chi tinh P/L tren final results.
- AI stats lay tu `ai_performance` join `recommendations`.

Bat bien:

- Dashboard KPI (`Settled Recommendations`, hit rate, P/L, ROI, recent recommendations) chi do money recommendations.
- Reports performance/market/league/time/cohort chi do saved actionable recommendations.
- Signal/no-action chi duoc hien trong dashboard/operator area rieng: volume, reason buckets, delivery counts, no-save diagnostics.
- Neu them "Why no recommendation" dashboard, label phai ro rang la diagnostics/signal volume, khong phai ROI.

### Live Monitor

Current runtime observation:

- Live Monitor summary hien tinh `savedRecommendations = results.filter(saved)` va `pushedNotifications = results.filter(notified)`.
- Result card hien `Bet`, `Watch`, `No Action` bang inference tu `saved`, decision kind, runtime policy shadow, va parsed condition fields.
- Neu stats-only signal hoac watch signal sau nay set `notified=true` nhung `saved=false`, summary label `Notifications` se tron bet notification voi signal notification.

Bat bien:

- Pipeline result nen expose `outputKind`, `messageKind`, `savedRecommendation`, `settlementEligible`, `roiEligible`, va delivery subtype thay vi UI infer tu `shouldPush/notified`.
- Live Monitor summary phai tach:
  - saved money recommendations
  - official bet notifications
  - stats/watch signal notifications
  - no-action audits
  - errors
- Badge `Push` chi nen co meaning ro: official bet push hay signal push. Khong dung chung cho `should_push` model raw.
- Candidate scope/pre-check ly do (`candidateReason`) khong duoc xem la final no-action reason; final output reason phai lay tu output router/audit bucket.

### Evidence Classifier

Tra loi cau hoi: "Du lieu hien co thuoc nhom nao?"

Output de xuat:

- `evidenceMode`
- `hasLiveOdds`
- `hasTradableCanonicalOdds`
- `hasPrematchReferenceOdds`
- `hasStats`
- `hasEvents`
- `snapshotFreshness`
- `missingInputs`
- `contaminationWarnings`

### Opportunity Classifier

Tra loi cau hoi: "Co gi dang chu y khong?"

Output de xuat:

- `opportunityType`
- `candidatePresent`
- `deterministicTriggers`
- `marketFamilyHint`
- `pressureScore`
- `riskFlags`
- `reasonCodes`

Layer nay khong quyet dinh save. No chi phan loai co hoi.

### Output Router

Tra loi cau hoi: "Nen phat ra output kind nao?"

Input:

- Evidence classifier result
- Opportunity classifier result
- LLM candidate neu co
- Policy result
- Subscription/delivery context

Output:

- `outputKind`
- `route`
- `finalOutcome`
- `noActionReason`
- `deliveryKind`
- `auditBucket`

### Money Recommendation Path

Chi duoc vao khi:

- Evidence mode cho phep market.
- Co canonical live odds tradable.
- LLM call duoc phep.

Path nay giu cac guard hien co:

- strict JSON parse
- market normalization
- line patience
- recommendation policy
- memory/thesis exposure
- segment block/stake cap
- save-integrity validation
- delivery staging

### Stats-only Signal Path

Chi duoc vao khi:

- Live odds unavailable/unusable.
- Stats/events co deterministic trigger manh.

Path nay can tach khoi recommendation save:

- evaluator deterministic
- target active watch subscribers
- alert settings gate
- dedupe trigger key
- delivery staging qua match alert delivery
- audit emitted/no subscriber/deduped/weak trigger

### Shadow Telemetry Path

Dung cho candidate bi chan:

- policy blocked
- thin edge
- market unresolved
- evidence mode degraded
- segment policy block
- save-integrity block

Telemetry phai du de replay/settle counterfactual, nhung khong duoc tao production recommendation.

### No-action Audit Path

Moi route deu phai ket thuc bang audit neu khong co user-visible output.

Yeu cau toi thieu:

- evidence mode
- route
- output kind
- reason code
- candidate present hay khong
- market family neu co
- subscription/delivery status neu relevant

## Audit Bucket Taxonomy

Audit bucket nen on dinh de dashboard va batch report dung chung.

Provider va selection:

- `provider_quota_or_circuit_open`
- `provider_fetch_failed`
- `no_live_match`
- `no_active_watch_subscription`
- `watch_subscription_notify_disabled`
- `stale_snapshot`

Evidence:

- `low_evidence`
- `stats_only_weak_trigger`
- `stats_only_signal_emitted`
- `stats_only_signal_no_subscriber`
- `stats_only_signal_deduped`
- `stats_only_signal_delivery_blocked`
- `degraded_evidence_odds_events_only`
- `degraded_evidence_events_only`
- `no_tradable_canonical_market`
- `prematch_odds_reference_only`

LLM/model:

- `llm_skipped_by_route`
- `llm_cooldown`
- `llm_parse_error`
- `model_no_bet`
- `model_candidate_present`

Market/policy/save:

- `market_unresolved`
- `market_not_allowed_for_evidence_mode`
- `line_patience_blocked`
- `policy_blocked`
- `thin_edge_blocked`
- `same_thesis_blocked`
- `segment_policy_blocked`
- `save_integrity_blocked`
- `recommendation_saved`

Delivery:

- `delivery_staged`
- `delivery_no_target`
- `delivery_failed`

## Decision Context Shape

Chua phai migration contract cuoi, nhung moi implementation nen gom cac field logic sau trong audit/debug payload:

```ts
type LiveOutputDecisionContext = {
  contractVersion: 'live-output-v1';
  outputKind:
    | 'money_recommendation'
    | 'stats_only_signal'
    | 'watch_insight'
    | 'shadow_candidate'
    | 'no_action';
  finalOutcome:
    | 'saved'
    | 'notified'
    | 'shadow_recorded'
    | 'audited_no_action'
    | 'blocked';
  evidenceMode: string;
  route:
    | 'money_path'
    | 'stats_only_path'
    | 'watch_insight_path'
    | 'shadow_path'
    | 'no_action_path';
  auditBucket: string;
  noActionReason?: string;
  candidatePresent: boolean;
  shadowCandidate: boolean;
  statsOnlySignal: boolean;
  userVisible: boolean;
  savedRecommendation: boolean;
  settlementEligible: boolean;
  roiEligible: boolean;
  deliveryKind?: 'recommendation' | 'match_alert' | 'none';
  deliveryStatus?: 'staged' | 'delivered' | 'skipped' | 'failed' | 'none';
};
```

Bat bien quan trong:

- `savedRecommendation=true` chi hop le khi `outputKind='money_recommendation'`.
- `settlementEligible=true` chi hop le khi `savedRecommendation=true`.
- `roiEligible=true` chi hop le khi `settlementEligible=true`.
- `statsOnlySignal=true` khong duoc di kem `savedRecommendation=true`.
- `shadowCandidate=true` khong duoc di kem `userVisible=true` mac dinh.

## Phase Plan

### Phase 0 - RFC Va Contract

Deliverables:

- Tai lieu output architecture nay.
- Regression matrix rieng.
- Link tu source-of-truth pipeline doc.

Exit criteria:

- Cac output kinds va no-save reasons duoc dong thuan.
- Khong con mo ho giua signal, shadow, va money recommendation.

### Phase 1 - Output Router Va Audit Buckets

Deliverables:

- Tach evidence classifier va output router.
- Chuan hoa audit bucket cho moi processed match.
- Mo rong stats-only signal audit de thay du emitted/skipped/no-subscriber/deduped.
- Unit/integration tests cho cac invariant money-critical.

Exit criteria:

- Mot match processed khong con roi vao "silent unknown".
- Full-data money path khong regression.
- Stats-only path khong LLM, khong save recommendation.

### Phase 2 - Operator Dashboard: Why No Recommendation

Deliverables:

- Report/API/UI nhom reason theo provider/evidence/model/policy/save/delivery.
- Drilldown theo match, minute, evidence mode, audit bucket.
- Copy hien thi ro: "khong co odds", "model no-bet", "policy blocked", "weak stats trigger".

Phase 2 implementation note:

- Backend report/API da duoc them o `GET /api/live-monitor/why-no-recommendation`.
- Report doc `PIPELINE_MATCH_ANALYZED` cua official prompt `v10-hybrid-legacy-g`, uu tien `outputKind/auditBucket/outputDecision` tu Phase 1.
- Reason grouping hien tai gom `provider`, `evidence`, `model`, `policy`, `save`, `delivery`, `success`, `unknown`.
- Drilldown toi thieu da co `matchId`, `matchDisplay`, `minute`, `score`, `status`, `evidenceMode`, `route`, `auditBucket`, `outputKind`, `llmCalled`, `settlementEligible`, `roiEligible`.
- Live Monitor UI co panel "Why No Recommendation" 24h operator view de xem totals, group buckets, top audit buckets, va sample drilldown.
- Report nay la diagnostics/operator surface, khong phai ROI/report dau tu. `money_recommendation` van la output duy nhat vao settlement/ROI.
- Khong them schema `live_output_decisions` trong Phase 2; van doc audit logs de giam regression. Neu retention/audit volume tro thanh van de thi Phase sau moi can bang rieng.

Exit criteria:

- Operator co the tra loi trong vai phut vi sao 24h/7d khong co recommendation.
- Khong can doc raw audit log cho cau hoi thuong gap.

### Phase 3 - Shadow Gates Cho Pocket Moi

Deliverables:

- Shadow suite cho `odds_events_only_degraded` va `medium-risk thin-edge` pocket.
- Settlement gate config rieng.
- Segment hotspot report rieng.
- Hard no-promote rules.

Phase 3 implementation note:

- Runtime shadow telemetry da them hai pocket audit-only:
  - `medium_risk_thin_edge_shadow_v1`
  - `odds_events_degraded_shadow_v1`
- Hai pocket nay chi match khi selection da bi production policy block. Chung khong thay doi `final_should_bet`, khong save recommendation, khong notify user.
- `data-driven:policy-shadow-suite` nay sinh them:
  - `runtime-policy-shadow-readiness-gates.json`
  - `runtime-policy-shadow-readiness-gates.md`
- Readiness gate tong hop matched/skipped telemetry va settlement artifacts de tra loi `ready_for_human_review` hay `observe_only`.
- Hard no-promote checks gom sample size, unique match count, settled coverage, unresolved rows, losses, P/L, ROI, top-match concentration, top-league concentration, top-team concentration, top-market concentration, market-resolution unresolved rate, va evidence-mode contamination.
- Gate config mau: `packages/server/runtime-policy-shadow-readiness-gates.example.json`.
- Command rieng: `npm run data-driven:check-policy-shadow-readiness-gates --prefix packages/server -- --config <config>`.

Phase 3.5 implementation note:

- Runtime shadow candidate/skipped audit metadata va shadow settlement rows da co normalized segment telemetry:
  - `leagueId`, `leagueName`, `leagueSegmentKey`
  - `homeTeamId`, `homeTeamName`, `homeTeamSegmentKey`
  - `awayTeamId`, `awayTeamName`, `awayTeamSegmentKey`
  - `teamSegmentKeys`, `matchSegmentKey`
- Segment key uu tien provider id (`league:39`, `team:1`); neu thieu id thi fallback slug tu ten; neu thieu ca hai thi `league:unknown`/`team:unknown`.
- Runtime shadow matched/skipped reports va settlement reports da co `By League Segment` va `By Team Segment`.
- Readiness gates da support `maxTopLeagueShare` va `maxTopTeamShare`, nen "segment hotspot" truoc Phase 4 khong con chi la proxy theo match/market/pocket.
- Day van la telemetry/gate only; khong save recommendation, khong notify, khong thay doi production policy.

Exit criteria:

- Co du sample settled.
- ROI/P&L/loss cap pass.
- Canonical market resolution dat nguong.
- Khong co save-integrity gap.

### Phase 4 - Controlled Production Pocket

Deliverables:

- Feature flag cho pocket hep: `RUNTIME_POLICY_PROMOTION_ENABLED`.
- Pocket allowlist: `RUNTIME_POLICY_PROMOTION_POCKET_IDS`.
- Rollout percentage: `RUNTIME_POLICY_PROMOTION_ROLLOUT_PERCENT` voi deterministic match/pocket sampling.
- Rollback switch: `RUNTIME_POLICY_PROMOTION_KILL_SWITCH`.
- Human/gate acknowledgement: `RUNTIME_POLICY_PROMOTION_EVIDENCE_ACK=ready_for_human_review`.
- Owner marker: `RUNTIME_POLICY_PROMOTION_OWNER`.
- Stake cap: `RUNTIME_POLICY_PROMOTION_MAX_STAKE_PERCENT`.
- Audit event: `PIPELINE_POLICY_PROMOTION_EVALUATED`.
- Save row `decision_context.recommendationSource=runtime_policy_promotion`.

Phase 4 implementation note:

- Controlled promotion guard da duoc them trong `packages/server/src/lib/runtime-policy-production-promotion.ts`.
- Default la OFF: enabled false, rollout 0%, no pocket allowlist, no evidence ack.
- Khi promoted, `should_push/final_should_bet` duoc set thanh official money recommendation, nhung `decision_context.policyBlocked=true` va `runtimePolicyPromotion` van ghi ro day la controlled override.
- Save-integrity van bat buoc pass; neu canonical market/odds khong proven thi `RECOMMENDATION_SAVE_BLOCKED_PROVIDER_COVERAGE` van chan save.
- Guard khong goi LLM them, khong sua prompt, khong bypass evidence mode/min odds/same-thesis/segment policy; no chi duoc chay tren matched runtime shadow pocket da bi production policy block.

Exit criteria:

- Production pocket dat quality gate lien tiep.
- Neu fail gate thi rollback ngay ve shadow-only.

## Implementation Guardrails

- Khong thay doi schema production neu chua co migration va rollback.
- Khong save recommendation khi khong co canonical live odds.
- Khong reintroduce retired prompt versions hoac env active/shadow prompt selector.
- Khong dua stats-only/shadow vao ROI production.
- Neu doi semantics cua `should_push` hoac `final_should_bet`, phai map ro trong doc va tests.
- Advisory/manual Ask AI flow van la answer-only, khong save/notify.
- Moi market text shape moi phai co test normalize-market.
- Moi route moi phai co test "LLM called or not called" va "save called or not called".

## Open Decisions

- `watch_insight` nen chi hien UI feed hay co low-priority notification rieng?
- Stats-only signal can nguong strength nao cho tung league/minute bucket?
- Dedupe window nen theo minute bucket, event minute, hay score-state?
- No-action audit retention bao lau de du debug nhung khong phinh DB?
- Co can mot bang rieng cho `live_output_decisions`, hay tiep tuc dua vao audit logs/debug payload?
- Shadow candidate co can delivery cho operator/internal only hay chi batch report?
