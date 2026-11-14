
/**
 * Füllt die Rezeptsammlung: pro Kombination aus Küche und Ernährungsform mehrere vollständige Rezepte.
 * Läuft im Container, schreibt direkt in Postgres (source='seed', kein Haushalt, kein Autor).
 *
 * Aufruf: node /app/scripts/seed.mjs [proKombination]
 */
import { Pool } from 'pg';

const PER_COMBO = Number(process.argv[2] ?? 7);
const PARALLEL = 3;

const CUISINES = ['Deutsch', 'Italienisch', 'Spanisch', 'Französisch', 'Griechisch', 'Türkisch', 'Asiatisch', 'Indisch', 'Mexikanisch', 'Amerikanisch', 'Orientalisch'];
const DIETS = ['vegetarisch', 'vegan', 'pescetarisch', 'low carb', 'high protein', 'glutenfrei', 'laktosefrei', 'kalorienbewusst'];

const DIET_RULES = {
  vegetarisch: 'ohne Fleisch und Fisch',
  vegan: 'rein pflanzlich, ohne Fleisch, Fisch, Milch, Ei, Honig',
  pescetarisch: 'mit Fisch/Meeresfrüchten, aber ohne Fleisch',
  'low carb': 'höchstens 25 g Kohlenhydrate pro Portion',
  'high protein': 'mindestens 30 g Protein pro Portion',
  glutenfrei: 'ohne Weizen, ohne glutenhaltige Zutaten (kein Mehl, keine normalen Nudeln)',
  laktosefrei: 'ohne Milch, Sahne, Butter, Käse (oder mit ausdrücklich laktosefreien Produkten)',
  kalorienbewusst: 'höchstens 500 kcal pro Portion',
};

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      database: process.env.POSTGRES_DB || 'mealplanner',
      user: process.env.POSTGRES_USER || 'mealplanner',
      password: process.env.POSTGRES_PASSWORD || 'mealplanner',
    });
let inserted = 0;
let skipped = 0;
let failed = 0;

function buildPrompt(cuisine, diet, count) {
  return `Du bist Koch. Erfinde ${count} unterschiedliche, vollständige Rezepte der Küche "${cuisine}" für ${diet}-Ernährung (${DIET_RULES[diet]}).

REGELN
1. Antworte NUR mit JSON: {"recipes":[...]} — kein Markdown.
2. Jedes Rezept: alltagstauglich, Zutaten aus dem Supermarkt, keine Marken, keine exotischen Spezialzutaten ohne Grund.
3. Mengen für 2 Portionen. Einheit aus: g, kg, ml, l, Stück, TL, EL, Prise, Bund, Zehe, Scheibe, Dose, Packung, Becher, Stange, Blatt.
4. 4 bis 10 Schritte im Imperativ, mit Zeit/Temperatur.
5. Nährwerte pro Portion (kcal, protein, carbs, fat) als ganze Zahlen, plausibel.
6. prepMinutes (Arbeitszeit) und totalMinutes (gesamt, >= prepMinutes), difficulty: leicht|mittel|schwer.
7. tags: 2-5 kurze Schlagworte (Küche, Eigenschaft, Gerichtart).
8. Titel ohne Diät-Präfix und ohne Anführungszeichen, unterschiedlich formuliert.

SCHEMA
{"recipes":[{"title":"...","description":"...","servings":2,"prepMinutes":15,"totalMinutes":35,"difficulty":"leicht","tags":["..."],"ingredients":[{"name":"...","amount":200,"unit":"g"}],"steps":["..."],"nutrition":{"kcal":520,"protein":32,"carbs":48,"fat":20}}]}`;
}

/** Modelle liefern gelegentlich unquoted Werte ("difficulty":leicht) — reparieren statt aufgeben. */
function parseLoose(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    const repaired = slice
      .replace(/:\s*(leicht|mittel|schwer)\b/g, ':"$1"')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(repaired);
  }
}

