import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db';
import { createHouseholdWithOwner } from './auth';
import { fail, generateInviteCode, membershipRole, requireHousehold, type AuthRequest } from './guards';

export const householdsRouter = Router();

householdsRouter.get('/', async (req: AuthRequest, res) => {
  const r = await pool.query(
    `SELECT h.id, h.name, h.invite_code, m.role, h.created_at,
            (SELECT count(*) FROM household_members hm WHERE hm.household_id = h.id)::int AS member_count,
            (SELECT count(*) FROM recipes rc WHERE rc.household_id = h.id)::int AS recipe_count
       FROM households h
       JOIN household_members m ON m.household_id = h.id
      WHERE m.user_id = $1
      ORDER BY h.created_at ASC`,
    [req.userId],
  );
  res.json({
    households: r.rows.map((h) => ({
      id: h.id,
      name: h.name,
      inviteCode: h.invite_code,
      role: h.role,
      memberCount: h.member_count,
      recipeCount: h.recipe_count,
      createdAt: h.created_at,
    })),
  });
});

householdsRouter.post('/', async (req: AuthRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(80) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', 'Bitte einen Namen für den Haushalt angeben.');
    return;
  }
  // Genau ein Haushalt pro Person — kein Beitritt zu einem zweiten.
  const already = await pool.query('SELECT household_id FROM household_members WHERE user_id = $1', [req.userId]);
  if (already.rowCount) {
    fail(res, 409, 'one-household-only', 'Du hast schon einen Haushalt. Verlasse ihn zuerst.');
    return;
  }
  const household = await createHouseholdWithOwner(parsed.data.name, req.userId!);
  res.status(201).json({ household: { ...household, role: 'owner', memberCount: 1, recipeCount: 0 } });
});

householdsRouter.post('/join', async (req: AuthRequest, res) => {
  const parsed = z.object({ code: z.string().trim().min(4).max(16) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', 'Einladungscode angeben.');
    return;
  }
  const already = await pool.query('SELECT household_id FROM household_members WHERE user_id = $1', [req.userId]);
  if (already.rowCount) {
    fail(res, 409, 'one-household-only', 'Du bist schon in einem Haushalt. Verlasse ihn zuerst.');
    return;
  }
  const code = parsed.data.code.toUpperCase();
  const hh = await pool.query<{ id: string; name: string }>('SELECT id, name FROM households WHERE invite_code = $1', [code]);
  if (!hh.rowCount) {
    fail(res, 404, 'invalid-code', 'Dieser Einladungscode existiert nicht.');
    return;
  }
  const household = hh.rows[0];
  const inserted = await pool.query(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING RETURNING role",
    [household.id, req.userId],
  );
  res.json({
    household: { id: household.id, name: household.name, role: inserted.rowCount ? 'member' : 'member' },
    alreadyMember: inserted.rowCount === 0,
  });
});

householdsRouter.get('/:id', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.id, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const household = await pool.query<{ id: string; name: string; invite_code: string; created_at: string }>(
    'SELECT id, name, invite_code, created_at FROM households WHERE id = $1',
    [req.params.id],
  );
  if (!household.rowCount) {
    fail(res, 404, 'not-found', 'Haushalt nicht gefunden.');
    return;
  }
  const members = await pool.query<{ user_id: number; display_name: string; email: string; role: string; joined_at: string }>(
    `SELECT m.user_id, u.display_name, u.email, m.role, m.joined_at
       FROM household_members m JOIN users u ON u.id = m.user_id
      WHERE m.household_id = $1
      ORDER BY m.joined_at ASC`,
    [req.params.id],
  );
  res.json({
    household: {
      id: household.rows[0].id,
      name: household.rows[0].name,
      inviteCode: household.rows[0].invite_code,
      createdAt: household.rows[0].created_at,
      role: access.role,
    },
    members: members.rows.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name,
      email: m.email,
      role: m.role,
      joinedAt: m.joined_at,
    })),
  });
});

householdsRouter.patch('/:id', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.id, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (access.role !== 'owner') {
    fail(res, 403, 'owner-only', 'Nur der Besitzer kann den Haushalt umbenennen.');
    return;
  }
  const parsed = z.object({ name: z.string().trim().min(2).max(80) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', 'Name zu kurz.');
    return;
  }
  const updated = await pool.query<{ id: string; name: string; invite_code: string }>(
    'UPDATE households SET name = $1 WHERE id = $2 RETURNING id, name, invite_code',
    [parsed.data.name, req.params.id],
  );
  res.json({ household: { id: updated.rows[0].id, name: updated.rows[0].name, inviteCode: updated.rows[0].invite_code } });
});

householdsRouter.post('/:id/invite-code', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.id, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (access.role !== 'owner') {
    fail(res, 403, 'owner-only', 'Nur der Besitzer kann den Code neu erzeugen.');
    return;
  }
  const code = generateInviteCode();
  const updated = await pool.query<{ invite_code: string }>(
    'UPDATE households SET invite_code = $1 WHERE id = $2 RETURNING invite_code',
    [code, req.params.id],
  );
  res.json({ inviteCode: updated.rows[0].invite_code });
});

householdsRouter.delete('/:id/members/:userId', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.id, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const targetId = Number(req.params.userId);
  const isSelf = targetId === req.userId;
  if (!isSelf && access.role !== 'owner') {
    fail(res, 403, 'owner-only', 'Nur der Besitzer kann Mitglieder entfernen.');
    return;
  }
  if (!isSelf) {
    const targetRole = await membershipRole(req.params.id, targetId);
    if (targetRole === 'owner') {
      fail(res, 400, 'owner-cannot-be-removed', 'Der Besitzer kann nicht entfernt werden.');
      return;
    }
  }
  await pool.query('DELETE FROM household_members WHERE household_id = $1 AND user_id = $2', [req.params.id, targetId]);
  res.json({ ok: true });
});

householdsRouter.delete('/:id', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.id, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (access.role !== 'owner') {
    fail(res, 403, 'owner-only', 'Nur der Besitzer kann den Haushalt löschen.');
    return;
  }
  const others = await pool.query<{ c: number }>(
    'SELECT count(*)::int AS c FROM household_members WHERE household_id = $1',
    [req.params.id],
  );
  if ((others.rows[0]?.c ?? 0) > 1 && req.query.force !== '1') {
    fail(res, 409, 'household-not-empty', 'Es sind noch andere Mitglieder im Haushalt.');
    return;
  }
  await pool.query('DELETE FROM households WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});
