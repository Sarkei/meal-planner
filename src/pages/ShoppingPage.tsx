import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Plus, RotateCcw, ShoppingBasket, Trash2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { addDays, api, formatWeekLabel, mondayOf } from '../lib/api';
import { useHouseholdEvents } from '../lib/useHouseholdEvents';

type ShoppingItem = {
  id: string;
  name: string;
  amount: number | null;
  unit: string;
  category: string;
  checked: boolean;
  source: string;
};

type ShoppingList = {
  weekStart: string;
  categories: { id: string; label: string; items: ShoppingItem[] }[];
  items: ShoppingItem[];
  openCount: number;
  totalCount: number;
};

/** 1.5 → „1,5" (deutsche Schreibweise, ganze Zahlen ohne Komma). */
function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

export function ShoppingPage() {
  const { activeHousehold } = useAuth();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [list, setList] = useState<ShoppingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!activeHousehold) {
      setLoading(false);
      return;
    }
    try {
      const data = await api<ShoppingList>(`/shopping/${activeHousehold.id}/${weekStart}`);
      setList(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Einkaufsliste konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [activeHousehold, weekStart]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Echtzeit: Änderungen anderer Mitglieder sofort übernehmen
  useHouseholdEvents(activeHousehold?.id, (type) => {
    if (type === 'shopping' || type === 'plan' || type === 'hello') void load();
  });

  const grouped = useMemo(() => list?.categories ?? [], [list]);

  const toggle = async (item: ShoppingItem) => {
    if (!activeHousehold) return;
    // optimistisch
    setList((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)),
            categories: prev.categories.map((c) => ({
              ...c,
              items: c.items.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)),
            })),
          }
        : prev,
    );
    try {
      const data = await api<ShoppingList>(`/shopping/${activeHousehold.id}/${weekStart}/items/${item.id}`, {
        method: 'PATCH',
        body: { checked: !item.checked },
      });
      setList(data);
    } catch {
      void load();
    }
  };

  const addItem = async () => {
    if (!activeHousehold || newItem.trim().length < 2) return;
    setAdding(true);
    setError(null);
    try {
      const data = await api<ShoppingList>(`/shopping/${activeHousehold.id}/${weekStart}/items`, {
        method: 'POST',
        body: { name: newItem.trim() },
      });
      setList(data);
      setNewItem('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Artikel konnte nicht hinzugefügt werden.');
    } finally {
      setAdding(false);
    }
  };

  const removeItem = async (item: ShoppingItem) => {
    if (!activeHousehold) return;
    try {
      const data = await api<ShoppingList>(`/shopping/${activeHousehold.id}/${weekStart}/items/${item.id}`, {
        method: 'DELETE',
      });
      setList(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Artikel konnte nicht entfernt werden.');
    }
  };

  const resetChecked = async () => {
    if (!activeHousehold || !list) return;
    const checked = list.items.filter((i) => i.checked);
    for (const item of checked) {
      await api(`/shopping/${activeHousehold.id}/${weekStart}/items/${item.id}`, {
        method: 'PATCH',
        body: { checked: false },
      });
    }
    await load();
  };

  if (!activeHousehold) {
    return (
      <div className="card p-6">
        <p className="font-display text-lg font-bold">Noch kein Haushalt</p>
        <p className="mt-1 text-sm text-ink/55">
          Die Einkaufsliste gehört zu einem Haushalt. Leg einen an oder tritt bei — dann füllt sie sich automatisch aus
          dem Wochenplan.
        </p>
        <button className="btn btn-primary mt-4" onClick={() => window.location.assign('#/household')}>
          Zu den Haushalten
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label !mb-0">Einkaufsliste · {activeHousehold.name}</p>
          <div className="mt-1 flex items-center gap-1">
            <button className="rounded-lg p-1.5 hover:bg-ink/5" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Vorherige Woche">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-display text-lg font-bold">{formatWeekLabel(weekStart)}</span>
            <button className="rounded-lg p-1.5 hover:bg-ink/5" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Nächste Woche">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setWeekStart(mondayOf(new Date()))}>
              Diese Woche
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {list && (
            <span className="text-xs font-semibold text-ink/50">
              {list.openCount} offen · {list.totalCount} gesamt
            </span>
          )}
          {list && list.items.some((i) => i.checked) && (
            <button className="btn btn-ghost !px-2 !py-1.5 text-xs" onClick={() => void resetChecked()}>
              <RotateCcw className="h-3.5 w-3.5" /> Erledigte zurücksetzen
            </button>
          )}
        </div>
      </div>

      <div className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
        <input
          className="input flex-1"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addItem();
          }}
          placeholder="Artikel hinzufügen — z. B. Klopapier, Basilikum, Milch"
        />
        <button className="btn btn-primary" onClick={() => void addItem()} disabled={adding || newItem.trim().length < 2}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Hinzufügen
        </button>
      </div>
      <p className="-mt-2 text-[11px] text-ink/45">
        Die KI sortiert neue Artikel selbst ein (Obst & Gemüse, Milchprodukte, Vorrat, Gewürze, Haushalt …).
      </p>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

      {loading ? (
        <div className="card flex items-center justify-center gap-2 p-10 text-sm text-ink/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Liste wird geladen …
        </div>
      ) : grouped.length === 0 ? (
        <div className="card p-10 text-center">
          <ShoppingBasket className="mx-auto h-8 w-8 text-ink/25" />
          <p className="mt-2 font-display text-lg font-bold">Liste ist leer</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink/55">
            Plane Mahlzeiten in der Woche — die Zutaten erscheinen automatisch hier. Oben kannst du jederzeit etwas
            ergänzen.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {grouped.map((group) => (
            <section key={group.id} className="card p-4">
              <h2 className="mb-2 font-display text-sm font-bold">{group.label}</h2>
              <ul className="divide-y divide-ink/5">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <div className="flex items-center gap-3 py-2">
                      <button
                        onClick={() => void toggle(item)}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                          item.checked ? 'border-leaf bg-leaf text-white' : 'border-ink/25'
                        }`}
                        aria-label={item.checked ? 'Als offen markieren' : 'Als erledigt markieren'}
                      >
                        {item.checked ? '✓' : ''}
                      </button>
                      <span className={`flex-1 text-sm ${item.checked ? 'text-ink/35 line-through' : ''}`}>
                        {item.name}
                        {item.source === 'manual' && <span className="ml-2 text-[10px] font-semibold text-leaf">manuell</span>}
                      </span>
                      <span className="text-sm font-semibold text-ink/60">
                        {item.amount != null ? `${formatAmount(item.amount)} ` : ''}
                        {item.unit}
                      </span>
                      {item.source === 'manual' && (
                        <button
                          className="rounded-lg p-1 text-ink/25 hover:bg-red-50 hover:text-clay"
                          onClick={() => void removeItem(item)}
                          aria-label="Artikel entfernen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
