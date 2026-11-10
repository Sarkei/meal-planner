import { useEffect, useState } from 'react';
import { useAuth } from './lib/auth';
import { AuthPage } from './pages/AuthPage';
import { WeekPage } from './pages/WeekPage';
import { RecipesPage } from './pages/RecipesPage';
import { RecipeDetailPage } from './pages/RecipeDetailPage';
import { HouseholdPage } from './pages/HouseholdPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShoppingPage } from './pages/ShoppingPage';
import { ChatPage } from './pages/ChatPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { CalendarDays, BookOpen, Users, Settings, CookingPot, ShoppingBasket, Sparkles } from 'lucide-react';

export type Route = { name: string; id?: string; params: URLSearchParams };

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const [name, id] = path.split('/');
  return { name: name || 'week', id, params: new URLSearchParams(query ?? '') };
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

const NAV = [
  { id: 'week', label: 'Woche', icon: CalendarDays },
  { id: 'chat', label: 'Assistent', icon: Sparkles },
  { id: 'recipes', label: 'Rezepte', icon: BookOpen },
  { id: 'shopping', label: 'Einkauf', icon: ShoppingBasket },
  { id: 'household', label: 'Haushalt', icon: Users },
  { id: 'settings', label: 'Profil', icon: Settings },
];

export function App() {
  const { user, loading, activeHousehold, households, selectHousehold, logout } = useAuth();
  const route = useRoute();

  if (route.name === 'reset') {
    const token = route.params.get('token') ?? '';
    return <ResetPasswordPage token={token} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm font-medium text-ink/60">
          <CookingPot className="h-5 w-5 animate-pulse" /> Wird geladen …
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  const page = (() => {
    switch (route.name) {
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

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-24 pt-5 sm:px-6 lg:pb-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-leaf text-white shadow-sm">
            <CookingPot className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl leading-none font-bold tracking-tight">Meal Planner</h1>
            <p className="mt-1 text-xs text-ink/55">
              Hallo {user.displayName.split(' ')[0]} — gemeinsam planen, besser essen.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {households.length > 1 && (
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
          )}
          <button className="btn btn-ghost !px-3 !py-2 text-xs" onClick={logout}>
            Abmelden
          </button>
        </div>
      </header>

      <nav className="mb-5 hidden gap-1 rounded-2xl border border-ink/10 bg-white/70 p-1 sm:flex">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = route.name === id || (id === 'recipes' && route.name === 'recipe');
          return (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                active ? 'bg-leaf text-white shadow-sm' : 'text-ink/60 hover:bg-ink/5'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          );
        })}
      </nav>

      <main className="flex-1">{page}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/10 bg-white/95 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-md">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = route.name === id || (id === 'recipes' && route.name === 'recipe');
            return (
              <button
                key={id}
                onClick={() => navigate(id)}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-wide ${
                  active ? 'text-leaf' : 'text-ink/45'
                }`}
              >
                <Icon className="h-5 w-5" /> {label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
