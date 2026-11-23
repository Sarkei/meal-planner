const TOKEN_KEY = 'mealplanner.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Zwischenspeicher für Leseanfragen.
 *
 * Die App lädt beim Start alle Bereiche vor (`prefetchBereiche`). Wechselt man danach
 * den Tab, kommen die Daten sofort aus dem Speicher — kein Ladezustand, kein Flackern.
 * Jede schreibende Anfrage (POST/PATCH/PUT/DELETE) verwirft den Speicher, damit nie
 * veraltete Daten stehen bleiben.
 */
type CacheEintrag = { zurueckgegeben: number; daten: unknown };

const cache = new Map<string, CacheEintrag>();
/** Wie lange ein Eintrag als frisch gilt (ms). Danach wird neu geladen. */
const CACHE_TTL = 60_000;
/** Laufende Anfragen — verhindert doppelte Aufrufe bei schnellem Tab-Wechsel. */
const laufend = new Map<string, Promise<unknown>>();

export function cacheLeeren(): void {
  cache.clear();
}

function cacheKey(path: string): string {
  return path;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const key = cacheKey(path);
  const istLesen = method === 'GET';

  if (istLesen) {
    const treffer = cache.get(key);
    if (treffer && Date.now() - treffer.zurueckgegeben < CACHE_TTL) {
      return treffer.daten as T;
    }
    const offen = laufend.get(key);
    if (offen) return offen as Promise<T>;
  } else {
    // Schreibzugriff: alles Gespeicherte ist potenziell veraltet.
    cacheLeeren();
  }

  const anfrage = (async () => {
    const token = getToken();
    const res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // Strings werden unverändert gesendet — sonst entsteht doppelt kodiertes JSON
      body:
        options.body === undefined
          ? undefined
          : typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body),
    });
    const text = await res.text();
    // Kein JSON (z. B. 502-HTML vom Proxy): verständliche Meldung statt JSON.parse-Absturz
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new ApiError(
          res.status,
          'bad-gateway',
          res.status === 502 || res.status === 504
            ? 'Der Server hat zu lange gebraucht. Bitte noch einmal versuchen.'
            : 'Der Server hat unerwartet geantwortet (keine JSON-Daten).',
        );
      }
    }
    if (!res.ok) {
      const err = data as { error?: string; message?: string };
      throw new ApiError(res.status, err.error ?? 'error', err.message ?? `Fehler ${res.status}`);
    }
    if (istLesen) cache.set(key, { zurueckgegeben: Date.now(), daten: data });
    return data as T;
  })();

  if (istLesen) {
    laufend.set(key, anfrage);
    try {
      return (await anfrage) as T;
    } finally {
      laufend.delete(key);
    }
  }
  return (await anfrage) as T;
}

/**
 * Lädt die Bereiche im Hintergrund vor, damit Tab-Wechsel ohne Wartezeit laufen.
 * Bewusst nacheinander und ohne Fehlerabbruch: ein kaputter Endpunkt darf die
 * übrigen Vorladungen nicht verhindern.
 */
export async function prefetchBereiche(householdId?: string | null): Promise<void> {
  const montag = mondayOf(new Date());
  const pfade = [
    '/recipes/facets',
    '/recipes?limit=60',
    '/settings',
    householdId ? `/households/${householdId}/preferences` : null,
    householdId ? `/plans/${householdId}/${montag}` : null,
    householdId ? `/shopping/${householdId}/${montag}` : null,
  ].filter((p): p is string => Boolean(p));

  for (const pfad of pfade) {
    try {
      await api(pfad);
    } catch {
      /* einzeln ignorieren */
    }
  }
}


/** Montag der Woche, in der `date` liegt — als YYYY-MM-DD (lokale Zeit). */
export function mondayOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (d.getDay() + 6) % 7; // Montag = 0
  d.setDate(d.getDate() - weekday);
  return toYmd(d);
}

export function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

export function formatDayMonth(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

export function formatWeekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(`${addDays(weekStart, 6)}T12:00:00`);
  const fmt = (d: Date) => d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}
