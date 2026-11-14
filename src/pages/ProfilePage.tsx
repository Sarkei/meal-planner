import { useEffect, useState } from 'react';
import { Check, Loader2, LogOut, Sparkles, Trash2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';

export function ProfilePage() {
  const { user, logout, refresh } = useAuth();
  const [name, setName] = useState(user?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<{ enabled: boolean; provider: string; model: string | null } | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<{ enabled: boolean; provider: string; model: string | null }>('/ai/status');
        setAi(data);
      } catch {
        setAi(null);
      }
    })();
  }, []);

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

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/me', { method: 'PATCH', body: { displayName: name } });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <p className="label">Konto</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Anzeigename</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">E-Mail</label>
            <input className="input" value={user?.email ?? ''} disabled />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || name.trim().length < 2}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Speichern
          </button>
          {saved && <span className="text-xs font-semibold text-leaf">Gespeichert</span>}
          {error && <span className="text-xs font-semibold text-red-600">{error}</span>}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-leaf" />
          <p className="label !mb-0">KI-Assistent</p>
        </div>
        <p className="mt-2 text-sm text-ink/60">
          {ai?.enabled
            ? `Aktiv — ${ai.provider}${ai.model ? ` (${ai.model})` : ''}. Wochenpläne und Rezepte werden über diesen Anbieter erzeugt.`
            : 'Nicht konfiguriert. Ohne API-Key bleiben KI-Funktionen aus, alles andere funktioniert normal.'}
        </p>
      </div>

      <div className="card flex items-center justify-between p-5">
        <div>
          <p className="text-sm font-semibold">Abmelden</p>
          <p className="text-xs text-ink/50">Beendet die Sitzung auf diesem Gerät.</p>
        </div>
        <button className="btn btn-ghost" onClick={logout}>
          <LogOut className="h-4 w-4" /> Abmelden
        </button>
      </div>

      <div className="card space-y-3 p-5">
        <div>
          <p className="text-sm font-semibold text-clay">Konto löschen</p>
          <p className="text-xs text-ink/50">
            Entfernt Konto, eigene Haushalte, Rezepte und Pläne. Haushalte, in denen weitere Personen
            sind, musst du vorher verlassen oder übergeben.
          </p>
        </div>
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
