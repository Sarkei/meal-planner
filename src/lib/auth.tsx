import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import { DEFAULT_SETTINGS, type Household, type User, type UserSettings } from './types';

type AuthValue = {
  user: User | null;
  households: Household[];
  activeHousehold: Household | null;
  settings: UserSettings;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (displayName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  selectHousehold: (id: string) => void;
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  applyTheme: (theme: UserSettings['theme']) => void;
};

const ACTIVE_KEY = 'mealplanner.household';
const THEME_KEY = 'mealplanner.theme';
const AuthContext = createContext<AuthValue | null>(null);

function applyThemeToDom(theme: UserSettings['theme']): void {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, theme);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeId, setActiveId] = useState<string | null>(localStorage.getItem(ACTIVE_KEY));
  const [settings, setSettings] = useState<UserSettings>(() => {
    const stored = localStorage.getItem(THEME_KEY) as UserSettings['theme'] | null;
    return { ...DEFAULT_SETTINGS, theme: stored ?? 'system' };
  });
  const [loading, setLoading] = useState(true);

  // Theme sofort anwenden (auch vor dem Login)
  useEffect(() => {
    applyThemeToDom(settings.theme);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq || settings.theme !== 'system') return;
    const listener = () => applyThemeToDom('system');
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [settings.theme]);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setHouseholds([]);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{ user: User; households: Household[]; settings: UserSettings }>('/auth/me');
      setUser(data.user);
      setHouseholds(data.households);
      if (data.settings) setSettings((prev) => ({ ...prev, ...data.settings }));
      const stored = localStorage.getItem(ACTIVE_KEY);
      const valid = data.households.find((h) => h.id === stored) ?? data.households[0] ?? null;
      setActiveId(valid?.id ?? null);
      if (valid) localStorage.setItem(ACTIVE_KEY, valid.id);
    } catch {
      setToken(null);
      setUser(null);
      setHouseholds([]);
    } finally {
      setLoading(false);
    }
  }, []);

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

  const updateSettings = useCallback(async (patch: Partial<UserSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    const data = await api<{ settings: UserSettings }>('/auth/settings', { method: 'PUT', body: patch });
    setSettings((prev) => ({ ...prev, ...data.settings }));
  }, []);

  const applyTheme = useCallback((theme: UserSettings['theme']) => {
    setSettings((prev) => ({ ...prev, theme }));
    applyThemeToDom(theme);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      households,
      activeHousehold: households.find((h) => h.id === activeId) ?? households[0] ?? null,
      settings,
      loading,
      login,
      register,
      logout,
      refresh,
      selectHousehold,
      updateSettings,
      applyTheme,
    }),
    [user, households, activeId, settings, loading, login, register, logout, refresh, selectHousehold, updateSettings, applyTheme],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth außerhalb des AuthProvider');
  return ctx;
}
