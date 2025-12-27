// ==================== API FUNCTIONS ====================

// Track in-flight quick-add requests by match_id so Matches can show pending state
var pendingAdds = new Set();

// Approved Leagues data cache (loaded once per session)
var approvedLeaguesData = null;
var approvedLeaguesLoaded = false;

async function loadMatches() {
    try {
        // Build Google Apps Script URL with query parameters
        const url = new URL(CONFIG.appsScriptUrl);
        url.searchParams.set('resource', 'matches');
        url.searchParams.set('action', 'getAll');
        url.searchParams.set('apiKey', CONFIG.apiKey);
        
        // Try with credentials: 'omit' and redirect: 'follow' for Apps Script compatibility
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            mode: 'cors',
            credentials: 'omit',
            redirect: 'follow'
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error response body:', errorText);
            throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
        }
        
        const responseText = await response.text();
        
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (parseError) {
            console.error('JSON parse error:', parseError);
            throw new Error(`Failed to parse JSON: ${parseError.message}. Response: ${responseText.substring(0, 200)}`);
        }
        
        // Extract items array from Apps Script response format
        if (!result.items) {
            console.error('No items field in response');
            throw new Error('Invalid response format: missing "items" field');
        }
        
        matchesData = result.items || [];
        
        // Populate league filter with actual data
        populateLeagueFilter();
        
        // Safe invoke renderMatches; if not loaded yet, retry shortly
        if (typeof renderMatches === 'function') {
            renderMatches();
            // Re-render Watchlist to enrich with logos from matchesData
            if (typeof renderWatchlist === 'function' && watchlistData && watchlistData.length > 0) {
                renderWatchlist();
            }
        } else {
            setTimeout(() => {
                if (typeof renderMatches === 'function') {
                    renderMatches();
                    // Re-render Watchlist after retry
                    if (typeof renderWatchlist === 'function' && watchlistData && watchlistData.length > 0) {
                        renderWatchlist();
                    }
                }
            }, 100);
        }
    } catch (error) {
        console.error('Error loading matches:', error.message);
        
        let errorMsg = 'Failed to load matches.';
        if (error.message.includes('CORS') || error.message.includes('NetworkError')) {
            errorMsg += ' CORS error - check Apps Script settings.';
        } else if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
            errorMsg += ' Network error - check Apps Script URL and CORS settings.';
            errorMsg += ` Details: ${error.message}`;
        } else {
            errorMsg += ` Error: ${error.message}`;
        }
        document.getElementById('matches-table').innerHTML = `
            <tr><td colspan="6" class="empty-state">
                <div class="empty-state-icon">❌</div>
                <p>${errorMsg}</p>
                <p><small>Apps Script endpoint: ${CONFIG.appsScriptUrl}</small></p>
                <p><small style="color: red;">${error.message}</small></p>
            </td></tr>
        `;
    }
}

// Quick add to watchlist with optimistic UI and background webhook call
async function quickAddWatch(match_id, home_team, away_team, date, league_name, kickoff) {
    // Use pendingAdds to avoid adding to watchlist UI until server confirms
    try {
        if (!watchlistData) watchlistData = [];
        const mid = String(match_id);
        if (watchlistData.some(w => String(w.match_id) === mid)) {
            showToast('✓ Already in watchlist', 'success');
            return;
        }
        if (pendingAdds.has(mid)) {
            showToast('Saving... (already in progress)', 'info');
            return;
        }

        // Mark as in-flight and update Matches UI to show pending
        pendingAdds.add(mid);
        if (typeof renderMatches === 'function') renderMatches();
        showToast('Added to watchlist (saving...)', 'success');

        const payload = {
            match_id: mid,
            date: date || '',
            league: league_name || '',
            home_team: home_team || '',
            away_team: away_team || '',
            kickoff: kickoff || '',
            mode: CONFIG.defaultMode || 'B',
            priority: 2,
            custom_conditions: '',
            status: 'active'
        };

        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const maxAttempts = 3;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Build Google Apps Script POST request for creating watchlist item
                const requestBody = {
                    apiKey: CONFIG.apiKey,
                    resource: 'watchlist',
                    action: 'create',
                    data: [payload]  // Wrap single item in array
                };
                
                const response = await fetch(CONFIG.appsScriptUrl, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'text/plain;charset=utf-8'
                    },
                    body: JSON.stringify(requestBody)
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('quickAddWatch error response:', errorText);
                    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
                }
                
                const result = await response.json();
                
                // Apps Script returns: { resource, action, insertedCount, items: [...] }
                if (result && result.insertedCount > 0) {
                    // Success: remove from pending and reload watchlist from server
                    pendingAdds.delete(mid);
                    await loadWatchlist();
                    if (typeof renderMatches === 'function') renderMatches();
                    showToast('✅ Added to watchlist', 'success');
                    lastError = null;
                    break;
                } else {
                    console.error('quickAddWatch unexpected result:', result);
                    lastError = new Error('Apps Script returned unsuccessful result: ' + JSON.stringify(result));
                    throw lastError;
                }
            } catch (err) {
                console.error(`quickAddWatch attempt ${attempt} failed for ${mid}`, err);
                lastError = err;
                if (attempt < maxAttempts) {
                    await sleep(300 * Math.pow(2, attempt - 1));
                    continue;
                }
            }
        }

        if (lastError) {
            // All attempts failed — remove pending state and notify
            pendingAdds.delete(mid);
            if (typeof renderMatches === 'function') renderMatches();
            showToast('❌ Failed to add to watchlist (network). Please try again.', 'error');
        }
    } catch (err) {
        console.error('quickAddWatch error', err);
        pendingAdds.delete(String(match_id));
        if (typeof renderMatches === 'function') renderMatches();
        showToast('❌ Error saving watchlist: ' + (err.message || ''), 'error');
    }
}

