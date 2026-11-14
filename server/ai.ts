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
import { loadHouseholdPreferences, loadSettings } from './auth';
import { loadHouseholdPreferences as loadHouseholdRaw } from './householdPrefs';
import { broadcast } from './events';
import { resolveHousehold } from './recipes';
import { prebuildNextWeek } from './scheduler';

type Provider = 'deepseek' | 'mistral' | 'gemini';

/** Zufälliges Wochenmotto — verhindert, dass die KI jede Woche dieselben Gerichte vorschlägt. */
const WEEK_MOTTOS = [
  'Hausmannskost, wie bei Oma',
  'mediterran (italienisch, griechisch, spanisch)',
  'deftig mit Ofengemüse',
  'asiatisch angehaucht, aber mit Zutaten aus dem Supermarkt',
  'schnelle Pfannengerichte unter 30 Minuten',
  'Eintöpfe und Aufläufe',
  'Familiengerichte mit Hackfleisch oder Geflügel',
  'Fisch und vegetarische Ofengerichte',
  'Resteküche: wenige Zutaten, die sich wiederverwenden lassen',
];

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

async function callOpenAiCompatible(
  cfg: ProviderConfig,
  prompt: string,
  timeoutMs: number,
  temperature = 0.5,
): Promise<string> {
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: 'Du antwortest ausschließlich mit gültigem JSON. Kein Markdown, keine Kommentare.' },
        { role: 'user', content: prompt },
      ],
      temperature,
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

