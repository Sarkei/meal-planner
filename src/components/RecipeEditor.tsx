import { Plus, Trash2 } from 'lucide-react';
import type { Ingredient, RecipeDraft } from '../lib/types';

export function RecipeEditor({ value, onChange }: { value: RecipeDraft; onChange: (next: RecipeDraft) => void }) {
  const set = <K extends keyof RecipeDraft>(key: K, val: RecipeDraft[K]) => onChange({ ...value, [key]: val });

  const setIngredient = (index: number, patch: Partial<Ingredient>) => {
    const next = value.ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing));
    set('ingredients', next);
  };

  const setStep = (index: number, text: string) => {
    const next = value.steps.map((s, i) => (i === index ? text : s));
    set('steps', next);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Titel</label>
          <input className="input" value={value.title} onChange={(e) => set('title', e.target.value)} placeholder="z. B. Kürbis-Kokos-Curry" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Beschreibung</label>
          <textarea
            className="textarea"
            rows={2}
            value={value.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Kurz, worum es geht — Herkunft, Anlass, Besonderheit"
          />
        </div>
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
          <label className="label">Vorbereitungszeit (Minuten)</label>
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
          <label className="label">Gesamtzeit (Minuten)</label>
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
        <div className="sm:col-span-2">
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
        <div className="sm:col-span-2">
          <label className="label">Bild vom Gericht</label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            {value.imageUrl ? (
              <div className="relative w-full sm:w-48">
                <img src={value.imageUrl} alt="Rezeptbild" className="h-28 w-full rounded-xl object-cover" />
                <button
                  type="button"
                  onClick={() => set('imageUrl', null)}
                  className="absolute top-1 right-1 rounded-lg bg-black/60 p-1 text-white"
                  aria-label="Bild entfernen"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex h-28 w-full items-center justify-center rounded-xl border border-dashed border-ink/20 text-xs text-ink/40 sm:w-48">
                noch kein Bild
              </div>
            )}
            <div className="flex-1 space-y-2">
              <input
                className="input"
                value={value.imageUrl?.startsWith('data:') ? '' : value.imageUrl ?? ''}
                onChange={(e) => set('imageUrl', e.target.value.trim() || null)}
                placeholder="Bild-URL einfügen (https://…)"
              />
              <label className="btn btn-ghost cursor-pointer text-xs">
                <Plus className="h-3.5 w-3.5" /> Bild hochladen
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void resizeImage(file).then((dataUrl) => set('imageUrl', dataUrl));
                  }}
                />
              </label>
            </div>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Tags (mit Komma trennen)</label>
          <input
            className="input"
            value={value.tags.join(', ')}
            onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
            placeholder="vegetarisch, schnell, mealprep"
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="label !mb-0">Zutaten</p>
          <button
            className="btn btn-ghost !px-2 !py-1 text-[11px]"
            onClick={() => set('ingredients', [...value.ingredients, { name: '', amount: null, unit: '' }])}
          >
            <Plus className="h-3 w-3" /> Zutat
          </button>
        </div>
        <div className="space-y-2">
          {value.ingredients.map((ing, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="input flex-1"
                value={ing.name}
                onChange={(e) => setIngredient(i, { name: e.target.value })}
                placeholder="Zutat"
              />
              <input
                className="input !w-24"
                type="number"
                step="0.1"
                min={0}
                value={ing.amount ?? ''}
                onChange={(e) => setIngredient(i, { amount: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="Menge"
              />
              <input
                className="input !w-24"
                value={ing.unit}
                onChange={(e) => setIngredient(i, { unit: e.target.value })}
                placeholder="Einheit"
              />
              <button
                className="rounded-lg p-2 text-ink/35 hover:bg-red-50 hover:text-clay"
                onClick={() => set('ingredients', value.ingredients.filter((_, idx) => idx !== i))}
                aria-label="Zutat entfernen"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="label !mb-0">Zubereitung</p>
          <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => set('steps', [...value.steps, ''])}>
            <Plus className="h-3 w-3" /> Schritt
          </button>
        </div>
        <div className="space-y-2">
          {value.steps.map((step, i) => (
            <div key={i} className="flex gap-2">
              <span className="mt-2.5 w-5 shrink-0 text-xs font-bold text-ink/40">{i + 1}.</span>
              <textarea className="textarea" rows={2} value={step} onChange={(e) => setStep(i, e.target.value)} />
              <button
                className="rounded-lg p-2 text-ink/35 hover:bg-red-50 hover:text-clay"
                onClick={() => set('steps', value.steps.filter((_, idx) => idx !== i))}
                aria-label="Schritt entfernen"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="label">Nährwerte pro Portion</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            ['kcal', 'Kalorien'],
            ['protein', 'Protein (g)'],
            ['carbs', 'Kohlenhydrate (g)'],
            ['fat', 'Fett (g)'],
          ] as const).map(([key, label]) => (
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
  );
}

/** Bild im Browser auf max. 1200 px verkleinern und als JPEG-Data-URL zurückgeben. */
async function resizeImage(file: File, maxSize = 1200): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
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
