import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { AppProvider, useAppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';
import { ErrorBoundary, TabErrorBoundary } from '@/components/ui/ErrorBoundary';
import { GlobalLoader } from '@/components/ui/GlobalLoader';
import { Modal } from '@/components/ui/Modal';
import { Header } from '@/components/layout/Header';
import { BottomNav } from '@/components/layout/BottomNav';
import { Sidebar } from '@/components/layout/Sidebar';
import { LoginScreen } from '@/app/LoginScreen';
import { useUserTimeZone } from '@/hooks/useUserTimeZone';
import { shouldFastRefreshMatch } from '@/lib/utils/helpers';
import { buildTimeZoneOptions, DEFAULT_APP_TIMEZONE } from '@/lib/utils/timezone';
import { fetchMonitorConfig, persistMonitorConfig } from '@/features/live-monitor/config';
import type { TabName } from '@/types';

// bundle-dynamic-imports: lazy-load each tab so users only download code for tabs they visit
const DashboardTab = lazy(() => import('@/app/DashboardTab').then((m) => ({ default: m.DashboardTab })));
const MatchesTab = lazy(() => import('@/app/MatchesTab').then((m) => ({ default: m.MatchesTab })));
const WatchlistTab = lazy(() => import('@/app/WatchlistTab').then((m) => ({ default: m.WatchlistTab })));
const RecommendationsTab = lazy(() => import('@/app/RecommendationsTab').then((m) => ({ default: m.RecommendationsTab })));
const BetTrackerTab = lazy(() => import('@/app/BetTrackerTab').then((m) => ({ default: m.BetTrackerTab })));
const LiveMonitorTab = lazy(() => import('@/app/LiveMonitorTab').then((m) => ({ default: m.LiveMonitorTab })));
const ReportsTab = lazy(() => import('@/app/ReportsTab').then((m) => ({ default: m.ReportsTab })));
const LeaguesTab = lazy(() => import('@/app/LeaguesTab').then((m) => ({ default: m.LeaguesTab })));
const SettingsTab = lazy(() => import('@/app/SettingsTab').then((m) => ({ default: m.SettingsTab })));
const MatchDetailModal = lazy(() => import('@/components/ui/MatchDetailModal').then((m) => ({ default: m.MatchDetailModal })));

function TabFallback() {
  return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-400)' }}>
      <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
      <p>Loading...</p>
    </div>
  );
}

