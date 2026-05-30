import type { TabName } from '@/types';

const ICON_PATHS: Record<string, string> = {
  'dashboard':
    'M3 3h5v5H3V3zm0 9h5v5H3v-5zm9-9h5v5h-5V3zm0 9h5v5h-5v-5z',
  'matches':
    'M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z',
  'watchlist':
    'M10 12a2 2 0 100-4 2 2 0 000 4zM2.458 10C3.732 5.943 6.523 3 10 3s6.268 2.943 7.542 7c-1.274 4.057-4.064 7-7.542 7s-6.268-2.943-7.542-7z',
  'recommendations':
    'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z',
  'bet-tracker':
    'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z',
  'reports':
    'M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z',
  'leagues':
    'M12 14l9-5-9-5-9 5 9 5zM12 14l6.16-3.422A12.083 12.083 0 0112 21.5a12.083 12.083 0 01-6.16-10.922L12 14z',
  'live-monitor':
    'M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z',
  'settings':
    'M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z',
};

function NavIcon({ tabKey, size = 16 }: { tabKey: string; size?: number }) {
  const path = ICON_PATHS[tabKey];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
      aria-hidden
    >
      <path fillRule="evenodd" d={path} clipRule="evenodd" />
    </svg>
  );
}

interface NavItem { key: TabName; label: string }
interface NavGroup { label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard' }],
  },
  {
    label: 'Scouting',
    items: [
      { key: 'matches', label: 'Matches' },
      { key: 'watchlist', label: 'Watchlist' },
      { key: 'leagues', label: 'Leagues' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { key: 'recommendations', label: 'Recommendations' },
      { key: 'bet-tracker', label: 'Investment Tracker' },
      { key: 'reports', label: 'Reports' },
    ],
  },
  {
    label: 'Monitor',
    items: [{ key: 'live-monitor', label: 'Live Monitor' }],
  },
  {
    label: 'System',
    items: [{ key: 'settings', label: 'Settings' }],
  },
];

interface SidebarProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ activeTab, onTabChange, collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={`app-sidebar${collapsed ? ' app-sidebar--collapsed' : ''}`}
      aria-label="Main navigation"
    >
      <div className="app-sidebar__brand">
        <div className="app-sidebar__brand-mark" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 14l4-4 3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {!collapsed && (
          <div>
            <div className="app-sidebar__brand-name">TFI</div>
            <div className="app-sidebar__brand-tag">Time for Investment</div>
          </div>
        )}
      </div>

      <nav className="app-sidebar__nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="app-sidebar__group">
            {!collapsed && (
              <div className="app-sidebar__group-label">{group.label}</div>
            )}
            {collapsed && <div className="app-sidebar__group-spacer" aria-hidden />}

            {group.items.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onTabChange(item.key)}
                  title={collapsed ? item.label : undefined}
                  className={`app-sidebar__item${active ? ' app-sidebar__item--active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <NavIcon tabKey={item.key} size={15} />
                  {!collapsed && (
                    <span className="app-sidebar__item-label">{item.label}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="app-sidebar__footer">
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="app-sidebar__collapse"
          aria-expanded={!collapsed}
        >
          <svg
            className="app-sidebar__collapse-icon"
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          {!collapsed && <span className="app-sidebar__collapse-label">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
