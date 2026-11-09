import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool } from './db';
import { fail, generateInviteCode, type AuthRequest } from './guards';

const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'dev-secret-change-me';
const TOKEN_TTL = process.env.JWT_TTL?.trim() || '30d';
const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
const DEV_RESET_LINK = process.env.ALLOW_DEV_RESET_LINK !== '0';
const RESET_TTL_MINUTES = Number(process.env.RESET_TTL_MINUTES ?? 60) || 60;

export type JwtPayload = { sub: string; email: string; tv: number };

export function signToken(userId: number, email: string, tokenVersion: number): string {
  return jwt.sign({ sub: String(userId), email, tv: tokenVersion }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  } as jwt.SignOptions);
}

/** Nur Signatur prüfen (für SSE, wo kein Authorization-Header gesetzt werden kann). */
export function verifyToken(token: string): { userId: number; tokenVersion: number } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const id = Number(payload.sub);
    if (!Number.isFinite(id) || id <= 0) return null;
    return { userId: id, tokenVersion: Number(payload.tv ?? 0) };
  } catch {
    return null;
  }
}

type TokenCache = { version: number; checkedAt: number };
const tokenVersionCache = new Map<number, TokenCache>();

function invalidateTokenCache(userId: number): void {
  tokenVersionCache.delete(userId);
}

/**
 * Prüft den Bearer-Token und setzt req.userId. Die token_version in der Datenbank macht
 * Passwort-Reset bzw. „alle Geräte abmelden" wirksam — alte Tokens laufen dann ins Leere.
 */
export async function attachUserFromToken(req: AuthRequest, _res: unknown, next: () => void): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
      const id = Number(payload.sub);
      if (Number.isFinite(id) && id > 0) {
        const cached = tokenVersionCache.get(id);
        let version: number | null = null;
        if (cached && Date.now() - cached.checkedAt < 60_000) {
          version = cached.version;
        } else {
          const row = await pool.query<{ token_version: number }>('SELECT token_version FROM users WHERE id = $1', [id]);
          if (row.rowCount) {
            version = row.rows[0].token_version;
            tokenVersionCache.set(id, { version, checkedAt: Date.now() });
          }
        }
        if (version != null && Number(payload.tv ?? 0) === version) req.userId = id;
      }
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

export type UserSettings = {
  theme: 'system' | 'light' | 'dark';
  defaultServings: number;
  /** Mehrfachauswahl, z. B. vegan + glutenfrei. Leer = keine Vorgabe. */
  diets: string[];
  /** Leer = keine Allergien/Abneigungen. */
  allergies: string[];
  /** Präferierte Küchen, leer = egal. */
  cuisines: string[];
  maxMinutes: number | null;
  kcalTarget: number | null;
  aiAutoFavorite: boolean;
  defaultSlots: string[];
  specialWishes: string;
};

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  defaultServings: 2,
  diets: [],
  allergies: [],
  cuisines: [],
  maxMinutes: null,
  kcalTarget: null,
  aiAutoFavorite: true,
  defaultSlots: ['abend'],
  specialWishes: '',
};

/** Akzeptiert Liste oder (Altbestand) Komma-Text und liefert eine saubere Liste. */
function toStringList(value: unknown, max: number): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  return raw
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0 && v.toLowerCase() !== 'keine' && v.toLowerCase() !== 'keine vorgabe' && v.toLowerCase() !== 'egal')
    .slice(0, max);
}

export function mergeSettings(raw: unknown): UserSettings {
  const value = (raw ?? {}) as Partial<UserSettings>;
  const slots = Array.isArray(value.defaultSlots)
    ? value.defaultSlots.filter((s) => ['fruehstueck', 'mittag', 'abend', 'snack'].includes(String(s)))
    : null;
  return {
    theme: value.theme === 'light' || value.theme === 'dark' || value.theme === 'system' ? value.theme : DEFAULT_SETTINGS.theme,
    defaultServings: Math.min(12, Math.max(1, Number(value.defaultServings ?? DEFAULT_SETTINGS.defaultServings) || 2)),
    diets: toStringList((value as { diets?: unknown }).diets ?? (value as { diet?: unknown }).diet, 8),
    allergies: toStringList(value.allergies, 12),
    cuisines: toStringList(value.cuisines, 10),
    maxMinutes: value.maxMinutes != null && Number.isFinite(Number(value.maxMinutes)) ? Number(value.maxMinutes) : null,
    kcalTarget: value.kcalTarget != null && Number.isFinite(Number(value.kcalTarget)) ? Number(value.kcalTarget) : null,
    aiAutoFavorite: value.aiAutoFavorite !== false,
    defaultSlots: slots?.length ? slots : DEFAULT_SETTINGS.defaultSlots,
    specialWishes: String(value.specialWishes ?? '').slice(0, 400),
  };
}