function AppContent() {
  const { authed, user, error, login, logout, setCurrentUser } = useAuth();
  const { state, loadAllData, refreshMatches, refreshLeaguesAndWatchlist } = useAppState();
  const timeZone = useUserTimeZone();
  const [activeTab, setActiveTab]         = useState<TabName>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pushModal, setPushModal] = useState<{ id: string; display: string } | null>(null);
  const [timezonePromptReady, setTimezonePromptReady] = useState(false);
  const [timezonePromptDismissed, setTimezonePromptDismissed] = useState(false);
  const [timezonePromptSaving, setTimezonePromptSaving] = useState(false);
  const [timezoneDraft, setTimezoneDraft] = useState(DEFAULT_APP_TIMEZONE);
  const [isMobile, setIsMobile]           = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );

  // Keep stable refs so effects don't re-fire on reference changes
  const loadAllDataRef = useRef(loadAllData);
  const refreshMatchesRef = useRef(refreshMatches);
  const refreshLeaguesAndWatchlistRef = useRef(refreshLeaguesAndWatchlist);
  useEffect(() => {
    loadAllDataRef.current = loadAllData;
    refreshMatchesRef.current = refreshMatches;
    refreshLeaguesAndWatchlistRef.current = refreshLeaguesAndWatchlist;
  });

  // Initial load — depends only on authed, never re-fires due to loadAllData reference changes
  useEffect(() => {
    if (authed) loadAllDataRef.current();
  }, [authed]);

  useEffect(() => {
    if (!authed) {
      setTimezonePromptReady(false);
      setTimezonePromptDismissed(false);
      return;
    }

    let active = true;
    setTimezonePromptReady(false);
    setTimezonePromptDismissed(false);
    fetchMonitorConfig()
      .catch(() => undefined)
      .finally(() => {
        if (active) setTimezonePromptReady(true);
      });
    return () => { active = false; };
  }, [authed]);

  useEffect(() => {
    setTimezoneDraft(timeZone.userTimeZone ?? timeZone.detectedTimeZone ?? timeZone.effectiveTimeZone ?? DEFAULT_APP_TIMEZONE);
  }, [timeZone.userTimeZone, timeZone.detectedTimeZone, timeZone.effectiveTimeZone]);

  // Track last user activity — refresh only when active (within 5 minutes)
    const lastActivityRef = useRef(0);
  useEffect(() => {
    const ACTIVE_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
      lastActivityRef.current = Date.now();
    const update = () => { lastActivityRef.current = Date.now(); };
    ACTIVE_EVENTS.forEach((e) => window.addEventListener(e, update, { passive: true }));
    return () => ACTIVE_EVENTS.forEach((e) => window.removeEventListener(e, update));
  }, []);

  // Leagues + watchlist every 15s/60s (replaces the old loadAllData tick — no duplicate fetchMatches with MatchesTab 3s when both would poll matches).
  // Merge-refresh matches on the same tick when MatchesTab is not doing fast 3s polling (other tabs, or Matches with no live-window game).
  useEffect(() => {
    if (!authed) return;
    const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
    const hasFastRefreshCandidate = state.matches.some((match) => shouldFastRefreshMatch(match));
    const intervalMs = hasFastRefreshCandidate ? 15_000 : 60_000;
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_THRESHOLD_MS) return;
      void refreshLeaguesAndWatchlistRef.current(true);
      const matchesTabDoesFastPoll =
        activeTab === 'matches' && hasFastRefreshCandidate;
      if (!matchesTabDoesFastPoll) {
        void refreshMatchesRef.current();
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [authed, state.matches, activeTab]);

  // Global navigation event (used by child tabs to navigate without prop drilling)
  useEffect(() => {
    const handler = (e: Event) => setActiveTab((e as CustomEvent<TabName>).detail);
    window.addEventListener('tfi:navigate', handler);
    return () => window.removeEventListener('tfi:navigate', handler);
  }, []);

  // Handle ?match= URL param — runs on mount AND on window focus
  // (SW navigates to /?match=... when app is in a background tab)
  useEffect(() => {
    const checkMatchParam = () => {
      const params = new URLSearchParams(window.location.search);
      const matchId = params.get('match');
      const matchDisplay = params.get('matchDisplay') ?? '';
      if (matchId) {
        setPushModal({ id: matchId, display: decodeURIComponent(matchDisplay) });
        window.history.replaceState(null, '', window.location.pathname);
      }
    };
    checkMatchParam();
    window.addEventListener('focus', checkMatchParam);
    return () => window.removeEventListener('focus', checkMatchParam);
  }, []);

  // Handle postMessage from service worker (notification click when app already open)
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'tfi:openMatchDetail' && e.data?.matchId) {
        setPushModal({ id: e.data.matchId, display: e.data.matchDisplay ?? '' });
      } else if (e.data?.type === 'tfi:navigate' && e.data?.tab) {
        setActiveTab(e.data.tab as TabName);
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, []);

  // Responsive: switch between sidebar and top-nav layouts
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (!authed) {
    return <LoginScreen onLogin={login} error={error ?? ''} />;
  }

  const timezoneOptions = buildTimeZoneOptions(timeZone.userTimeZone, timeZone.detectedTimeZone, timezoneDraft);
  const showTimezonePrompt = timezonePromptReady && !timezonePromptDismissed && !timeZone.confirmed;

  const confirmTimeZone = async () => {
    setTimezonePromptSaving(true);
    try {
      await persistMonitorConfig({ USER_TIMEZONE: timezoneDraft, USER_TIMEZONE_CONFIRMED: true });
    } finally {
      setTimezonePromptSaving(false);
    }
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':      return <TabErrorBoundary key="dashboard"><DashboardTab /></TabErrorBoundary>;
      case 'matches':        return <TabErrorBoundary key="matches"><MatchesTab /></TabErrorBoundary>;
      case 'watchlist':      return <TabErrorBoundary key="watchlist"><WatchlistTab /></TabErrorBoundary>;
      case 'recommendations':return <TabErrorBoundary key="recommendations"><RecommendationsTab /></TabErrorBoundary>;
      case 'bet-tracker':    return <TabErrorBoundary key="bet-tracker"><BetTrackerTab /></TabErrorBoundary>;
      case 'live-monitor':   return <TabErrorBoundary key="live-monitor"><LiveMonitorTab /></TabErrorBoundary>;
      case 'reports':        return <TabErrorBoundary key="reports"><ReportsTab /></TabErrorBoundary>;
      case 'leagues':        return <TabErrorBoundary key="leagues"><LeaguesTab /></TabErrorBoundary>;
      case 'settings':       return <TabErrorBoundary key="settings"><SettingsTab /></TabErrorBoundary>;
    }
  };

  return (
    <>
      <GlobalLoader loading={state.loading} progress={state.loadingProgress} message={state.loadingMessage} />

      {pushModal && (
        <Suspense fallback={<TabFallback />}>
          <MatchDetailModal
            open
            matchId={pushModal.id}
            matchDisplay={pushModal.display}
            initialTab="recs"
            onClose={() => setPushModal(null)}
          />
        </Suspense>
      )}

      <Modal
        open={showTimezonePrompt}
        title="Confirm Your Timezone"
        onClose={() => setTimezonePromptDismissed(true)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setTimezonePromptDismissed(true)} disabled={timezonePromptSaving}>Later</button>
            <button className="btn btn-primary" onClick={() => void confirmTimeZone()} disabled={timezonePromptSaving}>
              {timezonePromptSaving ? 'Saving...' : 'Confirm Timezone'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ margin: 0, color: 'var(--gray-600)', fontSize: '13px', lineHeight: 1.5 }}>
            TFI will use this timezone for match kickoff display and Today/Tomorrow grouping in the UI.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Timezone</span>
            <select className="job-interval-select" value={timezoneDraft} onChange={(e) => setTimezoneDraft(e.target.value)}>
              {timezoneOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
            Browser detected: {timeZone.detectedTimeZone ?? 'Unavailable'}
          </div>
        </div>
      </Modal>

      {isMobile ? (
        /* ── Mobile: header + bottom-nav layout ── */
        <div id="appContainer">
          <Header activeTab={activeTab} onLogout={logout} user={user} onUserChange={setCurrentUser} />
          <div className="main-content">
            <Suspense fallback={<TabFallback />}>{renderTab()}</Suspense>
          </div>
          <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      ) : (
        /* ── Desktop: sidebar layout ── */
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--gray-50)' }}>
          <Sidebar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((c) => !c)}
          />

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            <Header activeTab={activeTab} onLogout={logout} user={user} onUserChange={setCurrentUser} />
            <div style={{ flex: 1, padding: '20px', minWidth: 0, overflowY: 'auto', '--header-height': '0px' } as React.CSSProperties}>
              <Suspense fallback={<TabFallback />}>{renderTab()}</Suspense>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppProvider>
          <AppContent />
        </AppProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
