import { Router } from 'express';
import { pool } from './db';
import { fail, requireHousehold, type AuthRequest } from './guards';
import type { Ingredient } from './recipeSchema';
import { completeAiJson } from './ai';
import { schaetzePreis } from './prices';
import { standardMenge } from './einheiten';
import { broadcast } from './events';

export const CATEGORIES = [
  { id: 'obst-gemuese', label: 'Obst & Gemüse' },
  { id: 'milchprodukte', label: 'Milchprodukte & Eier' },
  { id: 'fleisch-fisch', label: 'Fleisch & Fisch' },
  { id: 'brot-backwaren', label: 'Brot & Backwaren' },
  { id: 'vorrat', label: 'Nudeln, Reis & Vorrat' },
  { id: 'tiefkuehl', label: 'Tiefkühl' },
  { id: 'getraenke', label: 'Getränke' },
  { id: 'gewuerze', label: 'Gewürze & Saucen' },
  { id: 'haushalt', label: 'Haushalt & Drogerie' },
  { id: 'sonstiges', label: 'Sonstiges' },
] as const;

type CategoryId = (typeof CATEGORIES)[number]['id'];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as string[];

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

/** Schlüsselwörter für die Sortierung nach Supermarkt-Logik (kostenlos, ohne KI-Aufruf). */
const KEYWORDS: Array<{ category: CategoryId; words: string[] }> = [
  {
    category: 'obst-gemuese',
    words: [
      'apfel', 'äpfel', 'banane', 'beere', 'birne', 'erdbeere', 'himbeere', 'heidelbeere', 'zitrone', 'limette',
      'orange', 'pfirsich', 'traube', 'melone', 'mango', 'avocado', 'tomate', 'gurke', 'salat', 'zwiebel', 'knoblauch',
      'kartoffel', 'süßkartoffel', 'paprika', 'zucchini', 'aubergine', 'karotte', 'möhre', 'lauch', 'sellerie', 'spinat',
      'brokkoli', 'blumenkohl', 'kohl', 'rosenkohl', 'kürbis', 'pilz', 'champignon', 'ingwer', 'kraut', 'petersilie',
      'basilikum', 'koriander', 'minze', 'dill', 'gemüse', 'obst', 'frühlingszwiebel', 'bohne', 'erbse', 'mais',
      // Kuerbissorten und Gemuese, die kein Grundwort enthalten
      'hokkaido', 'butternut', 'spaghettikürbis', 'chicorée', 'chicoree', 'fenchel', 'radieschen', 'rettich',
      'kopfsalat', 'eisbergsalat', 'romana', 'feldsalat', 'endivie', 'pak choi', 'pak-choi', 'mangold', 'wirsing',
      'rotkohl', 'weißkohl', 'chinakohl', 'spitzkohl', 'kohlrabi', 'pastinake', 'steckrübe', 'rote bete',
    ],
  },
  {
    category: 'gewuerze',
    words: [
      // Gewürze zuerst, damit sie nicht in „Sonstiges“ landen. Längere Wörter vor kürzeren:
      // „paprikapulver“ vor „paprika“ (das ist Gemüse und steht in obst-gemuese).
      'paprikapulver', 'paprika edelsüß', 'paprika rosenscharf', 'chilipulver', 'chiliflocken',
      'currypulver', 'knoblauchpulver', 'zwiebelpulver', 'kümmel', 'oregano', 'thymian', 'rosmarin',
      'zimt', 'muskat', 'kurkuma', 'lorbeer', 'koriandersamen', 'senfkörner', 'vanillezucker',
      'backpulver', 'natron', 'hefe', 'gewürz', 'suppenwürze', 'brühpulver', 'salz', 'pfeffer',
      'curry', 'chili', 'senf', 'essig', 'zucker', 'honig', 'salbei', 'brühe', 'bouillon',
      'sojasauce', 'fischsauce', 'worcestersauce',
      // Oel, Essig und Saucen: Grundausstattung wie Gewuerze — hat man zu Hause.
      // Steht hier und NICHT im Vorrat, sonst liegt "Oel" bei Nudeln und Reis
      // und "Olivenoel" als eigene Position daneben.
      'olivenöl', 'rapsöl', 'kokosöl', 'öl', 'essig', 'sauce', 'soße', 'ketchup',
      'mayonnaise', 'mayo', 'dressing', 'pesto',
    ],
  },
  {
    category: 'milchprodukte',
    // Kaesesorten einzeln: "Gouda" enthaelt kein "kaese" und landete vorher in Sonstiges.
    words: ['milch', 'quark', 'joghurt', 'jogurt', 'skyr', 'käse', 'gouda', 'emmentaler', 'bergkäse', 'butterkäse',
      'tilsiter', 'edamer', 'feta', 'parmesan', 'mozzarella', 'butter', 'sahne', 'schmand', 'crème', 'creme fraiche',
      'frischkäse', 'ei', 'eier', 'hüttenkäse', 'mascarpone', 'sahnejoghurt', 'kondensmilch'],
  },
  {
    category: 'fleisch-fisch',
    words: ['hack', 'hähnchen', 'hühnchen', 'huhn', 'pute', 'rind', 'schwein', 'fleisch', 'steak', 'filet', 'schnitzel',
      'wurst', 'schinken', 'salami', 'speck', 'lachs', 'fisch', 'thunfisch', 'garnele', 'garnelen', 'forelle', 'kabeljau'],
  },
  {
    category: 'brot-backwaren',
    words: ['brot', 'brötchen', 'baguette', 'toast', 'ciabatta', 'croissant', 'kuchen', 'gebäck', 'brezel', 'wrap', 'tortilla'],
  },
  {
    category: 'tiefkuehl',
    words: ['tiefkühl', 'tk-', 'gefroren', 'eiscreme', 'eis '],
  },
  {
    category: 'getraenke',
    words: ['wasser', 'saft', 'bier', 'wein', 'sekt', 'limonade', 'cola', 'schorle', 'getränk', 'tee '],
  },
  {
    category: 'gewuerze',
    words: ['salz', 'pfeffer', 'paprikapulver', 'curry', 'oregano', 'thymian', 'rosmarin', 'zimt', 'muskat', 'chili',
      'kreuzkümmel', 'kümmel', 'gewürz', 'sauce', 'soße', 'senf', 'ketchup', 'mayonnaise', 'mayo', 'essig', 'sojasauce',
      'brühe', 'bouillon', 'hefe', 'vanille', 'kurkuma', 'ingwerpulver'],
  },
  {
    category: 'vorrat',
    words: ['reis', 'pasta', 'nudel', 'spaghetti', 'penne', 'couscous', 'bulgur', 'quinoa', 'polenta', 'mehl', 'zucker',
      'haferflocken', 'müsli', 'linsen', 'kichererbsen', 'bohnen', 'kokosmilch', 'passierte tomate', 'dosentomate',
      'konserve', 'dose', 'öl', 'olivenöl', 'rapsöl', 'kokosöl', 'nuss', 'nüsse', 'mandel', 'walnuss', 'erdnuss',
      'sesam', 'samen', 'tofu', 'tempeh', 'hummus', 'pesto', 'olive', 'kapern', 'getrocknete'],
  },
  {
    category: 'haushalt',
    words: ['spülmittel', 'klopapier', 'toilettenpapier', 'küchenrolle', 'alufolie', 'frischhaltefolie', 'backpapier',
      'müllbeutel', 'seife', 'waschmittel', 'schwamm', 'putz', 'batterie', 'kerze', 'serviette'],
  },
];

