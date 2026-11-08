import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import type { Household, User } from './types';

type AuthValue = {
  user: User | null;
  households: Household[];
  activeHousehold: Household | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (displayName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  selectHousehold: (id: string) => void;
};

const ACTIVE_KEY = 'mealplanner.household';
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeId, setActiveId] = useState<string | null>(localStorage.getItem(ACTIVE_KEY));
  const [loading, setLoading] = useState(true);

  const applyMe = useCallback(
    (data: { user: User; households: Household[] }) => {
      setUser(data.user);
      setHouseholds(data.households);
      const stored = localStorage.getItem(ACTIVE_KEY);
      const valid = data.households.find((h) => h.id === stored) ?? data.households[0] ?? null;
      setActiveId(valid?.id ?? null);
      if (valid) localStorage.setItem(ACTIVE_KEY, valid.id);
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setHouseholds([]);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{ user: User; households: Household[] }>('/auth/me');
      applyMe(data);
    } catch {
      setToken(null);
      setUser(null);
      setHouseholds([]);
    } finally {
      setLoading(false);
    }
  }, [applyMe]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api<{ token: string }>('/auth/login', { method: 'POST', body: { email, password } });
      setToken(data.token);
      await refresh();
    },
    [refresh],
  );

  const register = useCallback(
    async (displayName: string, email: string, password: string) => {
      const data = await api<{ token: string }>('/auth/register', {
        method: 'POST',
        body: { displayName, email, password },
      });
      setToken(data.token);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setHouseholds([]);
    setActiveId(null);
    localStorage.removeItem(ACTIVE_KEY);
  }, []);

  const selectHousehold = useCallback((id: string) => {
    setActiveId(id);
    localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      households,
      activeHousehold: households.find((h) => h.id === activeId) ?? households[0] ?? null,
      loading,
      login,
      register,
      logout,
      refresh,
      selectHousehold,
    }),
    [user, households, activeId, loading, login, register, logout, refresh, selectHousehold],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth außerhalb des AuthProvider');
  return ctx;
}
