import { useState, useEffect } from 'react';
import { AppProvider, useAppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';
import { ErrorBoundary, TabErrorBoundary } from '@/components/ui/ErrorBoundary';
import { GlobalLoader } from '@/components/ui/GlobalLoader';
import { Header } from '@/components/layout/Header';
import { Navigation } from '@/components/layout/Navigation';
import { LoginScreen } from '@/app/LoginScreen';
import { DashboardTab } from '@/app/DashboardTab';
import { MatchesTab } from '@/app/MatchesTab';
import { WatchlistTab } from '@/app/WatchlistTab';
import { RecommendationsTab } from '@/app/RecommendationsTab';
import { LiveMonitorTab } from '@/app/LiveMonitorTab';
import { SettingsTab } from '@/app/SettingsTab';
import type { TabName } from '@/types';

function AppContent() {
  const { authed, error, login, logout } = useAuth();
  const { state, loadAllData } = useAppState();
  const [activeTab, setActiveTab] = useState<TabName>('dashboard');

  useEffect(() => {
    if (authed) loadAllData();
  }, [authed, loadAllData]);

  if (!authed) {
    return <LoginScreen onLogin={login} error={error} />;
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard': return <TabErrorBoundary key="dashboard"><DashboardTab /></TabErrorBoundary>;
      case 'matches': return <TabErrorBoundary key="matches"><MatchesTab /></TabErrorBoundary>;
      case 'watchlist': return <TabErrorBoundary key="watchlist"><WatchlistTab /></TabErrorBoundary>;
      case 'recommendations': return <TabErrorBoundary key="recommendations"><RecommendationsTab /></TabErrorBoundary>;
      case 'live-monitor': return <TabErrorBoundary key="live-monitor"><LiveMonitorTab /></TabErrorBoundary>;
      case 'settings': return <TabErrorBoundary key="settings"><SettingsTab /></TabErrorBoundary>;
    }
  };

  return (
    <>
      <GlobalLoader loading={state.loading} progress={state.loadingProgress} message={state.loadingMessage} />
      <div id="appContainer">
        <Header onLogout={logout} />
        <Navigation activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="main-content">
          {renderTab()}
        </div>
      </div>
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
