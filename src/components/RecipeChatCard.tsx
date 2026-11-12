import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Loader2, MessageCircleQuestion, RotateCcw, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import type { Recipe } from '../lib/types';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

/**
 * Rezept-Chat: Fragen zum Gericht stellen, ohne etwas zu speichern.
 * Der Verlauf lebt nur in dieser Komponente — Neuladen oder Verlassen verwirft ihn.
 */
export function RecipeChatCard({ recipe }: { recipe: Recipe }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const firstIngredient = recipe.ingredients?.[0]?.name?.trim();

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function ask(raw: string) {
    const question = raw.trim();
    if (question.length < 2 || busy) return;
    const history = messages;
    setDraft('');
    setError(null);
    setMessages([...history, { role: 'user', content: question }]);
    setBusy(true);
    try {
      const data = await api<{ answer: string }>('/ai/recipe-chat', {
        method: 'POST',
        body: {
          recipe: {
            title: recipe.title,
            description: recipe.description,
            servings: recipe.servings,
            ingredients: recipe.ingredients,
            steps: recipe.steps,
            nutrition: recipe.nutrition,
            tags: recipe.tags,
          },
          history,
          question,
        },
      });
      setMessages([...history, { role: 'user', content: question }, { role: 'assistant', content: data.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Antwort hat nicht geklappt.');
      setMessages(history);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = [
    firstIngredient ? `Womit kann ich ${firstIngredient} ersetzen?` : 'Welche Zutat kann ich ersetzen?',
    'Wie koche ich das für 4 Portionen?',
    'Was kann ich vorher vorbereiten?',
  ];

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="label !mb-0 flex items-center gap-1.5">
            <MessageCircleQuestion className="h-3.5 w-3.5" /> Frag zum Rezept
          </p>
          <p className="mt-1 text-[11px] text-ink/45">Nur in dieser Sitzung — nichts wird gespeichert.</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost !px-2 !py-1 text-[11px]"
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
            title="Verlauf verwerfen"
          >
            <RotateCcw className="h-3 w-3" /> Leeren
          </button>
        )}
      </div>

      {messages.length > 0 && (
        <div ref={scroller} className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={`rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                m.role === 'user' ? 'ml-6 bg-sage/15' : 'mr-2 bg-ink/5'
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          ))}
          {busy && (
            <div className="mr-2 flex items-center gap-2 rounded-xl bg-ink/5 px-3 py-2 text-[13px] text-ink/55">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> überlegt …
            </div>
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="mt-3 space-y-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="flex w-full items-center gap-1.5 rounded-lg border border-ink/10 px-2 py-1.5 text-left text-[12px] text-ink/70 hover:bg-sage/10"
              onClick={() => void ask(s)}
            >
              <Sparkles className="h-3 w-3 shrink-0 text-ink/35" /> {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          className="input !py-2"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void ask(draft);
            }
          }}
          placeholder="Frage zum Rezept …"
          disabled={busy}
        />
        <button
          type="button"
          className="btn btn-primary !px-3 !py-2"
          onClick={() => void ask(draft)}
          disabled={busy || draft.trim().length < 2}
          aria-label="Frage senden"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerDownLeft className="h-4 w-4" />}
        </button>
      </div>

      {error && <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700">{error}</p>}
    </div>
  );
}
