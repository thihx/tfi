// ==================== AUTHENTICATION ====================
const PASSWORD_HASH = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918'; // "admin"

// ==================== LEAGUE CODE MAPPING ====================
const LEAGUE_CODES = {
    // Top European Leagues
    39: 'ENG D1',      // Premier League
    40: 'ENG D2',      // Championship
    140: 'ESP D1',     // La Liga
    135: 'ITA D1',     // Serie A
    78: 'GER D1',      // Bundesliga
    61: 'FRA D1',      // Ligue 1
    
    // UEFA & Continental
    2: 'UCL',          // UEFA Champions League
    3: 'UEL',          // UEFA Europa League
    848: 'UECL',       // UEFA Conference League
    12: 'CAF CL',      // CAF Champions League
    
    // Major European
    94: 'POR D1',      // Primeira Liga
    88: 'NED D1',      // Eredivisie
    144: 'BEL D1',     // Jupiler Pro League
    203: 'TUR D1',     // Süper Lig
    113: 'SWE D1',     // Allsvenskan
    119: 'DEN D1',     // Superliga
    106: 'POL D1',     // Ekstraklasa
    103: 'NOR D1',     // Eliteserien
    210: 'CRO D1',     // HNL (Croatia)
    283: 'ROM D1',     // Liga I (Romania)
    345: 'CZE D1',     // Czech Liga
    286: 'SRB D1',     // Super Liga (Serbia)
    
    // Middle East & Gulf
    307: 'SAU D1',     // Pro League (Saudi Arabia)
    564: 'UAE D1',     // UAE Pro League
    202: 'QAT D1',     // Qatar Stars League
    
    // Asia-Pacific
    274: 'IND D1',     // Liga 1 (Indonesia)
    292: 'KOR D1',     // K League 1 (South Korea)
    252: 'JPN D1',     // J1 League (Japan)
    188: 'AUS D1',     // A-League (Australia)
    266: 'CHN D1',     // Chinese Super League
    271: 'THA D1',     // Thai League 1
    289: 'VIE D1',     // V.League 1 (Vietnam)
    
    // Americas
    71: 'BRA D1',      // Serie A (Brazil)
    128: 'ARG D1',     // Liga Profesional (Argentina)
    262: 'MEX D1',     // Liga MX (Mexico)
    253: 'USA D1',     // Major League Soccer (USA)
    242: 'COL D1',     // Liga BetPlay (Colombia)
    
    // Others
    235: 'RUS D1',     // Premier League (Russia)
    218: 'UKR D1',     // Premier League (Ukraine)
};

// NOTE: `getLeagueCode` helper removed — code now prefers `league_name` fields.

// ==================== TOP LEAGUES CONFIGURATION ====================
const TOP_LEAGUES = {
    // Tier 1 - Top 5 European Leagues + UEFA
    39: { name: 'Premier League', country: 'England', tier: 1 },
    140: { name: 'La Liga', country: 'Spain', tier: 1 },
    135: { name: 'Serie A', country: 'Italy', tier: 1 },
    78: { name: 'Bundesliga', country: 'Germany', tier: 1 },
    61: { name: 'Ligue 1', country: 'France', tier: 1 },
    2: { name: 'UEFA Champions League', country: 'Europe', tier: 1 },
    3: { name: 'UEFA Europa League', country: 'Europe', tier: 1 },
    
    // Tier 2 - Major European + Top South America
    94: { name: 'Primeira Liga', country: 'Portugal', tier: 2 },
    88: { name: 'Eredivisie', country: 'Netherlands', tier: 2 },
    144: { name: 'Jupiler Pro League', country: 'Belgium', tier: 2 },
    203: { name: 'Süper Lig', country: 'Turkey', tier: 2 },
    71: { name: 'Serie A', country: 'Brazil', tier: 2 },
    128: { name: 'Liga Profesional', country: 'Argentina', tier: 2 },
    848: { name: 'UEFA Conference League', country: 'Europe', tier: 2 },
    
    // Tier 3 - Secondary
    262: { name: 'Liga MX', country: 'Mexico', tier: 3 },
    253: { name: 'Major League Soccer', country: 'USA', tier: 3 },
    307: { name: 'Pro League', country: 'Saudi Arabia', tier: 3 },
    252: { name: 'J1 League', country: 'Japan', tier: 3 },
    235: { name: 'Premier League', country: 'Russia', tier: 3 },
};

const LEAGUE_TIERS = {
    tier1: [39, 140, 135, 78, 61, 2, 3],
    tier2: [94, 88, 144, 203, 71, 128, 848],
    tier3: [262, 253, 307, 252, 235],
};

// ==================== STATUS BADGES ====================
const STATUS_BADGES = {
    'NS': { label: '⏱️ Not Started', class: 'badge-ns' },
    'FT': { label: 'Finished', class: 'badge-ft' },
    '1H': { label: '● 1st Half', class: 'badge-live' },
    '2H': { label: '● 2nd Half', class: 'badge-live' },
    'HT': { label: 'Half Time', class: 'badge-pending' },
    'ET': { label: '● Extra Time', class: 'badge-live' },
    'P': { label: '● Penalties', class: 'badge-live' },
    'LIVE': { label: '● LIVE', class: 'badge-live' },
    'INT': { label: 'Interrupted', class: 'badge-pending' },
    'PST': { label: 'Postponed', class: 'badge-pending' },
    'CANC': { label: 'Cancelled', class: 'badge-pending' },
    'ABD': { label: 'Abandoned', class: 'badge-pending' },
    'SUSP': { label: 'Suspended', class: 'badge-pending' },
    'AWD': { label: 'Awarded', class: 'badge-ft' },
};

const LIVE_STATUSES = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'];

// ==================== SVG PLACEHOLDERS ====================
const PLACEHOLDER_HOME = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22%3E%3Crect fill=%22%23e5e7eb%22 width=%2224%22 height=%2224%22 rx=%224%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2212%22 font-weight=%22bold%22 fill=%22%23374151%22%3EH%3C/text%3E%3C/svg%3E';

const PLACEHOLDER_AWAY = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22%3E%3Crect fill=%22%23e5e7eb%22 width=%2224%22 height=%2224%22 rx=%224%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2212%22 font-weight=%22bold%22 fill=%22%23374151%22%3EA%3C/text%3E%3C/svg%3E';
