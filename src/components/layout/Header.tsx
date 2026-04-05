import { useState, useRef, useEffect } from 'react';
import type { TabName } from '@/types';
import type { AuthUser } from '@/lib/services/auth';
import { ProfileEditModal } from '@/components/profile/ProfileEditModal';
import { UserAvatar, getUserDisplayName } from '@/components/ui/UserAvatar';

const TAB_LABELS: Record<TabName, string> = {
  dashboard:       'Dashboard',
  matches:         'Matches',
  watchlist:       'Watchlist',
  recommendations: 'Recommendations',
  'bet-tracker':   'Investment Tracker',
  reports:         'Reports',
  'live-monitor':  'Live Monitor',
  leagues:         'Leagues',
  settings:        'Settings',
};

interface HeaderProps {
  activeTab: TabName;
  onLogout: () => void;
  user?: AuthUser | null;
  onUserChange?: (user: AuthUser) => void;
}

export function Header({ activeTab, onLogout, user, onUserChange }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking/tapping outside
  useEffect(() => {
    function handle(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
    };
  }, []);

  return (
    <div className="header">
      <h1>{TAB_LABELS[activeTab] ?? activeTab}</h1>

      <div className="header-actions">
        {user ? (
          /* ── Google-style avatar button ── */
          <div ref={ref} style={{ position: 'relative' }}>
            <button
              onClick={() => setOpen((o) => !o)}
              title={getUserDisplayName(user) || user.email}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '4px', borderRadius: '24px',
                transition: 'background 0.15s',
              }}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.style.background = 'rgba(0,0,0,0.06)'; }}
              onPointerLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <UserAvatar user={user} size={32} />
            </button>

            {open && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                background: '#fff', border: '1px solid #e0e0e0',
                borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                minWidth: 'clamp(200px, 85vw, 260px)', maxWidth: '85vw',
                zIndex: 1000, overflow: 'hidden',
              }}>
                {/* User info header */}
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '20px 16px 16px', borderBottom: '1px solid #e0e0e0',
                  gap: '8px',
                }}>
                  <UserAvatar user={user} size={56} />
                  {getUserDisplayName(user) && (
                    <span style={{ fontWeight: 600, fontSize: '15px', color: '#202124' }}>
                      {getUserDisplayName(user)}
                    </span>
                  )}
                  <span style={{ fontSize: '13px', color: '#5f6368' }}>{user.email}</span>
                </div>

                <div style={{ padding: '8px' }}>
                  <button
                    onClick={() => { setOpen(false); setProfileOpen(true); }}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      background: '#f8fafc',
                      border: '1px solid #dadce0',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: '#3c4043',
                      fontWeight: 500,
                      marginBottom: '8px',
                    }}
                  >
                    Edit profile
                  </button>
                  <button
                    onClick={() => { setOpen(false); onLogout(); }}
                    style={{
                      width: '100%', padding: '10px 16px',
                      background: 'none', border: '1px solid #dadce0',
                      borderRadius: '8px', cursor: 'pointer',
                      fontSize: '13px', color: '#3c4043',
                      fontWeight: 500, transition: 'background 0.15s',
                    }}
                    onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.style.background = '#f8f9fa'; }}
                    onPointerLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Fallback plain logout button (no user info) ── */
          <button className="btn btn-secondary btn-sm" onClick={onLogout}>
            Logout
          </button>
        )}
      </div>

      {user && (
        <ProfileEditModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          user={user}
          onUserChange={onUserChange}
        />
      )}
    </div>
  );
}
