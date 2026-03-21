import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    geminiApiKey: 'test-key',
    geminiModel: 'gemini-test',
    geminiStrategicGroundedModel: 'gemini-strategic-grounded',
    geminiStrategicStructuredModel: 'gemini-strategic-structured',
    geminiStrategicGroundedMaxOutputTokens: 4000,
    geminiStrategicStructuredMaxOutputTokens: 2048,
    geminiStrategicGroundedThinkingBudget: 0,
    geminiStrategicStructuredThinkingBudget: 0,
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const {
  fetchStrategicContext,
  buildMachineConditionFromBlueprint,
  hasUsableStrategicContext,
} = await import('../lib/strategic-context.service.js');

function makeGeminiResponse(text: string, groundingMetadata?: Record<string, unknown>) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      candidates: [{
        content: {
          parts: [{ text }],
        },
        ...(groundingMetadata ? { groundingMetadata } : {}),
      }],
    }),
    text: vi.fn(),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('strategic-context.service', () => {
  test('parses structured grounded response into v2 context with bilingual notes and quantitative priors', async () => {
    fetchMock
      .mockResolvedValueOnce(makeGeminiResponse(
        `COMPETITION_TYPE: domestic_league
HOME_MOTIVATION: Home side is chasing the title.
AWAY_MOTIVATION: Away side needs points to avoid relegation.
LEAGUE_POSITIONS: Home 2nd, Away 18th in the same domestic league.
FIXTURE_CONGESTION: Home has a cup semifinal in three days.
ROTATION_RISK: Moderate home rotation risk.
KEY_ABSENCES: Away missing first-choice center back.
H2H_NARRATIVE: Home won three of the last four meetings.
SUMMARY: Strong pre-match edge for the home attack, but rotation risk matters.
HOME_LAST5_POINTS: 11
AWAY_LAST5_POINTS: 3
HOME_LAST5_GOALS_FOR: 9
AWAY_LAST5_GOALS_FOR: 4
HOME_LAST5_GOALS_AGAINST: 4
AWAY_LAST5_GOALS_AGAINST: 10
HOME_HOME_GOALS_AVG: 1.9
AWAY_AWAY_GOALS_AVG: 0.8
HOME_OVER_2_5_RATE_LAST10: 60
AWAY_OVER_2_5_RATE_LAST10: 50
HOME_BTTS_RATE_LAST10: 55
AWAY_BTTS_RATE_LAST10: 45
HOME_CLEAN_SHEET_RATE_LAST10: 30
AWAY_CLEAN_SHEET_RATE_LAST10: 10
HOME_FAILED_TO_SCORE_RATE_LAST10: 10
AWAY_FAILED_TO_SCORE_RATE_LAST10: 40
ALERT_WINDOW_START: 60
ALERT_WINDOW_END: null
PREFERRED_SCORE_STATE: not_home_leading
PREFERRED_GOAL_STATE: any
FAVOURED_SIDE: home
ALERT_RATIONALE: Home pressure profile supports a late trigger if they are not ahead by 60.`,
        {
          webSearchQueries: ['Arsenal Chelsea injuries', 'Premier League table'],
          groundingChunks: [
            { web: { uri: 'https://www.reuters.com/world/uk/example-story', title: 'Reuters squad update' } },
            { web: { uri: 'https://fbref.com/en/matches/example', title: 'FBref match report' } },
          ],
        },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(JSON.stringify({
        qualitative_en: {
          home_motivation: 'Home side is chasing the title.',
          away_motivation: 'Away side needs points to avoid relegation.',
          league_positions: 'Home 2nd, Away 18th in the same domestic league.',
          fixture_congestion: 'Home has a cup semifinal in three days.',
          rotation_risk: 'Moderate home rotation risk.',
          key_absences: 'Away missing first-choice center back.',
          h2h_narrative: 'Home won three of the last four meetings.',
          summary: 'Strong pre-match edge for the home attack, but rotation risk matters.',
        },
        qualitative_vi: {
          home_motivation: 'Chu nha dang dua vo dich.',
          away_motivation: 'Doi khach can diem de tranh xuong hang.',
          league_positions: 'Chu nha dung thu 2, doi khach dung thu 18 cung giai.',
          fixture_congestion: 'Chu nha co ban ket cup sau ba ngay.',
          rotation_risk: 'Rui ro xoay tua vua phai cho chu nha.',
          key_absences: 'Doi khach mat trung ve chinh.',
          h2h_narrative: 'Chu nha thang 3/4 lan doi dau gan nhat.',
          summary: 'Tien de truoc tran nghieng ve suc tan cong cua chu nha nhung can tru rui ro xoay tua.',
        },
        quantitative: {
          home_last5_points: 11,
          away_last5_points: 3,
          home_last5_goals_for: 9,
          away_last5_goals_for: 4,
          home_last5_goals_against: 4,
          away_last5_goals_against: 10,
          home_home_goals_avg: 1.9,
          away_away_goals_avg: 0.8,
          home_over_2_5_rate_last10: 60,
          away_over_2_5_rate_last10: 50,
          home_btts_rate_last10: 55,
          away_btts_rate_last10: 45,
          home_clean_sheet_rate_last10: 30,
          away_clean_sheet_rate_last10: 10,
          home_failed_to_score_rate_last10: 10,
          away_failed_to_score_rate_last10: 40,
        },
        competition_type: 'domestic_league',
        condition_blueprint: {
          alert_window_start: 60,
          alert_window_end: null,
          preferred_score_state: 'not_home_leading',
          preferred_goal_state: 'any',
          favoured_side: 'home',
          alert_rationale_en: 'Home pressure profile supports a late trigger if they are not ahead by 60.',
          alert_rationale_vi: 'Ap luc cua chu nha ung ho trigger muon neu ho chua dan truoc o phut 60.',
        },
      })));

    const context = await fetchStrategicContext('Arsenal', 'Chelsea', 'Premier League', '2026-03-21');

    expect(context).not.toBeNull();
    expect(context?.version).toBe(2);
    expect(context?.summary).toContain('Strong pre-match edge');
    expect(context?.summary_vi).toContain('Tien de truoc tran');
    expect(context?.competition_type).toBe('domestic_league');
    expect(context?.quantitative.home_last5_points).toBe(11);
    expect(context?.ai_condition).toBe('(Minute >= 60) AND (NOT Home leading)');
    expect(context?.ai_condition_blueprint?.favoured_side).toBe('home');
    expect(context?.ai_condition_reason).toContain('late trigger');
    expect(context?.source_meta.search_quality).toBe('high');
    expect(context?.source_meta.trusted_source_count).toBe(2);
    expect(context?.source_meta.sources.map((source) => source.domain)).toEqual([
      'reuters.com',
      'fbref.com',
    ]);
  });

  test('sends a research prompt that enforces trusted-source and cross-league safety rules', async () => {
    fetchMock
      .mockResolvedValueOnce(makeGeminiResponse(
        `COMPETITION_TYPE: european
HOME_MOTIVATION: No data found
AWAY_MOTIVATION: No data found
LEAGUE_POSITIONS: No data found
FIXTURE_CONGESTION: No data found
ROTATION_RISK: No data found
KEY_ABSENCES: No data found
H2H_NARRATIVE: No data found
SUMMARY: No data found
HOME_LAST5_POINTS: null
AWAY_LAST5_POINTS: null
HOME_LAST5_GOALS_FOR: null
AWAY_LAST5_GOALS_FOR: null
HOME_LAST5_GOALS_AGAINST: null
AWAY_LAST5_GOALS_AGAINST: null
HOME_HOME_GOALS_AVG: null
AWAY_AWAY_GOALS_AVG: null
HOME_OVER_2_5_RATE_LAST10: null
AWAY_OVER_2_5_RATE_LAST10: null
HOME_BTTS_RATE_LAST10: null
AWAY_BTTS_RATE_LAST10: null
HOME_CLEAN_SHEET_RATE_LAST10: null
AWAY_CLEAN_SHEET_RATE_LAST10: null
HOME_FAILED_TO_SCORE_RATE_LAST10: null
AWAY_FAILED_TO_SCORE_RATE_LAST10: null
ALERT_WINDOW_START: null
ALERT_WINDOW_END: null
PREFERRED_SCORE_STATE: any
PREFERRED_GOAL_STATE: any
FAVOURED_SIDE: none
ALERT_RATIONALE:`,
        {
          groundingChunks: [],
        },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(JSON.stringify({
        qualitative_en: {
          home_motivation: 'No data found',
          away_motivation: 'No data found',
          league_positions: 'No data found',
          fixture_congestion: 'No data found',
          rotation_risk: 'No data found',
          key_absences: 'No data found',
          h2h_narrative: 'No data found',
          summary: 'No data found',
        },
        qualitative_vi: {
          home_motivation: 'Khong tim thay du lieu',
          away_motivation: 'Khong tim thay du lieu',
          league_positions: 'Khong tim thay du lieu',
          fixture_congestion: 'Khong tim thay du lieu',
          rotation_risk: 'Khong tim thay du lieu',
          key_absences: 'Khong tim thay du lieu',
          h2h_narrative: 'Khong tim thay du lieu',
          summary: 'Khong tim thay du lieu',
        },
        quantitative: {},
        competition_type: 'european',
        condition_blueprint: {
          alert_window_start: null,
          alert_window_end: null,
          preferred_score_state: 'any',
          preferred_goal_state: 'any',
          favoured_side: 'none',
          alert_rationale_en: '',
          alert_rationale_vi: '',
        },
      })));

    await fetchStrategicContext('Arsenal', 'Inter', 'UEFA Champions League', '2026-03-21');

    const reqInit = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
    const body = reqInit?.body ? JSON.parse(reqInit.body) : null;
    const prompt = body?.contents?.[0]?.parts?.[0]?.text as string;

    expect(prompt).toContain('Prioritize trustworthy sources only');
    expect(prompt).toContain('Do NOT infer team strength solely from brand size, reputation, or club-name recognition.');
    expect(prompt).toContain('For european/international/friendly matches: the teams are from different domestic leagues, so do NOT compare their league positions directly.');
    expect(prompt).toContain('If competition_type is unknown or unclear, leave it as an empty string and disable league-position-gap reasoning.');
  });

  test('uses strategic-context-specific Gemini model and thinking config for grounded and structured calls', async () => {
    fetchMock
      .mockResolvedValueOnce(makeGeminiResponse(
        `COMPETITION_TYPE: domestic_league
HOME_MOTIVATION: No data found
AWAY_MOTIVATION: No data found
LEAGUE_POSITIONS: No data found
FIXTURE_CONGESTION: No data found
ROTATION_RISK: No data found
KEY_ABSENCES: No data found
H2H_NARRATIVE: No data found
SUMMARY: No data found
HOME_LAST5_POINTS: null
AWAY_LAST5_POINTS: null
HOME_LAST5_GOALS_FOR: null
AWAY_LAST5_GOALS_FOR: null
HOME_LAST5_GOALS_AGAINST: null
AWAY_LAST5_GOALS_AGAINST: null
HOME_HOME_GOALS_AVG: null
AWAY_AWAY_GOALS_AVG: null
HOME_OVER_2_5_RATE_LAST10: null
AWAY_OVER_2_5_RATE_LAST10: null
HOME_BTTS_RATE_LAST10: null
AWAY_BTTS_RATE_LAST10: null
HOME_CLEAN_SHEET_RATE_LAST10: null
AWAY_CLEAN_SHEET_RATE_LAST10: null
HOME_FAILED_TO_SCORE_RATE_LAST10: null
AWAY_FAILED_TO_SCORE_RATE_LAST10: null
ALERT_WINDOW_START: null
ALERT_WINDOW_END: null
PREFERRED_SCORE_STATE: any
PREFERRED_GOAL_STATE: any
FAVOURED_SIDE: none
ALERT_RATIONALE:`,
        { groundingChunks: [] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(JSON.stringify({
        qualitative_en: {
          home_motivation: 'No data found',
          away_motivation: 'No data found',
          league_positions: 'No data found',
          fixture_congestion: 'No data found',
          rotation_risk: 'No data found',
          key_absences: 'No data found',
          h2h_narrative: 'No data found',
          summary: 'No data found',
        },
        qualitative_vi: {
          home_motivation: 'Khong tim thay du lieu',
          away_motivation: 'Khong tim thay du lieu',
          league_positions: 'Khong tim thay du lieu',
          fixture_congestion: 'Khong tim thay du lieu',
          rotation_risk: 'Khong tim thay du lieu',
          key_absences: 'Khong tim thay du lieu',
          h2h_narrative: 'Khong tim thay du lieu',
          summary: 'Khong tim thay du lieu',
        },
        quantitative: {},
        competition_type: 'domestic_league',
        condition_blueprint: {
          alert_window_start: null,
          alert_window_end: null,
          preferred_score_state: 'any',
          preferred_goal_state: 'any',
          favoured_side: 'none',
          alert_rationale_en: '',
          alert_rationale_vi: '',
        },
      })));

    await fetchStrategicContext('Team A', 'Team B', 'League', '2026-03-21');

    const groundedUrl = String(fetchMock.mock.calls[0]?.[0] ?? '');
    const groundedBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined)?.body ?? '{}'));
    const structuredUrl = String(fetchMock.mock.calls[1]?.[0] ?? '');
    const structuredBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as { body?: string } | undefined)?.body ?? '{}'));

    expect(groundedUrl).toContain('/gemini-strategic-grounded:generateContent');
    expect(groundedBody.generationConfig?.responseMimeType).toBe('text/plain');
    expect(groundedBody.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(structuredUrl).toContain('/gemini-strategic-structured:generateContent');
    expect(structuredBody.generationConfig?.responseMimeType).toBe('application/json');
    expect(structuredBody.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  test('retries without thinkingConfig when Gemini rejects that field', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: vi.fn().mockResolvedValue('Invalid JSON payload received. Unknown name "thinkingConfig": Cannot find field.'),
      })
      .mockResolvedValueOnce(makeGeminiResponse(
        `COMPETITION_TYPE: domestic_league
HOME_MOTIVATION: No data found
AWAY_MOTIVATION: No data found
LEAGUE_POSITIONS: No data found
FIXTURE_CONGESTION: No data found
ROTATION_RISK: No data found
KEY_ABSENCES: No data found
H2H_NARRATIVE: No data found
SUMMARY: No data found
HOME_LAST5_POINTS: null
AWAY_LAST5_POINTS: null
HOME_LAST5_GOALS_FOR: null
AWAY_LAST5_GOALS_FOR: null
HOME_LAST5_GOALS_AGAINST: null
AWAY_LAST5_GOALS_AGAINST: null
HOME_HOME_GOALS_AVG: null
AWAY_AWAY_GOALS_AVG: null
HOME_OVER_2_5_RATE_LAST10: null
AWAY_OVER_2_5_RATE_LAST10: null
HOME_BTTS_RATE_LAST10: null
AWAY_BTTS_RATE_LAST10: null
HOME_CLEAN_SHEET_RATE_LAST10: null
AWAY_CLEAN_SHEET_RATE_LAST10: null
HOME_FAILED_TO_SCORE_RATE_LAST10: null
AWAY_FAILED_TO_SCORE_RATE_LAST10: null
ALERT_WINDOW_START: null
ALERT_WINDOW_END: null
PREFERRED_SCORE_STATE: any
PREFERRED_GOAL_STATE: any
FAVOURED_SIDE: none
ALERT_RATIONALE:`,
        { groundingChunks: [] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(JSON.stringify({
        qualitative_en: {
          home_motivation: 'No data found',
          away_motivation: 'No data found',
          league_positions: 'No data found',
          fixture_congestion: 'No data found',
          rotation_risk: 'No data found',
          key_absences: 'No data found',
          h2h_narrative: 'No data found',
          summary: 'No data found',
        },
        qualitative_vi: {
          home_motivation: 'Khong tim thay du lieu',
          away_motivation: 'Khong tim thay du lieu',
          league_positions: 'Khong tim thay du lieu',
          fixture_congestion: 'Khong tim thay du lieu',
          rotation_risk: 'Khong tim thay du lieu',
          key_absences: 'Khong tim thay du lieu',
          h2h_narrative: 'Khong tim thay du lieu',
          summary: 'Khong tim thay du lieu',
        },
        quantitative: {},
        competition_type: 'domestic_league',
        condition_blueprint: {
          alert_window_start: null,
          alert_window_end: null,
          preferred_score_state: 'any',
          preferred_goal_state: 'any',
          favoured_side: 'none',
          alert_rationale_en: '',
          alert_rationale_vi: '',
        },
      })));

    const context = await fetchStrategicContext('Retry Team A', 'Retry Team B', 'Retry League', '2026-03-21');

    expect(context).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined)?.body ?? '{}'));
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as { body?: string } | undefined)?.body ?? '{}'));
    expect(firstBody.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(secondBody.thinkingConfig).toBeUndefined();
  });

  test('downgrades low-trust grounded search output to no-data context', async () => {
    fetchMock
      .mockResolvedValueOnce(makeGeminiResponse(
        `COMPETITION_TYPE: domestic_league
HOME_MOTIVATION: Looks motivated.
AWAY_MOTIVATION: Looks motivated.
LEAGUE_POSITIONS: Unknown
FIXTURE_CONGESTION: Unknown
ROTATION_RISK: Unknown
KEY_ABSENCES: Unknown
H2H_NARRATIVE: Unknown
SUMMARY: Narrative from weak sources.
HOME_LAST5_POINTS: 10
AWAY_LAST5_POINTS: 8
HOME_LAST5_GOALS_FOR: null
AWAY_LAST5_GOALS_FOR: null
HOME_LAST5_GOALS_AGAINST: null
AWAY_LAST5_GOALS_AGAINST: null
HOME_HOME_GOALS_AVG: null
AWAY_AWAY_GOALS_AVG: null
HOME_OVER_2_5_RATE_LAST10: null
AWAY_OVER_2_5_RATE_LAST10: null
HOME_BTTS_RATE_LAST10: null
AWAY_BTTS_RATE_LAST10: null
HOME_CLEAN_SHEET_RATE_LAST10: null
AWAY_CLEAN_SHEET_RATE_LAST10: null
HOME_FAILED_TO_SCORE_RATE_LAST10: null
AWAY_FAILED_TO_SCORE_RATE_LAST10: null
ALERT_WINDOW_START: 55
ALERT_WINDOW_END: null
PREFERRED_SCORE_STATE: draw
PREFERRED_GOAL_STATE: any
FAVOURED_SIDE: none
ALERT_RATIONALE: Weak evidence`,
        {
          groundingChunks: [
            { web: { uri: 'https://best-betting-tips.example.com/post', title: 'Betting tips' } },
          ],
        },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(JSON.stringify({
        qualitative_en: {
          home_motivation: 'Looks motivated.',
          away_motivation: 'Looks motivated.',
          league_positions: 'Unknown',
          fixture_congestion: 'Unknown',
          rotation_risk: 'Unknown',
          key_absences: 'Unknown',
          h2h_narrative: 'Unknown',
          summary: 'Narrative from weak sources.',
        },
        qualitative_vi: {
          home_motivation: 'Co dong luc.',
          away_motivation: 'Co dong luc.',
          league_positions: 'Khong ro',
          fixture_congestion: 'Khong ro',
          rotation_risk: 'Khong ro',
          key_absences: 'Khong ro',
          h2h_narrative: 'Khong ro',
          summary: 'Narrative tu nguon yeu.',
        },
        quantitative: {
          home_last5_points: 10,
          away_last5_points: 8,
        },
        competition_type: 'domestic_league',
        condition_blueprint: {
          alert_window_start: 55,
          alert_window_end: null,
          preferred_score_state: 'draw',
          preferred_goal_state: 'any',
          favoured_side: 'none',
          alert_rationale_en: 'Weak evidence',
          alert_rationale_vi: 'Bang chung yeu',
        },
      })));

    const context = await fetchStrategicContext('Team A', 'Team B', 'League', '2026-03-21');

    expect(context).not.toBeNull();
    expect(context?.summary).toBe('No data found');
    expect(context?.summary_vi).toBe('Khong tim thay du lieu');
    expect(context?.ai_condition).toBe('');
    expect(context?.source_meta.search_quality).toBe('low');
    expect(context?.source_meta.rejected_source_count).toBe(1);
  });

  test('classifies wrapped Google grounding redirect sources by the original source title domain', async () => {
    fetchMock
      .mockResolvedValueOnce(makeGeminiResponse(
        `COMPETITION_TYPE: domestic_league
HOME_MOTIVATION: No data found
AWAY_MOTIVATION: No data found
LEAGUE_POSITIONS: No data found
FIXTURE_CONGESTION: No data found
ROTATION_RISK: No data found
KEY_ABSENCES: No data found
H2H_NARRATIVE: No data found
SUMMARY: No data found
HOME_LAST5_POINTS: null
AWAY_LAST5_POINTS: null
HOME_LAST5_GOALS_FOR: null
AWAY_LAST5_GOALS_FOR: null
HOME_LAST5_GOALS_AGAINST: null
AWAY_LAST5_GOALS_AGAINST: null
HOME_HOME_GOALS_AVG: null
AWAY_AWAY_GOALS_AVG: null
HOME_OVER_2_5_RATE_LAST10: null
AWAY_OVER_2_5_RATE_LAST10: null
HOME_BTTS_RATE_LAST10: null
AWAY_BTTS_RATE_LAST10: null
HOME_CLEAN_SHEET_RATE_LAST10: null
AWAY_CLEAN_SHEET_RATE_LAST10: null
HOME_FAILED_TO_SCORE_RATE_LAST10: null
AWAY_FAILED_TO_SCORE_RATE_LAST10: null
ALERT_WINDOW_START: null
ALERT_WINDOW_END: null
PREFERRED_SCORE_STATE: any
PREFERRED_GOAL_STATE: any
FAVOURED_SIDE: none
ALERT_RATIONALE:
SEARCH_QUERIES: Arsenal Chelsea form
SOURCE_DOMAINS: fbref.com,premierleague.com`,
        {
          webSearchQueries: ['Arsenal Chelsea form'],
          groundingChunks: [
            { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'fbref.com' } },
            { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/def', title: 'premierleague.com' } },
          ],
        },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(JSON.stringify({
        qualitative_en: {
          home_motivation: 'No data found',
          away_motivation: 'No data found',
          league_positions: 'No data found',
          fixture_congestion: 'No data found',
          rotation_risk: 'No data found',
          key_absences: 'No data found',
          h2h_narrative: 'No data found',
          summary: 'No data found',
        },
        qualitative_vi: {
          home_motivation: 'Khong tim thay du lieu',
          away_motivation: 'Khong tim thay du lieu',
          league_positions: 'Khong tim thay du lieu',
          fixture_congestion: 'Khong tim thay du lieu',
          rotation_risk: 'Khong tim thay du lieu',
          key_absences: 'Khong tim thay du lieu',
          h2h_narrative: 'Khong tim thay du lieu',
          summary: 'Khong tim thay du lieu',
        },
        quantitative: {},
        competition_type: 'domestic_league',
        condition_blueprint: {
          alert_window_start: null,
          alert_window_end: null,
          preferred_score_state: 'any',
          preferred_goal_state: 'any',
          favoured_side: 'none',
          alert_rationale_en: '',
          alert_rationale_vi: '',
        },
      })));

    const context = await fetchStrategicContext('Arsenal', 'Chelsea', 'Premier League', '2026-03-21');

    expect(context?.source_meta.sources.map((source) => source.domain)).toEqual(['fbref.com', 'premierleague.com']);
    expect(context?.source_meta.trusted_source_count).toBe(2);
    expect(context?.source_meta.search_quality).toBe('high');
  });

  test('builds machine condition from structured blueprint safely', () => {
    expect(buildMachineConditionFromBlueprint({
      alert_window_start: 55,
      alert_window_end: null,
      preferred_score_state: 'not_away_leading',
      preferred_goal_state: 'goals_lte_1',
      favoured_side: 'home',
      alert_rationale_en: '',
      alert_rationale_vi: '',
    })).toBe('(Minute >= 55) AND (Total goals <= 1) AND (NOT Away leading)');
  });

  test('rejects invalid or too-thin blueprints', () => {
    expect(buildMachineConditionFromBlueprint({
      alert_window_start: null,
      alert_window_end: null,
      preferred_score_state: 'draw',
      preferred_goal_state: 'any',
      favoured_side: 'none',
      alert_rationale_en: '',
      alert_rationale_vi: '',
    })).toBe('');

    expect(buildMachineConditionFromBlueprint({
      alert_window_start: 55,
      alert_window_end: 50,
      preferred_score_state: 'draw',
      preferred_goal_state: 'any',
      favoured_side: 'none',
      alert_rationale_en: '',
      alert_rationale_vi: '',
    })).toBe('');
  });

  test('treats quantitative trusted context as usable even when narrative summary is poor', () => {
    const usable = hasUsableStrategicContext({
      summary: 'No data found',
      quantitative: {
        home_last5_points: 11,
        away_last5_points: 5,
        home_last5_goals_for: 8,
        away_last5_goals_for: 4,
        home_last5_goals_against: null,
        away_last5_goals_against: null,
        home_home_goals_avg: null,
        away_away_goals_avg: null,
        home_over_2_5_rate_last10: null,
        away_over_2_5_rate_last10: null,
        home_btts_rate_last10: null,
        away_btts_rate_last10: null,
        home_clean_sheet_rate_last10: null,
        away_clean_sheet_rate_last10: null,
        home_failed_to_score_rate_last10: null,
        away_failed_to_score_rate_last10: null,
      },
      source_meta: {
        search_quality: 'medium',
        web_search_queries: [],
        sources: [],
        trusted_source_count: 1,
        rejected_source_count: 0,
        rejected_domains: [],
      },
    });

    expect(usable).toBe(true);
  });
});
