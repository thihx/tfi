// ==================== RENDER FUNCTIONS ====================

// Pagination settings
const PAGE_SIZE = 30;
let matchesPage = 1;
let watchlistPage = 1;
let recommendationsPage = 1;
// selection state for watchlist bulk actions (IDs)
let watchlistSelected = new Set();

// Team logos cache: Map<match_id, {home_logo, away_logo}>
const teamLogosCache = new Map();

// ==================== DATETIME CONVERSION (Seoul UTC+9 to Local) ====================
/**
 * Convert Seoul datetime (UTC+9) to local browser time
 * @param {string} dateStr - Date in YYYY-MM-DD format (Seoul time)
 * @param {string} kickoffStr - Time in HH:mm format (Seoul time)
 * @returns {Date} - JavaScript Date object in UTC that represents the match in user's local timezone
 */
function convertSeoulToLocalDateTime(dateStr, kickoffStr) {
    if (!dateStr) return new Date();
    
    // Parse date: YYYY-MM-DD
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day) return new Date();
    
    // Parse kickoff: HH:mm (Seoul time)
    let hours = 0, minutes = 0;
    if (kickoffStr) {
        const [h, m] = kickoffStr.split(':').map(Number);
        hours = h || 0;
        minutes = m || 0;
    }
    
    // Create a date in Seoul timezone (UTC+9)
    // We create a UTC date, then add 9 hours to simulate Seoul time
    const seoulDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
    
    // Seoul is UTC+9, so to get actual UTC time of when the match happens:
    // seoulDate is in UTC format but represents Seoul local time
    // We need to subtract 9 hours to get the actual UTC time
    const utcTime = new Date(seoulDate.getTime() - 9 * 60 * 60 * 1000);
    
    // Now utcTime is the actual UTC time when the match happens
    // Browser will automatically display this in user's local timezone
    return utcTime;
}

/**
 * Format a local date to display format "DD-MM HH:mm"
 * @param {Date} dateObj - JavaScript Date object
 * @returns {string} - Formatted string "DD-MM HH:mm"
 */
function formatDateTimeDisplay(dateObj) {
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
        return '';
    }
    
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    
    return `${day}-${month} ${hours}:${minutes}`;
}

// Get league display name with country prefix
function getLeagueDisplayName(league_id, league_name) {
    // If no approved leagues data loaded, return original name
    if (!approvedLeaguesData || approvedLeaguesData.length === 0) {
        return league_name || '';
    }
    
    // Lookup by league_id (ensure both sides are numbers for comparison)
    const searchId = parseInt(league_id);
    if (isNaN(searchId)) {
        return league_name || '';
    }
    
    const league = approvedLeaguesData.find(l => parseInt(l.league_id) === searchId);
    
    if (league && league.country) {
        // Format: "COUNTRY - League Name" (country in uppercase)
        const country = String(league.country).toUpperCase();
        return `${country} - ${league_name || league.league_name || ''}`;
    }
    
    // Fallback to original name
    return league_name || '';
}

// Get team logos for a match_id from cache or matchesData
function getTeamLogos(match_id) {
    const mid = String(match_id);
    
    // Check cache first
    if (teamLogosCache.has(mid)) {
        return teamLogosCache.get(mid);
    }
    
    // Try to find in matchesData
    if (typeof matchesData !== 'undefined' && Array.isArray(matchesData)) {
        const match = matchesData.find(m => String(m.match_id) === mid);
        if (match && match.home_logo && match.away_logo) {
            const logos = {
                home_logo: match.home_logo,
                away_logo: match.away_logo
            };
            // Cache it
            teamLogosCache.set(mid, logos);
            return logos;
        }
    }
    
    // Fallback to placeholders
    return {
        home_logo: PLACEHOLDER_HOME,
        away_logo: PLACEHOLDER_AWAY
    };
}

// Parse and render prediction data
function renderPrediction(predictionStr) {
    if (!predictionStr || predictionStr === '') {
        return '<div class="prediction-empty">-</div>';
    }
    
    try {
        const pred = typeof predictionStr === 'string' ? JSON.parse(predictionStr) : predictionStr;
        
        if (!pred || !pred.predictions) {
            return '<div class="prediction-empty">N/A</div>';
        }
        
        const p = pred.predictions;
        const c = pred.comparison || {};
        
        // Parse percent (home/draw/away)
        const homePercent = parseInt(p.percent?.home) || 0;
        const drawPercent = parseInt(p.percent?.draw) || 0;
        const awayPercent = parseInt(p.percent?.away) || 0;
        
        // Winner name
        const winnerName = p.winner?.name || 'N/A';
        const winnerShort = winnerName.length > 18 ? winnerName.substring(0, 15) + '...' : winnerName;
        
        // Determine winner color
        const winnerClass = winnerName.toLowerCase().includes('draw') ? 'draw' : 
                           (homePercent > awayPercent) ? 'home' : 'away';
        
        // Under/Over badge
        const underOverBadge = p.under_over ? `<span class="pred-tag">⚽ ${p.under_over}</span>` : '';
        
        // Progress bar
        const progressBar = `
            <div class="pred-bar">
                ${homePercent > 0 ? `<div class="pred-seg home" style="width:${homePercent}%"></div>` : ''}
                ${drawPercent > 0 ? `<div class="pred-seg draw" style="width:${drawPercent}%"></div>` : ''}
                ${awayPercent > 0 ? `<div class="pred-seg away" style="width:${awayPercent}%"></div>` : ''}
            </div>
        `;
        
        // Build tooltip text (for title attribute)
        const advice = p.advice || 'No advice';
        const goalsHome = p.goals?.home || '-';
        const goalsAway = p.goals?.away || '-';
        const winnerComment = p.winner?.comment ? ` (${p.winner.comment})` : '';
        
        // Comparison data
        const compForm = c.form ? `${c.form.home || '-'} vs ${c.form.away || '-'}` : '-';
        const compAtt = c.att ? `${c.att.home || '-'} vs ${c.att.away || '-'}` : '-';
        const compDef = c.def ? `${c.def.home || '-'} vs ${c.def.away || '-'}` : '-';
        const compGoals = c.goals ? `${c.goals.home || '-'} vs ${c.goals.away || '-'}` : '-';
        const compTotal = c.total ? `${c.total.home || '-'} vs ${c.total.away || '-'}` : '-';
        
        // Build detailed content for expanded view
        const detailContent = `
            <div class="pred-details">
                <div class="pred-detail-section">
                    <strong>🎯 Predictions:</strong>
                    <div class="pred-detail-item"><span>Winner:</span> <span>${escapeQuotes(winnerName)}${winnerComment}</span></div>
                    <div class="pred-detail-item"><span>Advice:</span> <span>${escapeQuotes(advice)}</span></div>
                    ${p.under_over ? `<div class="pred-detail-item"><span>Under/Over:</span> <span>${p.under_over}</span></div>` : ''}
                    <div class="pred-detail-item"><span>Goals:</span> <span>Home ${goalsHome} | Away ${goalsAway}</span></div>
                    <div class="pred-detail-item"><span>Win %:</span> <span>${homePercent}% | ${drawPercent}% | ${awayPercent}%</span></div>
                </div>
                <div class="pred-detail-section">
                    <strong>📊 Comparison (Home vs Away):</strong>
                    <div class="pred-detail-item"><span>Form:</span> <span>${compForm}</span></div>
                    <div class="pred-detail-item"><span>Attack:</span> <span>${compAtt}</span></div>
                    <div class="pred-detail-item"><span>Defense:</span> <span>${compDef}</span></div>
                    <div class="pred-detail-item"><span>Goals:</span> <span>${compGoals}</span></div>
                    <div class="pred-detail-item"><span>Total:</span> <span>${compTotal}</span></div>
                </div>
            </div>
        `;

        return `
            <details class="pred-card">
                <summary>
                    <div class="pred-box">
                        <div class="pred-row">
                            <span class="pred-winner ${winnerClass}">🏆 ${escapeQuotes(winnerShort)}</span>
                            ${underOverBadge}
                        </div>
                        ${progressBar}
                        <div class="pred-percent">${homePercent}% | ${drawPercent}% | ${awayPercent}%</div>
                    </div>
                </summary>
                ${detailContent}
            </details>
        `;
    } catch (err) {
        console.error('Failed to parse prediction:', err);
        return '<div class="prediction-empty">Error</div>';
    }
}