async function loadWatchlist() {
    try {
        // Build Google Apps Script URL for watchlist getAll
        const url = new URL(CONFIG.appsScriptUrl);
        url.searchParams.set('resource', 'watchlist');
        url.searchParams.set('action', 'getAll');
        url.searchParams.set('apiKey', CONFIG.apiKey);
        
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            mode: 'cors',
            credentials: 'omit',
            redirect: 'follow'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        // Extract items array from Apps Script response
        watchlistData = result.items || [];
        
        if (typeof watchlistPage !== 'undefined') watchlistPage = 1;
        renderWatchlist();
        // Ensure Matches UI updates to reflect watchlist state (so Watched shows without manual refresh)
        if (typeof renderMatches === 'function') renderMatches();
    } catch (error) {
        console.error('Error loading watchlist:', error);
        // On error, show friendly empty state in the table but keep an error toast
        watchlistData = [];
        renderWatchlist();
        showToast('Failed to load watchlist (showing empty).', 'error');
    }
}

async function loadRecommendations() {
    try {
        // Build Google Apps Script URL for recommendations getAll
        const url = new URL(CONFIG.appsScriptUrl);
        url.searchParams.set('resource', 'recommendations');
        url.searchParams.set('action', 'getAll');
        url.searchParams.set('apiKey', CONFIG.apiKey);
        
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            mode: 'cors',
            credentials: 'omit',
            redirect: 'follow'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        // Extract items array from Apps Script response
        recommendationsData = result.items || [];
        
        if (typeof recommendationsPage !== 'undefined') recommendationsPage = 1;
        renderRecommendations();
    } catch (error) {
        console.error('Error loading recommendations:', error);
        document.getElementById('recommendations-table').innerHTML = `
            <tr><td colspan="9" class="empty-state">
                <div class="empty-state-icon">❌</div>
                <p>Failed to load recommendations.</p>
            </td></tr>
        `;
    }
}

async function loadApprovedLeagues() {
    // Only load once per session (cache until page refresh)
    if (approvedLeaguesLoaded) {
        return;
    }
    
    try {
        const url = new URL(CONFIG.appsScriptUrl);
        url.searchParams.set('resource', 'approved_leagues');
        url.searchParams.set('action', 'getAll');
        url.searchParams.set('apiKey', CONFIG.apiKey);
        
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            mode: 'cors',
            credentials: 'omit',
            redirect: 'follow'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        approvedLeaguesData = result.items || [];
        approvedLeaguesLoaded = true;
    } catch (error) {
        console.error('Error loading Approved_Leagues:', error);
        // Set empty array on error but mark as loaded to avoid retrying
        approvedLeaguesData = [];
        approvedLeaguesLoaded = true;
    }
}

