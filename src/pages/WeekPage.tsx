import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { addDays, api, formatDayMonth, formatWeekLabel, mondayOf } from '../lib/api';
import { SLOTS, WEEKDAYS, type PlanEntry, type Recipe, type ShoppingItem, type Slot, type WeekPlan } from '../lib/types';
import { Modal } from '../components/Modal';

const GRID_SLOTS: Slot[] = ['fruehstueck', 'mittag', 'abend', 'snack'];

export function WeekPage() {
  const { activeHousehold } = useAuth();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slotTarget, setSlotTarget] = useState<{ dayIndex: number; slot: Slot } | null>(null);
  const [showAi, setShowAi] = useState(false);
  const [showShopping, setShowShopping] = useState(false);

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<WeekPlan>(`/plans/${activeHousehold.id}/${weekStart}`);
      setPlan(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Woche konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [activeHousehold, weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDaySlot = useMemo(() => {
    const map = new Map<string, PlanEntry>();
    for (const entry of plan?.entries ?? []) map.set(`${entry.dayIndex}:${entry.slot}`, entry);
    return map;
  }, [plan]);

  const dayTotals = useMemo(() => {
    const totals = new Array(7).fill(0) as number[];
    for (const entry of plan?.entries ?? []) {
      totals[entry.dayIndex] += Number(entry.nutrition?.kcal ?? 0);
    }
    return totals;
  }, [plan]);

  if (!activeHousehold) {
    return <p className="card p-6 text-sm text-ink/60">Kein Haushalt gefunden — bitte im Tab „Haushalt" einen anlegen.</p>;
  }

  const removeEntry = async (entry: PlanEntry) => {
    try {
      const data = await api<WeekPlan>(`/plans/${activeHousehold.id}/${weekStart}/entry/${entry.id}`, {
        method: 'DELETE',
      });
      setPlan(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eintrag konnte nicht entfernt werden.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label !mb-0">Wochenplan · {activeHousehold.name}</p>
          <div className="mt-1 flex items-center gap-2">
            <button className="rounded-lg p-1.5 hover:bg-ink/5" onClick={() => setWeekStart(addDays(weekStart, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-display text-lg font-bold">{formatWeekLabel(weekStart)}</span>
            <button className="rounded-lg p-1.5 hover:bg-ink/5" onClick={() => setWeekStart(addDays(weekStart, 7))}>
              <ChevronRight className="h-4 w-4" />
            </button>
            <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setWeekStart(mondayOf(new Date()))}>
              Heute
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={() => setShowShopping(true)}>
            <ClipboardList className="h-4 w-4" /> Einkaufsliste
          </button>
          <button className="btn btn-primary" onClick={() => setShowAi(true)}>
            <Sparkles className="h-4 w-4" /> KI plant die Woche
          </button>
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

      {loading ? (
        <div className="card flex items-center justify-center gap-2 p-10 text-sm text-ink/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Woche wird geladen …
        </div>
      ) : (
        <>
          {/* Desktop: 7 Spalten */}
          <div className="hidden gap-3 lg:grid lg:grid-cols-7">
            {WEEKDAYS.map((day, dayIndex) => (
              <div key={day} className="card flex flex-col gap-2 p-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-xs font-bold uppercase tracking-wide text-ink/60">{day.slice(0, 2)}</p>
                  <p className="text-[10px] text-ink/35">{formatDayMonth(addDays(weekStart, dayIndex))}</p>
                </div>
                {GRID_SLOTS.map((slot) => {
                  const entry = byDaySlot.get(`${dayIndex}:${slot}`);
                  const label = SLOTS.find((s) => s.id === slot)!.label;
                  return entry ? (
                    <div key={slot} className="group rounded-xl border border-leaf/20 bg-leaf-soft/60 p-2">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-leaf/80">{label}</p>
                      <p className="mt-0.5 text-xs leading-snug font-semibold">{entry.title}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <button
                          className="text-[10px] font-semibold text-leaf/80 hover:underline"
                          onClick={() => window.location.assign(`#/recipe/${entry.recipeId ?? ''}`)}
                          disabled={!entry.recipeId}
                        >
                          {entry.recipeId ? 'Öffnen' : ''}
                        </button>
                        <button
                          className="opacity-0 transition group-hover:opacity-100"
                          onClick={() => void removeEntry(entry)}
                          aria-label="Entfernen"
                        >
                          <Trash2 className="h-3 w-3 text-ink/40 hover:text-clay" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      key={slot}
                      onClick={() => setSlotTarget({ dayIndex, slot })}
                      className="group flex min-h-[62px] flex-col items-start justify-center rounded-xl border border-dashed border-ink/15 px-2 py-1.5 text-left hover:border-leaf/40 hover:bg-leaf-soft/30"
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wide text-ink/35">{label}</span>
                      <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-ink/35 group-hover:text-leaf">
                        <Plus className="h-3 w-3" /> hinzufügen
                      </span>
                    </button>
                  );
                })}
                <p className="mt-auto pt-1 text-[10px] font-semibold text-ink/40">
                  {dayTotals[dayIndex] > 0 ? `≈ ${Math.round(dayTotals[dayIndex])} kcal` : '—'}
                </p>
              </div>
            ))}
          </div>

          {/* Mobil: Tage untereinander */}
          <div className="space-y-3 lg:hidden">
            {WEEKDAYS.map((day, dayIndex) => (
              <div key={day} className="card p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-sm font-bold">{day}</p>
                  <p className="text-[11px] text-ink/40">
                    {formatDayMonth(addDays(weekStart, dayIndex))}
                    {dayTotals[dayIndex] > 0 ? ` · ≈ ${Math.round(dayTotals[dayIndex])} kcal` : ''}
                  </p>
                </div>
                <div className="space-y-2">
                  {GRID_SLOTS.map((slot) => {
                    const entry = byDaySlot.get(`${dayIndex}:${slot}`);
                    const label = SLOTS.find((s) => s.id === slot)!.label;
                    return entry ? (
                      <div key={slot} className="flex items-center justify-between rounded-xl bg-leaf-soft/60 px-3 py-2">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wide text-leaf/80">{label}</p>
                          <p className="text-sm font-semibold">{entry.title}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {entry.recipeId && (
                            <button
                              className="text-[11px] font-semibold text-leaf"
                              onClick={() => window.location.assign(`#/recipe/${entry.recipeId}`)}
                            >
                              Öffnen
                            </button>
                          )}
                          <button onClick={() => void removeEntry(entry)} aria-label="Entfernen">
                            <Trash2 className="h-4 w-4 text-ink/35" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        key={slot}
                        onClick={() => setSlotTarget({ dayIndex, slot })}
                        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-ink/15 px-3 py-2 text-left text-xs font-semibold text-ink/45 hover:border-leaf/40 hover:text-leaf"
                      >
                        <Plus className="h-3.5 w-3.5" /> {label} hinzufügen
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {slotTarget && (
        <SlotPicker
          householdId={activeHousehold.id}
          weekStart={weekStart}
          target={slotTarget}
          onClose={() => setSlotTarget(null)}
          onSaved={(next) => {
            setPlan(next);
            setSlotTarget(null);
          }}
        />
      )}

      {showAi && (
        <AiWeekModal
          householdId={activeHousehold.id}
          weekStart={weekStart}
          onClose={() => setShowAi(false)}
          onDone={(next) => {
            setPlan(next);
          }}
        />
      )}

      {showShopping && <ShoppingModal householdId={activeHousehold.id} weekStart={weekStart} onClose={() => setShowShopping(false)} />}
    </div>
  );
}

function SlotPicker({
  householdId,
  weekStart,
  target,
  onClose,
  onSaved,
}: {
  householdId: string;
  weekStart: string;
  target: { dayIndex: number; slot: Slot };
  onClose: () => void;
  onSaved: (plan: WeekPlan) => void;
}) {
  const [tab, setTab] = useState<'recipe' | 'text' | 'ai'>('recipe');
  const [query, setQuery] = useState('');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [customTitle, setCustomTitle] = useState('');
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slotLabel = SLOTS.find((s) => s.id === target.slot)!.label;

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const data = await api<{ recipes: Recipe[] }>(`/recipes?householdId=${householdId}&q=${encodeURIComponent(query)}`);
        setRecipes(data.recipes);
      } catch {
        setRecipes([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [householdId, query]);

  const put = async (body: { recipeId?: string; customTitle?: string }) => {
    const plan = await api<WeekPlan>(`/plans/${householdId}/${weekStart}/entry`, {
      method: 'PUT',
      body: { dayIndex: target.dayIndex, slot: target.slot, ...body },
    });
    onSaved(plan);
  };

  const assignRecipe = async (recipeId: string) => {
    setBusy(true);
    setError(null);
    try {
      await put({ recipeId });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konnte nicht gespeichert werden.');
      setBusy(false);
    }
  };

  const saveText = async () => {
    if (!customTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await put({ customTitle: customTitle.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konnte nicht gespeichert werden.');
      setBusy(false);
    }
  };

  const generateAndAssign = async () => {
    if (idea.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const draft = await api<{ recipe: Omit<Recipe, 'id'> }>('/ai/recipe', {
        method: 'POST',
        body: { householdId, idea, servings: 2 },
      });
      const saved = await api<{ recipe: Recipe }>('/recipes', {
        method: 'POST',
        body: { ...draft.recipe, householdId },
      });
      await put({ recipeId: saved.recipe.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'KI konnte das Rezept nicht erstellen.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${slotLabel} · ${WEEKDAYS[target.dayIndex]}`}
      subtitle="Rezept auswählen, eigenen Eintrag setzen oder die KI fragen"
      onClose={onClose}
      wide
    >
      <div className="mb-4 flex gap-1 rounded-xl bg-ink/5 p-1 text-sm font-semibold">
        {[
          { id: 'recipe' as const, label: 'Rezept' },
          { id: 'text' as const, label: 'Freitext' },
          { id: 'ai' as const, label: 'KI-Rezept' },
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

      {tab === 'recipe' && (
        <div className="space-y-3">
          <input
            className="input"
            placeholder="Rezept suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {recipes.length === 0 && (
              <p className="flex items-center gap-2 p-4 text-sm text-ink/50">
                <UtensilsCrossed className="h-4 w-4" /> Keine Rezepte gefunden — leg im Tab „Rezepte" eines an.
              </p>
            )}
            {recipes.map((r) => (
              <button
                key={r.id}
                onClick={() => void assignRecipe(r.id)}
                disabled={busy}
                className="flex w-full items-center justify-between rounded-xl border border-ink/10 px-3 py-2 text-left hover:border-leaf/40 hover:bg-leaf-soft/30"
              >
                <span>
                  <span className="block text-sm font-semibold">{r.title}</span>
                  <span className="text-[11px] text-ink/50">
                    {r.prepMinutes ? `${r.prepMinutes} min · ` : ''}
                    {r.servings} Portionen
                    {r.nutrition?.kcal ? ` · ${Math.round(r.nutrition.kcal)} kcal` : ''}
                  </span>
                </span>
                <Plus className="h-4 w-4 text-leaf" />
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'text' && (
        <div className="space-y-3">
          <div>
            <label className="label">Was gibt es?</label>
            <input
              className="input"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="z. B. Pizza vom Italiener"
            />
          </div>
          <button className="btn btn-primary w-full" onClick={() => void saveText()} disabled={busy || !customTitle.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Eintragen
          </button>
        </div>
      )}

      {tab === 'ai' && (
        <div className="space-y-3">
          <div>
            <label className="label">Idee für dieses Gericht</label>
            <textarea
              className="textarea"
              rows={3}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="z. B. etwas Schnelles mit Kürbis, vegetarisch, max. 30 Minuten"
            />
          </div>
          <button className="btn btn-primary w-full" onClick={() => void generateAndAssign()} disabled={busy || idea.trim().length < 3}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Rezept erzeugen und eintragen
          </button>
          <p className="text-[11px] text-ink/50">
            Das Rezept wird gespeichert und landet direkt im Slot. Feinschliff geht danach im Rezept-Editor.
          </p>
        </div>
      )}

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
    </Modal>
  );
}

function AiWeekModal({
  householdId,
  weekStart,
  onClose,
  onDone,
}: {
  householdId: string;
  weekStart: string;
  onClose: () => void;
  onDone: (plan: WeekPlan) => void;
}) {
  const [servings, setServings] = useState(2);
  const [slots, setSlots] = useState<Slot[]>(['abend']);
  const [constraints, setConstraints] = useState('');
  const [mode, setMode] = useState<'replace' | 'fill'>('replace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const toggleSlot = (slot: Slot) => {
    setSlots((prev) => (prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]));
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ plan: WeekPlan; created: number; notes: string }>('/ai/week', {
        method: 'POST',
        body: { householdId, weekStart, servings, slots, constraints, mode },
      });
      setNotes(`${data.created} Mahlzeiten geplant. ${data.notes}`.trim());
      onDone(data.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Woche konnte nicht geplant werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="KI plant die Woche" subtitle={formatWeekLabel(weekStart)} onClose={onClose}>
      <div className="space-y-4">
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
            <label className="label">Modus</label>
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value as 'replace' | 'fill')}>
              <option value="replace">Woche neu planen</option>
              <option value="fill">Nur leere Slots füllen</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Welche Mahlzeiten?</label>
          <div className="flex flex-wrap gap-2">
            {SLOTS.map((s) => (
              <button
                key={s.id}
                onClick={() => toggleSlot(s.id)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  slots.includes(s.id)
                    ? 'border-leaf bg-leaf-soft text-leaf'
                    : 'border-ink/15 text-ink/55 hover:border-leaf/40'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Vorgaben (optional)</label>
          <textarea
            className="textarea"
            rows={3}
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            placeholder="z. B. vegetarisch, keine Nüsse, unter 45 Minuten, ca. 2000 kcal am Tag, Kinder mögen kein Gemüse"
          />
        </div>

        <button className="btn btn-primary w-full" onClick={() => void run()} disabled={busy || slots.length === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Woche wird geplant …' : 'Woche planen'}
        </button>
        {busy && <p className="text-center text-[11px] text-ink/50">Das kann 20–60 Sekunden dauern.</p>}
        {notes && <p className="rounded-xl bg-leaf-soft px-3 py-2 text-sm text-leaf">{notes}</p>}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}

function ShoppingModal({
  householdId,
  weekStart,
  onClose,
}: {
  householdId: string;
  weekStart: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ShoppingItem[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<{ items: ShoppingItem[] }>(`/plans/${householdId}/${weekStart}/shopping-list`);
        setItems(data.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Einkaufsliste konnte nicht geladen werden.');
      }
    })();
  }, [householdId, weekStart]);

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const copy = async () => {
    if (!items) return;
    const text = items
      .map((i) => `${i.approximated ? '~' : ''}${i.amount ? `${i.amount} ${i.unit} ` : ''}${i.name}`.trim())
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Kopieren hat nicht geklappt.');
    }
  };

  return (
    <Modal
      title="Einkaufsliste"
      subtitle={formatWeekLabel(weekStart)}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink/50">{items ? `${items.length} Posten` : ''}</span>
          <button className="btn btn-ghost text-xs" onClick={() => void copy()} disabled={!items?.length}>
            {copied ? 'Kopiert ✓' : 'Als Text kopieren'}
          </button>
        </div>
      }
    >
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      {!items && !error && <p className="p-4 text-sm text-ink/50">Wird geladen …</p>}
      {items && items.length === 0 && (
        <p className="p-4 text-sm text-ink/50">Für diese Woche sind noch keine Rezepte eingeplant.</p>
      )}
      <ul className="divide-y divide-ink/5">
        {items?.map((item) => {
          const key = `${item.name}|${item.unit}`;
          const isChecked = checked.has(key);
          return (
            <li key={key}>
              <button
                className="flex w-full items-center gap-3 py-2 text-left"
                onClick={() => toggle(key)}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    isChecked ? 'border-leaf bg-leaf text-white' : 'border-ink/25'
                  }`}
                >
                  {isChecked ? '✓' : ''}
                </span>
                <span className={`flex-1 text-sm ${isChecked ? 'text-ink/35 line-through' : ''}`}>
                  {item.name}
                  {item.unit ? <span className="text-ink/45"> · {item.unit}</span> : null}
                </span>
                <span className="text-sm font-semibold text-ink/70">
                  {item.approximated ? '~' : ''}
                  {item.amount || ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
