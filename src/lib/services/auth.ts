// ============================================================
// Auth Service — JWT-based (Google OAuth via backend)
// ============================================================

import { internalApiUrl, resolveInternalApiBaseUrl } from '@/lib/internal-api';

const TOKEN_KEY = 'tfi_auth_token';

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
  status?: string;
  name: string;
  displayName?: string;
  picture: string;
  avatarUrl?: string;
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
  const name = String(payload['name'] || '');
  const picture = String(payload['picture'] || '');
  return {
    userId:  String(payload['sub']     || ''),
    email:   String(payload['email']   || ''),
    role:    String(payload['role']    || 'member'),
    name,
    displayName: name,
    picture,
    avatarUrl: picture,
  };
}

function normalizeAuthUser(payload: Partial<AuthUser> | null | undefined): AuthUser | null {
  if (!payload || typeof payload.userId !== 'string' || typeof payload.email !== 'string') return null;
  const displayName = typeof payload.displayName === 'string' && payload.displayName.trim().length > 0
    ? payload.displayName.trim()
    : typeof payload.name === 'string'
      ? payload.name
      : '';
  const avatarUrl = typeof payload.avatarUrl === 'string' && payload.avatarUrl.trim().length > 0
    ? payload.avatarUrl
    : typeof payload.picture === 'string'
      ? payload.picture
      : '';
  return {
    userId: payload.userId,
    email: payload.email,
    role: typeof payload.role === 'string' ? payload.role : 'member',
    status: typeof payload.status === 'string' ? payload.status : undefined,
    name: displayName,
    displayName,
    picture: avatarUrl,
    avatarUrl,
  };
}

export async function fetchCurrentUser(apiBase?: string | null): Promise<AuthUser | null> {
  const token = getToken();
  const resolvedBase = apiBase ?? (resolveInternalApiBaseUrl() || window.location.origin);
  const response = await fetch(internalApiUrl('/api/auth/me', resolvedBase), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return normalizeAuthUser(await response.json() as Partial<AuthUser>);
}

export async function updateCurrentUserProfile(
  payload: { displayName: string },
  apiBase?: string | null,
): Promise<AuthUser> {
  const token = getToken();
  const resolvedBase = apiBase ?? (resolveInternalApiBaseUrl() || window.location.origin);
  const response = await fetch(internalApiUrl('/api/me/profile', resolvedBase), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Save profile failed: ${response.status}`);
  }
  const user = normalizeAuthUser(await response.json() as Partial<AuthUser>);
  if (!user) {
    throw new Error('Save profile failed: invalid response');
  }
  return user;
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
