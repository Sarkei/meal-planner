import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Utensils,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import type { HouseholdMember, HouseholdPreferences, Slot } from '../lib/types';
import { EMPTY_HOUSEHOLD_PREFERENCES } from '../lib/types';
import {
  ALLERGY_OPTIONS,
  APPLIANCE_OPTIONS,
  CUISINE_OPTIONS,
  DIET_OPTIONS,
} from '../lib/preferences';
import { addDays, formatWeekLabel, mondayOf, toYmd } from '../lib/api';
import { WEEKDAYS, SLOTS } from '../lib/types';
import { Modal } from '../components/Modal';
import { TagListInput } from '../components/TagListInput';

type ChipGroupProps = {
  label: string;
  hint?: string;
  options: readonly string[];
  selected: string[];
  emptyLabel: string;
  onToggle: (value: string) => void;
  onClear: () => void;
};

function ChipGroup({ label, hint, options, selected, emptyLabel, onToggle, onClear }: ChipGroupProps) {
  return (
    <div>
      <label className="label">{label}</label>
      {hint && <p className="mb-2 text-xs text-ink/50">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onClear}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            selected.length === 0 ? 'border-leaf bg-leaf text-white' : 'border-ink/15 text-ink/60 hover:border-leaf/40'
          }`}
        >
          {emptyLabel}
        </button>
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              onClick={() => onToggle(option)}
              className={`ui-mark-selected rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                active ? 'border-leaf bg-leaf text-white' : 'border-ink/15 text-ink/60 hover:border-leaf/40'
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function HouseholdPage() {
  const { activeHousehold, households, refresh, selectHousehold, user } = useAuth();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(Boolean(activeHousehold));
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [prefs, setPrefs] = useState<HouseholdPreferences>(EMPTY_HOUSEHOLD_PREFERENCES);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const savePrefs = useCallback(
    async (change: Partial<HouseholdPreferences>) => {
      if (!activeHousehold) return;
      const next = { ...prefs, ...change };
      setPrefs(next);
      try {
        const data = await api<{ preferences: HouseholdPreferences }>(
          `/households/${activeHousehold.id}/preferences`,
          { method: 'PUT', body: next },
        );
        setPrefs(data.preferences);
        setPrefsSaved(true);
        window.setTimeout(() => setPrefsSaved(false), 1800);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
      }
    },
    [activeHousehold, prefs],
  );

  const load = useCallback(async () => {
    if (!activeHousehold) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api<{ members: HouseholdMember[]; preferences?: HouseholdPreferences }>(
        `/households/${activeHousehold.id}`,
      );
      setMembers(data.members);
      setPrefs(data.preferences ?? EMPTY_HOUSEHOLD_PREFERENCES);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Haushalt konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [activeHousehold]);

  useEffect(() => {
    void load();
  }, [load]);

  const join = async () => {
    if (joinCode.trim().length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ household: { id: string }; alreadyMember: boolean }>('/households/join', {
        method: 'POST',
        body: { code: joinCode.trim() },
      });
      setJoinCode('');
      await refresh();
      selectHousehold(data.household.id);
      setInfo(data.alreadyMember ? 'Du warst schon Mitglied dieses Haushalts.' : 'Haushalt beigetreten.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Beitritt fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (newName.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ household: { id: string } }>('/households', {
        method: 'POST',
        body: { name: newName.trim() },
      });
      setNewName('');
      await refresh();
      selectHousehold(data.household.id);
      setInfo('Haushalt angelegt.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Haushalt konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  // ── Noch kein Haushalt: erstellen oder beitreten ────────────────────────────
  if (households.length === 0) {
    return (
      <div className="space-y-4">
        <div className="card p-5">
          <h2 className="font-display text-xl font-bold">Willkommen, {user?.displayName.split(' ')[0]}</h2>
          <p className="mt-1 text-sm text-ink/55">
            Du bist noch in keinem Haushalt. Ein Haushalt ist die gemeinsame Küche: Wochenpläne, Einkaufsliste und
            Mitglieder hängen daran. Rezepte in der Sammlung funktionieren auch ohne.
          </p>
        </div>

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="card space-y-3 p-5">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-leaf" />
              <p className="font-display text-base font-bold">Haushalt erstellen</p>
            </div>
            <p className="text-xs text-ink/55">Für dich allein oder als Startpunkt für Familie und Mitbewohner.</p>
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="z. B. Unsere Küche oder WG-Küche"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
            />
            <button className="btn btn-primary w-full" onClick={() => void create()} disabled={busy || newName.trim().length < 2}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Haushalt erstellen
            </button>
          </div>

          <div className="card space-y-3 p-5">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-leaf" />
              <p className="font-display text-base font-bold">Haushalt beitreten</p>
            </div>
            <p className="text-xs text-ink/55">Du hast einen Einladungscode bekommen? Dann hier eintragen.</p>
            <input
              className="input tracking-[0.2em] uppercase"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              maxLength={12}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void join();
              }}
            />
            <button className="btn btn-ghost w-full" onClick={() => void join()} disabled={busy || joinCode.trim().length < 4}>
              <UserPlus className="h-4 w-4" /> Beitreten
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!activeHousehold) {
    return (
      <div className="card flex items-center justify-center gap-2 p-10 text-sm text-ink/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Haushalt wird geladen …
      </div>
    );
  }

  const isOwner = activeHousehold.role === 'owner';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(activeHousehold.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Kopieren hat nicht geklappt — Code bitte manuell abschreiben.');
    }
  };

  const rotateCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ inviteCode: string }>(`/households/${activeHousehold.id}/invite-code`, { method: 'POST' });
      setInfo(`Neuer Code: ${data.inviteCode}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Code konnte nicht erneuert werden.');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (member: HouseholdMember) => {
    if (!window.confirm(`${member.displayName} aus dem Haushalt entfernen?`)) return;
    setBusy(true);
    try {
      await api(`/households/${activeHousehold.id}/members/${member.userId}`, { method: 'DELETE' });
      await load();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mitglied konnte nicht entfernt werden.');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!window.confirm(isOwner ? 'Haushalt inklusive Wochenplänen löschen?' : 'Haushalt verlassen?')) return;
    setBusy(true);
    try {
      if (isOwner) await api(`/households/${activeHousehold.id}?force=1`, { method: 'DELETE' });
      else await api(`/households/${activeHousehold.id}/members/${user!.id}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="label !mb-0">Aktiver Haushalt</p>
            <h2 className="font-display text-xl font-bold">{activeHousehold.name}</h2>
            <p className="mt-1 text-xs text-ink/50">
              {activeHousehold.memberCount} {activeHousehold.memberCount === 1 ? 'Person' : 'Personen'} · du bist{' '}
              {isOwner ? 'Besitzer' : 'Mitglied'}
            </p>
          </div>
          <div className="rounded-xl border border-dashed border-leaf/40 bg-leaf-soft/50 px-4 py-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-leaf/70">Einladungscode</p>
            <p className="font-display text-2xl font-bold tracking-[0.18em] text-leaf">{activeHousehold.inviteCode}</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => void copyCode()}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Kopiert' : 'Kopieren'}
              </button>
              {isOwner && (
                <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => void rotateCode()} disabled={busy}>
                  <RefreshCw className="h-3.5 w-3.5" /> Neu
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink/55">
          Wer diesen Code hat, kann dem Haushalt beitreten und sieht ab dann die Wochenpläne dieses Haushalts.
        </p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      {info && <p className="rounded-xl bg-leaf-soft px-3 py-2 text-sm font-medium text-leaf">{info}</p>}

      <div className="card space-y-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Utensils className="h-4 w-4 text-leaf" />
              <p className="label !mb-0">Vorgaben für den Haushalt</p>
            </div>
            <p className="text-xs text-ink/50">
              Gilt für alle Mitglieder: Wochenplan, KI-Vorschläge und als Filter-Vorlage in der Rezeptsammlung.
            </p>
          </div>
          {prefsSaved && (
            <span className="flex items-center gap-1 text-xs font-semibold text-leaf">
              <Check className="h-3.5 w-3.5" /> gespeichert
            </span>
          )}
        </div>

        <ChipGroup
          label="Ernährungsform"
          options={DIET_OPTIONS}
          selected={prefs.diets}
          emptyLabel="Egal"
          onClear={() => void savePrefs({ diets: [] })}
          onToggle={(value) =>
            void savePrefs({
              diets: prefs.diets.includes(value)
                ? prefs.diets.filter((d) => d !== value)
                : [...prefs.diets, value].slice(0, 8),
            })
          }
        />

        <ChipGroup
          label="Präferierte Küche"
          options={CUISINE_OPTIONS}
          selected={prefs.cuisines}
          emptyLabel="Egal"
          onClear={() => void savePrefs({ cuisines: [] })}
          onToggle={(value) =>
            void savePrefs({
              cuisines: prefs.cuisines.includes(value)
                ? prefs.cuisines.filter((c) => c !== value)
                : [...prefs.cuisines, value].slice(0, 10),
            })
          }
        />

        <ChipGroup
          label="Allergien & Abneigungen"
          options={ALLERGY_OPTIONS}
          selected={prefs.allergies}
          emptyLabel="Keine Allergien"
          onClear={() => void savePrefs({ allergies: [] })}
          onToggle={(value) =>
            void savePrefs({
              allergies: prefs.allergies.includes(value)
                ? prefs.allergies.filter((a) => a !== value)
                : [...prefs.allergies, value].slice(0, 12),
            })
          }
        />

        <ChipGroup
          label="Geräte im Haushalt"
          hint="Die KI plant nur Rezepte, die mit diesen Küchengeräten machbar sind."
          options={APPLIANCE_OPTIONS}
          selected={prefs.appliances}
          emptyLabel="Keine Angabe"
          onClear={() => void savePrefs({ appliances: [] })}
          onToggle={(value) =>
            void savePrefs({
              appliances: prefs.appliances.includes(value)
                ? prefs.appliances.filter((a) => a !== value)
                : [...prefs.appliances, value].slice(0, 12),
            })
          }
        />

        <div>
          <label className="label">Lebensmittel, die niemand mag</label>
          <p className="mb-2 text-xs text-ink/50">
            Gilt für alle Mitglieder — die KI meidet sie bei Rezepten und Wochenplänen.
          </p>
          <TagListInput
            value={prefs.dislikes}
            onChange={(dislikes) => void savePrefs({ dislikes })}
            placeholder="z. B. Rosenkohl, Leber"
          />
        </div>

        <div>
          <label className="label">Besonderheiten</label>
          <textarea
            className="input min-h-[64px] resize-y"
            placeholder="z. B. keine scharfen Gerichte für die Kinder, samstags immer Pizza"
            value={prefs.note}
            maxLength={400}
            onChange={(e) => setPrefs({ ...prefs, note: e.target.value })}
            onBlur={() => void savePrefs({ note: prefs.note })}
          />
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-leaf" />
          <p className="label !mb-0">Mitglieder</p>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-ink/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen …
          </p>
        ) : (
          <ul className="divide-y divide-ink/5">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-semibold">
                    {m.displayName}
                    {m.userId === user?.id && <span className="ml-2 text-[11px] font-medium text-ink/40">(du)</span>}
                  </p>
                  <p className="text-[11px] text-ink/45">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="chip">{m.role === 'owner' ? 'Besitzer' : 'Mitglied'}</span>
                  {isOwner && m.role !== 'owner' && (
                    <button
                      className="rounded-lg p-1.5 text-ink/35 hover:bg-red-50 hover:text-clay"
                      onClick={() => void removeMember(m)}
                      aria-label="Mitglied entfernen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-leaf" />
          <p className="label !mb-0">Wochenplan für den ganzen Haushalt</p>
        </div>
        <p className="text-xs text-ink/55">
          Wähle Tage und Mahlzeiten — die KI plant die Woche anhand der Vorgaben <strong>aller</strong> Mitglieder
          (Ernährungsform, Allergien, Küche, Zeit, Kalorien, Sonderwünsche) und trägt alles direkt in den Wochenplan ein.
        </p>
        <button className="btn btn-primary" onClick={() => setShowPlan(true)}>
          <Sparkles className="h-4 w-4" /> Wochenplan erstellen
        </button>
      </div>

      <button className="btn btn-ghost !text-clay" onClick={() => void leave()} disabled={busy}>
        <LogOut className="h-4 w-4" /> {isOwner ? 'Haushalt löschen' : 'Haushalt verlassen'}
      </button>

      {showPlan && (
        <HouseholdPlanModal
          householdId={activeHousehold.id}
          householdName={activeHousehold.name}
          onClose={() => setShowPlan(false)}
        />
      )}
    </div>
  );
}

const PLAN_SLOTS: { id: Slot; label: string }[] = SLOTS.filter((s) => s.id !== 'snack');

function HouseholdPlanModal({
  householdId,
  householdName,
  onClose,
}: {
  householdId: string;
  householdName: string;
  onClose: () => void;
}) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [slots, setSlots] = useState<Slot[]>(['abend']);
  const [servings, setServings] = useState(2);
  const [mode, setMode] = useState<'replace' | 'fill'>('replace');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const toggleDay = (day: number) =>
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
  const toggleSlot = (slot: Slot) =>
    setSlots((prev) => (prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]));

  const create = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await api<{ created: number; notes: string }>('/ai/week', {
        method: 'POST',
        body: {
          householdId,
          weekStart,
          days,
          slots,
          servings,
          mode,
          mergeMembers: true,
          constraints: notes,
        },
      });
      setResult(`${data.created} Mahlzeiten für ${householdName} geplant. ${data.notes}`.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Der Wochenplan konnte nicht erstellt werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Wochenplan für den Haushalt" subtitle="Vorgaben aller Mitglieder werden berücksichtigt" onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <label className="label">Woche</label>
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => setWeekStart(addDays(weekStart, -7))}>
              ‹
            </button>
            <span className="text-sm font-semibold">{formatWeekLabel(weekStart)}</span>
            <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => setWeekStart(addDays(weekStart, 7))}>
              ›
            </button>
            <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setWeekStart(mondayOf(new Date()))}>
              Diese Woche
            </button>
          </div>
        </div>

        <div>
          <label className="label">An welchen Tagen?</label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day, index) => (
              <button
                key={day}
                onClick={() => toggleDay(index)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  days.includes(index) ? 'border-leaf bg-leaf-soft text-leaf' : 'border-ink/15 text-ink/55 hover:border-leaf/40'
                }`}
              >
                {day.slice(0, 2)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Welche Mahlzeiten?</label>
          <div className="flex flex-wrap gap-2">
            {PLAN_SLOTS.map((slot) => (
              <button
                key={slot.id}
                onClick={() => toggleSlot(slot.id)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  slots.includes(slot.id) ? 'border-leaf bg-leaf-soft text-leaf' : 'border-ink/15 text-ink/55 hover:border-leaf/40'
                }`}
              >
                {slot.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Portionen pro Mahlzeit</label>
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
            <label className="label">Bestehendes</label>
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value as 'replace' | 'fill')}>
              <option value="replace">Ersetzen</option>
              <option value="fill">Nur leere Tage füllen</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Zusätzliche Vorgaben (optional)</label>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="z. B. am Wochenende aufwendiger kochen, wenig Fleisch"
          />
        </div>

        <button className="btn btn-primary w-full" onClick={() => void create()} disabled={busy || days.length === 0 || slots.length === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Woche wird geplant …' : 'Wochenplan erstellen'}
        </button>

        {result && (
          <div className="space-y-2 rounded-xl bg-leaf-soft px-3 py-2 text-sm text-leaf">
            <p>{result}</p>
            <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => window.location.assign(`#/week`)}>
              Zum Wochenplan
            </button>
          </div>
        )}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
