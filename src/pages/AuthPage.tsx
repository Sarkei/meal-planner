import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { CookingPot, Loader2 } from 'lucide-react';

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') await register(displayName, email, password);
      else await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etwas ist schiefgelaufen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-ink/10 bg-white shadow-xl">
        <div className="grid md:grid-cols-2">
          <div className="hidden flex-col justify-between bg-leaf p-8 text-white md:flex">
            <div className="flex items-center gap-3">
              <CookingPot className="h-7 w-7" />
              <span className="font-display text-xl font-bold">Meal Planner</span>
            </div>
            <div className="space-y-4">
              <h2 className="font-display text-3xl leading-tight font-bold">
                Die Woche essen,<br /> nicht verplanen.
              </h2>
              <ul className="space-y-2 text-sm text-white/85">
                <li>• Wochenpläne im Haushalt gemeinsam füllen</li>
                <li>• Rezepte per KI erstellen und verfeinern</li>
                <li>• Favoriten sammeln, Einkaufsliste auf Knopfdruck</li>
              </ul>
            </div>
            <p className="text-xs text-white/60">Selbst gehostet — deine Daten bleiben bei dir.</p>
          </div>

          <div className="p-7 sm:p-9">
            <div className="mb-6 flex gap-2 rounded-xl bg-ink/5 p-1">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
                  mode === 'login' ? 'bg-white shadow-sm' : 'text-ink/55'
                }`}
              >
                Anmelden
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
                  mode === 'register' ? 'bg-white shadow-sm' : 'text-ink/55'
                }`}
              >
                Registrieren
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="label" htmlFor="name">
                    Name
                  </label>
                  <input
                    id="name"
                    className="input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Vor- und Nachname"
                    required
                    minLength={2}
                  />
                </div>
              )}
              <div>
                <label className="label" htmlFor="email">
                  E-Mail
                </label>
                <input
                  id="email"
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@beispiel.de"
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Passwort
                </label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'mindestens 8 Zeichen' : '••••••••'}
                  required
                  minLength={mode === 'register' ? 8 : 1}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
              </div>

              {error && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="btn btn-primary w-full" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === 'register' ? 'Konto erstellen' : 'Anmelden'}
              </button>
            </form>

            <p className="mt-5 text-xs leading-relaxed text-ink/50">
              Mit der Registrierung wird automatisch ein eigener Haushalt angelegt. Andere Personen lädst du
              später über den Einladungscode im Tab „Haushalt" ein.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
