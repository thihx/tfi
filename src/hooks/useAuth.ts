import { useState, useCallback, useEffect } from 'react';
import {
  clearToken,
  logout as doLogout,
  type AuthUser,
} from '@/lib/services/auth';

const API_URL = (import.meta.env['VITE_API_URL'] as string | undefined) || '';

export function useAuth() {
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError]       = useState('');

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

    if (authError) {
      const messages: Record<string, string> = {
        auth_unavailable:      'Authentication is not configured on this environment.',
        invalid_state:         'Google authentication session expired or was invalid. Please try again.',
        not_allowed:           'Your Google account is not authorised to access this app.',
        token_exchange_failed: 'Google authentication failed. Please try again.',
        profile_fetch_failed:  'Could not retrieve your Google profile. Please try again.',
        cancelled:             'Login was cancelled.',
      };
      setError(messages[authError] ?? `Login failed: ${authError}`);
    }

    const baseUrl = API_URL || window.location.origin;
    fetch(`${baseUrl}/api/auth/me`, {
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
    window.location.href = `${API_URL}/api/auth/google`;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    doLogout();
    setAuthed(false);
    setUser(null);
  }, []);

  return { authed, user, error, login, logout };
}
