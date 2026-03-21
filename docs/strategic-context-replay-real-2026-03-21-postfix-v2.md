# Strategic Context Replay Report

- Total scenarios: 4
- Passed assertions: 1/4

| Scenario | Competition Type | Search Quality | Trusted Sources | Quant Coverage | Usable | Assertions |
| --- | --- | --- | --- | --- | --- | --- |
| 01-domestic-league-rich | domestic_league | medium | 1 | 0 | yes | fail |
| 02-european-cross-league | european | low | 0 | 0 | no | fail |
| 03-international | international | low | 0 | 0 | no | fail |
| 04-no-data-synthetic | friendly | unknown | 0 | 0 | no | pass |

## Details

### 01-domestic-league-rich
- success: true
- competition_type: domestic_league
- search_quality: medium
- trusted_source_count: 1
- quantitative_coverage: 0
- usable: true
- summary_en: This is a significant Premier League London derby between two major clubs. Specific motivations, league positions, fixture congestion, rotation risks, and key absences for the March 21, 2026 fixture cannot be determined at this time. Historical head-to-head matches indicate a competitive rivalry with mixed results.
- summary_vi: Khong tim thay du lieu
- ai_condition: 
- source_domains: espn.com
- assertions: fail

### 02-european-cross-league
- success: true
- competition_type: european
- search_quality: low
- trusted_source_count: 0
- quantitative_coverage: 0
- usable: false
- summary_en: No data found
- summary_vi: Khong tim thay du lieu
- ai_condition: 
- source_domains: vertexaisearch.cloud.google.com, vertexaisearch.cloud.google.com, vertexaisearch.cloud.google.com, vertexaisearch.cloud.google.com, vertexaisearch.cloud.google.com, vertexaisearch.cloud.google.com, vertexaisearch.cloud.google.com, vertexaisearch.cloud.google.com
- assertions: fail

### 03-international
- success: true
- competition_type: international
- search_quality: low
- trusted_source_count: 0
- quantitative_coverage: 0
- usable: false
- summary_en: No data found
- summary_vi: Khong tim thay du lieu
- ai_condition: 
- source_domains: vertexaisearch.cloud.google.com, vertexaisearch.cloud.google.com
- assertions: fail

### 04-no-data-synthetic
- success: true
- competition_type: friendly
- search_quality: unknown
- trusted_source_count: 0
- quantitative_coverage: 0
- usable: false
- summary_en: No data found for either team or the competition, suggesting these are synthetic entities for testing or fictional purposes.
- summary_vi: Không tìm thấy dữ liệu cho cả hai đội hoặc giải đấu, cho thấy đây là các thực thể tổng hợp để thử nghiệm hoặc mục đích hư cấu.
- ai_condition: No specific condition
- assertions: pass
