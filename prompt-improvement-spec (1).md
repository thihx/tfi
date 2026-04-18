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

## Vấn đề gốc rễ: Tại sao AI thua lặp lại?

Các rule ở trên là **patch thủ công** — con người đọc data rồi viết rule thay cho AI. Chúng sẽ giảm thua trong ngắn hạn, nhưng **không giải quyết được nguyên nhân gốc**.

Toàn bộ 400 cases đều từ cùng một `promptVersion: v10-hybrid-legacy-b`. AI không hề biết mình đã thua — mỗi lần recommend là một lần "mới hoàn toàn", không có memory về việc BTTS No ở one-goal-margin đã thua 10 lần trước đó.

Có 3 nguyên nhân cấu trúc:

1. **Không có feedback loop**: Agent nhận input → output recommendation → kết thúc. Kết quả settlement không bao giờ được đưa trở lại làm input cho lần sau.
2. **Dùng prior knowledge, không dùng empirical performance**: AI lý luận kiểu "BTTS No hợp lý vì tỷ số 0-0" thay vì "BTTS No trong tình huống này đã thua 18/30 lần trong lịch sử thực tế của chính nó."
3. **Hard-coded priors lấn át signal thực tế**: Nếu agent được prompt với logic "two-plus-margin thì momentum tiếp diễn", nó sẽ tiếp tục recommend theo hướng đó dù data đã phủ nhận.

Giải pháp bền vững là bổ sung một lớp **Performance Memory** vào pipeline.

---

## Thiết kế Performance Memory Layer

### Tổng quan kiến trúc

```
┌─────────────────────────────────────────────────────┐
│                   PIPELINE HIỆN TẠI                 │
│                                                     │
│   Input → [AI Agent] → Recommendation → Settlement  │
│                                                     │
└─────────────────────────────────────────────────────┘

                        ↓ Thêm vào

┌─────────────────────────────────────────────────────┐
│              PIPELINE VỚI MEMORY LAYER              │
│                                                     │
│   Input → [Memory Lookup] → [AI Agent] → Output     │
│                                  ↓                  │
│                            Settlement               │
│                                  ↓                  │
│                         [Memory Writer]             │
│                                  ↓                  │
│                        Performance Store            │
│                                  ↑                  │
│                         (feed ngược lại)            │
└─────────────────────────────────────────────────────┘
```

### Cấu trúc Performance Store

Lưu thống kê win/loss theo **combination key** — mỗi tổ hợp `(canonicalMarket, minuteBand, scoreState)` có một bản ghi riêng:

```python
# Schema
PerformanceRecord = {
  "key": "btts_no|00-29|one-goal-margin",   # composite key
  "canonicalMarket": "btts_no",
  "minuteBand": "00-29",
  "scoreState": "one-goal-margin",
  "total": 6,
  "wins": 3,
  "losses": 3,
  "half_wins": 0,
  "half_losses": 0,
  "pushes": 0,
  "empirical_win_rate": 0.50,               # tính tự động
  "last_updated": "2025-04-18T00:00:00Z",
  "sample_reliable": True                   # True nếu total >= 10
}
```

### Memory Writer — cập nhật sau mỗi settlement

Sau khi có kết quả thực tế, ghi lại vào store:

```python
def write_settlement(case):
  key = f"{case.canonicalMarket}|{case.minuteBand}|{case.scoreState}"

  record = store.get(key) or new_record(key, case)

  record["total"] += 1

  if case.originalResult == "win":
    record["wins"] += 1
  elif case.originalResult == "loss":
    record["losses"] += 1
  elif case.originalResult == "half_win":
    record["half_wins"] += 1
  elif case.originalResult == "half_loss":
    record["half_losses"] += 1
  elif case.originalResult == "push":
    record["pushes"] += 1

  # Tính win rate: half_win tính 0.5, half_loss tính 0.5
  effective_wins = record["wins"] + record["half_wins"] * 0.5
  effective_losses = record["losses"] + record["half_losses"] * 0.5
  record["empirical_win_rate"] = effective_wins / record["total"]
  record["sample_reliable"] = record["total"] >= 10

  store.set(key, record)
```

### Memory Lookup — tra cứu trước khi AI quyết định

Trước khi agent generate recommendation, inject thống kê lịch sử vào context:

```python
def lookup_performance(case):
  key = f"{case.canonicalMarket}|{case.minuteBand}|{case.scoreState}"
  record = store.get(key)

  if record is None:
    return {"status": "no_history"}

  return {
    "status": "found",
    "empirical_win_rate": record["empirical_win_rate"],
    "sample_size": record["total"],
    "sample_reliable": record["sample_reliable"],
    "wins": record["wins"],
    "losses": record["losses"],
  }
```

### Tích hợp vào prompt của AI Agent

Inject kết quả lookup vào system prompt hoặc context block:

```
[PERFORMANCE MEMORY]
Market: btts_no | Minute band: 00-29 | Score state: one-goal-margin
Historical record: 3W / 3L from 6 cases (sample: unreliable, n < 10)
Empirical win rate: 50.0%

---
Market: btts_no | Minute band: 30-44 | Score state: one-goal-margin
Historical record: 0W / 3L from 3 cases (sample: unreliable, n < 10)
Empirical win rate: 0.0%

[INSTRUCTION]
When empirical_win_rate < 0.45 AND sample_reliable = true:
  You MUST set shouldPush = false, regardless of your own analysis.
When empirical_win_rate < 0.45 AND sample_reliable = false (n < 10):
  Treat as a strong caution signal. Increase your confidence threshold by 15%.
When no history exists:
  Proceed with standard evaluation but note the absence of empirical data.
```

