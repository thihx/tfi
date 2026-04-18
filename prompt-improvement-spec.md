# Prompt Improvement Spec — AI Betting Agent (400-case Analysis)

> **Mục đích tài liệu**: Hướng dẫn AI Coding Agent cập nhật logic prompt/rule của betting recommendation agent dựa trên phân tích 400 trận thực tế. Tỷ lệ thua hiện tại: **45.2%** (181/400).

---

## Tổng quan các thay đổi

| # | Pattern | Tỷ lệ thua hiện tại | Hành động |
|---|---------|-------------------|-----------|
| 1 | BTTS No + game đang có bàn | 75–100% | Chặn unconditionally |
| 2 | Market nhạy cảm trong phút 45–74 | 60–67% | Blacklist theo timing |
| 3 | Combo cách biệt + giữa trận | 55–65% | Áp penalty + điều kiện ketat |
| 4 | shouldPush=true quá dễ trigger | 48% thua dù đã flag | Nâng ngưỡng confidence |
| 5 | canonicalMarket = unknown | Không resolve được | Block toàn bộ |
| 6 | Phút 75+ bị undervalue | Chỉ 31.2% thua | Hạ threshold để push nhiều hơn |

---

## Chi tiết từng thay đổi

---

### 1. BTTS No — Logic đặc biệt

**Bối cảnh**: `btts_no` là market được chọn nhiều nhất (30 cases) với tỷ lệ thua **60%** tổng thể. Phân tích chi tiết cho thấy tỷ lệ thua phân hóa rõ theo `scoreState`:

| scoreState | minuteBand | Tổng | Thua | Tỷ lệ |
|------------|------------|------|------|--------|
| two-plus-margin | 00–29 | 2 | 2 | **100%** |
| one-goal-margin | 30–44 | 3 | 3 | **100%** |
| one-goal-margin | 00–29 | 6 | 3 | 50% |
| two-plus-margin | 45–59 | 6 | 4 | 67% |
| two-plus-margin | 30–44 | 8 | 3 | 38% |
| two-plus-margin | 60–74 | 1 | 0 | 0% |

**Lý do thua**: Khi game đã có bàn thắng, đội thua đang có động lực phản công mạnh — xác suất BTTS thực tế cao hơn nhiều so với odds phản ánh.

**Rule mới cần implement**:

```
IF canonicalMarket == "btts_no":

  # Block hoàn toàn khi có cách biệt
  IF scoreState IN ["one-goal-margin", "two-plus-margin"]:
    shouldPush = false
    reason = "BTTS_NO_BLOCKED_GOAL_MARGIN"

  # Block khi 0-0 giữa trận
  ELIF scoreState == "0-0" AND minuteBand IN ["45-59", "60-74"]:
    shouldPush = false
    reason = "BTTS_NO_BLOCKED_MIDGAME_GOALLESS"

  # Chỉ cho phép khi: two-plus-margin + cuối trận (logic hợp lý nhất)
  # hoặc: 0-0 + đầu trận với evidence đầy đủ
  ELIF scoreState == "two-plus-margin" AND minuteBand == "75+":
    # Cho phép, tiếp tục đánh giá bình thường
    pass

  ELIF scoreState == "0-0" AND minuteBand IN ["00-29", "30-44"] AND evidenceMode == "full_live_data":
    # Cho phép với điều kiện evidence đầy đủ
    pass

  ELSE:
    shouldPush = false
    reason = "BTTS_NO_INSUFFICIENT_CONDITIONS"
```

---

### 2. Blacklist market theo timing (phút 45–74)

**Bối cảnh**: Các market sau có tỷ lệ thua **60–67%** khi được recommend trong window phút 45–74. Đây là giai đoạn trận đấu thường có nhiều biến động nhất.

| Market | Tỷ lệ thua tổng | Ghi chú |
|--------|----------------|---------|
| `over_2.5` | 67% | Sample nhỏ nhưng nhất quán |
| `ht_over_1.5` | 67% | Chủ yếu fail ở 45–59' |
| `under_2.25` | 67% | Đặc biệt tệ ở 45–59' (3/3) |
| `ht_1x2_draw` | 67% | Tệ ở đầu trận lẫn giữa trận |
| `corners_under_7.5` | 60% | Tệ nhất ở 60–74' |
| `corners_under_9.5` | 60% | |
| `over_1.5` | 54% | Đặc biệt tệ ở 60–74' (6/9) |

