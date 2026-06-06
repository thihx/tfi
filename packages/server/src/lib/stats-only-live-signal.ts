export type StatsOnlySignalType =
  | 'zero_zero_pressure_after_55'
  | 'red_card_state'
  | 'late_goal_after_75'
  | 'pressure_no_lead'
  | 'corner_pressure';

export type StatsOnlySignalStrength = 'medium' | 'high';

export interface StatsOnlySideValues {
  home?: unknown;
  away?: unknown;
}

export interface StatsOnlyLiveSignalInput {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  minute: number;
  status: string;
  score: {
    home: number;
    away: number;
  };
  stats: {
    shots?: StatsOnlySideValues;
    shots_on_target?: StatsOnlySideValues;
    corners?: StatsOnlySideValues;
    red_cards?: StatsOnlySideValues;
  };
  events: Array<{
    minute: number;
    team?: string;
    type?: string;
    detail?: string;
  }>;
  oddsAvailable: boolean;
  referenceMarketKeys?: string[];
}

export interface StatsOnlyLiveSignalResult {
  triggered: boolean;
  signalType: StatsOnlySignalType | null;
  strength: StatsOnlySignalStrength | null;
  triggerKey: string | null;
  summaryEn: string;
  summaryVi: string;
  suggestedAction: 'review_live_market' | 'avoid_chasing';
  marketFamilyHint: string | null;
  reasons: string[];
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace('%', '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function sideNumber(values: StatsOnlySideValues | undefined, side: 'home' | 'away'): number {
  return toNumber(values?.[side]);
}

function total(values: StatsOnlySideValues | undefined): number {
  return sideNumber(values, 'home') + sideNumber(values, 'away');
}

function scoreState(score: { home: number; away: number }): 'draw' | 'home_leading' | 'away_leading' {
  if (score.home > score.away) return 'home_leading';
  if (score.away > score.home) return 'away_leading';
  return 'draw';
}

function minuteBucket(minute: number): number {
  return Math.max(0, Math.floor(minute / 10) * 10);
}

function buildTriggerKey(
  input: StatsOnlyLiveSignalInput,
  signalType: StatsOnlySignalType,
  bucketOrEventMinute: number,
): string {
  return [
    'stats_only',
    signalType,
    input.matchId,
    `${input.score.home}-${input.score.away}`,
    bucketOrEventMinute,
  ].join(':');
}

function referenceText(keys: string[] | undefined): string {
  if (!keys || keys.length === 0) return 'No usable live odds are available.';
  return `No usable live odds are available; pre-match reference markets exist (${keys.slice(0, 4).join(', ')}).`;
}

function makeResult(args: {
  input: StatsOnlyLiveSignalInput;
  signalType: StatsOnlySignalType;
  strength: StatsOnlySignalStrength;
  bucketOrEventMinute: number;
  marketFamilyHint: string;
  reasons: string[];
  suggestedAction?: 'review_live_market' | 'avoid_chasing';
  summaryCoreEn: string;
  summaryCoreVi: string;
}): StatsOnlyLiveSignalResult {
  return {
    triggered: true,
    signalType: args.signalType,
    strength: args.strength,
    triggerKey: buildTriggerKey(args.input, args.signalType, args.bucketOrEventMinute),
    summaryEn: `${args.summaryCoreEn} ${referenceText(args.input.referenceMarketKeys)} Check the live market before staking.`,
    summaryVi: `${args.summaryCoreVi} Khong co live odds usable; chi xem day la tin hieu theo doi va can kiem tra live market truoc khi vao tien.`,
    suggestedAction: args.suggestedAction ?? 'review_live_market',
    marketFamilyHint: args.marketFamilyHint,
    reasons: args.reasons,
  };
}

export function evaluateStatsOnlyLiveSignal(input: StatsOnlyLiveSignalInput): StatsOnlyLiveSignalResult {
  if (input.oddsAvailable) {
    return {
      triggered: false,
      signalType: null,
      strength: null,
      triggerKey: null,
      summaryEn: 'Live odds are available; use the actionable recommendation path.',
      summaryVi: 'Live odds dang co; dung luong actionable recommendation.',
      suggestedAction: 'review_live_market',
      marketFamilyHint: null,
      reasons: ['live_odds_available'],
    };
  }

  const minute = Number.isFinite(input.minute) ? input.minute : 0;
  const scoreTotal = input.score.home + input.score.away;
  const cornersTotal = total(input.stats.corners);
  const shotsTotal = total(input.stats.shots);
  const sotHome = sideNumber(input.stats.shots_on_target, 'home');
  const sotAway = sideNumber(input.stats.shots_on_target, 'away');
  const sotTotal = sotHome + sotAway;
  const redsHome = sideNumber(input.stats.red_cards, 'home');
  const redsAway = sideNumber(input.stats.red_cards, 'away');
  const redEvent = input.events.find((event) =>
    String(event.type ?? '').toLowerCase() === 'card'
    && String(event.detail ?? '').toLowerCase().includes('red')
  );
  const goalEvents = input.events
    .filter((event) => String(event.type ?? '').toLowerCase() === 'goal')
    .sort((left, right) => right.minute - left.minute);
  const latestGoal = goalEvents[0];
  const state = scoreState(input.score);
  const homeSotDiff = sotHome - sotAway;
  const awaySotDiff = sotAway - sotHome;

  if (redsHome + redsAway > 0 || redEvent) {
    const eventMinute = redEvent?.minute ?? minuteBucket(minute);
    return makeResult({
      input,
      signalType: 'red_card_state',
      strength: 'high',
      bucketOrEventMinute: eventMinute,
      marketFamilyHint: 'cards_state',
      reasons: [`red_cards_home=${redsHome}`, `red_cards_away=${redsAway}`, redEvent ? `red_event_minute=${eventMinute}` : 'red_card_from_stats'],
      summaryCoreEn: `Stats-only live signal: red-card state in ${input.homeTeam} vs ${input.awayTeam}.`,
      summaryCoreVi: `Tin hieu live stats-only: tran ${input.homeTeam} vs ${input.awayTeam} co trang thai the do.`,
    });
  }

  if (latestGoal && latestGoal.minute >= 75) {
    return makeResult({
      input,
      signalType: 'late_goal_after_75',
      strength: 'medium',
      bucketOrEventMinute: latestGoal.minute,
      marketFamilyHint: 'goals_ou',
      reasons: [`latest_goal_minute=${latestGoal.minute}`, `score=${input.score.home}-${input.score.away}`],
      suggestedAction: 'avoid_chasing',
      summaryCoreEn: `Stats-only live signal: late goal after 75' in ${input.homeTeam} vs ${input.awayTeam}.`,
      summaryCoreVi: `Tin hieu live stats-only: co ban thang muon sau phut 75 trong tran ${input.homeTeam} vs ${input.awayTeam}.`,
    });
  }

  if (minute >= 55 && scoreTotal === 0 && (cornersTotal >= 8 || sotTotal >= 5 || shotsTotal >= 18)) {
    return makeResult({
      input,
      signalType: 'zero_zero_pressure_after_55',
      strength: cornersTotal >= 8 && sotTotal >= 5 ? 'high' : 'medium',
      bucketOrEventMinute: minuteBucket(minute),
      marketFamilyHint: 'goals_ou',
      reasons: [`minute=${minute}`, 'score=0-0', `corners_total=${cornersTotal}`, `sot_total=${sotTotal}`, `shots_total=${shotsTotal}`],
      summaryCoreEn: `Stats-only live signal: 0-0 after 55' with pressure in ${input.homeTeam} vs ${input.awayTeam}.`,
      summaryCoreVi: `Tin hieu live stats-only: 0-0 sau phut 55 nhung ap luc dang cao trong tran ${input.homeTeam} vs ${input.awayTeam}.`,
    });
  }

  if (minute >= 25 && homeSotDiff >= 3 && state !== 'home_leading') {
    return makeResult({
      input,
      signalType: 'pressure_no_lead',
      strength: 'medium',
      bucketOrEventMinute: minuteBucket(minute),
      marketFamilyHint: 'side_pressure',
      reasons: [`home_sot=${sotHome}`, `away_sot=${sotAway}`, `state=${state}`],
      summaryCoreEn: `Stats-only live signal: ${input.homeTeam} pressure is clear but they are not leading.`,
      summaryCoreVi: `Tin hieu live stats-only: ${input.homeTeam} dang ep ro nhung chua dan.`,
    });
  }

  if (minute >= 25 && awaySotDiff >= 3 && state !== 'away_leading') {
    return makeResult({
      input,
      signalType: 'pressure_no_lead',
      strength: 'medium',
      bucketOrEventMinute: minuteBucket(minute),
      marketFamilyHint: 'side_pressure',
      reasons: [`away_sot=${sotAway}`, `home_sot=${sotHome}`, `state=${state}`],
      summaryCoreEn: `Stats-only live signal: ${input.awayTeam} pressure is clear but they are not leading.`,
      summaryCoreVi: `Tin hieu live stats-only: ${input.awayTeam} dang ep ro nhung chua dan.`,
    });
  }

  if (minute <= 60 && cornersTotal >= 7) {
    return makeResult({
      input,
      signalType: 'corner_pressure',
      strength: 'medium',
      bucketOrEventMinute: minuteBucket(minute),
      marketFamilyHint: 'corners_ou',
      reasons: [`minute=${minute}`, `corners_total=${cornersTotal}`],
      summaryCoreEn: `Stats-only live signal: high corner pressure in ${input.homeTeam} vs ${input.awayTeam}.`,
      summaryCoreVi: `Tin hieu live stats-only: ap luc phat goc cao trong tran ${input.homeTeam} vs ${input.awayTeam}.`,
    });
  }

  return {
    triggered: false,
    signalType: null,
    strength: null,
    triggerKey: null,
    summaryEn: 'No strong deterministic stats-only signal.',
    summaryVi: 'Chua co tin hieu stats-only du manh.',
    suggestedAction: 'review_live_market',
    marketFamilyHint: null,
    reasons: [
      `minute=${minute}`,
      `score=${input.score.home}-${input.score.away}`,
      `corners_total=${cornersTotal}`,
      `sot_total=${sotTotal}`,
      `shots_total=${shotsTotal}`,
    ],
  };
}

