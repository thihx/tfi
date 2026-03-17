import { useState, useEffect, lazy, Suspense } from 'react';
import { AppProvider, useAppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';
import { ErrorBoundary, TabErrorBoundary } from '@/components/ui/ErrorBoundary';
import { GlobalLoader } from '@/components/ui/GlobalLoader';
import { Header } from '@/components/layout/Header';
import { Navigation } from '@/components/layout/Navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { LoginScreen } from '@/app/LoginScreen';
import type { TabName } from '@/types';

// bundle-dynamic-imports: lazy-load each tab so users only download code for tabs they visit
const DashboardTab = lazy(() => import('@/app/DashboardTab').then((m) => ({ default: m.DashboardTab })));
const MatchesTab = lazy(() => import('@/app/MatchesTab').then((m) => ({ default: m.MatchesTab })));
const WatchlistTab = lazy(() => import('@/app/WatchlistTab').then((m) => ({ default: m.WatchlistTab })));
const RecommendationsTab = lazy(() => import('@/app/RecommendationsTab').then((m) => ({ default: m.RecommendationsTab })));
const BetTrackerTab = lazy(() => import('@/app/BetTrackerTab').then((m) => ({ default: m.BetTrackerTab })));
const LiveMonitorTab = lazy(() => import('@/app/LiveMonitorTab').then((m) => ({ default: m.LiveMonitorTab })));
const SettingsTab = lazy(() => import('@/app/SettingsTab').then((m) => ({ default: m.SettingsTab })));

function TabFallback() {
  return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-400)' }}>
      <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
      <p>Loading...</p>
    </div>
  );
}

function AppContent() {
  const { authed, error, login, logout } = useAuth();
  const { state, loadAllData } = useAppState();
  const [activeTab, setActiveTab]         = useState<TabName>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobile, setIsMobile]           = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );

  useEffect(() => {
    if (authed) loadAllData();
  }, [authed, loadAllData]);

  // Responsive: switch between sidebar and top-nav layouts
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (!authed) {
    return <LoginScreen onLogin={login} error={error} />;
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':      return <TabErrorBoundary key="dashboard"><DashboardTab /></TabErrorBoundary>;
      case 'matches':        return <TabErrorBoundary key="matches"><MatchesTab /></TabErrorBoundary>;
      case 'watchlist':      return <TabErrorBoundary key="watchlist"><WatchlistTab /></TabErrorBoundary>;
      case 'recommendations':return <TabErrorBoundary key="recommendations"><RecommendationsTab /></TabErrorBoundary>;
      case 'bet-tracker':    return <TabErrorBoundary key="bet-tracker"><BetTrackerTab /></TabErrorBoundary>;
      case 'live-monitor':   return <TabErrorBoundary key="live-monitor"><LiveMonitorTab /></TabErrorBoundary>;
      case 'settings':       return <TabErrorBoundary key="settings"><SettingsTab /></TabErrorBoundary>;
    }
  };

  return (
    <>
      <GlobalLoader loading={state.loading} progress={state.loadingProgress} message={state.loadingMessage} />

      {isMobile ? (
        /* ── Mobile: original top-nav layout ── */
        <div id="appContainer">
          <Header onLogout={logout} />
          <Navigation activeTab={activeTab} onTabChange={setActiveTab} />
          <div className="main-content">
            <Suspense fallback={<TabFallback />}>{renderTab()}</Suspense>
          </div>
        </div>
      ) : (
        /* ── Desktop: sidebar layout ── */
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--gray-50)' }}>
          <Sidebar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((c) => !c)}
          />

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Header onLogout={logout} />
            <div style={{ flex: 1, padding: '28px 24px', maxWidth: '1400px', width: '100%', boxSizing: 'border-box' }}>
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