async function loadAllData() {
    if (typeof showGlobalLoader === 'function') {
        showGlobalLoader('Loading data...');
        setGlobalLoaderProgress(10, 'Loading data...');
    }

    try {
        // Load Approved Leagues first (needed for country prefixes in rendering)
        await loadApprovedLeagues();
        if (typeof setGlobalLoaderProgress === 'function') setGlobalLoaderProgress(25, 'Leagues loaded');

        // Then load other resources in parallel
        const tasks = [];
        
        tasks.push(
            loadMatches().then(() => {
                if (typeof setGlobalLoaderProgress === 'function') setGlobalLoaderProgress(60, 'Matches loaded');
            }).catch(() => {
                if (typeof setGlobalLoaderProgress === 'function') setGlobalLoaderProgress(60, 'Matches loaded (partial)');
            })
        );
        
        tasks.push(
            loadWatchlist().then(() => {
                if (typeof setGlobalLoaderProgress === 'function') setGlobalLoaderProgress(80, 'Watchlist loaded');
            }).catch(() => {
                if (typeof setGlobalLoaderProgress === 'function') setGlobalLoaderProgress(80, 'Watchlist loaded (partial)');
            })
        );
        
        tasks.push(
            loadRecommendations().then(() => {
                if (typeof setGlobalLoaderProgress === 'function') setGlobalLoaderProgress(95, 'Recommendations loaded');
            }).catch(() => {
                if (typeof setGlobalLoaderProgress === 'function') setGlobalLoaderProgress(95, 'Recommendations loaded (partial)');
            })
        );

        await Promise.all(tasks);

        if (typeof updateDashboard === 'function') {
            updateDashboard();
        }

        if (typeof setGlobalLoaderProgress === 'function') setGlobalLoaderProgress(100, 'Ready');
    } finally {
        if (typeof hideGlobalLoader === 'function') {
            hideGlobalLoader();
        }
    }
}

