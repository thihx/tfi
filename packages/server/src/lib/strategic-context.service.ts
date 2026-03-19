// ============================================================
// Strategic Context Service — Gemini + Google Search Grounding
//
// Researches pre-match strategic intelligence:
// - Team motivation (relegation battle, title race, mid-table comfort)
// - Fixture congestion (Champions League, cup matches coming up)
// - Squad rotation signals (rest key players for bigger game)
// - Key injuries / suspensions
// - Recent manager changes
// ============================================================

import { config } from '../config.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 60_000;

export interface StrategicContext {
  home_motivation: string;
  away_motivation: string;
  league_positions: string;
  fixture_congestion: string;
  rotation_risk: string;
  key_absences: string;
  h2h_narrative: string;
  summary: string;
  searched_at: string;
  competition_type?: string;
  ai_condition?: string;
  ai_condition_reason?: string;
  ai_condition_reason_vi?: string;
}

/**
 * Use Gemini with Google Search grounding to research match strategic context.
 * Returns null if API key is missing or the request fails.
 */
export async function fetchStrategicContext(
  homeTeam: string,
  awayTeam: string,
  league: string,
  matchDate: string | null,
): Promise<StrategicContext | null> {
  if (!config.geminiApiKey) {
    console.warn('[strategic-context] GEMINI_API_KEY not configured, skipping');
    return null;
  }

  const dateStr = matchDate || 'upcoming';
  const prompt = buildResearchPrompt(homeTeam, awayTeam, league, dateStr);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(`${GEMINI_BASE}/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[strategic-context] Gemini API error ${response.status}: ${errText.substring(0, 300)}`);
      return null;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn('[strategic-context] Empty response from Gemini');
      return null;
    }

    return parseStrategicResponse(text);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[strategic-context] Request timed out');
    } else {
      console.error('[strategic-context] Error:', err instanceof Error ? err.message : err);
    }
    return null;
  }
}

function buildResearchPrompt(homeTeam: string, awayTeam: string, league: string, dateStr: string): string {
  return `You are a football research analyst. Research the upcoming match: ${homeTeam} vs ${awayTeam} in ${league} (${dateStr}).

Use Google Search to find CURRENT information and answer these questions concisely:

1. HOME_MOTIVATION: What is ${homeTeam}'s current situation? (title race, relegation battle, European qualification, mid-table with nothing to play for, already safe/relegated?)
2. AWAY_MOTIVATION: What is ${awayTeam}'s current situation? Same criteria as above.
3. LEAGUE_POSITIONS: Current league table positions for BOTH teams IN THEIR RESPECTIVE DOMESTIC LEAGUES. Format: "${homeTeam}: Xth in [League Name] (W-D-L, pts), ${awayTeam}: Yth in [League Name] (W-D-L, pts)". Include the league name. If not found, say "No data found".
4. FIXTURE_CONGESTION: Does either team have a major match coming up soon (Champions League, Europa League, domestic cup final/semi)? If so, which team and when?
5. ROTATION_RISK: Based on fixture congestion and current situation, is either team likely to rotate/rest key players for THIS match? (e.g., resting stars for a Champions League game mid-week)
6. KEY_ABSENCES: Any confirmed injuries or suspensions for key players on either team?
7. H2H_NARRATIVE: What is the recent head-to-head trend between these teams? (last 3-5 meetings)
8. COMPETITION_TYPE: Is "${league}" a domestic league, domestic cup, or international/European competition? Answer exactly ONE of: "domestic_league", "domestic_cup", "european", "international", "friendly".

CRITICAL: Only report VERIFIED, CURRENT season information. If you cannot find reliable info for a field, say "No data found".

============================================================
CONDITION GENERATION TASK
============================================================
Based on ALL the research above, generate ONE monitoring condition expression for a live match monitor.
This condition decides WHEN to alert the user for deeper analysis during the match.

IMPORTANT RULES:
- For EUROPEAN/INTERNATIONAL competitions (COMPETITION_TYPE = european/international/friendly):
  The two teams play in DIFFERENT domestic leagues. Their domestic league positions CANNOT be compared!
  Do NOT use league position gap as a signal. Focus instead on: team motivation, form, H2H, fixture congestion, key absences, and overall team quality.
- For DOMESTIC LEAGUE matches: league positions within the SAME league ARE meaningful.
- The condition will be PARSED and EVALUATED by code. It must use ONLY the allowed format below.

ALLOWED ATOMIC CONDITIONS (STRICT — only these):
- (Minute >= N), (Minute <= N)
- (Total goals <= N), (Total goals >= N)
- (Draw), (Home leading), (Away leading)
- (NOT Home leading), (NOT Away leading)

Combine atoms with AND. Use 2-5 atoms total. Each atom must be wrapped in parentheses.
The condition MUST start with "(".

EXAMPLES of good conditions:
- "(Minute >= 60) AND (NOT Home leading)" — alert if favourite hasn't taken lead by 60'
- "(Minute >= 45) AND (Total goals <= 0)" — alert if still goalless at halftime
- "(Minute >= 70) AND (Total goals >= 2) AND (NOT Away leading)" — multi-signal alert

QUALITY RULES:
- Choose minute thresholds that make strategic sense based on the match context.
- Do NOT generate trivially obvious or generic conditions.
- If there is insufficient data for a meaningful condition, set AI_CONDITION to empty.
- The "reason" fields should explain WHY you chose this specific condition, referencing actual research findings.

Respond in this EXACT format (one line per field):
HOME_MOTIVATION: [answer]
AWAY_MOTIVATION: [answer]
LEAGUE_POSITIONS: [answer]
FIXTURE_CONGESTION: [answer]
ROTATION_RISK: [answer]
KEY_ABSENCES: [answer]
H2H_NARRATIVE: [answer]
COMPETITION_TYPE: [domestic_league|domestic_cup|european|international|friendly]
SUMMARY: [1-2 sentence overall strategic assessment for betting context]
AI_CONDITION: [evaluable condition expression starting with "(", or empty if insufficient data]
AI_CONDITION_REASON: [English reason for the condition, 1-2 sentences, referencing specific data points]
AI_CONDITION_REASON_VI: [Vietnamese translation of the reason]`;
}

function parseStrategicResponse(text: string): StrategicContext {
  const extract = (field: string): string => {
    const regex = new RegExp(`${field}:\\s*(.+?)(?=\\n[A-Z_]+:|$)`, 's');
    const match = text.match(regex);
    return (match?.[1] || 'No data found').trim();
  };

  const noData = (v: string) => !v || v === 'No data found';
  const aiCond = extract('AI_CONDITION');
  const aiCondReason = extract('AI_CONDITION_REASON');
  const aiCondReasonVi = extract('AI_CONDITION_REASON_VI');

  return {
    home_motivation: extract('HOME_MOTIVATION'),
    away_motivation: extract('AWAY_MOTIVATION'),
    league_positions: extract('LEAGUE_POSITIONS'),
    fixture_congestion: extract('FIXTURE_CONGESTION'),
    rotation_risk: extract('ROTATION_RISK'),
    key_absences: extract('KEY_ABSENCES'),
    h2h_narrative: extract('H2H_NARRATIVE'),
    competition_type: extract('COMPETITION_TYPE').replace(/["']/g, '').toLowerCase(),
    summary: extract('SUMMARY'),
    ai_condition: noData(aiCond) ? '' : aiCond,
    ai_condition_reason: noData(aiCondReason) ? '' : aiCondReason,
    ai_condition_reason_vi: noData(aiCondReasonVi) ? '' : aiCondReasonVi,
    searched_at: new Date().toISOString(),
  };
}
