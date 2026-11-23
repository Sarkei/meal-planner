/**
 * Einheitliche Einheit je Lebensmittel.
 *
 * Problem: Dasselbe Lebensmittel steht in verschiedenen Rezepten mit
 * unterschiedlichen Einheiten — Salz einmal in TL, einmal in Prise; Ingwer in
 * „cm"; Zitrone in „Spritzer". Auf der Einkaufsliste ist das unbrauchbar, weil
 * man nicht weiß, was man kaufen soll.
 *
 * Lösung: Jedes Lebensmittel bekommt **eine** Einheit, in der es überall geführt
 * wird — so wie man es im Laden kauft:
 *   - Obst und Gemüse, das man einzeln kauft: Stück (Tomate, Zwiebel, Gurke)
 *   - Alles nach Gewicht: g (Mehl, Nudeln, Fleisch, Käse)
 *   - Flüssiges: ml (Milch, Sahne, Öl)
 *   - Gewürze: TL (Salz, Pfeffer, Oregano) — einheitlich als Teelöffel
 *   - Kräuter: Bund (Petersilie, Basilikum)
 *
 * Die Tabelle ist die einzige Quelle für Einheiten; Rezept-Prompt und
 * Einkaufsliste ziehen beide daraus.
 */

export type ZutatEinheit = 'g' | 'ml' | 'Stück' | 'TL' | 'EL' | 'Bund' | 'Zehe' | 'Scheibe' | 'Dose' | 'Packung';

/**
 * Stichwort → Einheit. Reihenfolge zählt: das erste passende Stichwort gewinnt,
 * deshalb stehen Sonderfälle vor allgemeinen Begriffen.
 */
