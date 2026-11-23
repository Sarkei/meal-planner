import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ChatText } from '../components/ChatText';

type ChatAction = { tool: string; summary: string; ok: boolean };
type ChatMessage = {
  id: number | string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatAction[];
  created_at?: string;
};

const SUGGESTIONS = [
  'Was koche ich diese Woche?',
  'Plan mir eine schnelle Woche, nichts Scharfes',
  'Der Wochenplan gefällt mir nicht, mach ihn neu',
  'Ich mag keinen Rosenkohl',
  'Zeig mir vegane Rezepte unter 30 Minuten',
];

const TOOL_LABELS: Record<string, string> = {
  rezepte_suchen: 'Rezepte durchsucht',
  rezept_details: 'Rezept gelesen',
  wochenplan_lesen: 'Wochenplan gelesen',
  einstellungen_lesen: 'Einstellungen gelesen',
  einstellungen_aendern: 'Einstellungen geändert',
  abneigung_hinzufuegen: 'Abneigung gespeichert',
  abneigung_entfernen: 'Abneigung entfernt',
  haushalt_vorgaben_aendern: 'Haushalt geändert',
  woche_planen: 'Woche geplant',
  mahlzeit_hinzufuegen: 'Mahlzeit eingetragen',
  mahlzeit_entfernen: 'Mahlzeit entfernt',
  woche_leeren: 'Woche geleert',
  favorit_setzen: 'Favorit geändert',
  einkaufsliste_lesen: 'Einkaufsliste gelesen',
  einkauf_hinzufuegen: 'Artikel ergänzt',
  rezept_anlegen: 'Rezept angelegt',
};

