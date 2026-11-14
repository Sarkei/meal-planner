import sharp from 'sharp';
import { pool } from './db';

/**
 * Rezeptbilder: gezeichnete Illustration im Comic-Stil, erzeugt aus den echten Zutaten des Rezepts.
 * Bewusst kein Stockfoto und keine freie Bildidee — der Prompt nennt nur, was im Rezept steht.
 */

const WIDTH = 960;
const HEIGHT = 720;
/** Pollinations setzt ein Wasserzeichen in die untere rechte Ecke; der Streifen wird abgeschnitten. */
const WATERMARK_STRIP = 46;

/**
 * Bildmodelle verstehen kurze, englische Beschreibungen am besten. Deshalb schreibt die Text-KI
 * zuerst eine knappe Bildbeschreibung, die ausschließlich die echten Zutaten nennt.
 */
const STYLE = 'flat vector illustration, bold clean outlines, soft cel shading, warm colors, single plate, plain light background, no text, no watermark, no extra food';

const DEEPSEEK_URL = process.env.DEEPSEEK_BASE_URL?.replace(/\/v1\/?$/, '') || 'https://api.deepseek.com';
const DEEPSEEK_CHAT = `${DEEPSEEK_URL.replace(/\/$/, '')}/chat/completions`;
const DEEPSEEK_MODEL = process.env.AI_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat';

async function describeDish(recipe: ImageRecipeInput): Promise<string | null> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  const ingredients = (recipe.ingredients ?? []).map((i) => (i.name ?? '').trim()).filter(Boolean).slice(0, 8);
  try {
    const res = await fetch(DEEPSEEK_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        temperature: 0.2,
        max_tokens: 60,
        messages: [
          {
            role: 'system',
            content:
              'You describe food for illustrations. Answer with ONE English line, max 18 words, no quotes, no dish name, no cooking verbs.',
          },
          {
            role: 'user',
            content: `Dish: ${recipe.title}. Ingredients: ${ingredients.join(', ') || 'unknown'}. Describe only what is visible on the plate, using only these ingredients.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const line = data.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
    return line && line.length > 3 ? line.slice(0, 140) : null;
  } catch {
    return null;
  }
}

export interface ImageRecipeInput {
  id: string;
  title: string;
  description?: string | null;
  diets?: string[];
  cuisines?: string[];
  ingredients?: Array<{ name?: string; amount?: number | null; unit?: string | null }>;
}

/** Prompt aus Rezeptdaten: nur echte Zutaten, keine Erfindungen. */
export function buildImagePrompt(recipe: ImageRecipeInput, description?: string | null): string {
  const ingredients = (recipe.ingredients ?? [])
    .map((i) => (i.name ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);

  // Kurz halten: lange Prompts verwässern und das Modell erfindet Beilagen
  const subject = description?.trim()
    ? description.trim()
    : `a plate of ${recipe.title.trim().toLowerCase()}${ingredients.length ? ` with ${ingredients.join(', ')}` : ''}`;

  return `${STYLE}, ${subject}`.slice(0, 300);
}

/** Bild bei Pollinations holen (kostenlos, kein Schlüssel). */
export async function fetchIllustration(prompt: string, seed: number): Promise<Buffer> {
  const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}`);
  url.searchParams.set('width', String(WIDTH));
  url.searchParams.set('height', String(HEIGHT));
  url.searchParams.set('model', 'flux');
  url.searchParams.set('seed', String(seed));
  url.searchParams.set('enhance', 'false');

  const res = await fetch(url, { signal: AbortSignal.timeout(150_000) });
  if (!res.ok) throw new Error(`Bilddienst ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`Unerwartete Antwort: ${type}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Wasserzeichenstreifen abschneiden, auf Kartenformat bringen und als Data-URL zurückgeben. */
export async function prepareImage(raw: Buffer): Promise<string> {
  const meta = await sharp(raw).metadata();
  const width = meta.width ?? WIDTH;
  const height = meta.height ?? HEIGHT;
  const cropHeight = Math.max(200, height - Math.round((WATERMARK_STRIP / HEIGHT) * height));

  const jpeg = await sharp(raw)
    .extract({ left: 0, top: 0, width, height: cropHeight })
    .resize(768, 576, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/** Job in die Warteschlange legen (idempotent: pro Rezept nur ein offener Job). */
export async function enqueueImageJob(recipeId: string, force = false) {
  if (!force) {
    const open = await pool.query(
      "SELECT 1 FROM image_jobs WHERE recipe_id = $1 AND status IN ('pending','running')",
      [recipeId],
    );
    if (open.rowCount) return;
  }
  await pool.query(
    `INSERT INTO image_jobs (recipe_id, status) VALUES ($1, 'pending')
     ON CONFLICT (recipe_id) DO UPDATE SET status = 'pending', attempts = 0, error = NULL, updated_at = now()`,
    [recipeId],
  );
}

async function generateForJob(recipeId: string): Promise<string | null> {
  const res = await pool.query<{
    id: string;
    title: string;
    description: string | null;
    ingredients: Array<{ name?: string }> | null;
    diets: string[] | null;
    cuisines: string[] | null;
  }>('SELECT id, title, description, ingredients, diets, cuisines FROM recipes WHERE id = $1', [recipeId]);
  const recipe = res.rows[0];
  if (!recipe) return null;

  const input: ImageRecipeInput = {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    diets: recipe.diets ?? [],
    cuisines: recipe.cuisines ?? [],
    ingredients: recipe.ingredients ?? [],
  };
  const description = await describeDish(input);
  const prompt = buildImagePrompt(input, description);
  // Stabiler Seed pro Rezept: gleiches Rezept → ähnliche Illustration
  const seed = Number.parseInt(recipe.id.replace(/\D/g, '').slice(0, 8) || '1', 10) || 1;
  const raw = await fetchIllustration(prompt, seed);
  return prepareImage(raw);
}

/** Einmaliger Lauf: nimmt den ältesten offenen Job. */
export async function processImageQueue(): Promise<boolean> {
  const job = await pool.query<{ id: number; recipe_id: string; attempts: number }>(
    `SELECT id, recipe_id, attempts FROM image_jobs
      WHERE status = 'pending' AND attempts < 3
      ORDER BY id LIMIT 1`,
  );
  if (!job.rowCount) return false;
  const { id, recipe_id: recipeId, attempts } = job.rows[0];

  await pool.query("UPDATE image_jobs SET status = 'running', updated_at = now() WHERE id = $1", [id]);
  try {
    const dataUrl = await generateForJob(recipeId);
    if (!dataUrl) throw new Error('Rezept nicht gefunden');
    await pool.query('UPDATE recipes SET image_url = $2, updated_at = now() WHERE id = $1', [recipeId, dataUrl]);
    await pool.query("UPDATE image_jobs SET status = 'done', error = NULL, updated_at = now() WHERE id = $1", [id]);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'unbekannt';
    await pool.query(
      `UPDATE image_jobs SET status = CASE WHEN $2 >= 2 THEN 'failed' ELSE 'pending' END,
              attempts = $2 + 1, error = $3, updated_at = now() WHERE id = $1`,
      [id, attempts, message],
    );
  }
  return true;
}

/** Hintergrund-Arbeiter: läuft dauerhaft im Serverprozess, ein Bild nach dem anderen. */
export function startImageWorker() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      let more = true;
      while (more) more = await processImageQueue();
    } catch (error) {
      console.error('Bild-Arbeiter', error);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 15_000);
  timer.unref?.();
  void tick();
  return timer;
}