const EINHEITEN: Array<{ wort: string; einheit: ZutatEinheit }> = [
  // ── Gewürze: einheitlich Teelöffel ───────────────────────────────────────
  { wort: 'salz', einheit: 'TL' },
  { wort: 'pfeffer', einheit: 'TL' },
  { wort: 'paprikapulver', einheit: 'TL' },
  { wort: 'chilipulver', einheit: 'TL' },
  { wort: 'chiliflocken', einheit: 'TL' },
  { wort: 'currypulver', einheit: 'TL' },
  { wort: 'curry', einheit: 'TL' },
  { wort: 'oregano', einheit: 'TL' },
  { wort: 'thymian', einheit: 'TL' },
  { wort: 'rosmarin', einheit: 'TL' },
  { wort: 'zimt', einheit: 'TL' },
  { wort: 'muskat', einheit: 'TL' },
  { wort: 'kurkuma', einheit: 'TL' },
  { wort: 'kümmel', einheit: 'TL' },
  { wort: 'kreuzkümmel', einheit: 'TL' },
  { wort: 'lorbeer', einheit: 'Stück' },
  { wort: 'gewürz', einheit: 'TL' },
  { wort: 'vanillezucker', einheit: 'Packung' },
  { wort: 'vanille', einheit: 'TL' },
  { wort: 'backpulver', einheit: 'TL' },
  { wort: 'natron', einheit: 'TL' },
  { wort: 'hefe', einheit: 'Packung' },
  { wort: 'zucker', einheit: 'g' },
  { wort: 'honig', einheit: 'TL' },
  { wort: 'senf', einheit: 'TL' },
  { wort: 'ketchup', einheit: 'EL' },
  { wort: 'mayonnaise', einheit: 'EL' },
  { wort: 'mayo', einheit: 'EL' },
  { wort: 'sojasauce', einheit: 'EL' },
  { wort: 'fischsauce', einheit: 'EL' },
  { wort: 'worcester', einheit: 'EL' },
  { wort: 'essig', einheit: 'EL' },
  { wort: 'brühe', einheit: 'ml' },
  { wort: 'bouillon', einheit: 'ml' },
  { wort: 'suppenwürze', einheit: 'TL' },

  // ── Öle: Esslöffel ───────────────────────────────────────────────────────
  { wort: 'olivenöl', einheit: 'EL' },
  { wort: 'rapsöl', einheit: 'EL' },
  { wort: 'kokosöl', einheit: 'EL' },
  { wort: 'öl', einheit: 'EL' },

  // ── Kräuter: Bund, außer Topf-Basilikum ──────────────────────────────────
  { wort: 'basilikum', einheit: 'Bund' },
  { wort: 'petersilie', einheit: 'Bund' },
  { wort: 'koriander', einheit: 'Bund' },
  { wort: 'minze', einheit: 'Bund' },
  { wort: 'dill', einheit: 'Bund' },
  { wort: 'schnittlauch', einheit: 'Bund' },
  { wort: 'rucola', einheit: 'g' },

  // ── Knoblauch und Zwiebeln: Zehe bzw. Stück ──────────────────────────────
  { wort: 'knoblauch', einheit: 'Zehe' },
  { wort: 'zwiebel', einheit: 'Stück' },
  { wort: 'schalotte', einheit: 'Stück' },
  { wort: 'frühlingszwiebel', einheit: 'Bund' },
  { wort: 'lauch', einheit: 'Stück' },
  { wort: 'sellerie', einheit: 'Stück' },

  // ── Obst und Gemüse, das man einzeln kauft: Stück ────────────────────────
  { wort: 'tomate', einheit: 'g' },
  { wort: 'kirschtomate', einheit: 'g' },
  { wort: 'passierte tomate', einheit: 'g' },
  { wort: 'dosentomate', einheit: 'Dose' },
  { wort: 'tomatenmark', einheit: 'EL' },
  { wort: 'gurke', einheit: 'Stück' },
  { wort: 'paprika', einheit: 'Stück' },
  { wort: 'zucchini', einheit: 'Stück' },
  { wort: 'aubergine', einheit: 'Stück' },
  { wort: 'brokkoli', einheit: 'g' },
  { wort: 'blumenkohl', einheit: 'g' },
  { wort: 'kohlrabi', einheit: 'Stück' },
  { wort: 'salat', einheit: 'Stück' },
  { wort: 'avocado', einheit: 'Stück' },
  { wort: 'zitrone', einheit: 'Stück' },
  { wort: 'limette', einheit: 'Stück' },
  { wort: 'orange', einheit: 'Stück' },
  { wort: 'apfel', einheit: 'Stück' },
  { wort: 'birne', einheit: 'Stück' },
  { wort: 'banane', einheit: 'Stück' },
  { wort: 'mango', einheit: 'Stück' },
  { wort: 'pfirsich', einheit: 'Stück' },
  { wort: 'nektarine', einheit: 'Stück' },
  { wort: 'kiwi', einheit: 'Stück' },
  { wort: 'champignon', einheit: 'g' },
  { wort: 'pilz', einheit: 'g' },
  { wort: 'kartoffel', einheit: 'g' },
  { wort: 'süßkartoffel', einheit: 'g' },
  { wort: 'karotte', einheit: 'Stück' },
  { wort: 'möhre', einheit: 'Stück' },
  { wort: 'kürbis', einheit: 'g' },
  { wort: 'hokkaido', einheit: 'g' },
  { wort: 'ingwer', einheit: 'Stück' },
  { wort: 'spinat', einheit: 'g' },
  { wort: 'beere', einheit: 'g' },
  { wort: 'erdbeere', einheit: 'g' },
  { wort: 'himbeere', einheit: 'g' },
  { wort: 'heidelbeere', einheit: 'g' },
  { wort: 'traube', einheit: 'g' },
  { wort: 'olive', einheit: 'g' },
  { wort: 'kapern', einheit: 'TL' },
  { wort: 'bohne', einheit: 'g' },
  { wort: 'erbse', einheit: 'g' },
  { wort: 'mais', einheit: 'g' },

  // ── Milchprodukte ────────────────────────────────────────────────────────
  { wort: 'milch', einheit: 'ml' },
  { wort: 'sahne', einheit: 'ml' },
  { wort: 'kokosmilch', einheit: 'ml' },
  { wort: 'joghurt', einheit: 'g' },
  { wort: 'jogurt', einheit: 'g' },
  { wort: 'skyr', einheit: 'g' },
  { wort: 'quark', einheit: 'g' },
  { wort: 'schmand', einheit: 'g' },
  { wort: 'crème fraîche', einheit: 'g' },
  { wort: 'creme fraiche', einheit: 'g' },
  { wort: 'frischkäse', einheit: 'g' },
  { wort: 'hüttenkäse', einheit: 'g' },
  { wort: 'butter', einheit: 'g' },
  { wort: 'margarine', einheit: 'g' },
  { wort: 'feta', einheit: 'g' },
  { wort: 'parmesan', einheit: 'g' },
  { wort: 'mozzarella', einheit: 'g' },
  { wort: 'gouda', einheit: 'g' },
  { wort: 'emmentaler', einheit: 'g' },
  { wort: 'bergkäse', einheit: 'g' },
  { wort: 'mascarpone', einheit: 'g' },
  { wort: 'käse', einheit: 'g' },
  { wort: 'ei', einheit: 'Stück' },
  { wort: 'eier', einheit: 'Stück' },

  // ── Fleisch und Fisch: Gramm ─────────────────────────────────────────────
  { wort: 'hackfleisch', einheit: 'g' },
  { wort: 'hack', einheit: 'g' },
  { wort: 'hähnchen', einheit: 'g' },
  { wort: 'hühnchen', einheit: 'g' },
  { wort: 'huhn', einheit: 'g' },
  { wort: 'pute', einheit: 'g' },
  { wort: 'rind', einheit: 'g' },
  { wort: 'schwein', einheit: 'g' },
  { wort: 'fleisch', einheit: 'g' },
  { wort: 'steak', einheit: 'g' },
  { wort: 'filet', einheit: 'g' },
  { wort: 'schnitzel', einheit: 'g' },
  { wort: 'wurst', einheit: 'g' },
  { wort: 'schinken', einheit: 'g' },
  { wort: 'salami', einheit: 'g' },
  { wort: 'speck', einheit: 'g' },
  { wort: 'lachs', einheit: 'g' },
  { wort: 'thunfisch', einheit: 'Dose' },
  { wort: 'garnele', einheit: 'g' },
  { wort: 'garnelen', einheit: 'g' },
  { wort: 'forelle', einheit: 'g' },
  { wort: 'kabeljau', einheit: 'g' },
  { wort: 'fisch', einheit: 'g' },
  { wort: 'tofu', einheit: 'g' },
  { wort: 'tempeh', einheit: 'g' },

  // ── Brot und Backwaren ───────────────────────────────────────────────────
  { wort: 'brot', einheit: 'Scheibe' },
  { wort: 'toast', einheit: 'Scheibe' },
  { wort: 'brötchen', einheit: 'Stück' },
  { wort: 'baguette', einheit: 'Stück' },
  { wort: 'ciabatta', einheit: 'Stück' },
  { wort: 'croissant', einheit: 'Stück' },
  { wort: 'brezel', einheit: 'Stück' },
  { wort: 'wrap', einheit: 'Stück' },
  { wort: 'tortilla', einheit: 'Stück' },

  // ── Vorrat: Gramm ────────────────────────────────────────────────────────
  { wort: 'nudel', einheit: 'g' },
  { wort: 'pasta', einheit: 'g' },
  { wort: 'spaghetti', einheit: 'g' },
  { wort: 'penne', einheit: 'g' },
  { wort: 'basmatireis', einheit: 'g' },
  { wort: 'reis', einheit: 'g' },
  { wort: 'couscous', einheit: 'g' },
  { wort: 'bulgur', einheit: 'g' },
  { wort: 'quinoa', einheit: 'g' },
  { wort: 'polenta', einheit: 'g' },
  { wort: 'mehl', einheit: 'g' },
  { wort: 'haferflocken', einheit: 'g' },
  { wort: 'müsli', einheit: 'g' },
  { wort: 'linsen', einheit: 'g' },
  { wort: 'kichererbsen', einheit: 'Dose' },
  { wort: 'hummus', einheit: 'g' },
  { wort: 'mandel', einheit: 'g' },
  { wort: 'walnuss', einheit: 'g' },
  { wort: 'erdnuss', einheit: 'g' },
  { wort: 'nuss', einheit: 'g' },
  { wort: 'nüsse', einheit: 'g' },
  { wort: 'sesam', einheit: 'TL' },
  { wort: 'samen', einheit: 'TL' },
  { wort: 'pesto', einheit: 'EL' },
];

