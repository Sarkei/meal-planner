import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CookingPot,
  Settings,
  ShoppingBasket,
  Sparkles,
  Users,
} from 'lucide-react';
import { api, formatWeekLabel, mondayOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Recipe, WeekPlan } from '../lib/types';
import { Band, PageHead, StatRow } from '../components/AppShell';

/** Bereiche der App — dieselbe Liste wie die Navigation in App.tsx. */
export const AREAS = [
  {
    id: 'week',
    label: 'Woche',
    title: 'Wochenplan',
    icon: CalendarDays,
    text: 'Sieben Tage füllen, Gerichte per Ziehen sortieren, Kalorien je Tag im Blick behalten.',
  },
  {
    id: 'chat',
    label: 'Assistent',
    title: 'Assistent',
    icon: Sparkles,
    text: 'Nach Ideen fragen, Vorgaben ändern lassen — er kennt Einstellungen und Haushalt.',
  },
  {
    id: 'recipes',
    label: 'Rezepte',
    title: 'Rezepte',
    icon: BookOpen,
    text: 'Eigene und erzeugte Rezepte durchsuchen, filtern, bewerten und bearbeiten.',
  },
  {
    id: 'shopping',
    label: 'Einkauf',
    title: 'Einkauf',
    icon: ShoppingBasket,
    text: 'Die aus dem Plan erzeugte Liste, nach Abteilungen sortiert und abhakbar.',
  },
  {
    id: 'household',
    label: 'Haushalt',
    title: 'Haushalt',
    icon: Users,
    text: 'Mitglieder, Einladungscode und gemeinsame Vorgaben für alle Planungen.',
  },
  {
    id: 'settings',
    label: 'Profil',
    title: 'Profil',
    icon: Settings,
    text: 'Ernährungsweise, Allergien, Küchengeräte und Standard-Portionen pflegen.',
  },
];

type OverviewData = {
  recipes: number | null;
  favorites: number | null;
  members: number | null;
};

export function OverviewPage() {
  const { user, activeHousehold } = useAuth();
  const weekStart = mondayOf(new Date());
  const [data, setData] = useState<OverviewData>({
    recipes: null,
    favorites: null,
    members: null,
  });
  const [recent, setRecent] = useState<Recipe[]>([]);
  const [recipesInPlan, setRecipesInPlan] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [list, favs, newest] = await Promise.all([
          api<{ total: number }>('/recipes?limit=1'),
          api<{ recipes: Recipe[] }>('/recipes/favorites'),
          api<{ recipes: Recipe[] }>('/recipes?limit=3'),
        ]);
        if (!alive) return;
        setData((prev) => ({ ...prev, recipes: list.total, favorites: favs.recipes.length }));
        setRecent(newest.recipes);
      } catch {
        /* Kennzahlen bleiben leer, die Bereiche funktionieren weiter */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!activeHousehold) return;
    let alive = true;
    void (async () => {
      try {
        const [plan, household] = await Promise.all([
          api<WeekPlan>(`/plans/${activeHousehold.id}/${weekStart}`),
          api<{ members: { userId: number }[] }>(`/households/${activeHousehold.id}`),
        ]);
        if (!alive) return;
        setData((prev) => ({ ...prev, members: household.members.length }));
        setRecipesInPlan(new Set(plan.entries.map((e) => e.recipeId ?? e.title)).size);
      } catch {
        /* ohne Plan bleibt die Kennzahl leer */
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeHousehold, weekStart]);

  const stats = [
    { value: data.recipes === null ? '—' : String(data.recipes), label: 'Rezepte in der Sammlung' },
    {
      value: recipesInPlan === null ? '—' : String(recipesInPlan),
      label: 'Gerichte diese Woche',
    },
    { value: data.favorites === null ? '—' : String(data.favorites), label: 'Favoriten' },
    {
      value: data.members === null ? '—' : String(data.members),
      label: 'Personen im Haushalt',
    },
  ];

  const firstName = user?.displayName.split(' ')[0] ?? '';
  const weekLabel = formatWeekLabel(weekStart);

  return (
    <>
      <PageHead
        label={activeHousehold ? `Übersicht · ${activeHousehold.name}` : 'Übersicht'}
        title={`Hallo ${firstName}, was gibt es diese Woche?`}
        intro={`Planen, einkaufen, kochen — alles an einer Stelle. Diese Woche: ${weekLabel}`}
      >
        <StatRow items={stats} />
      </PageHead>

      <section className="app-container app-section pt-12">
        <div className="app-section__head">
          <h2 className="app-section__title">Bereiche</h2>
          <p className="app-section__note">Sechs Ansichten, ein Haushalt</p>
        </div>
        <div className="app-grid app-grid--three">
          {AREAS.map(({ id, title, icon: Icon, text }) => (
            <a key={id} className="app-card app-card--link" href={`#/${id}`}>
              <div className="flex items-start justify-between gap-3">
                <Icon className="h-5 w-5 text-leaf" aria-hidden />
                <ArrowRight className="h-4 w-4 text-muted" aria-hidden />
              </div>
              <h3 className="app-card__title">{title}</h3>
              <p className="app-card__text">{text}</p>
            </a>
          ))}
        </div>
      </section>

      <Band title="Zuletzt aufgenommen" note={recent.length > 0 ? 'Neueste Rezepte der Sammlung' : undefined}>
        {recent.length === 0 ? (
          <div className="app-card mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CookingPot className="h-5 w-5 text-muted" aria-hidden />
              <p className="app-card__text">
                Noch kein Rezept in der Sammlung — leg das erste an oder lass eines schreiben.
              </p>
            </div>
            <a className="btn btn-primary" href="#/recipes">
              Zu den Rezepten
            </a>
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {recent.map((recipe) => {
              const meta = [
                recipe.prepMinutes ? `${recipe.prepMinutes} min` : '',
                `${recipe.servings} Portionen`,
                recipe.nutrition?.kcal ? `${Math.round(Number(recipe.nutrition.kcal))} kcal` : '',
                recipe.authorName ?? '',
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={recipe.id}>
                  <a
                    className="flex items-center justify-between gap-4 px-5 py-4 text-ink transition hover:bg-surface-2"
                    href={`#/recipe/${recipe.id}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-display text-lg">{recipe.title}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-muted">{meta}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Band>
    </>
  );
}
