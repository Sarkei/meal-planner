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
import { Collapsible } from '../components/Collapsible';
import { PlanWeekModal } from '../components/PlanWeekModal';

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
  const [showPlanModal, setShowPlanModal] = useState(false);
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
          <div className="rounded-xl border border-dashed border-leaf/40 px-4 py-3 text-center">
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

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label !mb-0">Wochenplan</p>
          <p className="text-xs text-ink/55">
            Tage, Mahlzeiten, Portionen und Modus für eine Woche wählen. Was du hier einträgst, gilt nur
            für diesen Plan — die Vorgaben darunter bleiben unverändert.
          </p>
        </div>
        <button className="btn btn-primary shrink-0" onClick={() => setShowPlanModal(true)}>
          <Sparkles className="h-4 w-4" /> Woche planen
        </button>
      </div>

      <div className="card p-4">
        <Collapsible
          title="Vorgaben für den Haushalt"
          summary={
            [
              prefs.diets.join(', '),
              prefs.cuisines.join(', '),
              prefs.allergies.length ? `ohne ${prefs.allergies.join(', ')}` : '',
              prefs.dislikes.length ? `${prefs.dislikes.length} Abneigungen` : '',
              prefs.appliances.length ? `${prefs.appliances.length} Geräte` : '',
              `${prefs.planDays.length} Tage · ${prefs.planSlots.length} Mahlzeit(en) · ${prefs.planServings} Port.`,
            ]
              .filter(Boolean)
              .join(' · ')
          }
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-ink/50">
              Gilt für alle Mitglieder: Wochenplan, KI-Vorschläge und als Filter-Vorlage in der Rezeptsammlung.
            </p>
            {prefsSaved && (
              <span className="flex items-center gap-1 text-xs font-semibold text-leaf">
                <Check className="h-3.5 w-3.5" /> gespeichert
              </span>
            )}
          </div>

          {/* 1. Wochenplan — bestimmt, was und wie viel geplant wird */}
          <div className="space-y-3 rounded-xl border border-ink/10 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/45">Wochenplan</p>

            <div>
              <span className="label !mb-1">An welchen Tagen?</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day, index) => {
                  const active = prefs.planDays.includes(index);
                  return (
                    <button
                      key={day}
                      onClick={() => {
                        const next = active ? prefs.planDays.filter((d) => d !== index) : [...prefs.planDays, index].sort();
                        void savePrefs({ planDays: next.length ? next : [index] });
                      }}
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
              <span className="label !mb-1">Welche Mahlzeiten?</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'fruehstueck', label: 'Frühstück' },
                  { id: 'mittag', label: 'Mittag' },
                  { id: 'abend', label: 'Abend' },
                  { id: 'snack', label: 'Snack' },
                ].map((slot) => {
                  const active = prefs.planSlots.includes(slot.id);
                  return (
                    <button
                      key={slot.id}
                      onClick={() => {
                        const next = active ? prefs.planSlots.filter((s) => s !== slot.id) : [...prefs.planSlots, slot.id];
                        void savePrefs({ planSlots: next.length ? next : [slot.id] });
                      }}
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

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-ink/60">
                Portionen pro Mahlzeit
                <input
                  type="number"
                  min={1}
                  max={12}
                  className="input !w-20 !py-1 text-center"
                  value={prefs.planServings}
                  onChange={(e) => setPrefs({ ...prefs, planServings: Number(e.target.value) || 1 })}
                  onBlur={() => void savePrefs({ planServings: prefs.planServings })}
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-ink/60">
                <input
                  type="checkbox"
                  checked={prefs.autoPlan}
                  onChange={(e) => void savePrefs({ autoPlan: e.target.checked })}
                  className="h-4 w-4 accent-[var(--color-leaf)]"
                />
                Freitags die Folgewoche vorbauen
              </label>
            </div>
            <p className="text-[11px] text-ink/45">
              Danach richtet sich jeder erzeugte Plan — auch der, den die App freitags automatisch vorbaut.
            </p>
          </div>

          {/* 2. Ernährung */}
          <div className="space-y-3 rounded-xl border border-ink/10 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/45">Ernährung</p>
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
              label="Allergien & Unverträglichkeiten"
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
            <div>
              <label className="label">Lebensmittel, die niemand mag</label>
              <p className="mb-2 text-xs text-ink/50">Einzeln eintragen, Enter hängt an.</p>
              <TagListInput
                value={prefs.dislikes}
                onChange={(dislikes) => void savePrefs({ dislikes })}
                placeholder="z. B. Rosenkohl, Leber"
              />
            </div>
          </div>

          {/* 3. Küche und Geräte */}
          <div className="space-y-3 rounded-xl border border-ink/10 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/45">Küche & Geräte</p>
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
          </div>

          {/* 4. Notiz */}
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
        </Collapsible>
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

      {showPlanModal && (
        <PlanWeekModal
          householdId={activeHousehold.id}
          prefs={prefs}
          onClose={() => setShowPlanModal(false)}
          onDone={(info) => setInfo(`${info.created} neu geplant, ${info.reused} aus der Sammlung (${formatWeekLabel(info.weekStart)}).`)}
        />
      )}

      <button className="btn btn-ghost !text-clay" onClick={() => void leave()} disabled={busy}>
        <LogOut className="h-4 w-4" /> {isOwner ? 'Haushalt löschen' : 'Haushalt verlassen'}
      </button>

    </div>
  );
}

const PLAN_SLOTS: { id: Slot; label: string }[] = SLOTS.filter((s) => s.id !== 'snack');