/** Typisches Gewicht je Stück — für die Umrechnung Stück → Gramm. */
const STUECK_GEWICHT: Array<{ wort: string; gramm: number }> = [
  { wort: 'kirschtomate', gramm: 15 },
  { wort: 'tomate', gramm: 80 },
  { wort: 'zwiebel', gramm: 110 },
  { wort: 'schalotte', gramm: 40 },
  { wort: 'karotte', gramm: 80 },
  { wort: 'möhre', gramm: 80 },
  { wort: 'kartoffel', gramm: 150 },
  { wort: 'gurke', gramm: 400 },
  { wort: 'paprika', gramm: 180 },
  { wort: 'zucchini', gramm: 250 },
  { wort: 'aubergine', gramm: 300 },
  { wort: 'brokkoli', gramm: 400 },
  { wort: 'avocado', gramm: 200 },
  { wort: 'apfel', gramm: 150 },
  { wort: 'birne', gramm: 180 },
  { wort: 'banane', gramm: 120 },
  { wort: 'zitrone', gramm: 100 },
  { wort: 'limette', gramm: 70 },
  { wort: 'orange', gramm: 180 },
  { wort: 'ingwer', gramm: 100 },
  { wort: 'sellerie', gramm: 400 },
  { wort: 'ei', gramm: 55 },
  { wort: 'eier', gramm: 55 },
];

