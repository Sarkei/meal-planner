import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Clock, Heart, Loader2, Pencil, Save, Sparkles, Trash2, Users, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { navigate } from '../App';
import { RecipeEditor, emptyRecipeDraft } from '../components/RecipeEditor';
import { Modal } from '../components/Modal';
import type { Recipe, RecipeDraft } from '../lib/types';

function toDraft(recipe: Recipe): RecipeDraft {
  return {
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    prepMinutes: recipe.prepMinutes,
    tags: recipe.tags,
    ingredients: recipe.ingredients.length ? recipe.ingredients : [{ name: '', amount: null, unit: '' }],
    steps: recipe.steps.length ? recipe.steps : [''],
    nutrition: recipe.nutrition,
  };
}

export function RecipeDetailPage({ recipeId }: { recipeId?: string }) {
  const { activeHousehold } = useAuth();
  const isNew = !recipeId || recipeId === 'new';
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [draft, setDraft] = useState<RecipeDraft>(emptyRecipeDraft);
  const [editing, setEditing] = useState(isNew);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRefine, setShowRefine] = useState(false);

  const load = useCallback(async () => {
    if (isNew) {
      setEditing(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api<{ recipe: Recipe }>(`/recipes/${recipeId}`);
      setRecipe(data.recipe);
      setDraft(toDraft(data.recipe));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rezept konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [isNew, recipeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!activeHousehold) return;
    if (!draft.title.trim() || draft.ingredients.every((i) => !i.name.trim()) || draft.steps.every((s) => !s.trim())) {
      setError('Titel, mindestens eine Zutat und ein Schritt sind Pflicht.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...draft,
        ingredients: draft.ingredients.filter((i) => i.name.trim()),
        steps: draft.steps.map((s) => s.trim()).filter(Boolean),
      };
      if (recipe) {
        const data = await api<{ recipe: Recipe }>(`/recipes/${recipe.id}`, { method: 'PATCH', body });
        setRecipe(data.recipe);
        setDraft(toDraft(data.recipe));
        setEditing(false);
      } else {
        const data = await api<{ recipe: Recipe }>('/recipes', {
          method: 'POST',
          body: { ...body, householdId: activeHousehold.id },
        });
        setRecipe(data.recipe);
        setDraft(toDraft(data.recipe));
        setEditing(false);
        navigate(`recipe/${data.recipe.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!recipe) return;
    if (!window.confirm(`„${recipe.title}" wirklich löschen?`)) return;
    setBusy(true);
    try {
      await api(`/recipes/${recipe.id}`, { method: 'DELETE' });
      navigate('recipes');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.');
      setBusy(false);
    }
  };

  const toggleFavorite = async () => {
    if (!recipe) return;
    setRecipe({ ...recipe, favorite: !recipe.favorite });
    try {
      await api(`/recipes/${recipe.id}/favorite`, { method: 'POST' });
    } catch {
      void load();
    }
  };

  if (loading) {
    return (
      <div className="card flex items-center justify-center gap-2 p-10 text-sm text-ink/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Rezept wird geladen …
      </div>
    );
  }

  if (error && !recipe && !isNew) {
    return (
      <div className="card p-6">
        <p className="text-sm font-medium text-red-700">{error}</p>
        <button className="btn btn-ghost mt-3" onClick={() => navigate('recipes')}>
          <ArrowLeft className="h-4 w-4" /> Zurück zu den Rezepten
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button className="btn btn-ghost !px-2 !py-1.5 text-xs" onClick={() => navigate('recipes')}>
          <ArrowLeft className="h-4 w-4" /> Rezepte
        </button>
        <div className="flex items-center gap-2">
          {recipe && !editing && (
            <>
              <button
                className={`btn btn-ghost !px-2 !py-1.5 text-xs ${recipe.favorite ? '!text-clay' : ''}`}
                onClick={() => void toggleFavorite()}
              >
                <Heart className={`h-4 w-4 ${recipe.favorite ? 'fill-current' : ''}`} />
                {recipe.favorite ? 'Favorit' : 'Merken'}
              </button>
              <button className="btn btn-ghost !px-2 !py-1.5 text-xs" onClick={() => setShowRefine(true)}>
                <Sparkles className="h-4 w-4" /> KI verfeinern
              </button>
              <button className="btn btn-ghost !px-2 !py-1.5 text-xs" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Bearbeiten
              </button>
              <button className="btn btn-ghost !px-2 !py-1.5 text-xs !text-clay" onClick={() => void remove()} disabled={busy}>
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

      {editing ? (
        <div className="card space-y-5 p-5">
          <p className="label !mb-0">{recipe ? 'Rezept bearbeiten' : 'Neues Rezept'}</p>
          <RecipeEditor value={draft} onChange={setDraft} />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Speichern
            </button>
            {recipe && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setDraft(toDraft(recipe));
                  setEditing(false);
                  setError(null);
                }}
              >
                <X className="h-4 w-4" /> Abbrechen
              </button>
            )}
          </div>
        </div>
      ) : (
        recipe && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card space-y-4 p-5 lg:col-span-2">
              <div>
                <h2 className="font-display text-2xl leading-tight font-bold">{recipe.title}</h2>
                {recipe.description && <p className="mt-1 text-sm text-ink/60">{recipe.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-ink/55">
                  {recipe.prepMinutes != null && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> {recipe.prepMinutes} min
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" /> {recipe.servings} Portionen
                  </span>
                  {recipe.ownerName && <span>von {recipe.ownerName}</span>}
                  {recipe.source === 'ai' && (
                    <span className="inline-flex items-center gap-1 text-leaf">
                      <Sparkles className="h-3.5 w-3.5" /> per KI erstellt
                    </span>
                  )}
                </div>
                {recipe.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {recipe.tags.map((t) => (
                      <span key={t} className="chip">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="label">Zutaten</p>
                <ul className="divide-y divide-ink/5">
                  {recipe.ingredients.map((ing, i) => (
                    <li key={i} className="flex items-center justify-between py-2 text-sm">
                      <span>{ing.name}</span>
                      <span className="font-semibold text-ink/60">
                        {ing.amount ?? ''} {ing.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="label">Zubereitung</p>
                <ol className="space-y-2">
                  {recipe.steps.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm leading-relaxed">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-xs font-bold text-leaf">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="space-y-4">
              <div className="card p-5">
                <p className="label">Nährwerte pro Portion</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: 'kcal' as const, label: 'Kalorien', unit: '' },
                    { key: 'protein' as const, label: 'Protein', unit: 'g' },
                    { key: 'carbs' as const, label: 'Kohlenhydrate', unit: 'g' },
                    { key: 'fat' as const, label: 'Fett', unit: 'g' },
                  ].map(({ key, label, unit }) => (
                    <div key={key} className="rounded-xl bg-cream px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-ink/45">{label}</p>
                      <p className="text-lg font-bold">
                        {recipe.nutrition?.[key] != null ? `${Math.round(recipe.nutrition[key]!)}${unit ? ` ${unit}` : ''}` : '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card p-5 text-xs text-ink/55">
                <p className="label">Details</p>
                <p>Angelegt: {new Date(recipe.createdAt).toLocaleDateString('de-DE')}</p>
                <p>Zuletzt geändert: {new Date(recipe.updatedAt).toLocaleDateString('de-DE')}</p>
                <p className="mt-2">
                  Portionen lassen sich im Wochenplan anpassen — die Einkaufsliste rechnet automatisch um.
                </p>
              </div>
            </div>
          </div>
        )
      )}

      {showRefine && recipe && (
        <RefineModal
          householdId={recipe.householdId}
          draft={draft}
          onClose={() => setShowRefine(false)}
          onRefined={(next) => {
            setDraft(next);
            setEditing(true);
            setShowRefine(false);
          }}
        />
      )}
    </div>
  );
}

function RefineModal({
  householdId,
  draft,
  onClose,
  onRefined,
}: {
  householdId: string;
  draft: RecipeDraft;
  onClose: () => void;
  onRefined: (draft: RecipeDraft) => void;
}) {
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ recipe: RecipeDraft }>('/ai/recipe/refine', {
        method: 'POST',
        body: { householdId, recipe: draft, request },
      });
      onRefined(data.recipe);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die KI konnte das Rezept nicht überarbeiten.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="KI verfeinert das Rezept" subtitle="Änderungen landen im Editor — erst Speichern übernimmt sie" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Was soll geändert werden?</label>
          <textarea
            className="textarea"
            rows={3}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="z. B. weniger Kalorien, mehr Protein, schärfer, ohne Sahne, für 6 Portionen"
          />
        </div>
        <button className="btn btn-primary w-full" onClick={() => void run()} disabled={busy || request.trim().length < 2}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Wird überarbeitet …' : 'Überarbeiten'}
        </button>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
