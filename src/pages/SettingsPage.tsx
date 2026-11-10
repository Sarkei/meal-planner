import { useState } from 'react';
import {
  Check,
  Download,
  Loader2,
  LogOut,
  Moon,
  Save,
  Sparkles,
  Sun,
  Trash2,
  MonitorSmartphone,
  Lock,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, setToken } from '../lib/api';
import { Collapsible } from '../components/Collapsible';
import {
  ALLERGY_OPTIONS as ALLERGY_OPTIONS_BASE,
  APPLIANCE_OPTIONS as APPLIANCE_OPTIONS_BASE,
  CUISINE_OPTIONS as CUISINE_OPTIONS_BASE,
  DIET_OPTIONS as DIET_OPTIONS_BASE,
} from '../lib/preferences';
import { SLOTS, type Slot, type UserSettings } from '../lib/types';
import { TagListInput } from '../components/TagListInput';

type Option = { value: string; label: string };

const APPLIANCE_OPTIONS = [...APPLIANCE_OPTIONS_BASE];
const DIET_OPTIONS = [...DIET_OPTIONS_BASE];
const CUISINE_OPTIONS = [...CUISINE_OPTIONS_BASE];
const ALLERGY_OPTIONS = [...ALLERGY_OPTIONS_BASE];

const TIME_OPTIONS: Option[] = [
  { value: '', label: 'Egal' },
  { value: '15', label: '15 min' },
  { value: '20', label: '20 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '60 min' },
  { value: '90', label: '90 min' },
];

const KCAL_OPTIONS: Option[] = [
  { value: '', label: 'Egal' },
  { value: '400', label: '400 kcal' },
  { value: '500', label: '500 kcal' },
  { value: '600', label: '600 kcal' },
  { value: '700', label: '700 kcal' },
  { value: '800', label: '800 kcal' },
];

function MultiOptionRow({
  label,
  options,
  selected,
  emptyLabel,
  onToggle,
  onClear,
  capitalize,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  emptyLabel: string;
  onToggle: (value: string) => void;
  onClear: () => void;
  capitalize?: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
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
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                active ? 'border-leaf bg-leaf text-white' : 'border-ink/15 text-ink/60 hover:border-leaf/40'
              } ${capitalize ? 'capitalize' : ''}`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OptionRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Option[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value || 'none'}
            onClick={() => onSelect(option.value)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              selected === option.value
                ? 'border-leaf bg-leaf-soft text-leaf'
                : 'border-ink/15 text-ink/55 hover:border-leaf/40'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { user, settings, updateSettings, applyTheme, refresh, logout } = useAuth();
  const [name, setName] = useState(user?.displayName ?? '');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [wishes, setWishes] = useState(settings.specialWishes);

  const saveSettings = async (patch: Partial<UserSettings>) => {
    await updateSettings(patch);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 1200);
  };

  const saveName = async () => {
    setNameBusy(true);
    try {
      await api('/auth/me', { method: 'PATCH', body: { displayName: name } });
      await refresh();
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 1500);
    } finally {
      setNameBusy(false);
    }
  };

  const changePassword = async () => {
    setPwBusy(true);
    setPwMsg(null);
    try {
      const data = await api<{ token: string }>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setToken(data.token);
      setCurrentPassword('');
      setNewPassword('');
      setPwMsg({ ok: true, text: 'Passwort geändert — andere Geräte sind abgemeldet.' });
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : 'Passwort konnte nicht geändert werden.' });
    } finally {
      setPwBusy(false);
    }
  };

  const exportData = async () => {
    setBusy(true);
    try {
      const [mine, favorites] = await Promise.all([
        api<{ recipes: unknown[] }>('/recipes?mine=1&limit=60'),
        api<{ recipes: unknown[] }>('/recipes/favorites'),
      ]);
      const bundle = {
        exportedAt: new Date().toISOString(),
        user: { email: user?.email, displayName: user?.displayName },
        settings,
        recipes: mine.recipes,
        favorites: favorites.recipes,
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mealplanner-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  const logoutAll = async () => {
    if (!window.confirm('Auf allen Geräten abmelden?')) return;
    const data = await api<{ tokenVersion: number }>('/auth/logout-all', { method: 'POST', body: {} });
    // Der eigene Token ist damit auch ungültig — neu einloggen.
    setToken(null);
    logout();
    void data;
  };

  const deleteAccount = async () => {
    if (!window.confirm('Konto wirklich löschen? Das lässt sich nicht rückgängig machen.')) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api('/auth/me', { method: 'DELETE', body: { password: deletePassword } });
      logout();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Konto konnte nicht gelöscht werden.');
    } finally {
      setBusy(false);
    }
  };

  const toggleSlot = (slot: Slot) => {
    const current = settings.defaultSlots;
    const next = current.includes(slot) ? current.filter((s) => s !== slot) : [...current, slot];
    void saveSettings({ defaultSlots: next.length ? next : ['abend'] });
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-5">
        <div>
          <p className="label !mb-0">Profil</p>
          <p className="mt-1 text-xs text-ink/50">Name und E-Mail-Adresse deines Kontos.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Anzeigename</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">E-Mail</label>
            <input className="input" value={user?.email ?? ''} disabled />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={() => void saveName()} disabled={nameBusy || name.trim().length < 2}>
            {nameBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Speichern
          </button>
          {nameSaved && <span className="text-xs font-semibold text-leaf">Gespeichert</span>}
        </div>
      </div>

      <div className="card p-4">
        <Collapsible
          title="KI-Vorgaben"
          summary={
            [
              settings.diets.join(', '),
              settings.cuisines.join(', '),
              settings.allergies.length ? `ohne ${settings.allergies.join(', ')}` : '',
              settings.dislikes.length ? `${settings.dislikes.length} Abneigungen` : '',
              settings.appliances.length ? `${settings.appliances.length} Geräte` : '',
            ]
              .filter(Boolean)
              .join(' · ') || 'keine Vorgaben — antippen zum Bearbeiten'
          }
        >
          <p className="text-xs text-ink/50">
            Diese Angaben nutzt der Assistent automatisch, wenn du Rezepte oder Wochen erstellen lässt.
          </p>
        <div className="space-y-5">
          <OptionRow
            label="Portionen (Standard)"
            options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: `${n}` }))}
            selected={String(settings.defaultServings)}
            onSelect={(v) => void saveSettings({ defaultServings: Number(v) })}
          />

          <MultiOptionRow
            label="Ernährungsform (Mehrfachauswahl)"
            options={DIET_OPTIONS}
            selected={settings.diets}
            emptyLabel="Keine Vorgabe"
            capitalize
            onClear={() => void saveSettings({ diets: [] })}
            onToggle={(value) =>
              void saveSettings({
                diets: settings.diets.includes(value)
                  ? settings.diets.filter((d) => d !== value)
                  : [...settings.diets, value].slice(0, 8),
              })
            }
          />

          <MultiOptionRow
            label="Präferierte Küche (Mehrfachauswahl)"
            options={CUISINE_OPTIONS}
            selected={settings.cuisines}
            emptyLabel="Egal"
            onClear={() => void saveSettings({ cuisines: [] })}
            onToggle={(value) =>
              void saveSettings({
                cuisines: settings.cuisines.includes(value)
                  ? settings.cuisines.filter((c) => c !== value)
                  : [...settings.cuisines, value].slice(0, 10),
              })
            }
          />

          <div>
            <label className="label">Küchengeräte, die ich benutzen kann</label>
            <p className="mb-2 text-xs text-ink/50">
              Die KI schlägt nur Rezepte vor, die mit diesen Geräten machbar sind.
            </p>
            <div className="flex flex-wrap gap-2">
              {APPLIANCE_OPTIONS.map((option) => {
                const active = settings.appliances.includes(option);
                return (
                  <button
                    key={option}
                    onClick={() =>
                      void saveSettings({
                        appliances: active
                          ? settings.appliances.filter((a) => a !== option)
                          : [...settings.appliances, option].slice(0, 12),
                      })
                    }
                    className={`ui-mark-selected rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'border-leaf bg-leaf text-white'
                        : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="label">Diese Lebensmittel mag ich nicht</label>
            <p className="mb-2 text-xs text-ink/50">
              Die KI meidet sie in Rezepten und Wochenplänen. Einzeln eintragen, Enter hängt an.
            </p>
            <TagListInput
              value={settings.dislikes}
              onChange={(dislikes) => void saveSettings({ dislikes })}
              placeholder="z. B. Rosenkohl, Leber, Koriander"
            />
          </div>

          <div>
            <label className="label">Allergien & Abneigungen (Mehrfachauswahl)</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void saveSettings({ allergies: [] })}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  settings.allergies.length === 0
                    ? 'border-leaf bg-leaf text-white'
                    : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                }`}
              >
                Keine Allergien
              </button>
              {ALLERGY_OPTIONS.map((option) => {
                const active = settings.allergies.includes(option);
                return (
                  <button
                    key={option}
                    onClick={() =>
                      void saveSettings({
                        allergies: active
                          ? settings.allergies.filter((a) => a !== option)
                          : [...settings.allergies, option].slice(0, 12),
                      })
                    }
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      active ? 'border-leaf bg-leaf text-white' : 'border-ink/15 text-ink/60 hover:border-leaf/40'
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          <OptionRow
            label="Max. Zubereitungszeit"
            options={TIME_OPTIONS}
            selected={settings.maxMinutes == null ? '' : String(settings.maxMinutes)}
            onSelect={(v) => void saveSettings({ maxMinutes: v === '' ? null : Number(v) })}
          />

          <OptionRow
            label="Kalorienziel pro Portion"
            options={KCAL_OPTIONS}
            selected={settings.kcalTarget == null ? '' : String(settings.kcalTarget)}
            onSelect={(v) => void saveSettings({ kcalTarget: v === '' ? null : Number(v) })}
          />

          <div>
            <label className="label">KI-Rezepte automatisch als Favorit</label>
            <div className="flex gap-2">
              {[
                { value: true, label: 'Ja' },
                { value: false, label: 'Nein' },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  onClick={() => void saveSettings({ aiAutoFavorite: option.value })}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    settings.aiAutoFavorite === option.value
                      ? 'border-leaf bg-leaf-soft text-leaf'
                      : 'border-ink/15 text-ink/55 hover:border-leaf/40'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Sonderwünsche für die KI</label>
            <textarea
              className="textarea"
              rows={3}
              value={wishes}
              onChange={(e) => setWishes(e.target.value)}
              placeholder="z. B. mag keine Rosinen, Kinder essen gern Nudeln, bitte viel Gemüse, keine Fertigprodukte"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                className="btn btn-ghost !px-3 !py-1.5 text-xs"
                onClick={() => void saveSettings({ specialWishes: wishes })}
                disabled={wishes === settings.specialWishes}
              >
                <Save className="h-3.5 w-3.5" /> Sonderwünsche speichern
              </button>
              {wishes !== settings.specialWishes && <span className="text-[11px] text-ink/45">noch nicht gespeichert</span>}
            </div>
          </div>
        </div>
        <div>
          <label className="label">Standard-Mahlzeiten für „KI plant die Woche"</label>
          <div className="flex flex-wrap gap-2">
            {SLOTS.map((s) => (
              <button
                key={s.id}
                onClick={() => toggleSlot(s.id)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  settings.defaultSlots.includes(s.id)
                    ? 'border-leaf bg-leaf-soft text-leaf'
                    : 'border-ink/15 text-ink/55 hover:border-leaf/40'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {settingsSaved && <p className="text-xs font-semibold text-leaf">Einstellung gespeichert</p>}
        </Collapsible>
        </div>

        <div className="card space-y-3 p-5">
        <p className="label !mb-0">Darstellung</p>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'system' as const, label: 'System', icon: MonitorSmartphone },
            { id: 'light' as const, label: 'Hell', icon: Sun },
            { id: 'dark' as const, label: 'Dunkel', icon: Moon },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                applyTheme(id);
                void saveSettings({ theme: id });
              }}
              className={`btn ${settings.theme === id ? 'btn-primary' : 'btn-ghost'}`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-leaf" />
          <p className="label !mb-0">Passwort ändern</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Aktuelles Passwort</label>
            <input
              type="password"
              className="input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Neues Passwort (min. 8 Zeichen)</label>
            <input type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => void changePassword()}
          disabled={pwBusy || !currentPassword || newPassword.length < 8}
        >
          {pwBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Passwort speichern
        </button>
        {pwMsg && (
          <p className={`text-xs font-semibold ${pwMsg.ok ? 'text-leaf' : 'text-red-600'}`}>{pwMsg.text}</p>
        )}
      </div>

      <div className="card space-y-3 p-5">
        <p className="label !mb-0">Daten & Sitzungen</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={() => void exportData()} disabled={busy}>
            <Download className="h-4 w-4" /> Daten exportieren (JSON)
          </button>
          <button className="btn btn-ghost" onClick={() => void logoutAll()}>
            <LogOut className="h-4 w-4" /> Auf allen Geräten abmelden
          </button>
        </div>
        <p className="text-xs text-ink/45">
          Beim Export bekommst du deine eigenen Rezepte, deine Favoriten und deine Einstellungen als JSON.
        </p>
      </div>

      <div className="card space-y-3 p-5">
        <p className="text-sm font-semibold text-clay">Konto löschen</p>
        <p className="text-xs text-ink/50">
          Entfernt Konto, eigene Haushalte und Mitgliedschaften. Erstellte Rezepte bleiben anonymisiert in der Sammlung
          erhalten. Haushalte mit weiteren Personen musst du vorher verlassen.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="password"
            className="input sm:max-w-xs"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            placeholder="Passwort zur Bestätigung"
          />
          <button
            className="btn btn-ghost !text-clay"
            disabled={busy || deletePassword.length < 1}
            onClick={() => void deleteAccount()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Konto löschen
          </button>
        </div>
        {deleteError && <p className="text-xs font-semibold text-red-600">{deleteError}</p>}
      </div>
    </div>
  );
}