// Bulk add selected matches to watchlist
async function addSelectedMatchesToWatchlist() {
    try {
        const selected = (typeof getSelectedMatchRowsFromDOM === 'function') ? getSelectedMatchRowsFromDOM() : [];
        if (!selected || selected.length === 0) {
            showToast('No matches selected', 'info');
            return;
        }

        // Filter out ones already in watchlist
        const existingIds = new Set((watchlistData || []).map(w => String(w.match_id)));
        const items = selected.filter(s => !existingIds.has(String(s.match_id))).map(s => ({
            match_id: String(s.match_id),
            date: s.date || '',
            league: s.league || '',
            home_team: s.home_team || '',
            away_team: s.away_team || '',
            kickoff: s.kickoff || '',
            mode: CONFIG.defaultMode || 'B',
            priority: 2,
            custom_conditions: '',
            status: 'active'
        }));

        if (items.length === 0) {
            showToast('All selected matches are already in watchlist', 'success');
            return;
        }

        // Optimistic UI: add items locally
        const now = new Date().toISOString();
        watchlistData = (watchlistData || []).concat(items.map(i => ({ ...i, added_at: now })));
        if (typeof renderWatchlist === 'function') renderWatchlist();
        if (typeof renderMatches === 'function') renderMatches();
        showToast(`Adding ${items.length} match(es) to watchlist...`, 'success');

        // POST create with array payload
        const requestBody = {
            apiKey: CONFIG.apiKey,
            resource: 'watchlist',
            action: 'create',
            data: items
        };

        const response = await fetch(CONFIG.appsScriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const result = await response.json();

        if (result && result.insertedCount >= 0) {
            showToast(`✅ Added ${result.insertedCount} match(es) to watchlist`, 'success');
            // Clear selection after successful add
            if (typeof clearMatchesSelection === 'function') clearMatchesSelection();
            await loadWatchlist();
            if (typeof renderMatches === 'function') renderMatches();
        } else {
            showToast('❌ Failed to add selected matches', 'error');
        }
    } catch (err) {
        console.error('addSelectedMatchesToWatchlist error', err);
        showToast('❌ Error: ' + (err.message || ''), 'error');
    }
}

function refreshData() {
    loadAllData();
    showToast('🔄 Data refreshed!', 'success');
}

async function submitWatchlist(e) {
    e.preventDefault();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    
    // Show loading
    submitBtn.classList.add('btn-loading');
    submitBtn.innerHTML = '';
    submitBtn.disabled = true;
    
    const modal = document.getElementById('addWatchlistModal');
    const editMode = document.getElementById('modal-edit-mode').value === 'edit';
    
    // Ensure latest conditions string from builder
    if (typeof getConditionsString === 'function') {
        const hidden = document.getElementById('modal-conditions');
        if (hidden) hidden.value = getConditionsString();
    }

    const data = {
        match_id: document.getElementById('modal-match-id').value,
        date: modal.dataset.date,
        league: modal.dataset.league,
        home_team: modal.dataset.home,
        away_team: modal.dataset.away,
        kickoff: modal.dataset.kickoff,
        mode: document.getElementById('modal-mode').value,
        priority: parseInt(document.getElementById('modal-priority').value),
        custom_conditions: document.getElementById('modal-conditions').value,
        status: editMode ? document.getElementById('modal-status').value : 'active'
    };
    
    try {
        if (editMode) {
            // UPDATE MODE
            const requestBody = {
                apiKey: CONFIG.apiKey,
                resource: 'watchlist',
                action: 'update',
                data: [data]
            };
            
            const response = await fetch(CONFIG.appsScriptUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'text/plain;charset=utf-8'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (result && result.updatedCount > 0) {
                // Update local data
                const idx = watchlistData.findIndex(w => String(w.match_id) === String(data.match_id));
                if (idx !== -1) {
                    watchlistData[idx] = { ...watchlistData[idx], ...data };
                }
                renderWatchlist();
                showToast('✅ Updated successfully', 'success');
                closeModal('addWatchlistModal');
            } else {
                showToast('❌ Failed to update', 'error');
            }
        } else {
            // CREATE MODE (existing logic)
            if (!watchlistData) watchlistData = [];
            const existingIdx = watchlistData.findIndex(w => String(w.match_id) === String(data.match_id));

            if (existingIdx !== -1) {
                const existing = watchlistData[existingIdx];
                if (existing.status === 'active' || !existing.status) {
                    showToast('✓ Match already in watchlist', 'success');
                    closeModal('addWatchlistModal');
                    return;
                }
                // Update optimistic entry with new details
                watchlistData[existingIdx] = {
                    ...existing,
                    ...data,
                    status: 'active',
                    added_at: existing.added_at || new Date().toISOString()
                };
                renderWatchlist();
                showToast('Saving watchlist changes...', 'success');
            } else {
                // Create a new optimistic entry (use match_id as identifier)
                watchlistData.push({
                    ...data,
                    status: 'active',
                    added_at: new Date().toISOString()
                });
                renderWatchlist();
                showToast('Added to watchlist (saving...)', 'success');
            }

            // Build Google Apps Script POST request for creating watchlist item
            const requestBody = {
                apiKey: CONFIG.apiKey,
                resource: 'watchlist',
                action: 'create',
                data: [data]  // Wrap single item in array
            };
            
            const response = await fetch(CONFIG.appsScriptUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'text/plain;charset=utf-8'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            // Apps Script returns: { resource, action, insertedCount, items: [...] }
            if (result && result.insertedCount > 0) {
                // Find optimistic entry and mark active (match by match_id since that's our identifier)
                const idx = watchlistData.findIndex(w => String(w.match_id) === String(data.match_id));
                if (idx !== -1) {
                    watchlistData[idx] = {
                        ...watchlistData[idx],
                        ...data,
                        status: 'active'
                    };
                }
                renderWatchlist();
                if (typeof renderMatches === 'function') renderMatches();
                showToast('✅ Added to watchlist', 'success');
                closeModal('addWatchlistModal');
            } else {
                // Remove optimistic entry by match_id
                watchlistData = watchlistData.filter(w => !(String(w.match_id) === String(data.match_id) && w.status === 'active'));
                renderWatchlist();
                if (typeof renderMatches === 'function') renderMatches();
                showToast('❌ Failed to add to watchlist', 'error');
            }
        }
    } catch (error) {
        console.error('Error in submitWatchlist:', error);
        if (!editMode) {
            // Remove optimistic entry on error (match by match_id and active status)
            watchlistData = (watchlistData || []).filter(w => !(String(w.match_id) === String(data.match_id) && w.status === 'active'));
            renderWatchlist();
        }
        showToast('❌ Error: ' + error.message, 'error');
    } finally {
        // Restore button
        submitBtn.classList.remove('btn-loading');
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// Delete one or more watchlist items by watchlist record ID(s)
async function deleteWatchlistItems(ids, opts = {}) {
    if (!Array.isArray(ids)) ids = [ids];
    if (ids.length === 0) return;
    // Filter out any falsy ids first
    const normalized = (ids || []).map(String).filter(Boolean);
    if (normalized.length === 0) {
        showToast('No valid items to delete', 'error');
        return;
    }
    // Determine source state for validation: if caller provided previousState (optimistic removal),
    // validate against that state; otherwise validate against current watchlistData.
    const sourceState = Array.isArray(opts.previousState) ? opts.previousState : watchlistData;
    // Filter to only match_ids that exist in sourceState to avoid accidental deletes
    const validIds = normalized.filter(id => Array.isArray(sourceState) && sourceState.some(w => String(w.match_id) === String(id)));
    if (validIds.length === 0) {
        console.warn('deleteWatchlistItems: no valid match_ids to delete', ids);
        showToast('No valid items to delete', 'error');
        return;
    }
    
    // validIds are already match_ids, use them directly
    const matchIds = validIds;
    
    try {
        showToast('Deleting selected items...', 'info');
        
        // Build Apps Script DELETE request payload
        const payload = {
            apiKey: CONFIG.apiKey,
            resource: 'watchlist',
            action: 'delete',
            ids: matchIds  // Array of match_id values to delete
        };
        
        const response = await fetch(CONFIG.appsScriptUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'text/plain;charset=utf-8'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const result = await response.json();
        
        // Apps Script returns: { resource, action, ids, deletedCount }
        if (result && (result.deletedCount !== undefined || result.deletedCount >= 0)) {
            const deleted = result.deletedCount || 0;
            showToast(`🗑️ ${deleted} match(es) removed from watchlist`, 'success');

            // If server deleted more than requested (suspicious), reload from server to reflect truth
            const previousState = opts.previousState || null;
            if (deleted > validIds.length) {
                console.warn('Server deleted more items than requested', { requested: validIds.length, deleted });
                showToast('Warning: server removed more items than requested - reloading watchlist', 'error');
                await loadWatchlist();
                if (typeof renderMatches === 'function') renderMatches();
                return;
            }

            // Otherwise assume server deleted requested items; ensure local state removes them by match_id
            watchlistData = (watchlistData || []).filter(w => !validIds.includes(String(w.match_id)));
            if (typeof renderWatchlist === 'function') renderWatchlist();
            if (typeof renderMatches === 'function') renderMatches();
        } else {
            console.error('deleteWatchlistItems response invalid', result);
            showToast('❌ Failed to delete from watchlist', 'error');
            // If a previous state was provided, roll back
            if (opts.previousState) {
                watchlistData = opts.previousState;
                if (typeof renderWatchlist === 'function') renderWatchlist();
                if (typeof renderMatches === 'function') renderMatches();
            }
        }
    } catch (err) {
        console.error('deleteWatchlistItems error', err);
        showToast('❌ Error deleting: ' + (err.message || ''), 'error');
        if (opts.previousState) {
            watchlistData = opts.previousState;
            if (typeof renderWatchlist === 'function') renderWatchlist();
            if (typeof renderMatches === 'function') renderMatches();
        }
    }
}

// Single row delete handler
async function removeFromWatchlist(match_id) {
    console.log('removeFromWatchlist called with match_id:', match_id);
    const item = watchlistData.find(w => String(w.match_id) === String(match_id));
    if (!item) {
        console.warn('removeFromWatchlist: item not found for match_id', match_id);
        showToast('❌ Item not found', 'error');
        return;
    }
    // Immediate optimistic delete (no confirm) — show toast label only
    const previous = Array.isArray(watchlistData) ? [...watchlistData] : [];
    watchlistData = (watchlistData || []).filter(w => String(w.match_id) !== String(match_id));
    if (typeof renderWatchlist === 'function') renderWatchlist();
    if (typeof renderMatches === 'function') renderMatches();

    showToast('Deleting...', 'info');
    console.log('removeFromWatchlist: deleting match_id', match_id);
    try {
        await deleteWatchlistItems([String(match_id)], { previousState: previous });
        console.log('removeFromWatchlist: delete completed successfully');
    } catch (err) {
        console.error('removeFromWatchlist: error during delete', err);
        // Rollback on error
        watchlistData = previous;
        if (typeof renderWatchlist === 'function') renderWatchlist();
        if (typeof renderMatches === 'function') renderMatches();
        throw err;
    }
}
