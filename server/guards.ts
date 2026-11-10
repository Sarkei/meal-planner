import type { NextFunction, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { pool } from './db';

export interface AuthRequest extends Request {
  userId?: number;
}

export function generateInviteCode(): string {
  // Kein 0/O/1/I, damit man den Code am Küchentisch vorlesen kann.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const userId = (req as AuthRequest).userId;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized', message: 'Bitte einloggen.' });
    return;
  }
  next();
}

/** Prüft, dass der Nutzer Mitglied des Haushalts ist; liefert die Rolle. */
export async function membershipRole(householdId: string, userId: number): Promise<string | null> {
  const r = await pool.query<{ role: string }>(
    'SELECT role FROM household_members WHERE household_id = $1 AND user_id = $2',
    [householdId, userId],
  );
  return r.rows[0]?.role ?? null;
}

export async function requireHousehold(
  householdId: string | undefined,
  userId: number,
): Promise<{ ok: true; role: string } | { ok: false; status: number; error: string; message: string }> {
  if (!householdId || !/^[0-9a-f-]{36}$/i.test(householdId)) {
    return { ok: false, status: 400, error: 'household-required', message: 'Haushalt fehlt.' };
  }
  const role = await membershipRole(householdId, userId);
  if (!role) {
    return { ok: false, status: 403, error: 'not-a-member', message: 'Kein Zugriff auf diesen Haushalt.' };
  }
  return { ok: true, role };
}

export function fail(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}
