import { useEffect, useRef } from 'react';
import { getToken } from './api';

/**
 * Abonniert die Änderungen eines Haushalts (Server-Sent Events).
 * Rufe im Callback das nach, was sich geändert haben könnte — die Daten selbst kommen per REST.
 */
export function useHouseholdEvents(
  householdId: string | null | undefined,
  onEvent: (type: 'plan' | 'shopping' | 'recipe' | 'household' | 'hello') => void,
): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const token = getToken();
    if (!householdId || !token) return;
    let source: EventSource | null = null;
    let closed = false;
    let retry: number | undefined;

    const connect = () => {
      if (closed) return;
      const url = `/api/events?householdId=${encodeURIComponent(householdId)}&token=${encodeURIComponent(token)}`;
      source = new EventSource(url);
      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { type?: string };
          if (data.type) handler.current(data.type as 'plan' | 'shopping' | 'recipe' | 'household' | 'hello');
        } catch {
          /* ignorieren */
        }
      };
      source.onerror = () => {
        source?.close();
        source = null;
        if (!closed) retry = window.setTimeout(connect, 4000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      source?.close();
    };
  }, [householdId]);
}