export async function loadSettings(userId: number): Promise<UserSettings> {
  const row = await pool.query<{ data: unknown }>('SELECT data FROM user_settings WHERE user_id = $1', [userId]);
  return mergeSettings(row.rows[0]?.data);
}

/** Sammelt die Vorgaben aller Haushaltsmitglieder und fasst sie zusammen. */
export async function loadHouseholdPreferences(householdId: string): Promise<{
  diets: string[];
  allergies: string[];
  cuisines: string[];
  maxMinutes: number | null;
  kcalTarget: number | null;
  specialWishes: string[];
  members: number;
}> {
  const rows = await pool.query<{ data: unknown; display_name: string }>(
    `SELECT coalesce(s.data, '{}'::jsonb) AS data, u.display_name
       FROM household_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_settings s ON s.user_id = m.user_id
      WHERE m.household_id = $1
      ORDER BY m.joined_at ASC`,
    [householdId],
  );
  const merged = { diets: new Set<string>(), allergies: new Set<string>(), cuisines: new Set<string>(), wishes: [] as string[] };
  let maxMinutes: number | null = null;
  let kcalSum = 0;
  let kcalCount = 0;
  for (const row of rows.rows) {
    const s = mergeSettings(row.data);
    s.diets.forEach((d) => merged.diets.add(d));
    s.allergies.forEach((a) => merged.allergies.add(a));
    s.cuisines.forEach((c) => merged.cuisines.add(c));
    if (s.specialWishes) merged.wishes.push(`${row.display_name}: ${s.specialWishes}`);
    if (s.maxMinutes != null) maxMinutes = maxMinutes == null ? s.maxMinutes : Math.min(maxMinutes, s.maxMinutes);
    if (s.kcalTarget != null) {
      kcalSum += s.kcalTarget;
      kcalCount += 1;
    }
  }
  return {
    diets: [...merged.diets],
    allergies: [...merged.allergies],
    cuisines: [...merged.cuisines],
    maxMinutes,
    kcalTarget: kcalCount ? Math.round(kcalSum / kcalCount) : null,
    specialWishes: merged.wishes,
    members: rows.rowCount ?? 0,
  };
}

