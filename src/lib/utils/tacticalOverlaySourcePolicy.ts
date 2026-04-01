const TRUSTED_SOURCE_HOST_PATTERNS = [
  'fifa.com',
  'uefa.com',
  'the-afc.com',
  'cafonline.com',
  'concacaf.com',
  'ofcfootball.com',
  'premierleague.com',
  'laliga.com',
  'seriea.it',
  'bundesliga.com',
  'ligue1.com',
  'efl.com',
  'mlssoccer.com',
  'kleague.com',
  'portal.kleague.com',
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'theguardian.com',
  'aljazeera.com',
  'espn.com',
  'skysports.com',
  'theathletic.com',
  'nbcsports.com',
  'foxsports.com',
  'goal.com',
  'fbref.com',
  'soccerway.com',
  'transfermarkt.com',
  'transfermarkt.co.uk',
  'sofascore.com',
  'flashscore.com',
  'fotmob.com',
  'whoscored.com',
  'worldfootball.net',
] as const;

const REJECTED_SOURCE_PATTERNS = [
  'reddit.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'telegram.me',
  'blogspot.',
  'wordpress.',
  'medium.com',
  'substack.com',
  'tipster',
  'betting',
  'oddschecker',
  'freesupertips',
  'forum',
] as const;

function matchesTrustedHost(hostname: string): boolean {
  return TRUSTED_SOURCE_HOST_PATTERNS.some((candidate) =>
    hostname === candidate || hostname.endsWith(`.${candidate}`),
  ) || ['fotmob', 'flashscore', 'sofascore', 'transfermarkt', 'soccerway', 'whoscored', 'worldfootball']
    .some((brand) => hostname.includes(brand));
}

function isRejectedHost(hostname: string): boolean {
  return REJECTED_SOURCE_PATTERNS.some((pattern) => hostname.includes(pattern));
}

export function filterTrustedTacticalOverlaySourceUrls(values: unknown): {
  trusted: string[];
  dropped: string[];
} {
  if (!Array.isArray(values)) return { trusted: [], dropped: [] };

  const trusted = new Set<string>();
  const dropped = new Set<string>();

  for (const entry of values) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      const protocol = url.protocol.toLowerCase();
      const hostname = url.hostname.toLowerCase();
      if ((protocol !== 'https:' && protocol !== 'http:') || isRejectedHost(hostname) || !matchesTrustedHost(hostname)) {
        dropped.add(trimmed);
        continue;
      }
      trusted.add(url.toString());
    } catch {
      dropped.add(trimmed);
    }
  }

  return {
    trusted: [...trusted].slice(0, 12),
    dropped: [...dropped].slice(0, 12),
  };
}
