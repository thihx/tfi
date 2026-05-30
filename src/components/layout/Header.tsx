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
    <header className="header">
      <h1 className="header__title">{TAB_LABELS[activeTab] ?? activeTab}</h1>

      <div className="header-actions">
        {user ? (
          <div ref={ref} className="header__menu">
            <button
              type="button"
              className="header__menu-trigger"
              onClick={() => setOpen((o) => !o)}
              title={getUserDisplayName(user) || user.email}
              aria-expanded={open}
              aria-haspopup="menu"
            >
              <UserAvatar user={user} size={32} />
            </button>

            {open && (
              <div className="header__dropdown" role="menu">
                <div className="header__dropdown-user">
                  <UserAvatar user={user} size={56} />
                  {getUserDisplayName(user) && (
                    <span className="header__dropdown-name">{getUserDisplayName(user)}</span>
                  )}
                  <span className="header__dropdown-email">{user.email}</span>
                </div>

                <div className="header__dropdown-actions">
                  <button
                    type="button"
                    role="menuitem"
                    className="header__dropdown-btn header__dropdown-btn--primary"
                    onClick={() => {
                      setOpen(false);
                      setProfileOpen(true);
                    }}
                  >
                    Edit profile
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="header__dropdown-btn header__dropdown-btn--signout"
                    onClick={() => {
                      setOpen(false);
                      onLogout();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onLogout}>
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
    </header>
  );
}