// Watchlist filter helpers
function filterWatchlist() {
    if (typeof watchlistPage !== 'undefined') watchlistPage = 1;
    renderWatchlist();
}

function clearWatchlistFilters() {
    const s = document.getElementById('watchlist-filter-search'); if (s) s.value = '';
    const l = document.getElementById('watchlist-filter-league'); if (l) l.value = '';
    const df = document.getElementById('watchlist-filter-from'); if (df) df.value = '';
    const dt = document.getElementById('watchlist-filter-to'); if (dt) dt.value = '';
    filterWatchlist();
}

// Debounce utility for watchlist text input
function debounce(fn, ms = 250) {
    let t;
    return function(...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
    };
}

window.debouncedFilterWatchlist = debounce(filterWatchlist, 250);

if (!window.predictionDetailsListenerAttached) {
    window.predictionDetailsListenerAttached = true;
    document.addEventListener('toggle', (event) => {
        const target = event.target;
        if (target && typeof target.matches === 'function' && target.matches('.pred-card') && target.open) {
            document.querySelectorAll('.pred-card[open]').forEach(card => {
                if (card !== target) {
                    card.removeAttribute('open');
                }
            });
        }
    });
}

// normalize various date formats to yyyy-mm-dd for comparison
function normalizeToISO(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
        const parts = s.split('/');
        const dd = parts[0].padStart(2, '0');
        const mm = parts[1].padStart(2, '0');
        const yyyy = parts[2];
        return `${yyyy}-${mm}-${dd}`;
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    return null;
}

function setPage(table, page) {
    const p = Math.max(1, parseInt(page) || 1);
    if (table === 'matches') {
        matchesPage = p;
        renderMatches();
    } else if (table === 'watchlist') {
        watchlistPage = p;
        renderWatchlist();
    } else if (table === 'recommendations') {
        recommendationsPage = p;
        renderRecommendations();
    }
}

