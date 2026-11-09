import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { ArrowLeft, CookingPot, Loader2, MailCheck } from 'lucide-react';

type Mode = 'login' | 'register' | 'forgot';

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [resetMailed, setResetMailed] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') await register(displayName, email, password);
      else if (mode === 'login') await login(email, password);
      else {
        const data = await api<{ mailed?: boolean; devLink?: string | null }>('/auth/forgot-password', {
          method: 'POST',
          body: { email },
        });
        setResetMailed(Boolean(data.mailed));
        setResetLink(data.devLink ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etwas ist schiefgelaufen.');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setResetLink(null);
    setResetMailed(false);
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
                Die Woche essen,
                <br /> nicht verplanen.
              </h2>
              <ul className="space-y-2 text-sm text-white/85">
                <li>• Gemeinsame Rezeptsammlung — nichts geht verloren</li>
                <li>• Wochenpläne im Haushalt, Einkaufsliste auf Knopfdruck</li>
                <li>• KI erstellt Rezepte aus einer Idee</li>
                <li>• Favoriten, Bewertungen und Notizen</li>
              </ul>
            </div>
            <p className="text-xs text-white/60">Selbst gehostet — deine Daten bleiben bei dir.</p>
          </div>

          <div className="p-7 sm:p-9">
            {mode !== 'forgot' ? (
              <div className="mb-6 flex gap-2 rounded-xl bg-ink/5 p-1">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
                    mode === 'login' ? 'bg-white shadow-sm' : 'text-ink/55'
                  }`}
                >
                  Anmelden
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
                    mode === 'register' ? 'bg-white shadow-sm' : 'text-ink/55'
                  }`}
                >
                  Registrieren
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="mb-6 inline-flex items-center gap-1 text-xs font-semibold text-ink/50 hover:text-leaf"
                onClick={() => switchMode('login')}
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Zurück zur Anmeldung
              </button>
            )}

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
              {mode !== 'forgot' && (
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
              )}

              {error && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
                  {error}
                </p>
              )}

              {mode === 'forgot' && resetMailed && (
                <p className="flex items-start gap-2 rounded-xl bg-leaf-soft px-3 py-2 text-sm font-medium text-leaf">
                  <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  Wenn es ein Konto gibt, ist die Mail unterwegs. Link gilt eine Stunde.
                </p>
              )}

              {mode === 'forgot' && resetLink && (
                <div className="rounded-xl border border-dashed border-leaf/40 bg-leaf-soft/50 px-3 py-2 text-sm">
                  <p className="font-semibold text-leaf">Kein Mailversand eingerichtet — hier ist der Link:</p>
                  <a href={resetLink} className="mt-1 block break-all text-xs font-medium underline">
                    {resetLink}
                  </a>
                </div>
              )}

              <button type="submit" className="btn btn-primary w-full" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === 'register' ? 'Konto erstellen' : mode === 'login' ? 'Anmelden' : 'Link anfordern'}
              </button>
            </form>

            {mode === 'login' && (
              <button
                type="button"
                className="mt-3 text-xs font-semibold text-ink/50 hover:text-leaf"
                onClick={() => switchMode('forgot')}
              >
                Passwort vergessen?
              </button>
            )}

            <p className="mt-5 text-xs leading-relaxed text-ink/50">
              Nach der Registrierung legst du im Tab „Haushalt" einen eigenen an oder trittst mit einem Einladungscode
              bei. Alle Rezepte der Sammlung sind für alle sichtbar.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