async function callGemini(cfg: ProviderConfig, prompt: string, timeoutMs: number, temperature = 0.5): Promise<string> {
  const resp = await fetch(`${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, responseMimeType: 'application/json', maxOutputTokens: 8192 },
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

export async function completeAiJson(prompt: string, timeoutMs = 120_000, temperature = 0.5): Promise<string> {
  const cfg = resolveProvider();
  if (!cfg) throw new Error('Kein KI-Provider konfiguriert (DEEPSEEK_API_KEY fehlt).');
  return cfg.name === 'gemini'
    ? callGemini(cfg, prompt, timeoutMs, temperature)
    : callOpenAiCompatible(cfg, prompt, timeoutMs, temperature);
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
  temperature = 0.5,
): Promise<T> {
  let lastError = 'unbekannt';
  let currentPrompt = prompt;
  for (let i = 0; i < attempts; i++) {
    // Beim zweiten Versuch etwas kühler, damit die Korrektur nicht wieder ausfranst
    const raw = await completeAiJson(currentPrompt, timeoutMs, i === 0 ? temperature : Math.min(temperature, 0.4));
    try {
      const parsed = schema.parse(parseJsonLoose(raw));
      return parsed;
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400);
      lastError = `${msg} || Anfang: ${raw.slice(0, 240)} || Ende: ${raw.slice(-160)}`;
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

/**
 * Freitext-Antwort ohne JSON-Zwang — für den Rezept-Chat.
 * Bekommt echten Gesprächsverlauf, damit Rückfragen funktionieren.
 */
async function callChatText(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  temperature = 0.4,
  maxTokens = 700,
  timeoutMs = 45_000,
): Promise<string> {
  const cfg = resolveProvider();
  if (!cfg) throw new Error('Kein KI-Provider konfiguriert (DEEPSEEK_API_KEY fehlt).');
  if (cfg.name === 'gemini') {
    const transcript = messages
      .map((m) => `${m.role === 'system' ? 'ANWEISUNG' : m.role === 'user' ? 'FRAGE' : 'ANTWORT'}: ${m.content}`)
      .join('\n\n');
    return callGemini(cfg, transcript, timeoutMs, temperature);
  }
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`${cfg.name} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error(`${cfg.name}: leere Antwort`);
  return content.trim();
}

const CHAT_SYSTEM_PROMPT = `Du bist Koch-Assistent in einer Rezept-App und beantwortest Fragen zu genau einem Rezept.

REGELN
1. Antworte auf Deutsch, in der du-Form, kurz und konkret: 2 bis 5 Sätze, mit Mengen und Einheiten.
2. Beziehe dich nur auf das Rezept und das Kochen dazu. Bei Fragen zu anderen Themen antworte in einem Satz, dass du nur zu diesem Rezept hilfst.
3. Fragt jemand nach einem Ersatz: nenne konkret das Ersatzprodukt mit Menge und was sich dadurch ändert (Geschmack, Konsistenz, Garzeit, grob die Nährwerte).
4. Bei Umrechnungen (Brühe-Pulver auf Wasser, Gewürz-Ersatz, Portionsgrößen) nenne das Verhältnis und die konkrete Menge für dieses Rezept.
5. Erfinde nichts: was nicht in der Zutatenliste steht, ist nicht drin. Bei Allergiefragen verweise auf die Zutatenliste, statt eine Garantie zu geben.
6. Kein Markdown, keine Tabellen, keine Aufzählungszeichen, kein JSON — nur Fließtext.`;

/**
 * Rezept-Chat: beantwortet Fragen zu einem Rezept.
 * Bewusst zustandslos — der Verlauf kommt vom Client und wird nicht gespeichert.
 */
aiRouter.post('/recipe-chat', async (req: AuthRequest, res) => {
  const body = req.body as {
    recipe?: {
      title?: string;
      description?: string;
      servings?: number;
      ingredients?: Array<{ name?: string; amount?: number | null; unit?: string }>;
      steps?: unknown;
      nutrition?: Record<string, number>;
      tags?: string[];
    };
    history?: Array<{ role?: string; content?: string }>;
    question?: string;
  };

  const question = String(body.question ?? '').trim().slice(0, 600);
  if (question.length < 2) {
    fail(res, 400, 'invalid-input', 'Bitte eine Frage eingeben.');
    return;
  }
  const r = body.recipe ?? {};
  const ingredients = (r.ingredients ?? [])
    .map((i) => `${i.amount != null ? `${i.amount} ${String(i.unit ?? '').trim()}` : ''} ${String(i.name ?? '').trim()}`.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 40);
  if (!ingredients.length) {
    fail(res, 400, 'invalid-input', 'Zu diesem Rezept fehlen die Zutaten.');
    return;
  }
  const steps = (Array.isArray(r.steps) ? r.steps : [])
    .map((s, i) => `${i + 1}. ${typeof s === 'string' ? s : String((s as { text?: string })?.text ?? '')}`)
    .slice(0, 20)
    .join('\n');
  const nutrition = r.nutrition
    ? `pro Portion: ${r.nutrition.kcal ?? '?'} kcal, ${r.nutrition.protein ?? '?'} g Protein, ${r.nutrition.carbs ?? '?'} g Kohlenhydrate, ${r.nutrition.fat ?? '?'} g Fett`
    : 'unbekannt';

  const recipeText = [
    `REZEPT: ${String(r.title ?? 'ohne Titel')}`,
    r.description ? `Beschreibung: ${String(r.description)}` : '',
    `Portionen: ${Number(r.servings ?? 2)}`,
    `Nährwerte ${nutrition}`,
    'ZUTATEN:',
    ...ingredients.map((line) => `- ${line}`),
    'ZUBEREITUNG:',
    steps,
  ]
    .filter(Boolean)
    .join('\n');

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .slice(-8)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, 1500) }));

  const started = Date.now();
  try {
    const answer = await callChatText(
      [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        { role: 'user', content: recipeText },
        ...history,
        { role: 'user', content: question },
      ],
      0.4,
      700,
      45_000,
    );
    await logRun(req.userId!, 'recipe-chat', true, started);
    res.json({ answer });
  } catch (e) {
    await logRun(req.userId!, 'recipe-chat', false, started, e instanceof Error ? e.message : String(e));
    fail(res, 502, 'ai-failed', e instanceof Error ? e.message : 'Antwort fehlgeschlagen.');
  }
});

