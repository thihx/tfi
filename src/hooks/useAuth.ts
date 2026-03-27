import { useState, useCallback, useEffect } from 'react';
import {
  clearToken,
  logout as doLogout,
  type AuthUser,
} from '@/lib/services/auth';
import { internalApiUrl, resolveInternalApiBaseUrl } from '@/lib/internal-api';

const API_URL = resolveInternalApiBaseUrl();

function getAuthErrorMessage(authError: string | null): string {
  if (!authError) return '';
  const messages: Record<string, string> = {
    auth_unavailable: 'Authentication is not configured on this environment.',
    invalid_state: 'Google authentication session expired or was invalid. Please try again.',
    not_allowed: 'Your Google account is not authorised to access this app.',
    token_exchange_failed: 'Google authentication failed. Please try again.',
    profile_fetch_failed: 'Could not retrieve your Google profile. Please try again.',
    cancelled: 'Login was cancelled.',
  };
  return messages[authError] ?? `Login failed: ${authError}`;
}

export function useAuth() {
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash,
    );
    return getAuthErrorMessage(hashParams.get('auth_error') ?? searchParams.get('auth_error'));
  });

  // On mount: check URL auth params, then validate session from HttpOnly cookie via /api/auth/me.
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash,
    );
    const authSuccess = hashParams.get('auth') ?? searchParams.get('auth');
    const authError = hashParams.get('auth_error') ?? searchParams.get('auth_error');

    if (authSuccess || authError) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    fetch(internalApiUrl('/api/auth/me', API_URL || window.location.origin), {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) {
          setAuthed(false);
          setUser(null);
          return;
        }
        const me = await res.json() as AuthUser;
        setAuthed(true);
        setUser(me);
      })
      .catch(() => {
        setAuthed(false);
        setUser(null);
      });
  }, []);

  // Redirect to Google OAuth (full page redirect — backend handles the flow)
  const login = useCallback(() => {
    setError('');
    window.location.href = internalApiUrl('/api/auth/google', API_URL || window.location.origin);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    doLogout();
    setAuthed(false);
    setUser(null);
  }, []);

  return { authed, user, error, login, logout };
}
