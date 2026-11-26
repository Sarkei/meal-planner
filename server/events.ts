import { Router, type Response } from 'express';
import { pool } from './db';
import { verifyToken } from './auth';
import { benachrichtige } from './benachrichtigungen';
import { sendePushAnNutzer } from './push-route';

/** Versand an einen Nutzer in der Form, die `benachrichtige` erwartet. */
const sendeAn =
  (nutzerId: number) =>
  (n: { titel: string; text: string; url?: string; tag?: string; dringend?: boolean }) =>
    sendePushAnNutzer(pool, nutzerId, n);

/**
 * Server-Sent Events pro Haushalt: Die App abonniert einen Strom und lädt bei Änderungen nach.
 * Bewusst schlank gehalten (kein WebSocket-Server, keine zusätzliche Abhängigkeit).
 */
type Client = { id: number; res: Response };
const clients = new Map<string, Map<number, Client>>();
let nextId = 1;

export function subscribe(householdId: string, res: Response): () => void {
  const id = nextId++;
  if (!clients.has(householdId)) clients.set(householdId, new Map());
  clients.get(householdId)!.set(id, { id, res });
  return () => {
    clients.get(householdId)?.delete(id);
    if (clients.get(householdId)?.size === 0) clients.delete(householdId);
  };
}

/**
 * Push an die anderen Haushaltsmitglieder.
 *
 * **Warum hier:** Jede Änderung — Plan, Einkauf, Rezept, Haushalt — läuft durch
 * `broadcast`. Ein Haken an dieser Stelle deckt alle Wege ab, ohne in jedem
 * Endpunkt einzeln zu benachrichtigen.
 *
 * Der Auslöser wird mitgegeben (`von`), damit niemand eine Meldung über die
 * eigene Änderung bekommt.
 */
async function benachrichtigeHaushalt(
  householdId: string,
  type: 'plan' | 'shopping' | 'recipe' | 'household',
  von: number | null,
  detail?: { tag?: string; was?: string; aktion?: string },
): Promise<void> {
  try {
    const r = await pool.query<{ user_id: number; name: string | null }>(
      'SELECT user_id, display_name AS name FROM household_members WHERE household_id = $1',
      [householdId],
    );
    const mitglieder = r.rows.filter((m) => Number(m.user_id) !== Number(von ?? -1));
    if (!mitglieder.length) return;

    const wer = von
      ? (await pool.query<{ display_name: string | null }>('SELECT display_name FROM users WHERE id = $1', [von])).rows[0]?.display_name ?? 'Jemand'
      : 'Jemand';

    const meldung: Record<string, { titel: string; text: string }> = {
      plan: {
        titel: 'Wochenplan geändert',
        text: detail?.was ?? `${wer} hat einen Tag im Wochenplan geändert.`,
      },
      shopping: {
        titel: 'Einkaufsliste geändert',
        text: detail?.was ?? `${wer} hat etwas auf die Einkaufsliste gesetzt.`,
      },
      recipe: {
        titel: 'Rezept geändert',
        text: detail?.was ?? `${wer} hat ein Rezept angepasst.`,
      },
      household: {
        titel: 'Haushalt geändert',
        text: detail?.was ?? `${wer} hat den Haushalt angepasst.`,
      },
    };

    const m = meldung[type];
    if (!m) return;

    for (const g of mitglieder) {
      // Jede Änderung nur einmal pro Minute und Typ melden — sonst kommt bei
      // einem Plan-Lauf mit 7 Tagen sieben Nachrichten.
      const schluessel = `${type}-${Math.floor(Date.now() / 60_000)}`;
      void benachrichtige(pool as never, sendeAn(g.user_id), g.user_id, {
        kategorie: 'plan',
        ereignis: `haushalt-${type}`,
        schluessel,
        titel: m.titel,
        text: m.text,
        url: 'https://meal-planner.nas-timgreen.com/',
        tag: `haushalt-${type}`,
      }).catch(() => undefined);
    }
  } catch {
    /* Benachrichtigung darf nie eine Änderung blockieren */
  }
}

export function broadcast(
  householdId: string,
  type: 'plan' | 'shopping' | 'recipe' | 'household',
  optionen?: { von?: number | null; was?: string },
): void {
  const group = clients.get(householdId);
  if (group) {
    const payload = `data: ${JSON.stringify({ type, at: Date.now() })}\n\n`;
    for (const client of group.values()) {
      try {
        client.res.write(payload);
      } catch {
        group.delete(client.id);
      }
    }
  }
  // Bei Planänderungen die gekoppelten Apps sofort benachrichtigen.
  if (type === 'plan') void benachrichtigeKopplungen(householdId);

  // Und die anderen Haushaltsmitglieder per Push informieren.
  void benachrichtigeHaushalt(householdId, type, optionen?.von ?? null, { was: optionen?.was });
}

/**
 * Webhook an gekoppelte Apps (Fitness-Tracker).
 *
 * Die Gegenstelle trägt beim Verbinden ihre Adresse ein. Bei jeder Planänderung
 * bekommt sie einen kurzen POST — damit ist der Wochenplan dort sofort aktuell,
 * ohne auf ein Poll-Intervall zu warten. Fehler werden geschluckt: eine nicht
 * erreichbare Gegenstelle darf das Speichern im Mealplanner nie stören.
 */
async function benachrichtigeKopplungen(householdId: string): Promise<void> {
  try {
    const rows = await pool.query<{ callback_url: string; code: string }>(
      `SELECT callback_url, code FROM connect_codes
        WHERE household_id = $1 AND revoked_at IS NULL AND callback_url IS NOT NULL`,
      [householdId],
    );
    await Promise.all(
      rows.rows.map(async ({ callback_url, code }) => {
        try {
          await fetch(callback_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'plan-changed', code, householdId, at: Date.now() }),
            signal: AbortSignal.timeout(5000),
          });
        } catch {
          /* Gegenstelle offline — der nächste Abruf holt es nach. */
        }
      }),
    );
  } catch {
    /* Tabelle fehlt oder DB weg: Webhook ist nur Beschleuniger, nie Voraussetzung. */
  }
}

export const eventsRouter = Router();

eventsRouter.get('/', async (req, res) => {
  const token = String(req.query.token ?? '');
  const householdId = String(req.query.householdId ?? '');
  const auth = verifyToken(token);
  if (!auth || !/^[0-9a-f-]{36}$/i.test(householdId)) {
    res.status(401).end();
    return;
  }
  const member = await pool.query('SELECT 1 FROM household_members WHERE household_id = $1 AND user_id = $2', [
    householdId,
    auth.userId,
  ]);
  if (!member.rowCount) {
    res.status(403).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 5000\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`);

  const unsubscribe = subscribe(householdId, res);
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});