/**
 * Reihenfolge = Priorität: spezifische Kategorien (Gewürze, Haushalt, Getränke) vor den breiten
 * (Obst & Gemüse), damit z. B. „Gemüsebrühe" nicht beim Gemüse landet.
 */
const CATEGORY_ORDER: CategoryId[] = [
  'gewuerze',
  'haushalt',
  'tiefkuehl',
  'getraenke',
  'fleisch-fisch',
  'milchprodukte',
  'brot-backwaren',
  'vorrat',
  'obst-gemuese',
];

const WORD_BOUNDARY = /[a-zäöüß]/;

/**
 * Woerter, die immer Obst/Gemuese sind — auch wenn sie ein Wort aus einer anderen
 * Kategorie enthalten ("Butternut" -> "butter").
 */
const GEMUESE_VORRANG = [
  'butternut', 'hokkaido', 'spaghettikürbis', 'kürbis', 'pastinake', 'steckrübe', 'rote bete',
  'kohlrabi', 'fenchel', 'radieschen', 'rettich', 'mangold', 'wirsing', 'rotkohl', 'weißkohl',
  'chinakohl', 'spitzkohl', 'pak choi', 'pak-choi', 'chicorée', 'chicoree', 'feldsalat',
  'eisbergsalat', 'kopfsalat', 'romana', 'endivie', 'rucola', 'zucchini', 'aubergine',
];

