/** System / pipeline warning codes — not shown on Matches analysis panel. */
const TECHNICAL_WARNING = /^[A-Z0-9_]+$/;

const TECHNICAL_WARNING_PREFIX = /^(POLICY_BLOCK_|MEMORY_|NO_SELECTION|NO_BET_MARKET|ODDS_|MARKET_|STATUS_|MINUTE_|PARSE_|JSON_|ADVISORY_ONLY|PREMATCH_|LOW_EVIDENCE_|THESIS_|FORCE_MODE|EDGE_OK)/;

export function isTechnicalWarning(warning: string): boolean {
  const text = warning.trim();
  if (!text) return true;
  if (TECHNICAL_WARNING.test(text)) return true;
  if (TECHNICAL_WARNING_PREFIX.test(text)) return true;
  return false;
}

export function filterUserFacingWarnings(warnings: string[] | undefined | null): string[] {
  if (!warnings?.length) return [];
  return warnings.map((w) => w.trim()).filter((w) => w.length > 0 && !isTechnicalWarning(w));
}

export function pickAnalysisReasoning(
  reasoningVi: string | undefined | null,
  reasoningEn: string | undefined | null,
  language: 'en' | 'vi',
): string {
  if (language === 'vi') return (reasoningVi || reasoningEn || '').trim();
  return (reasoningEn || reasoningVi || '').trim();
}