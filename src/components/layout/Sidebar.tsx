import type { TabName } from '@/types';

// ==================== SVG Icon paths (Heroicons solid 20px) ====================
// Each path renders inside a 20×20 viewBox, no emoji, monochrome.

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

// ==================== Nav structure ====================

interface NavItem { key: TabName; label: string }
interface NavGroup { label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'OVERVIEW',
    items: [
      { key: 'dashboard', label: 'Dashboard' },
    ],
  },
  {
    label: 'SCOUTING',
    items: [
      { key: 'leagues',  label: 'Leagues' },
      { key: 'matches',   label: 'Matches' },
      { key: 'watchlist', label: 'Watchlist' },
    ],
  },
  {
    label: 'ANALYSIS',
    items: [
      { key: 'recommendations', label: 'Recommendations' },
      { key: 'bet-tracker',     label: 'Investment Tracker' },
      { key: 'reports',         label: 'Reports' },
    ],
  },
  {
    label: 'MONITOR',
    items: [
      { key: 'live-monitor', label: 'Live Monitor' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { key: 'settings', label: 'Settings' },
    ],
  },
];

// ==================== Sidebar component ====================

interface SidebarProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  collapsed: boolean;
  onToggle: () => void;
}

const SIDEBAR_W   = 220;
const SIDEBAR_COL = 56;

export function Sidebar({ activeTab, onTabChange, collapsed, onToggle }: SidebarProps) {
  const w = collapsed ? SIDEBAR_COL : SIDEBAR_W;

  return (
    <div
      style={{
        width:         w,
        minWidth:      w,
        maxWidth:      w,
        background:    '#111827',
        color:         '#9ca3af',
        display:       'flex',
        flexDirection: 'column',
        position:      'sticky',
        top:           0,
        height:        '100vh',
        overflowY:     'auto',
        overflowX:     'hidden',
        transition:    'width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease',
        flexShrink:    0,
        zIndex:        50,
      }}
    >
      {/* Brand */}
      <div style={{
        padding:        collapsed ? '16px 0' : '0 16px',
        borderBottom:   '1px solid rgba(255,255,255,0.06)',
        display:        'flex',
        alignItems:     'center',
        gap:            10,
        overflow:       'hidden',
        justifyContent: collapsed ? 'center' : 'flex-start',
        height:         52,
        minHeight:      52,
        flexShrink:     0,
      }}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
          <rect width="20" height="20" rx="4" fill="#374151" />
          <path d="M4 14l4-4 3 3 5-6" stroke="#e5e7eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        {!collapsed && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f9fafb', letterSpacing: '-0.1px', whiteSpace: 'nowrap' }}>
              TFI
            </div>
            <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600, whiteSpace: 'nowrap', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Time for Investment
            </div>
          </div>
        )}
      </div>

      {/* Nav groups */}
      <div style={{ flex: 1, paddingTop: 8, overflowY: 'auto' }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 4 }}>
            {!collapsed && (
              <div style={{
                padding:       '8px 14px 2px',
                fontSize:      9,
                fontWeight:    600,
                color:         '#6b7280',
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
                whiteSpace:    'nowrap',
              }}>
                {group.label}
              </div>
            )}
            {collapsed && <div style={{ height: 4 }} />}

            {group.items.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => onTabChange(item.key)}
                  title={collapsed ? item.label : undefined}
                  style={{
                    width:          '100%',
                    display:        'flex',
                    alignItems:     'center',
                    gap:            9,
                    padding:        collapsed ? '8px 0' : '7px 14px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    background:     active ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border:         'none',
                    borderLeft:     active ? '2px solid #e5e7eb' : '2px solid transparent',
                    borderRadius:   0,
                    cursor:         'pointer',
                    color:          active ? '#f9fafb' : '#6b7280',
                    transition:     'background 0.1s, color 0.1s',
                    textAlign:      'left',
                    outline:        'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
                      (e.currentTarget as HTMLButtonElement).style.color = '#d1d5db';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                      (e.currentTarget as HTMLButtonElement).style.color = '#6b7280';
                    }
                  }}
                >
                  <NavIcon tabKey={item.key} size={15} />
                  {!collapsed && (
                    <span style={{
                      fontSize:      12,
                      fontWeight:    active ? 500 : 400,
                      whiteSpace:    'nowrap',
                      overflow:      'hidden',
                      textOverflow:  'ellipsis',
                    }}>
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Collapse toggle */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '8px 0' }}>
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            width:          '100%',
            display:        'flex',
            alignItems:     'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap:            8,
            padding:        collapsed ? '7px 0' : '7px 14px',
            background:     'none',
            border:         'none',
            cursor:         'pointer',
            color:          '#6b7280',
            transition:     'color 0.1s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#6b7280'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#374151'; }}
        >
          <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" style={{ flexShrink: 0, transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          {!collapsed && <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>Collapse</span>}
        </button>
      </div>
    </div>
  );
}