export function guessCategory(name: string): CategoryId {
  const n = name.toLowerCase();

  /*
   * Eindeutige Gemuese- und Obstwoerter zuerst pruefen.
   *
   * Sonst gewinnt eine Teilzeichenkette aus einer anderen Kategorie: "Butternut"
   * enthaelt "butter" und landete in Milchprodukten, "Hokkaido" ganz in Sonstiges.
   */
  for (const wort of GEMUESE_VORRANG) {
    if (n.includes(wort)) return 'obst-gemuese';
  }

  for (const category of CATEGORY_ORDER) {
    // Frueher stand hier `.find(...)` — damit galt pro Kategorie nur der ERSTE
    // Block. Der zweite Gewuerze-Block (Sauce, Ketchup, Mayo, Essig) wurde nie
    // ausgewertet, deshalb landeten Saucen in "Sonstiges".
    const bloecke = KEYWORDS.filter((k) => k.category === category);
    for (const entry of bloecke) {
    for (const word of entry.words) {
      if (word.length <= 3) {
        // Kurze Wörter wie „ei" nur als eigenständiges Wort, sonst trifft „Risottoreis" oder „Salbei".
        let index = n.indexOf(word);
        while (index >= 0) {
          const before = n[index - 1];
          const after = n[index + word.length];
          if ((!before || !WORD_BOUNDARY.test(before)) && (!after || !WORD_BOUNDARY.test(after))) {
            return entry.category;
          }
          index = n.indexOf(word, index + 1);
        }
      } else if (n.includes(word)) {
        return entry.category;
      }
    }
    }
  }
  return 'sonstiges';
}

/** KI-Sortierung für frei eingetippte Artikel; fällt bei Fehlern auf die Stichwortliste zurück. */
async function categorize(name: string): Promise<CategoryId> {
  const guessed = guessCategory(name);
  if (guessed !== 'sonstiges') return guessed;
  try {
    const raw = await completeAiJson(
      `Ordne diesen Einkaufsartikel genau einer Kategorie zu: "${name}".
Kategorien: ${CATEGORIES.map((c) => `${c.id} (${c.label})`).join(', ')}.
Antworte NUR mit JSON: {"category":"<id>"}`,
      20_000,
    );
    const parsed = JSON.parse(raw) as { category?: string };
    if (parsed.category && CATEGORY_IDS.includes(parsed.category)) return parsed.category as CategoryId;
  } catch {
    /* Fallback bleibt 'sonstiges' */
  }
  return guessed;
}

/**
 * Namen für die Einkaufsliste zusammenfassen: Zusätze in Klammern („(zum Abschmecken)“,
 * „(zum Kochen)“, „(gemahlen)“) und Eigenschaftswörter („edelsüß“, „gemahlen“, „reif“)
 * interessieren beim Einkaufen nicht — sie würden dieselbe Zutat mehrfach in die Liste schreiben.
 */
const QUALIFIER_WORDS = new Set([
  'edelsüß', 'edelsuess', 'rosenscharf', 'gemahlen', 'gemahlene', 'gemahlener', 'getrocknet',
  'getrocknete', 'getrockneter', 'frisch', 'frische', 'frischer', 'gehackt', 'gehackte', 'gehackter',
  'fein', 'feine', 'feiner', 'grob', 'grobe', 'grober', 'gerieben', 'geriebene', 'geriebener',
  'klein', 'kleine', 'kleiner', 'schwarz', 'schwarze', 'schwarzer', 'weiß', 'weiße', 'weißer',
  'rot', 'rote', 'roter', 'reif', 'reife', 'reifer', 'altbacken', 'altbackene', 'altbackener',
  'tiefgekühlt', 'tk', 'natur', 'pur', 'frischgerieben',
]);

