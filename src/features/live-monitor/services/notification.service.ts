// ============================================================
// Notification Service
// Equivalent to: "Format Email" + "Send Email" +
//                "Format Telegram Message" + "Send Message"
// ============================================================

import type { AppConfig } from '@/types';
import type {
  LiveMonitorConfig,
  RecommendationData,
  ParsedAiResponse,
  MergedMatchData,
  EventCompact,
  EmailPayload,
} from '../types';
import { sendEmail, sendTelegram } from './proxy.service';
import { formatLocalDateTime } from '@/lib/utils/helpers';

// ==================== Helpers ====================

function esc(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeHtml(text: string): string {
  return esc(text).replace(/\n/g, '<br>');
}

/** Internal-only warning codes — not meaningful to end users, omit from notifications */
const INTERNAL_WARNINGS = new Set(['FORCE_MODE', 'EARLY_GAME_RISK']);

/** Map raw warning codes to user-readable descriptions */
function formatWarning(code: string): string {
  const map: Record<string, string> = {
    ODDS_SUSPICIOUS: 'Odds flagged as suspicious',
    STATS_INCOMPLETE: 'Live stats incomplete',
    LATE_GAME: 'Late game — high volatility',
    LOW_VALUE: 'Low value bet detected',
    DATA_QUALITY: 'Data quality issues',
    NON_LIVE_STATUS: 'Match not yet live',
    RED_CARD_DETECTED: 'Red card in match',
    RED_CARD_ADJUSTED: 'Analysis adjusted for red card',
    '1X2_BTTS_NO_OVERRIDE': '1X2/BTTS override applied',
    CONFIDENCE_BELOW_MIN: 'Confidence below minimum threshold',
    ODDS_INVALID: 'Odds could not be validated',
    '1X2_TOO_EARLY': '1X2 market too early (before min 35)',
  };
  return map[code] ?? code;
}

function formatWarnings(warnings: string[]): string[] {
  return warnings
    .filter((w) => !INTERNAL_WARNINGS.has(w))
    .map(formatWarning);
}

function sortEvents(events: EventCompact[]): EventCompact[] {
  return [...events].sort((a, b) => {
    const minDiff = (a.minute || 0) - (b.minute || 0);
    if (minDiff !== 0) return minDiff;
    return (a.extra || 0) - (b.extra || 0);
  });
}

function formatMinute(event: EventCompact): string {
  if (event.extra) return `${event.minute}+${event.extra}'`;
  return `${event.minute}'`;
}

function getEventIcon(event: EventCompact): string {
  const type = (event.type || '').toLowerCase();
  const detail = (event.detail || '').toLowerCase();

  if (type === 'goal') {
    if (detail.includes('penalty')) return '⚽ P';
    if (detail.includes('own')) return '⚽🔴';
    return '⚽';
  }
  if (type === 'card') {
    if (detail.includes('red')) return '🟥';
    if (detail.includes('yellow')) return '🟨';
    return '🟨';
  }
  if (type === 'subst') return '🔄';
  if (type === 'var') return '📺';
  return '📋';
}

// ==================== Determine notification section ====================

interface NotificationContext {
  recommendation: RecommendationData;
  parsed: ParsedAiResponse;
  matchData: MergedMatchData;
  config: LiveMonitorConfig;
}

type NotificationSection = 'ai_recommendation' | 'condition_triggered' | 'no_actionable';

function determineSection(ctx: NotificationContext): NotificationSection {
  const { parsed } = ctx;
  if (parsed.ai_should_push && parsed.should_push) return 'ai_recommendation';
  // Only treat as actionable condition if AI also says to push
  if (parsed.custom_condition_matched && parsed.condition_triggered_should_push) return 'condition_triggered';
  return 'no_actionable';
}

// ==================== Format Email ====================

function buildEmailHtml(ctx: NotificationContext): string {
  const { recommendation: rec, parsed, matchData } = ctx;
  const section = determineSection(ctx);
  const events = sortEvents(matchData.events_compact || []);

  const headerColor = section === 'ai_recommendation' ? '#2e7d32' :
    section === 'condition_triggered' ? '#e65100' : '#616161';
  const headerText = section === 'ai_recommendation' ? 'RECOMMENDATION' :
    section === 'condition_triggered' ? '⚡ CONDITION TRIGGERED' : '📊 MATCH ANALYSIS (No Actionable)';

  let html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:16px;">
  <div style="background:${headerColor};color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;font-size:16px;">${headerText}</h2>
    <p style="margin:4px 0 0;font-size:13px;opacity:0.9;">
      ${esc(rec.match_display)} | ${esc(rec.league)}
    </p>
  </div>

  <div style="border:1px solid #e0e0e0;border-top:none;padding:16px;border-radius:0 0 8px 8px;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:4px 8px;color:#666;">Score</td><td style="padding:4px 8px;font-weight:bold;">${esc(rec.score)} (${esc(String(rec.minute))}' - ${esc(rec.status)})</td></tr>
      <tr><td style="padding:4px 8px;color:#666;">Mode</td><td style="padding:4px 8px;">${esc(rec.mode)}</td></tr>
      <tr><td style="padding:4px 8px;color:#666;">Model</td><td style="padding:4px 8px;">${esc(rec.ai_model)}</td></tr>
    </table>`;

  // Section-specific content
  if (section === 'ai_recommendation') {
    html += `
    <hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;">
    <h3 style="margin:0 0 8px;font-size:14px;color:${headerColor};">Investment Idea</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:4px 8px;color:#666;">Selection</td><td style="padding:4px 8px;font-weight:bold;">${esc(rec.selection)}</td></tr>
      <tr><td style="padding:4px 8px;color:#666;">Market</td><td style="padding:4px 8px;">${esc(rec.bet_market)}</td></tr>
      <tr><td style="padding:4px 8px;color:#666;">Odds</td><td style="padding:4px 8px;">${esc(String(rec.odds ?? 'N/A'))}</td></tr>
      <tr><td style="padding:4px 8px;color:#666;">Confidence</td><td style="padding:4px 8px;">${rec.confidence}/10</td></tr>
      <tr><td style="padding:4px 8px;color:#666;">Stake</td><td style="padding:4px 8px;">${rec.stake_percent}%</td></tr>
      <tr><td style="padding:4px 8px;color:#666;">Value</td><td style="padding:4px 8px;">${rec.value_percent}%</td></tr>
      <tr><td style="padding:4px 8px;color:#666;">Risk</td><td style="padding:4px 8px;">${esc(rec.risk_level)}</td></tr>
    </table>
    <div style="margin:12px 0;padding:10px;background:#f5f5f5;border-radius:4px;font-size:13px;">
      <strong>Reasoning (EN):</strong><br>${safeHtml(parsed.reasoning_en)}
    </div>
    <div style="margin:12px 0;padding:10px;background:#fff3e0;border-radius:4px;font-size:13px;">
      <strong>Reasoning (VI):</strong><br>${safeHtml(parsed.reasoning_vi)}
    </div>`;
  }

  if (section === 'condition_triggered' || (parsed.custom_condition_matched && section !== 'no_actionable')) {
    html += `
    <hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;">
    <h3 style="margin:0 0 8px;font-size:14px;color:#e65100;">⚡ Custom Condition</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:4px 8px;color:#666;">Status</td><td style="padding:4px 8px;">${esc(parsed.custom_condition_status)}</td></tr>
      <tr><td style="padding:4px 8px;color:#666;">Matched</td><td style="padding:4px 8px;font-weight:bold;">${parsed.custom_condition_matched ? '✅ YES' : '❌ NO'}</td></tr>
      <tr><td style="padding:4px 8px;color:#666;">Summary</td><td style="padding:4px 8px;">${safeHtml(parsed.custom_condition_summary_en)}</td></tr>
      <tr><td style="padding:4px 8px;color:#666;">Reason</td><td style="padding:4px 8px;">${safeHtml(parsed.custom_condition_reason_en)}</td></tr>
    </table>`;

    if (parsed.condition_triggered_suggestion) {
      html += `
    <div style="margin:12px 0;padding:10px;background:#fff3e0;border-radius:4px;font-size:13px;">
      <strong>Suggestion:</strong> ${esc(parsed.condition_triggered_suggestion)}<br>
      <strong>Confidence:</strong> ${parsed.condition_triggered_confidence}/10 | <strong>Stake:</strong> ${parsed.condition_triggered_stake}%<br>
      <strong>Reasoning (EN):</strong><br>${safeHtml(parsed.condition_triggered_reasoning_en)}<br>
      <strong>Reasoning (VI):</strong><br>${safeHtml(parsed.condition_triggered_reasoning_vi)}
    </div>`;
    }
  }

  if (section === 'no_actionable') {
    html += `
    <hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;">
    <div style="margin:12px 0;padding:10px;background:#f5f5f5;border-radius:4px;font-size:13px;">
      <strong>Analysis (EN):</strong><br>${safeHtml(parsed.reasoning_en)}
    </div>
    <div style="margin:12px 0;padding:10px;background:#fff3e0;border-radius:4px;font-size:13px;">
      <strong>Analysis (VI):</strong><br>${safeHtml(parsed.reasoning_vi)}
    </div>`;
  }

  // Stats section
  if (matchData.stats_available && matchData.stats) {
    html += `
    <hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;">
    <h3 style="margin:0 0 8px;font-size:14px;color:#1565c0;">📊 Live Stats</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:center;">
      <tr style="background:#e3f2fd;">
        <th style="padding:4px 8px;">Stat</th><th style="padding:4px 8px;">Home</th><th style="padding:4px 8px;">Away</th>
      </tr>`;

    const sc = matchData.stats_compact || {};
    for (const [key, val] of Object.entries(sc)) {
      if (val && typeof val === 'object' && 'home' in val && val.home != null && val.away != null && val.home !== '' && val.away !== '') {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        html += `<tr><td style="padding:3px 8px;text-align:left;">${esc(label)}</td><td style="padding:3px 8px;">${esc(String(val.home))}</td><td style="padding:3px 8px;">${esc(String(val.away))}</td></tr>`;
      }
    }
    html += '</table>';
  }

  // Events section
  if (events.length > 0) {
    html += `
    <hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;">
    <h3 style="margin:0 0 8px;font-size:14px;color:#6a1b9a;">📋 Events</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">`;

    for (const evt of events) {
      const icon = getEventIcon(evt);
      html += `<tr><td style="padding:2px 6px;width:40px;">${formatMinute(evt)}</td><td style="padding:2px 6px;width:30px;">${icon}</td><td style="padding:2px 6px;">${esc(evt.team)} - ${esc(evt.player)} (${esc(evt.detail)})</td></tr>`;
    }
    html += '</table>';
  }

  // Warnings
  const allWarnings = formatWarnings(parsed.warnings || []);
  if (allWarnings.length > 0) {
    html += `
    <hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;">
    <div style="padding:8px;background:#ffebee;border-radius:4px;font-size:12px;color:#c62828;">
      <strong>⚠️ Warnings:</strong> ${esc(allWarnings.join(', '))}
    </div>`;
  }

  html += `
    <div style="margin-top:12px;padding:8px;font-size:11px;color:#999;text-align:center;">
      TFI Live Monitor | ${esc(formatLocalDateTime(new Date().toISOString()))}
    </div>
  </div>
</div>`;

  return html;
}

// ==================== Stats Chart (QuickChart.io) ====================

interface StatPair { home: string | null | undefined; away: string | null | undefined }
type StatsChartConfig = Record<string, unknown>;

/** Truncate at last word boundary before max chars (never cuts mid-word). */
/**
 * Cut caption at last newline before the limit.
 * Since all HTML tags (<b>, <i>) are opened and closed within the same line,
 * cutting at \n guarantees no unclosed tags.
 */
function safeTruncateCaption(text: string, limit = 1020): string {
  if (text.length <= limit) return text;
  const idx = text.lastIndexOf('\n', limit);
  return text.substring(0, idx > 0 ? idx : limit);
}

/**
 * Stacked 100% horizontal bar chart — all stats normalized to home/away share.
 * Labels include raw counts so actual numbers are still visible.
 * Using share % fixes the scale-mixing issue (possession % vs counts on same axis).
 */
function buildStatsChartConfig(
  statsCompact: Record<string, StatPair>,
  homeName: string,
  awayName: string,
  minute: string | number,
): StatsChartConfig | null {
  const n = (v: string | null | undefined): number => {
    if (v == null || v === '') return 0;
    const num = parseFloat(String(v).replace('%', ''));
    return isNaN(num) ? 0 : num;
  };

  // share(h, a) → [homeShare%, awayShare%] where home+away=100
  const share = (h: number, a: number): [number, number] => {
    const total = h + a;
    if (total === 0) return [0, 0];
    return [Math.round(h / total * 100), Math.round(a / total * 100)];
  };

  const sc = statsCompact;
  const posH = n(sc['possession']?.home); const posA = n(sc['possession']?.away);
  const shoH = n(sc['shots']?.home);      const shoA = n(sc['shots']?.away);
  const sotH = n(sc['shots_on_target']?.home); const sotA = n(sc['shots_on_target']?.away);
  const corH = n(sc['corners']?.home);    const corA = n(sc['corners']?.away);
  const fouH = n(sc['fouls']?.home);      const fouA = n(sc['fouls']?.away);

  // Require at least some real data
  const hasData = posH + posA + shoH + shoA + sotH + sotA + corH + corA + fouH + fouA > 0;
  if (!hasData) return null;

  const [posHS, posAS] = posH + posA > 0 ? [posH, posA] : [0, 0]; // possession already %
  const [shoHS, shoAS] = share(shoH, shoA);
  const [sotHS, sotAS] = share(sotH, sotA);
  const [corHS, corAS] = share(corH, corA);
  const [fouHS, fouAS] = share(fouH, fouA);

  const trim = (s: string, max = 14) => s.length > max ? s.substring(0, max - 1) + '…' : s;

  return {
    type: 'horizontalBar',
    data: {
      labels: [
        `Poss (${posH}/${posA}%)`,
        `Shots (${shoH}/${shoA})`,
        `On Target (${sotH}/${sotA})`,
        `Corners (${corH}/${corA})`,
        `Fouls (${fouH}/${fouA})`,
      ],
      datasets: [
        { label: trim(homeName), backgroundColor: '#3b82f6', data: [posHS, shoHS, sotHS, corHS, fouHS] },
        { label: trim(awayName), backgroundColor: '#ef4444', data: [posAS, shoAS, sotAS, corAS, fouAS] },
      ],
    },
    options: {
      title: { display: true, text: `Live Stats — ${minute}'`, fontSize: 14 },
      legend: { position: 'bottom' },
      scales: {
        xAxes: [{ stacked: true, ticks: { min: 0, max: 100 } }],
        yAxes: [{ stacked: true }],
      },
    },
  };
}

// ==================== Format Telegram Message ====================

/** Condensed caption for sendPhoto (max 1024 chars). Stats replaced by chart image. */
/**
 * Short caption for the chart photo — match header + bet decision only.
 * Reasoning is intentionally omitted here and sent as a separate follow-up message.
 */
function buildTelegramCaption(ctx: NotificationContext): string {
  const { recommendation: rec, parsed, matchData } = ctx;
  const section = determineSection(ctx);
  const events = sortEvents(matchData.events_compact || []);

  const emoji = section === 'ai_recommendation' ? '' : section === 'condition_triggered' ? '⚡' : '📊';
  const label = section === 'ai_recommendation' ? 'RECOMMENDATION' : section === 'condition_triggered' ? 'CONDITION TRIGGERED' : 'MATCH ANALYSIS';

  let text = emoji ? `<b>${emoji} ${label}</b>\n` : `<b>${label}</b>\n`;
  text += `<b>${safeHtml(rec.match_display)}</b>\n`;
  text += `${safeHtml(rec.league)}\n`;
  text += `⏱ ${safeHtml(String(rec.minute))}' | 📋 ${safeHtml(rec.score)} | ${safeHtml(rec.status)}\n`;
  text += `Mode: ${safeHtml(rec.mode)}\n`;

  if (section === 'ai_recommendation') {
    text += `\n<b>💰 ${safeHtml(rec.selection)}</b>\n`;
    text += `Market: ${safeHtml(rec.bet_market)} | Odds: ${safeHtml(String(rec.odds ?? 'N/A'))}\n`;
    text += `Confidence: ${rec.confidence}/10 | Stake: ${rec.stake_percent}% | Risk: ${safeHtml(rec.risk_level)} | Value: ${rec.value_percent}%\n`;
  } else if (section === 'condition_triggered' && parsed.condition_triggered_suggestion) {
    text += `\n⚡ <b>${safeHtml(parsed.condition_triggered_suggestion)}</b>\n`;
    text += `Confidence: ${parsed.condition_triggered_confidence}/10 | Stake: ${parsed.condition_triggered_stake}%\n`;
  }

  // Key events — goals + cards only, case-insensitive, max 6
  const keyEvents = events
    .filter((e) => { const t = e.type.toLowerCase(); return t === 'goal' || t === 'card'; })
    .slice(-6);
  if (keyEvents.length > 0) {
    text += '\n';
    for (const evt of keyEvents) {
      const icon = getEventIcon(evt);
      text += `${formatMinute(evt)} ${icon} ${safeHtml(evt.team)} (${safeHtml(evt.detail)})\n`;
    }
  }

  // Warnings (concise, max 3)
  const allWarnings = formatWarnings(parsed.warnings || []);
  if (allWarnings.length > 0) {
    text += `\n⚠️ ${safeHtml(allWarnings.slice(0, 3).join(' | '))}\n`;
  }

  text += `\n<i>👆 Match analysis | ${safeHtml(formatLocalDateTime(new Date().toISOString()))}</i>`;

  return safeTruncateCaption(text);
}

/**
 * Full reasoning message sent after the chart photo — never truncated.
 * Split into chunks if reasoning is very long.
 */
function buildReasoningMessages(ctx: NotificationContext): string[] {
  const { recommendation: rec, parsed } = ctx;
  const section = determineSection(ctx);
  const lang = ctx.config.NOTIFICATION_LANGUAGE ?? 'vi';
  const pickReasoning = (en: string, vi: string) =>
    lang === 'vi' ? (vi || en) : (en || vi);
  const reasoningLabel = lang === 'vi' ? 'Phân tích' : 'Reasoning';

  let text = '';

  if (section === 'ai_recommendation') {
    const reasoning = pickReasoning(parsed.reasoning_en, parsed.reasoning_vi);
    if (!reasoning) return [];
    text += `<b>📝 ${reasoningLabel} — ${safeHtml(rec.match_display)}</b>\n\n`;
    text += safeHtml(reasoning);
  } else if (section === 'condition_triggered') {
    const reasoning = pickReasoning(parsed.condition_triggered_reasoning_en, parsed.condition_triggered_reasoning_vi);
    if (!reasoning) return [];
    text += `<b>⚡ ${reasoningLabel} — ${safeHtml(rec.match_display)}</b>\n\n`;
    text += safeHtml(reasoning);
  } else {
    const reasoning = pickReasoning(parsed.reasoning_en, parsed.reasoning_vi);
    if (!reasoning) return [];
    text += `<b>📊 ${reasoningLabel} — ${safeHtml(rec.match_display)}</b>\n\n`;
    text += safeHtml(reasoning);
  }

  return chunkMessage(text);
}

function buildTelegramMessages(ctx: NotificationContext): string[] {
  const { recommendation: rec, parsed, matchData } = ctx;
  const section = determineSection(ctx);
  const events = sortEvents(matchData.events_compact || []);
  const lang = ctx.config.NOTIFICATION_LANGUAGE ?? 'vi';
  const pickReasoning = (en: string, vi: string) =>
    lang === 'vi' ? (vi || en) : (en || vi);
  const reasoningLabel = lang === 'vi' ? 'Phân tích' : 'Reasoning';

  const headerEmoji = section === 'ai_recommendation' ? '' :
    section === 'condition_triggered' ? '⚡' : '📊';
  const headerLabel = section === 'ai_recommendation' ? 'RECOMMENDATION' :
    section === 'condition_triggered' ? 'CONDITION TRIGGERED' : 'MATCH ANALYSIS';

  let text = '';
  text += headerEmoji ? `<b>${headerEmoji} ${headerLabel}</b>\n` : `<b>${headerLabel}</b>\n`;
  text += `<b>${safeHtml(rec.match_display)}</b>\n`;
  text += `${safeHtml(rec.league)}\n`;
  text += `⏱ ${safeHtml(String(rec.minute))}' | 📋 ${safeHtml(rec.score)} | ${safeHtml(rec.status)}\n`;
  text += `Mode: ${safeHtml(rec.mode)}\n`;
  text += '\n';

  if (section === 'ai_recommendation') {
    text += `<b>💰 Investment Idea</b>\n`;
    text += `Selection: <b>${safeHtml(rec.selection)}</b>\n`;
    text += `Market: ${safeHtml(rec.bet_market)}\n`;
    text += `Odds: ${safeHtml(String(rec.odds ?? 'N/A'))}\n`;
    text += `Confidence: ${rec.confidence}/10 | Stake: ${rec.stake_percent}%\n`;
    text += `Value: ${rec.value_percent}% | Risk: ${safeHtml(rec.risk_level)}\n`;
    text += '\n';
    text += `<b>📝 ${reasoningLabel}:</b>\n${safeHtml(pickReasoning(parsed.reasoning_en, parsed.reasoning_vi))}\n`;
  }

  if (section === 'condition_triggered' || parsed.custom_condition_matched) {
    const condSummary = pickReasoning(parsed.custom_condition_summary_en, parsed.custom_condition_summary_en);
    const condReason = pickReasoning(parsed.custom_condition_reason_en, parsed.custom_condition_reason_en);
    text += '\n<b>⚡ Custom Condition</b>\n';
    text += `Status: ${safeHtml(parsed.custom_condition_status)}\n`;
    text += `Matched: ${parsed.custom_condition_matched ? '✅ YES' : '❌ NO'}\n`;
    text += `Summary: ${safeHtml(condSummary)}\n`;
    text += `Reason: ${safeHtml(condReason)}\n`;

    if (parsed.condition_triggered_suggestion) {
      text += `\nSuggestion: <b>${safeHtml(parsed.condition_triggered_suggestion)}</b>\n`;
      text += `Confidence: ${parsed.condition_triggered_confidence}/10 | Stake: ${parsed.condition_triggered_stake}%\n`;
      text += `${reasoningLabel}: ${safeHtml(pickReasoning(parsed.condition_triggered_reasoning_en, parsed.condition_triggered_reasoning_vi))}\n`;
    }
  }

  if (section === 'no_actionable') {
    text += `<b>📝 ${reasoningLabel}:</b>\n${safeHtml(pickReasoning(parsed.reasoning_en, parsed.reasoning_vi))}\n`;
  }

  // Stats (text fallback — shown when chart image is not available)
  if (matchData.stats_available && matchData.stats_compact) {
    text += '\n<b>📊 Live Stats</b>\n';
    const sc = matchData.stats_compact;
    for (const [key, val] of Object.entries(sc)) {
      if (val && typeof val === 'object' && 'home' in val && val.home != null && val.away != null && val.home !== '' && val.away !== '') {
        const lbl = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        text += `${lbl}: ${val.home} - ${val.away}\n`;
      }
    }
  }

  // Events
  if (events.length > 0) {
    text += '\n<b>📋 Events</b>\n';
    for (const evt of events) {
      const icon = getEventIcon(evt);
      text += `${formatMinute(evt)} ${icon} ${safeHtml(evt.team)} - ${safeHtml(evt.player)} (${safeHtml(evt.detail)})\n`;
    }
  }

  // Warnings
  const allWarnings = formatWarnings(parsed.warnings || []);
  if (allWarnings.length > 0) {
    text += `\n⚠️ <b>Warnings:</b> ${safeHtml(allWarnings.join(', '))}\n`;
  }

  text += `\n<i>👆 Match analysis | ${safeHtml(formatLocalDateTime(new Date().toISOString()))}</i>`;

  return chunkMessage(text);
}

function chunkMessage(text: string, maxLen = 3500): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let idx = remaining.lastIndexOf('\n', maxLen);
    if (idx <= 0) idx = maxLen;
    chunks.push(remaining.substring(0, idx));
    remaining = remaining.substring(idx).replace(/^\n/, '');
  }
  return chunks;
}

