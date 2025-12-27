// ==================== AUTO-REFRESH TIMER ====================
let matchesAutoRefreshTimer = null;
const MATCHES_AUTO_REFRESH_INTERVAL = 60000; // 1 minute in milliseconds

function initMatchesAutoRefresh() {
    // Only initialize once - timer runs continuously
    if (matchesAutoRefreshTimer) return;
    
    // Set timer to refresh every 1 minute (runs in background regardless of active tab)
    matchesAutoRefreshTimer = setInterval(() => {
        console.log('[Auto-Refresh] Refreshing matches...');
        if (typeof loadMatches === 'function') {
            loadMatches();
        }
    }, MATCHES_AUTO_REFRESH_INTERVAL);
    
    console.log('[Auto-Refresh] Matches auto-refresh initialized (running continuously every 1 minute)');
}

// ==================== GLOBAL LOADER CONTROL ====================
function showGlobalLoader(initialMessage = 'Initializing...') {
    const overlay = document.getElementById('globalLoader');
    if (!overlay) return;
    overlay.style.display = 'flex';
    setGlobalLoaderProgress(0, initialMessage);
    // Prevent scrolling subtly
    document.body.style.overflow = 'hidden';
}

function setGlobalLoaderProgress(percent, message) {
    const fill = document.getElementById('loaderProgressFill');
    const pct = document.getElementById('loaderPercent');
    const msg = document.getElementById('loaderMessage');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (pct) pct.textContent = `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
    if (msg && typeof message === 'string') msg.textContent = message;
}

function hideGlobalLoader() {
    const overlay = document.getElementById('globalLoader');
    if (!overlay) return;
    overlay.style.display = 'none';
    document.body.style.overflow = '';
}
// ==================== NAVIGATION ====================
function showTab(tabName) {
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Update content
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

// ==================== MODALS ====================
function openAddWatchlist(matchId, home, away, date, league, kickoff) {
    document.getElementById('modal-match-id').value = matchId;
    document.getElementById('modal-match-display').value = `${home} vs ${away}`;
    document.getElementById('modal-edit-mode').value = 'add';
    document.getElementById('watchlist-modal-title').textContent = '➕ Add to Watchlist';
    document.getElementById('watchlist-modal-submit').textContent = '➕ Add to Watchlist';
    document.getElementById('modal-mode').value = CONFIG.defaultMode || 'B';
    document.getElementById('modal-priority').value = '2';
    document.getElementById('modal-status').value = 'active';
    
    // Hide Status field in Add mode
    const statusFieldGroup = document.getElementById('status-field-group');
    if (statusFieldGroup) statusFieldGroup.style.display = 'none';
    
    // Hide AI Recommended section in Add mode
    const aiSection = document.getElementById('ai-recommended-section');
    if (aiSection) aiSection.style.display = 'none';
    
    document.getElementById('addWatchlistModal').classList.add('active');
    
    // Store additional data
    const modal = document.getElementById('addWatchlistModal');
    modal.dataset.date = date;
    modal.dataset.league = league;
    modal.dataset.home = home;
    modal.dataset.away = away;
    modal.dataset.kickoff = kickoff;

    // Initialize condition builder fresh each open
    if (typeof initConditionBuilder === 'function') {
        initConditionBuilder('');
    }
}

function openEditWatchlist(matchId, home, away, date, league, kickoff, mode, priority, conditions, status, recommendedCondition, recommendedReasonVi) {
    document.getElementById('modal-match-id').value = matchId;
    document.getElementById('modal-match-display').value = `${home} vs ${away}`;
    document.getElementById('modal-edit-mode').value = 'edit';
    document.getElementById('watchlist-modal-title').textContent = '📝 Edit Watchlist Item';
    document.getElementById('watchlist-modal-submit').textContent = '💾 Save Changes';
    document.getElementById('modal-mode').value = mode || 'B';
    document.getElementById('modal-priority').value = priority || '2';
    document.getElementById('modal-status').value = status || 'active';
    
    // Show Status field in Edit mode
    const statusFieldGroup = document.getElementById('status-field-group');
    if (statusFieldGroup) statusFieldGroup.style.display = 'block';
    
    // Handle AI Recommended section
    const aiSection = document.getElementById('ai-recommended-section');
    const modalRecommendedCondition = document.getElementById('modal-recommended-condition');
    const modalRecommendedReason = document.getElementById('modal-recommended-reason');
    
    if (recommendedCondition && recommendedCondition.trim()) {
        // Show AI section if has recommended condition
        aiSection.style.display = 'block';
        modalRecommendedCondition.textContent = recommendedCondition;
        modalRecommendedReason.textContent = recommendedReasonVi || '-';
        // Store for Apply button
        aiSection.dataset.recommendedCondition = recommendedCondition;
    } else {
        // Hide if no recommended condition
        aiSection.style.display = 'none';
    }
    
    document.getElementById('addWatchlistModal').classList.add('active');
    
    // Store additional data
    const modal = document.getElementById('addWatchlistModal');
    modal.dataset.date = date;
    modal.dataset.league = league;
    modal.dataset.home = home;
    modal.dataset.away = away;
    modal.dataset.kickoff = kickoff;

    // Initialize condition builder with existing conditions
    if (typeof initConditionBuilder === 'function') {
        initConditionBuilder(conditions || '');
    }
}

function loadWatchlistAndEdit(matchId, home, away, date, league, kickoff) {
    // Use existing watchlistData if available (no need to refetch from API)
    const watchItem = (watchlistData || []).find(w => String(w.match_id) === String(matchId));
    
    if (watchItem) {
        // Data already loaded, open modal immediately
        openEditWatchlist(
            matchId, 
            home, 
            away, 
            date, 
            league, 
            kickoff, 
            watchItem.mode || 'B', 
            watchItem.priority || 2, 
            watchItem.custom_conditions || '', 
            watchItem.status || 'active',
            watchItem.recommended_custom_condition || '',
            watchItem.recommended_condition_reason_vi || ''
        );
    } else {
        // Item not found in cache, fetch from API as fallback
        loadWatchlist().then(() => {
            const watchItem = (watchlistData || []).find(w => String(w.match_id) === String(matchId));
            if (watchItem) {
                openEditWatchlist(
                    matchId, 
                    home, 
                    away, 
                    date, 
                    league, 
                    kickoff, 
                    watchItem.mode || 'B', 
                    watchItem.priority || 2, 
                    watchItem.custom_conditions || '', 
                    watchItem.status || 'active',
                    watchItem.recommended_custom_condition || '',
                    watchItem.recommended_condition_reason_vi || ''
                );
            }
        }).catch(err => {
            console.error('Failed to load watchlist:', err);
        });
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Confirm Delete Modal callback holder
let _confirmDeleteCallback = null;

function openConfirmDeleteModal(items, title, description, onConfirm) {
    const modal = document.getElementById('confirmDeleteModal');
    if (!modal) {
        // fallback to native confirm
        if (confirm(description || title || 'Confirm?')) {
            if (typeof onConfirm === 'function') onConfirm();
        }
        return;
    }
    const titleEl = document.getElementById('confirm-delete-title');
    const descEl = document.getElementById('confirm-delete-desc');
    const listEl = document.getElementById('confirm-delete-list');
    titleEl.textContent = title || 'Confirm Delete';
    descEl.textContent = description || `Confirm delete ${items.length} item(s)?`;
    listEl.innerHTML = (items || []).map(i => `<li>${i.label || i.id || i}</li>`).join('');
    _confirmDeleteCallback = onConfirm;
    modal.style.display = 'block';
}

function closeConfirmDeleteModal() {
    const modal = document.getElementById('confirmDeleteModal');
    if (!modal) return;
    modal.style.display = 'none';
    _confirmDeleteCallback = null;
}

// ==================== TOAST ====================
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ==================== SETTINGS ====================
function saveSettings() {
    CONFIG.webhookUrl = document.getElementById('setting-webhook-url').value;
    CONFIG.defaultMode = document.getElementById('setting-default-mode').value;
    
    localStorage.setItem('webhookUrl', CONFIG.webhookUrl);
    localStorage.setItem('defaultMode', CONFIG.defaultMode);
    
    const newPassword = document.getElementById('setting-new-password').value;
    if (newPassword) {
        showToast('⚠️ Password change requires code update', 'error');
    } else {
        showToast('✅ Settings saved!', 'success');
    }
}

// ==================== DASHBOARD ====================
function updateDashboard() {
    // Calculate stats from recommendations
    const settled = recommendationsData.filter(r => ['won', 'lost'].includes(r.result));
    const won = settled.filter(r => r.result === 'won');
    const lost = settled.filter(r => r.result === 'lost');
    
    const totalBets = settled.length;
    const winRate = totalBets > 0 ? ((won.length / totalBets) * 100).toFixed(1) : '0';
    
    const totalPnL = settled.reduce((sum, r) => sum + (parseFloat(r.pnl) || 0), 0);
    const totalStaked = settled.reduce((sum, r) => sum + (parseFloat(r.stake_amount) || 0), 0);
    const roi = totalStaked > 0 ? ((totalPnL / totalStaked) * 100).toFixed(1) : '0';
    
    document.getElementById('stat-total-bets').textContent = totalBets;
    document.getElementById('stat-win-rate').textContent = winRate + '%';
    
    const pnlEl = document.getElementById('stat-pnl');
    pnlEl.textContent = (totalPnL >= 0 ? '+' : '') + '$' + totalPnL.toFixed(2);
    pnlEl.className = 'stat-value ' + (totalPnL >= 0 ? 'positive' : 'negative');
    
    const roiEl = document.getElementById('stat-roi');
    roiEl.textContent = (parseFloat(roi) >= 0 ? '+' : '') + roi + '%';
    roiEl.className = 'stat-value ' + (parseFloat(roi) >= 0 ? 'positive' : 'negative');
    
    // Recent activity
    const recentCount = Math.min(5, recommendationsData.length);
    const recentItems = recommendationsData.slice(0, recentCount);
    
    let activityHTML = `
        <div style="padding: 20px;">
            <p style="color: var(--gray-600); margin-bottom: 15px;">
                📊 ${matchesData.length} matches | 
                👁️ ${watchlistData.length} watchlist | 
                🎯 ${recommendationsData.length} recommendations
            </p>
        </div>
    `;
    
    if (recentItems.length > 0) {
        activityHTML += '<div style="border-top: 1px solid var(--gray-200);"><h4 style="padding: 15px 20px; margin: 0;">Recent Recommendations:</h4>';
        activityHTML += recentItems.map(r => `
            <div style="padding: 15px 20px; border-bottom: 1px solid var(--gray-200);">
                <strong>${r.match_display || 'N/A'}</strong><br>
                <small style="color: var(--gray-500);">
                    ${r.bet_type}: ${r.selection} @ ${r.odds} - 
                    <span style="color: ${r.result === 'won' ? 'var(--success)' : r.result === 'lost' ? 'var(--danger)' : 'var(--gray-500)'}">
                        ${r.result || 'pending'}
                    </span>
                </small>
            </div>
        `).join('');
        activityHTML += '</div>';
    }
    
    document.getElementById('recent-activity').innerHTML = activityHTML;
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    // Don't auto-set date filter - let user choose
    // This allows viewing all matches regardless of date
    
    // Initialize auto-refresh for matches (runs in background continuously)
    initMatchesAutoRefresh();
    
    // Initialize settings
    const webhookInput = document.getElementById('setting-webhook-url');
    const modeInput = document.getElementById('setting-default-mode');
    if (webhookInput) webhookInput.value = CONFIG.webhookUrl;
    if (modeInput) modeInput.value = CONFIG.defaultMode;

    // Prepare condition builder if modal exists (for deep links)
    if (document.getElementById('conditions-builder')) {
        initConditionBuilder();
    }
    
    // Check auth
    checkAuth();
    
    // Attach delegated handler for delete buttons in watchlist (row delete)
    document.getElementById('watchlist-table')?.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('.btn-delete-row');
        if (btn) {
            const id = btn.getAttribute('data-delete-id');
            console.log('watchlist row delete clicked, id=', id, 'event target=', ev.target);
            if (id) {
                try {
                    await removeFromWatchlist(id);
                } catch (err) {
                    console.error('Error in removeFromWatchlist:', err);
                    showToast('❌ Error deleting item', 'error');
                }
            }
        }
    });

    // Handle checkbox change events (row select and select-all) via delegation
    const watchlistTable = document.getElementById('watchlist-table');
    const selectAllEl = document.getElementById('watchlist-select-all');
    if (watchlistTable) {
        watchlistTable.addEventListener('change', (ev) => {
            const cb = ev.target.closest('.select-checkbox');
            if (cb) {
                const rawId = cb.dataset.selectId;
                const id = rawId !== undefined && rawId !== null ? String(rawId) : '';
                if (!id) {
                    // ignore invalid ids
                    updateDeleteSelectedButton();
                    return;
                }
                if (cb.checked) watchlistSelected.add(id);
                else watchlistSelected.delete(id);
                updateDeleteSelectedButton();
                // sync header checkbox
                const anyUnchecked = watchlistTable.querySelectorAll('.select-checkbox:not(:checked)').length > 0;
                if (selectAllEl) selectAllEl.checked = !anyUnchecked && watchlistTable.querySelectorAll('.select-checkbox').length > 0;
            }
        });
    }

    // Ensure bulk delete button uses function (useful if inline onclick not executed)
    const bulkBtn = document.getElementById('watchlist-delete-btn');
    if (bulkBtn) {
        bulkBtn.addEventListener('click', async (ev) => {
            // prevent default
            ev.preventDefault();
            const selectedIds = typeof getSelectedMatchIdsFromDOM === 'function' ? getSelectedMatchIdsFromDOM() : Array.from(watchlistSelected);
            console.log('bulk delete clicked, selectedCount=', selectedIds.length, selectedIds);
            // Call our delete handler
            try {
                await deleteSelectedUI();
            } catch (err) {
                console.error('Error in deleteSelectedUI:', err);
                showToast('❌ Error deleting items', 'error');
            }
        });
    }

    // Handle select-all checkbox change
    if (selectAllEl) {
        selectAllEl.addEventListener('change', (ev) => {
            const checked = !!selectAllEl.checked;
            const rows = document.querySelectorAll('#watchlist-table .select-checkbox');
            rows.forEach(r => {
                r.checked = checked;
                const rawId = r.dataset.selectId;
                const id = rawId !== undefined && rawId !== null ? String(rawId) : '';
                if (!id) return;
                if (checked) watchlistSelected.add(id);
                else watchlistSelected.delete(id);
            });
            updateDeleteSelectedButton();
        });
    }

    // Wire confirm-delete modal buttons
    const confirmModal = document.getElementById('confirmDeleteModal');
    if (confirmModal) {
        const btnCancel = document.getElementById('confirm-delete-cancel');
        const btnClose = document.getElementById('confirm-delete-close');
        const btnConfirm = document.getElementById('confirm-delete-confirm');
        if (btnCancel) btnCancel.addEventListener('click', () => { closeConfirmDeleteModal(); });
        if (btnClose) btnClose.addEventListener('click', () => { closeConfirmDeleteModal(); });
        if (btnConfirm) btnConfirm.addEventListener('click', async () => {
            // If callback exists, call it and close modal
            try {
                if (typeof _confirmDeleteCallback === 'function') {
                    // allow callback to be async
                    await _confirmDeleteCallback();
                }
            } catch (err) {
                console.error('Error in confirm delete callback', err);
            } finally {
                closeConfirmDeleteModal();
            }
        });
    }
});

// ==================== CONDITION BUILDER LOGIC ====================
const MAX_CONDITIONS = 10;

function parseConditionsString(str) {
    if (!str || !str.trim()) return [];
    const s = str.trim();
    const regex = /\(([^)]+)\)(?:\s+(AND|OR))?/g;
    const result = [];
    let match;
    while ((match = regex.exec(s)) !== null) {
        const text = match[1];
        const nextOp = match[2] || null;
        result.push({ text, operator: nextOp });
    }
    if (result.length === 0) {
        return [{ text: s, operator: null }];
    }
    return result;
}

function initConditionBuilder(initialConditions = '') {
    const container = document.getElementById('conditions-builder');
    const addBtn = document.getElementById('add-condition-btn');
    const hidden = document.getElementById('modal-conditions');
    const preview = document.getElementById('conditions-preview');
    if (!container || !addBtn || !hidden || !preview) return;

    container.innerHTML = '';
    
    const parsed = parseConditionsString(initialConditions);
    if (parsed.length === 0) {
        const first = createConditionRow(true);
        container.appendChild(first);
    } else {
        parsed.forEach((item, idx) => {
            const row = createConditionRow(idx === 0);
            const input = row.querySelector('.cond-input');
            if (input) input.value = item.text;
            if (idx > 0 && parsed[idx - 1]?.operator) {
                const op = row.querySelector('.cond-op');
                if (op) {
                    op.value = parsed[idx - 1].operator;
                }
            }
            container.appendChild(row);
            
            // Show clear button if input has value
            const clearBtn = row.querySelector('.cond-clear');
            if (clearBtn && item.text) {
                clearBtn.style.display = 'block';
            }
        });
    }
    updateConditionsSerialized();

    addBtn.onclick = () => {
        const count = container.querySelectorAll('.cond-row').length;
        if (count >= MAX_CONDITIONS) {
            showToast(`Maximum ${MAX_CONDITIONS} conditions`, 'error');
            return;
        }
        const row = createConditionRow(false);
        container.appendChild(row);
        const input = row.querySelector('.cond-input');
        if (input) input.focus();
        updateConditionsSerialized();
    };
}

function createConditionRow(isFirst) {
    const row = document.createElement('div');
    row.className = 'cond-row' + (isFirst ? '' : ' has-operator');

    if (!isFirst) {
        const op = document.createElement('select');
        op.className = 'cond-op';
        op.innerHTML = `<option value="AND">AND</option><option value="OR">OR</option>`;
        op.addEventListener('change', updateConditionsSerialized);
        row.appendChild(op);
    }

    // Input wrapper for clear button
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'cond-input-wrapper';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cond-input';
    input.placeholder = 'e.g., Corners > 10, BTTS, Shots ≥ 5';
    input.addEventListener('input', updateConditionsSerialized);
    
    // Clear button inside textbox
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'cond-clear';
    clearBtn.innerHTML = '✕';
    clearBtn.title = 'Clear';
    clearBtn.style.display = 'none'; // Hidden by default
    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        updateConditionsSerialized();
    });
    
    // Show/hide clear button based on input value
    input.addEventListener('input', () => {
        clearBtn.style.display = input.value ? 'block' : 'none';
    });
    
    inputWrapper.appendChild(input);
    inputWrapper.appendChild(clearBtn);
    row.appendChild(inputWrapper);

    if (!isFirst) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'cond-remove';
        rm.innerText = '✖';
        rm.title = 'Remove';
        rm.addEventListener('click', () => {
            row.remove();
            updateConditionsSerialized();
        });
        row.appendChild(rm);
    }

    return row;
}

function buildConditionsString() {
    const container = document.getElementById('conditions-builder');
    if (!container) return '';
    const rows = Array.from(container.querySelectorAll('.cond-row'));
    let out = '';
    let firstAdded = false;
    for (const row of rows) {
        const input = row.querySelector('.cond-input');
        if (!input) continue;
        const text = (input.value || '').trim();
        if (!text) continue;
        if (!firstAdded) {
            out = `(${text})`;
            firstAdded = true;
        } else {
            const op = row.querySelector('.cond-op')?.value || 'AND';
            out += ` ${op} (${text})`;
        }
    }
    return out;
}
window.getConditionsString = buildConditionsString;

function applyRecommendedCondition() {
    const aiSection = document.getElementById('ai-recommended-section');
    const recommendedCondition = aiSection?.dataset.recommendedCondition;
    
    if (!recommendedCondition || !recommendedCondition.trim()) {
        showToast('No recommended condition available', 'error');
        return;
    }
    
    // Get current conditions string
    const currentConditions = buildConditionsString();
    
    // Check if AI recommendation already applied
    if (currentConditions && currentConditions.includes(recommendedCondition)) {
        showToast('✓ Recommended condition already applied', 'info');
        return;
    }
    
    // Rebuild condition builder with 2 groups
    const container = document.getElementById('conditions-builder');
    if (!container) return;
    
    // Clear container
    container.innerHTML = '';
    
    if (currentConditions && currentConditions.trim()) {
        // Row 1: Current group as single condition
        const row1 = createConditionRow(true);
        const input1 = row1.querySelector('.cond-input');
        if (input1) {
            input1.value = currentConditions;
            // Show clear button
            const clearBtn1 = row1.querySelector('.cond-clear');
            if (clearBtn1) clearBtn1.style.display = 'block';
        }
        container.appendChild(row1);
        
        // Row 2: AI group with OR operator
        const row2 = createConditionRow(false);
        const input2 = row2.querySelector('.cond-input');
        if (input2) {
            input2.value = recommendedCondition;
            // Show clear button
            const clearBtn2 = row2.querySelector('.cond-clear');
            if (clearBtn2) clearBtn2.style.display = 'block';
        }
        const op2 = row2.querySelector('.cond-op');
        if (op2) op2.value = 'OR';
        container.appendChild(row2);
    } else {
        // No current conditions, just add AI group
        const parsed = parseConditionsString(recommendedCondition);
        parsed.forEach((item, idx) => {
            const row = createConditionRow(idx === 0);
            const input = row.querySelector('.cond-input');
            if (input) {
                input.value = item.text;
                // Show clear button if has value
                const clearBtn = row.querySelector('.cond-clear');
                if (clearBtn && item.text) clearBtn.style.display = 'block';
            }
            
            if (idx > 0) {
                const op = row.querySelector('.cond-op');
                if (op) op.value = item.operator || 'OR';
            }
            
            container.appendChild(row);
        });
    }
    
    updateConditionsSerialized();
    showToast('✨ Recommended condition applied', 'success');
}

function updateConditionsSerialized() {
    const hidden = document.getElementById('modal-conditions');
    const preview = document.getElementById('conditions-preview');
    if (!hidden || !preview) return;
    const s = buildConditionsString();
    hidden.value = s;
    preview.textContent = s ? `Preview: ${s}` : 'Preview: (no conditions)';
}