/** Kurzformen und Schreibvarianten auf die Tabellenform bringen. */
const NORMALISIEREN: Record<string, string> = {
  ml: 'ml',
  milliliter: 'ml',
  g: 'g',
  gramm: 'g',
  kg: 'g',
  l: 'ml',
  liter: 'ml',
  stück: 'Stück',
  stueck: 'Stück',
  stk: 'Stück',
  tl: 'TL',
  teelöffel: 'TL',
  el: 'EL',
  esslöffel: 'EL',
  bund: 'Bund',
  zehe: 'Zehe',
  zehen: 'Zehe',
  scheibe: 'Scheibe',
  scheiben: 'Scheibe',
  dose: 'Dose',
  dosen: 'Dose',
  packung: 'Packung',
  prise: 'TL',
  prisen: 'TL',
  spritzer: 'TL',
  handvoll: 'g',
};

/** Einheit für ein Lebensmittel. Unbekannte Zutaten: Gramm. */
export function einheitFuer(name: string): ZutatEinheit {
  const n = String(name ?? '').toLowerCase().trim();
  if (!n) return 'g';

  /*
   * Das **längste** passende Stichwort gewinnt, nicht das erste.
   *
   * Sonst trifft „ei" (Stück) in „basmat**reis**" und überschreibt „reis" (g) —
   * dann steht Basmatireis als „2 Stück" auf der Einkaufsliste. Die Tabelle
   * bleibt in lesbarer Reihenfolge, die Auflösung sortiert selbst.
   */
  let bestes: { wort: string; einheit: ZutatEinheit } | null = null;
  for (const e of EINHEITEN) {
    if (!n.includes(e.wort)) continue;
    if (!bestes || e.wort.length > bestes.wort.length) bestes = e;
  }
  return bestes?.einheit ?? 'g';
}

