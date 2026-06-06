import { query } from '../db/pool.js';
import { buildMatchStartRuleJson, SYSTEM_CONDITION_ALERT_PRESETS } from '../lib/match-alert-presets.js';
import type { MatchAlertKind } from '../lib/match-alert-rule-engine.js';

export interface UserMatchAlertSettings {
  matchStartEnabled: boolean;
  manualMatchStartEnabled: boolean;
  favoriteTeamMatchStartEnabled: boolean;
  favoriteLeagueMatchStartEnabled: boolean;
  conditionAlertsEnabled: boolean;
  favoriteTeamConditionAlertsEnabled: boolean;
  favoriteLeagueConditionAlertsEnabled: boolean;
  kickoffLeadMinutes: number;
  defaultCooldownMinutes: number;
  channelPolicy: Record<string, unknown>;
}

interface UserMatchAlertSettingsRow {
  user_id: string;
  match_start_enabled: boolean;
  manual_match_start_enabled: boolean;
  favorite_team_match_start_enabled: boolean;
  favorite_league_match_start_enabled: boolean;
  condition_alerts_enabled: boolean;
  favorite_team_condition_alerts_enabled: boolean;
  favorite_league_condition_alerts_enabled: boolean;
  kickoff_lead_minutes: number;
  default_cooldown_minutes: number;
  channel_policy: Record<string, unknown> | null;
}

