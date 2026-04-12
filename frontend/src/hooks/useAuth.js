import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,

      login: async (email, password) => {
        const res = await fetch(`${API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? 'Login failed');
        }
        const data = await res.json();
        set({ token: data.token, user: data.user });
        return data;
      },

      logout: () => set({ token: null, user: null }),
    }),
    { name: 'shadow-ai-auth' }
  )
);

// Convenience fetch wrapper that injects Authorization header
export function useApi() {
  const token = useAuthStore(s => s.token);

  return async function apiFetch(path, options = {}) {
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
  };
}