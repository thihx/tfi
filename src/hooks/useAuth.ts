import { useState, useCallback, useEffect } from 'react';
import {
  getToken, setToken, clearToken,
  isTokenValid, getUser, logout as doLogout,
  type AuthUser,
} from '@/lib/services/auth';

const API_URL = (import.meta.env['VITE_API_URL'] as string | undefined) || '';

export function useAuth() {
  const [token, setTokenState]  = useState<string | null>(() => getToken());
  const [error, setError]       = useState('');

  // On mount: check if URL has ?token= (redirect back from Google OAuth)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const authError = params.get('auth_error');

    if (urlToken) {
      setToken(urlToken);
      setTokenState(urlToken);
      // Clean the token from URL bar
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
    } else if (authError) {
      const messages: Record<string, string> = {
        not_allowed:           'Your Google account is not authorised to access this app.',
        token_exchange_failed: 'Google authentication failed. Please try again.',
        profile_fetch_failed:  'Could not retrieve your Google profile. Please try again.',
        cancelled:             'Login was cancelled.',
      };
      setError(messages[authError] ?? `Login failed: ${authError}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const authed = isTokenValid(token);
  const user: AuthUser | null = authed ? getUser(token) : null;

  // Redirect to Google OAuth (full page redirect — backend handles the flow)
  const login = useCallback(() => {
    setError('');
    window.location.href = `${API_URL}/api/auth/google`;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    doLogout();
  }, []);

  return { authed, user, error, login, logout };
}