**Rule mới cần implement**:

```
BLACKLISTED_MARKETS_MIDGAME = [
  "over_2.5",
  "ht_over_1.5",
  "under_2.25",
  "ht_1x2_draw",
  "corners_under_7.5",
  "corners_under_9.5",
]

IF canonicalMarket IN BLACKLISTED_MARKETS_MIDGAME AND minuteBand IN ["45-59", "60-74"]:
  shouldPush = false
  reason = "MARKET_BLACKLISTED_FOR_MIDGAME_WINDOW"

# Rule riêng cho over_1.5 — tệ hơn ở 60-74 cụ thể
IF canonicalMarket == "over_1.5" AND minuteBand == "60-74":
  shouldPush = false
  reason = "OVER_1_5_BLOCKED_LATE_MIDGAME"
```

---

### 3. Penalty cho combo "cách biệt + giữa trận"

**Bối cảnh**: Đây là nhóm pattern nguy hiểm nhất về volume — nhiều cases và tỷ lệ thua cao.

| minuteBand | scoreState | Tổng | Thua | Tỷ lệ |
|------------|------------|------|------|--------|
| 45–59 | two-plus-margin | 17 | 11 | **64.7%** |
| 30–44 | one-goal-margin | 27 | 16 | **59.3%** |
| 60–74 | 0-0 | 12 | 7 | 58.3% |
| 45–59 | 0-0 | 16 | 9 | 56.3% |
| 60–74 | two-plus-margin | 29 | 16 | 55.2% |
| 00–29 | one-goal-margin | 47 | 24 | 51.1% |

**Rule mới cần implement**:

```
# Combo nguy hiểm nhất — block hoàn toàn
IF scoreState == "two-plus-margin" AND minuteBand IN ["45-59"]:
  shouldPush = false
  reason = "HIGH_MARGIN_MIDGAME_BLOCK"

# Combo nguy hiểm — chỉ cho phép khi đủ điều kiện ketat
IF scoreState == "one-goal-margin" AND minuteBand IN ["30-44"]:
  IF NOT (evidenceMode == "full_live_data" AND breakEvenRate < 0.48 AND directionalWin == true):
    shouldPush = false
    reason = "ONE_GOAL_MIDGAME_INSUFFICIENT_CONFIDENCE"

IF scoreState IN ["0-0", "two-plus-margin"] AND minuteBand IN ["60-74"]:
  IF NOT (evidenceMode == "full_live_data" AND breakEvenRate < 0.48):
    shouldPush = false
    reason = "LATE_MIDGAME_INSUFFICIENT_CONFIDENCE"
```

---

### 4. Nâng ngưỡng shouldPush

**Bối cảnh**: 197 cases được đánh dấu `shouldPush = true`, nhưng 95 cases (48.2%) thực tế thua. Các market tệ nhất trong nhóm này:

| canonicalMarket | shouldPush=true & thua |
|-----------------|----------------------|
| btts_no | 8 |
| corners_under_8.5 | 7 |
| corners_under_7.5 | 6 |
| under_2.25 | 3 |
| corners_over_13.5 | 3 |

Điều này cho thấy ngưỡng confidence hiện tại đang quá thấp — agent push quá dễ dàng.

**Rule mới cần implement**:

```
# Trước khi set shouldPush = true, kiểm tra tất cả điều kiện sau:
def evaluate_should_push(case):

  # Điều kiện bắt buộc
  required_conditions = [
    case.evidenceMode == "full_live_data",
    case.directionalWin == True,
    case.breakEvenRate < 0.50,          # Hiện tại có thể đang cho phép > 0.52
    case.actionable == True,
  ]

  # Nếu thiếu bất kỳ điều kiện nào → không push
  if not all(required_conditions):
    return False, "REQUIRED_CONDITIONS_NOT_MET"

  # Kiểm tra thêm: nếu market thuộc nhóm rủi ro cao, yêu cầu breakEvenRate ketat hơn
  HIGH_RISK_MARKETS = ["btts_no", "corners_under_7.5", "corners_under_8.5",
                       "corners_under_9.5", "under_2.25", "over_2.5"]

  if case.canonicalMarket in HIGH_RISK_MARKETS:
    if case.breakEvenRate >= 0.48:
      return False, "HIGH_RISK_MARKET_BREAKEVEN_TOO_HIGH"

  return True, "APPROVED"
```

