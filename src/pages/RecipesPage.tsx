import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Filter,
  Heart,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { ALLERGY_OPTIONS, CUISINE_OPTIONS, DIET_OPTIONS, KCAL_OPTIONS, TIME_OPTIONS } from '../lib/preferences';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { navigate } from '../App';
import { RecipeCard } from '../components/RecipeCard';
import { Modal } from '../components/Modal';
import {
  buildRecipeQuery,
  type Facets,
  type HouseholdPreferences,
  type Recipe,
  type RecipeQuery,
  type UserSettings,
} from '../lib/types';

type Tab = 'all' | 'favorites' | 'mine';
const PAGE_SIZE = 24;

const SORTS: { id: NonNullable<RecipeQuery['sort']>; label: string }[] = [
  { id: 'newest', label: 'Neueste' },
  { id: 'rating', label: 'Beste Bewertung' },
  { id: 'popular', label: 'Beliebteste' },
  { id: 'quickest', label: 'Schnellste' },
  { id: 'title', label: 'A–Z' },
];

export function RecipesPage() {
  const { activeHousehold, settings } = useAuth();
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<NonNullable<RecipeQuery['sort']>>('newest');
  const [tags, setTags] = useState<string[]>([]);
  const [diets, setDiets] = useState<string[]>([]);
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [excludedAllergens, setExcludedAllergens] = useState<string[]>([]);
  const [maxMinutes, setMaxMinutes] = useState<number | ''>('');
  const [maxKcal, setMaxKcal] = useState<number | ''>('');
  const [minProtein, setMinProtein] = useState<number | ''>('');
  const [source, setSource] = useState<'' | 'ai' | 'manual' | 'copied'>('');
  const [authorId, setAuthorId] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [householdPrefs, setHouseholdPrefs] = useState<HouseholdPreferences | null>(null);

  // Haushalts-Vorgaben als Filter-Vorlage laden
  useEffect(() => {
    if (!activeHousehold) {
      setHouseholdPrefs(null);
      return;
    }
    api<{ preferences: HouseholdPreferences }>(`/households/${activeHousehold.id}/preferences`)
      .then((data) => setHouseholdPrefs(data.preferences))
      .catch(() => setHouseholdPrefs(null));
  }, [activeHousehold?.id]);

  const applyHouseholdPrefs = () => {
    if (!householdPrefs) return;
    setDiets(householdPrefs.diets);
    setCuisines(householdPrefs.cuisines);
    setExcludedAllergens(householdPrefs.allergies);
    setMaxMinutes(householdPrefs.maxMinutes ?? '');
  };

  const activeFilters = useMemo(
    () =>
      [
        tags.length > 0,
        diets.length > 0,
        cuisines.length > 0,
        excludedAllergens.length > 0,
        maxMinutes !== '',
        maxKcal !== '',
        minProtein !== '',
        source !== '',
        authorId != null,
      ].filter(Boolean).length,
    [tags, diets, cuisines, excludedAllergens, maxMinutes, maxKcal, minProtein, source, authorId],
  );

  const load = useCallback(
    async (offset = 0) => {
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const base: RecipeQuery = {
          q: query.trim() || undefined,
          tags,
          diets,
          cuisines,
          excludeAllergens: excludedAllergens,
          sort,
          maxMinutes: maxMinutes === '' ? null : Number(maxMinutes),
          maxKcal: maxKcal === '' ? null : Number(maxKcal),
          minProtein: minProtein === '' ? null : Number(minProtein),
          source,
          authorId,
          favorites: tab === 'favorites',
          mine: tab === 'mine',
          limit: PAGE_SIZE,
          offset,
        };
        const data = await api<{ recipes: Recipe[]; total: number }>(`/recipes?${buildRecipeQuery(base)}`);
        setRecipes((prev) => (offset === 0 ? data.recipes : [...prev, ...data.recipes]));
        setTotal(data.total);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Rezepte konnten nicht geladen werden.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query, tags, diets, cuisines, excludedAllergens, sort, maxMinutes, maxKcal, minProtein, source, authorId, tab],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(0), 220);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        setFacets(await api<Facets>('/recipes/facets'));
      } catch {
        setFacets(null);
      }
    })();
  }, []);

  const toggleFavorite = async (recipe: Recipe) => {
    setRecipes((prev) =>
      prev.map((r) =>
        r.id === recipe.id
          ? { ...r, favorite: !r.favorite, favoriteCount: Math.max(0, r.favoriteCount + (r.favorite ? -1 : 1)) }
          : r,
      ),
    );
    try {
      await api(`/recipes/${recipe.id}/favorite`, { method: 'POST' });
    } catch {
      void load(0);
    }
  };

  const toggleIn = (list: string[], value: string, max = 12) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value].slice(0, max);

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag].slice(0, 8)));
  };

  const resetFilters = () => {
    setTags([]);
    setDiets([]);
    setCuisines([]);
    setExcludedAllergens([]);
    setMaxMinutes('');
    setMaxKcal('');
    setMinProtein('');
    setSource('');
    setAuthorId(null);
  };

  const emptyText =
    tab === 'favorites'
      ? 'Noch keine Favoriten — tippe bei einem Rezept auf das Herz.'
      : tab === 'mine'
        ? 'Du hast selbst noch keine Rezepte angelegt.'
        : 'Keine Rezepte gefunden — Filter zurücksetzen oder selbst eines anlegen.';

  return (
    <div className="space-y-4">
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label !mb-0">Rezepte</p>
          <p className="mt-1 text-xs text-ink/50">
            {facets ? `${facets.totals.recipes} Rezepte in der Sammlung · ${facets.totals.ratings} Bewertungen` : 'Gemeinsame Sammlung aller Haushalte'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4" /> Neues Rezept
        </button>
      </div>

      <div className="flex gap-1 rounded-2xl border border-ink/10 bg-white/70 p-1 text-sm font-semibold">
        {[
          { id: 'all' as Tab, label: 'Alle', icon: BookOpen },
          { id: 'favorites' as Tab, label: 'Favoriten', icon: Heart },
          { id: 'mine' as Tab, label: 'Meine', icon: UserRound },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 transition ${
              tab === id ? 'bg-leaf text-white shadow-sm' : 'text-ink/60 hover:bg-ink/5'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink/35" />
          <input
            className="input !pl-9"
            placeholder="Titel, Zutat oder Autor suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="select sm:max-w-[190px]" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          className={`btn ${activeFilters ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
        >
          <SlidersHorizontal className="h-4 w-4" /> Filter{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="card space-y-4 p-4">
          <div>
            <label className="label">Ernährungsform</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setDiets([])}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  diets.length === 0 ? 'border-leaf bg-leaf text-white' : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                }`}
              >
                Egal
              </button>
              {DIET_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => setDiets((prev) => toggleIn(prev, option))}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    diets.includes(option)
                      ? 'border-leaf bg-leaf text-white'
                      : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Präferierte Küche</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setCuisines([])}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  cuisines.length === 0 ? 'border-leaf bg-leaf text-white' : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                }`}
              >
                Egal
              </button>
              {CUISINE_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => setCuisines((prev) => toggleIn(prev, option))}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    cuisines.includes(option)
                      ? 'border-leaf bg-leaf text-white'
                      : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Allergien ausschließen</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setExcludedAllergens([])}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  excludedAllergens.length === 0
                    ? 'border-leaf bg-leaf text-white'
                    : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                }`}
              >
                Keine Allergien
              </button>
              {ALLERGY_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => setExcludedAllergens((prev) => toggleIn(prev, option, 14))}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    excludedAllergens.includes(option)
                      ? 'border-red-500 bg-red-500 text-white'
                      : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                  }`}
                >
                  ohne {option}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">Max. Zeit</label>
              <div className="flex flex-wrap gap-2">
                {TIME_OPTIONS.map((option) => (
                  <button
                    key={option.value || 'any'}
                    onClick={() => setMaxMinutes(option.value === '' ? '' : Number(option.value))}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      String(maxMinutes) === option.value
                        ? 'border-leaf bg-leaf text-white'
                        : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Kalorien</label>
              <div className="flex flex-wrap gap-2">
                {KCAL_OPTIONS.map((option) => (
                  <button
                    key={option.value || 'any'}
                    onClick={() => setMaxKcal(option.value === '' ? '' : Number(option.value))}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      String(maxKcal) === option.value
                        ? 'border-leaf bg-leaf text-white'
                        : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Min. Protein (g)</label>
              <input
                type="number"
                min={0}
                className="input"
                value={minProtein}
                onChange={(e) => setMinProtein(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="z. B. 25"
              />
            </div>
          </div>
          <div>
            <label className="label">Quelle</label>
            <div className="flex flex-wrap gap-2">
              {[
                { id: '' as const, label: 'Egal' },
                { id: 'ai' as const, label: 'Per KI erstellt' },
                { id: 'manual' as const, label: 'Selbst geschrieben' },
                { id: 'copied' as const, label: 'Kopiert' },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSource(s.id)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    source === s.id ? 'border-leaf bg-leaf-soft text-leaf' : 'border-ink/15 text-ink/55 hover:border-leaf/40'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {facets && facets.authors.length > 1 && (
            <div>
              <label className="label">Autor</label>
              <div className="flex flex-wrap gap-2">
                {facets.authors.slice(0, 12).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAuthorId(authorId === a.id ? null : a.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      authorId === a.id ? 'border-leaf bg-leaf text-white' : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                    }`}
                  >
                    {a.name} <span className="opacity-60">{a.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {facets && facets.tags.length > 0 && (
            <div>
              <label className="label">Tags</label>
              <div className="flex flex-wrap gap-2">
                {facets.tags.map((t) => (
                  <button
                    key={t.tag}
                    onClick={() => toggleTag(t.tag)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      tags.includes(t.tag)
                        ? 'border-leaf bg-leaf text-white'
                        : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                    }`}
                  >
                    {t.tag} <span className="opacity-60">{t.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {householdPrefs &&
            (householdPrefs.diets.length > 0 ||
              householdPrefs.cuisines.length > 0 ||
              householdPrefs.allergies.length > 0 ||
              householdPrefs.maxMinutes != null) && (
              <button
                className="btn btn-ghost !px-2 !py-1 text-[11px]"
                onClick={applyHouseholdPrefs}
                title="Ernährungsform, Küche, Allergien und Zeitvorgabe des Haushalts übernehmen"
              >
                <Users className="h-3.5 w-3.5" /> Haushalt übernehmen
              </button>
            )}
          {activeFilters > 0 && (
            <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={resetFilters}>
              <X className="h-3 w-3" /> Filter zurücksetzen
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-ink/50">
        <span>
          {loading ? 'Wird geladen …' : `${total} ${total === 1 ? 'Rezept' : 'Rezepte'}${activeFilters || query ? ' gefunden' : ''}`}
        </span>
        <span className="inline-flex items-center gap-1">
          <Filter className="h-3.5 w-3.5" /> {SORTS.find((s) => s.id === sort)?.label}
        </span>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

      {loading ? (
        <div className="card flex items-center justify-center gap-2 p-10 text-sm text-ink/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Rezepte werden geladen …
        </div>
      ) : recipes.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-display text-lg font-bold">Nichts gefunden</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink/55">{emptyText}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>
              <Sparkles className="h-4 w-4" /> Rezept per KI erstellen
            </button>
            {activeFilters > 0 && (
              <button className="btn btn-ghost" onClick={resetFilters}>
                Filter zurücksetzen
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {recipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onOpen={() => navigate(`recipe/${recipe.id}`)}
                onToggleFavorite={() => void toggleFavorite(recipe)}
              />
            ))}
          </div>
          {recipes.length < total && (
            <div className="flex justify-center pt-2">
              <button className="btn btn-ghost" onClick={() => void load(recipes.length)} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Mehr laden ({total - recipes.length})
              </button>
            </div>
          )}
        </>
      )}

      {showNew && <NewRecipeModal onClose={() => setShowNew(false)} onCreated={() => void load(0)} />}
    </div>
  );
}

function NewRecipeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { activeHousehold, settings } = useAuth();
  const [tab, setTab] = useState<'ai' | 'manual'>('ai');
  const [idea, setIdea] = useState('');
  const [servings, setServings] = useState(settings.defaultServings);
  const [constraints, setConstraints] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (idea.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ recipe: Recipe }>('/ai/recipe', {
        method: 'POST',
        body: {
          householdId: activeHousehold?.id,
          idea,
          servings,
          constraints,
          save: 'favorite',
        },
      });
      onClose();
      onCreated();
      if (data.recipe?.id) navigate(`recipe/${data.recipe.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das Rezept konnte nicht erstellt werden.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Neues Rezept" subtitle="Direkt von der KI erstellen lassen oder selbst schreiben" onClose={onClose}>
      <div className="mb-4 flex gap-1 rounded-xl bg-ink/5 p-1 text-sm font-semibold">
        {[
          { id: 'ai' as const, label: 'KI-Idee' },
          { id: 'manual' as const, label: 'Selbst schreiben' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg py-1.5 transition ${tab === t.id ? 'bg-white shadow-sm' : 'text-ink/55'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ai' ? (
        <div className="space-y-3">
          <div>
            <label className="label">Wonach ist dir?</label>
            <textarea
              className="textarea"
              rows={3}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="z. B. cremige Pasta mit Spinat und Zitrone, vegetarisch"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Portionen</label>
              <input
                type="number"
                min={1}
                max={12}
                className="input"
                value={servings}
                onChange={(e) => setServings(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Zusatz-Vorgaben</label>
              <input
                className="input"
                value={constraints}
                onChange={(e) => setConstraints(e.target.value)}
                placeholder="ohne Nüsse, scharf"
              />
            </div>
          </div>
          <AiDefaultsHint settings={settings} />
          <button className="btn btn-primary w-full" onClick={() => void generate()} disabled={busy || idea.trim().length < 3}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? 'Rezept wird geschrieben …' : 'Erstellen und zu Favoriten'}
          </button>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink/60">
            Du landest im Editor und trägst Titel, Zutaten, Schritte und Nährwerte selbst ein. Das Rezept wird für alle
            sichtbar.
          </p>
          <button
            className="btn btn-primary w-full"
            onClick={() => {
              onClose();
              navigate('recipe/new');
            }}
          >
            <Plus className="h-4 w-4" /> Leeres Rezept anlegen
          </button>
        </div>
      )}
    </Modal>
  );
}

function AiDefaultsHint({ settings }: { settings: UserSettings }) {
  const parts = [
    settings.diets.length > 0 && `Ernährungsform: ${settings.diets.join(', ')}`,
    settings.allergies.length > 0 && `Allergien: ${settings.allergies.join(', ')}`,
    settings.cuisines.length > 0 && `Küche: ${settings.cuisines.join(', ')}`,
    settings.maxMinutes && `max. ${settings.maxMinutes} min`,
    settings.kcalTarget && `${settings.kcalTarget} kcal`,
  ].filter(Boolean) as string[];
  if (!parts.length) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-ink/45">
        <Star className="h-3 w-3" /> Eigene Vorgaben (Diät, Allergien, Kalorien) lassen sich im Profil hinterlegen.
      </p>
    );
  }
  return <p className="text-[11px] text-ink/45">Aus deinen Einstellungen: {parts.join(' · ')}</p>;
}
