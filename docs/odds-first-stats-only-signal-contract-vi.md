# Odds-first stats-only live signal contract

**Updated:** 2026-06-06

## Scope

Tai lieu nay dinh nghia cach TFI xu ly tran live khi API-Football khong co usable live odds, nhung van co stats/events du de dua ra tin hieu theo doi.

Muc tieu:

- He thong khong im lang chi vi thieu live odds.
- Khong save keo dau tu khi khong co live odds tradable.
- Khong goi LLM cho stats-only signal mac dinh.
- Khong lam ban ket qua ROI/settlement cua recommendation pipeline.

## Decision Split

TFI phai tach hai loai output:

1. **Actionable bet recommendation**
   - Bat buoc co canonical live odds tradable.
   - Duoc save vao `recommendations`.
   - Duoc co stake, odds, settlement, ROI.
   - Duoc goi LLM neu qua cac gate khac.

2. **Stats-only live signal**
   - Khong can live odds.
   - Chi duoc dua ra khi stats/events live match mot deterministic trigger manh.
   - Khong save vao `recommendations`.
   - Khong co stake, odds vao lenh, settlement, ROI.
   - Message phai noi ro can kiem tra live market/line truoc khi vao tien.
   - Mac dinh khong goi LLM.

## Provider Odds Contract

Khi match dang live:

- Neu `/odds/live` usable: pipeline co the chay actionable recommendation path.
- Neu `/odds/live` empty/unusable nhung `/odds` prematch usable:
  - Prematch odds chi la reference context.
  - Khong duoc dung prematch odds lam live price.
  - Khong duoc save recommendation co odds/stake.
  - Duoc emit stats-only signal neu deterministic trigger match.
- Neu ca live odds va prematch odds deu missing:
  - Van co the emit stats-only signal neu live stats/events rat manh.
  - Message phai canh bao market price unavailable.

## Deterministic Signal Triggers

Stats-only signal duoc phep emit neu it nhat mot trigger sau match:

- `zero_zero_pressure_after_55`: 0-0 tu phut 55 tro di va co ap luc sut/corner ro.
- `red_card_state`: co the do trong stats/events.
- `late_goal_after_75`: co ban thang tu phut 75 tro di.
- `pressure_no_lead`: mot doi ep ro nhung chua dan.
- `corner_pressure`: phat goc cao som/trung tran.

Evaluator phai tra ve:

- `triggered`
- `signalType`
- `strength`
- `summaryEn`
- `summaryVi`
- `reasons`
- `marketFamilyHint`
- `triggerKey`

## Delivery Contract

Stats-only signal delivery:

- Dung `user_match_alert_deliveries` va `user_match_alert_delivery_channels`.
- Tao rule he thong `source = stats_only_signal`, `alert_kind = condition_signal`, `compiled_status = draft` de khong bi `check-match-alerts` quet lai.
- Target user la active `user_watch_subscriptions` cua match co `notify_enabled = true`.
- Respect `user_match_alert_settings.condition_alerts_enabled`, default true khi user chua co settings row.
- Dedupe bang `triggerKey`.
- Trigger key phai gom match, signal type, score va minute bucket/event minute de tranh spam.

## Audit Contract

Moi lan pipeline xu ly match live ma khong co live odds can audit du cac action sau:

- `LIVE_ODDS_EMPTY_PREMATCH_AVAILABLE` khi live odds empty nhung prematch reference odds co market keys.
- `ACTIONABLE_BET_BLOCKED_NO_LIVE_ODDS` khi actionable path bi chan vi odds unavailable.
- `STATS_ONLY_SIGNAL_EMITTED` khi signal duoc enqueue.
- `STATS_ONLY_SIGNAL_SKIPPED_WEAK_TRIGGER` khi stats-only nhung trigger yeu.

## Token Contract

Stats-only signal path khong duoc goi:

- `callGemini`
- `match_alert.adjudicate`
- bat ky LLM operation nao khac

LLM chi duoc dung cho actionable recommendation path co live odds, hoac mot experiment rieng co quota/cooldown duoc contract hoa sau.

## Regression Tests

Unit tests phai khoa cac behavior:

- Live odds missing + prematch reference exists + strong stats trigger => enqueue stats-only signal, no LLM, no recommendation save.
- Live odds missing + weak stats trigger => no signal, no LLM, no recommendation save.
- Live odds usable => actionable AI path van hoat dong nhu cu.
- Stats-only signal delivery tao delivery rows qua draft system rule va khong tao candidate rule cho `check-match-alerts`.