---

### 5. Block canonicalMarket = unknown

**Bối cảnh**: 35 cases có `canonicalMarket = "unknown"` — toàn bộ đều `actionable = False`, tức agent không resolve được market. Dù vậy, 16 cases vẫn được ghi nhận là loss (có thể do pipeline tiếp tục xử lý).

**Rule mới cần implement**:

```
# Kiểm tra sớm, trước tất cả logic khác
IF canonicalMarket IS NULL OR canonicalMarket == "unknown" OR canonicalMarket == "":
  actionable = false
  shouldPush = false
  replaySelection = null
  reason = "MARKET_UNRESOLVED"
  # Dừng toàn bộ pipeline — không tiếp tục evaluate
  return early
```

> **Lưu ý cho coding agent**: Rule này nên được đặt là gate đầu tiên trong pipeline, trước bất kỳ logic evaluation nào khác.

---

### 6. Hạ ngưỡng cho phút 75+ (ưu tiên late-game)

**Bối cảnh**: `minuteBand = "75+"` có tỷ lệ thua **31.2%** — thấp nhất trong tất cả các band. Đặc biệt tốt khi:

| scoreState | minuteBand | Tổng | Thua | Tỷ lệ |
|------------|------------|------|------|--------|
| one-goal-margin | 75+ | 15 | 4 | **26.7%** |
| two-plus-margin | 75+ | 12 | 4 | **33.3%** |

Signal late-game đáng tin hơn đáng kể so với giữa trận.

**Rule mới cần implement**:

```
# Late-game bonus: hạ yêu cầu breakEvenRate xuống 5% cho 75+
IF minuteBand == "75+":
  effective_breakeven_threshold = breakeven_threshold - 0.05
  # Ví dụ: nếu threshold chuẩn là 0.50, thì với 75+ chỉ cần < 0.55

# Đặc biệt ưu tiên: 75+ + one-goal-margin (win rate cao nhất)
IF minuteBand == "75+" AND scoreState == "one-goal-margin":
  IF evidenceMode == "full_live_data":
    # Cho phép push ngay cả khi directionalWin chưa xác nhận
    override_directional_win_requirement = true
```

---

## Thứ tự ưu tiên implement

Nếu cần implement từng bước, ưu tiên theo thứ tự sau:

1. **[Cao nhất]** Rule 5 — Block unknown market (bug fix, không có downside)
2. **[Cao nhất]** Rule 1 — BTTS No với one-goal/two-plus margin (100% loss rate)
3. **[Cao]** Rule 4 — Nâng ngưỡng shouldPush (ảnh hưởng rộng nhất về volume)
4. **[Trung bình]** Rule 2 — Blacklist market theo timing
5. **[Trung bình]** Rule 3 — Penalty combo cách biệt + giữa trận
6. **[Thấp hơn]** Rule 6 — Late-game bonus (optimization, không urgent)

---

## Lưu ý quan trọng cho Coding Agent

- Tất cả rule mới nên được **log lý do từ chối** (`reason` field) để tiện phân tích sau.
- Các threshold số (0.48, 0.50, 0.55...) nên được đưa vào **config file** thay vì hardcode, để dễ tune sau khi có thêm data.
- Sau khi deploy, cần **backtest lại trên 400 cases** để xác nhận improvement trước khi chạy live.
- Sample size một số market còn nhỏ (< 10 cases) — các rule liên quan nên được monitor chặt trong 2–4 tuần đầu.

---

*Tài liệu này được tạo từ phân tích 400 cases thực tế. Nguồn: `cases-full-400.csv`.*
