import type { LiveAnalysisPromptVersion, LiveAnalysisPromptInput } from './live-analysis-prompt.js';

export type RecommendationStudioEntityStatus = 'draft' | 'validated' | 'candidate' | 'active' | 'archived';
export type RecommendationStudioRuleStage = 'pre_prompt' | 'post_parse';

export type RecommendationStudioTokenKey =
  | 'MATCH_CONTEXT'
  | 'LIVE_STATS_COMPACT'
  | 'LIVE_ODDS_CANONICAL'
  | 'EXACT_OUTPUT_ENUMS'
  | 'EVENTS_COMPACT'
  | 'LINEUPS_SNAPSHOT'
  | 'PREMATCH_EXPERT_FEATURES'
  | 'PREVIOUS_RECOMMENDATIONS'
  | 'EVIDENCE_MODE'
  | 'USER_QUESTION';

export interface RecommendationPromptTemplateRecord {
  id: number;
  template_key: string;
  name: string;
  base_prompt_version: LiveAnalysisPromptVersion;
  status: RecommendationStudioEntityStatus;
  notes: string;
  advanced_appendix: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecommendationPromptSectionRecord {
  id: number;
  template_id: number;
  section_key: string;
  label: string;
  content: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RecommendationRuleSetRecord {
  id: number;
  rule_set_key: string;
  name: string;
  status: RecommendationStudioEntityStatus;
  notes: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecommendationRuleConditions {
  minuteBands?: string[];
  scoreStates?: string[];
  evidenceModes?: string[];
  prematchStrengths?: string[];
  promptVersions?: string[];
  releaseIds?: number[];
  releaseKeys?: string[];
  marketFamilies?: string[];
  canonicalMarketEquals?: string[];
  canonicalMarketPrefixes?: string[];
  periodKinds?: Array<'ft' | 'h1'>;
  oddsMin?: number | null;
  oddsMax?: number | null;
  lineMin?: number | null;
  lineMax?: number | null;
  totalGoalsMin?: number | null;
  totalGoalsMax?: number | null;
  currentCornersMin?: number | null;
  currentCornersMax?: number | null;
  riskLevels?: string[];
}

export interface RecommendationRuleActions {
  block?: boolean;
  forceNoBet?: boolean;
  capConfidence?: number | null;
  capStakePercent?: number | null;
  raiseMinEdge?: number | null;
  warning?: string | null;
  hideMarketFamiliesFromPrompt?: string[];
  appendInstruction?: string | null;
  markExceptionalOnly?: boolean;
}

export interface RecommendationRuleRecord {
  id: number;
  rule_set_id: number;
  name: string;
  stage: RecommendationStudioRuleStage;
  priority: number;
  enabled: boolean;
  conditions_json: RecommendationRuleConditions;
  actions_json: RecommendationRuleActions;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface RecommendationReleaseRecord {
  id: number;
  release_key: string;
  name: string;
  prompt_template_id: number;
  rule_set_id: number;
  status: RecommendationStudioEntityStatus;
  activation_scope: 'global';
  replay_validation_status: 'not_validated' | 'running' | 'validated' | 'failed';
  notes: string;
  is_active: boolean;
  activated_by: string | null;
  activated_at: string | null;
  rollback_of_release_id: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecommendationReplayRunRecord {
  id: number;
  run_key: string;
  name: string;
  release_id: number | null;
  prompt_template_id: number;
  rule_set_id: number;
  status: 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'canceled';
  source_filters: Record<string, unknown>;
  release_snapshot_json: Record<string, unknown>;
  summary_json: Record<string, unknown>;
  total_items: number;
  completed_items: number;
  error_message: string | null;
  llm_mode: 'real';
  llm_model: string;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface RecommendationReplayRunItemRecord {
  id: number;
  run_id: number;
  source_kind: 'recommendation' | 'snapshot';
  source_ref: string;
  recommendation_id: number | null;
  snapshot_id: number | null;
  match_id: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
  original_decision_json: Record<string, unknown>;
  replayed_decision_json: Record<string, unknown>;
  evaluation_json: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface RecommendationReleaseAuditLogRecord {
  id: number;
  entity_type: string;
  entity_id: number;
  action: string;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
  before_json: Record<string, unknown>;
  after_json: Record<string, unknown>;
  notes: string;
  created_at: string;
}

export interface RecommendationPromptTemplateDetail extends RecommendationPromptTemplateRecord {
  sections: RecommendationPromptSectionRecord[];
}

export interface RecommendationRuleSetDetail extends RecommendationRuleSetRecord {
  rules: RecommendationRuleRecord[];
}

export interface RecommendationReleaseDetail extends RecommendationReleaseRecord {
  promptTemplate: RecommendationPromptTemplateDetail;
  ruleSet: RecommendationRuleSetDetail;
}

export interface RecommendationStudioTokenCatalogEntry {
  key: RecommendationStudioTokenKey;
  label: string;
  description: string;
}

export interface RecommendationStudioRuntimeTokenMap extends Record<RecommendationStudioTokenKey, string> {}

export interface RecommendationStudioPromptOverlay {
  sections: RecommendationPromptSectionRecord[];
  advancedAppendix: string;
  runtimeTokens: RecommendationStudioRuntimeTokenMap;
}

export interface RecommendationStudioPrePromptContext {
  minute: number;
  score: string;
  evidenceMode: string;
  prematchStrength: string;
  promptVersion: string;
  releaseId: number | null;
  releaseKey: string | null;
  odds: Record<string, unknown>;
  currentCorners: number | null;
  currentGoals: number | null;
}

export interface RecommendationStudioPrePromptDecision {
  hiddenMarketFamilies: string[];
  appendedInstructions: string[];
  exceptionalOnlyReasons: string[];
}

export interface RecommendationStudioPostParseContext {
  minute: number;
  score: string;
  evidenceMode: string;
  prematchStrength: string;
  promptVersion: string;
  releaseId: number | null;
  releaseKey: string | null;
  selection: string;
  betMarket: string;
  odds: number | null;
  valuePercent: number;
  confidence: number;
  stakePercent: number;
  riskLevel: string | null;
  currentCorners: number | null;
  currentGoals: number | null;
}

export interface RecommendationStudioPostParseDecision {
  blocked: boolean;
  forceNoBet: boolean;
  confidence: number;
  stakePercent: number;
  warnings: string[];
}

export interface RecommendationStudioPromptPreview {
  basePromptVersion: LiveAnalysisPromptVersion;
  effectivePrompt: string;
  overlayText: string;
  runtimeTokens: RecommendationStudioRuntimeTokenMap;
}

export interface RecommendationStudioPromptValidationIssue {
  field: string;
  message: string;
}

export interface RecommendationStudioValidationResult {
  ok: boolean;
  errors: RecommendationStudioPromptValidationIssue[];
  warnings: RecommendationStudioPromptValidationIssue[];
}

export type RecommendationStudioPromptPreviewInput = Pick<
  LiveAnalysisPromptInput,
  | 'homeName'
  | 'awayName'
  | 'league'
  | 'minute'
  | 'score'
  | 'status'
  | 'statsCompact'
  | 'evidenceMode'
  | 'oddsCanonical'
  | 'eventsCompact'
  | 'lineupsSnapshot'
  | 'prematchExpertFeatures'
  | 'previousRecommendations'
  | 'userQuestion'
>;