### Logic override dựa trên empirical data

```python
def apply_memory_override(case, recommendation, perf):

  if perf["status"] == "no_history":
    # Không có lịch sử — giữ nguyên recommendation nhưng flag
    recommendation["memory_flag"] = "NO_HISTORY"
    return recommendation

  win_rate = perf["empirical_win_rate"]
  reliable = perf["sample_reliable"]

  if reliable and win_rate < 0.40:
    # Lịch sử đủ mẫu, tỷ lệ thắng rất thấp → block
    recommendation["shouldPush"] = False
    recommendation["reason"] = f"MEMORY_OVERRIDE_LOW_WIN_RATE_{win_rate:.0%}"

  elif reliable and win_rate < 0.45:
    # Cảnh báo mạnh — chỉ push nếu breakEvenRate rất tốt
    if case.breakEvenRate >= 0.46:
      recommendation["shouldPush"] = False
      recommendation["reason"] = "MEMORY_OVERRIDE_MARGINAL_WIN_RATE"

  elif not reliable and win_rate < 0.35:
    # Sample nhỏ nhưng tín hiệu rất xấu → cảnh báo
    recommendation["memory_flag"] = f"SMALL_SAMPLE_WARNING_{win_rate:.0%}"

  return recommendation
```

### Ngưỡng tự động cập nhật rule

Thay vì con người phải đọc data rồi viết rule thủ công như ở trên, hệ thống có thể **tự động phát hiện** combination key nào cần block:

```python
def auto_generate_rules(store, min_samples=15, max_win_rate=0.40):
  """
  Quét toàn bộ store, tìm các key đủ mẫu và tỷ lệ thắng thấp.
  Gửi alert cho team để review và confirm thành hard rule.
  """
  candidates = []
  for key, record in store.items():
    if record["total"] >= min_samples and record["empirical_win_rate"] <= max_win_rate:
      candidates.append({
        "key": key,
        "win_rate": record["empirical_win_rate"],
        "total": record["total"],
        "suggested_action": "block" if record["empirical_win_rate"] < 0.35 else "raise_threshold"
      })

  candidates.sort(key=lambda x: x["win_rate"])
  return candidates

# Ví dụ output sau khi có 400 cases:
# [
#   {"key": "btts_no|30-44|one-goal-margin", "win_rate": 0.0, "total": 3, "suggested_action": "block"},
#   {"key": "over_2.5|60-74|...",            "win_rate": 0.0, "total": 3, "suggested_action": "block"},
#   ...
# ]
```

### Roadmap triển khai

| Giai đoạn | Việc cần làm | Thời gian ước tính |
|-----------|-------------|-------------------|
| **Phase 1** | Implement Memory Writer — ghi settlement vào store sau mỗi batch | 1–2 ngày |
| **Phase 2** | Implement Memory Lookup — inject historical stats vào prompt context | 1–2 ngày |
| **Phase 3** | Implement Memory Override — block/warn dựa trên empirical win rate | 1 ngày |
| **Phase 4** | Implement auto_generate_rules — alert tự động khi phát hiện pattern xấu | 2–3 ngày |
| **Phase 5** | Dashboard theo dõi win rate theo từng combination key theo thời gian | tùy yêu cầu |

> **Lưu ý**: Phase 1–3 có thể chạy song song với các hard rule ở phần trên. Hard rule hoạt động như safety net tức thì, Memory Layer hoạt động như hệ thống học dài hạn.

---

## Thứ tự ưu tiên implement

Nếu cần implement từng bước, ưu tiên theo thứ tự sau:

**Ngắn hạn — Hard rules (patch ngay):**

1. **[Cao nhất]** Rule 5 — Block unknown market (bug fix, không có downside)
2. **[Cao nhất]** Rule 1 — BTTS No với one-goal/two-plus margin (100% loss rate)
3. **[Cao]** Rule 4 — Nâng ngưỡng shouldPush (ảnh hưởng rộng nhất về volume)
4. **[Trung bình]** Rule 2 — Blacklist market theo timing
5. **[Trung bình]** Rule 3 — Penalty combo cách biệt + giữa trận
6. **[Thấp hơn]** Rule 6 — Late-game bonus (optimization, không urgent)

**Dài hạn — Performance Memory Layer (giải quyết gốc rễ):**

7. **[Phase 1]** Memory Writer — ghi settlement sau mỗi batch
8. **[Phase 2]** Memory Lookup + inject vào prompt context
9. **[Phase 3]** Memory Override — tự động block/warn theo empirical win rate
10. **[Phase 4]** Auto rule generation + alert system

---

## Lưu ý quan trọng cho Coding Agent

- Tất cả rule mới nên được **log lý do từ chối** (`reason` field) để tiện phân tích sau.
- Các threshold số (0.48, 0.50, 0.55...) nên được đưa vào **config file** thay vì hardcode, để dễ tune sau khi có thêm data.
- Sau khi deploy, cần **backtest lại trên 400 cases** để xác nhận improvement trước khi chạy live.
- Sample size một số market còn nhỏ (< 10 cases) — các rule liên quan nên được monitor chặt trong 2–4 tuần đầu.

---

*Tài liệu này được tạo từ phân tích 400 cases thực tế. Nguồn: `cases-full-400.csv`.*
