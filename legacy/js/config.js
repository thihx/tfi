// ==================== APPLICATION STATE ====================
let CONFIG = {
    webhookUrl: localStorage.getItem('webhookUrl') || 'https://thihx.app.n8n.cloud',
    defaultMode: localStorage.getItem('defaultMode') || 'B',
    // Google Apps Script Web App endpoint for Matches
    appsScriptUrl: 'https://script.google.com/macros/s/AKfycbzxNlvzyCsbIng-4rhwzdz6Y9lWyJL9J9gCG25qtjPQ1Zjra9h76qAZMcynqMcR3w8k/exec',
    apiKey: '3a28a55b9fcabc0f5d46c0139b4f1f23919cbcc46718ef12'
};

let matchesData = [];
let watchlistData = [];
let recommendationsData = [];
let selectedLeagues = new Set(); // For custom league filter

// Sort state
let currentSort = { column: 'time', order: 'asc' };
// Separate sort state for watchlist table
let watchlistSort = { column: 'kickoff', order: 'asc' };

// ==================== HELPERS ====================
function saveConfig() {
    localStorage.setItem('webhookUrl', CONFIG.webhookUrl);
    localStorage.setItem('defaultMode', CONFIG.defaultMode);
}

function getConfig() {
    return CONFIG;
}

function updateConfig(key, value) {
    CONFIG[key] = value;
    saveConfig();
}

// ==================== UTILITY FUNCTIONS ====================
function escapeQuotes(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('vi-VN');
}

function formatDateTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString('vi-VN');
}

function getStatusBadge(status) {
    const statusInfo = STATUS_BADGES[status] || { label: status, class: '' };
    return `<span class="badge ${statusInfo.class}">${statusInfo.label}</span>`;
}

function getCountryFromLeague(leagueId) {
    return TOP_LEAGUES[leagueId]?.country || 'Other';
}

function getTierBadge(leagueId) {
    const tier = TOP_LEAGUES[leagueId]?.tier;
    if (!tier) return '';
    return `<span class="badge" style="margin-left: 5px; font-size: 10px;">Tier ${tier}</span>`;
}
