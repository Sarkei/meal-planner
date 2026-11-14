import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Einklappbarer Abschnitt — hält lange Einstellungslisten aus dem Weg. */
export function Collapsible({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-ink/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink/80">{title}</span>
          {summary && <span className="mt-0.5 block truncate text-[11px] text-ink/45">{summary}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink/40 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-4 border-t border-ink/8 p-3">{children}</div>}
    </div>
  );
}
