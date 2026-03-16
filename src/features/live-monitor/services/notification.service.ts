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
  TelegramPayload,
} from '../types';
import { sendEmail, sendTelegram } from './proxy.service';

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
    if (detail.includes('penalty')) return '⚽🎯';
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
  if (parsed.custom_condition_matched && parsed.condition_triggered_should_push) return 'condition_triggered';
  if (parsed.custom_condition_matched) return 'condition_triggered';
  return 'no_actionable';
}

// ==================== Format Email ====================

function buildEmailHtml(ctx: NotificationContext): string {
  const { recommendation: rec, parsed, matchData } = ctx;
  const section = determineSection(ctx);
  const events = sortEvents(matchData.events_compact || []);

  const headerColor = section === 'ai_recommendation' ? '#2e7d32' :
    section === 'condition_triggered' ? '#e65100' : '#616161';
  const headerText = section === 'ai_recommendation' ? '🎯 AI RECOMMENDATION' :
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
      <tr><td style="padding:4px 8px;color:#666;">AI Model</td><td style="padding:4px 8px;">${esc(rec.ai_model)}</td></tr>
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
      if (val && typeof val === 'object' && 'home' in val) {
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
  const allWarnings = parsed.warnings || [];
  if (allWarnings.length > 0) {
    html += `
    <hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;">
    <div style="padding:8px;background:#ffebee;border-radius:4px;font-size:12px;color:#c62828;">
      <strong>⚠️ Warnings:</strong> ${esc(allWarnings.join(', '))}
    </div>`;
  }

  html += `
    <div style="margin-top:12px;padding:8px;font-size:11px;color:#999;text-align:center;">
      TFI Live Monitor | ${esc(new Date().toISOString())}
    </div>
  </div>
</div>`;

  return html;
}

// ==================== Format Telegram Message ====================

function buildTelegramMessages(ctx: NotificationContext): string[] {
  const { recommendation: rec, parsed, matchData } = ctx;
  const section = determineSection(ctx);
  const events = sortEvents(matchData.events_compact || []);

  const headerEmoji = section === 'ai_recommendation' ? '🎯' :
    section === 'condition_triggered' ? '⚡' : '📊';
  const headerLabel = section === 'ai_recommendation' ? 'AI RECOMMENDATION' :
    section === 'condition_triggered' ? 'CONDITION TRIGGERED' : 'MATCH ANALYSIS';

  let text = '';
  text += `<b>${headerEmoji} ${headerLabel}</b>\n`;
  text += `<b>${safeHtml(rec.match_display)}</b>\n`;
  text += `${safeHtml(rec.league)}\n`;
  text += `⏱ ${safeHtml(String(rec.minute))}' | 📋 ${safeHtml(rec.score)} | ${safeHtml(rec.status)}\n`;
  text += `🤖 ${safeHtml(rec.ai_model)} | Mode: ${safeHtml(rec.mode)}\n`;
  text += '\n';

  if (section === 'ai_recommendation') {
    text += `<b>💰 Investment Idea</b>\n`;
    text += `Selection: <b>${safeHtml(rec.selection)}</b>\n`;
    text += `Market: ${safeHtml(rec.bet_market)}\n`;
    text += `Odds: ${safeHtml(String(rec.odds ?? 'N/A'))}\n`;
    text += `Confidence: ${rec.confidence}/10 | Stake: ${rec.stake_percent}%\n`;
    text += `Value: ${rec.value_percent}% | Risk: ${safeHtml(rec.risk_level)}\n`;
    text += '\n';
    text += `<b>📝 Reasoning (EN):</b>\n${safeHtml(parsed.reasoning_en)}\n\n`;
    text += `<b>📝 Reasoning (VI):</b>\n${safeHtml(parsed.reasoning_vi)}\n`;
  }

  if (section === 'condition_triggered' || parsed.custom_condition_matched) {
    text += '\n<b>⚡ Custom Condition</b>\n';
    text += `Status: ${safeHtml(parsed.custom_condition_status)}\n`;
    text += `Matched: ${parsed.custom_condition_matched ? '✅ YES' : '❌ NO'}\n`;
    text += `Summary: ${safeHtml(parsed.custom_condition_summary_en)}\n`;
    text += `Reason: ${safeHtml(parsed.custom_condition_reason_en)}\n`;

    if (parsed.condition_triggered_suggestion) {
      text += `\nSuggestion: <b>${safeHtml(parsed.condition_triggered_suggestion)}</b>\n`;
      text += `Confidence: ${parsed.condition_triggered_confidence}/10 | Stake: ${parsed.condition_triggered_stake}%\n`;
      text += `Reasoning (EN): ${safeHtml(parsed.condition_triggered_reasoning_en)}\n`;
      text += `Reasoning (VI): ${safeHtml(parsed.condition_triggered_reasoning_vi)}\n`;
    }
  }

  if (section === 'no_actionable') {
    text += `<b>📝 Analysis (EN):</b>\n${safeHtml(parsed.reasoning_en)}\n\n`;
    text += `<b>📝 Analysis (VI):</b>\n${safeHtml(parsed.reasoning_vi)}\n`;
  }

  // Stats
  if (matchData.stats_available && matchData.stats_compact) {
    text += '\n<b>📊 Live Stats</b>\n';
    const sc = matchData.stats_compact;
    for (const [key, val] of Object.entries(sc)) {
      if (val && typeof val === 'object' && 'home' in val) {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        text += `${label}: ${val.home} - ${val.away}\n`;
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
  const allWarnings = parsed.warnings || [];
  if (allWarnings.length > 0) {
    text += `\n⚠️ <b>Warnings:</b> ${safeHtml(allWarnings.join(', '))}\n`;
  }

  text += `\n<i>TFI Live Monitor | ${safeHtml(new Date().toISOString())}</i>`;

  // Chunk at 3500 chars for Telegram message limit
  const MAX_CHUNK = 3500;
  if (text.length <= MAX_CHUNK) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point (newline) within the limit
    let breakIdx = remaining.lastIndexOf('\n', MAX_CHUNK);
    if (breakIdx <= 0) breakIdx = MAX_CHUNK;

    chunks.push(remaining.substring(0, breakIdx));
    remaining = remaining.substring(breakIdx).replace(/^\n/, '');
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
 */
export async function notifyRecommendation(
  appConfig: AppConfig,
  monitorConfig: LiveMonitorConfig,
  matchData: MergedMatchData,
  parsed: ParsedAiResponse,
  recommendation: RecommendationData,
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

  // Only notify for actionable sections
  const shouldNotify =
    section === 'ai_recommendation' || section === 'condition_triggered';

  if (!shouldNotify) return result;

  // Format email
  try {
    const emailHtml = buildEmailHtml(ctx);
    const subject = section === 'ai_recommendation'
      ? `🎯 TFI: ${recommendation.match_display} | ${recommendation.selection}`
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
    const messages = buildTelegramMessages(ctx);
    result.telegramChunks = messages.length;

    for (const msg of messages) {
      const telePayload: TelegramPayload = {
        chat_id: monitorConfig.TELEGRAM_CHAT_ID,
        text: msg,
        parse_mode: 'HTML',
      };
      await sendTelegram(appConfig, telePayload);
    }

    result.telegramSent = true;
  } catch (e) {
    result.errors.push(`Telegram error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}

// Export for testing
export { buildEmailHtml as _buildEmailHtml, buildTelegramMessages as _buildTelegramMessages, determineSection as _determineSection };
