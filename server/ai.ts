import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db';
import { fail, requireHousehold, type AuthRequest } from './guards';
import {
  aiRecipeSchema,
  normalizeRecipe,
  recipeInputSchema,
  SLOTS,
  slotSchema,
  weekPlanSchema,
  type Slot,
} from './recipeSchema';
import { loadPlan } from './plans';

type Provider = 'deepseek' | 'mistral' | 'gemini';

type ProviderConfig = {
  name: Provider;
  apiKey: string;
  baseUrl: string;
  model: string;
};

const PROMPT_DIR = process.env.PROMPT_DIR?.trim() || join(process.cwd(), 'prompts');
const promptCache = new Map<string, string>();

function loadPrompt(name: string, fallback: string): string {
  const cached = promptCache.get(name);
  if (cached) return cached;
  try {
    const raw = readFileSync(join(PROMPT_DIR, `${name}.md`), 'utf8');
    promptCache.set(name, raw);
    return raw;
  } catch {
    promptCache.set(name, fallback);
    return fallback;
  }
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}

function isUsableKey(key: string | undefined): boolean {
  const t = key?.trim();
  if (!t || t.length < 16) return false;
  return !/your[_-]/i.test(t);
}

export function resolveProvider(): ProviderConfig | null {
  const preferred = (process.env.AI_ACTIVE_PROVIDER || 'deepseek').trim().toLowerCase();
  const candidates: ProviderConfig[] = [
    {
      name: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? '',
      baseUrl: (process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
      model: process.env.AI_DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
    },
    {
      name: 'mistral',
      apiKey: process.env.MISTRAL_API_KEY?.trim() ?? '',
      baseUrl: (process.env.MISTRAL_BASE_URL?.trim() || 'https://api.mistral.ai/v1').replace(/\/+$/, ''),
      model: process.env.AI_MISTRAL_MODEL?.trim() || 'mistral-large-latest',
    },
    {
      name: 'gemini',
      apiKey: process.env.GEMINI_API_KEY?.trim() ?? '',
      baseUrl: (process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
      model: process.env.AI_GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
    },
  ];
  const usable = candidates.filter((c) => isUsableKey(c.apiKey));
  if (!usable.length) return null;
  return usable.find((c) => c.name === preferred) ?? usable[0];
}

async function callOpenAiCompatible(cfg: ProviderConfig, prompt: string, timeoutMs: number): Promise<string> {
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: 'Du antwortest ausschließlich mit gültigem JSON. Kein Markdown, keine Kommentare.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`${cfg.name} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error(`${cfg.name}: leere Antwort`);
  return content;
}

async function callGemini(cfg: ProviderConfig, prompt: string, timeoutMs: number): Promise<string> {
  const resp = await fetch(`${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, responseMimeType: 'application/json', maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`gemini HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw new Error('gemini: leere Antwort');
  return text;
}

async function completeJson(prompt: string, timeoutMs = 120_000): Promise<string> {
  const cfg = resolveProvider();
  if (!cfg) throw new Error('Kein KI-Provider konfiguriert (DEEPSEEK_API_KEY fehlt).');
  return cfg.name === 'gemini'
    ? callGemini(cfg, prompt, timeoutMs)
    : callOpenAiCompatible(cfg, prompt, timeoutMs);
}

function parseJsonLoose(raw: string): unknown {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const slice = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  return JSON.parse(slice);
}

async function logRun(userId: number, kind: string, ok: boolean, startedAt: number, error?: string): Promise<void> {
  try {
    const cfg = resolveProvider();
    await pool.query(
      'INSERT INTO ai_runs (user_id, kind, provider, model, ok, latency_ms, error) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [userId, kind, cfg?.name ?? null, cfg?.model ?? null, ok, Date.now() - startedAt, error?.slice(0, 500) ?? null],
    );
  } catch {
    /* Logging darf den Request nie kippen */
  }
}

/** Fragt das Modell bis zu `attempts` mal, bis die Antwort das Zod-Schema erfüllt. */
async function generateValidated<T>(
  prompt: string,
  schema: z.ZodType<T>,
  attempts = 2,
  timeoutMs = 120_000,
): Promise<T> {
  let lastError = 'unbekannt';
  let currentPrompt = prompt;
  for (let i = 0; i < attempts; i++) {
    const raw = await completeJson(currentPrompt, timeoutMs);
    try {
      const parsed = schema.parse(parseJsonLoose(raw));
      return parsed;
    } catch (e) {
      lastError = e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400);
      currentPrompt = `${prompt}\n\nDEINE LETZTE ANTWORT WAR UNGÜLTIG:\n${lastError}\nAntworte erneut, diesmal exakt im verlangten JSON-Schema.`;
    }
  }
  throw new Error(`KI-Antwort passte nicht zum Schema: ${lastError}`);
}

export const aiRouter = Router();

aiRouter.get('/status', (_req, res) => {
  const cfg = resolveProvider();
  res.json({
    enabled: Boolean(cfg),
    provider: cfg?.name ?? 'none',
    model: cfg?.model ?? null,
  });
});

aiRouter.post('/recipe', async (req: AuthRequest, res) => {
  const started = Date.now();
  const body = req.body as { householdId?: string; idea?: string; servings?: number; constraints?: string };
  const access = await requireHousehold(body.householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const idea = (body.idea ?? '').trim();
  if (idea.length < 3) {
    fail(res, 400, 'invalid-input', 'Beschreib kurz, was gekocht werden soll.');
    return;
  }
  const servings = Math.min(12, Math.max(1, Math.round(body.servings ?? 2)));
  try {
    const prompt = fillTemplate(loadPrompt('recipe-draft', 'Erstelle ein Rezept als JSON.'), {
      idea,
      servings: String(servings),
      constraints: (body.constraints ?? '').trim() || 'keine besonderen Vorgaben',
    });
    const recipe = await generateValidated(prompt, aiRecipeSchema, 2, 90_000);
    await logRun(req.userId!, 'recipe-draft', true, started);
    res.json({ recipe: normalizeRecipe(recipe) });
  } catch (e) {
    await logRun(req.userId!, 'recipe-draft', false, started, e instanceof Error ? e.message : String(e));
    fail(res, 502, 'ai-failed', e instanceof Error ? e.message : 'KI-Antwort fehlgeschlagen.');
  }
});

aiRouter.post('/recipe/refine', async (req: AuthRequest, res) => {
  const started = Date.now();
  const body = req.body as { householdId?: string; recipe?: unknown; request?: string };
  const access = await requireHousehold(body.householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const parsed = recipeInputSchema.safeParse(body.recipe);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', 'Basisrezept fehlt oder ist unvollständig.');
    return;
  }
  const request = (body.request ?? '').trim();
  if (request.length < 2) {
    fail(res, 400, 'invalid-input', 'Was soll geändert werden?');
    return;
  }
  try {
    const prompt = fillTemplate(loadPrompt('recipe-refine', 'Überarbeite das Rezept als JSON.'), {
      recipeJson: JSON.stringify(parsed.data),
      request,
    });
    const recipe = await generateValidated(prompt, aiRecipeSchema, 2, 90_000);
    await logRun(req.userId!, 'recipe-refine', true, started);
    res.json({ recipe: normalizeRecipe(recipe) });
  } catch (e) {
    await logRun(req.userId!, 'recipe-refine', false, started, e instanceof Error ? e.message : String(e));
    fail(res, 502, 'ai-failed', e instanceof Error ? e.message : 'KI-Antwort fehlgeschlagen.');
  }
});

const WEEK_DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

aiRouter.post('/week', async (req: AuthRequest, res) => {
  const started = Date.now();
  const body = req.body as {
    householdId?: string;
    weekStart?: string;
    servings?: number;
    slots?: string[];
    constraints?: string;
    mode?: 'replace' | 'fill';
  };
  const access = await requireHousehold(body.householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const weekStart = String(body.weekStart ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    fail(res, 400, 'invalid-input', 'Wochenstart (YYYY-MM-DD) fehlt.');
    return;
  }
  const servings = Math.min(12, Math.max(1, Math.round(body.servings ?? 2)));
  const requestedSlots = (body.slots ?? ['abend']).filter((s): s is Slot => slotSchema.safeParse(s).success);
  const slots = requestedSlots.length ? requestedSlots : (['abend'] as Slot[]);
  const existing = await loadPlan(body.householdId!, weekStart);
  const existingEntries = (existing.entries as Array<{ title: string; dayIndex: number; slot: string }>) ?? [];
  const busy = body.mode === 'fill' ? new Set(existingEntries.map((e) => `${e.dayIndex}:${e.slot}`)) : new Set<string>();

  try {
    const prompt = fillTemplate(loadPrompt('week-plan', 'Plane eine Woche als JSON.'), {
      weekStart,
      servings: String(servings),
      slots: slots.map((s) => `${s} (${SLOTS.includes(s) ? s : ''})`).join(', '),
      constraints: (body.constraints ?? '').trim() || 'keine besonderen Vorgaben',
      existingTitles: existingEntries.map((e) => e.title).join(', ') || 'keine',
    });
    const plan = await generateValidated(prompt, weekPlanSchema, 2, 240_000);

    if (body.mode !== 'fill') {
      // Ersetzen: bestehende KI-Einträge der Woche entfernen, manuelle bleiben unangetastet.
      await pool.query(
        `DELETE FROM plan_entries e USING meal_plans p, recipes r
          WHERE e.plan_id = p.id AND p.household_id = $1 AND p.week_start = $2
            AND e.recipe_id = r.id AND r.source = 'ai'`,
        [body.householdId, weekStart],
      );
    }

    const planRow = await pool.query<{ id: string }>(
      `INSERT INTO meal_plans (household_id, week_start, created_by) VALUES ($1,$2,$3)
       ON CONFLICT (household_id, week_start) DO UPDATE SET household_id = EXCLUDED.household_id
       RETURNING id`,
      [body.householdId, weekStart, req.userId],
    );
    const planId = planRow.rows[0].id;
    let created = 0;
    for (const day of plan.days) {
      for (const meal of day.meals) {
        if (busy.has(`${day.dayIndex}:${meal.slot}`)) continue;
        const recipe = normalizeRecipe({ ...meal.recipe, servings: meal.recipe.servings ?? servings });
        const inserted = await pool.query<{ id: string }>(
          `INSERT INTO recipes (household_id, owner_id, title, description, servings, prep_minutes, tags, source, ingredients, steps, nutrition)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'ai',$8::jsonb,$9::jsonb,$10::jsonb)
           RETURNING id`,
          [
            body.householdId,
            req.userId,
            recipe.title,
            recipe.description,
            recipe.servings,
            recipe.prepMinutes,
            recipe.tags,
            JSON.stringify(recipe.ingredients),
            JSON.stringify(recipe.steps),
            JSON.stringify(recipe.nutrition),
          ],
        );
        await pool.query(
          `INSERT INTO plan_entries (plan_id, day_index, slot, recipe_id, servings)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (plan_id, day_index, slot)
           DO UPDATE SET recipe_id = EXCLUDED.recipe_id, custom_title = NULL, servings = EXCLUDED.servings`,
          [planId, day.dayIndex, meal.slot, inserted.rows[0].id, servings],
        );
        created += 1;
      }
    }
    await logRun(req.userId!, 'week-plan', true, started);
    res.json({ plan: await loadPlan(body.householdId!, weekStart), created, notes: plan.notes, days: WEEK_DAYS });
  } catch (e) {
    await logRun(req.userId!, 'week-plan', false, started, e instanceof Error ? e.message : String(e));
    fail(res, 502, 'ai-failed', e instanceof Error ? e.message : 'KI-Antwort fehlgeschlagen.');
  }
});
