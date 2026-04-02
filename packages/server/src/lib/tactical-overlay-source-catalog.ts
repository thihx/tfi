import {
  classifyTacticalOverlayCompetition,
  type TacticalOverlayCompetitionClassification,
  type TacticalOverlayCompetitionInput,
} from './tactical-overlay-eligibility.js';

export interface TacticalOverlaySourceCatalogEntry {
  preferredDomains: string[];
  researchFocus: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildCatalogEntry(preferredDomains: string[], researchFocus: string[]): TacticalOverlaySourceCatalogEntry {
  return {
    preferredDomains: unique(preferredDomains),
    researchFocus: unique(researchFocus),
  };
}

function getSpecificLeagueCatalog(leagueName: string): TacticalOverlaySourceCatalogEntry | null {
  const normalized = leagueName.trim().toLowerCase();

  if (normalized.includes('premier league')) {
    return buildCatalogEntry(
      ['premierleague.com', 'bbc.com', 'skysports.com', 'theathletic.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com'],
      ['pressing shape', 'rest defence', 'rotation risk', 'full-back roles', 'bench depth'],
    );
  }
  if (normalized.includes('la liga')) {
    return buildCatalogEntry(
      ['laliga.com', 'marca.com', 'as.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com'],
      ['build-up style', 'wing usage', 'pressing intensity', 'coach tactical setup', 'rotation risk'],
    );
  }
  if (normalized.includes('serie a')) {
    return buildCatalogEntry(
      ['seriea.it', 'gazzetta.it', 'corrieredellosport.it', 'fbref.com', 'fotmob.com', 'transfermarkt.com'],
      ['block height', 'counter threat', 'set-piece structure', 'back-three or back-four setup', 'rotation risk'],
    );
  }
  if (normalized.includes('bundesliga')) {
    return buildCatalogEntry(
      ['bundesliga.com', 'kicker.de', 'sportschau.de', 'fbref.com', 'fotmob.com', 'transfermarkt.com'],
      ['pressing intensity', 'transition pace', 'verticality', 'wide overloads', 'rotation risk'],
    );
  }
  if (normalized.includes('ligue 1')) {
    return buildCatalogEntry(
      ['ligue1.com', 'lequipe.fr', 'rmcsport.bfmtv.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com'],
      ['transition style', 'defensive line', 'pressing intensity', 'bench depth', 'rotation risk'],
    );
  }
  if (normalized.includes('championship')) {
    return buildCatalogEntry(
      ['efl.com', 'bbc.com', 'skysports.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com'],
      ['direct play', 'cross volume tendency', 'set-piece threat', 'rotation pressure', 'pressing intensity'],
    );
  }
  if (normalized.includes('j1')) {
    return buildCatalogEntry(
      ['jleague.co', 'jleague.jp', 'soccerdigestweb.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com'],
      ['build-up structure', 'pressing intensity', 'full-back involvement', 'bench depth', 'rotation risk'],
    );
  }
  if (normalized.includes('a-league')) {
    return buildCatalogEntry(
      ['aleagues.com.au', 'fbref.com', 'fotmob.com', 'transfermarkt.com', 'theathletic.com'],
      ['transition style', 'pressing intensity', 'defensive line', 'rotation risk', 'bench depth'],
    );
  }
  if (normalized.includes('women')) {
    return buildCatalogEntry(
      ['uefa.com', 'fifa.com', 'thefa.com', 'fff.fr', 'dfb.de', 'fbref.com', 'fotmob.com', 'transfermarkt.com'],
      ['pressing structure', 'build-up shape', 'wide overloads', 'rotation resilience', 'tactical continuity'],
    );
  }

  return null;
}

function getFallbackCatalog(classification: TacticalOverlayCompetitionClassification): TacticalOverlaySourceCatalogEntry {
  if (classification.competitionKind === 'continental_club') {
    return buildCatalogEntry(
      ['uefa.com', 'the-afc.com', 'concacaf.com', 'cafonline.com', 'fifa.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com'],
      ['matchup-specific tactical style', 'rotation around continental fixtures', 'pressing intensity', 'defensive line', 'bench depth'],
    );
  }
  if (classification.competitionKind === 'international_tournament') {
    return buildCatalogEntry(
      ['fifa.com', 'uefa.com', 'the-afc.com', 'concacaf.com', 'cafonline.com', 'ofcfootball.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com'],
      ['national-team tactical identity', 'pressing intensity', 'defensive line', 'bench depth', 'coach setup continuity'],
    );
  }
  if (classification.competitionKind === 'international_qualifier') {
    return buildCatalogEntry(
      ['fifa.com', 'uefa.com', 'the-afc.com', 'concacaf.com', 'cafonline.com', 'ofcfootball.com', 'fbref.com', 'fotmob.com', 'transfermarkt.com'],
      ['qualifier tactical setup', 'rotation pressure', 'defensive line', 'pressing intensity', 'bench depth'],
    );
  }
  return buildCatalogEntry(
    ['fbref.com', 'fotmob.com', 'transfermarkt.com', 'soccerway.com', 'sofascore.com'],
    ['attack style', 'defensive line', 'pressing intensity', 'squad depth', 'rotation risk'],
  );
}

export function getTacticalOverlaySourceCatalog(
  input: TacticalOverlayCompetitionInput,
): TacticalOverlaySourceCatalogEntry & { classification: TacticalOverlayCompetitionClassification } {
  const classification = classifyTacticalOverlayCompetition(input);
  const specific = getSpecificLeagueCatalog(input.leagueName);
  const fallback = getFallbackCatalog(classification);

  return {
    classification,
    preferredDomains: unique([...(specific?.preferredDomains ?? []), ...fallback.preferredDomains]),
    researchFocus: unique([...(specific?.researchFocus ?? []), ...fallback.researchFocus]),
  };
}