async function callDeepSeek(prompt) {
  const res = await fetch(`${(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify({
      model: process.env.AI_DEEPSEEK_MODEL || 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Du antwortest ausschließlich mit gültigem JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.95,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '';
  return parseLoose(raw).recipes ?? [];
}

/** Diät-Tags: die angeforderte Form plus alles, was sich aus Zutaten/Nährwerten sicher ableiten lässt. */
function DIET_TAGS(diet) {
  return [diet];
}

function derivedDiets(recipe, diet) {
  const out = [];
  const text = JSON.stringify(recipe).toLowerCase();
  if (recipe.nutrition?.protein >= 30) out.push('high protein');
  if (recipe.nutrition?.kcal > 0 && recipe.nutrition.kcal <= 500) out.push('kalorienbewusst');
  if (recipe.nutrition?.carbs != null && recipe.nutrition.carbs <= 25) out.push('low carb');
  if (/vegan/.test(diet)) out.push('vegetarisch');
  return out.filter((d) => d !== diet);
}

async function store(recipe, cuisine, diet) {
  if (!recipe?.title || !Array.isArray(recipe.ingredients) || !Array.isArray(recipe.steps)) return false;
  const exists = await pool.query('SELECT 1 FROM recipes WHERE lower(title) = lower($1) AND status = $2 LIMIT 1', [recipe.title.trim(), 'active']);
  if (exists.rowCount) { skipped += 1; return false; }
  const tags = [...new Set([...(recipe.tags ?? []), cuisine, diet].map((t) => String(t).slice(0, 24)))].slice(0, 8);
  await pool.query(
    `INSERT INTO recipes (household_id, owner_id, title, description, servings, prep_minutes, total_minutes, difficulty, tags, source, ingredients, steps, nutrition, status, diets, cuisines, allergens)
     VALUES (NULL, NULL, $1,$2,$3,$4,$5,$6,$7,'seed',$8::jsonb,$9::jsonb,$10::jsonb,'active',$11::text[],$12::text[],'{}')`,
    [
      recipe.title.trim().slice(0, 160),
      String(recipe.description ?? '').slice(0, 600),
      Math.min(12, Math.max(1, Number(recipe.servings) || 2)),
      Number(recipe.prepMinutes) || null,
      Number(recipe.totalMinutes) || null,
      ['leicht', 'mittel', 'schwer'].includes(recipe.difficulty) ? recipe.difficulty : 'mittel',
      tags,
      JSON.stringify(recipe.ingredients.filter((i) => i?.name).map((i) => ({ name: String(i.name).slice(0, 80), amount: i.amount ?? null, unit: String(i.unit ?? '').slice(0, 20) }))),
      JSON.stringify(recipe.steps.map((s) => String(s).slice(0, 400)).filter(Boolean)),
      JSON.stringify(recipe.nutrition ?? {}),
      [...new Set([...DIET_TAGS(diet), ...derivedDiets(recipe, diet)])],
      [cuisine],
    ],
  );
  inserted += 1;
  return true;
}

const onlyFirst = process.env.SEED_LIMIT ? Number(process.env.SEED_LIMIT) : 0;
const cuisineFilter = (process.env.SEED_CUISINES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const activeCuisines = cuisineFilter.length ? CUISINES.filter((c) => cuisineFilter.includes(c)) : CUISINES;
const combos = [];
for (const cuisine of activeCuisines) for (const diet of DIETS) combos.push({ cuisine, diet });
if (onlyFirst) combos.length = onlyFirst;

let cursor = 0;
async function worker(id) {
  while (cursor < combos.length) {
    const combo = combos[cursor++];
    try {
      let recipes = [];
      for (let attempt = 1; attempt <= 2 && !recipes.length; attempt++) {
        recipes = await callDeepSeek(buildPrompt(combo.cuisine, combo.diet, PER_COMBO)).catch((e) => {
          console.log(`[${id}] ${combo.cuisine}/${combo.diet} Versuch ${attempt}: ${e.message.slice(0, 120)}`);
          return [];
        });
      }
      for (const r of recipes) await store(r, combo.cuisine, combo.diet);
      console.log(`[${id}] ${combo.cuisine}/${combo.diet}: ${recipes.length} erhalten (gesamt ${inserted}, übersprungen ${skipped}, Fehler ${failed})`);
    } catch (e) {
      failed += 1;
      console.log(`[${id}] ${combo.cuisine}/${combo.diet} FEHLER: ${e.name}: ${e.message} | ${(e.stack ?? '').split('\n')[1] ?? ''}`);
    }
  }
}

await Promise.all(Array.from({ length: PARALLEL }, (_, i) => worker(i + 1)));
console.log(`FERTIG: ${inserted} neu, ${skipped} übersprungen, ${failed} Fehler`);
await pool.end();
