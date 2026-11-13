import { useState } from 'react';
import { CheckCircle2, CookingPot, Loader2 } from 'lucide-react';
import { api, setToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate } from '../App';

export function ResetPasswordPage({ token }: { token: string }) {
  const { refresh } = useAuth();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== repeat) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ token: string }>('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword: password },
      });
      setToken(data.token);
      await refresh();
      setDone(true);
      setTimeout(() => navigate('week'), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Zurücksetzen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-ink/10 bg-surface p-7 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-leaf text-on-accent">
            <CookingPot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold">Neues Passwort</h1>
            <p className="text-xs text-ink/50">Der Link ist eine Stunde gültig.</p>
          </div>
        </div>

        {done ? (
          <p className="flex items-center gap-2 rounded-xl bg-leaf-soft px-3 py-3 text-sm font-semibold text-leaf">
            <CheckCircle2 className="h-4 w-4" /> Passwort gespeichert — du wirst angemeldet.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label">Neues Passwort</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label">Passwort wiederholen</label>
              <input
                type="password"
                className="input"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
            </div>
            {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>}
            <button className="btn btn-primary w-full" disabled={busy || password.length < 8}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Passwort speichern
            </button>
            <button type="button" className="w-full text-xs font-semibold text-ink/50 hover:text-leaf" onClick={() => navigate('week')}>
              Abbrechen
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