const nutritionEstimateSchema = z.object({
  kcal: z.number().nonnegative().max(20000),
  protein: z.number().nonnegative().max(2000),
  carbs: z.number().nonnegative().max(3000),
  fat: z.number().nonnegative().max(2000),
});

/**
 * Live-Schätzung der Nährwerte pro Portion aus der Zutatenliste.
 * Wird vom Rezept-Editor bei jeder Änderung (entprellt) aufgerufen.
 */
aiRouter.post('/nutrition', async (req: AuthRequest, res) => {
  const started = Date.now();
  const body = req.body as {
    servings?: number;
    ingredients?: Array<{ name?: string; amount?: number | null; unit?: string }>;
  };
  const ingredients = (body.ingredients ?? [])
    .map((i) => ({
      name: String(i.name ?? '').trim(),
      amount: typeof i.amount === 'number' && Number.isFinite(i.amount) ? i.amount : null,
      unit: String(i.unit ?? '').trim(),
    }))
    .filter((i) => i.name.length >= 2)
    .slice(0, 40);
  if (!ingredients.length) {
    fail(res, 400, 'invalid-input', 'Noch keine Zutaten zum Schätzen.');
    return;
  }
  const servings = Math.min(50, Math.max(1, Math.round(body.servings ?? 2)));
  const list = ingredients
    .map((i) => `- ${i.amount ?? 'nach Bedarf'} ${i.unit} ${i.name}`.replace(/\s+/g, ' ').trim())
    .join('\n');
  try {
    const prompt = fillTemplate(loadPrompt('nutrition-estimate', 'Schätze die Nährwerte.'), {
      servings: String(servings),
      ingredients: list,
    });
    const estimate = await generateValidated(prompt, nutritionEstimateSchema, 2, 45_000);
    await logRun(req.userId!, 'nutrition-estimate', true, started);
    res.json({ nutrition: estimate, servings });
  } catch (e) {
    await logRun(req.userId!, 'nutrition-estimate', false, started, e instanceof Error ? e.message : String(e));
    fail(res, 502, 'ai-failed', e instanceof Error ? e.message : 'Schätzung fehlgeschlagen.');
  }
});