/** Tagesschlüssel in lokaler Zeit (YYYY-MM-DD) für die Datums-Trenner. */
function tagKey(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Überschrift für einen Tag: Heute, Gestern oder ausgeschriebenes Datum. */
function tagLabel(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const heute = new Date();
  const gestern = new Date();
  gestern.setDate(heute.getDate() - 1);
  if (tagKey(iso) === tagKey(heute.toISOString())) return 'Heute';
  if (tagKey(iso) === tagKey(gestern.toISOString())) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

/** Uhrzeit HH:MM in lokaler Zeit. */
function zeitLabel(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Assistent-Chat im Stil des Fitness-Tracker-Coach-Chats:
 * Datums-Trenner wie im Messenger, Sprechblasen mit Rollen-Label und Uhrzeit,
 * ausgeführte Aktionen als Zeilen unter der Antwort, dunkle Eingabezeile unten.
 */
export function ChatPage() {
  const { activeHousehold, refresh, user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Entwurf überlebt Tab-Wechsel und Neuladen
  const draftKey = `mealplanner.chatDraft.${user?.id ?? 'anon'}`;
  const [draft, setDraft] = useState(() => localStorage.getItem(draftKey) ?? '');
  const [busy, setBusy] = useState(false);
  const [laedt, setLaedt] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Der Chat muss der sichtbaren Fläche folgen, sonst liegt die Eingabezeile
  // auf dem Handy hinter der Tastatur (100dvh kennt die Tastatur nicht).
  const [sichtbareHoehe, setSichtbareHoehe] = useState<number | null>(null);

  // Kopfzeile der App messen: ihre Höhe hängt vom Theme/Viewport ab (mal 56, mal 64 px).
  const [kopfHoehe, setKopfHoehe] = useState(64);

  useEffect(() => {
    const messen = () => {
      const el = document.querySelector('.app-header');
      if (el) setKopfHoehe(Math.round(el.getBoundingClientRect().height));
    };
    messen();
    window.addEventListener('resize', messen);
    return () => window.removeEventListener('resize', messen);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const aktualisieren = () => setSichtbareHoehe(Math.round(vv.height));
    aktualisieren();
    vv.addEventListener('resize', aktualisieren);
    vv.addEventListener('scroll', aktualisieren);
    return () => {
      vv.removeEventListener('resize', aktualisieren);
      vv.removeEventListener('scroll', aktualisieren);
    };
  }, []);

  /** Textfeld wächst mit dem Inhalt statt Scrollbalken zu zeigen */
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (!draft) {
      el.style.height = '';
      return;
    }
    autoGrow(el);
  }, [draft]);

  useEffect(() => {
    if (draft) localStorage.setItem(draftKey, draft);
    else localStorage.removeItem(draftKey);
  }, [draft, draftKey]);

  // Nach unten scrollen, aber nur innerhalb der Chatbox — die Seite selbst bleibt stehen.
  const scrollDown = useCallback(() => {
    window.setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }, []);

  const laden = useCallback(async () => {
    setLaedt(true);
    setError(null);
    try {
      const data = await api<{ messages: ChatMessage[] }>('/chat/messages');
      setMessages(data.messages ?? []);
      scrollDown();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat konnte nicht geladen werden.');
    } finally {
      setLaedt(false);
    }
  }, [scrollDown]);

  useEffect(() => {
    void laden();
  }, [laden]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft('');
    setError(null);
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: 'user', content: message, created_at: new Date().toISOString() },
    ]);
    scrollDown();
    try {
      const data = await api<{
        reply: string;
        actions: ChatAction[];
        id?: number | null;
        createdAt?: string | null;
      }>('/chat', {
        method: 'POST',
        body: { message, householdId: activeHousehold?.id },
      });
      setMessages((prev) => [
        ...prev,
        {
          id: data.id ?? `a-${Date.now()}`,
          role: 'assistant',
          content: data.reply,
          actions: data.actions,
          created_at: data.createdAt ?? new Date().toISOString(),
        },
      ]);
      // Profil-Vorgaben im Kopf der App sofort nachziehen, wenn der Assistent sie geändert hat
      if (
        data.actions.some((a) =>
          ['einstellungen_aendern', 'abneigung_hinzufuegen', 'abneigung_entfernen', 'haushalt_vorgaben_aendern'].includes(a.tool),
        )
      ) {
        void refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Der Assistent antwortet gerade nicht.');
    } finally {
      setBusy(false);
      scrollDown();
    }
  };

  const reset = async () => {
    if (!window.confirm('Den ganzen Chatverlauf löschen?')) return;
    try {
      await api('/chat/messages', { method: 'DELETE' });
      setMessages([]);
      setDraft('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.');
    }
  };

  const leer = !laedt && messages.length === 0;

  return (
    // Höhe folgt dem sichtbaren Bereich (visualViewport). Auf dem Handy schrumpft
    // --vv-height, sobald die Tastatur aufgeht — dadurch bleibt die Eingabezeile sichtbar.
    <div
      className="flex w-full flex-col gap-3"
      style={{
        height: `calc(${sichtbareHoehe ? `${sichtbareHoehe}px` : 'var(--vv-height, 100dvh)'} - ${kopfHoehe}px - 5.5rem)`,
      }}
    >
      {/* Kopfzeile: Zweck des Chats und Verlauf löschen */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Assistent</p>
          <h1 className="mt-0.5 text-[22px] leading-tight text-ink">Küchen-Chat</h1>
          <p className="mt-1 text-xs text-ink/55">
            Frag nach Rezepten, ändere Wochenplan und Vorgaben — er kennt deine Einstellungen
            {activeHousehold ? ` und den Haushalt ${activeHousehold.name}` : ''}.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => void reset()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-ink/15 px-3 py-2 text-[11px] font-semibold text-ink/60 transition hover:text-ink"
          >
            <Trash2 className="h-3.5 w-3.5" /> Verlauf löschen
          </button>
        )}
      </div>

      {/* Nachrichten liegen direkt auf dem Hintergrund — keine äußere Box */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-1">
        {laedt && (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-ink/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Chat wird geladen …
          </p>
        )}

        {leer && (
          <div className="w-full space-y-4 py-2">
            <div className="flex items-start gap-3 rounded-2xl bg-leaf-soft p-4">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-leaf" />
              <p className="text-sm leading-relaxed text-leaf">
                Ich kenne deine Rezepte, deine Abneigungen und den Wochenplan.
                Sag mir, was du willst — ich passe es direkt an.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border border-ink/15 px-3 py-1.5 text-left text-[12px] text-ink/60 transition hover:border-leaf hover:text-leaf"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, index) => {
          const eigen = m.role === 'user';
          const vorherige = index > 0 ? messages[index - 1] : null;
          // Datums-Trenner, sobald ein neuer Kalendertag beginnt (wie im Messenger)
          const neuerTag = !vorherige || tagKey(vorherige.created_at) !== tagKey(m.created_at);
          return (
            <div key={m.id} className="w-full">
              {neuerTag && (
                <div className="my-4 flex items-center gap-3" aria-label={tagLabel(m.created_at)}>
                  <span className="h-px flex-1 bg-ink/10" />
                  <span className="shrink-0 rounded-full bg-cream px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink/45">
                    {tagLabel(m.created_at)}
                  </span>
                  <span className="h-px flex-1 bg-ink/10" />
                </div>
              )}
              <div className={`flex w-full ${eigen ? 'justify-end' : 'justify-start'}`}>
                {/* 60 % der Boxbreite als Obergrenze — die Zeile selbst ist 100 % breit */}
                <div className={`flex w-fit max-w-[90%] flex-col gap-0.5 sm:max-w-[75%] ${eigen ? 'items-end' : 'items-start'}`}>
                  <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">
                    {eigen ? 'Du' : 'Assistent'}
                  </span>
                  <div
                    className={`space-y-2 rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed shadow-[0_1px_2px_rgb(15_23_42/0.06)] ${
                      eigen ? 'rounded-br-md chat-bubble-me' : 'rounded-bl-md chat-bubble-coach'
                    }`}
                  >
                    {eigen ? (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    ) : (
                      <ChatText text={m.content} />
                    )}
                    {(m.actions?.length ?? 0) > 0 && (
                      <div className={`space-y-1 border-t pt-2 ${eigen ? 'border-white/30' : 'border-ink/10'}`}>
                        {m.actions?.map((a, i) => (
                          <p
                            key={`${a.tool}-${i}`}
                            className="flex items-center gap-1.5 text-[11px] font-semibold opacity-90"
                            title={a.summary}
                          >
                            {a.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                            {TOOL_LABELS[a.tool] ?? a.tool}
                            {a.summary ? <span className="font-normal opacity-70">· {a.summary}</span> : null}
                          </p>
                        ))}
                      </div>
                    )}
                    <p className={`text-right text-[10px] tabular-nums ${eigen ? 'chat-time-me' : 'chat-time'}`}>
                      {zeitLabel(m.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-cream px-4 py-2.5 text-[13px] text-ink/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> denkt nach …
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mx-1 shrink-0 rounded-xl bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">
          {error}
        </p>
      )}

      {/* Eingabezeile: eigenständige dunkle Box am unteren Rand */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="mt-1 flex shrink-0 items-end gap-2 rounded-2xl chat-input-box p-2 shadow-[0_2px_8px_rgb(15_23_42/0.12)]"
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            autoGrow(e.currentTarget);
          }}
          onFocus={() => {
            // Tastatur öffnet erst kurz danach - dann ans Ende scrollen,
            // damit die letzte Nachricht über der Eingabe sichtbar bleibt.
            [120, 320, 600].forEach((ms) =>
              window.setTimeout(() => {
                const el = scrollRef.current;
                if (el) el.scrollTop = el.scrollHeight;
              }, ms),
            );
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          rows={1}
          enterKeyHint="send"
          autoComplete="off"
          placeholder="Frag den Assistenten …"
          className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-3 text-[13.5px] text-white placeholder:text-white/60 outline-none"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-40"
          aria-label="Senden"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpIcon />}
        </button>
      </form>
    </div>
  );
}

/** Pfeil nach oben im Senden-Knopf (derselbe wie im Coach-Chat). */
function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
