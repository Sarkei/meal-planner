import { Router } from 'express';
import { pool } from './db';
import { fail, requireHousehold, type AuthRequest } from './guards';
import { normalizeRecipe, recipeInputSchema } from './recipeSchema';

export const recipesRouter = Router();

type RecipeRow = {
  id: string;
  household_id: string;
  owner_id: number | null;
  title: string;
  description: string;
  servings: number;
  prep_minutes: number | null;
  tags: string[];
  source: string;
  ingredients: unknown;
  steps: unknown;
  nutrition: unknown;
  created_at: string;
  updated_at: string;
  favorite?: boolean;
  owner_name?: string | null;
};

function mapRecipe(row: RecipeRow) {
  return {
    id: row.id,
    householdId: row.household_id,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? null,
    title: row.title,
    description: row.description,
    servings: row.servings,
    prepMinutes: row.prep_minutes,
    tags: row.tags ?? [],
    source: row.source,
    ingredients: row.ingredients ?? [],
    steps: row.steps ?? [],
    nutrition: row.nutrition ?? {},
    favorite: Boolean(row.favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_BASE = `
  SELECT r.*, u.display_name AS owner_name,
         EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id = r.id AND f.user_id = $1) AS favorite
    FROM recipes r
    LEFT JOIN users u ON u.id = r.owner_id
`;

recipesRouter.get('/favorites', async (req: AuthRequest, res) => {
  const r = await pool.query<RecipeRow>(
    `${SELECT_BASE}
      JOIN favorites f2 ON f2.recipe_id = r.id AND f2.user_id = $1
      JOIN household_members m ON m.household_id = r.household_id AND m.user_id = $1
      ORDER BY f2.created_at DESC`,
    [req.userId],
  );
  res.json({ recipes: r.rows.map(mapRecipe) });
});

recipesRouter.get('/', async (req: AuthRequest, res) => {
  const householdId = String(req.query.householdId ?? '');
  const access = await requireHousehold(householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const q = String(req.query.q ?? '').trim();
  const onlyFavorites = req.query.favorites === '1';
  const params: unknown[] = [req.userId, householdId];
  let sql = `${SELECT_BASE} WHERE r.household_id = $2`;
  if (onlyFavorites) sql += ' AND EXISTS (SELECT 1 FROM favorites f3 WHERE f3.recipe_id = r.id AND f3.user_id = $1)';
  if (q) {
    params.push(`%${q}%`);
    sql += ` AND (r.title ILIKE $${params.length} OR r.description ILIKE $${params.length} OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.ingredients) ing WHERE ing->>'name' ILIKE $${params.length}))`;
  }
  sql += ' ORDER BY r.updated_at DESC LIMIT 300';
  const r = await pool.query<RecipeRow>(sql, params);
  res.json({ recipes: r.rows.map(mapRecipe) });
});

recipesRouter.get('/:id', async (req: AuthRequest, res) => {
  const r = await pool.query<RecipeRow>(`${SELECT_BASE} WHERE r.id = $2`, [req.userId, req.params.id]);
  if (!r.rowCount) {
    fail(res, 404, 'not-found', 'Rezept nicht gefunden.');
    return;
  }
  const access = await requireHousehold(r.rows[0].household_id, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  res.json({ recipe: mapRecipe(r.rows[0]) });
});

recipesRouter.post('/', async (req: AuthRequest, res) => {
  const householdId = String((req.body as { householdId?: string }).householdId ?? '');
  const access = await requireHousehold(householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const parsed = recipeInputSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0]?.message ?? 'Rezept prüfen.');
    return;
  }
  const recipe = normalizeRecipe(parsed.data);
  const created = await pool.query<RecipeRow>(
    `INSERT INTO recipes (household_id, owner_id, title, description, servings, prep_minutes, tags, source, ingredients, steps, nutrition)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb)
     RETURNING *, (SELECT display_name FROM users WHERE id = $2) AS owner_name, false AS favorite`,
    [
      householdId,
      req.userId,
      recipe.title,
      recipe.description,
      recipe.servings,
      recipe.prepMinutes,
      recipe.tags,
      'manual',
      JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.steps),
      JSON.stringify(recipe.nutrition),
    ],
  );
  res.status(201).json({ recipe: mapRecipe(created.rows[0]) });
});

recipesRouter.patch('/:id', async (req: AuthRequest, res) => {
  const existing = await pool.query<RecipeRow>('SELECT * FROM recipes WHERE id = $1', [req.params.id]);
  if (!existing.rowCount) {
    fail(res, 404, 'not-found', 'Rezept nicht gefunden.');
    return;
  }
  const access = await requireHousehold(existing.rows[0].household_id, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const parsed = recipeInputSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0]?.message ?? 'Rezept prüfen.');
    return;
  }
  const recipe = normalizeRecipe(parsed.data);
  const updated = await pool.query<RecipeRow>(
    `UPDATE recipes SET title=$1, description=$2, servings=$3, prep_minutes=$4, tags=$5,
            ingredients=$6::jsonb, steps=$7::jsonb, nutrition=$8::jsonb, updated_at=now()
      WHERE id=$9
      RETURNING *, (SELECT display_name FROM users WHERE id = owner_id) AS owner_name,
                EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id = recipes.id AND f.user_id = $10) AS favorite`,
    [
      recipe.title,
      recipe.description,
      recipe.servings,
      recipe.prepMinutes,
      recipe.tags,
      JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.steps),
      JSON.stringify(recipe.nutrition),
      req.params.id,
      req.userId,
    ],
  );
  res.json({ recipe: mapRecipe(updated.rows[0]) });
});

recipesRouter.delete('/:id', async (req: AuthRequest, res) => {
  const existing = await pool.query<RecipeRow>('SELECT * FROM recipes WHERE id = $1', [req.params.id]);
  if (!existing.rowCount) {
    fail(res, 404, 'not-found', 'Rezept nicht gefunden.');
    return;
  }
  const access = await requireHousehold(existing.rows[0].household_id, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (access.role !== 'owner' && existing.rows[0].owner_id !== req.userId) {
    fail(res, 403, 'not-allowed', 'Nur der Ersteller oder der Haushalts-Besitzer kann das Rezept löschen.');
    return;
  }
  await pool.query('DELETE FROM recipes WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

recipesRouter.post('/:id/favorite', async (req: AuthRequest, res) => {
  const existing = await pool.query<{ household_id: string }>('SELECT household_id FROM recipes WHERE id = $1', [
    req.params.id,
  ]);
  if (!existing.rowCount) {
    fail(res, 404, 'not-found', 'Rezept nicht gefunden.');
    return;
  }
  const access = await requireHousehold(existing.rows[0].household_id, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const removed = await pool.query('DELETE FROM favorites WHERE user_id = $1 AND recipe_id = $2', [
    req.userId,
    req.params.id,
  ]);
  if (removed.rowCount) {
    res.json({ favorite: false });
    return;
  }
  await pool.query('INSERT INTO favorites (user_id, recipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
    req.userId,
    req.params.id,
  ]);
  res.json({ favorite: true });
});
