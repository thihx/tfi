/** Extra searchable names for provider pages that use sponsor or legacy labels. Keys are normalized API names. */
export const LIVE_STREAM_TEAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'binh duong': ['becamex ho chi minh city', 'becamex binh duong'],
  'cong an nhan dan': ['cong an ha noi', 'cong an ha noi fc', 'cong an ho chi minh city'],
  'da nang': ['shb da nang'],
  'hai phong': ['xm hai phong', 'xm hai phong fc'],
  'ha noi': ['hanoi fc'],
  'ho chi minh': ['cong an ho chi minh city', 'becamex ho chi minh city'],
  'hong linh ha tinh': ['hl ha tinh'],
  'nam dinh': ['thep xanh nam dinh', 'thep xanh nam dinh fc'],
  'ninh binh': ['phu dong'],
  'pho hien': ['pvf cand', 'pvf-cand', 'pvf cand fc'],
  'phu dong': ['ninh binh', 'ninh binh fc'],
  'pvf cand': ['pho hien'],
  'the cong viettel': ['viettel'],
  'viettel': ['the cong viettel', 'the cong'],
};

export function expandTeamAliases(normalizedTeamName: string, baseAliases: string[]): string[] {
  const extras = LIVE_STREAM_TEAM_ALIASES[normalizedTeamName] ?? [];
  const reverseExtras = Object.keys(LIVE_STREAM_TEAM_ALIASES).filter((canonical) => (
    (LIVE_STREAM_TEAM_ALIASES[canonical] ?? []).includes(normalizedTeamName)
  ));
  return [...baseAliases, ...extras, ...reverseExtras];
}