/** Gleiche Zutat, anderer Name — beim Einkaufen ist das eine Position. */
const SYNONYMS: Record<string, string> = {
  knoblauchzehe: 'knoblauch',
  knoblauchzehen: 'knoblauch',
  zwiebeln: 'zwiebel',
  karotten: 'karotte',
  möhren: 'möhre',
  eier: 'ei',
};

export function shoppingName(name: string): string {
  const withoutBrackets = String(name ?? '').replace(/\([^)]*\)/g, ' ');
  const words = withoutBrackets
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const meaningful = words.filter((w) => !QUALIFIER_WORDS.has(w.toLowerCase()));
  // Nie alles wegstreichen: steht nur ein Eigenschaftswort da, bleibt der Originalname.
  const kept = meaningful.length ? meaningful : words;
  const joined = kept.join(' ').replace(/\s+/g, ' ').trim();
  if (!joined) return String(name ?? '').trim();
  const canonical = SYNONYMS[joined.toLowerCase()];
  if (canonical) return canonical.charAt(0).toUpperCase() + canonical.slice(1);
  return joined;
}

/** Einheiten in eine gemeinsame Familie bringen, damit Mengen addiert werden können. */
const UNIT_FAMILIES: Record<string, { family: string; factor: number }> = {
  g: { family: 'gewicht', factor: 1 },
  kg: { family: 'gewicht', factor: 1000 },
  ml: { family: 'fluessig', factor: 1 },
  l: { family: 'fluessig', factor: 1000 },
  tl: { family: 'loeffel', factor: 1 },
  el: { family: 'loeffel', factor: 3 },
  prise: { family: 'loeffel', factor: 0.1 },
  pris: { family: 'loeffel', factor: 0.1 },
  messerspitze: { family: 'loeffel', factor: 0.05 },
  stueck: { family: 'stueck:stück', factor: 1 },
  'stück': { family: 'stueck:stück', factor: 1 },
  zehe: { family: 'stueck:zehe', factor: 1 },
  zehen: { family: 'stueck:zehe', factor: 1 },
  scheibe: { family: 'stueck:scheibe', factor: 1 },
  scheiben: { family: 'stueck:scheibe', factor: 1 },
  bund: { family: 'stueck:bund', factor: 1 },
  dose: { family: 'stueck:dose', factor: 1 },
  dosen: { family: 'stueck:dose', factor: 1 },
  becher: { family: 'stueck:becher', factor: 1 },
  packung: { family: 'stueck:packung', factor: 1 },
  stange: { family: 'stueck:stange', factor: 1 },
  handvoll: { family: 'stueck:handvoll', factor: 1 },
};

function roundNice(value: number): number {
  const step = value < 1 ? 0.25 : 0.5;
  return Math.max(step, Math.round(value / step) * step);
}

/** Summierte Menge in eine lesbare Einheit zurückrechnen. */
function displayAmount(family: string, total: number, fallbackUnit: string): { amount: number; unit: string } {
  if (family === 'gewicht') {
    return total >= 1000
      ? { amount: Math.round((total / 1000) * 10) / 10, unit: 'kg' }
      : { amount: Math.round(total), unit: 'g' };
  }
  if (family === 'fluessig') {
    return total >= 1000
      ? { amount: Math.round((total / 1000) * 10) / 10, unit: 'l' }
      : { amount: Math.round(total), unit: 'ml' };
  }
  if (family === 'loeffel') {
    // Ab einem Esslöffel wird umgerechnet (1 EL = 3 TL), darunter bleibt es beim Teelöffel.
    return total >= 3
      ? { amount: roundNice(total / 3), unit: 'EL' }
      : { amount: roundNice(total), unit: 'TL' };
  }
  return { amount: roundNice(total), unit: fallbackUnit };
}