/**
 * Menge in die Standardeinheit umrechnen.
 *
 * Beispiel: 1000 g Mehl → 1000 g (bleibt), 1 kg Mehl → 1000 g,
 * 0,5 l Milch → 500 ml, 2 Prisen Salz → 2 TL.
 * Gibt null zurück, wenn nichts umgerechnet werden kann.
 */
export function standardMenge(name: string, amount: number | null, unit: string): { amount: number; einheit: ZutatEinheit } | null {
  const soll = einheitFuer(name);
  const u = String(unit ?? '').toLowerCase().trim();
  const menge = amount == null ? null : Number(amount);
  if (menge == null || !Number.isFinite(menge) || menge <= 0) return null;

  // Faktoren: in Gramm bzw. Milliliter
  const inGramm: Record<string, number> = { g: 1, gramm: 1, kg: 1000 };
  const inMl: Record<string, number> = { ml: 1, milliliter: 1, l: 1000, liter: 1000 };
  const stueck: Record<string, number> = { stück: 1, stueck: 1, stk: 1 };
  const loeffel: Record<string, number> = { tl: 1, teelöffel: 1, prise: 1, prisen: 1, spritzer: 1, el: 3, esslöffel: 3 };

  /*
   * Gleiche Einheit: nichts zu tun. Aber nur bei 1:1 — „kg" wird zu „g"
   * normalisiert und darf deshalb NICHT als gleich gelten, sonst wird aus
   * 1 kg Mehl „1 g".
   */
  if (u === soll.toLowerCase() && u !== 'kg' && u !== 'l' && u !== 'liter') {
    return { amount: rund(menge), einheit: soll };
  }

  // Gewicht → Gramm oder Stück
  if (u in inGramm) {
    const gramm = menge * inGramm[u];
    if (soll === 'g') return { amount: rund(gramm), einheit: 'g' };
    if (soll === 'Stück') return { amount: Math.max(1, Math.round(gramm / 100)), einheit: 'Stück' };
  }

  // Flüssig → Milliliter (Dichte 1 angenommen)
  if (u in inMl) {
    const ml = menge * inMl[u];
    if (soll === 'ml') return { amount: rund(ml), einheit: 'ml' };
    if (soll === 'g') return { amount: rund(ml), einheit: 'g' };
  }

  // Löffel → Teelöffel oder Esslöffel
  if (u in loeffel) {
    const tl = menge * loeffel[u];
    if (soll === 'TL') return { amount: rund(tl), einheit: 'TL' };
    if (soll === 'EL') return { amount: rund(tl / 3), einheit: 'EL' };
  }

  /*
   * Stück → Gramm: typisches Stückgewicht je Lebensmittel, sonst 100 g.
   * Ohne diese Tabelle wären „3 Tomaten" 300 g statt der realen 240 g.
   */
  if (u in stueck) {
    if (soll === 'Stück') return { amount: rund(menge), einheit: 'Stück' };
    if (soll === 'g') {
      const n = String(name ?? '').toLowerCase();
      const gramm = STUECK_GEWICHT.find((x) => n.includes(x.wort))?.gramm ?? 100;
      return { amount: rund(menge * gramm), einheit: 'g' };
    }
    if (soll === 'ml') return { amount: rund(menge * 100), einheit: 'ml' };
  }

  // Keine Umrechnung möglich: Menge unverändert mit Zieleinheit
  return { amount: rund(menge), einheit: soll };
}

function rund(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Einheiten-Tabelle als Text für den KI-Prompt.
 *
 * Damit die KI von Anfang an dieselbe Einheit verwendet, bekommt sie eine kurze
 * Liste der wichtigsten Lebensmittel mit ihrer Einheit.
 */
export function einheitenFuerPrompt(maxZeilen = 40): string {
  const gesehen = new Set<string>();
  const zeilen: string[] = [];
  for (const { wort, einheit } of EINHEITEN) {
    if (gesehen.has(wort) || wort.length < 4) continue;
    gesehen.add(wort);
    zeilen.push(`${wort}: ${einheit}`);
    if (zeilen.length >= maxZeilen) break;
  }
  return zeilen.join(', ');
}
