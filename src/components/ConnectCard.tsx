/**
 * Kopplung mit dem Fitness-Tracker.
 *
 * Der Fitness-Tracker liest damit den Wochenplan (welche Gerichte an welchem Tag).
 * Der Code ist ein Geheimnis, kein Login: er lässt sich hier jederzeit widerrufen,
 * und er gibt ausschließlich den Wochenplan frei.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type CodeAntwort = {
  code: string | null;
  connected?: boolean;
  appName?: string;
  label?: string;
  created_at?: string;
  last_used_at?: string | null;
};

export function ConnectCard() {
  const { activeHousehold } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [verbunden, setVerbunden] = useState(false);
  const [appName, setAppName] = useState('Fitness-Tracker');
  const [zuletzt, setZuletzt] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [arbeitet, setArbeitet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [kopiert, setKopiert] = useState(false);

  const laden = useCallback(async () => {
    setLaedt(true);
    try {
      const r = await api<CodeAntwort>('/connect/code');
      setCode(r.code ?? null);
      setVerbunden(Boolean(r.connected));
      setAppName(r.appName ?? r.label ?? 'Fitness-Tracker');
      setZuletzt(r.last_used_at ?? null);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Code konnte nicht geladen werden.');
    } finally {
      setLaedt(false);
    }
  }, []);

  // Regelmäßig nachsehen, ob die Gegenstelle den Code benutzt hat — dann steht hier
  // „verbunden", ohne dass Tim die Seite neu laden muss.
  useEffect(() => {
    void laden();
    const id = window.setInterval(() => {
      if (!verbunden) void laden();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [laden, verbunden]);

  const erzeugen = async () => {
    if (!activeHousehold) return;
    setArbeitet(true);
    setFehler(null);
    try {
      const r = await api<{ code: string }>('/connect/code', {
        method: 'POST',
        body: { householdId: activeHousehold.id, label: 'Fitness-Tracker' },
      });
      setCode(r.code);
      setZuletzt(null);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Code konnte nicht erzeugt werden.');
    } finally {
      setArbeitet(false);
    }
  };

  const widerrufen = async () => {
    if (!window.confirm('Kopplungscode widerrufen? Der Fitness-Tracker kann dann nicht mehr lesen.')) return;
    setArbeitet(true);
    try {
      await api('/connect/code', { method: 'DELETE' });
      setCode(null);
      setZuletzt(null);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Widerrufen fehlgeschlagen.');
    } finally {
      setArbeitet(false);
    }
  };

  const kopieren = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setKopiert(true);
      window.setTimeout(() => setKopiert(false), 2000);
    } catch {
      setFehler('Kopieren ging nicht — Code bitte abschreiben.');
    }
  };

  return (
    <div className="card space-y-3 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf">
          <Link2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink">Mit dem Fitness-Tracker verbinden</p>
            {verbunden && (
              <span className="inline-flex items-center gap-1 rounded-full bg-leaf-soft px-2 py-0.5 text-[10px] font-semibold text-leaf">
                <Check className="h-3 w-3" /> verbunden
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-ink/60">
            {verbunden
              ? `${appName} liest den Wochenplan. Änderungen kommen dort sofort an.`
              : 'Erzeuge hier einen Kopplungscode und trage ihn im Fitness-Tracker unter Profil → Integrationen ein. Freigegeben wird nur der Wochenplan.'}
          </p>
        </div>
      </div>

      {verbunden && zuletzt && (
        <p className="rounded-lg bg-leaf-soft px-3 py-2 text-[11px] font-semibold text-leaf">
          {appName} hat zuletzt gelesen: {new Date(zuletzt).toLocaleString('de-DE')}
        </p>
      )}

      {laedt ? (
        <p className="flex items-center gap-2 text-sm text-ink/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen …
        </p>
      ) : code ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-cream px-3 py-2 font-mono text-sm font-semibold tracking-wider text-ink">
              {code}
            </code>
            <button type="button" onClick={() => void kopieren()} className="btn btn-ghost btn-sm text-xs">
              {kopiert ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {kopiert ? 'Kopiert' : 'Kopieren'}
            </button>
            <button
              type="button"
              onClick={() => void erzeugen()}
              disabled={arbeitet}
              className="btn btn-ghost btn-sm text-xs"
              title="Neuen Code erzeugen — der alte wird ungültig"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Neuer Code
            </button>
            <button
              type="button"
              onClick={() => void widerrufen()}
              disabled={arbeitet}
              className="btn btn-ghost btn-sm text-xs text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" /> Widerrufen
            </button>
          </div>
          <p className="text-[11px] text-ink/50">
            {zuletzt
              ? `Zuletzt gelesen: ${new Date(zuletzt).toLocaleString('de-DE')}`
              : 'Noch nicht abgerufen.'}
          </p>
        </div>
      ) : (
        <button type="button" onClick={() => void erzeugen()} disabled={arbeitet || !activeHousehold} className="btn btn-primary">
          {arbeitet ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          Kopplungscode erzeugen
        </button>
      )}

      {fehler && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">{fehler}</p>}
    </div>
  );
}
