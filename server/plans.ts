import { Router } from 'express';
import { pool } from './db';
import { fail, requireHousehold, type AuthRequest } from './guards';
import type { Ingredient } from './recipeSchema';

export const plansRouter = Router();

/** Einheiten einheitlich und lesbar ausgeben (Kleinschreibung kommt aus der KI). */
const UNIT_LABELS: Record<string, string> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  el: 'EL',
  tl: 'TL',
  stueck: 'Stück',
  'stück': 'Stück',
  prise: 'Prise',
  bund: 'Bund',
  zehe: 'Zehe',
  zehen: 'Zehen',
  scheibe: 'Scheibe',
  scheiben: 'Scheiben',
  dose: 'Dose',
  dosen: 'Dosen',
  becher: 'Becher',
  packung: 'Packung',
  stange: 'Stange',
  handvoll: 'Handvoll',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

async function ensurePlan(householdId: string, weekStart: string, userId: number): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM meal_plans WHERE household_id = $1 AND week_start = $2',
    [householdId, weekStart],
  );
  if (existing.rowCount) return existing.rows[0].id;
  const created = await pool.query<{ id: string }>(
    `INSERT INTO meal_plans (household_id, week_start, created_by) VALUES ($1,$2,$3)
     ON CONFLICT (household_id, week_start) DO UPDATE SET household_id = EXCLUDED.household_id
     RETURNING id`,
    [householdId, weekStart, userId],
  );
  return created.rows[0].id;
}

type EntryRow = {
  id: string;
  day_index: number;
  slot: string;
  recipe_id: string | null;
  custom_title: string | null;
  servings: number | null;
  title: string | null;
  recipe_servings: number | null;
  prep_minutes: number | null;
  tags: string[] | null;
  nutrition: Record<string, number> | null;
  image_hint: string | null;
};

export async function loadPlan(householdId: string, weekStart: string) {
  const plan = await pool.query<{ id: string; week_start: string; created_at: string }>(
    'SELECT id, week_start, created_at FROM meal_plans WHERE household_id = $1 AND week_start = $2',
    [householdId, weekStart],
  );
  if (!plan.rowCount) return { weekStart, planId: null, entries: [] as unknown[] };
  const entries = await pool.query<EntryRow>(
    `SELECT e.id, e.day_index, e.slot, e.recipe_id, e.custom_title, e.servings,
            r.title, r.servings AS recipe_servings, r.prep_minutes, r.tags, r.nutrition,
            NULL::text AS image_hint
       FROM plan_entries e
       LEFT JOIN recipes r ON r.id = e.recipe_id
      WHERE e.plan_id = $1
      ORDER BY e.day_index ASC, e.slot ASC`,
    [plan.rows[0].id],
  );
  return {
    weekStart,
    planId: plan.rows[0].id,
    entries: entries.rows.map((e) => ({
      id: e.id,
      dayIndex: e.day_index,
      slot: e.slot,
      recipeId: e.recipe_id,
      title: e.title ?? e.custom_title ?? 'Ohne Titel',
      customTitle: e.custom_title,
      servings: e.servings ?? e.recipe_servings ?? null,
      prepMinutes: e.prep_minutes,
      tags: e.tags ?? [],
      nutrition: e.nutrition ?? {},
    })),
  };
}

plansRouter.get('/:householdId/:weekStart', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (!isValidDate(req.params.weekStart)) {
    fail(res, 400, 'invalid-date', 'Datum im Format YYYY-MM-DD angeben.');
    return;
  }
  res.json(await loadPlan(req.params.householdId, req.params.weekStart));
});

plansRouter.put('/:householdId/:weekStart/entry', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const { dayIndex, slot, recipeId, customTitle, servings } = req.body as {
    dayIndex?: number;
    slot?: string;
    recipeId?: string | null;
    customTitle?: string | null;
    servings?: number | null;
  };
  if (typeof dayIndex !== 'number' || dayIndex < 0 || dayIndex > 6) {
    fail(res, 400, 'invalid-input', 'Tag zwischen 0 (Montag) und 6 (Sonntag) angeben.');
    return;
  }
  if (!slot || !['fruehstueck', 'mittag', 'abend', 'snack'].includes(slot)) {
    fail(res, 400, 'invalid-input', 'Ungültiger Slot.');
    return;
  }
  if (!recipeId && !customTitle?.trim()) {
    fail(res, 400, 'invalid-input', 'Rezept oder eigener Titel nötig.');
    return;
  }
  if (recipeId) {
    const owned = await pool.query('SELECT 1 FROM recipes WHERE id = $1 AND household_id = $2', [
      recipeId,
      req.params.householdId,
    ]);
    if (!owned.rowCount) {
      fail(res, 400, 'invalid-recipe', 'Rezept gehört nicht zu diesem Haushalt.');
      return;
    }
  }
  const planId = await ensurePlan(req.params.householdId, req.params.weekStart, req.userId!);
  await pool.query(
    `INSERT INTO plan_entries (plan_id, day_index, slot, recipe_id, custom_title, servings)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (plan_id, day_index, slot)
     DO UPDATE SET recipe_id = EXCLUDED.recipe_id, custom_title = EXCLUDED.custom_title, servings = EXCLUDED.servings`,
    [planId, dayIndex, slot, recipeId ?? null, customTitle?.trim() || null, servings ?? null],
  );
  res.json(await loadPlan(req.params.householdId, req.params.weekStart));
});

plansRouter.delete('/:householdId/:weekStart/entry/:entryId', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  await pool.query(
    `DELETE FROM plan_entries e USING meal_plans p
      WHERE e.id = $1 AND e.plan_id = p.id AND p.household_id = $2 AND p.week_start = $3`,
    [req.params.entryId, req.params.householdId, req.params.weekStart],
  );
  res.json(await loadPlan(req.params.householdId, req.params.weekStart));
});

plansRouter.get('/:householdId/:weekStart/shopping-list', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const rows = await pool.query<{ title: string; servings: number; entry_servings: number | null; ingredients: Ingredient[] }>(
    `SELECT r.title, r.servings, e.servings AS entry_servings, r.ingredients
       FROM plan_entries e
       JOIN meal_plans p ON p.id = e.plan_id
       JOIN recipes r ON r.id = e.recipe_id
      WHERE p.household_id = $1 AND p.week_start = $2`,
    [req.params.householdId, req.params.weekStart],
  );
  const groups = new Map<string, { name: string; unit: string; amount: number; unknown: boolean; usedIn: Set<string> }>();
  for (const row of rows.rows) {
    const factor = row.entry_servings && row.servings ? row.entry_servings / row.servings : 1;
    for (const ing of row.ingredients ?? []) {
      const name = String(ing.name ?? '').trim();
      if (!name) continue;
      const unitKey = String(ing.unit ?? '').trim().toLowerCase();
      const unit = UNIT_LABELS[unitKey] ?? String(ing.unit ?? '').trim();
      const key = `${name.toLowerCase()}|${unitKey}`;
      const current = groups.get(key) ?? { name, unit, amount: 0, unknown: false, usedIn: new Set<string>() };
      if (typeof ing.amount === 'number' && Number.isFinite(ing.amount)) {
        current.amount += ing.amount * factor;
      } else {
        current.unknown = true;
      }
      current.usedIn.add(row.title);
      groups.set(key, current);
    }
  }
  const items = [...groups.values()]
    .map((g) => ({
      name: g.name,
      unit: g.unit,
      amount: Math.round(g.amount * 10) / 10,
      approximated: g.unknown,
      usedIn: [...g.usedIn],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  res.json({ weekStart: req.params.weekStart, items });
});
