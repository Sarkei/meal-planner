import { useEffect, useState } from 'react';
import { useAuth } from './lib/auth';
import { AuthPage } from './pages/AuthPage';
import { OverviewPage } from './pages/OverviewPage';
import { WeekPage } from './pages/WeekPage';
import { RecipesPage } from './pages/RecipesPage';
import { RecipeDetailPage } from './pages/RecipeDetailPage';
import { HouseholdPage } from './pages/HouseholdPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShoppingPage } from './pages/ShoppingPage';
import { ChatPage } from './pages/ChatPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { CookingPot } from 'lucide-react';
import { AppShell } from './components/AppShell';

export type Route = { name: string; id?: string; params: URLSearchParams };

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const [name, id] = path.split('/');
  return { name: name || 'home', id, params: new URLSearchParams(query ?? '') };
}

export function navigate(path: string): void {
  window.location.hash = `#/${path}`;
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** Bereiche der App — höchstens sieben, damit die Kopfzeile ruhig bleibt. */
const NAV = [
  { id: 'home', label: 'Übersicht' },
  { id: 'week', label: 'Woche' },
  { id: 'chat', label: 'Assistent' },
  { id: 'recipes', label: 'Rezepte' },
  { id: 'shopping', label: 'Einkauf' },
  { id: 'household', label: 'Haushalt' },
  { id: 'settings', label: 'Profil' },
];

export function App() {
  const { user, loading, activeHousehold, households, selectHousehold, logout, settings, applyTheme } = useAuth();
  const route = useRoute();
  const [isDark, setIsDark] = useState(() => document.documentElement.dataset.theme === 'dark');

  useEffect(() => {
    setIsDark(document.documentElement.dataset.theme === 'dark');
  }, [settings.theme]);

  if (route.name === 'reset') {
    const token = route.params.get('token') ?? '';
    return <ResetPasswordPage token={token} />;
  }

  if (loading) {
    return (
      <div className="app flex min-h-screen items-center justify-center">
        <div className="app-container flex items-center justify-center">
          <div className="flex items-center gap-3 text-sm font-medium text-muted">
            <CookingPot className="h-5 w-5 animate-pulse" /> Wird geladen …
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  const page = (() => {
    switch (route.name) {
      case 'home':
        return <OverviewPage />;
      case 'chat':
        return <ChatPage />;
      case 'recipes':
        return <RecipesPage />;
      case 'shopping':
        return <ShoppingPage />;
      case 'recipe':
        return <RecipeDetailPage recipeId={route.id} />;
      case 'household':
        return <HouseholdPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <WeekPage />;
    }
  })();

  const activeId = route.name === 'recipe' ? 'recipes' : route.name;
  const activeLabel = NAV.find((item) => item.id === activeId)?.label ?? 'Woche';

  const householdSelect =
    households.length > 1 ? (
      <select
        className="select max-w-[220px]"
        value={activeHousehold?.id ?? ''}
        onChange={(e) => selectHousehold(e.target.value)}
        aria-label="Haushalt wählen"
      >
        {households.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </select>
    ) : null;

  const logoutButton = (
    <button className="btn btn-ghost btn-sm text-xs" onClick={logout}>
      Abmelden
    </button>
  );

  return (
    <AppShell
      name="Meal Planner"
      subtitle={activeLabel}
      mark={<CookingPot className="h-5 w-5" aria-hidden />}
      items={NAV}
      active={activeId}
      onNavigate={navigate}
      theme={isDark ? 'dark' : 'light'}
      onToggleTheme={() => {
        const next = isDark ? 'light' : 'dark';
        applyTheme(next);
        setIsDark(next === 'dark');
      }}
      actions={
        <div className="hidden items-center gap-2 md:flex">
          {householdSelect}
          {logoutButton}
        </div>
      }
      mobileExtra={
        <div className="flex flex-col gap-2">
          {householdSelect}
          <button className="btn btn-ghost justify-start" onClick={logout}>
            Abmelden
          </button>
        </div>
      }
      footer={
        <div className="app-container flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Meal Planner · {user.displayName}
            {activeHousehold ? ` · ${activeHousehold.name}` : ''}
          </span>
          <span>Gemeinsam planen, besser essen.</span>
        </div>
      }
    >
      {route.name === 'home' ? (
        page
      ) : (
        <div className="app-container pb-16 pt-6">{page}</div>
      )}
    </AppShell>
  );
}