/**
 * Durchschnittsgewicht je Stück (in Gramm) für Lebensmittel, die im Supermarkt
 * nach Gewicht verkauft werden.
 *
 * Zweck: „3 Tomaten" und „400 g Tomaten" sind dieselbe Zutat und müssen zu einer
 * Zeile zusammenfallen. Ohne Umrechnung stehen sie doppelt auf der Liste, weil
 * die Einheiten-Familie unterschiedlich ist (Stück vs. Gewicht).
 */
const GRAMM_PRO_STUECK: Record<string, number> = {
  tomate: 80,
  tomaten: 80,
  'kirschtomate': 15,
  'kirschtomaten': 15,
  'rispentomate': 90,
  'rispentomaten': 90,
  kartoffel: 150,
  kartoffeln: 150,
  zwiebel: 110,
  zwiebeln: 110,
  'rote zwiebel': 110,
  'rote zwiebeln': 110,
  möhre: 80,
  möhren: 80,
  karotte: 80,
  karotten: 80,
  gurke: 400,
  salatgurke: 400,
  paprika: 180,
  'paprika (rot)': 180,
  'paprika (gelb)': 180,
  'paprika (grün)': 180,
  zucchini: 250,
  aubergine: 300,
  'süßkartoffel': 250,
  'süßkartoffeln': 250,
  apfel: 150,
  äpfel: 150,
  birne: 180,
  birnen: 180,
  banane: 120,
  bananen: 120,
  orange: 180,
  orangen: 180,
  zitrone: 100,
  zitronen: 100,
  limette: 70,
  limetten: 70,
  avocado: 200,
  lauch: 200,
  'stange lauch': 200,
  sellerie: 400,
  'stange sellerie': 400,
  brokkoli: 400,
  blumenkohl: 600,
  champignon: 15,
  champignons: 15,
  knoblauchzehe: 5,
  knoblauchzehen: 5,
  'pute': 200,
  ei: 55,
  eier: 55,
};

