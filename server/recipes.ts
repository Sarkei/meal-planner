import { Router } from 'express';
import { pool } from './db';
import { fail, type AuthRequest } from './guards';
import { normalizeRecipe, recipeInputSchema } from './recipeSchema';

export const recipesRouter = Router();

/**
 * Rezeptbibliothek: alle Rezepte sind für alle angemeldeten Nutzer sichtbar.
 * Gelöscht wird nie — „Löschen" archiviert (status='archived'), die Zeile bleibt in der Datenbank.
 */
type RecipeRow = {
  id: string;
  household_id: string | null;
  owner_id: number | null;
  title: string;
  description: string;
  servings: number;
  prep_minutes: number | null;
  total_minutes: number | null;
  difficulty: string | null;
  image_url: string | null;
  tags: string[];
  source: string;
  status: string;
  ingredients: unknown;
  steps: unknown;
  nutrition: unknown;
  created_at: string;
  updated_at: string;
  author_name: string | null;
  favorite: boolean;
  favorite_count: number;
  rating_avg: string | null;
  rating_count: number;
  my_rating: number | null;
  comment_count: number;
  full_count?: number;
};

function mapRecipe(row: RecipeRow) {
  return {
    id: row.id,
    householdId: row.household_id,
    authorId: row.owner_id,
    authorName: row.author_name,
    title: row.title,
    description: row.description,
    servings: row.servings,
    prepMinutes: row.prep_minutes,
    totalMinutes: row.total_minutes,
    difficulty: row.difficulty,
    imageUrl: row.image_url,
    tags: row.tags ?? [],
    source: row.source,
    status: row.status,
    ingredients: row.ingredients ?? [],
    steps: row.steps ?? [],
    nutrition: row.nutrition ?? {},
    favorite: Boolean(row.favorite),
    favoriteCount: Number(row.favorite_count ?? 0),
    rating: row.rating_avg != null ? Math.round(Number(row.rating_avg) * 10) / 10 : null,
    ratingCount: Number(row.rating_count ?? 0),
    myRating: row.my_rating != null ? Number(row.my_rating) : null,
    commentCount: Number(row.comment_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_BASE = `
  SELECT r.*, u.display_name AS author_name,
         EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id = r.id AND f.user_id = $1) AS favorite,
         (SELECT count(*) FROM favorites f2 WHERE f2.recipe_id = r.id)::int AS favorite_count,
         (SELECT avg(stars)::numeric(4,2) FROM recipe_ratings rt WHERE rt.recipe_id = r.id) AS rating_avg,
         (SELECT count(*) FROM recipe_ratings rt2 WHERE rt2.recipe_id = r.id)::int AS rating_count,
         (SELECT stars FROM recipe_ratings rt3 WHERE rt3.recipe_id = r.id AND rt3.user_id = $1) AS my_rating,
         (SELECT count(*) FROM recipe_comments c WHERE c.recipe_id = r.id)::int AS comment_count,
         count(*) OVER ()::int AS full_count
    FROM recipes r
    LEFT JOIN users u ON u.id = r.owner_id
`;

type Filters = {
  q: string;
  tags: string[];
  source: string;
  maxMinutes: number | null;
  maxKcal: number | null;
  minProtein: number | null;
  sort: string;
  favoritesOnly: boolean;
  mineOnly: boolean;
  authorId: number | null;
  includeArchived: boolean;
};

function parseFilters(query: Record<string, unknown>): Filters {
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    q: String(query.q ?? '').trim(),
    tags: String(query.tags ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8),
    source: ['ai', 'manual', 'copied'].includes(String(query.source)) ? String(query.source) : '',
    maxMinutes: num(query.maxMinutes),
    maxKcal: num(query.maxKcal),
    minProtein: num(query.minProtein),
    sort: ['newest', 'rating', 'popular', 'quickest', 'title'].includes(String(query.sort))
      ? String(query.sort)
      : 'newest',
    favoritesOnly: query.favorites === '1',
    mineOnly: query.mine === '1',
    authorId: num(query.authorId),
    includeArchived: query.archived === '1',
  };
}

function buildWhere(filters: Filters, userId: number, params: unknown[]): string {
  const clauses: string[] = [];
  if (filters.includeArchived) {
    clauses.push(`(r.status <> 'archived' OR r.owner_id = $${params.push(userId)})`);
  } else {
    clauses.push(`r.status = 'active'`);
  }
  if (filters.favoritesOnly) {
    clauses.push(`EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id = r.id AND f.user_id = $${params.push(userId)})`);
  }
  if (filters.mineOnly) clauses.push(`r.owner_id = $${params.push(userId)}`);
  if (filters.authorId) clauses.push(`r.owner_id = $${params.push(filters.authorId)}`);
  if (filters.source) clauses.push(`r.source = $${params.push(filters.source)}`);
  if (filters.q) {
    const like = `%${filters.q}%`;
    const p = params.push(like);
    clauses.push(
      `(r.title ILIKE $${p} OR r.description ILIKE $${p} OR u.display_name ILIKE $${p} OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(r.ingredients) ing WHERE ing->>'name' ILIKE $${p}))`,
    );
  }
  if (filters.tags.length) {
    clauses.push(`r.tags && $${params.push(filters.tags)}::text[]`);
  }
  if (filters.maxMinutes != null) {
    clauses.push(`r.prep_minutes IS NOT NULL AND r.prep_minutes <= $${params.push(filters.maxMinutes)}`);
  }
  if (filters.maxKcal != null) {
    clauses.push(
      `(r.nutrition->>'kcal') ~ '^[0-9]+(\\.[0-9]+)?$' AND (r.nutrition->>'kcal')::numeric <= $${params.push(filters.maxKcal)}`,
    );
  }
  if (filters.minProtein != null) {
    clauses.push(
      `(r.nutrition->>'protein') ~ '^[0-9]+(\\.[0-9]+)?$' AND (r.nutrition->>'protein')::numeric >= $${params.push(filters.minProtein)}`,
    );
  }
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

function buildOrder(sort: string): string {
  switch (sort) {
    case 'rating':
      return 'ORDER BY rating_avg DESC NULLS LAST, rating_count DESC, r.created_at DESC';
    case 'popular':
      return 'ORDER BY favorite_count DESC, r.created_at DESC';
    case 'quickest':
      return 'ORDER BY r.prep_minutes ASC NULLS LAST, r.created_at DESC';
    case 'title':
      return 'ORDER BY lower(r.title) ASC';
    default:
      return 'ORDER BY r.created_at DESC';
  }
}

/** Aktiver Haushalt: aus dem Request, sonst der erste des Nutzers. */
export async function resolveHousehold(requested: string, userId: number): Promise<string | null> {
  if (requested && /^[0-9a-f-]{36}$/i.test(requested)) {
    const member = await pool.query('SELECT 1 FROM household_members WHERE household_id = $1 AND user_id = $2', [
      requested,
      userId,
    ]);
    if (member.rowCount) return requested;
  }
  const first = await pool.query<{ id: string }>(
    'SELECT household_id AS id FROM household_members WHERE user_id = $1 ORDER BY joined_at ASC LIMIT 1',
    [userId],
  );
  return first.rows[0]?.id ?? null;
}

recipesRouter.get('/', async (req: AuthRequest, res) => {
  const filters = parseFilters(req.query as Record<string, unknown>);
  const limit = Math.min(60, Math.max(1, Number(req.query.limit ?? 24) || 24));
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  const params: unknown[] = [req.userId];
  try {
    const where = buildWhere(filters, req.userId!, params);
    const rows = await pool.query<RecipeRow>(
      `${SELECT_BASE} ${where} ${buildOrder(filters.sort)} LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const total = rows.rows[0]?.full_count ?? (offset > 0 ? offset + rows.rows.length : 0);
    res.json({ recipes: rows.rows.map(mapRecipe), total, limit, offset });
  } catch (e) {
    console.error('[recipes/list]', e);
    fail(res, 500, 'list-failed', 'Rezepte konnten nicht geladen werden.');
  }
});

recipesRouter.get('/facets', async (_req: AuthRequest, res) => {
  const tags = await pool.query<{ tag: string; count: number }>(
    `SELECT tag, count(*)::int AS count FROM recipes r, unnest(r.tags) AS tag
      WHERE r.status = 'active' GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 40`,
  );
  const authors = await pool.query<{ id: number; name: string; count: number }>(
    `SELECT u.id, u.display_name AS name, count(*)::int AS count
       FROM recipes r JOIN users u ON u.id = r.owner_id
      WHERE r.status = 'active' GROUP BY u.id, u.display_name ORDER BY count DESC LIMIT 50`,
  );
  const totals = await pool.query<{ recipes: number; favorites: number; ratings: number }>(
    `SELECT (SELECT count(*) FROM recipes WHERE status = 'active')::int AS recipes,
            (SELECT count(*) FROM favorites f JOIN recipes rf ON rf.id = f.recipe_id WHERE rf.status = 'active')::int AS favorites,
            (SELECT count(*) FROM recipe_ratings rt JOIN recipes rr ON rr.id = rt.recipe_id WHERE rr.status = 'active')::int AS ratings`,
  );
  res.json({ tags: tags.rows, authors: authors.rows, totals: totals.rows[0] });
});

recipesRouter.get('/favorites', async (req: AuthRequest, res) => {
  const rows = await pool.query<RecipeRow>(
    `${SELECT_BASE}
      JOIN favorites fav ON fav.recipe_id = r.id AND fav.user_id = $1
     WHERE r.status = 'active'
     ORDER BY fav.created_at DESC LIMIT 200`,
    [req.userId],
  );
  res.json({ recipes: rows.rows.map(mapRecipe) });
});

recipesRouter.get('/:id', async (req: AuthRequest, res) => {
  const r = await pool.query<RecipeRow>(`${SELECT_BASE} WHERE r.id = $2`, [req.userId, req.params.id]);
  if (!r.rowCount) {
    fail(res, 404, 'not-found', 'Rezept nicht gefunden.');
    return;
  }
  res.json({ recipe: mapRecipe(r.rows[0]) });
});

recipesRouter.post('/', async (req: AuthRequest, res) => {
  const body = req.body as Record<string, unknown>;
  const parsed = recipeInputSchema.safeParse(body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0]?.message ?? 'Rezept prüfen.');
    return;
  }
  // Ohne Haushalt landet das Rezept trotzdem in der Sammlung (household_id bleibt leer).
  const householdId = await resolveHousehold(String(body.householdId ?? ''), req.userId!);
  const recipe = normalizeRecipe(parsed.data);
  const source = ['manual', 'ai', 'copied'].includes(String(body.source)) ? String(body.source) : 'manual';
  const created = await pool.query<{ id: string }>(
    `INSERT INTO recipes (household_id, owner_id, title, description, servings, prep_minutes, total_minutes, difficulty, image_url, tags, source, ingredients, steps, nutrition)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb)
     RETURNING id`,
    [
      householdId,
      req.userId,
      recipe.title,
      recipe.description,
      recipe.servings,
      recipe.prepMinutes,
      recipe.totalMinutes,
      recipe.difficulty,
      recipe.imageUrl,
      recipe.tags,
      source,
      JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.steps),
      JSON.stringify(recipe.nutrition),
    ],
  );
  const recipeId = created.rows[0].id;
  if (body.favorite === true) {
    await pool.query('INSERT INTO favorites (user_id, recipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
      req.userId,
      recipeId,
    ]);
  }
  const fresh = await pool.query<RecipeRow>(`${SELECT_BASE} WHERE r.id = $2`, [req.userId, recipeId]);
  res.status(201).json({ recipe: mapRecipe(fresh.rows[0]) });
});

recipesRouter.patch('/:id', async (req: AuthRequest, res) => {
  const existing = await pool.query<{ owner_id: number | null }>('SELECT owner_id FROM recipes WHERE id = $1', [
    req.params.id,
  ]);
  if (!existing.rowCount) {
    fail(res, 404, 'not-found', 'Rezept nicht gefunden.');
    return;
  }
  if (existing.rows[0].owner_id !== req.userId) {
    fail(res, 403, 'not-author', 'Nur der Ersteller kann das Rezept ändern.');
    return;
  }
  const parsed = recipeInputSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0]?.message ?? 'Rezept prüfen.');
    return;
  }
  const recipe = normalizeRecipe(parsed.data);
  await pool.query(
    `UPDATE recipes SET title=$1, description=$2, servings=$3, prep_minutes=$4, tags=$5,
            ingredients=$6::jsonb, steps=$7::jsonb, nutrition=$8::jsonb,
            total_minutes=$9, difficulty=$10, image_url=$11, updated_at=now()
      WHERE id=$12`,
    [
      recipe.title,
      recipe.description,
      recipe.servings,
      recipe.prepMinutes,
      recipe.tags,
      JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.steps),
      JSON.stringify(recipe.nutrition),
      recipe.totalMinutes,
      recipe.difficulty,
      recipe.imageUrl,
      req.params.id,
    ],
  );
  const fresh = await pool.query<RecipeRow>(`${SELECT_BASE} WHERE r.id = $2`, [req.userId, req.params.id]);
  res.json({ recipe: mapRecipe(fresh.rows[0]) });
});

/** Es wird nichts gelöscht: „Löschen" archiviert das Rezept, die Zeile bleibt erhalten. */
recipesRouter.delete('/:id', async (req: AuthRequest, res) => {
  const existing = await pool.query<{ owner_id: number | null }>('SELECT owner_id FROM recipes WHERE id = $1', [
    req.params.id,
  ]);
  if (!existing.rowCount) {
    fail(res, 404, 'not-found', 'Rezept nicht gefunden.');
    return;
  }
  if (existing.rows[0].owner_id !== req.userId) {
    fail(res, 403, 'not-author', 'Nur der Ersteller kann das Rezept archivieren.');
    return;
  }
  await pool.query("UPDATE recipes SET status = 'archived', archived_at = now() WHERE id = $1", [req.params.id]);
  res.json({ ok: true, archived: true });
});

recipesRouter.post('/:id/restore', async (req: AuthRequest, res) => {
  const r = await pool.query(
    "UPDATE recipes SET status = 'active', archived_at = NULL WHERE id = $1 AND owner_id = $2 RETURNING id",
    [req.params.id, req.userId],
  );
  if (!r.rowCount) {
    fail(res, 404, 'not-found', 'Nicht gefunden oder kein Zugriff.');
    return;
  }
  res.json({ ok: true });
});

recipesRouter.post('/:id/copy', async (req: AuthRequest, res) => {
  const source = await pool.query<RecipeRow>('SELECT * FROM recipes WHERE id = $1', [req.params.id]);
  if (!source.rowCount) {
    fail(res, 404, 'not-found', 'Rezept nicht gefunden.');
    return;
  }
  const householdId = await resolveHousehold(
    String((req.body as { householdId?: string }).householdId ?? ''),
    req.userId!,
  );
  const row = source.rows[0];
  const created = await pool.query<{ id: string }>(
    `INSERT INTO recipes (household_id, owner_id, title, description, servings, prep_minutes, total_minutes, difficulty, image_url, tags, source, ingredients, steps, nutrition)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'copied',$11::jsonb,$12::jsonb,$13::jsonb)
     RETURNING id`,
    [
      householdId,
      req.userId,
      row.title,
      row.description,
      row.servings,
      row.prep_minutes,
      row.total_minutes,
      row.difficulty,
      row.image_url,
      row.tags,
      JSON.stringify(row.ingredients),
      JSON.stringify(row.steps),
      JSON.stringify(row.nutrition),
    ],
  );
  await pool.query('INSERT INTO favorites (user_id, recipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
    req.userId,
    created.rows[0].id,
  ]);
  const fresh = await pool.query<RecipeRow>(`${SELECT_BASE} WHERE r.id = $2`, [req.userId, created.rows[0].id]);
  res.status(201).json({ recipe: mapRecipe(fresh.rows[0]) });
});

recipesRouter.post('/:id/favorite', async (req: AuthRequest, res) => {
  const exists = await pool.query('SELECT 1 FROM recipes WHERE id = $1', [req.params.id]);
  if (!exists.rowCount) {
    fail(res, 404, 'not-found', 'Rezept nicht gefunden.');
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

recipesRouter.post('/:id/rating', async (req: AuthRequest, res) => {
  const stars = Number((req.body as { stars?: number }).stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    fail(res, 400, 'invalid-input', 'Bewertung zwischen 1 und 5 Sternen.');
    return;
  }
  const exists = await pool.query('SELECT 1 FROM recipes WHERE id = $1', [req.params.id]);
  if (!exists.rowCount) {
    fail(res, 404, 'not-found', 'Rezept nicht gefunden.');
    return;
  }
  await pool.query(
    `INSERT INTO recipe_ratings (user_id, recipe_id, stars) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, recipe_id) DO UPDATE SET stars = EXCLUDED.stars, updated_at = now()`,
    [req.userId, req.params.id, stars],
  );
  const agg = await pool.query<{ avg: string | null; count: number }>(
    'SELECT avg(stars)::numeric(4,2) AS avg, count(*)::int AS count FROM recipe_ratings WHERE recipe_id = $1',
    [req.params.id],
  );
  res.json({
    myRating: stars,
    rating: agg.rows[0].avg != null ? Number(agg.rows[0].avg) : null,
    ratingCount: agg.rows[0].count,
  });
});

recipesRouter.delete('/:id/rating', async (req: AuthRequest, res) => {
  await pool.query('DELETE FROM recipe_ratings WHERE user_id = $1 AND recipe_id = $2', [req.userId, req.params.id]);
  res.json({ ok: true });
});

recipesRouter.get('/:id/comments', async (req: AuthRequest, res) => {
  const rows = await pool.query<{
    id: string;
    body: string;
    author: string | null;
    user_id: number | null;
    created_at: string;
  }>(
    `SELECT c.id, c.body, u.display_name AS author, c.user_id, c.created_at
       FROM recipe_comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.recipe_id = $1 ORDER BY c.created_at DESC LIMIT 200`,
    [req.params.id],
  );
  res.json({
    comments: rows.rows.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.author ?? 'Unbekannt',
      userId: c.user_id,
      createdAt: c.created_at,
      mine: c.user_id === req.userId,
    })),
  });
});

recipesRouter.post('/:id/comments', async (req: AuthRequest, res) => {
  const body = String((req.body as { body?: string }).body ?? '').trim();
  if (body.length < 2 || body.length > 2000) {
    fail(res, 400, 'invalid-input', 'Kommentar muss zwischen 2 und 2000 Zeichen haben.');
    return;
  }
  const exists = await pool.query('SELECT 1 FROM recipes WHERE id = $1', [req.params.id]);
  if (!exists.rowCount) {
    fail(res, 404, 'not-found', 'Rezept nicht gefunden.');
    return;
  }
  const created = await pool.query<{ id: string }>(
    'INSERT INTO recipe_comments (recipe_id, user_id, body) VALUES ($1,$2,$3) RETURNING id',
    [req.params.id, req.userId, body],
  );
  res.status(201).json({ id: created.rows[0].id });
});

recipesRouter.delete('/:id/comments/:commentId', async (req: AuthRequest, res) => {
  const deleted = await pool.query('DELETE FROM recipe_comments WHERE id = $1 AND user_id = $2 RETURNING id', [
    req.params.commentId,
    req.userId,
  ]);
  if (!deleted.rowCount) {
    fail(res, 403, 'not-allowed', 'Nur der eigene Kommentar kann gelöscht werden.');
    return;
  }
  res.json({ ok: true });
});
