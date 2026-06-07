/** Extra searchable names for provider pages that use sponsor or legacy labels. Keys are normalized API names. */
export const LIVE_STREAM_TEAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'binh duong': ['becamex ho chi minh city', 'becamex binh duong'],
  'china': ['trung quoc'],
  'cong an nhan dan': ['cong an ha noi', 'cong an ha noi fc', 'cong an ho chi minh city'],
  'cyprus': ['dao sip', 'dao si'],
  'dao sip': ['cyprus'],
  'da nang': ['shb da nang'],
  'hai phong': ['xm hai phong', 'xm hai phong fc'],
  'ha noi': ['hanoi fc'],
  'han quoc': ['korea republic', 'south korea', 'korea'],
  'ho chi minh': ['cong an ho chi minh city', 'becamex ho chi minh city'],
  'hong linh ha tinh': ['hl ha tinh'],
  'japan': ['nhat ban'],
  'korea republic': ['han quoc', 'south korea', 'korea'],
  'myanmar': ['mien dien', 'burma'],
  'nam dinh': ['thep xanh nam dinh', 'thep xanh nam dinh fc'],
  'ninh binh': ['phu dong'],
  'nhat ban': ['japan'],
  'pho hien': ['pvf cand', 'pvf-cand', 'pvf cand fc'],
  'phu dong': ['ninh binh', 'ninh binh fc'],
  'pvf cand': ['pho hien'],
  'south korea': ['han quoc', 'korea republic', 'korea'],
  'thailand': ['thai lan'],
  'the cong viettel': ['viettel'],
  'thai lan': ['thailand'],
  'timor leste': ['timor-leste', 'dong timor', 'timor leste u19'],
  'timor-leste': ['timor leste', 'dong timor'],
  'trung quoc': ['china'],
  'usa': ['my', 'hoa ky', 'united states'],
  'vietnam u19': ['viet nam u19'],
  'viet nam u19': ['vietnam u19'],
  'vietnam u20': ['viet nam u20'],
  'viet nam u20': ['vietnam u20'],
  'vietnam u23': ['viet nam u23'],
  'viet nam u23': ['vietnam u23'],
  'vietnam': ['viet nam'],
  'viet nam': ['vietnam'],
  'viettel': ['the cong viettel', 'the cong'],
};

const YOUTH_SUFFIXES = ['u17', 'u18', 'u19', 'u20', 'u21', 'u22', 'u23'] as const;

function appendYouthAndWomenVariants(aliases: string[]): string[] {
  const out = new Set(aliases);
  for (const alias of aliases) {
    for (const suffix of YOUTH_SUFFIXES) {
      const spaced = ` ${suffix}`;
      if (alias.endsWith(spaced)) {
        const base = alias.slice(0, -spaced.length).trim();
        if (base.includes('vietnam')) out.add(`${base.replace('vietnam', 'viet nam')}${spaced}`);
        if (base.includes('viet nam')) out.add(`${base.replace('viet nam', 'vietnam')}${spaced}`);
        if (base.includes('timor leste')) out.add(`${base.replace('timor leste', 'timor-leste')}${spaced}`);
        if (base.includes('timor-leste')) out.add(`${base.replace('timor-leste', 'timor leste')}${spaced}`);
      }
    }
    if (alias.endsWith(' women')) out.add(alias.replace(/ women$/, ''));
    if (alias.endsWith(' w')) out.add(alias.replace(/ w$/, ''));
  }
  return [...out];
}

export function expandTeamAliases(normalizedTeamName: string, baseAliases: string[]): string[] {
  const extras = LIVE_STREAM_TEAM_ALIASES[normalizedTeamName] ?? [];
  const reverseExtras = Object.keys(LIVE_STREAM_TEAM_ALIASES).filter((canonical) => (
    (LIVE_STREAM_TEAM_ALIASES[canonical] ?? []).includes(normalizedTeamName)
  ));
  return appendYouthAndWomenVariants([...baseAliases, ...extras, ...reverseExtras]);
}