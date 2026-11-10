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
  if (!group) return;
  const payload = `data: ${JSON.stringify({ type, at: Date.now() })}\n\n`;
  for (const client of group.values()) {
    try {
      client.res.write(payload);
    } catch {
      group.delete(client.id);
    }
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
