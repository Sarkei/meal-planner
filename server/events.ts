import { Router, type Response } from 'express';
import { pool } from './db';
import { verifyToken } from './auth';

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

export function broadcast(householdId: string, type: 'plan' | 'shopping' | 'recipe' | 'household'): void {
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