/** Automatische Artikel aus dem Wochenplan neu berechnen (Prüfstatus und manuelle Artikel bleiben). */
async function rebuildAutoItems(householdId: string, weekStart: string): Promise<void> {
  const rows = await pool.query<{ servings: number; entry_servings: number | null; ingredients: Ingredient[] }>(
    `SELECT r.servings, e.servings AS entry_servings, r.ingredients
       FROM plan_entries e
       JOIN meal_plans p ON p.id = e.plan_id
       JOIN recipes r ON r.id = e.recipe_id
      WHERE p.household_id = $1 AND p.week_start = $2`,
    [householdId, weekStart],
  );

  type Bucket = { name: string; family: string; unit: string; base: number; unknown: boolean };
  const items = new Map<string, Bucket>();
  for (const row of rows.rows) {
    const factor = row.entry_servings && row.servings ? row.entry_servings / row.servings : 1;
    for (const ing of row.ingredients ?? []) {
      const rawName = String(ing.name ?? '').trim();
      if (!rawName) continue;
      const name = shoppingName(rawName);
      const unitKey = String(ing.unit ?? '').trim().toLowerCase();
      const mengeRoh = typeof ing.amount === 'number' && Number.isFinite(ing.amount) ? ing.amount : null;

      /*
       * Immer in Gramm, wenn das Lebensmittel so verkauft wird.
       *
       * Tim kauft Tomaten in Schalen, nicht nach Stück — „3 Stück" und „400 g"
       * standen vorher als zwei Positionen auf der Liste. Für alles, was nach
       * Gewicht verkauft wird, rechnen wir Stück in Gramm um, damit dieselbe
       * Zutat zu einer Zeile zusammenfällt.
       */
      /*
       * Einheit vereinheitlichen: jedes Lebensmittel hat genau eine Einheit,
       * in der es überall geführt wird (Tomaten in g, Zwiebeln in Stück,
       * Salz in TL). Das verhindert „Salz 1 TL" und „Salz 1 Prise" nebeneinander.
       */
      const standard = standardMenge(name, mengeRoh, unitKey);

      const grammProStueck = GRAMM_PRO_STUECK[name.toLowerCase()];
      let menge = typeof ing.amount === 'number' && Number.isFinite(ing.amount) ? ing.amount : null;
      let unitInfo = UNIT_FAMILIES[unitKey];

      /*
       * Erste Wahl: die vereinheitlichte Einheit aus der Tabelle.
       * Nur wenn sie nichts liefert, greift die alte Stück→Gramm-Logik.
       */
      let einheitStd = unitKey;
      if (standard) {
        menge = standard.amount;
        einheitStd = standard.einheit.toLowerCase();
        unitInfo = UNIT_FAMILIES[einheitStd] ?? unitInfo;
      } else if (grammProStueck && (unitKey === 'stueck' || unitKey === 'stück') && menge != null) {
        // Stück → Gramm: 3 Tomaten sind 3 × 80 g.
        menge = menge * grammProStueck;
        unitInfo = UNIT_FAMILIES.g;
      }

      if (menge == null) {
        const keyLeer = `${name.toLowerCase()}|${unitInfo?.family ?? `eigen:${unitKey}`}`;
        const vorhanden =
          items.get(keyLeer) ??
          { name, family: unitInfo?.family ?? `eigen:${unitKey}`, unit: UNIT_LABELS[unitKey] ?? String(ing.unit ?? '').trim(), base: 0, unknown: false };
        vorhanden.unknown = true;
        items.set(keyLeer, vorhanden);
        continue;
      }

      const family = unitInfo?.family ?? `eigen:${einheitStd}`;
      const key = `${name.toLowerCase()}|${family}`;
      const unitLabel =
        UNIT_LABELS[einheitStd] ?? standard?.einheit ?? String(ing.unit ?? '').trim();
      const current =
        items.get(key) ?? { name, family, unit: unitLabel, base: 0, unknown: false };
      current.base += menge * factor * (unitInfo?.factor ?? 1);
      items.set(key, current);
    }
  }

  const prepared = new Map<string, { name: string; unit: string; amount: number | null }>();
  for (const [key, bucket] of items) {
    const shown = bucket.unknown
      ? { amount: null, unit: bucket.unit }
      : displayAmount(bucket.family, bucket.base, bucket.unit);
    prepared.set(key, { name: bucket.name, unit: shown.unit, amount: shown.amount });
  }

  const existing = await pool.query<{ key: string }>(
    "SELECT key FROM shopping_items WHERE household_id = $1 AND week_start = $2 AND source = 'auto'",
    [householdId, weekStart],
  );
  const existingKeys = new Set(existing.rows.map((r) => r.key));

  for (const [key, item] of prepared) {
    await pool.query(
      `INSERT INTO shopping_items (household_id, week_start, key, name, amount, unit, category, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'auto')
       ON CONFLICT (household_id, week_start, key)
       DO UPDATE SET name = EXCLUDED.name, amount = EXCLUDED.amount, unit = EXCLUDED.unit,
                     category = EXCLUDED.category, updated_at = now()`,
      [householdId, weekStart, key, item.name, item.amount, item.unit, guessCategory(item.name)],
    );
    existingKeys.delete(key);
  }
  for (const staleKey of existingKeys) {
    await pool.query("DELETE FROM shopping_items WHERE household_id = $1 AND week_start = $2 AND key = $3 AND source = 'auto'", [
      householdId,
      weekStart,
      staleKey,
    ]);
  }
}

