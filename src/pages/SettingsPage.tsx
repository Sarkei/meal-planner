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
import { SLOTS, type Slot, type UserSettings } from '../lib/types';

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

      <div className="card space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-leaf" />
          <div>
            <p className="label !mb-0">KI-Vorgaben</p>
            <p className="mt-1 text-xs text-ink/50">
              Diese Angaben nutzt der Assistent automatisch, wenn du Rezepte oder Wochen erstellen lässt.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Portionen (Standard)</label>
            <input
              type="number"
              min={1}
              max={12}
              className="input"
              value={settings.defaultServings}
              onChange={(e) => void saveSettings({ defaultServings: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Kalorienziel pro Portion</label>
            <input
              type="number"
              min={0}
              className="input"
              value={settings.kcalTarget ?? ''}
              onChange={(e) => void saveSettings({ kcalTarget: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="optional"
            />
          </div>
          <div>
            <label className="label">Ernährungsform</label>
            <input
              className="input"
              value={settings.diet}
              onChange={(e) => void saveSettings({ diet: e.target.value })}
              placeholder="vegetarisch, vegan, low carb …"
            />
          </div>
          <div>
            <label className="label">Allergien / Abneigungen</label>
            <input
              className="input"
              value={settings.allergies}
              onChange={(e) => void saveSettings({ allergies: e.target.value })}
              placeholder="Nüsse, Laktose, Pilze …"
            />
          </div>
          <div>
            <label className="label">Max. Zubereitungszeit (Minuten)</label>
            <input
              type="number"
              min={0}
              className="input"
              value={settings.maxMinutes ?? ''}
              onChange={(e) => void saveSettings({ maxMinutes: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="optional"
            />
          </div>
          <div>
            <label className="label">KI-Rezepte automatisch als Favorit</label>
            <button
              className={`btn w-full ${settings.aiAutoFavorite ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => void saveSettings({ aiAutoFavorite: !settings.aiAutoFavorite })}
            >
              {settings.aiAutoFavorite ? 'An — landet direkt bei Favoriten' : 'Aus'}
            </button>
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
