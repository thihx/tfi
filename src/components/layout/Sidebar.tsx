import type { TabName } from '@/types';

// ==================== Nav structure ====================

interface NavItem { key: TabName; icon: string; label: string }
interface NavGroup { label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'OVERVIEW',
    items: [
      { key: 'dashboard', icon: '📊', label: 'Dashboard' },
    ],
  },
  {
    label: 'SCOUTING',
    items: [
      { key: 'matches',   icon: '📅', label: 'Matches' },
      { key: 'watchlist', icon: '👁️', label: 'Watchlist' },
    ],
  },
  {
    label: 'ANALYSIS',
    items: [
      { key: 'recommendations', icon: '🎯', label: 'Recommendations' },
      { key: 'bet-tracker',     icon: '💰', label: 'Bet Tracker' },
    ],
  },
  {
    label: 'MONITOR',
    items: [
      { key: 'live-monitor', icon: '📡', label: 'Live Monitor' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { key: 'settings', icon: '⚙️', label: 'Settings' },
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
const SIDEBAR_COL = 60;

export function Sidebar({ activeTab, onTabChange, collapsed, onToggle }: SidebarProps) {
  const w = collapsed ? SIDEBAR_COL : SIDEBAR_W;

  return (
    <div
      style={{
        width:          w,
        minWidth:       w,
        maxWidth:       w,
        background:     '#1e293b',
        color:          '#cbd5e1',
        display:        'flex',
        flexDirection:  'column',
        position:       'sticky',
        top:            0,
        height:         '100vh',
        overflowY:      'auto',
        overflowX:      'hidden',
        transition:     'width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease',
        flexShrink:     0,
        zIndex:         50,
      }}
    >
      {/* Brand / logo area */}
      <div style={{
        padding:      collapsed ? '20px 0' : '20px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display:      'flex',
        alignItems:   'center',
        gap:          10,
        overflow:     'hidden',
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>📈</span>
        {!collapsed && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.3px', whiteSpace: 'nowrap' }}>
              TFI
            </div>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Football Analytics
            </div>
          </div>
        )}
      </div>

      {/* Nav groups */}
      <div style={{ flex: 1, padding: collapsed ? '12px 0' : '12px 0', overflowY: 'auto' }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 4 }}>
            {/* Group label */}
            {!collapsed && (
              <div style={{
                padding:       '10px 16px 4px',
                fontSize:      10,
                fontWeight:    700,
                color:         '#475569',
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
                whiteSpace:    'nowrap',
              }}>
                {group.label}
              </div>
            )}
            {collapsed && <div style={{ height: 8 }} />}

            {/* Nav items */}
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
                    gap:            10,
                    padding:        collapsed ? '10px 0' : '10px 14px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    background:     active
                      ? 'linear-gradient(90deg, rgba(59,130,246,0.25) 0%, rgba(59,130,246,0.08) 100%)'
                      : 'none',
                    border:         'none',
                    borderLeft:     active ? '3px solid #3b82f6' : '3px solid transparent',
                    borderRadius:   0,
                    cursor:         'pointer',
                    color:          active ? '#93c5fd' : '#94a3b8',
                    transition:     'background 0.15s, color 0.15s',
                    textAlign:      'left',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'none';
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                  {!collapsed && (
                    <span style={{
                      fontSize:    13,
                      fontWeight:  active ? 600 : 400,
                      whiteSpace:  'nowrap',
                      overflow:    'hidden',
                      textOverflow:'ellipsis',
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
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 0' }}>
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            width:          '100%',
            display:        'flex',
            alignItems:     'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap:            10,
            padding:        collapsed ? '10px 0' : '10px 14px',
            background:     'none',
            border:         'none',
            cursor:         'pointer',
            color:          '#475569',
            transition:     'color 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#475569'; }}
        >
          <span style={{ fontSize: 14, flexShrink: 0 }}>{collapsed ? '▶' : '◀'}</span>
          {!collapsed && <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Collapse</span>}
        </button>
      </div>
    </div>
  );
}
