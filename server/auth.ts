import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from './db';
import { fail, generateInviteCode, type AuthRequest } from './guards';

const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'dev-secret-change-me';
const TOKEN_TTL = process.env.JWT_TTL?.trim() || '30d';

export type JwtPayload = { sub: string; email: string };

export function signToken(userId: number, email: string): string {
  return jwt.sign({ sub: String(userId), email }, JWT_SECRET, { expiresIn: TOKEN_TTL } as jwt.SignOptions);
}

/** Express-Middleware, die den Bearer-Token prüft und req.userId setzt. */
export function attachUserFromToken(req: AuthRequest, _res: unknown, next: () => void): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
      const id = Number(payload.sub);
      if (Number.isFinite(id) && id > 0) req.userId = id;
    } catch {
      /* ungültiger Token → bleibt anonym, requireAuth greift */
    }
  }
  next();
}

const registerSchema = z.object({
  email: z.string().trim().email('Ungültige E-Mail-Adresse').max(200),
  password: z.string().min(8, 'Mindestens 8 Zeichen').max(200),
  displayName: z.string().trim().min(2, 'Bitte einen Namen angeben').max(80),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export async function createHouseholdWithOwner(
  name: string,
  userId: number,
): Promise<{ id: string; name: string; inviteCode: string }> {
  let code = generateInviteCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await pool.query('SELECT 1 FROM households WHERE invite_code = $1', [code]);
    if (exists.rowCount === 0) break;
    code = generateInviteCode();
  }
  const created = await pool.query<{ id: string; name: string; invite_code: string }>(
    'INSERT INTO households (name, invite_code, created_by) VALUES ($1,$2,$3) RETURNING id, name, invite_code',
    [name, code, userId],
  );
  const household = created.rows[0];
  await pool.query(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING",
    [household.id, userId],
  );
  return { id: household.id, name: household.name, inviteCode: household.invite_code };
}

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0]?.message ?? 'Eingaben prüfen.');
    return;
  }
  const { email, password, displayName } = parsed.data;
  try {
    const existing = await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
    if (existing.rowCount) {
      fail(res, 409, 'email-in-use', 'Für diese E-Mail existiert schon ein Konto.');
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    const created = await pool.query<{ id: number; email: string; display_name: string }>(
      'INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id, email, display_name',
      [email.toLowerCase(), hash, displayName],
    );
    const user = created.rows[0];
    const household = await createHouseholdWithOwner(`Küche von ${displayName.split(' ')[0]}`, user.id);
    res.status(201).json({
      token: signToken(user.id, user.email),
      user: { id: user.id, email: user.email, displayName: user.display_name },
      household,
    });
  } catch (e) {
    console.error('[auth/register]', e);
    fail(res, 500, 'register-failed', 'Registrierung fehlgeschlagen.');
  }
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', 'E-Mail und Passwort angeben.');
    return;
  }
  const { email, password } = parsed.data;
  try {
    const found = await pool.query<{ id: number; email: string; password_hash: string; display_name: string }>(
      'SELECT id, email, password_hash, display_name FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    const user = found.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      fail(res, 401, 'invalid-credentials', 'E-Mail oder Passwort ist falsch.');
      return;
    }
    res.json({
      token: signToken(user.id, user.email),
      user: { id: user.id, email: user.email, displayName: user.display_name },
    });
  } catch (e) {
    console.error('[auth/login]', e);
    fail(res, 500, 'login-failed', 'Login fehlgeschlagen.');
  }
});

authRouter.get('/me', async (req: AuthRequest, res) => {
  if (!req.userId) {
    fail(res, 401, 'unauthorized', 'Bitte einloggen.');
    return;
  }
  const user = await pool.query<{ id: number; email: string; display_name: string; created_at: string }>(
    'SELECT id, email, display_name, created_at FROM users WHERE id = $1',
    [req.userId],
  );
  if (!user.rowCount) {
    fail(res, 401, 'unauthorized', 'Konto nicht gefunden.');
    return;
  }
  const households = await pool.query<{
    id: string;
    name: string;
    role: string;
    invite_code: string;
    members: string;
    recipes: string;
  }>(
    `SELECT h.id, h.name, m.role, h.invite_code,
            (SELECT count(*) FROM household_members hm WHERE hm.household_id = h.id)::text AS members,
            (SELECT count(*) FROM recipes r WHERE r.household_id = h.id)::text AS recipes
       FROM households h
       JOIN household_members m ON m.household_id = h.id
      WHERE m.user_id = $1
      ORDER BY m.joined_at ASC`,
    [req.userId],
  );
  res.json({
    user: {
      id: user.rows[0].id,
      email: user.rows[0].email,
      displayName: user.rows[0].display_name,
      createdAt: user.rows[0].created_at,
    },
    households: households.rows.map((h) => ({
      id: h.id,
      name: h.name,
      role: h.role,
      inviteCode: h.invite_code,
      memberCount: Number(h.members),
      recipeCount: Number(h.recipes),
    })),
  });
});

authRouter.patch('/me', async (req: AuthRequest, res) => {
  if (!req.userId) {
    fail(res, 401, 'unauthorized', 'Bitte einloggen.');
    return;
  }
  const schema = z.object({ displayName: z.string().trim().min(2).max(80) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', 'Name zu kurz.');
    return;
  }
  const updated = await pool.query<{ id: number; email: string; display_name: string }>(
    'UPDATE users SET display_name = $1 WHERE id = $2 RETURNING id, email, display_name',
    [parsed.data.displayName, req.userId],
  );
  res.json({ user: { id: updated.rows[0].id, email: updated.rows[0].email, displayName: updated.rows[0].display_name } });
});

authRouter.delete('/me', async (req: AuthRequest, res) => {
  if (!req.userId) {
    fail(res, 401, 'unauthorized', 'Bitte einloggen.');
    return;
  }
  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', 'Zur Bestätigung das Passwort angeben.');
    return;
  }
  const found = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
  if (!found.rowCount || !(await bcrypt.compare(parsed.data.password, found.rows[0].password_hash))) {
    fail(res, 403, 'invalid-credentials', 'Passwort stimmt nicht.');
    return;
  }
  // Haushalte, in denen der Nutzer Besitzer ist und weitere Mitglieder hat, müssen vorher
  // übergeben oder verlassen werden — sonst verlieren andere ihre Daten.
  const shared = await pool.query<{ id: string; name: string }>(
    `SELECT h.id, h.name FROM households h
       JOIN household_members m ON m.household_id = h.id AND m.user_id = $1 AND m.role = 'owner'
      WHERE (SELECT count(*) FROM household_members x WHERE x.household_id = h.id) > 1`,
    [req.userId],
  );
  if (shared.rowCount) {
    fail(res, 409, 'household-handover-required', `Du bist noch Besitzer von „${shared.rows[0].name}" mit weiteren Mitgliedern.`);
    return;
  }
  await pool.query(
    `DELETE FROM households h
      WHERE NOT EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = h.id AND m.user_id <> $1)
        AND EXISTS (SELECT 1 FROM household_members m2 WHERE m2.household_id = h.id AND m2.user_id = $1)`,
    [req.userId],
  );
  await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);
  res.json({ ok: true });
});
