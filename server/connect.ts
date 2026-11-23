/**
 * Kopplung mit anderen Apps (z. B. Fitness-Tracker).
 *
 * Beide Apps haben getrennte Konten. Statt Zugangsdaten zu teilen, erzeugt der
 * Mealplanner einen Kopplungscode; die andere App schickt ihn bei jeder Anfrage mit
 * und bekommt genau die Daten, die der Code freigibt (aktuell: Wochenplan).
 *
 * Der Code ist ein zufälliges Geheimnis, kein Login — er lässt sich jederzeit
 * widerrufen, und es wird nichts außer dem Wochenplan damit lesbar.
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { pool } from './db';
import { fail, requireAuth, type AuthRequest } from './guards';
import { loadPlan } from './plans';

export const connectRouter = Router();

const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** Code ohne 0/O/1/I — am Küchentisch vorlesbar. */
function neuerCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // 12 Zeichen für drei Blöcke à vier — 12 Bytes, sonst bleibt der dritte Block leer.
  const bytes = randomBytes(12);
  const roh = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${roh.slice(0, 4)}-${roh.slice(4, 8)}-${roh.slice(8, 12)}`;
}

async function tabelleAnlegen(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS connect_codes (
      code           TEXT PRIMARY KEY,
      user_id        INTEGER NOT NULL,
      household_id   UUID NOT NULL,
      label          TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at   TIMESTAMPTZ,
      revoked_at     TIMESTAMPTZ
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS connect_codes_user_idx ON connect_codes (user_id)');
  // Adresse der Gegenstelle für den Sofort-Abgleich bei Planänderungen.
  await pool.query('ALTER TABLE connect_codes ADD COLUMN IF NOT EXISTS callback_url TEXT');
  await pool.query('ALTER TABLE connect_codes ADD COLUMN IF NOT EXISTS app_name TEXT');
}

void tabelleAnlegen().catch((e) => console.error('connect_codes:', e));

/** Montag der aktuellen Woche als YYYY-MM-DD (lokale Zeit). */
function montag(): string {
  const d = new Date();
  const wochentag = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wochentag);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- Verwaltung */

/** Eigenen Kopplungscode samt Verbindungsstatus anzeigen (nur mit Login). */
connectRouter.get('/code', requireAuth, async (req: AuthRequest, res) => {
  const row = await pool.query(
    `SELECT code, label, created_at, last_used_at, callback_url, app_name FROM connect_codes
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [req.userId],
  );
  if (!row.rows.length) {
    res.json({ code: null, connected: false });
    return;
  }
  const r = row.rows[0] as {
    code: string;
    label: string | null;
    created_at: string;
    last_used_at: string | null;
    callback_url: string | null;
    app_name: string | null;
  };
  // "Verbunden" heißt: die Gegenstelle hat den Code schon benutzt.
  res.json({
    ...r,
    connected: Boolean(r.last_used_at),
    appName: r.app_name ?? r.label ?? 'Fitness-Tracker',
  });
});

connectRouter.post('/code', requireAuth, async (req: AuthRequest, res) => {
  const householdId = String((req.body as { householdId?: string })?.householdId ?? '');
  const label = String((req.body as { label?: string })?.label ?? '').trim() || 'Fitness-Tracker';
  if (!/^[0-9a-f-]{36}$/i.test(householdId)) {
    fail(res, 400, 'household-required', 'Haushalt fehlt.');
    return;
  }
  const angehoerig = await pool.query(
    'SELECT 1 FROM household_members WHERE household_id = $1 AND user_id = $2',
    [householdId, req.userId],
  );
  if (!angehoerig.rowCount) {
    fail(res, 403, 'forbidden', 'Du gehörst nicht zu diesem Haushalt.');
    return;
  }
  // Nur ein aktiver Code pro Nutzer — ein neuer ersetzt den alten.
  await pool.query(
    'UPDATE connect_codes SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [req.userId],
  );
  const code = neuerCode();
  await pool.query(
    'INSERT INTO connect_codes (code, user_id, household_id, label) VALUES ($1,$2,$3,$4)',
    [code, req.userId, householdId, label],
  );
  res.json({ code, label });
});

connectRouter.delete('/code', requireAuth, async (req: AuthRequest, res) => {
  await pool.query('UPDATE connect_codes SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [
    req.userId,
  ]);
  res.json({ ok: true });
});

/* ------------------------------------------------------------ Lesezugriff */

async function codePruefen(code: string) {
  const r = await pool.query(
    `SELECT household_id, user_id FROM connect_codes
      WHERE code = $1 AND revoked_at IS NULL LIMIT 1`,
    [code],
  );
  if (!r.rowCount) return null;
  await pool.query('UPDATE connect_codes SET last_used_at = NOW() WHERE code = $1', [code]);
  return r.rows[0] as { household_id: string; user_id: number };
}

/**
 * Prüfung durch die Gegenstelle: existiert der Code?
 * Dabei trägt die Gegenstelle ihre Adresse für den Sofort-Abgleich ein —
 * das ist der einzige Schreibzugriff, den ein Kopplungscode erlaubt.
 */
connectRouter.get('/:code', async (req, res) => {
  const code = String(req.params.code ?? '').trim();
  const treffer = await codePruefen(code);
  if (!treffer) {
    fail(res, 404, 'invalid-code', 'Der Kopplungscode ist ungültig oder wurde widerrufen.');
    return;
  }
  const callback = String((req.query.callback as string) ?? '').trim();
  const appName = String((req.query.app as string) ?? '').trim();
  if (callback && /^https?:\/\//.test(callback)) {
    await pool.query('UPDATE connect_codes SET callback_url = $2, app_name = $3 WHERE code = $1', [
      code,
      callback.replace(/\/$/, ''),
      appName || 'Fitness-Tracker',
    ]);
  }
  const h = await pool.query('SELECT name FROM households WHERE id = $1', [treffer.household_id]);
  res.json({ ok: true, householdName: h.rows[0]?.name ?? null });
});

/** Wochenplan des gekoppelten Haushalts — die einzige Datenfreigabe. */
connectRouter.get('/:code/week', async (req, res) => {
  const treffer = await codePruefen(String(req.params.code ?? '').trim());
  if (!treffer) {
    fail(res, 404, 'invalid-code', 'Der Kopplungscode ist ungültig oder wurde widerrufen.');
    return;
  }
  const woche = String((req.query.w as string) ?? '') || montag();
  try {
    const plan = await loadPlan(treffer.household_id, woche);
    const eintraege = (plan.entries as Array<Record<string, unknown>>).map((e) => ({
      tag: WOCHENTAGE[Number(e.dayIndex)] ?? '',
      tagIndex: e.dayIndex,
      mahlzeit: e.slot,
      titel: e.title,
      portionen: e.servings,
      kcal: (e.nutrition as Record<string, unknown> | null)?.kcal ?? null,
      protein: (e.nutrition as Record<string, unknown> | null)?.protein ?? null,
    }));
    const kcalSumme = eintraege.reduce((s, e) => s + (Number(e.kcal) || 0), 0);
    res.json({ woche, anzahl: eintraege.length, kcalSumme, eintraege });
  } catch {
    fail(res, 500, 'plan-failed', 'Wochenplan konnte nicht geladen werden.');
  }
});
