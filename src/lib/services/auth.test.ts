import { describe, test, expect, beforeEach, vi } from 'vitest';
import { isAuthenticated, getToken, setToken, clearToken, isTokenValid, getUser, logout } from './auth';

// Build a minimal valid JWT for testing (HS256 signature not verified client-side)
function makeFakeJwt(payload: Record<string, unknown>): string {
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body    = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.fakesig`;
}

describe('auth service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('isAuthenticated', () => {
    test('returns false when no token stored', () => {
      expect(isAuthenticated()).toBe(false);
    });

    test('returns false for expired token', () => {
      const token = makeFakeJwt({ sub: 'a@b.com', exp: 1 }); // expired in 1970
      setToken(token);
      expect(isAuthenticated()).toBe(false);
    });

    test('returns true for valid unexpired token', () => {
      const token = makeFakeJwt({ sub: 'a@b.com', exp: Math.floor(Date.now() / 1000) + 3600 });
      setToken(token);
      expect(isAuthenticated()).toBe(true);
    });
  });

  describe('getToken / setToken / clearToken', () => {
    test('stores and retrieves token', () => {
      setToken('my.jwt.token');
      expect(getToken()).toBe('my.jwt.token');
    });

    test('clearToken removes it', () => {
      setToken('my.jwt.token');
      clearToken();
      expect(getToken()).toBeNull();
    });
  });

  describe('isTokenValid', () => {
    test('returns false for null', () => {
      expect(isTokenValid(null)).toBe(false);
    });

    test('returns false for malformed token', () => {
      expect(isTokenValid('not.a.token')).toBe(false);
    });
  });

  describe('getUser', () => {
    test('extracts user fields from token', () => {
      const token = makeFakeJwt({ sub: 'user-123', email: 'test@gmail.com', role: 'member', name: 'Test User', picture: 'https://pic', exp: Date.now() });
      const user = getUser(token);
      expect(user?.userId).toBe('user-123');
      expect(user?.email).toBe('test@gmail.com');
      expect(user?.name).toBe('Test User');
      expect(user?.role).toBe('member');
    });

    test('returns null for null token', () => {
      expect(getUser(null)).toBeNull();
    });
  });

  describe('logout', () => {
    test('clears token and reloads', async () => {
      setToken('some.jwt.token');
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
      const reloadMock = vi.fn();
      Object.defineProperty(globalThis, 'location', {
        value: { reload: reloadMock },
        writable: true,
        configurable: true,
      });
      logout();
      await Promise.resolve();
      expect(getToken()).toBeNull();
      expect(globalThis.fetch).toHaveBeenCalled();
      expect(reloadMock).toHaveBeenCalled();
    });
  });
});
