import { useState, useCallback, useEffect } from 'react';
import { hashPassword, isAuthenticated, setAuthenticated, logout as doLogout } from '@/lib/services/auth';
import { PASSWORD_HASH } from '@/config/constants';

export function useAuth() {
  const [authed, setAuthed] = useState(isAuthenticated);
  const [error, setError] = useState('');

  useEffect(() => {
    setAuthed(isAuthenticated());
  }, []);

  const login = useCallback(async (password: string) => {
    setError('');
    const hash = await hashPassword(password);
    if (hash === PASSWORD_HASH) {
      setAuthenticated(true);
      setAuthed(true);
    } else {
      setError('Incorrect password');
    }
  }, []);

  const logout = useCallback(() => {
    doLogout();
    setAuthed(false);
  }, []);

  return { authed, error, login, logout };
}
