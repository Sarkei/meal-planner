import { useCallback, useEffect, useMemo, useState } from 'react';
import { Heart, Loader2, Plus, Search, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { navigate } from '../App';
import { RecipeCard } from '../components/RecipeCard';
import { Modal } from '../components/Modal';
import type { Recipe } from '../lib/types';

export function RecipesPage() {
  const { activeHousehold } = useAuth();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [query, setQuery] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ householdId: activeHousehold.id });
      if (query.trim()) params.set('q', query.trim());
      if (onlyFavorites) params.set('favorites', '1');
      const data = await api<{ recipes: Recipe[] }>(`/recipes?${params.toString()}`);
      setRecipes(data.recipes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rezepte konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [activeHousehold, query, onlyFavorites]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const toggleFavorite = async (recipe: Recipe) => {
    setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? { ...r, favorite: !r.favorite } : r)));
    try {
      await api(`/recipes/${recipe.id}/favorite`, { method: 'POST' });
    } catch {
      void load();
    }
  };

  const stats = useMemo(() => {
    const favorites = recipes.filter((r) => r.favorite).length;
    const ai = recipes.filter((r) => r.source === 'ai').length;
    return { favorites, ai };
  }, [recipes]);

  if (!activeHousehold) {
    return <p className="card p-6 text-sm text-ink/60">Kein Haushalt gefunden.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label !mb-0">Rezepte · {activeHousehold.name}</p>
          <p className="mt-1 text-xs text-ink/50">
            {recipes.length} Rezepte · {stats.favorites} Favoriten · {stats.ai} von der KI
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4" /> Neues Rezept
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink/35" />
          <input
            className="input !pl-9"
            placeholder="Nach Titel, Beschreibung oder Zutat suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className={`btn ${onlyFavorites ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setOnlyFavorites((v) => !v)}
        >
          <Heart className={`h-4 w-4 ${onlyFavorites ? 'fill-current' : ''}`} /> Favoriten
        </button>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

      {loading ? (
        <div className="card flex items-center justify-center gap-2 p-10 text-sm text-ink/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Rezepte werden geladen …
        </div>
      ) : recipes.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-display text-lg font-bold">Noch keine Rezepte</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink/55">
            Leg das erste Rezept selbst an — oder lass dir von der KI eines vorschlagen.
          </p>
          <button className="btn btn-primary mt-4" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> Erstes Rezept
          </button>
        </div>
      ) : (
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
      )}

      {showNew && <NewRecipeModal householdId={activeHousehold.id} onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewRecipeModal({ householdId, onClose }: { householdId: string; onClose: () => void }) {
  const [tab, setTab] = useState<'ai' | 'manual'>('ai');
  const [idea, setIdea] = useState('');
  const [servings, setServings] = useState(2);
  const [constraints, setConstraints] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (idea.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const draft = await api<{ recipe: Omit<Recipe, 'id'> }>('/ai/recipe', {
        method: 'POST',
        body: { householdId, idea, servings, constraints },
      });
      const saved = await api<{ recipe: Recipe }>('/recipes', {
        method: 'POST',
        body: { ...draft.recipe, householdId },
      });
      onClose();
      navigate(`recipe/${saved.recipe.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das Rezept konnte nicht erstellt werden.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Neues Rezept" subtitle="Selbst schreiben oder die KI fragen" onClose={onClose}>
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
              <label className="label">Vorgaben</label>
              <input
                className="input"
                value={constraints}
                onChange={(e) => setConstraints(e.target.value)}
                placeholder="ohne Nüsse, schnell"
              />
            </div>
          </div>
          <button className="btn btn-primary w-full" onClick={() => void generate()} disabled={busy || idea.trim().length < 3}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? 'Rezept wird geschrieben …' : 'Rezept erzeugen'}
          </button>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink/60">
            Du landest im Editor und kannst Titel, Zutaten, Schritte und Nährwerte selbst eintragen.
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
