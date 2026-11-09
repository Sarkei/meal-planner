import { Plus, Trash2, ImagePlus } from 'lucide-react';
import type { Ingredient, RecipeDraft } from '../lib/types';

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

export function RecipeEditor({ value, onChange }: { value: RecipeDraft; onChange: (next: RecipeDraft) => void }) {
  const set = <K extends keyof RecipeDraft>(key: K, val: RecipeDraft[K]) => onChange({ ...value, [key]: val });

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
      {/* Bild oben — wie in der fertigen Ansicht */}
      <div>
        {value.imageUrl ? (
          <div className="relative overflow-hidden rounded-2xl">
            <img src={value.imageUrl} alt="Rezeptbild" className="h-48 w-full object-cover sm:h-64" />
            <button
              type="button"
              onClick={() => set('imageUrl', null)}
              className="absolute top-2 right-2 rounded-lg bg-black/60 px-2 py-1 text-xs font-semibold text-white"
            >
              Bild entfernen
            </button>
          </div>
        ) : (
          <label className="flex h-36 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink/25 bg-cream text-sm text-ink/45 transition hover:border-leaf/50 hover:text-leaf sm:h-48">
            <ImagePlus className="h-7 w-7" />
            <span className="font-semibold">Bild vom Gericht hinzufügen</span>
            <span className="text-[11px]">Klicken zum Hochladen (wird automatisch verkleinert)</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void resizeImage(file).then((url) => set('imageUrl', url));
              }}
            />
          </label>
        )}
        {value.imageUrl && (
          <div className="mt-2 flex gap-2">
            <label className="btn btn-ghost cursor-pointer text-xs">
              <ImagePlus className="h-3.5 w-3.5" /> Anderes Bild
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void resizeImage(file).then((url) => set('imageUrl', url));
                }}
              />
            </label>
            <input
              className="input"
              value={value.imageUrl.startsWith('data:') ? '' : value.imageUrl}
              onChange={(e) => set('imageUrl', e.target.value.trim() || null)}
              placeholder="oder Bild-URL einfügen (https://…)"
            />
          </div>
        )}
      </div>

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
                className="input !w-20"
                type="number"
                step="0.1"
                min={0}
                value={ing.amount ?? ''}
                onChange={(e) => setIngredient(i, { amount: e.target.value === '' ? null : Number(e.target.value) })}
                onKeyDown={(e) => enterAdds(e, () => addIngredient(true))}
                placeholder="Menge"
              />
              <input
                className="input !w-20"
                value={ing.unit}
                onChange={(e) => setIngredient(i, { unit: e.target.value })}
                onKeyDown={(e) => enterAdds(e, () => addIngredient(true))}
                placeholder="Einheit"
              />
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
              <textarea
                id={`step-${i}`}
                className="textarea"
                rows={2}
                value={step}
                onChange={(e) => setStep(i, e.target.value)}
                onKeyDown={(e) => enterAdds(e, () => addStep(true))}
                placeholder={i === 0 ? 'Was zuerst? Enter für den nächsten Schritt.' : 'Nächster Schritt'}
              />
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
          <p className="label">Nährwerte pro Portion</p>
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
