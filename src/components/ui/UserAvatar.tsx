import { useState } from 'react';
import type { AuthUser } from '@/lib/services/auth';

export function getUserDisplayName(user: AuthUser): string {
  return user.displayName?.trim() || user.name || user.email;
}

function getAvatarUrl(user: AuthUser): string {
  return user.avatarUrl?.trim() || user.picture || '';
}

/** Avatar: profile photo if available, else initials (same logic as header menu). */
export function UserAvatar({ user, size }: { user: AuthUser | null; size: number }) {
  const [imgError, setImgError] = useState(false);

  if (!user) {
    return (
      <div
        aria-hidden
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'var(--gray-200)',
          flexShrink: 0,
        }}
      />
    );
  }

  const initials = (getUserDisplayName(user) || user.email)
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (getAvatarUrl(user) && !imgError) {
    return (
      <img
        src={getAvatarUrl(user)}
        alt={getUserDisplayName(user) || user.email}
        onError={() => setImgError(true)}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          display: 'block',
          border: size > 40 ? '2px solid #e0e0e0' : 'none',
        }}
        referrerPolicy="no-referrer"
      />
    );
  }

  const colors = ['#4285f4', '#ea4335', '#34a853', '#fbbc04', '#9c27b0'];
  const bg = colors[(user.email.charCodeAt(0) || 0) % colors.length];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.38,
        fontWeight: 600,
        flexShrink: 0,
        border: size > 40 ? '2px solid #e0e0e0' : 'none',
      }}
    >
      {initials}
    </div>
  );
}