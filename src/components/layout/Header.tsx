import { useState, useRef, useEffect } from 'react';
import type { TabName } from '@/types';
import type { AuthUser } from '@/lib/services/auth';
import { ProfileEditModal } from '@/components/profile/ProfileEditModal';

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

function getDisplayName(user: AuthUser): string {
  return user.displayName?.trim() || user.name || user.email;
}

function getAvatarUrl(user: AuthUser): string {
  return user.avatarUrl?.trim() || user.picture || '';
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
              title={getDisplayName(user) || user.email}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '4px', borderRadius: '24px',
                transition: 'background 0.15s',
              }}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.style.background = 'rgba(0,0,0,0.06)'; }}
              onPointerLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <Avatar user={user} size={32} />
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
                  <Avatar user={user} size={56} />
                  {getDisplayName(user) && (
                    <span style={{ fontWeight: 600, fontSize: '15px', color: '#202124' }}>
                      {getDisplayName(user)}
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

// ── Avatar: photo if available, else initials ──────────────────

function Avatar({ user, size }: { user: AuthUser; size: number }) {
  const [imgError, setImgError] = useState(false);
  const initials = (getDisplayName(user) || user.email)
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  if (getAvatarUrl(user) && !imgError) {
    return (
      <img
        src={getAvatarUrl(user)}
        alt={getDisplayName(user) || user.email}
        onError={() => setImgError(true)}
        style={{
          width: size, height: size, borderRadius: '50%',
          objectFit: 'cover', display: 'block',
          border: size > 40 ? '2px solid #e0e0e0' : 'none',
        }}
        referrerPolicy="no-referrer"
      />
    );
  }

  // Fallback: coloured circle with initials
  const colors = ['#4285f4', '#ea4335', '#34a853', '#fbbc04', '#9c27b0'];
  const bg = colors[(user.email.charCodeAt(0) || 0) % colors.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bg, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 600, flexShrink: 0,
      border: size > 40 ? '2px solid #e0e0e0' : 'none',
    }}>
      {initials}
    </div>
  );
}
