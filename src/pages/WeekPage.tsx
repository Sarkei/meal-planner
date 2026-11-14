import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  GripVertical,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { addDays, api, formatDayMonth, formatWeekLabel, mondayOf, toYmd } from '../lib/api';
import { WEEKDAYS, type PlanEntry, type Recipe, type WeekPlan } from '../lib/types';
import { useHouseholdEvents } from '../lib/useHouseholdEvents';
import { Modal } from '../components/Modal';

const EMPTY_DAYS: PlanEntry[][] = [[], [], [], [], [], [], []];

type DropTarget = { dayIndex: number; index: number } | null;

export function WeekPage() {
  const { activeHousehold, settings } = useAuth();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerDay, setPickerDay] = useState<number | null>(null);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    setLoading(true);
    setError(null);
    try {
      setPlan(await api<WeekPlan>(`/plans/${activeHousehold.id}/${weekStart}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Woche konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [activeHousehold, weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  // Echtzeit: Änderungen anderer Mitglieder sofort übernehmen
  useHouseholdEvents(activeHousehold?.id, (type) => {
    if (type === 'plan' || type === 'hello') void load();
  });

  const byDay = useMemo(() => {
    const days: PlanEntry[][] = EMPTY_DAYS.map(() => []);
    for (const entry of plan?.entries ?? []) {
      if (days[entry.dayIndex]) days[entry.dayIndex].push(entry);
    }
    for (const day of days) day.sort((a, b) => a.position - b.position);
    return days;
  }, [plan]);

  const kcalPerDay = useMemo(
    () => byDay.map((entries) => entries.reduce((sum, e) => sum + Number(e.nutrition?.kcal ?? 0), 0)),
    [byDay],
  );

  if (!activeHousehold) {
    return (
      <div className="card p-6">
        <p className="font-display text-lg font-bold">Noch kein Haushalt</p>
        <p className="mt-1 max-w-md text-sm text-ink/55">
          Wochenpläne hängen an einem Haushalt. Leg einen an oder tritt mit einem Einladungscode bei — Rezepte kannst du
          auch ohne anlegen und sammeln.
        </p>
        <button className="btn btn-primary mt-4" onClick={() => window.location.assign('#/household')}>
          Zu den Haushalten
        </button>
      </div>
    );
  }

  const [confirmClear, setConfirmClear] = useState(false);

  const clearWeek = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await api<WeekPlan>(`/plans/${activeHousehold.id}/${weekStart}`, { method: 'DELETE' }));
      setConfirmClear(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Woche konnte nicht geleert werden.');
    } finally {
      setBusy(false);
    }
  };

  const removeEntry = async (entry: PlanEntry) => {
    setBusy(true);
    try {
      setPlan(await api<WeekPlan>(`/plans/${activeHousehold.id}/${weekStart}/entry/${entry.id}`, { method: 'DELETE' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eintrag konnte nicht entfernt werden.');
    } finally {
      setBusy(false);
    }
  };

  /** Alles neu nummerieren und speichern — Basis für Drag & Drop und die Pfeiltasten. */
  const persistOrder = async (days: PlanEntry[][]) => {
    const items: Array<{ id: string; dayIndex: number; position: number }> = [];
    days.forEach((entries, dayIndex) => {
      entries.forEach((entry, position) => items.push({ id: entry.id, dayIndex, position }));
    });
    const optimisticEntries: PlanEntry[] = [];
    days.forEach((entries, dayIndex) => {
      entries.forEach((entry, position) => optimisticEntries.push({ ...entry, dayIndex, position }));
    });
    setPlan((prev) => (prev ? { ...prev, entries: optimisticEntries } : prev));
    try {
      const updated = await api<WeekPlan>(`/plans/${activeHousehold.id}/${weekStart}/reorder`, {
        method: 'PUT',
        body: { items },
      });
      setPlan(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reihenfolge konnte nicht gespeichert werden.');
      void load();
    }
  };

  const moveEntry = (entryId: string, toDay: number, toIndex: number) => {
    const days = byDay.map((entries) => [...entries]);
    let moved: PlanEntry | undefined;
    for (const entries of days) {
      const idx = entries.findIndex((e) => e.id === entryId);
      if (idx >= 0) {
        moved = entries[idx];
        entries.splice(idx, 1);
        break;
      }
    }
    if (!moved) return;
    const target = days[toDay];
    const insertAt = Math.max(0, Math.min(toIndex, target.length));
    target.splice(insertAt, 0, moved);
    void persistOrder(days);
  };

  const nudge = (entry: PlanEntry, direction: -1 | 1) => {
    const entries = byDay[entry.dayIndex];
    const index = entries.findIndex((e) => e.id === entry.id);
    const next = index + direction;
    if (next < 0 || next >= entries.length) return;
    moveEntry(entry.id, entry.dayIndex, direction === 1 ? next + 1 : next);
  };

  const handleDrop = (dayIndex: number, index?: number) => {
    const id = dragRef.current;
    setDropTarget(null);
    setDraggingId(null);
    dragRef.current = null;
    if (!id) return;
    const target = index ?? byDay[dayIndex].length;
    moveEntry(id, dayIndex, target);
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label !mb-0">Woche · {activeHousehold.name}</p>
          <div className="mt-1 flex items-center gap-1">
            <button className="rounded-lg p-1.5 hover:bg-ink/5" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Vorherige Woche">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-display text-lg font-bold">{formatWeekLabel(weekStart)}</span>
            <button className="rounded-lg p-1.5 hover:bg-ink/5" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Nächste Woche">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button className="btn btn-ghost btn-sm text-[11px]" onClick={() => setWeekStart(mondayOf(new Date()))}>
              Heute
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={() => window.location.assign('#/shopping')}>
            <ClipboardList className="h-4 w-4" /> Einkaufsliste
          </button>
          {plan && plan.entries.length > 0 && (
            <button
              className="btn btn-ghost text-clay"
              onClick={() => setConfirmClear(true)}
              title="Alle Einträge dieser Woche entfernen"
            >
              <Trash2 className="h-4 w-4" /> Woche leeren
            </button>
          )}
        </div>
      </div>

      {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>}
      {confirmClear && (
        <div className="card flex flex-col gap-3 border-danger/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-ink/70">
            Alle {plan?.entries.length ?? 0} Einträge dieser Woche entfernen? Die Rezepte bleiben in der Sammlung.
          </p>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => setConfirmClear(false)} disabled={busy}>
              Abbrechen
            </button>
            <button className="btn bg-clay text-on-accent hover:bg-clay/90" onClick={() => void clearWeek()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Woche leeren
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card flex items-center justify-center gap-2 p-10 text-sm text-ink/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Woche wird geladen …
        </div>
      ) : (
        <div className="w-full space-y-3">
          {WEEKDAYS.map((day, dayIndex) => {
            const isToday = addDays(weekStart, dayIndex) === toYmd(new Date());
            const entries = byDay[dayIndex];
            const isDropDay = dropTarget?.dayIndex === dayIndex;
            return (
              <section
                key={day}
                className={`card p-4 transition ${isDropDay ? 'ring-2 ring-leaf/40' : ''}`}
                onDragOver={(e) => {
                  if (!dragRef.current) return;
                  e.preventDefault();
                  if (dropTarget?.dayIndex !== dayIndex || dropTarget?.index !== entries.length) {
                    setDropTarget({ dayIndex, index: entries.length });
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDropTarget((prev) => (prev?.dayIndex === dayIndex ? null : prev));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(dayIndex);
                }}
              >
                <header className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <h2 className="font-display text-base font-bold">{day}</h2>
                    <span className="text-[11px] text-ink/40">{formatDayMonth(addDays(weekStart, dayIndex))}</span>
                    {isToday && <span className="chip">heute</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {kcalPerDay[dayIndex] > 0 && (
                      <span className="text-[11px] font-semibold text-ink/45">≈ {Math.round(kcalPerDay[dayIndex])} kcal</span>
                    )}
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-xl border border-ink/15 text-leaf transition hover:border-leaf hover:bg-leaf-soft"
                      onClick={() => setPickerDay(dayIndex)}
                      aria-label={`Rezept zu ${day} hinzufügen`}
                      title={`Rezept zu ${day} hinzufügen`}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </header>

                {entries.length === 0 ? (
                  <button
                    onClick={() => setPickerDay(dayIndex)}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-4 text-xs font-semibold transition ${
                      isDropDay ? 'border-leaf bg-leaf-soft/40 text-leaf' : 'border-ink/15 text-ink/40 hover:border-leaf/40 hover:text-leaf'
                    }`}
                  >
                    <UtensilsCrossed className="h-4 w-4" /> Noch nichts geplant — hierher ziehen oder antippen
                  </button>
                ) : (
                  <ul className="space-y-2">
                    {entries.map((entry, index) => {
                      const isDragging = draggingId === entry.id;
                      const showLineBefore = dropTarget?.dayIndex === dayIndex && dropTarget.index === index;
                      return (
                        <li key={entry.id}>
                          {showLineBefore && <div className="mb-1 h-0.5 rounded-full bg-leaf" />}
                          <div
                            draggable
                            onDragStart={(e) => {
                              dragRef.current = entry.id;
                              setDraggingId(entry.id);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', entry.id);
                            }}
                            onDragEnd={() => {
                              dragRef.current = null;
                              setDraggingId(null);
                              setDropTarget(null);
                            }}
                            onDragOver={(e) => {
                              if (!dragRef.current) return;
                              e.preventDefault();
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              const after = e.clientY > rect.top + rect.height / 2;
                              setDropTarget({ dayIndex, index: after ? index + 1 : index });
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDrop(dayIndex, dropTarget?.index ?? index);
                            }}
                            className={`group flex items-center gap-2 rounded-xl border border-ink/10 bg-surface px-2 py-2 transition ${
                              isDragging ? 'opacity-40' : 'hover:border-leaf/40'
                            }`}
                          >
                            <span className="cursor-grab text-ink/25 active:cursor-grabbing" title="Ziehen zum Sortieren">
                              <GripVertical className="h-4 w-4" />
                            </span>

                            <div className="min-w-0 flex-1">
                              {entry.recipeId ? (
                                <button
                                  className="block max-w-full truncate text-left text-sm font-semibold hover:text-leaf"
                                  onClick={() => window.location.assign(`#/recipe/${entry.recipeId}`)}
                                >
                                  {entry.title}
                                </button>
                              ) : (
                                <p className="truncate text-sm font-semibold">{entry.title}</p>
                              )}
                              <p className="mt-0.5 text-[11px] text-ink/45">
                                {[
                                  entry.prepMinutes ? `${entry.prepMinutes} min` : '',
                                  entry.servings ? `${entry.servings} Port.` : '',
                                  entry.nutrition?.kcal ? `${Math.round(Number(entry.nutrition.kcal))} kcal` : '',
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || 'ohne Angaben'}
                              </p>
                            </div>

                            <div className="flex flex-col gap-0.5 sm:hidden">
                              <button
                                className="rounded p-0.5 text-ink/35 disabled:opacity-20"
                                onClick={() => nudge(entry, -1)}
                                disabled={index === 0}
                                aria-label="Nach oben"
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                className="rounded p-0.5 text-ink/35 disabled:opacity-20"
                                onClick={() => nudge(entry, 1)}
                                disabled={index === entries.length - 1}
                                aria-label="Nach unten"
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <button
                              className="flex items-center gap-1 rounded-lg border border-ink/10 px-2 py-1.5 text-ink/55 transition hover:border-danger/30 hover:bg-danger-soft hover:text-clay disabled:opacity-40"
                              onClick={() => void removeEntry(entry)}
                              disabled={busy}
                              aria-label="Aus dem Tag entfernen"
                              title="Aus dem Tag entfernen"
                            >
                              <Trash2 className="h-4 w-4" />
                              <span className="text-[11px] font-semibold">Entfernen</span>
                            </button>
                          </div>
                        </li>
                      );
                    })}
                    {isDropDay && dropTarget?.index === entries.length && <div className="mt-1 h-0.5 rounded-full bg-leaf" />}
                  </ul>
                )}
              </section>
            );
          })}
          <p className="pb-2 text-center text-[11px] text-ink/40">
            Rezepte lassen sich mit der Maus in der Tageskarte sortieren und in andere Tage ziehen — auf dem Handy mit den Pfeilen.
          </p>
        </div>
      )}

      {pickerDay !== null && (
        <DayPicker
          householdId={activeHousehold.id}
          weekStart={weekStart}
          dayIndex={pickerDay}
          servings={settings.defaultServings}
          onClose={() => setPickerDay(null)}
          onSaved={(next) => {
            setPlan(next);
            setPickerDay(null);
          }}
        />
      )}



    </div>
  );
}