function renderPagination(containerId, currentPage, totalPages, totalItems, tableName) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    // CSS-driven container
    container.classList.add('pagination');
    
    let html = '';

    // Prev button (icon)
    html += `<button class="prev" onclick="setPage('${tableName}', ${Math.max(1, currentPage - 1)})" aria-label="Previous page"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg></button>`;

    // Page numbers (condensed)
    const maxButtons = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = startPage + maxButtons - 1;
    if (endPage > totalPages) {
        endPage = totalPages;
        startPage = Math.max(1, endPage - maxButtons + 1);
    }

    if (startPage > 1) {
        html += `<button onclick="setPage('${tableName}', 1)">1</button>`;
        if (startPage > 2) html += `<span style="padding:6px 8px; color:var(--gray-500);">…</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
        const active = i === currentPage ? ' active' : '';
        html += `<button class="${active ? 'active' : ''}" onclick="setPage('${tableName}', ${i})">${i}</button>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span style="padding:6px 8px; color:var(--gray-500);">…</span>`;
        html += `<button onclick="setPage('${tableName}', ${totalPages})">${totalPages}</button>`;
    }

    // Next button (icon)
    html += `<button class="next" onclick="setPage('${tableName}', ${Math.min(totalPages, currentPage + 1)})" aria-label="Next page"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg></button>`;

    // Wrap with group for styling
    container.innerHTML = `<div class="page-group">${html}</div>`;
}

function renderMatches() {
    // Create Map index for fast O(1) watchlist lookups (performance optimization)
    const watchlistMap = new Map((watchlistData || []).map(w => [String(w.match_id), w]));
    
    // Apply filters
    const search = document.getElementById('filter-search')?.value?.toLowerCase() || '';
    const status = document.getElementById('filter-status')?.value || '';
    const dateFrom = document.getElementById('filter-from')?.value || '';
    const dateTo = document.getElementById('filter-to')?.value || '';
    const leagueId = document.getElementById('filter-league')?.value || '';
    const actionFilter = document.getElementById('filter-action')?.value || '';
    
    let filtered = matchesData.filter(match => {
        // Search filter
        if (search && !match.home_team.toLowerCase().includes(search) && 
            !match.away_team.toLowerCase().includes(search) &&
            !match.league_name.toLowerCase().includes(search)) {
            return false;
        }
        
        // Status filter
        if (status) {
            if (status === 'LIVE') {
                if (!LIVE_STATUSES.includes(match.status)) return false;
            } else {
                if (match.status !== status) return false;
            }
        }
        
        // Date range filter (inclusive)
        if ((dateFrom || dateTo)) {
            const iso = normalizeToISO(match.date);
            if (!iso) return false;
            if (dateFrom && iso < dateFrom) return false;
            if (dateTo && iso > dateTo) return false;
        }

        // League filter
        if (leagueId && parseInt(match.league_id) !== parseInt(leagueId)) {
            return false;
        }
        
        // Action filter (watched vs not watched)
        if (actionFilter) {
            const isWatched = watchlistMap.has(String(match.match_id));
            if (actionFilter === 'watched' && !isWatched) return false;
            if (actionFilter === 'not-watched' && isWatched) return false;
        }
        
        return true;
    });

    // Sorting
    if (currentSort && currentSort.column) {
        filtered.sort((a, b) => {
            let valA;
            let valB;
            switch (currentSort.column) {
                case 'time':
                    // Convert to local datetime for proper sorting
                    valA = convertSeoulToLocalDateTime(a.date, a.kickoff || '00:00');
                    valB = convertSeoulToLocalDateTime(b.date, b.kickoff || '00:00');
                    break;
                case 'league':
                    valA = (a.league_name || a.league || '').toLowerCase();
                    valB = (b.league_name || b.league || '').toLowerCase();
                    break;
                case 'status':
                    valA = a.status || '';
                    valB = b.status || '';
                    break;
                case 'action':
                    // Sort by watched status: not watched first (false < true)
                    const aWatched = watchlistMap.has(String(a.match_id));
                    const bWatched = watchlistMap.has(String(b.match_id));
                    valA = aWatched ? 1 : 0;
                    valB = bWatched ? 1 : 0;
                    break;
                default:
                    return 0;
            }
            if (valA < valB) return currentSort.order === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.order === 'asc' ? 1 : -1;
            return 0;
        });
    }
    
    // Render
    const tbody = document.getElementById('matches-table');
    
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="6" class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <p>No matches found</p>
                <button class="btn btn-secondary" onclick="clearAllFilters()" style="margin-top: 10px;">
                    Clear Filters
                </button>
            </td></tr>
        `;
        // Clear pagination
        renderPagination('matches-pagination', 1, 0, 0, 'matches');
        return;
    }
    // Pagination
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    // If current page exceeds total pages, go to last page (not first page)
    if (matchesPage > totalPages) matchesPage = totalPages;
    const start = (matchesPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    const rowsHtml = pageItems.map(match => {
        const statusBadge = getStatusBadge(match.status);
        const score = match.home_score !== '' && match.home_score !== null 
            ? `${match.home_score} - ${match.away_score}` 
            : '';
        const currentMinute = match.status === 'HT' ? 'HT' : (match.current_minute ? String(match.current_minute).trim() : '');
        const scoreDisplay = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 3px;">
                <div style="font-weight: 700; font-size: 12px; color: var(--gray-900);">${score}</div>
                <div style="font-size: 11px; color: var(--gray-600); font-weight: 500;">${currentMinute ? (match.status === 'HT' ? currentMinute : currentMinute + "'") : ''}</div>
            </div>
        `;
        const scoreIsEmpty = !score && !currentMinute;
            const leagueCode = getLeagueDisplayName(match.league_id, match.league_name || match.league || '');
        
        // Convert Seoul datetime to local browser time and format display
        const localDateTime = convertSeoulToLocalDateTime(match.date, match.kickoff || '00:00');
        const timeDisplay = formatDateTimeDisplay(localDateTime);
        
        // For saving to watchlist, use original kickoff format (HH:mm) in Seoul time
        let kickoffForSave = '';
        if (match.kickoff) {
            const kickoffStr = String(match.kickoff).trim();
            if (/^\d{1,2}:\d{2}/.test(kickoffStr)) {
                // Already HH:MM format
                kickoffForSave = kickoffStr;
            } else {
                kickoffForSave = kickoffStr;
            }
        }
        
        // Determine if this match is currently in-flight (pending add)
        const matchIdStr = String(match.match_id);
        const isPending = (typeof pendingAdds !== 'undefined') && pendingAdds.has(matchIdStr);
        // Check if match is in watchlist using O(1) Map lookup
        const watchItem = watchlistMap.get(matchIdStr);
        const isWatched = watchItem && (watchItem.status === 'active' || !watchItem.status);

        // If watched & active, show single disabled 'Watched' button + settings button (always visible)
        // Note: Apps Script might not return 'status' field, so check for existence OR default to active if item exists
        let watchButton;
        if (watchItem && (watchItem.status === 'active' || !watchItem.status)) {
            // Already in watchlist: show Watched + Edit settings button
            const settingsOnclick = `loadWatchlistAndEdit('${match.match_id}', '${escapeQuotes(match.home_team)}', '${escapeQuotes(match.away_team)}', '${match.date}', '${escapeQuotes(match.league_name)}', '${kickoffForSave}')`;
            watchButton = `
                <div class="watch-wrapper">
                    <button class="btn btn-success btn-sm watch-btn" disabled><span class="btn-text">✓ Watched</span></button>
                    <button class="btn btn-secondary btn-sm btn-icon" 
                        title="Update Watch with details" 
                        onclick="${settingsOnclick}">
                        📝
                    </button>
                </div>
            `;
        } else if (isPending || (watchItem && watchItem.status === 'pending')) {
            // If pending, show disabled quick-add with spinner and tooltip with time
            const addedAt = watchItem && watchItem.added_at ? new Date(watchItem.added_at) : new Date();
            const timeStr = addedAt.toLocaleString();
            watchButton = `
                <div class="watch-wrapper">
                    <button class="btn btn-primary btn-sm watch-btn" disabled title="Saving since ${timeStr}">
                        <span class="inline-spinner" style="width:14px; height:14px;"></span>
                        <span class="btn-text">Saving...</span>
                    </button>
                    <button class="btn btn-secondary btn-sm btn-icon" 
                        title="Saving..." disabled>
                        📝
                    </button>
                </div>
            `;
        } else {
            // Not in watchlist: quick add + details button
            watchButton = `
                <div class="watch-wrapper">
                    <button class="btn btn-primary btn-sm watch-btn" 
                        onclick="quickAddWatch('${match.match_id}', '${escapeQuotes(match.home_team)}', '${escapeQuotes(match.away_team)}', '${match.date}', '${escapeQuotes(match.league_name)}', '${kickoffForSave}')">
                        <span class="btn-text">+&nbsp;Watch&nbsp;&nbsp;</span>
                    </button>
                    <button class="btn btn-secondary btn-sm btn-icon" 
                        title="+ Watch with details" 
                        onclick="openAddWatchlist(${match.match_id}, '${escapeQuotes(match.home_team)}', '${escapeQuotes(match.away_team)}', '${match.date}', '${escapeQuotes(match.league_name)}', '${kickoffForSave}')">
                        📝
                    </button>
                </div>
            `;
        }
        
        const checked = (typeof matchesSelected !== 'undefined' && matchesSelected.has(String(match.match_id))) ? 'checked' : '';
        const disabledCheckbox = isWatched ? 'disabled title="Already in watchlist"' : '';
        return `
            <tr>
                <td data-label="Time" style="white-space: nowrap; text-align: center;">
                    <div class="cell-value">
                        <div class="time-status">
                            <span class="time-pill" style="background: var(--gray-200); padding: 4px 8px; border-radius: 4px; font-weight: 600; color: var(--gray-900); font-size: 13px;">${timeDisplay}</span>
                            <span class="status-inline">${statusBadge}</span>
                        </div>
                    </div>
                </td>
                <td data-label="League" style="text-align: center;">
                    <div class="cell-value"><span style="font-weight: 400;">${leagueCode}</span></div>
                </td>
                <td data-label="Match" style="text-align: center;">
                    <div class="cell-value match-cell">
                        <div class="match-teams">
                            <div class="team-info">
                            <img src="${match.home_logo}" loading="lazy" decoding="async"
                                 alt="${match.home_team}" 
                                 class="team-logo"
                                 onerror="this.src='${PLACEHOLDER_HOME}'">
                                <span style="font-weight: 400;">${match.home_team}</span>
                            </div>
                            <span class="match-vs">vs</span>
                            <div class="team-info">
                                <span style="font-weight: 400;">${match.away_team}</span>
                            <img src="${match.away_logo}" loading="lazy" decoding="async"
                                 alt="${match.away_team}" 
                                 class="team-logo"
                                 onerror="this.src='${PLACEHOLDER_AWAY}'">
                            </div>
                        </div>
                    </div>
                </td>
                <td class="select-col ${isWatched ? 'select-disabled' : ''}" data-label="Select">
                    <div class="cell-value">
                        <input class="select-checkbox" type="checkbox" data-select-id="${match.match_id}" data-home="${escapeQuotes(match.home_team)}" data-away="${escapeQuotes(match.away_team)}" data-date="${match.date}" data-league="${escapeQuotes(match.league_name || match.league || '')}" data-kickoff="${kickoffForSave}" ${checked} ${disabledCheckbox}>
                    </div>
                </td>
                <td data-label="Score" class="${scoreIsEmpty ? 'score-empty' : ''}" style="text-align: center;">
                    <div class="cell-value">
                        ${scoreDisplay}
                    </div>
                </td>
                <td data-label="Status" class="status-cell" style="text-align: center;">
                    <div class="cell-value">${statusBadge}</div>
                </td>
                <td data-label="Action" style="text-align: center;">
                    <div class="cell-value">
                        ${watchButton}
                    </div>
                </td>
            </tr>
        `;
    });

    const tbodyEl = document.getElementById('matches-table');
    batchRenderTableRows(tbodyEl, rowsHtml, () => {
        // Attach selection handlers & sync checked state from matchesSelected
        tbodyEl.querySelectorAll('.select-checkbox').forEach(cb => {
            cb.checked = matchesSelected.has(String(cb.dataset.selectId));
            cb.onclick = () => {
                toggleSelectRowMatches(cb.dataset.selectId, cb);
            };
        });
        const headerSelect = document.getElementById('matches-select-all');
        if (headerSelect) headerSelect.onclick = () => toggleSelectAllMatches(headerSelect);
        const mobileSelect = document.getElementById('matches-select-all-mobile');
        if (mobileSelect) mobileSelect.onclick = () => toggleSelectAllMatches(mobileSelect);
    });

    // Auto-deselect watched matches from selection state (using pre-built watchlistMap)
    watchlistMap.forEach((watchItem, matchId) => {
        if (watchItem.status === 'active' || !watchItem.status) {
            matchesSelected.delete(matchId);
        }
    });

    // Sync select-all checkbox and update bulk add button
    const selectAllEl = document.getElementById('matches-select-all');
    if (selectAllEl) {
        const enabledIdsOnPage = pageItems.filter(m => {
            const mid = String(m.match_id);
            return !watchlistMap.has(mid);
        }).map(i => String(i.match_id));
        const allSelected = enabledIdsOnPage.length > 0 && enabledIdsOnPage.every(id => matchesSelected.has(id));
        selectAllEl.checked = allSelected;
    }
    const selectAllMobileEl = document.getElementById('matches-select-all-mobile');
    if (selectAllMobileEl) {
        const enabledIdsOnPage = pageItems.filter(m => {
            const mid = String(m.match_id);
            return !watchlistMap.has(mid);
        }).map(i => String(i.match_id));
        const allSelected = enabledIdsOnPage.length > 0 && enabledIdsOnPage.every(id => matchesSelected.has(id));
        selectAllMobileEl.checked = allSelected;
    }
    updateAddSelectedButton();

    // Render pagination controls
    renderPagination('matches-pagination', matchesPage, Math.ceil(totalItems / PAGE_SIZE), totalItems, 'matches');

    // Render active filter badges
    const badges = [];
    if (search) badges.push({ type: 'Teams', value: search });
    if (status) badges.push({ type: 'Status', value: status });
    if (leagueId) {
        const el = document.getElementById('filter-league');
        const text = el ? el.options[el.selectedIndex]?.text || '' : '';
        badges.push({ type: 'League', value: text });
    }
    if (dateFrom || dateTo) badges.push({ type: 'Date', value: `${dateFrom || '—'} → ${dateTo || '—'}` });
    renderFilterBadges('matches-filter-badges', badges);
    updateMatchesSelectCountFromDOM();
}

// Render small filter badges (containerId must exist)
function renderFilterBadges(containerId, badges) {
    const c = document.getElementById(containerId);
    if (!c) return;
    if (!badges || badges.length === 0) {
        c.innerHTML = '';
        return;
    }
    c.innerHTML = badges.map(b => `<span class="filter-badge">${b.type}: <strong>${escapeQuotes(b.value)}</strong></span>`).join(' ');
}

function batchRenderTableRows(tbody, rows, onComplete) {
    if (!tbody) return;
    const chunkSize = 40;
    tbody.innerHTML = '';
    let idx = 0;
    const total = rows.length;

    function renderChunk() {
        const end = Math.min(idx + chunkSize, total);
        tbody.insertAdjacentHTML('beforeend', rows.slice(idx, end).join(''));
        idx = end;
        if (idx < total) {
            requestAnimationFrame(renderChunk);
        } else if (typeof onComplete === 'function') {
            onComplete();
        }
    }

    requestAnimationFrame(renderChunk);
}

// ===== Matches selection helpers =====
let matchesSelected = new Set();

function updateMatchesSelectCountFromDOM() {
    const countEls = [
        document.getElementById('matches-select-count'),
        document.getElementById('matches-select-count-desktop')
    ].filter(Boolean);
    if (countEls.length === 0) return;
    const tbody = document.getElementById('matches-table');
    if (!tbody) {
        countEls.forEach(el => el.textContent = '');
        return;
    }
    const checkboxes = Array.from(tbody.querySelectorAll('.select-checkbox:not(:disabled)'));
    const total = checkboxes.length;
    const selected = checkboxes.filter(cb => cb.checked).length;
    const text = total > 0 ? `(${selected}/${total})` : '';
    const title = total > 0 ? `${selected}/${total} selected` : '';
    countEls.forEach(el => {
        el.textContent = text;
        if (text) {
            el.setAttribute('title', title);
            el.style.display = '';
        } else {
            el.removeAttribute('title');
            el.style.display = 'none';
        }
    });
}

function getSelectedMatchRowsFromDOM() {
    // Lấy tất cả các match_id đã tick từ matchesSelected Set (toàn bộ dataset, không chỉ trang hiện tại)
    if (typeof matchesSelected === 'undefined' || matchesSelected.size === 0) return [];
    
    // Tra cứu thông tin đầy đủ từ matchesData
    const rows = [];
    matchesSelected.forEach(matchId => {
        const match = (matchesData || []).find(m => String(m.match_id) === String(matchId));
        if (match) {
            // Parse kickoff to clean HH:MM format
            let kickoffForSave = '';
            if (match.kickoff) {
                const kickoffStr = String(match.kickoff).trim();
                if (kickoffStr.includes('T') || kickoffStr.includes('Z')) {
                    const kickoffDate = new Date(kickoffStr);
                    if (!isNaN(kickoffDate.getTime())) {
                        const hours = kickoffDate.getUTCHours().toString().padStart(2, '0');
                        const minutes = kickoffDate.getUTCMinutes().toString().padStart(2, '0');
                        kickoffForSave = `${hours}:${minutes}`;
                    }
                } else if (/^\d{1,2}:\d{2}/.test(kickoffStr)) {
                    kickoffForSave = kickoffStr;
                } else {
                    kickoffForSave = kickoffStr;
                }
            }
            
            rows.push({
                match_id: String(match.match_id),
                home_team: match.home_team || '',
                away_team: match.away_team || '',
                date: match.date || '',
                league: match.league_name || match.league || '',
                kickoff: kickoffForSave
            });
        }
    });
    return rows;
}

function toggleSelectRowMatches(id, checkboxEl) {
    const sid = String(id);
    if (checkboxEl.checked) matchesSelected.add(sid);
    else matchesSelected.delete(sid);
    const tbody = document.getElementById('matches-table');
    const anyUnchecked = tbody.querySelectorAll('.select-checkbox:not(:checked):not(:disabled)').length > 0;
    const selectAllEl = document.getElementById('matches-select-all');
    const allChecked = !anyUnchecked && tbody.querySelectorAll('.select-checkbox:not(:disabled)').length > 0;
    if (selectAllEl) selectAllEl.checked = allChecked;
    const selectAllMobileEl = document.getElementById('matches-select-all-mobile');
    if (selectAllMobileEl) selectAllMobileEl.checked = allChecked;
    updateAddSelectedButton();
    updateMatchesSelectCountFromDOM();
}

function toggleSelectAllMatches(el) {
    const checked = el.checked;
    const tbody = document.getElementById('matches-table');
    const checkboxes = tbody.querySelectorAll('.select-checkbox:not(:disabled)');
    if (checked) {
        // Thêm tất cả các trận đang hiển thị vào matchesSelected, không reset các trận đã chọn trước đó
        checkboxes.forEach(cb => {
            cb.checked = true;
            const id = cb.dataset.selectId;
            if (id) matchesSelected.add(String(id));
        });
    } else {
        // Bỏ chọn tất cả các trận đang hiển thị, nhưng giữ các trận đã chọn ở điều kiện khác
        checkboxes.forEach(cb => {
            cb.checked = false;
            const id = cb.dataset.selectId;
            if (id) matchesSelected.delete(String(id));
        });
    }
    updateAddSelectedButton();

    const headerSelect = document.getElementById('matches-select-all');
    if (headerSelect && headerSelect !== el) headerSelect.checked = checked;
    const mobileSelect = document.getElementById('matches-select-all-mobile');
    if (mobileSelect && mobileSelect !== el) mobileSelect.checked = checked;
    updateMatchesSelectCountFromDOM();
}

function updateAddSelectedButton() {
    const btn = document.getElementById('matches-add-selected-btn');
    if (!btn) return;
    // Đếm tổng số trận đã tick trên toàn bộ matchesSelected
    const count = matchesSelected.size;
    if (count > 0) {
        btn.removeAttribute('disabled');
        btn.textContent = `+ Selected Watches (${count})`;
    } else {
        btn.setAttribute('disabled', 'disabled');
        btn.textContent = '+ Selected Watches';
    }
}

function clearMatchesSelection() {
    matchesSelected.clear();
    const tbody = document.getElementById('matches-table');
    if (tbody) {
        tbody.querySelectorAll('.select-checkbox').forEach(cb => cb.checked = false);
    }
    const selectAllEl = document.getElementById('matches-select-all');
    if (selectAllEl) selectAllEl.checked = false;
    updateAddSelectedButton();
}

function renderWatchlist() {
    const tbody = document.getElementById('watchlist-table');
    // Populate league filter for watchlist from current data
    const leagueSelect = document.getElementById('watchlist-filter-league');
    if (leagueSelect) {
        const prev = leagueSelect.value || '';
        const leagueMap = new Map();
        (watchlistData || []).forEach(i => {
            let leagueId = i.league_id;
            const leagueName = i.league_name || i.league || '';
            
            // If watchlist item doesn't have league_id, lookup from matchesData by match_id
            if (!leagueId && i.match_id && typeof matchesData !== 'undefined') {
                const match = matchesData.find(m => String(m.match_id) === String(i.match_id));
                if (match) {
                    leagueId = match.league_id;
                }
            }
            
            if (!leagueId) return;
            
            const key = String(leagueId);
            if (!leagueMap.has(key)) {
                // Use getLeagueDisplayName for country prefix
                const displayName = typeof getLeagueDisplayName === 'function'
                    ? getLeagueDisplayName(leagueId, leagueName)
                    : leagueName;
                
                leagueMap.set(key, { 
                    id: leagueId,
                    name: leagueName,
                    displayName: displayName,
                    count: 0 
                });
            }
            leagueMap.get(key).count++;
        });
        const leagues = Array.from(leagueMap.values()).sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));
        leagueSelect.innerHTML = '<option value="">All Leagues</option>' + leagues.map(l => `<option value="${l.id}">${l.displayName} (${l.count})</option>`).join('');
        if (prev) leagueSelect.value = prev;
    }
    
    if (!watchlistData || watchlistData.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="10" class="empty-state">
                <div class="empty-state-icon">👁️</div>
                <p>No matches in watchlist</p>
                <p><small>Go to Matches tab to add matches</small></p>
            </td></tr>
        `;
        renderPagination('watchlist-pagination', 1, 0, 0, 'watchlist');
        updateDeleteSelectedButton();
        return;
    }
    // Prepare items and apply watchlist filters (teams, league, date range)
    let items = Array.isArray(watchlistData) ? [...watchlistData] : [];

    const search = document.getElementById('watchlist-filter-search')?.value?.toLowerCase() || '';
    const dateFrom = document.getElementById('watchlist-filter-from')?.value || '';
    const dateTo = document.getElementById('watchlist-filter-to')?.value || '';
    const leagueFilter = (document.getElementById('watchlist-filter-league')?.value || '').toLowerCase();

    if (search || dateFrom || dateTo || leagueFilter) {
        items = items.filter(item => {
            // Teams + league text search
            if (search) {
                const combined = `${item.home_team || ''} ${item.away_team || ''} ${item.league_name || item.league || ''}`.toLowerCase();
                if (!combined.includes(search)) return false;
            }

            // League filter (match by effective league_id, with matchesData fallback)
            if (leagueFilter) {
                let effectiveLeagueId = item.league_id;
                if (!effectiveLeagueId && item.match_id && typeof matchesData !== 'undefined') {
                    const match = matchesData.find(m => String(m.match_id) === String(item.match_id));
                    if (match) effectiveLeagueId = match.league_id;
                }
                if (String(effectiveLeagueId) !== String(leagueFilter)) return false;
            }

            // Date range filter: compare normalized ISO date (yyyy-mm-dd)
            if (dateFrom || dateTo) {
                const iso = normalizeToISO(item.date);
                if (!iso) return false;
                if (dateFrom && iso < dateFrom) return false;
                if (dateTo && iso > dateTo) return false;
            }

            return true;
        });
    }

    // Sorting (use watchlistSort state)
    if (typeof watchlistSort !== 'undefined' && watchlistSort.column) {
        items.sort((a, b) => {
            let valA, valB;
            switch (watchlistSort.column) {
                case 'kickoff':
                    // Sort by full datetime (date + kickoff) converted from Seoul to local time
                    valA = convertSeoulToLocalDateTime(a.date, a.kickoff || '00:00');
                    valB = convertSeoulToLocalDateTime(b.date, b.kickoff || '00:00');
                    break;
                case 'league':
                    valA = (a.league || '').toLowerCase();
                    valB = (b.league || '').toLowerCase();
                    break;
                case 'match':
                    valA = (`${a.home_team || ''} vs ${a.away_team || ''}`).toLowerCase();
                    valB = (`${b.home_team || ''} vs ${b.away_team || ''}`).toLowerCase();
                    break;
                case 'mode':
                    valA = a.mode || '';
                    valB = b.mode || '';
                    break;
                case 'priority':
                    valA = parseInt(a.priority) || 0;
                    valB = parseInt(b.priority) || 0;
                    break;
                case 'status':
                    valA = (a.status || '').toLowerCase();
                    valB = (b.status || '').toLowerCase();
                    break;
                default:
                    return 0;
            }

            if (valA < valB) return watchlistSort.order === 'asc' ? -1 : 1;
            if (valA > valB) return watchlistSort.order === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // Pagination
    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    if (watchlistPage > totalPages) watchlistPage = 1;
    const start = (watchlistPage - 1) * PAGE_SIZE;
    const pageItems = items.slice(start, start + PAGE_SIZE);

    const rowsHtml = pageItems.map(item => {
        // Use match_id as the primary identifier (Apps Script returns match_id, not separate id)
        if (!item.match_id) {
            console.error('Watchlist item missing match_id:', item);
            return ''; // Skip this item
        }
        const modeBadge = `<span class="badge" style="background: ${
            item.mode === 'A' ? '#fef3c7' : 
            item.mode === 'B' ? '#dbeafe' : '#d1fae5'
        }; color: ${
            item.mode === 'A' ? '#92400e' : 
            item.mode === 'B' ? '#1e40af' : '#065f46'
        }">${item.mode}</span>`;

        const p = Math.max(1, Math.min(3, parseInt(item.priority) || 2));
        const priorityStars = '⭐'.repeat(p);

        // Status display: pending shows yellow badge with spinner, active shows green badge
        let statusHtml = '';
        if (item.status === 'pending') {
            statusHtml = `<span class="badge" style="background: #fef3c7; color: #92400e;"><span class="inline-spinner"></span>🟡 Pending</span>`;
        } else {
            statusHtml = `<span class="badge" style="background: #d1fae5; color: #065f46;">🟢 Active</span>`;
        }

        const checked = watchlistSelected.has(String(item.match_id)) ? 'checked' : '';

        // Get team logos from cache or matchesData
        const logos = getTeamLogos(item.match_id);
        const homeLogo = logos.home_logo;
        const awayLogo = logos.away_logo;

        // Format datetime: convert Seoul to local and format as "DD-MM HH:mm"
        const localDateTime = convertSeoulToLocalDateTime(item.date, item.kickoff || '00:00');
        const timeDisplay = formatDateTimeDisplay(localDateTime);

        // League display: get league_id from item or lookup from matchesData by match_id
        let leagueId = item.league_id;
        if (!leagueId && item.match_id && typeof matchesData !== 'undefined') {
            const match = matchesData.find(m => String(m.match_id) === String(item.match_id));
            if (match) {
                leagueId = match.league_id;
            }
        }
        const leagueCode = getLeagueDisplayName(leagueId, item.league_name || item.league || '');

        // Render prediction data
        const predictionHtml = renderPrediction(item.prediction || '');

        return `
            <tr>
                <td data-label="Time" style="white-space: nowrap; text-align: center;">
                    <div class="cell-value">
                        <span style="background: var(--gray-200); padding: 4px 8px; border-radius: 4px; font-weight: 600; color: var(--gray-900); font-size: 13px;">${timeDisplay}</span>
                    </div>
                </td>
                <td data-label="League" style="text-align: center;">
                    <div class="cell-value"><span style="font-weight: 400;">${leagueCode}</span></div>
                </td>
                <td data-label="Match" style="text-align: center;">
                    <div class="cell-value match-cell">
                        <div class="match-teams">
                            <div class="team-info">
                                <img src="${homeLogo}" loading="lazy" decoding="async"
                                     alt="${item.home_team || ''}" 
                                     class="team-logo"
                                     onerror="this.src='${PLACEHOLDER_HOME}'">
                                <span style="font-weight: 400;">${item.home_team || ''}</span>
                            </div>
                            <span class="match-vs">vs</span>
                            <div class="team-info">
                                <span style="font-weight: 400;">${item.away_team || ''}</span>
                                <img src="${awayLogo}" loading="lazy" decoding="async"
                                     alt="${item.away_team || ''}" 
                                     class="team-logo"
                                     onerror="this.src='${PLACEHOLDER_AWAY}'">
                            </div>
                        </div>
                    </div>
                </td>
                <td class="select-col" data-label="Select">
                    <div class="cell-value">
                        <input class="select-checkbox" type="checkbox" data-select-id="${item.match_id}" ${checked}>
                    </div>
                </td>
                <td data-label="Mode">
                    <div class="cell-value">${modeBadge}</div>
                </td>
                <td data-label="Priority" style="text-align: center;">
                    <div class="cell-value">${priorityStars}</div>
                </td>
                <td data-label="Prediction" style="text-align: center;">
                    <div class="cell-value">${predictionHtml}</div>
                </td>
                <td data-label="Condition" style="text-align: center;">
                    <div class="cell-value"><small style="white-space: normal;">${item.custom_conditions || '-'}</small></div>
                </td>
                <td data-label="Status" class="status-cell" style="text-align: center;">
                    <div class="cell-value">${statusHtml}</div>
                </td>
                <td data-label="Actions" style="text-align: center;">
                    <div class="cell-value">
                        <div style="display: inline-flex; gap: 6px; align-items: center;">
                            <button class="btn btn-secondary btn-sm action-icon-btn" 
                                    onclick="openEditWatchlist('${item.match_id}', '${(item.home_team || '').replace(/'/g, "\'")}', '${(item.away_team || '').replace(/'/g, "\'")}', '${item.date || ''}', '${(item.league_name || item.league || '').replace(/'/g, "\'")}', '${item.kickoff || ''}', '${item.mode || 'B'}', '${item.priority || 2}', '${(item.custom_conditions || '').replace(/'/g, "\'")}', '${item.status || 'active'}', '${(item.recommended_custom_condition || '').replace(/'/g, "\'")}', '${(item.recommended_condition_reason_vi || '').replace(/'/g, "\'")}')"
                                    aria-label="Edit watchlist">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M12 20h9"></path>
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
                                </svg>
                            </button>
                            <button class="btn btn-secondary btn-sm btn-delete-row action-icon-btn" data-delete-id="${item.match_id}" aria-label="Delete watchlist">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                                    <path d="M10 11v6"></path>
                                    <path d="M14 11v6"></path>
                                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });

    const tbodyEl = document.getElementById('watchlist-table');
    batchRenderTableRows(tbodyEl, rowsHtml, () => {
        // Attach selection handlers & sync checked state from watchlistSelected
        tbodyEl.querySelectorAll('.select-checkbox').forEach(cb => {
            cb.checked = watchlistSelected.has(String(cb.dataset.selectId));
            cb.onclick = () => {
                toggleSelectRowWatchlist(cb.dataset.selectId, cb);
            };
        });

        const headerSelect = document.getElementById('watchlist-select-all');
        if (headerSelect) headerSelect.onclick = () => toggleSelectAllWatchlist(headerSelect);
        const mobileSelect = document.getElementById('watchlist-select-all-mobile');
        if (mobileSelect) mobileSelect.onclick = () => toggleSelectAllWatchlist(mobileSelect);
    });
    // keep select-all header checkbox in sync for current page
    const selectAllEl = document.getElementById('watchlist-select-all');
    if (selectAllEl) {
        const allIdsOnPage = pageItems.map(i => String(i.match_id));
        const allSelected = allIdsOnPage.length > 0 && allIdsOnPage.every(id => watchlistSelected.has(id));
        selectAllEl.checked = allSelected;
    }
    const selectAllMobileEl = document.getElementById('watchlist-select-all-mobile');
    if (selectAllMobileEl) {
        const allIdsOnPage = pageItems.map(i => String(i.match_id));
        const allSelected = allIdsOnPage.length > 0 && allIdsOnPage.every(id => watchlistSelected.has(id));
        selectAllMobileEl.checked = allSelected;
    }

    renderPagination('watchlist-pagination', watchlistPage, Math.ceil(totalItems / PAGE_SIZE), totalItems, 'watchlist');
    updateDeleteSelectedButton();

    // Render active filter badges for watchlist
    const watchBadges = [];
    if (search) watchBadges.push({ type: 'Teams', value: search });
    if (leagueFilter) watchBadges.push({ type: 'League', value: document.getElementById('watchlist-filter-league')?.value || '' });
    if (dateFrom || dateTo) watchBadges.push({ type: 'Date', value: `${dateFrom || '—'} → ${dateTo || '—'}` });
    renderFilterBadges('watchlist-filter-badges', watchBadges);
    updateWatchlistSelectCountFromDOM();
}

function updateWatchlistSelectCountFromDOM() {
    const countEls = [
        document.getElementById('watchlist-select-count'),
        document.getElementById('watchlist-select-count-desktop')
    ].filter(Boolean);
    if (countEls.length === 0) return;
    const tbody = document.getElementById('watchlist-table');
    if (!tbody) {
        countEls.forEach(el => el.textContent = '');
        return;
    }
    const checkboxes = Array.from(tbody.querySelectorAll('.select-checkbox'));
    const total = checkboxes.length;
    const selected = checkboxes.filter(cb => cb.checked).length;
    const text = total > 0 ? `(${selected}/${total})` : '';
    const title = total > 0 ? `${selected}/${total} selected` : '';
    countEls.forEach(el => {
        el.textContent = text;
        if (text) {
            el.setAttribute('title', title);
            el.style.display = '';
        } else {
            el.removeAttribute('title');
            el.style.display = 'none';
        }
    });
}

function toggleSelectRowWatchlist(id, checkboxEl) {
    if (checkboxEl.checked) watchlistSelected.add(id);
    else watchlistSelected.delete(id);
    // update header checkbox state
    const tbody = document.getElementById('watchlist-table');
    const anyUnchecked = tbody.querySelectorAll('.select-checkbox:not(:checked)').length > 0;
    const selectAllEl = document.getElementById('watchlist-select-all');
    const allChecked = !anyUnchecked && tbody.querySelectorAll('.select-checkbox').length > 0;
    if (selectAllEl) selectAllEl.checked = allChecked;
    const selectAllMobileEl = document.getElementById('watchlist-select-all-mobile');
    if (selectAllMobileEl) selectAllMobileEl.checked = allChecked;
    updateDeleteSelectedButton();
    updateWatchlistSelectCountFromDOM();
}

function toggleSelectAllWatchlist(el) {
    const checked = el.checked;
    const tbody = document.getElementById('watchlist-table');
    const checkboxes = tbody.querySelectorAll('.select-checkbox');
    if (checked) {
        // Thêm tất cả các trận đang hiển thị vào watchlistSelected, không reset các trận đã chọn trước đó
        checkboxes.forEach(cb => {
            cb.checked = true;
            const id = cb.dataset.selectId;
            if (id) watchlistSelected.add(String(id));
        });
    } else {
        // Bỏ chọn tất cả các trận đang hiển thị, nhưng giữ các trận đã chọn ở điều kiện khác
        checkboxes.forEach(cb => {
            cb.checked = false;
            const id = cb.dataset.selectId;
            if (id) watchlistSelected.delete(String(id));
        });
    }
    updateDeleteSelectedButton();

    const headerSelect = document.getElementById('watchlist-select-all');
    if (headerSelect && headerSelect !== el) headerSelect.checked = checked;
    const mobileSelect = document.getElementById('watchlist-select-all-mobile');
    if (mobileSelect && mobileSelect !== el) mobileSelect.checked = checked;
    updateWatchlistSelectCountFromDOM();
}

function updateDeleteSelectedButton() {
    const btn = document.getElementById('watchlist-delete-btn');
    if (!btn) return;
    // Đếm tổng số trận đã tick trên toàn bộ watchlistSelected
    const checkedCount = watchlistSelected.size;
    if (checkedCount > 0) {
        btn.removeAttribute('disabled');
        btn.textContent = `Delete Selected Matches (${checkedCount})`;
    } else {
        btn.setAttribute('disabled', 'disabled');
        btn.textContent = 'Delete Selected Matches';
    }
}

function getSelectedMatchIdsFromDOM() {
    // Lấy tất cả các match_id đã tick từ watchlistSelected Set (toàn bộ dataset, không chỉ trang hiện tại)
    return Array.from(watchlistSelected).filter(Boolean);
}

// UI-only bulk delete: removes selected items from client state and re-renders.
async function deleteSelectedUI() {
    // Lấy tất cả các watchlist IDs đã tick từ watchlistSelected Set
    const watchlistIds = Array.from(watchlistSelected).filter(Boolean);
    console.log('deleteSelectedUI: selected watchlist IDs =', watchlistIds);
    if (!watchlistIds || watchlistIds.length === 0) {
        showToast('No items selected', 'info');
        return;
    }

    // Optimistic UI: remove selected items locally immediately for snappy UX
    const previous = Array.isArray(watchlistData) ? [...watchlistData] : [];
    console.log('deleteSelectedUI: previous state count =', previous.length);
    watchlistData = (watchlistData || []).filter(w => !watchlistIds.includes(String(w.match_id)));
    console.log('deleteSelectedUI: after optimistic delete, count =', watchlistData.length);
    renderWatchlist();
    if (typeof renderMatches === 'function') renderMatches();

    // Clear header select-all checkbox
    const selectAllEl = document.getElementById('watchlist-select-all');
    if (selectAllEl) selectAllEl.checked = false;

    // Call API-backed delete and handle discrepancy in response inside API function
    try {
        console.log('deleteSelectedUI: calling deleteWatchlistItems with watchlist IDs', watchlistIds);
        await deleteWatchlistItems(watchlistIds, { previousState: previous });
        console.log('deleteSelectedUI: delete completed successfully');
        // Clear selection after successful delete
        watchlistSelected.clear();
        updateDeleteSelectedButton();
    } catch (err) {
        // On error, roll back to previous state
        console.error('Bulk delete failed, rolling back', err);
        watchlistData = previous;
        renderWatchlist();
        if (typeof renderMatches === 'function') renderMatches();
        throw err;
    }
}

let recommendationsVirtualState = {
    rowHeight: 56,
    overscan: 6,
    attached: false,
    measured: false,
    container: null,
    tbody: null
};

function renderRecommendationRow(rec) {
    const resultBadge = rec.result ? getStatusBadge(rec.result.toUpperCase()) : '-';
    const pnl = rec.pnl ? `${rec.pnl >= 0 ? '+' : ''}$${parseFloat(rec.pnl).toFixed(2)}` : '-';
    const confidence = rec.confidence ? `${(parseFloat(rec.confidence) * 100).toFixed(0)}%` : '-';
    return `
        <tr class="rec-row">
            <td data-label="Time"><span class="cell-value">${rec.created_at ? new Date(rec.created_at).toLocaleString('vi-VN') : '-'}</span></td>
            <td data-label="Match"><span class="cell-value match-cell">${rec.match_display || 'N/A'}</span></td>
            <td data-label="Bet Type"><span class="cell-value">${rec.bet_type || '-'}</span></td>
            <td data-label="Selection"><span class="cell-value"><strong>${rec.selection || '-'}</strong></span></td>
            <td data-label="Odds"><span class="cell-value"><strong>${rec.odds || '-'}</strong></span></td>
            <td data-label="Confidence"><span class="cell-value">${confidence}</span></td>
            <td data-label="Stake"><span class="cell-value">$${rec.stake_amount || '0'}</span></td>
            <td data-label="Result"><span class="cell-value">${resultBadge}</span></td>
            <td data-label="P/L">
                <span class="cell-value" style="font-weight: 700; color: ${rec.pnl >= 0 ? 'var(--success)' : 'var(--danger)'}">
                    ${pnl}
                </span>
            </td>
        </tr>
    `;
}

function renderRecommendationsPaged() {
    const tbody = document.getElementById('recommendations-table');
    if (!tbody) return;
    const totalItems = recommendationsData.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    if (recommendationsPage > totalPages) recommendationsPage = 1;
    const start = (recommendationsPage - 1) * PAGE_SIZE;
    const pageItems = recommendationsData.slice(start, start + PAGE_SIZE);
    tbody.innerHTML = pageItems.map(renderRecommendationRow).join('');
    renderPagination('recommendations-pagination', recommendationsPage, Math.ceil(totalItems / PAGE_SIZE), totalItems, 'recommendations');
}

function renderRecommendationsVirtualWindow() {
    const { container, tbody, rowHeight, overscan } = recommendationsVirtualState;
    if (!container || !tbody) return;
    const total = recommendationsData.length;
    const viewportHeight = container.clientHeight || 0;
    const scrollTop = container.scrollTop || 0;
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const endIndex = Math.min(total, startIndex + visibleCount);
    const before = startIndex * rowHeight;
    const after = (total - endIndex) * rowHeight;
    const rows = recommendationsData.slice(startIndex, endIndex).map(renderRecommendationRow).join('');
    tbody.innerHTML = `
        <tr class="spacer-row"><td colspan="9" style="height:${before}px"></td></tr>
        ${rows}
        <tr class="spacer-row"><td colspan="9" style="height:${after}px"></td></tr>
    `;

    if (!recommendationsVirtualState.measured) {
        requestAnimationFrame(() => {
            const firstRow = tbody.querySelector('.rec-row');
            if (firstRow && firstRow.offsetHeight) {
                recommendationsVirtualState.rowHeight = firstRow.offsetHeight;
                recommendationsVirtualState.measured = true;
                renderRecommendationsVirtualWindow();
            }
        });
    }
}

function ensureRecommendationsVirtual() {
    const tbody = document.getElementById('recommendations-table');
    if (!tbody) return;
    const container = tbody.closest('.table-container');
    recommendationsVirtualState.container = container;
    recommendationsVirtualState.tbody = tbody;
    if (!recommendationsVirtualState.attached && container) {
        container.addEventListener('scroll', renderRecommendationsVirtualWindow);
        window.addEventListener('resize', renderRecommendationsVirtualWindow);
        recommendationsVirtualState.attached = true;
    }
}

function renderRecommendations() {
    const tbody = document.getElementById('recommendations-table');
    if (!tbody) return;

    if (recommendationsData.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="9" class="empty-state">
                <div class="empty-state-icon">dYZ_</div>
                <p>No recommendations yet</p>
                <p><small>Add matches to watchlist for AI analysis</small></p>
            </td></tr>
        `;
        renderPagination('recommendations-pagination', 1, 0, 0, 'recommendations');
        return;
    }

    const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
        renderRecommendationsPaged();
        return;
    }

    ensureRecommendationsVirtual();
    const paginationEl = document.getElementById('recommendations-pagination');
    if (paginationEl) paginationEl.innerHTML = '';
    renderRecommendationsVirtualWindow();
}

