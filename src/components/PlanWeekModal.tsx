import { useMemo, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { api, formatWeekLabel, toYmd } from '../lib/api';
import { WEEKDAYS, type HouseholdPreferences, type WeekPlan } from '../lib/types';

/**
 * Wochenplan für einen Haushalt erzeugen. Die Eingaben gelten nur für diesen einen Lauf —
 * die gespeicherten Haushalts-Vorgaben werden nicht verändert.
 */
export function PlanWeekModal({
  householdId,
  prefs,
  onClose,
  onDone,
}: {
  householdId: string;
  prefs: HouseholdPreferences;
  onClose: () => void;
  onDone: (info: { weekStart: string; created: number; reused: number }) => void;
}) {
  const weeks = useMemo(() => {
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i * 7);
      return toYmd(d);
    });
  }, []);

  const [weekStart, setWeekStart] = useState(weeks[0]);
  const [days, setDays] = useState<number[]>(prefs.planDays.length ? prefs.planDays : [0, 1, 2, 3, 4]);
  const [slots, setSlots] = useState<string[]>(prefs.planSlots.length ? prefs.planSlots : ['abend']);
  const [servings, setServings] = useState(prefs.planServings || 2);
  const [mode, setMode] = useState<'replace' | 'fill'>('replace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (index: number) =>
    setDays((prev) => (prev.includes(index) ? prev.filter((d) => d !== index) : [...prev, index].sort()));
  const toggleSlot = (id: string) =>
    setSlots((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const submit = async () => {
    if (!days.length) {
      setError('Mindestens einen Tag wählen.');
      return;
    }
    if (!slots.length) {
      setError('Mindestens eine Mahlzeit wählen.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ plan: WeekPlan; created: number; reused: number }>('/ai/week', {
        method: 'POST',
        body: {
          householdId,
          weekStart,
          days,
          slots,
          servings,
          mode,
          mergeMembers: true,
        },
      });
      onDone({ weekStart, created: data.created, reused: data.reused });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Woche konnte nicht geplant werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-4 rounded-t-3xl border border-ink/10 bg-white p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label !mb-0">Woche planen</p>
            <p className="mt-1 text-xs text-ink/50">
              Gilt nur für diesen Lauf — die Vorgaben im Haushalt bleiben unverändert.
            </p>
          </div>
          <button className="rounded-lg p-1.5 text-ink/40 hover:bg-ink/5" onClick={onClose} aria-label="Schließen">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <label className="label">Woche</label>
          <select className="input" value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
            {weeks.map((week, index) => (
              <option key={week} value={week}>
                {index === 0 ? 'Diese Woche' : index === 1 ? 'Nächste Woche' : ''} {formatWeekLabel(week)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Tage</label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day, index) => {
              const active = days.includes(index);
              return (
                <button
                  key={day}
                  onClick={() => toggleDay(index)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    active ? 'border-leaf bg-leaf text-white' : 'border-ink/15 text-ink/55 hover:border-leaf/40'
                  }`}
                >
                  {day.slice(0, 2)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="label">Mahlzeiten</label>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'fruehstueck', label: 'Frühstück' },
              { id: 'mittag', label: 'Mittag' },
              { id: 'abend', label: 'Abend' },
              { id: 'snack', label: 'Snack' },
            ].map((slot) => {
              const active = slots.includes(slot.id);
              return (
                <button
                  key={slot.id}
                  onClick={() => toggleSlot(slot.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    active ? 'border-leaf bg-leaf text-white' : 'border-ink/15 text-ink/55 hover:border-leaf/40'
                  }`}
                >
                  {slot.label}
                </button>
              );
            })}
          </div>
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
              onChange={(e) => setServings(Number(e.target.value) || 1)}
            />
          </div>
          <div>
            <label className="label">Bestehender Plan</label>
            <div className="flex gap-1.5">
              {[
                { id: 'replace' as const, label: 'Ersetzen' },
                { id: 'fill' as const, label: 'Hinzufügen' },
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => setMode(option.id)}
                  className={`flex-1 rounded-xl border px-2 py-2 text-xs font-semibold transition ${
                    mode === option.id
                      ? 'border-leaf bg-leaf-soft text-leaf'
                      : 'border-ink/15 text-ink/55 hover:border-leaf/40'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}

        <button className="btn btn-primary w-full" onClick={() => void submit()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Wird geplant …' : 'Woche planen'}
        </button>
      </div>
    </div>
  );
}
