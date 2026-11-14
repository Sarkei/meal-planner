import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Send, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ChatText } from '../components/ChatText';

type ChatAction = { tool: string; summary: string; ok: boolean };
type ChatMessage = { id: number | string; role: 'user' | 'assistant'; content: string; actions?: ChatAction[] };

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
};

export function ChatPage() {
  const { activeHousehold, refresh, user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Entwurf überlebt Tab-Wechsel und Neuladen
  const draftKey = `mealplanner.chatDraft.${user?.id ?? 'anon'}`;
  const [draft, setDraft] = useState(() => localStorage.getItem(draftKey) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** Textfeld wächst mit dem Inhalt statt Scrollbalken zu zeigen */
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  // Höhe immer an den Inhalt anpassen — auch wenn der Entwurf aus dem Speicher zurückkommt
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

  const scrollDown = useCallback(() => {
    window.setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }, []);

  useEffect(() => {
    api<{ messages: ChatMessage[] }>('/chat/messages')
      .then((data) => {
        setMessages(
          data.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, actions: m.actions ?? [] })),
        );
        scrollDown();
      })
      .catch(() => undefined);
  }, [scrollDown]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft('');
    setError(null);
    setBusy(true);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: message }]);
    scrollDown();
    try {
      const data = await api<{ reply: string; actions: ChatAction[] }>('/chat', {
        method: 'POST',
        body: { message, householdId: activeHousehold?.id },
      });
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: data.reply, actions: data.actions }]);
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
    await api('/chat/messages', { method: 'DELETE' });
    setMessages([]);
    setDraft('');
    setError(null);
  };

  return (
    <div className="flex w-full flex-col gap-3" style={{ minHeight: 'calc(100dvh - 240px)' }}>
      <div className="card flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-leaf" />
          <div>
            <p className="label !mb-0">Assistent</p>
            <p className="mt-0.5 text-xs text-ink/50">
              Frag nach Rezepten, ändere Wochenplan und Vorgaben — er kennt deine Einstellungen
              {activeHousehold ? ` und den Haushalt ${activeHousehold.name}` : ''}.
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button className="btn btn-ghost shrink-0" onClick={() => void reset()} title="Verlauf löschen">
            <Trash2 className="h-4 w-4" /> Neuer Chat
          </button>
        )}
      </div>

      <div ref={scrollRef} className="card min-h-[38vh] flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="space-y-3 py-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-leaf/40" />
            <p className="text-sm font-semibold text-ink/70">Womit soll ich anfangen?</p>
            <div className="mx-auto flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:border-leaf/40 hover:text-leaf"
                  onClick={() => void send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-leaf px-3.5 py-2.5 text-sm text-on-accent'
                  : 'max-w-[92%] space-y-2 rounded-2xl rounded-bl-sm bg-cream px-3.5 py-2.5 text-sm text-ink/85'
              }
            >
              {m.role === 'assistant' ? (
                <div className="space-y-1.5">
                  <ChatText text={m.content} />
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
              {m.role === 'assistant' && (m.actions?.length ?? 0) > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {m.actions?.map((a, i) => (
                    <li
                      key={`${a.tool}-${i}`}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        a.ok ? 'bg-leaf-soft text-leaf' : 'bg-danger-soft text-clay'
                      }`}
                      title={a.summary}
                    >
                      {a.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      {TOOL_LABELS[a.tool] ?? a.tool}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-ink/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Der Assistent arbeitet …
          </div>
        )}
      </div>

      {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>}

      {/* Eingabe klebt unten wie in einem normalen Chat (mobil oberhalb der Tab-Leiste) */}
      <div className="sticky bottom-[72px] z-20 rounded-2xl border border-ink/10 bg-surface/95 p-2 shadow-sm backdrop-blur sm:bottom-2 sm:p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            className="input max-h-40 min-h-[46px] flex-1 resize-none overflow-y-auto"
            rows={1}
            placeholder="Schreib dem Assistenten … (Enter sendet, Shift+Enter neue Zeile)"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              autoGrow(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
          />
          <button
            className="btn btn-primary h-[46px] shrink-0 self-end px-3"
            onClick={() => void send(draft)}
            disabled={busy || !draft.trim()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Senden
          </button>
        </div>
      </div>
    </div>
  );
}
