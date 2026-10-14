import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useCallback } from 'react';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export const useAuthStore = create(
  persist(
    (set) => ({
      // Tenant user session
      token: null,
      user: null,
      // Platform administrator session (separate identity and token type)
      platformToken: null,
      platformAdmin: null,

      login: async (email, password) => {
        const res = await fetch(`${API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? 'Login failed');
        }
        const data = await res.json();
        set({ token: data.token, user: data.user });
        return data;
      },

      logout: () => set({ token: null, user: null }),

      platformLogin: async (email, password) => {
        const res = await fetch(`${API}/api/platform-admin/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? 'Login failed');
        }
        const data = await res.json();
        set({ platformToken: data.token, platformAdmin: data.platformAdmin });
        return data;
      },

      platformLogout: () => set({ platformToken: null, platformAdmin: null }),
    }),
    { name: 'shadow-ai-auth' }
  )
);

// Convenience fetch wrapper that injects the tenant Authorization header
export function useApi() {
  const token = useAuthStore(s => s.token);

  return useCallback(async function apiFetch(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  }, [token]);
}

// Convenience fetch wrapper that injects the platform-admin Authorization header
export function usePlatformApi() {
  const platformToken = useAuthStore(s => s.platformToken);

  return useCallback(async function platformFetch(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(platformToken ? { Authorization: `Bearer ${platformToken}` } : {}),
        ...options.headers,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  }, [platformToken]);
}
