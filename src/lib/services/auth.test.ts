import { describe, test, expect, beforeEach } from 'vitest';
import { hashPassword, isAuthenticated, setAuthenticated, logout } from './auth';

describe('auth service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ==================== hashPassword ====================
  describe('hashPassword', () => {
    test('returns a hex string', async () => {
      const hash = await hashPassword('test-password');
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    test('returns consistent hash for same input', async () => {
      const hash1 = await hashPassword('my-password');
      const hash2 = await hashPassword('my-password');
      expect(hash1).toBe(hash2);
    });

    test('returns different hash for different input', async () => {
      const hash1 = await hashPassword('password-a');
      const hash2 = await hashPassword('password-b');
      expect(hash1).not.toBe(hash2);
    });
  });

  // ==================== isAuthenticated ====================
  describe('isAuthenticated', () => {
    test('returns false when not set', () => {
      expect(isAuthenticated()).toBe(false);
    });

    test('returns true when authenticated', () => {
      localStorage.setItem('authenticated', 'true');
      expect(isAuthenticated()).toBe(true);
    });

    test('returns false for non-true value', () => {
      localStorage.setItem('authenticated', 'false');
      expect(isAuthenticated()).toBe(false);
    });
  });

  // ==================== setAuthenticated ====================
  describe('setAuthenticated', () => {
    test('sets localStorage to true', () => {
      setAuthenticated(true);
      expect(localStorage.setItem).toHaveBeenCalledWith('authenticated', 'true');
    });

    test('removes localStorage key on false', () => {
      setAuthenticated(false);
      expect(localStorage.removeItem).toHaveBeenCalledWith('authenticated');
    });
  });

  // ==================== logout ====================
  describe('logout', () => {
    test('clears authentication', () => {
      // Mock location.reload to prevent jsdom error
      const reloadMock = vi.fn();
      Object.defineProperty(globalThis, 'location', {
        value: { reload: reloadMock },
        writable: true,
        configurable: true,
      });

      logout();
      expect(localStorage.removeItem).toHaveBeenCalledWith('authenticated');
      expect(reloadMock).toHaveBeenCalled();
    });
  });
});