async function loadList(householdId: string, weekStart: string) {
  const rows = await pool.query<{
    id: string;
    name: string;
    amount: string | null;
    unit: string;
    category: string;
    checked: boolean;
    source: string;
    created_by: number | null;
  }>(
    `SELECT id, name, amount, unit, category, checked, source, created_by
       FROM shopping_items WHERE household_id = $1 AND week_start = $2
      ORDER BY category ASC, lower(name) ASC`,
    [householdId, weekStart],
  );
  const items = rows.rows.map((r) => {
    const amount = r.amount != null ? Number(r.amount) : null;
    const preis = schaetzePreis(r.name, amount, r.unit);
    return {
      id: r.id,
      name: r.name,
      amount,
      unit: r.unit,
      category: r.category,
      checked: r.checked,
      source: r.source,
      createdBy: r.created_by,
      /** Geschaetzter Preis in Euro; null bei Gewuerzen und Grundausstattung. */
      price: preis.euro,
      /** Warum kein Preis (z. B. 'Gewürz'), sonst null. */
      priceNote: preis.grund,
      /** Bezugspreis zur Einordnung, z. B. „≈ 8,73 €/kg“. */
      priceBasis: preis.basis,
    };
  });

  /*
   * Wochensumme: nur offene Artikel zaehlen, denn was schon im Korb liegt, ist
   * gekauft. Gewuerze und Grundausstattung haben keinen Preis und werden
   * mitgezaehlt in der Anzahl, aber nicht in der Summe.
   */
  const mitPreis = items.filter((i) => i.price != null);
  const offen = items.filter((i) => !i.checked);
  const offenMitPreis = offen.filter((i) => i.price != null);

  const summe = (liste: typeof items) =>
    Math.round(liste.reduce((a, i) => a + (i.price ?? 0), 0) * 100) / 100;

  return {
    weekStart,
    categories: CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      items: items.filter((i) => i.category === c.id),
      /** Summe der Kategorie (nur Artikel mit Preis). */
      sum: summe(items.filter((i) => i.category === c.id)),
    })).filter((c) => c.items.length > 0),
    items,
    openCount: offen.length,
    totalCount: items.length,
    /** Geschaetzte Gesamtkosten der Woche (alle Artikel mit Preis). */
    estimatedTotal: summe(mitPreis),
    /** Was noch zu kaufen ist — der realistische Wert fuer „diese Woche kostet“. */
    estimatedOpen: summe(offenMitPreis),
    pricedCount: mitPreis.length,
    unpricedCount: items.length - mitPreis.length,
  };
}

export const shoppingRouter = Router();

shoppingRouter.get('/:householdId/:weekStart', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.weekStart)) {
    fail(res, 400, 'invalid-date', 'Datum im Format YYYY-MM-DD angeben.');
    return;
  }
  await rebuildAutoItems(req.params.householdId, req.params.weekStart);
  res.json(await loadList(req.params.householdId, req.params.weekStart));
});

/** Ein Button, ein Feld: Artikel eintragen — die Kategorie bestimmt die KI. */
shoppingRouter.post('/:householdId/:weekStart/items', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const body = req.body as { name?: string; amount?: number | null; unit?: string };
  const name = String(body.name ?? '').trim();
  if (name.length < 2 || name.length > 120) {
    fail(res, 400, 'invalid-input', 'Artikelname zwischen 2 und 120 Zeichen.');
    return;
  }
  const category = await categorize(name);
  const key = `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(
    `INSERT INTO shopping_items (household_id, week_start, key, name, amount, unit, category, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8)`,
    [
      req.params.householdId,
      req.params.weekStart,
      key,
      name,
      body.amount != null && Number.isFinite(Number(body.amount)) ? Number(body.amount) : null,
      String(body.unit ?? '').trim(),
      category,
      req.userId,
    ],
  );
  broadcast(req.params.householdId, 'shopping', { von: req.userId ?? null });
  res.status(201).json(await loadList(req.params.householdId, req.params.weekStart));
});

shoppingRouter.patch('/:householdId/:weekStart/items/:itemId', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const checked = Boolean((req.body as { checked?: boolean }).checked);
  const updated = await pool.query(
    `UPDATE shopping_items SET checked = $1, updated_at = now()
      WHERE id = $2 AND household_id = $3 AND week_start = $4 RETURNING id`,
    [checked, req.params.itemId, req.params.householdId, req.params.weekStart],
  );
  if (!updated.rowCount) {
    fail(res, 404, 'not-found', 'Artikel nicht gefunden.');
    return;
  }
  broadcast(req.params.householdId, 'shopping', { von: req.userId ?? null });
  res.json(await loadList(req.params.householdId, req.params.weekStart));
});

shoppingRouter.delete('/:householdId/:weekStart/items/:itemId', async (req: AuthRequest, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId!);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  await pool.query(
    `DELETE FROM shopping_items WHERE id = $1 AND household_id = $2 AND week_start = $3 AND source = 'manual'`,
    [req.params.itemId, req.params.householdId, req.params.weekStart],
  );
  broadcast(req.params.householdId, 'shopping', { von: req.userId ?? null });
  res.json(await loadList(req.params.householdId, req.params.weekStart));
});
