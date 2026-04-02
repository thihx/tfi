export interface TacticalOverlaySourceCatalogEntry {
  preferredDomains: string[];
  researchFocus: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function getTacticalOverlaySourceCatalog(leagueName?: string): TacticalOverlaySourceCatalogEntry {
  const normalized = String(leagueName ?? '').trim().toLowerCase();

  if (normalized.includes('premier league')) {
    return {
      preferredDomains: unique(['premierleague.com', 'bbc.com', 'skysports.com', 'theathletic.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com']),
      researchFocus: unique(['pressing shape', 'rest defence', 'rotation risk', 'full-back roles', 'bench depth']),
    };
  }
  if (normalized.includes('la liga')) {
    return {
      preferredDomains: unique(['laliga.com', 'marca.com', 'as.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com']),
      researchFocus: unique(['build-up style', 'wing usage', 'pressing intensity', 'coach tactical setup', 'rotation risk']),
    };
  }
  if (normalized.includes('serie a')) {
    return {
      preferredDomains: unique(['seriea.it', 'gazzetta.it', 'corrieredellosport.it', 'fbref.com', 'fotmob.com', 'transfermarkt.com']),
      researchFocus: unique(['block height', 'counter threat', 'set-piece structure', 'back-three or back-four setup', 'rotation risk']),
    };
  }
  if (normalized.includes('bundesliga')) {
    return {
      preferredDomains: unique(['bundesliga.com', 'kicker.de', 'sportschau.de', 'fbref.com', 'fotmob.com', 'transfermarkt.com']),
      researchFocus: unique(['pressing intensity', 'transition pace', 'verticality', 'wide overloads', 'rotation risk']),
    };
  }
  if (normalized.includes('ligue 1')) {
    return {
      preferredDomains: unique(['ligue1.com', 'lequipe.fr', 'rmcsport.bfmtv.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com']),
      researchFocus: unique(['transition style', 'defensive line', 'pressing intensity', 'bench depth', 'rotation risk']),
    };
  }
  if (normalized.includes('j1')) {
    return {
      preferredDomains: unique(['jleague.co', 'jleague.jp', 'soccerdigestweb.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com']),
      researchFocus: unique(['build-up structure', 'pressing intensity', 'full-back involvement', 'bench depth', 'rotation risk']),
    };
  }
  if (normalized.includes('a-league')) {
    return {
      preferredDomains: unique(['aleagues.com.au', 'fbref.com', 'fotmob.com', 'transfermarkt.com', 'theathletic.com']),
      researchFocus: unique(['transition style', 'pressing intensity', 'defensive line', 'rotation risk', 'bench depth']),
    };
  }
  if (normalized.includes('champions league') || normalized.includes('europa') || normalized.includes('conference league')) {
    return {
      preferredDomains: unique(['uefa.com', 'theathletic.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com']),
      researchFocus: unique(['continental matchup tactical style', 'rotation around European fixtures', 'pressing intensity', 'defensive line', 'bench depth']),
    };
  }

  return {
    preferredDomains: unique(['fbref.com', 'fotmob.com', 'transfermarkt.com', 'soccerway.com', 'sofascore.com']),
    researchFocus: unique(['attack style', 'defensive line', 'pressing intensity', 'squad depth', 'rotation risk']),
  };
}