// ==================== Notification Orchestrator ====================

export interface NotificationResult {
  emailSent: boolean;
  telegramSent: boolean;
  telegramChunks: number;
  errors: string[];
}

/**
 * Format and send notifications (email + telegram) for a recommendation.
 * Only sends when there's something actionable (ai_should_push, condition matched, etc).
 * When forceNotify is true (manual Ask AI), always sends Telegram regardless of section.
 */
export async function notifyRecommendation(
  appConfig: AppConfig,
  monitorConfig: LiveMonitorConfig,
  matchData: MergedMatchData,
  parsed: ParsedAiResponse,
  recommendation: RecommendationData,
  options?: { forceNotify?: boolean },
): Promise<NotificationResult> {
  const result: NotificationResult = {
    emailSent: false,
    telegramSent: false,
    telegramChunks: 0,
    errors: [],
  };

  const ctx: NotificationContext = {
    recommendation,
    parsed,
    matchData,
    config: monitorConfig,
  };

  const section = determineSection(ctx);
  const forced = options?.forceNotify === true;

  // Only notify for actionable sections (unless forced by manual trigger)
  const shouldNotify =
    forced || section === 'ai_recommendation' || section === 'condition_triggered';

  if (!shouldNotify) return result;

  // Format email
  try {
    const emailHtml = buildEmailHtml(ctx);
    const subject = section === 'ai_recommendation'
      ? `TFI: ${recommendation.match_display} | ${recommendation.selection}`
      : `⚡ TFI: ${recommendation.match_display} | Condition Triggered`;

    const emailPayload: EmailPayload = {
      email_to: monitorConfig.EMAIL_TO,
      email_subject: subject,
      email_body_html: emailHtml,
    };

    await sendEmail(appConfig, emailPayload);
    result.emailSent = true;
  } catch (e) {
    result.errors.push(`Email error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Format and send telegram messages
  try {
    const chatId = monitorConfig.TELEGRAM_CHAT_ID;
    if (!chatId) {
      result.errors.push('Telegram skipped: TELEGRAM_CHAT_ID not configured');
      return result;
    }

    // Use sendPhoto with chart when live stats are available — 1 message instead of chunked text
    const hasStats = matchData.stats_available && matchData.stats_compact;
    const chartConfig = hasStats
      ? buildStatsChartConfig(
          matchData.stats_compact as Record<string, StatPair>,
          recommendation.home_team || '',
          recommendation.away_team || '',
          recommendation.minute ?? '',
        )
      : null;

    let photoSent = false;
    if (chartConfig) {
      try {
        const caption = buildTelegramCaption(ctx);
        await sendTelegram(appConfig, { chat_id: chatId, text: caption, parse_mode: 'HTML', chart_config: chartConfig });
        result.telegramChunks = 1;
        photoSent = true;
        // Send full reasoning as a separate follow-up message (never truncated)
        const reasoningMsgs = buildReasoningMessages(ctx);
        for (const msg of reasoningMsgs) {
          await sendTelegram(appConfig, { chat_id: chatId, text: msg, parse_mode: 'HTML' });
          result.telegramChunks++;
        }
      } catch {
        // QuickChart or Telegram photo failed — fall through to text message
        photoSent = false;
      }
    }

    if (!photoSent) {
      const messages = buildTelegramMessages(ctx);
      result.telegramChunks = messages.length;
      for (const msg of messages) {
        await sendTelegram(appConfig, { chat_id: chatId, text: msg, parse_mode: 'HTML' });
      }
    }

    result.telegramSent = true;
  } catch (e) {
    result.errors.push(`Telegram error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}

// Export for testing
export {
  buildEmailHtml as _buildEmailHtml,
  buildTelegramMessages as _buildTelegramMessages,
  determineSection as _determineSection,
  buildStatsChartConfig as _buildStatsChartConfig,
};
