import { pool } from './db';

/**
 * Diät-, Küchen- und Allergen-Merkmale eines Rezepts aus Titel, Tags und Zutaten ableiten.
 * Bewusst regelbasiert: die Merkmale müssen auch für Altrezepte ohne KI-Lauf entstehen,
 * und der Rezeptfilter soll nie „leer" wirken.
 */
const ALLERGEN_RULES: Array<{ allergen: string; words: string[] }> = [
  { allergen: 'Nüsse', words: ['nuss', 'nüsse', 'mandel', 'walnuss', 'haselnuss', 'cashew', 'pistazie', 'pekan'] },
  { allergen: 'Erdnüsse', words: ['erdnuss', 'erdnüsse', 'peanut'] },
  {
    allergen: 'Gluten',
    words: ['mehl', 'weizen', 'brot', 'brötchen', 'nudel', 'pasta', 'spaghetti', 'penne', 'semmel', 'bulgur', 'couscous', 'dinkel', 'gerste', 'roggen', 'panko', 'paniermehl', 'kuchen', 'teig'],
  },
  {
    allergen: 'Laktose',
    words: ['milch', 'sahne', 'butter', 'quark', 'joghurt', 'jogurt', 'käse', 'parmesan', 'mozzarella', 'schmand', 'frischkäse', 'creme fraiche', 'buttermilch'],
  },
  { allergen: 'Ei', words: ['ei', 'eier', 'eigelb', 'eiweiß', 'eiweiss', 'mayonnaise'] },
  { allergen: 'Soja', words: ['soja', 'tofu', 'edamame', 'tempeh', 'teriyaki', 'sojasauce'] },
  { allergen: 'Fisch', words: ['fisch', 'lachs', 'thunfisch', 'kabeljau', 'sardine', 'forelle', 'hering', 'anchovis'] },
  { allergen: 'Meeresfrüchte', words: ['garnele', 'garnelen', 'shrimp', 'muschel', 'kalmar', 'scampi', 'meeresfrüchte', 'oktopus'] },
  { allergen: 'Schweinefleisch', words: ['schwein', 'speck', 'schinken', 'bacon', 'salami', 'chorizo', 'bratwurst'] },
  { allergen: 'Pilze', words: ['pilz', 'pilze', 'champignon', 'shiitake', 'pfifferling', 'steinpilz', 'austernpilz'] },
  { allergen: 'Sellerie', words: ['sellerie'] },
  { allergen: 'Sesam', words: ['sesam', 'tahin', 'tahini', 'halva'] },
];

// „filet" bewusst nicht: Lachsfilet ist Fisch, kein Fleisch
const MEAT_WORDS = ['fleisch', 'huhn', 'hähnchen', 'haehnchen', 'pute', 'rind', 'schwein', 'lamm', 'hackfleisch', 'hack', 'wurst', 'speck', 'schinken', 'bacon', 'salami', 'chorizo', 'ente', 'gulasch', 'steak'];
const FISH_WORDS = ['fisch', 'lachs', 'thunfisch', 'kabeljau', 'forelle', 'hering', 'garnele', 'garnelen', 'shrimp', 'muschel', 'scampi'];

const CUISINE_RULES: Array<{ cuisine: string; words: string[] }> = [
  { cuisine: 'Italienisch', words: ['pasta', 'spaghetti', 'penne', 'risotto', 'pizza', 'lasagne', 'italien', 'pesto', 'tiramisu', 'carpaccio'] },
  { cuisine: 'Asiatisch', words: ['curry', 'kokosmilch', 'sojasauce', 'wok', 'asia', 'asia', 'sushi', 'ramen', 'teriyaki', 'ingwer', 'limette', 'sesamöl', 'nudeln mit gemüse'] },
  { cuisine: 'Mexikanisch', words: ['taco', 'burrito', 'quesadilla', 'salsa', 'jalapeño', 'mexiko', 'guacamole', 'fajita'] },
  { cuisine: 'Indisch', words: ['indisch', 'masala', 'tikka', 'dal', 'naan', 'kichererbse', 'garam masala', 'paneer'] },
  { cuisine: 'Griechisch', words: ['griech', 'feta', 'tzatziki', 'gyros', 'souvlaki', 'oliven'] },
  { cuisine: 'Türkisch', words: ['türk', 'turk', 'kebab', 'falafel', 'hummus', 'bulgur', 'lahmacun'] },
  { cuisine: 'Französisch', words: ['franz', 'ratatouille', 'quiche', 'creme brulee', 'baguette', 'dijon'] },
  { cuisine: 'Spanisch', words: ['spanisch', 'paella', 'tapas', 'chorizo', 'gazpacho', 'manchego'] },
  { cuisine: 'Amerikanisch', words: ['burger', 'barbecue', 'bbq', 'pancake', 'muffin', 'mac and cheese', 'cornbread'] },
  { cuisine: 'Deutsch', words: ['deutsch', 'schnitzel', 'spätzle', 'spaetzle', 'bratkartoffel', 'sauerkraut', 'kartoffelsalat', 'rouladen', 'kassler'] },
  { cuisine: 'Orientalisch', words: ['oriental', 'falafel', 'hummus', 'tabouleh', 'harissa', 'sumach', 'gewürzmischung'] },
];