aiRouter.post('/recipe', async (req: AuthRequest, res) => {
  const started = Date.now();
  const body = req.body as {
    householdId?: string;
    idea?: string;
    servings?: number;
    constraints?: string;
    save?: 'favorite' | 'library' | 'none';
    favorite?: boolean;
  };
  const idea = (body.idea ?? '').trim();
  if (idea.length < 3) {
    fail(res, 400, 'invalid-input', 'Beschreib kurz, was gekocht werden soll.');
    return;
  }
  const settings = await loadSettings(req.userId!);
  // Geräte des Haushalts (falls angegeben) ergänzen die eigenen
  const householdPrefsForRecipe = body.householdId ? await loadHouseholdPreferences(body.householdId) : null;
  const appliances = [...new Set([...settings.appliances, ...(householdPrefsForRecipe?.appliances ?? [])])];
  const dislikes = [...new Set([...settings.dislikes, ...(householdPrefsForRecipe?.dislikes ?? [])])];
  const servings = Math.min(12, Math.max(1, Math.round(body.servings ?? settings.defaultServings ?? 2)));
  const needsSubstitutes = [...settings.diets, ...settings.allergies].some((v) =>
    /gluten|laktose|vegan|vegetarisch|pescetarisch|nuss|ei|soja|fisch|meeresfr|schwein|pilz|sellerie|sesam/i.test(v),
  );
  const constraintParts = [
    (body.constraints ?? '').trim(),
    needsSubstitutes
      ? ''
      : 'Keine Allergien oder Unverträglichkeiten angegeben: KEINE Ersatzprodukte (nicht glutenfrei, nicht laktosefrei, nicht vegan) — normale Zutaten wie Weizenmehl, Weizennudeln, Kuhmilch, Butter, Sahne verwenden.',
    settings.diets.length ? `Ernährungsform: ${settings.diets.join(', ')}` : '',
    settings.allergies.length ? `Unverträglichkeiten/Allergien: ${settings.allergies.join(', ')}` : '',
    settings.cuisines.length ? `Bevorzugte Küche: ${settings.cuisines.join(', ')}` : '',
    appliances.length ? `Nur mit diesen Küchengeräten zubereitbar: ${appliances.join(', ')}` : '',
    dislikes.length ? `Diese Lebensmittel werden nicht gemocht, nicht verwenden: ${dislikes.join(', ')}` : '',
    settings.maxMinutes ? `maximal ${settings.maxMinutes} Minuten Zubereitungszeit` : '',
    settings.kcalTarget ? `grob ${settings.kcalTarget} kcal pro Portion` : '',
    settings.specialWishes ? `Sonderwünsche: ${settings.specialWishes}` : '',
  ].filter(Boolean);
  try {
    const prompt = fillTemplate(loadPrompt('recipe-draft', 'Erstelle ein Rezept als JSON.'), {
      idea,
      servings: String(servings),
      constraints: constraintParts.join('; ') || 'keine besonderen Vorgaben',
    });
    const draft = normalizeRecipe(await generateValidated(prompt, aiRecipeSchema, 2, 90_000));
    const mode = body.save ?? 'favorite';

    if (mode === 'none') {
      await logRun(req.userId!, 'recipe-draft', true, started);
      res.json({ recipe: draft, saved: false });
      return;
    }

    const householdId = await resolveHousehold(String(body.householdId ?? ''), req.userId!);
    const created = await pool.query<{ id: string }>(
      `INSERT INTO recipes (household_id, owner_id, title, description, servings, prep_minutes, total_minutes, difficulty, tags, source, ingredients, steps, nutrition)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ai',$10::jsonb,$11::jsonb,$12::jsonb)
       RETURNING id`,
      [
        householdId,
        req.userId,
        draft.title,
        draft.description,
        draft.servings,
        draft.prepMinutes,
        draft.totalMinutes,
        draft.difficulty,
        draft.tags,
        JSON.stringify(draft.ingredients),
        JSON.stringify(draft.steps),
        JSON.stringify(draft.nutrition),
      ],
    );
    const recipeId = created.rows[0].id;
    const makeFavorite = body.favorite === true || mode === 'favorite' || settings.aiAutoFavorite;
    if (makeFavorite) {
      await pool.query('INSERT INTO favorites (user_id, recipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
        req.userId,
        recipeId,
      ]);
    }
    await logRun(req.userId!, 'recipe-draft', true, started);
    res.json({ recipe: { ...draft, id: recipeId }, saved: true, favorite: makeFavorite });
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

export type WeekPlanBody = {
  householdId?: string;
  weekStart?: string;
  servings?: number;
  slots?: string[];
  days?: number[];
  constraints?: string;
  mode?: 'replace' | 'fill';
  mergeMembers?: boolean;
};

export class WeekPlanError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Wochenplan erzeugen — gemeinsame Logik für den Dialog und den Chat-Assistenten.
 * Wirft WeekPlanError bei ungültigen Eingaben, damit beide Aufrufer passend antworten können.
 */
export async function planWeekForUser(
  userId: number,
  body: WeekPlanBody,
): Promise<{ plan: unknown; created: number; reused: number; notes: string; days: string[] }> {
  const started = Date.now();
  const access = await requireHousehold(body.householdId, userId);
  if (!access.ok) throw new WeekPlanError(access.status, access.error, access.message);
  const weekStart = String(body.weekStart ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new WeekPlanError(400, 'invalid-input', 'Wochenstart (YYYY-MM-DD) fehlt.');
  }
  const settings = await loadSettings(userId);
  const householdPrefs = body.mergeMembers ? await loadHouseholdPreferences(body.householdId!) : null;
  // Tage, Mahlzeiten und Portionen kommen aus den Haushalts-Vorgaben, sofern nicht explizit übergeben
  const householdPlan = await loadHouseholdRaw(body.householdId!);
  const servings = Math.min(
    12,
    Math.max(1, Math.round(body.servings ?? householdPlan.planServings ?? settings.defaultServings ?? 2)),
  );
  const requestedSlots = (body.slots ?? householdPlan.planSlots ?? settings.defaultSlots ?? ['abend']).filter(
    (s): s is Slot => slotSchema.safeParse(s).success,
  );
  const slots = requestedSlots.length ? requestedSlots : (['abend'] as Slot[]);
  const allowedDays = Array.isArray(body.days) && body.days.length
    ? body.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : householdPlan.planDays.length
      ? householdPlan.planDays
      : [0, 1, 2, 3, 4, 5, 6];
  const diets = [...new Set([...(householdPrefs?.diets ?? []), ...settings.diets])];
  const allergies = [...new Set([...(householdPrefs?.allergies ?? []), ...settings.allergies])];
  const cuisines = [...new Set([...(householdPrefs?.cuisines ?? []), ...settings.cuisines])];
  const appliances = [...new Set([...(householdPrefs?.appliances ?? []), ...settings.appliances])];
  const dislikes = [...new Set([...(householdPrefs?.dislikes ?? []), ...settings.dislikes])];
  const maxMinutes = [householdPrefs?.maxMinutes, settings.maxMinutes].filter((v): v is number => v != null);
  const kcalTarget = householdPrefs?.kcalTarget ?? settings.kcalTarget;
  const wishes = [settings.specialWishes, ...(householdPrefs?.specialWishes ?? [])].filter(Boolean);
  const needsSubstitutes = [...diets, ...allergies].some((v) =>
    /gluten|laktose|vegan|vegetarisch|pescetarisch|nuss|ei|soja|fisch|meeresfr|schwein|pilz|sellerie|sesam/i.test(v),
  );
  const constraintParts = [
    (body.constraints ?? '').trim(),
    needsSubstitutes
      ? ''
      : 'Keine Allergien oder Unverträglichkeiten angegeben: KEINE Ersatzprodukte (nicht glutenfrei, nicht laktosefrei, nicht vegan) — normale Zutaten verwenden, alltägliche Hausmannskost.',
    diets.length ? `Ernährungsform (für ALLE Personen einhalten): ${diets.join(', ')}` : '',
    allergies.length ? `Unverträglichkeiten/Allergien (streng meiden): ${allergies.join(', ')}` : '',
    cuisines.length ? `Bevorzugte Küche: ${cuisines.join(', ')}` : '',
    appliances.length
      ? `Nur mit diesen Küchengeräten zubereiten (keine anderen voraussetzen): ${appliances.join(', ')}`
      : '',
    dislikes.length ? `Diese Lebensmittel werden nicht gemocht, nicht verwenden: ${dislikes.join(', ')}` : '',
    maxMinutes.length ? `jede Mahlzeit in maximal ${Math.min(...maxMinutes)} Minuten` : '',
    kcalTarget ? `Tagesziel etwa ${kcalTarget} kcal` : '',
    wishes.length ? `Sonderwünsche: ${wishes.join(' | ')}` : '',
    allowedDays.length < 7
      ? `Nur diese Wochentage planen: ${allowedDays.map((d) => WEEK_DAYS[d]).join(', ')}`
      : '',
  ].filter(Boolean);
  // Abwechslung: was in den letzten drei Wochen schon gekocht wurde, nicht wiederholen
  const recent = await pool.query<{ title: string }>(
    `SELECT title FROM recipes
      WHERE household_id = $1 AND created_at > now() - interval '21 days'
      ORDER BY created_at DESC LIMIT 40`,
    [body.householdId],
  );
  const recentTitles = [...new Set(recent.rows.map((r) => r.title.trim()).filter(Boolean))].slice(0, 20);
  const motto = WEEK_MOTTOS[Math.floor(Math.random() * WEEK_MOTTOS.length)];

  const existing = await loadPlan(body.householdId!, weekStart);
  const existingEntries =
    (existing.entries as Array<{ title: string; dayIndex: number; slot: string }>) ?? [];
  // Im Modus „nur leere Slots füllen" bleiben Tage unangetastet, an denen schon etwas hängt.
  const busyDays = body.mode === 'fill' ? new Set(existingEntries.map((e) => e.dayIndex)) : new Set<number>();

  try {
    const prompt = fillTemplate(loadPrompt('week-plan', 'Plane eine Woche als JSON.'), {
      weekStart,
      servings: String(servings),
      slots: slots.map((s) => `${s} (${SLOTS.includes(s) ? s : ''})`).join(', '),
      constraints: constraintParts.join('; ') || 'keine besonderen Vorgaben',
      existingTitles: existingEntries.map((e) => e.title).join(', ') || 'keine',
      recentTitles: recentTitles.join(' | ') || 'keine',
      motto,
    });
    // Höhere Temperatur: sonst liefert das Modell Woche für Woche dieselben Gerichte
    const plan = await generateValidated(prompt, weekPlanSchema, 3, 240_000, 0.9);

    if (body.mode !== 'fill') {
      // Ersetzen heißt: die ganze Woche wird neu geschrieben. Auch Einträge, die auf vorhandene
      // Rezepte aus der Sammlung zeigen, werden entfernt — sonst wächst der Plan bei jedem Lauf
      // und „überschreiben" wirkt, als würde nichts passieren.
      await pool.query(
        `DELETE FROM plan_entries e USING meal_plans p
          WHERE e.plan_id = p.id AND p.household_id = $1 AND p.week_start = $2`,
        [body.householdId, weekStart],
      );
    }

    const planRow = await pool.query<{ id: string }>(
      `INSERT INTO meal_plans (household_id, week_start, created_by) VALUES ($1,$2,$3)
       ON CONFLICT (household_id, week_start) DO UPDATE SET household_id = EXCLUDED.household_id
       RETURNING id`,
      [body.householdId, weekStart, userId],
    );
    const planId = planRow.rows[0].id;

    // Mischung: ein Teil der Slots wird mit vorhandenen Rezepten belegt, der Rest neu erzeugt.
    // So wächst die Sammlung, ohne dass jede Woche alles neu erfunden wird.
    const slotsToFill: Array<{ dayIndex: number; slot: string }> = [];
    for (const day of plan.days) {
      if (!allowedDays.includes(day.dayIndex) || busyDays.has(day.dayIndex)) continue;
      for (const meal of day.meals ?? []) slotsToFill.push({ dayIndex: day.dayIndex, slot: meal.slot });
    }
    const reuseCount = Math.max(1, Math.min(slotsToFill.length - 1, Math.round(slotsToFill.length * 0.4)));
    const reuseSlots = new Set<string>();
    const reuseRecipes: Array<{ id: string; title: string }> = [];
    if (body.mode !== 'fill' && reuseCount > 0) {
      const pool2 = await pool.query<{ id: string; title: string }>(
        `SELECT id, title FROM recipes
          WHERE status = 'active' AND title <> ALL($1::text[])
            AND NOT (allergens && $2::text[])
            AND ($3::text[] = '{}' OR diets && $3::text[])
          ORDER BY random() LIMIT $4`,
        [recentTitles.length ? recentTitles : [''], allergies, diets, reuseCount],
      );
      reuseRecipes.push(...pool2.rows);
      const shuffledSlots = [...slotsToFill].sort(() => Math.random() - 0.5);
      for (let i = 0; i < reuseRecipes.length; i++) reuseSlots.add(`${shuffledSlots[i].dayIndex}|${shuffledSlots[i].slot}`);
    }

    let created = 0;
    let reused = 0;
    let reuseIndex = 0;
    const positions = new Map<number, number>();
    for (const day of plan.days) {
      if (!allowedDays.includes(day.dayIndex)) continue;
      const dayMeals = day.meals ?? [];
      if (!dayMeals.length) continue;
      for (const meal of dayMeals) {
        if (busyDays.has(day.dayIndex)) continue;

        // Slot ist für ein vorhandenes Rezept vorgesehen
        if (reuseSlots.has(`${day.dayIndex}|${meal.slot}`) && reuseRecipes[reuseIndex]) {
          const pick = reuseRecipes[reuseIndex++];
          const nextPos = positions.get(day.dayIndex) ?? 0;
          positions.set(day.dayIndex, nextPos + 1);
          await pool.query(
            `INSERT INTO plan_entries (plan_id, day_index, slot, position, recipe_id, servings)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [planId, day.dayIndex, meal.slot, nextPos, pick.id, servings],
          );
          reused += 1;
          continue;
        }

        const recipe = normalizeRecipe({ ...meal.recipe, servings: meal.recipe.servings ?? servings });
        const inserted = await pool.query<{ id: string }>(
          `INSERT INTO recipes (household_id, owner_id, title, description, servings, prep_minutes, total_minutes, difficulty, tags, source, ingredients, steps, nutrition)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ai',$10::jsonb,$11::jsonb,$12::jsonb)
           RETURNING id`,
          [
            body.householdId,
            userId,
            recipe.title,
            recipe.description,
            recipe.servings,
            recipe.prepMinutes,
            recipe.totalMinutes,
            recipe.difficulty,
            recipe.tags,
            JSON.stringify(recipe.ingredients),
            JSON.stringify(recipe.steps),
            JSON.stringify(recipe.nutrition),
          ],
        );
        const nextPos = positions.get(day.dayIndex) ?? 0;
        positions.set(day.dayIndex, nextPos + 1);
        await pool.query(
          `INSERT INTO plan_entries (plan_id, day_index, slot, position, recipe_id, servings)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [planId, day.dayIndex, meal.slot, nextPos, inserted.rows[0].id, servings],
        );
        created += 1;
      }
    }
    await logRun(userId, 'week-plan', true, started);
    broadcast(body.householdId!, 'plan');
    return {
      plan: await loadPlan(body.householdId!, weekStart),
      created,
      reused,
      notes: plan.notes ?? '',
      days: [...WEEK_DAYS],
    };
  } catch (e) {
    await logRun(userId, 'week-plan', false, started, e instanceof Error ? e.message : String(e));
    throw new WeekPlanError(502, 'ai-failed', e instanceof Error ? e.message : 'KI-Antwort fehlgeschlagen.');
  }
}

aiRouter.post('/prebuild', async (req: AuthRequest, res) => {
  const householdId = String((req.body as { householdId?: string })?.householdId ?? '');
  const access = await requireHousehold(householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  try {
    const result = await prebuildNextWeek(householdId, req.userId!);
    res.json(result);
  } catch (e) {
    fail(res, 502, 'ai-failed', e instanceof Error ? e.message : 'Vorbau fehlgeschlagen.');
  }
});

aiRouter.post('/week', async (req: AuthRequest, res) => {
  try {
    res.json(await planWeekForUser(req.userId!, req.body as WeekPlanBody));
  } catch (e) {
    if (e instanceof WeekPlanError) {
      fail(res, e.status, e.code, e.message);
      return;
    }
    fail(res, 500, 'internal', 'Die Woche konnte nicht geplant werden.');
  }
});