function DayPicker({
  householdId,
  weekStart,
  dayIndex,
  servings,
  onClose,
  onSaved,
}: {
  householdId: string;
  weekStart: string;
  dayIndex: number;
  servings: number;
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

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const data = await api<{ recipes: Recipe[] }>(`/recipes?q=${encodeURIComponent(query)}&limit=30&sort=popular`);
        setRecipes(data.recipes);
      } catch {
        setRecipes([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const add = async (body: { recipeId?: string; customTitle?: string }) => {
    const plan = await api<WeekPlan>(`/plans/${householdId}/${weekStart}/entries`, {
      method: 'POST',
      body: { dayIndex, servings, ...body },
    });
    onSaved(plan);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konnte nicht speichern.');
      setBusy(false);
    }
  };

  return (
    <Modal title={`${WEEKDAYS[dayIndex]} — Rezept hinzufügen`} subtitle="Aus der Sammlung, als Freitext oder neu von der KI" onClose={onClose} wide>
      <div className="mb-4 flex gap-1 rounded-xl bg-ink/5 p-1 text-sm font-semibold">
        {[
          { id: 'recipe' as const, label: 'Sammlung' },
          { id: 'text' as const, label: 'Freitext' },
          { id: 'ai' as const, label: 'KI-Rezept' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg py-1.5 transition ${tab === t.id ? 'bg-surface shadow-sm' : 'text-ink/55'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'recipe' && (
        <div className="space-y-3">
          <input className="input" placeholder="Rezept suchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {recipes.length === 0 && (
              <p className="flex items-center gap-2 p-4 text-sm text-ink/50">
                <UtensilsCrossed className="h-4 w-4" /> Keine Rezepte gefunden — leg im Tab „Rezepte" eines an.
              </p>
            )}
            {recipes.map((r) => (
              <button
                key={r.id}
                onClick={() => void run(() => add({ recipeId: r.id }))}
                disabled={busy}
                className="flex w-full items-center justify-between rounded-xl border border-ink/10 px-3 py-2 text-left hover:border-leaf/40 hover:bg-leaf-soft/30"
              >
                <span>
                  <span className="block text-sm font-semibold">{r.title}</span>
                  <span className="text-[11px] text-ink/50">
                    {[r.prepMinutes ? `${r.prepMinutes} min` : '', `${r.servings} Portionen`, r.nutrition?.kcal ? `${Math.round(r.nutrition.kcal)} kcal` : '']
                      .filter(Boolean)
                      .join(' · ')}
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
              placeholder="z. B. Pizza vom Italiener, Reste vom Vortag"
            />
          </div>
          <button
            className="btn btn-primary w-full"
            onClick={() => void run(async () => add({ customTitle: customTitle.trim() }))}
            disabled={busy || !customTitle.trim()}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Eintragen
          </button>
        </div>
      )}

      {tab === 'ai' && (
        <div className="space-y-3">
          <div>
            <label className="label">Idee für diesen Tag</label>
            <textarea
              className="textarea"
              rows={3}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="z. B. etwas Schnelles mit Kürbis, vegetarisch, max. 30 Minuten"
            />
          </div>
          <button
            className="btn btn-primary w-full"
            onClick={() =>
              void run(async () => {
                const data = await api<{ recipe: Recipe }>('/ai/recipe', {
                  method: 'POST',
                  body: { householdId, idea, servings, save: 'favorite' },
                });
                await add({ recipeId: data.recipe.id });
              })
            }
            disabled={busy || idea.trim().length < 3}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? 'Rezept wird geschrieben …' : 'Rezept erzeugen und einplanen'}
          </button>
          <p className="text-[11px] text-ink/50">Das Rezept landet zusätzlich in deinen Favoriten.</p>
        </div>
      )}

      {error && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>}
    </Modal>
  );
}
