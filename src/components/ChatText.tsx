import { Fragment, type ReactNode } from 'react';

/** Sehr schlanke Darstellung: Absätze, Aufzählungen, **fett**, *kursiv* und `code`. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('**')) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) nodes.push(<code key={key} className="rounded bg-ink/5 px-1 py-0.5 text-[0.9em]">{token.slice(1, -1)}</code>);
    else nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function ChatText({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-1 list-disc space-y-0.5 pl-5">
        {bullets.map((b, i) => (
          <li key={i}>{inline(b, `b-${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((line, i) => {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    flush();
    if (!line.trim()) return;
    blocks.push(
      <p key={`p-${i}`} className="whitespace-pre-wrap">
        {inline(line, `p-${i}`)}
      </p>,
    );
  });
  flush();

  return <Fragment>{blocks}</Fragment>;
}