export interface RecipeMeta {
  diets: string[];
  cuisines: string[];
  allergens: string[];
}

function haystack(title: string, tags: string[], ingredients: Array<{ name?: string }>, description = '') {
  return [title, description, ...tags, ...ingredients.map((i) => i.name ?? '')]
    .join(' ')
    .toLowerCase();
}

export function deriveMeta(input: {
  title: string;
  description?: string;
  tags?: string[];
  ingredients?: Array<{ name?: string }>;
  nutrition?: { kcal?: number | null; protein?: number | null; carbs?: number | null } | null;
}): RecipeMeta {
  const text = haystack(input.title, input.tags ?? [], input.ingredients ?? [], input.description ?? '');
  // Pflanzenmilch ist keine Laktose — sonst wäre jedes vegane Curry „laktosehaltig"
  const withoutPlantMilk = text.replace(/kokosmilch|mandelmilch|hafermilch|sojamilch|reismilch|pflanzenmilch|cashewmilch/g, ' ');
  const allergens = ALLERGEN_RULES.filter((rule) => {
    const hay = rule.allergen === 'Laktose' ? withoutPlantMilk : text;
    return rule.words.some((w) => hay.includes(w));
  }).map((r) => r.allergen);

  const hasMeat = MEAT_WORDS.some((w) => text.includes(w));
  const hasFish = FISH_WORDS.some((w) => text.includes(w));

  const diets = new Set<string>();
  if (!hasMeat && !hasFish) diets.add('vegetarisch');
  if (!hasMeat && !hasFish && !allergens.some((a) => ['Laktose', 'Ei'].includes(a))) diets.add('vegan');
  if (!hasMeat && hasFish) diets.add('pescetarisch');
  if (!allergens.includes('Gluten')) diets.add('glutenfrei');
  if (!allergens.includes('Laktose')) diets.add('laktosefrei');

  const nutrition = input.nutrition ?? {};
  const carbs = typeof nutrition.carbs === 'number' ? nutrition.carbs : null;
  const protein = typeof nutrition.protein === 'number' ? nutrition.protein : null;
  const kcal = typeof nutrition.kcal === 'number' ? nutrition.kcal : null;
  if (carbs != null && carbs <= 25) diets.add('low carb');
  if (protein != null && protein >= 25) diets.add('high protein');
  if (kcal != null && kcal <= 500) diets.add('kalorienbewusst');

  // Explizite Tags haben Vorrang (z. B. vom KI-Rezept gesetzt)
  for (const tag of input.tags ?? []) {
    const lower = tag.toLowerCase();
    if (['vegetarisch', 'vegan', 'pescetarisch', 'glutenfrei', 'laktosefrei', 'low carb', 'high protein', 'kalorienbewusst'].includes(lower)) {
      diets.add(lower);
    }
  }

  const cuisines = CUISINE_RULES.filter((rule) => rule.words.some((w) => text.includes(w))).map((r) => r.cuisine);

  return { diets: [...diets].sort(), cuisines: [...cuisines].sort(), allergens: [...allergens].sort() };
}

/** Einmalige Nachrüstung für Rezepte, die vor den Filtern entstanden sind. */
export async function backfillRecipeMeta() {
  const rows = await pool.query<{
    id: number;
    title: string;
    description: string | null;
    tags: string[] | null;
    ingredients: Array<{ name?: string }> | null;
    nutrition: { kcal?: number; protein?: number; carbs?: number } | null;
  }>(
    `select id, title, description, tags, ingredients, nutrition from recipes
      where coalesce(array_length(diets, 1), 0) = 0
        and coalesce(array_length(allergens, 1), 0) = 0
        and coalesce(array_length(cuisines, 1), 0) = 0
      limit 500`,
  );
  for (const row of rows.rows) {
    const meta = deriveMeta({
      title: row.title,
      description: row.description ?? '',
      tags: row.tags ?? [],
      ingredients: row.ingredients ?? [],
      nutrition: row.nutrition,
    });
    await pool.query('update recipes set diets = $2, cuisines = $3, allergens = $4 where id = $1', [
      row.id,
      meta.diets,
      meta.cuisines,
      meta.allergens,
    ]);
  }
  return rows.rowCount ?? 0;
}
