import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Ingredient, Nutrition, RecipeDraft } from '../lib/types';
import { api } from '../lib/api';
import { FoodSearch } from './FoodSearch';

/** Alle Einheiten, die in der Sammlung vorkommen — als Dropdown statt Freitext. */
export const UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'Stück',
  'Zehe',
  'Bund',
  'Scheibe',
  'Blatt',
  'Stange',
  'Dose',
  'Packung',
  'Becher',
  'Tasse',
  'Handvoll',
  'EL',
  'TL',
  'Prise',
  'cm',
  'Zweig',
  'nach Bedarf',
] as const;

/** Textfeld, das mit dem Inhalt wächst (kein manuelles Ziehen mehr). */
function AutoTextarea({
  id,
  value,
  onChange,
  placeholder,
  onKeyDown,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      id={id}
      ref={ref}
      rows={1}
      className="textarea resize-none overflow-hidden leading-relaxed"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
    />
  );
}

export function RecipeEditor({ value, onChange }: { value: RecipeDraft; onChange: (next: RecipeDraft) => void }) {
  const set = <K extends keyof RecipeDraft>(key: K, val: RecipeDraft[K]) => onChange({ ...value, [key]: val });

  const [estimating, setEstimating] = useState(false);
  const [estimateNote, setEstimateNote] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const lastKey = useRef('');

  const nutritionKey = JSON.stringify(
    value.ingredients
      .filter((i) => i.name.trim().length >= 2)
      .map((i) => [i.name.trim().toLowerCase(), i.amount, i.unit.trim().toLowerCase()]),
  ) + `|${value.servings}`;

  // Nährwerte live schätzen, sobald sich Zutaten oder Portionen ändern (entprellt).
  useEffect(() => {
    const filled = valueRef.current.ingredients.filter((i) => i.name.trim().length >= 2);
    if (!filled.length || lastKey.current === nutritionKey) return;
    const timer = window.setTimeout(async () => {
      setEstimating(true);
      try {
        const data = await api<{ nutrition: Nutrition }>('/ai/nutrition', {
          method: 'POST',
          body: { servings: valueRef.current.servings, ingredients: filled },
        });
        lastKey.current = nutritionKey;
        onChange({ ...valueRef.current, nutrition: data.nutrition });
        setEstimateNote('Nährwerte per KI geschätzt');
      } catch {
        setEstimateNote('Schätzung gerade nicht möglich — Werte bleiben wie eingetragen.');
      } finally {
        setEstimating(false);
      }
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nutritionKey]);

  const setIngredient = (index: number, patch: Partial<Ingredient>) => {
    set(
      'ingredients',
      value.ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)),
    );
  };

  const addIngredient = (focus?: boolean) => {
    set('ingredients', [...value.ingredients, { name: '', amount: null, unit: '' }]);
    if (focus) {
      setTimeout(() => document.getElementById(`ing-name-${value.ingredients.length}`)?.focus(), 30);
    }
  };

  const addStep = (focus?: boolean) => {
    set('steps', [...value.steps, '']);
    if (focus) {
      setTimeout(() => document.getElementById(`step-${value.steps.length}`)?.focus(), 30);
    }
  };

  const setStep = (index: number, text: string) => set('steps', value.steps.map((s, i) => (i === index ? text : s)));

  const enterAdds = (e: React.KeyboardEvent, add: () => void) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      add();
    }
  };

  return (
    <div className="space-y-6">
      {/* Titel + Beschreibung */}
      <div className="space-y-3">
        <input
          className="w-full border-0 bg-transparent p-0 font-display text-2xl font-bold outline-none placeholder:text-ink/30 sm:text-3xl"
          value={value.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Name des Gerichts"
        />
        <textarea
          className="textarea"
          rows={2}
          value={value.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Kurz beschreiben: worum geht es, was macht es besonders?"
        />
      </div>

      {/* Portionen / Vorbereitung / Gesamt — Desktop nebeneinander, mobil untereinander */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Portionen</label>
          <input
            type="number"
            min={1}
            max={50}
            className="input"
            value={value.servings}
            onChange={(e) => set('servings', Math.max(1, Number(e.target.value)))}
          />
        </div>
        <div>
          <label className="label">Vorbereitungszeit (min)</label>
          <input
            type="number"
            min={0}
            max={1440}
            className="input"
            value={value.prepMinutes ?? ''}
            onChange={(e) => set('prepMinutes', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="15"
          />
        </div>
        <div>
          <label className="label">Gesamtzeit (min)</label>
          <input
            type="number"
            min={0}
            max={2880}
            className="input"
            value={value.totalMinutes ?? ''}
            onChange={(e) => set('totalMinutes', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="35"
          />
        </div>
      </div>

      <div>
        <label className="label">Aufwand</label>
        <div className="flex flex-wrap gap-2">
          {(['leicht', 'mittel', 'schwer'] as const).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => set('difficulty', level)}
              className={`rounded-xl border px-3 py-1.5 text-xs font-semibold capitalize transition ${
                value.difficulty === level
                  ? 'border-leaf bg-leaf-soft text-leaf'
                  : 'border-ink/15 text-ink/55 hover:border-leaf/40'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      {/* Zutaten */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="label !mb-0">Zutaten</p>
          <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => addIngredient(true)}>
            <Plus className="h-3 w-3" /> Zutat
          </button>
        </div>
        <FoodSearch
          onPick={(hit, grams) => {
            const emptyIndex = value.ingredients.findIndex((ing) => !ing.name.trim());
            const brand = hit.brand && !hit.name.toLowerCase().includes(hit.brand.toLowerCase()) ? hit.brand : '';
            const name = brand ? `${hit.name} (${brand})` : hit.name;
            const patch = { name, amount: grams, unit: 'g' };
            if (emptyIndex >= 0) {
              setIngredient(emptyIndex, patch);
              document.getElementById(`ing-name-${emptyIndex}`)?.focus();
            } else {
              set('ingredients', [...value.ingredients, patch]);
            }
          }}
        />
        <div className="space-y-2">
          {value.ingredients.map((ing, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-xs font-bold text-ink/35">{i + 1}.</span>
              <input
                id={`ing-name-${i}`}
                className="input flex-1"
                value={ing.name}
                onChange={(e) => setIngredient(i, { name: e.target.value })}
                onKeyDown={(e) => enterAdds(e, () => addIngredient(true))}
                placeholder="Zutat"
              />
              <input
                className="input !w-28 text-center"
                type="number"
                step="0.1"
                min={0}
                value={ing.amount ?? ''}
                onChange={(e) => setIngredient(i, { amount: e.target.value === '' ? null : Number(e.target.value) })}
                onKeyDown={(e) => enterAdds(e, () => addIngredient(true))}
                placeholder="Menge"
              />
              <select
                className="input !w-32"
                value={ing.unit || ''}
                onChange={(e) => setIngredient(i, { unit: e.target.value })}
              >
                <option value="">Einheit</option>
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
                {ing.unit && !UNITS.includes(ing.unit as (typeof UNITS)[number]) && (
                  <option value={ing.unit}>{ing.unit} (alt)</option>
                )}
              </select>
              <button
                className="rounded-lg p-1.5 text-ink/30 hover:bg-red-50 hover:text-clay"
                onClick={() => set('ingredients', value.ingredients.filter((_, idx) => idx !== i))}
                aria-label="Zutat entfernen"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-ink/40">Enter fügt die nächste Zutat hinzu.</p>
      </div>

      {/* Zubereitung */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="label !mb-0">Zubereitung</p>
          <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => addStep(true)}>
            <Plus className="h-3 w-3" /> Schritt
          </button>
        </div>
        <div className="space-y-2">
          {value.steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-[11px] font-bold text-leaf">
                {i + 1}
              </span>
              <div className="flex-1">
                <AutoTextarea
                  id={`step-${i}`}
                  value={step}
                  onChange={(text) => setStep(i, text)}
                  onKeyDown={(e) => enterAdds(e, () => addStep(true))}
                  placeholder={i === 0 ? 'Was zuerst? Enter für den nächsten Schritt.' : 'Nächster Schritt'}
                />
              </div>
              <button
                className="mt-1 rounded-lg p-1.5 text-ink/30 hover:bg-red-50 hover:text-clay"
                onClick={() => set('steps', value.steps.filter((_, idx) => idx !== i))}
                aria-label="Schritt entfernen"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-ink/40">Enter fügt den nächsten Schritt hinzu, Shift+Enter macht einen Absatz.</p>
      </div>

      {/* Tags + Nährwerte */}
      <div className="space-y-3">
        <div>
          <label className="label">Tags (mit Komma trennen)</label>
          <input
            className="input"
            value={value.tags.join(', ')}
            onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
            placeholder="vegetarisch, schnell, mealprep"
          />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="label !mb-0">Nährwerte pro Portion</p>
            {estimating ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-leaf">
                <Loader2 className="h-3 w-3 animate-spin" /> wird geschätzt …
              </span>
            ) : (
              estimateNote && (
                <span className="inline-flex items-center gap-1 text-[11px] text-ink/45">
                  <Sparkles className="h-3 w-3 text-leaf" /> {estimateNote}
                </span>
              )
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['kcal', 'Kalorien'],
                ['protein', 'Protein (g)'],
                ['carbs', 'Kohlenhydrate (g)'],
                ['fat', 'Fett (g)'],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={value.nutrition?.[key] ?? ''}
                  onChange={(e) =>
                    set('nutrition', {
                      ...value.nutrition,
                      [key]: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                />
                <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-ink/40">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function emptyRecipeDraft(): RecipeDraft {
  return {
    title: '',
    description: '',
    servings: 2,
    prepMinutes: null,
    totalMinutes: null,
    difficulty: 'mittel',
    imageUrl: null,
    tags: [],
    ingredients: [{ name: '', amount: null, unit: '' }],
    steps: [''],
    nutrition: {},
  };
}
