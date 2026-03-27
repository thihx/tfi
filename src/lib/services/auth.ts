// ============================================================
// Auth Service — JWT-based (Google OAuth via backend)
// ============================================================

import { internalApiUrl, resolveInternalApiBaseUrl } from '@/lib/internal-api';

const TOKEN_KEY = 'tfi_auth_token';

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
  name: string;
  picture: string;
}

// ── Token storage ─────────────────────────────────────────────

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ── Parse JWT payload (no signature verification — done server-side) ──

function parsePayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  const payload = parsePayload(token);
  if (!payload) return false;
  const exp = payload['exp'] as number | undefined;
  if (exp && exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

export function getUser(token: string | null): AuthUser | null {
  if (!token) return null;
  const payload = parsePayload(token);
  if (!payload) return null;
  return {
    userId:  String(payload['sub']     || ''),
    email:   String(payload['email']   || ''),
    role:    String(payload['role']    || 'member'),
    name:    String(payload['name']    || ''),
    picture: String(payload['picture'] || ''),
  };
}

export function isAuthenticated(): boolean {
  return isTokenValid(getToken());
}

export function logout(): void {
  clearToken();
  const apiUrl = resolveInternalApiBaseUrl() || window.location.origin;
  fetch(internalApiUrl('/api/auth/logout', apiUrl), {
    method: 'POST',
    credentials: 'include',
  }).finally(() => {
    location.reload();
  });
}