export async function saveSettings(userId: number, patch: unknown): Promise<UserSettings> {
  const current = await loadSettings(userId);
  const next = mergeSettings({ ...current, ...(patch as object) });
  await pool.query(
    `INSERT INTO user_settings (user_id, data, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [userId, JSON.stringify(next)],
  );
  return next;
}

async function sendResetMail(email: string, link: string): Promise<boolean> {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return false;
  try {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === '1',
      auth:
        process.env.SMTP_USER?.trim()
          ? { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS ?? '' }
          : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM?.trim() || 'noreply@mealplanner.local',
      to: email,
      subject: 'Meal Planner — Passwort zurücksetzen',
      text: `Moin,\n\nhier ist dein Link zum Zurücksetzen des Passworts (${RESET_TTL_MINUTES} Minuten gültig):\n${link}\n\nWenn du das nicht warst, ignoriere diese Mail.`,
      html: `<p>Moin,</p><p>hier ist dein Link zum Zurücksetzen des Passworts (${RESET_TTL_MINUTES} Minuten gültig):</p><p><a href="${link}">${link}</a></p><p>Wenn du das nicht warst, ignoriere diese Mail.</p>`,
    });
    return true;
  } catch (e) {
    console.warn('[auth] Reset-Mail konnte nicht gesendet werden:', e);
    return false;
  }
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
      `INSERT INTO users (email, email_lower, password_hash, display_name) VALUES ($1,$2,$3,$4)
       RETURNING id, email, display_name`,
      [email.toLowerCase(), email.toLowerCase(), hash, displayName],
    );
    const user = created.rows[0];
    // Bewusst kein automatischer Haushalt: Der Nutzer legt selbst einen an oder tritt einem bei.
    res.status(201).json({
      token: signToken(user.id, user.email, 0),
      user: { id: user.id, email: user.email, displayName: user.display_name },
      household: null,
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
    const found = await pool.query<{
      id: number;
      email: string;
      password_hash: string;
      display_name: string;
      token_version: number;
    }>('SELECT id, email, password_hash, display_name, token_version FROM users WHERE lower(email) = lower($1)', [email]);
    const user = found.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      fail(res, 401, 'invalid-credentials', 'E-Mail oder Passwort ist falsch.');
      return;
    }
    res.json({
      token: signToken(user.id, user.email, user.token_version),
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
            (SELECT count(*) FROM recipes rc WHERE rc.household_id = h.id AND rc.status = 'active')::text AS recipes
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
    settings: await loadSettings(req.userId),
  });
});

authRouter.patch('/me', async (req: AuthRequest, res) => {
  if (!req.userId) {
    fail(res, 401, 'unauthorized', 'Bitte einloggen.');
    return;
  }
  const parsed = z.object({ displayName: z.string().trim().min(2).max(80) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', 'Name zu kurz.');
    return;
  }
  const updated = await pool.query<{ id: number; email: string; display_name: string }>(
    'UPDATE users SET display_name = $1 WHERE id = $2 RETURNING id, email, display_name',
    [parsed.data.displayName, req.userId],
  );
  res.json({
    user: { id: updated.rows[0].id, email: updated.rows[0].email, displayName: updated.rows[0].display_name },
  });
});

authRouter.get('/settings', async (req: AuthRequest, res) => {
  if (!req.userId) {
    fail(res, 401, 'unauthorized', 'Bitte einloggen.');
    return;
  }
  res.json({ settings: await loadSettings(req.userId) });
});

authRouter.put('/settings', async (req: AuthRequest, res) => {
  if (!req.userId) {
    fail(res, 401, 'unauthorized', 'Bitte einloggen.');
    return;
  }
  try {
    res.json({ settings: await saveSettings(req.userId, req.body) });
  } catch (e) {
    console.error('[auth/settings]', e);
    fail(res, 500, 'settings-failed', 'Einstellungen konnten nicht gespeichert werden.');
  }
});

authRouter.post('/change-password', async (req: AuthRequest, res) => {
  if (!req.userId) {
    fail(res, 401, 'unauthorized', 'Bitte einloggen.');
    return;
  }
  const parsed = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', 'Neues Passwort braucht mindestens 8 Zeichen.');
    return;
  }
  const found = await pool.query<{ email: string; password_hash: string; token_version: number }>(
    'SELECT email, password_hash, token_version FROM users WHERE id = $1',
    [req.userId],
  );
  if (!found.rowCount || !(await bcrypt.compare(parsed.data.currentPassword, found.rows[0].password_hash))) {
    fail(res, 403, 'invalid-credentials', 'Aktuelles Passwort stimmt nicht.');
    return;
  }
  const hash = await bcrypt.hash(parsed.data.newPassword, 12);
  const version = found.rows[0].token_version + 1;
  await pool.query('UPDATE users SET password_hash = $1, token_version = $2 WHERE id = $3', [hash, version, req.userId]);
  invalidateTokenCache(req.userId);
  res.json({ ok: true, token: signToken(req.userId, found.rows[0].email, version) });
});

authRouter.post('/forgot-password', async (req, res) => {
  const parsed = z.object({ email: z.string().trim().email() }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', 'Bitte eine E-Mail-Adresse angeben.');
    return;
  }
  const email = parsed.data.email.toLowerCase();
  const user = await pool.query<{ id: number; email: string }>('SELECT id, email FROM users WHERE lower(email) = $1', [
    email,
  ]);
  // Immer dieselbe Antwort — verrät nicht, ob es das Konto gibt.
  const generic = { ok: true, devLink: null as string | null };
  if (!user.rowCount) {
    res.json(generic);
    return;
  }
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1,$2, now() + ($3 || ' minutes')::interval)`,
    [user.rows[0].id, tokenHash, String(RESET_TTL_MINUTES)],
  );
  const link = `${APP_PUBLIC_URL}/#/reset?token=${token}`;
  const mailed = await sendResetMail(user.rows[0].email, link);
  res.json({
    ok: true,
    mailed,
    devLink: !mailed && DEV_RESET_LINK ? link : null,
  });
});

authRouter.post('/reset-password', async (req, res) => {
  const parsed = z.object({ token: z.string().min(20), newPassword: z.string().min(8).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', 'Token fehlt oder Passwort zu kurz (min. 8 Zeichen).');
    return;
  }
  const tokenHash = createHash('sha256').update(parsed.data.token).digest('hex');
  const found = await pool.query<{ id: number; user_id: number; email: string }>(
    `SELECT t.id, t.user_id, u.email FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()`,
    [tokenHash],
  );
  if (!found.rowCount) {
    fail(res, 400, 'invalid-token', 'Der Link ist abgelaufen oder wurde schon benutzt.');
    return;
  }
  const row = found.rows[0];
  const hash = await bcrypt.hash(parsed.data.newPassword, 12);
  const bumped = await pool.query<{ token_version: number }>(
    'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING token_version',
    [hash, row.user_id],
  );
  await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);
  invalidateTokenCache(row.user_id);
  res.json({ ok: true, token: signToken(row.user_id, row.email, bumped.rows[0].token_version) });
});

authRouter.post('/logout-all', async (req: AuthRequest, res) => {
  if (!req.userId) {
    fail(res, 401, 'unauthorized', 'Bitte einloggen.');
    return;
  }
  const bumped = await pool.query<{ token_version: number }>(
    'UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version',
    [req.userId],
  );
  invalidateTokenCache(req.userId);
  res.json({ ok: true, tokenVersion: bumped.rows[0].token_version });
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
  // Rezepte bleiben in der Bibliothek — nur der Autor wird entkoppelt.
  await pool.query('UPDATE recipes SET owner_id = NULL WHERE owner_id = $1', [req.userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);
  invalidateTokenCache(req.userId);
  res.json({ ok: true });
});
