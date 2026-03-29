import { useState } from 'react';
import type { TabName } from '@/types';

interface BottomNavProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
}

const IconHome = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const IconMatches = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const IconWatch = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconTips = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const IconLive = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M6.34 6.34a8 8 0 0 0 0 11.32" />
    <path d="M17.66 6.34a8 8 0 0 1 0 11.32" />
    <path d="M3.51 3.51a14 14 0 0 0 0 16.98" />
    <path d="M20.49 3.51a14 14 0 0 1 0 16.98" />
  </svg>
);

const IconMore = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const IconTracker = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const IconLeagues = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const IconReports = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const IconSettings = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const PRIMARY: { key: TabName; label: string; icon: JSX.Element }[] = [
  { key: 'dashboard',       label: 'Home',    icon: <IconHome /> },
  { key: 'matches',         label: 'Matches', icon: <IconMatches /> },
  { key: 'watchlist',       label: 'Watch',   icon: <IconWatch /> },
  { key: 'recommendations', label: 'Tips',    icon: <IconTips /> },
  { key: 'live-monitor',    label: 'Live',    icon: <IconLive /> },
];

const MORE: { key: TabName; label: string; icon: JSX.Element }[] = [
  { key: 'bet-tracker', label: 'Investment Tracker', icon: <IconTracker /> },
  { key: 'leagues',     label: 'Leagues',            icon: <IconLeagues /> },
  { key: 'reports',     label: 'Reports',            icon: <IconReports /> },
  { key: 'settings',    label: 'Settings',           icon: <IconSettings /> },
];

const MORE_KEYS = new Set<TabName>(MORE.map((t) => t.key));

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMoreActive = MORE_KEYS.has(activeTab);

  const handleTabChange = (key: TabName) => {
    setDrawerOpen(false);
    onTabChange(key);
  };

  return (
    <>
      {/* Backdrop */}
      {drawerOpen && (
        <div
          className="bottom-nav-backdrop"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* More drawer */}
      {drawerOpen && (
        <div className="bottom-nav-drawer">
          {MORE.map((t) => (
            <button
              key={t.key}
              className={`bottom-nav-drawer-item${activeTab === t.key ? ' active' : ''}`}
              onClick={() => handleTabChange(t.key)}
            >
              <span className="bottom-nav-drawer-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Bottom bar */}
      <nav className="bottom-nav">
        {PRIMARY.map((t) => (
          <button
            key={t.key}
            className={`bottom-nav-item${activeTab === t.key ? ' active' : ''}`}
            onClick={() => handleTabChange(t.key)}
          >
            <span className="bottom-nav-icon">{t.icon}</span>
            <span className="bottom-nav-label">{t.label}</span>
          </button>
        ))}

        {/* More button */}
        <button
          className={`bottom-nav-item${isMoreActive || drawerOpen ? ' active' : ''}`}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <span className="bottom-nav-icon"><IconMore /></span>
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>
    </>
  );
}
