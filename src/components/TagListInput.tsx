import { useState } from 'react';
import { Plus, X } from 'lucide-react';

/**
 * Freie Liste (z. B. Lebensmittel, die nicht gemocht werden): Eingabe + Enter hängt an,
 * jedes Element ist einzeln entfernbar. Speichert die ganze Liste beim Aufrufer.
 */
export function TagListInput({
  value,
  onChange,
  placeholder = 'z. B. Rosenkohl',
  max = 40,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const parts = draft
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const part of parts) {
      if (part.length > 60) continue;
      if (!next.some((v) => v.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    onChange(next.slice(0, max));
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="input flex-1"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn-ghost shrink-0" onClick={add} disabled={!draft.trim()}>
          <Plus className="h-4 w-4" /> Hinzufügen
        </button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((item) => (
            <span
              key={item}
              className="flex items-center gap-1 rounded-full border border-ink/15 bg-surface/60 py-1 pl-3 pr-1.5 text-xs font-semibold text-ink/70"
            >
              {item}
              <button
                type="button"
                className="rounded-full p-0.5 text-ink/35 transition hover:bg-danger-soft hover:text-clay"
                onClick={() => onChange(value.filter((v) => v !== item))}
                aria-label={`${item} entfernen`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