export interface MatchAlertRule {
  id: number;
  userId: string;
  matchId: string | null;
  alertKind: MatchAlertKind;
  enabled: boolean;
  source: string;
  sourceRef: Record<string, unknown>;
  ruleJson: Record<string, unknown>;
  compiledStatus: string;
  cooldownMinutes: number;
  oncePerMatch: boolean;
  channelPolicy: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface MatchAlertRuleRow {
  id: number;
  user_id: string;
  match_id: string | null;
  alert_kind: MatchAlertKind;
  enabled: boolean;
  source: string;
  source_ref: Record<string, unknown> | null;
  rule_json: Record<string, unknown> | null;
  compiled_status: string;
  cooldown_minutes: number;
  once_per_match: boolean;
  channel_policy: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface MatchAlertRuleInput {
  matchId?: string | null;
  alertKind: MatchAlertKind;
  enabled?: boolean;
  source?: string;
  sourceRef?: Record<string, unknown>;
  ruleJson: Record<string, unknown>;
  compiledStatus?: string;
  cooldownMinutes?: number;
  oncePerMatch?: boolean;
  channelPolicy?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ConditionAlertPresetView {
  id: string;
  label: string;
  labelVi: string;
  description: string;
  category: string;
  enabled: boolean;
  defaultCooldownMinutes: number;
  defaultOncePerMatch: boolean;
  sortOrder: number;
  ruleJson: Record<string, unknown>;
  source: 'system' | 'user';
}

interface UserPresetRow {
  id: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  rule_json: Record<string, unknown> | null;
  default_cooldown_minutes: number;
  default_once_per_match: boolean;
  sort_order: number;
}

const DEFAULT_SETTINGS: UserMatchAlertSettings = {
  matchStartEnabled: true,
  manualMatchStartEnabled: true,
  favoriteTeamMatchStartEnabled: false,
  favoriteLeagueMatchStartEnabled: false,
  conditionAlertsEnabled: true,
  favoriteTeamConditionAlertsEnabled: false,
  favoriteLeagueConditionAlertsEnabled: false,
  kickoffLeadMinutes: 0,
  defaultCooldownMinutes: 10,
  channelPolicy: {},
};

const TERMINAL_STATUSES = ['FT', 'AET', 'PEN', 'AWD', 'WO', 'CANC', 'ABD', 'PST'];

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapSettings(row: UserMatchAlertSettingsRow | undefined): UserMatchAlertSettings {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    matchStartEnabled: row.match_start_enabled,
    manualMatchStartEnabled: row.manual_match_start_enabled,
    favoriteTeamMatchStartEnabled: row.favorite_team_match_start_enabled,
    favoriteLeagueMatchStartEnabled: row.favorite_league_match_start_enabled,
    conditionAlertsEnabled: row.condition_alerts_enabled,
    favoriteTeamConditionAlertsEnabled: row.favorite_team_condition_alerts_enabled,
    favoriteLeagueConditionAlertsEnabled: row.favorite_league_condition_alerts_enabled,
    kickoffLeadMinutes: Number(row.kickoff_lead_minutes ?? 0),
    defaultCooldownMinutes: Number(row.default_cooldown_minutes ?? 10),
    channelPolicy: jsonObject(row.channel_policy),
  };
}

function mapRule(row: MatchAlertRuleRow): MatchAlertRule {
  return {
    id: Number(row.id),
    userId: row.user_id,
    matchId: row.match_id,
    alertKind: row.alert_kind,
    enabled: row.enabled,
    source: row.source,
    sourceRef: jsonObject(row.source_ref),
    ruleJson: jsonObject(row.rule_json),
    compiledStatus: row.compiled_status,
    cooldownMinutes: Number(row.cooldown_minutes ?? 0),
    oncePerMatch: row.once_per_match,
    channelPolicy: jsonObject(row.channel_policy),
    metadata: jsonObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getMatchAlertSettings(userId: string): Promise<UserMatchAlertSettings> {
  const result = await query<UserMatchAlertSettingsRow>(
    `SELECT *
       FROM user_match_alert_settings
      WHERE user_id = $1`,
    [userId],
  );
  return mapSettings(result.rows[0]);
}

export async function saveMatchAlertSettings(
  userId: string,
  patch: Partial<UserMatchAlertSettings>,
): Promise<UserMatchAlertSettings> {
  const existing = await getMatchAlertSettings(userId);
  const next: UserMatchAlertSettings = {
    ...existing,
    ...patch,
    channelPolicy: {
      ...existing.channelPolicy,
      ...jsonObject(patch.channelPolicy),
    },
  };
  const result = await query<UserMatchAlertSettingsRow>(
    `INSERT INTO user_match_alert_settings (
        user_id,
        match_start_enabled,
        manual_match_start_enabled,
        favorite_team_match_start_enabled,
        favorite_league_match_start_enabled,
        condition_alerts_enabled,
        favorite_team_condition_alerts_enabled,
        favorite_league_condition_alerts_enabled,
        kickoff_lead_minutes,
        default_cooldown_minutes,
        channel_policy,
        updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET match_start_enabled = EXCLUDED.match_start_enabled,
           manual_match_start_enabled = EXCLUDED.manual_match_start_enabled,
           favorite_team_match_start_enabled = EXCLUDED.favorite_team_match_start_enabled,
           favorite_league_match_start_enabled = EXCLUDED.favorite_league_match_start_enabled,
           condition_alerts_enabled = EXCLUDED.condition_alerts_enabled,
           favorite_team_condition_alerts_enabled = EXCLUDED.favorite_team_condition_alerts_enabled,
           favorite_league_condition_alerts_enabled = EXCLUDED.favorite_league_condition_alerts_enabled,
           kickoff_lead_minutes = EXCLUDED.kickoff_lead_minutes,
           default_cooldown_minutes = EXCLUDED.default_cooldown_minutes,
           channel_policy = EXCLUDED.channel_policy,
           updated_at = NOW()
     RETURNING *`,
    [
      userId,
      next.matchStartEnabled,
      next.manualMatchStartEnabled,
      next.favoriteTeamMatchStartEnabled,
      next.favoriteLeagueMatchStartEnabled,
      next.conditionAlertsEnabled,
      next.favoriteTeamConditionAlertsEnabled,
      next.favoriteLeagueConditionAlertsEnabled,
      next.kickoffLeadMinutes,
      next.defaultCooldownMinutes,
      JSON.stringify(next.channelPolicy),
    ],
  );
  return mapSettings(result.rows[0]);
}

export async function listMatchAlertRules(
  userId: string,
  filters: { matchId?: string; alertKind?: MatchAlertKind } = {},
): Promise<MatchAlertRule[]> {
  const conditions = ['user_id = $1'];
  const params: unknown[] = [userId];
  if (filters.matchId) {
    params.push(filters.matchId);
    conditions.push(`match_id = $${params.length}`);
  }
  if (filters.alertKind) {
    params.push(filters.alertKind);
    conditions.push(`alert_kind = $${params.length}`);
  }
  const result = await query<MatchAlertRuleRow>(
    `SELECT *
       FROM user_match_alert_rules
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, id DESC`,
    params,
  );
  return result.rows.map(mapRule);
}

export async function createMatchAlertRule(userId: string, input: MatchAlertRuleInput): Promise<MatchAlertRule> {
  const result = await query<MatchAlertRuleRow>(
    `INSERT INTO user_match_alert_rules (
        user_id,
        match_id,
        alert_kind,
        enabled,
        source,
        source_ref,
        rule_json,
        compiled_status,
        cooldown_minutes,
        once_per_match,
        channel_policy,
        metadata,
        updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (user_id, match_id, alert_kind, source)
       WHERE match_id IS NOT NULL
     DO UPDATE
       SET enabled = EXCLUDED.enabled,
           source_ref = EXCLUDED.source_ref,
           rule_json = EXCLUDED.rule_json,
           compiled_status = EXCLUDED.compiled_status,
           cooldown_minutes = EXCLUDED.cooldown_minutes,
           once_per_match = EXCLUDED.once_per_match,
           channel_policy = EXCLUDED.channel_policy,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()
     RETURNING *`,
    [
      userId,
      input.matchId ?? null,
      input.alertKind,
      input.enabled ?? true,
      input.source ?? 'manual',
      JSON.stringify(input.sourceRef ?? {}),
      JSON.stringify(input.ruleJson ?? {}),
      input.compiledStatus ?? 'compiled',
      input.cooldownMinutes ?? 0,
      input.oncePerMatch ?? true,
      JSON.stringify(input.channelPolicy ?? {}),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapRule(result.rows[0]!);
}

export async function updateMatchAlertRule(
  userId: string,
  ruleId: number,
  patch: Partial<MatchAlertRuleInput>,
): Promise<MatchAlertRule | null> {
  const existing = (await listMatchAlertRules(userId)).find((rule) => rule.id === ruleId);
  if (!existing) return null;
  const next = {
    matchId: patch.matchId !== undefined ? patch.matchId : existing.matchId,
    alertKind: patch.alertKind ?? existing.alertKind,
    enabled: patch.enabled ?? existing.enabled,
    source: patch.source ?? existing.source,
    sourceRef: patch.sourceRef ?? existing.sourceRef,
    ruleJson: patch.ruleJson ?? existing.ruleJson,
    compiledStatus: patch.compiledStatus ?? existing.compiledStatus,
    cooldownMinutes: patch.cooldownMinutes ?? existing.cooldownMinutes,
    oncePerMatch: patch.oncePerMatch ?? existing.oncePerMatch,
    channelPolicy: patch.channelPolicy ?? existing.channelPolicy,
    metadata: patch.metadata ?? existing.metadata,
  };
  const result = await query<MatchAlertRuleRow>(
    `UPDATE user_match_alert_rules
        SET match_id = $3,
            alert_kind = $4,
            enabled = $5,
            source = $6,
            source_ref = $7,
            rule_json = $8,
            compiled_status = $9,
            cooldown_minutes = $10,
            once_per_match = $11,
            channel_policy = $12,
            metadata = $13,
            updated_at = NOW()
      WHERE user_id = $1
        AND id = $2
      RETURNING *`,
    [
      userId,
      ruleId,
      next.matchId,
      next.alertKind,
      next.enabled,
      next.source,
      JSON.stringify(next.sourceRef),
      JSON.stringify(next.ruleJson),
      next.compiledStatus,
      next.cooldownMinutes,
      next.oncePerMatch,
      JSON.stringify(next.channelPolicy),
      JSON.stringify(next.metadata),
    ],
  );
  return result.rows[0] ? mapRule(result.rows[0]) : null;
}

export async function deleteMatchAlertRule(userId: string, ruleId: number): Promise<boolean> {
  const result = await query(
    `DELETE FROM user_match_alert_rules
      WHERE user_id = $1
        AND id = $2`,
    [userId, ruleId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getConditionAlertPresets(userId: string): Promise<ConditionAlertPresetView[]> {
  const result = await query<UserPresetRow>(
    `SELECT *
       FROM user_condition_alert_presets
      WHERE user_id = $1`,
    [userId],
  );
  const overrides = new Map(result.rows.map((row) => [row.id, row] as const));
  return SYSTEM_CONDITION_ALERT_PRESETS.map((preset): ConditionAlertPresetView => {
    const override = overrides.get(preset.id);
    return {
      id: preset.id,
      label: override?.label ?? preset.label,
      labelVi: preset.labelVi,
      description: override?.description ?? preset.description,
      category: override?.category ?? preset.category,
      enabled: override?.enabled ?? preset.enabled,
      defaultCooldownMinutes: override?.default_cooldown_minutes ?? preset.defaultCooldownMinutes,
      defaultOncePerMatch: override?.default_once_per_match ?? preset.defaultOncePerMatch,
      sortOrder: override?.sort_order ?? preset.sortOrder,
      ruleJson: override ? jsonObject(override.rule_json) : preset.ruleJson as Record<string, unknown>,
      source: override ? 'user' : 'system',
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function saveConditionAlertPresets(
  userId: string,
  presets: Array<Pick<ConditionAlertPresetView, 'id' | 'enabled' | 'defaultCooldownMinutes' | 'ruleJson'>>,
): Promise<ConditionAlertPresetView[]> {
  for (const patch of presets) {
    const system = SYSTEM_CONDITION_ALERT_PRESETS.find((preset) => preset.id === patch.id);
    if (!system) continue;
    await query(
      `INSERT INTO user_condition_alert_presets (
          id,
          user_id,
          label,
          description,
          category,
          enabled,
          rule_json,
          default_cooldown_minutes,
          default_once_per_match,
          sort_order,
          updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (user_id, id) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             rule_json = EXCLUDED.rule_json,
             default_cooldown_minutes = EXCLUDED.default_cooldown_minutes,
             updated_at = NOW()`,
      [
        system.id,
        userId,
        system.label,
        system.description,
        system.category,
        patch.enabled,
        JSON.stringify(patch.ruleJson ?? system.ruleJson),
        patch.defaultCooldownMinutes ?? system.defaultCooldownMinutes,
        system.defaultOncePerMatch,
        system.sortOrder,
      ],
    );
  }
  return getConditionAlertPresets(userId);
}

export async function resetConditionAlertPresets(userId: string): Promise<ConditionAlertPresetView[]> {
  await query('DELETE FROM user_condition_alert_presets WHERE user_id = $1', [userId]);
  return getConditionAlertPresets(userId);
}

export async function materializeMatchStartAlertRules(): Promise<{ favoriteTeamRules: number; favoriteLeagueRules: number }> {
  const ruleJson = JSON.stringify(buildMatchStartRuleJson());
  const favoriteTeam = await query<{ id: string }>(
    `INSERT INTO user_match_alert_rules (
        user_id,
        match_id,
        alert_kind,
        enabled,
        source,
        source_ref,
        rule_json,
        compiled_status,
        cooldown_minutes,
        once_per_match,
        metadata,
        updated_at
     )
     SELECT DISTINCT
        s.user_id,
        m.match_id,
        'match_start',
        TRUE,
        'favorite_team',
        jsonb_build_object('teamId', ft.team_id),
        $1::jsonb,
        'compiled',
        0,
        TRUE,
        jsonb_build_object('materializedBy', 'materialize-match-alerts'),
        NOW()
       FROM user_match_alert_settings s
       JOIN favorite_teams ft ON ft.user_id = s.user_id::text
       JOIN matches m
         ON m.home_team_id::text = ft.team_id
         OR m.away_team_id::text = ft.team_id
      WHERE s.match_start_enabled = TRUE
        AND s.favorite_team_match_start_enabled = TRUE
        AND m.status <> ALL($2)
     ON CONFLICT (user_id, match_id, alert_kind, source)
       WHERE match_id IS NOT NULL
     DO UPDATE
       SET enabled = TRUE,
           rule_json = EXCLUDED.rule_json,
           updated_at = NOW()
     RETURNING id`,
    [ruleJson, TERMINAL_STATUSES],
  );

  const favoriteLeague = await query<{ id: string }>(
    `WITH user_leagues AS (
       SELECT
         s.user_id,
         jsonb_array_elements_text(
           CASE
             WHEN jsonb_typeof(COALESCE(us.settings->'FAVORITE_LEAGUE_IDS', us.settings->'SUGGESTED_TOP_LEAGUE_IDS', '[]'::jsonb)) = 'array'
               THEN COALESCE(us.settings->'FAVORITE_LEAGUE_IDS', us.settings->'SUGGESTED_TOP_LEAGUE_IDS', '[]'::jsonb)
             ELSE '[]'::jsonb
           END
         ) AS league_id
       FROM user_match_alert_settings s
       JOIN user_settings us ON us.user_id = s.user_id::text
      WHERE s.match_start_enabled = TRUE
        AND s.favorite_league_match_start_enabled = TRUE
     )
     INSERT INTO user_match_alert_rules (
        user_id,
        match_id,
        alert_kind,
        enabled,
        source,
        source_ref,
        rule_json,
        compiled_status,
        cooldown_minutes,
        once_per_match,
        metadata,
        updated_at
     )
     SELECT DISTINCT
        ul.user_id,
        m.match_id,
        'match_start',
        TRUE,
        'favorite_league',
        jsonb_build_object('leagueId', m.league_id),
        $1::jsonb,
        'compiled',
        0,
        TRUE,
        jsonb_build_object('materializedBy', 'materialize-match-alerts'),
        NOW()
       FROM user_leagues ul
       JOIN matches m ON m.league_id = NULLIF(ul.league_id, '')::int
      WHERE m.status <> ALL($2)
     ON CONFLICT (user_id, match_id, alert_kind, source)
       WHERE match_id IS NOT NULL
     DO UPDATE
       SET enabled = TRUE,
           rule_json = EXCLUDED.rule_json,
           updated_at = NOW()
     RETURNING id`,
    [ruleJson, TERMINAL_STATUSES],
  );

  return {
    favoriteTeamRules: favoriteTeam.rowCount ?? 0,
    favoriteLeagueRules: favoriteLeague.rowCount ?? 0,
  };
}

export async function getCandidateAlertRules(): Promise<MatchAlertRule[]> {
  const result = await query<MatchAlertRuleRow>(
    `SELECT r.*
       FROM user_match_alert_rules r
       LEFT JOIN user_match_alert_settings s ON s.user_id = r.user_id
       JOIN matches m ON m.match_id = r.match_id
      WHERE r.enabled = TRUE
        AND r.compiled_status = 'compiled'
        AND r.match_id IS NOT NULL
        AND m.status <> ALL($1)
        AND (
          (
            r.alert_kind = 'match_start'
            AND COALESCE(s.match_start_enabled, TRUE) = TRUE
            AND CASE
              WHEN r.source = 'manual' THEN COALESCE(s.manual_match_start_enabled, TRUE) = TRUE
              WHEN r.source = 'favorite_team' THEN COALESCE(s.favorite_team_match_start_enabled, FALSE) = TRUE
              WHEN r.source = 'favorite_league' THEN COALESCE(s.favorite_league_match_start_enabled, FALSE) = TRUE
              ELSE TRUE
            END
          )
          OR (
            r.alert_kind = 'condition_signal'
            AND COALESCE(s.condition_alerts_enabled, TRUE) = TRUE
            AND CASE
              WHEN r.source = 'favorite_team' THEN COALESCE(s.favorite_team_condition_alerts_enabled, FALSE) = TRUE
              WHEN r.source = 'favorite_league' THEN COALESCE(s.favorite_league_condition_alerts_enabled, FALSE) = TRUE
              ELSE TRUE
            END
          )
        )
      ORDER BY r.match_id, r.id`,
    [TERMINAL_STATUSES],
  );
  return result.rows.map(mapRule);
}
