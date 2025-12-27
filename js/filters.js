// ==================== FILTERS ====================

function populateLeagueFilter() {
    console.log('populateLeagueFilter called, matchesData:', matchesData?.length);
    
    // Safety check - ensure matchesData exists and has items
    if (!matchesData || matchesData.length === 0) {
        console.log('No matches data, skipping filter population');
        const leagueFilter = document.getElementById('filter-league');
        if (leagueFilter) {
            leagueFilter.innerHTML = '<option value="">All Leagues</option>';
        }
        return;
    }
    
    const leagueSet = new Map();
    
    // Collect unique leagues from matchesData
    matchesData.forEach(match => {
        if (!leagueSet.has(match.league_id)) {
            // Use getLeagueDisplayName to include country prefix
            const displayName = typeof getLeagueDisplayName === 'function' 
                ? getLeagueDisplayName(match.league_id, match.league_name || match.league)
                : (match.league_name || match.league);
            
            leagueSet.set(match.league_id, {
                id: match.league_id,
                name: match.league_name || match.league,
                displayName: displayName,
                count: 0
            });
        }
        leagueSet.get(match.league_id).count++;
    });
    
    // Sort by match count (most matches first)
    const leagues = Array.from(leagueSet.values())
        .sort((a, b) => b.count - a.count);
    
    console.log('Found leagues:', leagues.length);
    
    // Populate dropdown
    const leagueFilter = document.getElementById('filter-league');
    if (!leagueFilter) {
        console.log('League filter element not found!');
        return;
    }
    
    const currentValue = leagueFilter.value;
    
    // Keep "All Leagues" option and add dynamic leagues with country prefix
    leagueFilter.innerHTML = '<option value="">All Leagues</option>' +
        leagues.map(league => 
            `<option value="${league.id}">${league.displayName} (${league.count})</option>`
        ).join('');
    
    console.log('League filter populated with', leagues.length, 'leagues');
    
    // Restore previous selection if it still exists
    if (currentValue && leagueSet.has(parseInt(currentValue))) {
        leagueFilter.value = currentValue;
    }
}

function handleTierChange() {
    // Removed - no longer using tier-based filtering
    filterMatches();
}

function filterMatches() {
    // Reset to first page when filters change
    if (typeof matchesPage !== 'undefined') matchesPage = 1;
    renderMatches();
}

// Debounce utility and debounced export for filter input
function debounce(fn, ms = 250) {
    let t;
    return function(...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
    };
}

// Expose a debounced version for inline handlers
window.debouncedFilterMatches = debounce(filterMatches, 250);

// ==================== SORTING ====================
function sortMatches(column) {
    // Toggle sort order
    if (currentSort.column === column) {
        currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.order = 'asc';
    }
    
    // Update sort indicators
    document.querySelectorAll('[id^="sort-"]').forEach(el => el.textContent = '');
    const indicator = currentSort.order === 'asc' ? '▲' : '▼';
    const sortEl = document.getElementById(`sort-${column}`);
    if (sortEl) sortEl.textContent = indicator;
    
    // Reset to first page and re-render with sort
    if (typeof matchesPage !== 'undefined') matchesPage = 1;
    renderMatches();
}

function sortWatchlist(column) {
    if (watchlistSort.column === column) {
        watchlistSort.order = watchlistSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        watchlistSort.column = column;
        watchlistSort.order = 'asc';
    }

    // Update indicators for watchlist headers
    document.querySelectorAll('[id^="sort-watchlist-"]').forEach(el => el.textContent = '');
    const indicator = watchlistSort.order === 'asc' ? '▲' : '▼';
    const sortEl = document.getElementById(`sort-watchlist-${column}`);
    if (sortEl) sortEl.textContent = indicator;

    // Reset page and re-render
    if (typeof watchlistPage !== 'undefined') watchlistPage = 1;
    renderWatchlist();
}

function clearAllFilters() {
    // Reset all filters
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-league').value = '';
    document.getElementById('filter-action').value = '';
    const from = document.getElementById('filter-from'); if (from) from.value = '';
    const to = document.getElementById('filter-to'); if (to) to.value = '';
    selectedLeagues.clear();
    
    filterMatches();
    showToast('🔄 Filters cleared', 'success');
}
