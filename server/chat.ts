
import { Router } from 'express';
import { pool } from './db';
import { fail, requireHousehold, type AuthRequest } from './guards';
import { loadHouseholdPreferences as loadHouseholdAggregate, loadSettings, saveSettings } from './auth';
import { loadHouseholdPreferences as loadHouseholdRaw, normalizeHouseholdPreferences } from './householdPrefs';
import type { HouseholdPreferences } from './householdPrefs';
import { loadPlan } from './plans';
import { broadcast } from './events';
import { resolveHousehold } from './recipes';
import { guessCategory } from './shopping';
import { planWeekForUser, resolveProvider, WeekPlanError, type WeekPlanBody } from './ai';

/**
 * Chat-Assistent: liest und ändert die App über Werkzeuge (Function Calling).
 * Jede Aktion läuft mit den Rechten des angemeldeten Nutzers, nichts wird frei erfunden.
 */

type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string };

type Action = { tool: string; summary: string; ok: boolean };

const MAX_STEPS = 6;

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

function mondayOf(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ Werkzeuge */

const TOOLS: Array<Record<string, unknown>> = [
  {
    type: 'function',
    function: {
      name: 'rezepte_suchen',
      description:
        'Sucht Rezepte in der Sammlung. Alle Filter sind optional und werden UND-verknüpft; Listen innerhalb eines Filters sind ODER-verknüpft.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Suchtext über Titel, Zutaten, Beschreibung' },
          tags: { type: 'array', items: { type: 'string' } },
          diaeten: { type: 'array', items: { type: 'string' }, description: 'z. B. vegan, vegetarisch, glutenfrei, low carb' },
          kuechen: { type: 'array', items: { type: 'string' }, description: 'z. B. Italienisch, Asiatisch' },
          ohne_allergene: { type: 'array', items: { type: 'string' } },
          max_minuten: { type: 'integer' },
          max_kcal: { type: 'integer', description: 'kcal pro Portion' },
          limit: { type: 'integer', description: '1-20, Standard 8' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rezept_details',
      description: 'Liefert ein Rezept vollständig (Zutaten, Schritte, Nährwerte).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wochenplan_lesen',
      description: 'Zeigt den Wochenplan. Ohne Angabe die aktuelle Woche.',
      parameters: {
        type: 'object',
        properties: { woche: { type: 'string', description: 'Montag als YYYY-MM-DD' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'einstellungen_lesen',
      description: 'Persönliche Vorgaben: Ernährungsform, Küche, Allergien, Abneigungen, Geräte, Zeit, Kalorien.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'einstellungen_aendern',
      description:
        'Ändert persönliche Vorgaben. Listen ersetzen den bisherigen Inhalt. Nicht übergebene Felder bleiben.',
      parameters: {
        type: 'object',
        properties: {
          diaeten: { type: 'array', items: { type: 'string' } },
          kuechen: { type: 'array', items: { type: 'string' } },
          allergien: { type: 'array', items: { type: 'string' } },
          geraete: { type: 'array', items: { type: 'string' } },
          max_minuten: { type: 'integer' },
          kalorienziel: { type: 'integer' },
          portionen: { type: 'integer' },
          sonderwuensche: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'abneigung_hinzufuegen',
      description: 'Trägt ein Lebensmittel in die Liste „mag ich nicht" ein (persönlich oder für den Haushalt).',
      parameters: {
        type: 'object',
        properties: {
          lebensmittel: { type: 'string' },
          ziel: { type: 'string', enum: ['profil', 'haushalt'], description: 'Standard: profil' },
        },
        required: ['lebensmittel'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'abneigung_entfernen',
      description: 'Entfernt ein Lebensmittel aus der Liste „mag ich nicht".',
      parameters: {
        type: 'object',
        properties: {
          lebensmittel: { type: 'string' },
          ziel: { type: 'string', enum: ['profil', 'haushalt'] },
        },
        required: ['lebensmittel'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'haushalt_vorgaben_aendern',
      description: 'Ändert die Vorgaben des Haushalts (gelten für alle Mitglieder). Listen ersetzen den Inhalt.',
      parameters: {
        type: 'object',
        properties: {
          diaeten: { type: 'array', items: { type: 'string' } },
          kuechen: { type: 'array', items: { type: 'string' } },
          allergien: { type: 'array', items: { type: 'string' } },
          geraete: { type: 'array', items: { type: 'string' } },
          max_minuten: { type: 'integer' },
          kalorienziel: { type: 'integer' },
          notiz: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'woche_planen',
      description:
        'Lässt die KI einen Wochenplan erzeugen und speichert ihn. Dauert 10-60 Sekunden. „ersetzen" löscht vorher die KI-Mahlzeiten der Woche, „fuellen" lässt belegte Tage unangetastet.',
      parameters: {
        type: 'object',
        properties: {
          woche: { type: 'string', description: 'Montag als YYYY-MM-DD, Standard: aktuelle Woche' },
          tage: { type: 'array', items: { type: 'integer' }, description: '0=Montag … 6=Sonntag' },
          mahlzeiten: { type: 'array', items: { type: 'string' }, enum: undefined },
          portionen: { type: 'integer' },
          vorgaben: { type: 'string', description: 'Freitext, z. B. „nichts Scharfes, wenig Kohlenhydrate"' },
          modus: { type: 'string', enum: ['ersetzen', 'fuellen'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mahlzeit_hinzufuegen',
      description: 'Trägt eine Mahlzeit in einen Tag des Wochenplans ein (Rezept aus der Sammlung oder freier Titel).',
      parameters: {
        type: 'object',
        properties: {
          woche: { type: 'string' },
          tag: { type: 'integer', description: '0=Montag … 6=Sonntag' },
          mahlzeit: { type: 'string', enum: ['fruehstueck', 'mittag', 'abend', 'snack'] },
          rezept_id: { type: 'string' },
          titel: { type: 'string', description: 'Freier Titel, wenn kein Rezept' },
          portionen: { type: 'integer' },
        },
        required: ['tag'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mahlzeit_entfernen',
      description: 'Entfernt einen Eintrag aus dem Wochenplan — per Eintrags-ID oder über Tag + Titel.',
      parameters: {
        type: 'object',
        properties: {
          woche: { type: 'string' },
          eintrag_id: { type: 'string' },
          tag: { type: 'integer' },
          titel: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'woche_leeren',
      description: 'Entfernt alle Einträge einer Woche (Rezepte bleiben in der Sammlung).',
      parameters: { type: 'object', properties: { woche: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'favorit_setzen',
      description: 'Merkt ein Rezept als Favorit oder entfernt es aus den Favoriten.',
      parameters: {
        type: 'object',
        properties: { rezept_id: { type: 'string' }, favorit: { type: 'boolean' } },
        required: ['rezept_id', 'favorit'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'einkaufsliste_lesen',
      description: 'Zeigt die Einkaufsliste des Haushalts (aus Wochenplan plus manuell).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'einkauf_hinzufuegen',
      description: 'Setzt einen Artikel auf die Einkaufsliste.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, menge: { type: 'number' }, einheit: { type: 'string' } },
        required: ['name'],
      },
    },
  },
];

/* ------------------------------------------------------------------ Ausführung */

type Ctx = { userId: number; householdId: string | null };

async function toolRecipes(ctx: Ctx, a: Record<string, unknown>) {
  const limit = Math.min(20, Math.max(1, Number(a.limit ?? 8)));
  const params: unknown[] = [];
  const where: string[] = ["r.status = 'active'"];
  const push = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (typeof a.text === 'string' && a.text.trim()) {
    const p = push(`%${a.text.trim()}%`);
    where.push(`(r.title ILIKE ${p} OR coalesce(r.description,'') ILIKE ${p})`);
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  if (list(a.diaeten).length) where.push(`r.diets && ${push(list(a.diaeten))}::text[]`);
  if (list(a.kuechen).length) where.push(`r.cuisines && ${push(list(a.kuechen))}::text[]`);
  if (list(a.ohne_allergene).length) where.push(`NOT (r.allergens && ${push(list(a.ohne_allergene))}::text[])`);
  if (list(a.tags).length) where.push(`r.tags && ${push(list(a.tags))}::text[]`);
  if (Number(a.max_minuten)) where.push(`coalesce(r.total_minutes, r.prep_minutes, 999) <= ${push(Number(a.max_minuten))}`);
  if (Number(a.max_kcal)) where.push(`coalesce((r.nutrition->>'kcal')::numeric, 0) <= ${push(Number(a.max_kcal))}`);
  params.push(limit);
  const rows = await pool.query(
    `SELECT r.id, r.title, r.prep_minutes, r.total_minutes, r.diets, r.cuisines, r.tags,
            r.nutrition->>'kcal' AS kcal, u.display_name AS author
       FROM recipes r LEFT JOIN users u ON u.id = r.owner_id
      WHERE ${where.join(' AND ')}
      ORDER BY r.created_at DESC LIMIT $${params.length}`,
    params,
  );
  return { anzahl: rows.rowCount, rezepte: rows.rows };
}

async function toolRecipeDetail(ctx: Ctx, a: Record<string, unknown>) {
  const rows = await pool.query(
    `SELECT r.id, r.title, r.description, r.servings, r.prep_minutes, r.total_minutes, r.difficulty,
            r.tags, r.diets, r.cuisines, r.allergens, r.ingredients, r.steps, r.nutrition
       FROM recipes r WHERE r.id = $1 AND r.status = 'active'`,
    [String(a.id ?? '')],
  );
  if (!rows.rowCount) return { fehler: 'Rezept nicht gefunden' };
  return rows.rows[0];
}

async function toolWeekPlan(ctx: Ctx, a: Record<string, unknown>) {
  if (!ctx.householdId) return { fehler: 'Du bist in keinem Haushalt.' };
  const week = typeof a.woche === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.woche) ? a.woche : mondayOf();
  const plan = await loadPlan(ctx.householdId, week);
  const entries = (plan.entries as Array<Record<string, unknown>>).map((e) => ({
    eintrag_id: e.id,
    tag: WEEKDAYS[Number(e.dayIndex)],
    tag_index: e.dayIndex,
    mahlzeit: e.slot,
    titel: e.title,
    portionen: e.servings,
    kcal: (e.nutrition as Record<string, unknown> | null)?.kcal ?? null,
  }));
  return { woche: week, anzahl: entries.length, eintraege: entries };
}

async function toolSettingsRead(ctx: Ctx) {
  const s = await loadSettings(ctx.userId);
  return {
    diaeten: s.diets,
    kuechen: s.cuisines,
    allergien: s.allergies,
    abneigungen: s.dislikes,
    geraete: s.appliances,
    max_minuten: s.maxMinutes,
    kalorienziel: s.kcalTarget,
    standard_portionen: s.defaultServings,
    sonderwuensche: s.specialWishes,
  };
}

async function toolSettingsChange(ctx: Ctx, a: Record<string, unknown>) {
  const patchBody: Record<string, unknown> = {};
  if (Array.isArray(a.diaeten)) patchBody.diets = a.diaeten;
  if (Array.isArray(a.kuechen)) patchBody.cuisines = a.kuechen;
  if (Array.isArray(a.allergien)) patchBody.allergies = a.allergien;
  if (Array.isArray(a.geraete)) patchBody.appliances = a.geraete;
  if (a.max_minuten !== undefined) patchBody.maxMinutes = a.max_minuten;
  if (a.kalorienziel !== undefined) patchBody.kcalTarget = a.kalorienziel;
  if (a.portionen !== undefined) patchBody.defaultServings = a.portionen;
  if (typeof a.sonderwuensche === 'string') patchBody.specialWishes = a.sonderwuensche;
  if (!Object.keys(patchBody).length) return { fehler: 'Keine Änderung übergeben' };
  const next = await saveSettings(ctx.userId, patchBody);
  return { ok: true, neu: { diaeten: next.diets, kuechen: next.cuisines, allergien: next.allergies, max_minuten: next.maxMinutes } };
}

async function householdPrefs(
  ctx: Ctx,
  patch: (p: HouseholdPreferences) => HouseholdPreferences,
): Promise<HouseholdPreferences> {
  if (!ctx.householdId) throw new Error('Du bist in keinem Haushalt.');
  const current = await loadHouseholdRaw(ctx.householdId);
  const next = normalizeHouseholdPreferences(patch(current));
  await pool.query('UPDATE households SET preferences = $2::jsonb WHERE id = $1', [
    ctx.householdId,
    JSON.stringify(next),
  ]);
  broadcast(ctx.householdId, 'household');
  return next;
}

async function toolDislike(ctx: Ctx, a: Record<string, unknown>, remove: boolean) {
  const item = String(a.lebensmittel ?? '').trim().slice(0, 60);
  if (!item) return { fehler: 'Kein Lebensmittel angegeben' };
  const household = a.ziel === 'haushalt';

  if (household) {
    const next = await householdPrefs(ctx, (p) => ({
      ...p,
      dislikes: remove
        ? p.dislikes.filter((d) => d.toLowerCase() !== item.toLowerCase())
        : [...p.dislikes.filter((d) => d.toLowerCase() !== item.toLowerCase()), item].slice(0, 40),
    }));
    return { ok: true, ziel: 'haushalt', liste: next.dislikes };
  }

  const settings = await loadSettings(ctx.userId);
  const dislikes = remove
    ? settings.dislikes.filter((d) => d.toLowerCase() !== item.toLowerCase())
    : [...settings.dislikes.filter((d) => d.toLowerCase() !== item.toLowerCase()), item].slice(0, 40);
  await saveSettings(ctx.userId, { dislikes });
  return { ok: true, ziel: 'profil', liste: dislikes };
}

async function toolHouseholdChange(ctx: Ctx, a: Record<string, unknown>) {
  const next = await householdPrefs(ctx, (p) => ({
    ...p,
    diets: Array.isArray(a.diaeten) ? a.diaeten : p.diets,
    cuisines: Array.isArray(a.kuechen) ? a.kuechen : p.cuisines,
    allergies: Array.isArray(a.allergien) ? a.allergien : p.allergies,
    appliances: Array.isArray(a.geraete) ? a.geraete : p.appliances,
    maxMinutes: a.max_minuten !== undefined ? Number(a.max_minuten) : p.maxMinutes,
    kcalTarget: a.kalorienziel !== undefined ? Number(a.kalorienziel) : p.kcalTarget,
    note: typeof a.notiz === 'string' ? a.notiz : p.note,
  }));
  return { ok: true, neu: next };
}

async function toolPlanWeek(ctx: Ctx, a: Record<string, unknown>) {
  if (!ctx.householdId) return { fehler: 'Du bist in keinem Haushalt.' };
  const week = typeof a.woche === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.woche) ? a.woche : mondayOf();
  const body: WeekPlanBody = {
    householdId: ctx.householdId,
    weekStart: week,
    days: Array.isArray(a.tage) ? (a.tage as number[]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : undefined,
    slots: Array.isArray(a.mahlzeiten) ? (a.mahlzeiten as string[]) : undefined,
    servings: Number(a.portionen) || undefined,
    constraints: typeof a.vorgaben === 'string' ? a.vorgaben : '',
    mode: a.modus === 'fuellen' ? 'fill' : 'replace',
    mergeMembers: true,
  };
  const result = await planWeekForUser(ctx.userId, body);
  const entries = (result.plan as { entries?: Array<{ dayIndex: number; title: string }> }).entries ?? [];
  return {
    ok: true,
    erstellt: result.created,
    woche: week,
    hinweis: result.notes,
    plan: entries.map((e) => `${WEEKDAYS[e.dayIndex]}: ${e.title}`),
  };
}

async function toolAddMeal(ctx: Ctx, a: Record<string, unknown>) {
  if (!ctx.householdId) return { fehler: 'Du bist in keinem Haushalt.' };
  const week = typeof a.woche === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.woche) ? a.woche : mondayOf();
  const day = Number(a.tag);
  if (!Number.isInteger(day) || day < 0 || day > 6) return { fehler: 'Tag muss 0-6 sein' };
  const slot = ['fruehstueck', 'mittag', 'abend', 'snack'].includes(String(a.mahlzeit)) ? String(a.mahlzeit) : 'abend';
  const recipeId = typeof a.rezept_id === 'string' && /^[0-9a-f-]{36}$/i.test(a.rezept_id) ? a.rezept_id : null;
  if (!recipeId && !String(a.titel ?? '').trim()) {
    return { fehler: 'Entweder rezept_id oder titel angeben' };
  }

  const planRow = await pool.query<{ id: string }>(
    `INSERT INTO meal_plans (household_id, week_start, created_by) VALUES ($1,$2,$3)
     ON CONFLICT (household_id, week_start) DO UPDATE SET household_id = EXCLUDED.household_id
     RETURNING id`,
    [ctx.householdId, week, ctx.userId],
  );
  const next = await pool.query<{ pos: number }>(
    'SELECT coalesce(max(position) + 1, 0) AS pos FROM plan_entries WHERE plan_id = $1 AND day_index = $2',
    [planRow.rows[0].id, day],
  );
  await pool.query(
    `INSERT INTO plan_entries (plan_id, day_index, slot, position, recipe_id, custom_title, servings)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [planRow.rows[0].id, day, slot, next.rows[0].pos, recipeId, recipeId ? null : String(a.titel).slice(0, 200), Number(a.portionen) || null],
  );
  broadcast(ctx.householdId, 'plan');
  return { ok: true, tag: WEEKDAYS[day], woche: week };
}

async function toolRemoveMeal(ctx: Ctx, a: Record<string, unknown>) {
  if (!ctx.householdId) return { fehler: 'Du bist in keinem Haushalt.' };
  const week = typeof a.woche === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.woche) ? a.woche : mondayOf();
  const id = typeof a.eintrag_id === 'string' ? a.eintrag_id : null;
  const title = typeof a.titel === 'string' ? a.titel.trim() : '';
  const day = Number.isInteger(Number(a.tag)) ? Number(a.tag) : null;

  if (id) {
    const del = await pool.query(
      `DELETE FROM plan_entries e USING meal_plans p
        WHERE e.id = $1 AND e.plan_id = p.id AND p.household_id = $2 AND p.week_start = $3`,
      [id, ctx.householdId, week],
    );
    if (!del.rowCount) return { fehler: 'Eintrag nicht gefunden' };
    broadcast(ctx.householdId, 'plan');
    return { ok: true, entfernt: 1 };
  }
  if (!title) return { fehler: 'eintrag_id oder titel angeben' };

  const del = await pool.query(
    `DELETE FROM plan_entries e USING meal_plans p, recipes r
      WHERE e.plan_id = p.id AND e.recipe_id = r.id AND p.household_id = $1 AND p.week_start = $2
        AND r.title ILIKE $3 ${day != null ? 'AND e.day_index = $4' : ''}`,
    day != null ? [ctx.householdId, week, `%${title}%`, day] : [ctx.householdId, week, `%${title}%`],
  );
  if (!del.rowCount) return { fehler: 'Kein Eintrag mit diesem Titel gefunden' };
  broadcast(ctx.householdId, 'plan');
  return { ok: true, entfernt: del.rowCount };
}

async function toolClearWeek(ctx: Ctx, a: Record<string, unknown>) {
  if (!ctx.householdId) return { fehler: 'Du bist in keinem Haushalt.' };
  const week = typeof a.woche === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.woche) ? a.woche : mondayOf();
  const del = await pool.query(
    `DELETE FROM plan_entries e USING meal_plans p
      WHERE e.plan_id = p.id AND p.household_id = $1 AND p.week_start = $2`,
    [ctx.householdId, week],
  );
  broadcast(ctx.householdId, 'plan');
  return { ok: true, entfernt: del.rowCount ?? 0, woche: week };
}

async function toolFavorite(ctx: Ctx, a: Record<string, unknown>) {
  const id = String(a.rezept_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { fehler: 'Ungültige Rezept-ID' };
  if (a.favorit) {
    await pool.query('INSERT INTO favorites (user_id, recipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ctx.userId, id]);
  } else {
    await pool.query('DELETE FROM favorites WHERE user_id = $1 AND recipe_id = $2', [ctx.userId, id]);
  }
  return { ok: true, favorit: Boolean(a.favorit) };
}

async function toolShoppingRead(ctx: Ctx) {
  if (!ctx.householdId) return { fehler: 'Du bist in keinem Haushalt.' };
  const rows = await pool.query(
    `SELECT name, amount, unit, checked FROM shopping_items
      WHERE household_id = $1 AND week_start = $2 ORDER BY name`,
    [ctx.householdId, mondayOf()],
  );
  return { anzahl: rows.rowCount, artikel: rows.rows };
}

async function toolShoppingAdd(ctx: Ctx, a: Record<string, unknown>) {
  if (!ctx.householdId) return { fehler: 'Du bist in keinem Haushalt.' };
  const name = String(a.name ?? '').trim().slice(0, 120);
  if (!name) return { fehler: 'Kein Name angegeben' };
  const week = mondayOf();
  const key = name.toLowerCase();
  const exists = await pool.query(
    'SELECT id FROM shopping_items WHERE household_id = $1 AND week_start = $2 AND key = $3',
    [ctx.householdId, week, key],
  );
  if (exists.rowCount) return { ok: true, hinweis: 'steht schon auf der Liste', name };
  await pool.query(
    `INSERT INTO shopping_items (household_id, week_start, key, name, amount, unit, category, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8)`,
    [
      ctx.householdId,
      week,
      key,
      name,
      Number(a.menge) || 1,
      String(a.einheit ?? 'Stück').slice(0, 20),
      guessCategory(name),
      ctx.userId,
    ],
  );
  broadcast(ctx.householdId, 'shopping');
  return { ok: true, name };
}

type Handler = (ctx: Ctx, args: Record<string, unknown>) => Promise<unknown>;

const HANDLERS: Record<string, { run: Handler; summary: (result: Record<string, unknown>, args: Record<string, unknown>) => string }> = {
  rezepte_suchen: { run: toolRecipes, summary: (r) => `${r.anzahl ?? 0} Rezepte gefunden` },
  rezept_details: { run: toolRecipeDetail, summary: (r, a) => `Rezept ${String(a.id).slice(0, 8)} gelesen` },
  wochenplan_lesen: { run: toolWeekPlan, summary: (r) => `Wochenplan gelesen (${r.anzahl ?? 0} Einträge)` },
  einstellungen_lesen: { run: toolSettingsRead, summary: () => 'Einstellungen gelesen' },
  einstellungen_aendern: { run: toolSettingsChange, summary: () => 'Einstellungen geändert' },
  abneigung_hinzufuegen: { run: (c, a) => toolDislike(c, a, false), summary: (r, a) => `„${a.lebensmittel}" gemerkt` },
  abneigung_entfernen: { run: (c, a) => toolDislike(c, a, true), summary: (r, a) => `„${a.lebensmittel}" entfernt` },
  haushalt_vorgaben_aendern: { run: toolHouseholdChange, summary: () => 'Haushalts-Vorgaben geändert' },
  woche_planen: { run: toolPlanWeek, summary: (r) => `Woche geplant (${r.erstellt ?? 0} Mahlzeiten)` },
  mahlzeit_hinzufuegen: { run: toolAddMeal, summary: (r) => `Mahlzeit für ${r.tag ?? 'Tag'} eingetragen` },
  mahlzeit_entfernen: { run: toolRemoveMeal, summary: (r) => `${r.entfernt ?? 0} Eintrag entfernt` },
  woche_leeren: { run: toolClearWeek, summary: (r) => `Woche geleert (${r.entfernt ?? 0} Einträge)` },
  favorit_setzen: { run: toolFavorite, summary: (r, a) => (a.favorit ? 'als Favorit gemerkt' : 'aus Favoriten entfernt') },
  einkaufsliste_lesen: { run: toolShoppingRead, summary: (r) => `Einkaufsliste gelesen (${r.anzahl ?? 0})` },
  einkauf_hinzufuegen: { run: toolShoppingAdd, summary: (r, a) => `„${a.name}" auf die Einkaufsliste` },
};

/* ------------------------------------------------------------------ Modellaufruf */

async function callModel(messages: ChatMessage[], tools: unknown[]) {
  const cfg = resolveProvider();
  if (!cfg) throw new Error('Keine KI konfiguriert.');
  if (cfg.name === 'gemini') throw new Error('Der Chat benötigt DeepSeek oder Mistral.');

  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({ model: cfg.model, messages, tools, tool_choice: 'auto', temperature: 0.3, max_tokens: 2000 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`${cfg.name} HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
  };
  return data.choices?.[0]?.message ?? {};
}

/* ------------------------------------------------------------------ Router */

export const chatRouter = Router();

chatRouter.get('/messages', async (req: AuthRequest, res) => {
  const rows = await pool.query(
    `SELECT id, role, content, actions, created_at FROM chat_messages
      WHERE user_id = $1 ORDER BY id DESC LIMIT 60`,
    [req.userId],
  );
  res.json({ messages: rows.rows.reverse() });
});

chatRouter.delete('/messages', async (req: AuthRequest, res) => {
  await pool.query('DELETE FROM chat_messages WHERE user_id = $1', [req.userId]);
  res.json({ ok: true });
});

chatRouter.post('/', async (req: AuthRequest, res) => {
  const text = String((req.body as { message?: string })?.message ?? '').trim();
  if (!text) {
    fail(res, 400, 'invalid-input', 'Nachricht fehlt.');
    return;
  }
  if (text.length > 2000) {
    fail(res, 400, 'too-long', 'Bitte kürzer fassen (max. 2000 Zeichen).');
    return;
  }

  const householdId = await resolveHousehold(String((req.body as { householdId?: string })?.householdId ?? ''), req.userId!);
  if (householdId) {
    const access = await requireHousehold(householdId, req.userId!);
    if (!access.ok) {
      fail(res, access.status, access.error, access.message);
      return;
    }
  }

  const settings = await loadSettings(req.userId!);
  const household = householdId ? await loadHouseholdAggregate(householdId) : null;
  const householdNote = householdId ? (await loadHouseholdRaw(householdId)).note : '';
  const today = new Date().toISOString().slice(0, 10);

  const system = [
    'Du bist der Assistent der Meal-Planner-App. Du sprichst Deutsch, duzt die Person, antwortest knapp und konkret.',
    `Heute ist ${today}, Montag dieser Woche ist der ${mondayOf()}.`,
    `Person: ${settings.defaultServings} Standardportionen; Vorgaben: ${settings.diets.join(', ') || 'keine'};`,
    `Allergien: ${settings.allergies.join(', ') || 'keine'}; Abneigungen: ${settings.dislikes.join(', ') || 'keine'};`,
    `Geräte: ${settings.appliances.join(', ') || 'keine Angabe'}.`,
    household
      ? `Haushalt-Vorgaben: ${household.diets.join(', ') || 'keine'} · Allergien ${household.allergies.join(', ') || 'keine'} · Abneigungen ${household.dislikes.join(', ') || 'keine'} · Geräte ${household.appliances.join(', ') || 'keine'}${householdNote ? ` · Notiz: ${householdNote}` : ''}.`
      : 'Die Person ist in keinem Haushalt — Wochenplan und Einkauf sind nicht verfügbar.',
    '',
    'Regeln:',
    '- Nutze die Werkzeuge, statt zu raten. Vor Änderungen am Wochenplan liest du ihn, wenn du Einträge entfernen willst.',
    '- Bei „das gefällt mir nicht" handle selbst: entferne die betroffenen Einträge bzw. plane passend neu, statt nur zu erklären.',
    '- Rezept-IDs nur aus Werkzeug-Ergebnissen verwenden, niemals erfinden.',
    '- Nach den Aktionen: ein bis drei Sätze, was du geändert hast. Keine Aufzählung der Werkzeugnamen.',
    '- Wenn etwas unklar ist, frage einmal kurz nach, statt zu raten.',
    '- Ohne eingestellte Allergien/Unverträglichkeiten keine Ersatzprodukte vorschlagen (nicht glutenfrei, nicht laktosefrei, nicht vegan) — normale Zutaten, alltägliche Gerichte.',
  ].join('\n');

  try {
    const history = await pool.query<{ role: string; content: string }>(
      'SELECT role, content FROM chat_messages WHERE user_id = $1 ORDER BY id DESC LIMIT 12',
      [req.userId],
    );
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...history.rows.reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: text },
    ];

    await pool.query('INSERT INTO chat_messages (user_id, role, content) VALUES ($1,$2,$3)', [req.userId, 'user', text]);

    const actions: Action[] = [];
    let reply = '';
    for (let step = 0; step < MAX_STEPS; step++) {
      const answer = await callModel(messages, TOOLS);
      const calls = answer.tool_calls ?? [];
      if (!calls.length) {
        reply = (answer.content ?? '').trim();
        break;
      }
      messages.push({ role: 'assistant', content: answer.content ?? '', tool_calls: calls } as unknown as ChatMessage);
      for (const call of calls) {
        const handler = HANDLERS[call.function.name];
        let result: Record<string, unknown>;
        try {
          const args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
          result = handler
            ? ((await handler.run({ userId: req.userId!, householdId }, args)) as Record<string, unknown>)
            : { fehler: `Unbekanntes Werkzeug: ${call.function.name}` };
          actions.push({
            tool: call.function.name,
            summary: handler ? handler.summary(result, args) : 'unbekannt',
            ok: !result.fehler,
          });
        } catch (error) {
          const message = error instanceof WeekPlanError ? error.message : error instanceof Error ? error.message : 'Fehler';
          result = { fehler: message };
          actions.push({ tool: call.function.name, summary: `fehlgeschlagen: ${message}`.slice(0, 160), ok: false });
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
      }
    }

    if (!reply) reply = 'Erledigt.';
    await pool.query('INSERT INTO chat_messages (user_id, role, content, actions) VALUES ($1,$2,$3,$4::jsonb)', [
      req.userId,
      'assistant',
      reply,
      JSON.stringify(actions),
    ]);
    res.json({ reply, actions });
  } catch (error) {
    fail(res, 502, 'ai-failed', error instanceof Error ? error.message.slice(0, 300) : 'Der Assistent konnte nicht antworten.');
  }
});
