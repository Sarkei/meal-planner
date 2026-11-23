/**
 * Preis-Schätzung für die Einkaufsliste.
 *
 * Ziel ist eine **grobe Hausnummer**, keine Kassengenauigkeit: „Diese Woche kostet
 * etwa 62 €". Grundlage sind übliche Discounter-/Supermarktpreise in Deutschland
 * (Stand Ende 2026), pro Kilogramm, Liter oder Stück. Daraus wird über die Menge
 * der Wochenpreis gerechnet.
 *
 * Abgleich: Die Eckwerte wurden am 23.11.2026 gegen veröffentlichte Aldi-Süd-Preise
 * geprüft — Kartoffeln 0,92 €/kg, Spaghetti 1,19 €/kg, passierte Tomaten 1,30 €/kg,
 * Tomaten 2,98 €/kg, Milch 0,95 €/l, Hähnchenbrust 13,73 €/kg.
 *
 * WICHTIG — was das nicht ist: keine Live-Anbindung an eine Preisdatenbank. Die
 * Tabelle ist statisch und liegt bewusst etwas über Discounter-Niveau, weil
 * Markenprodukte und kleinere Packungen teurer sind. Reale Abweichung gegenüber
 * der Kasse: grob ±20 %. Für „ist die Woche zu teuer?" reicht das, für eine
 * Haushaltsabrechnung nicht.
 *
 * Gewürze, Saucen und Grundausstattung bekommen **bewusst keinen Preis**: Salz,
 * Pfeffer, Oregano oder Sojasauce hat man zu Hause und kauft sie nicht wöchentlich.
 * Sie würden die Summe jede Woche künstlich aufblähen. Sie landen in der Kategorie
 * „Gewürze & Saucen" und werden mit `null` bepreist.
 */

/** Preis je Kilogramm (g), je Liter (ml) oder je Stück. */
type Preis = {
  proKg?: number;
  proL?: number;
  proStueck?: number;
  /**
   * Handelsübliche Packungsgröße in Gramm/Milliliter bzw. Stück.
   * Der Preis wird auf ein Vielfaches aufgerundet — man kauft die Packung,
   * nicht 173 g.
   */
  packung?: number;
  label: string;
};

/**
 * Tabelle: Stichwort → Preis. Reihenfolge zählt — das erste passende Stichwort
 * gewinnt, deshalb stehen spezielle Fälle (Olivenöl) vor allgemeinen (Öl).
 */
const PREISE: Array<{ wort: string; preis: Preis }> = [
  // ── Öle, Essig, Saucen: Grundausstattung, hat man daheim → kein Preis ──────
  { wort: 'olivenöl', preis: { label: 'Grundausstattung' } },
  { wort: 'rapsöl', preis: { label: 'Grundausstattung' } },
  { wort: 'kokosöl', preis: { label: 'Grundausstattung' } },
  { wort: 'öl', preis: { label: 'Grundausstattung' } },
  { wort: 'essig', preis: { label: 'Grundausstattung' } },
  { wort: 'sojasauce', preis: { label: 'Grundausstattung' } },
  { wort: 'fischsauce', preis: { label: 'Grundausstattung' } },
  { wort: 'worcester', preis: { label: 'Grundausstattung' } },
  { wort: 'senf', preis: { label: 'Grundausstattung' } },
  { wort: 'ketchup', preis: { label: 'Grundausstattung' } },
  { wort: 'mayonnaise', preis: { label: 'Grundausstattung' } },
  { wort: 'mayo', preis: { label: 'Grundausstattung' } },
  { wort: 'pesto', preis: { proKg: 17.9, packung: 190, label: 'Glas' } },

  // ── Gewürze, Backtriebmittel, Süßungsmittel: kein Preis ───────────────────
  { wort: 'salz', preis: { label: 'Gewürz' } },
  { wort: 'pfeffer', preis: { label: 'Gewürz' } },
  { wort: 'paprikapulver', preis: { label: 'Gewürz' } },
  { wort: 'chili', preis: { label: 'Gewürz' } },
  { wort: 'chilipulver', preis: { label: 'Gewürz' } },
  { wort: 'chiliflocken', preis: { label: 'Gewürz' } },
  { wort: 'curry', preis: { label: 'Gewürz' } },
  { wort: 'currypulver', preis: { label: 'Gewürz' } },
  { wort: 'oregano', preis: { label: 'Gewürz' } },
  { wort: 'thymian', preis: { label: 'Gewürz' } },
  { wort: 'rosmarin', preis: { label: 'Gewürz' } },
  { wort: 'basilikum', preis: { proStueck: 1.19, label: 'Topf' } },
  { wort: 'zimt', preis: { label: 'Gewürz' } },
  { wort: 'muskat', preis: { label: 'Gewürz' } },
  { wort: 'kurkuma', preis: { label: 'Gewürz' } },
  { wort: 'kümmel', preis: { label: 'Gewürz' } },
  { wort: 'kreuzkümmel', preis: { label: 'Gewürz' } },
  { wort: 'lorbeer', preis: { label: 'Gewürz' } },
  { wort: 'gewürz', preis: { label: 'Gewürz' } },
  { wort: 'vanille', preis: { label: 'Gewürz' } },
  { wort: 'backpulver', preis: { label: 'Backzutat' } },
  { wort: 'natron', preis: { label: 'Backzutat' } },
  { wort: 'hefe', preis: { proKg: 8, label: 'Würfel' } },
  { wort: 'brühe', preis: { label: 'Grundausstattung' } },
  { wort: 'bouillon', preis: { label: 'Grundausstattung' } },
  { wort: 'suppenwürze', preis: { label: 'Grundausstattung' } },
  { wort: 'zucker', preis: { proKg: 1.29, packung: 1000, label: 'kg' } },
  { wort: 'honig', preis: { proKg: 9.9, packung: 500, label: 'Glas' } },
  { wort: 'vanillezucker', preis: { label: 'Backzutat' } },

  // ── Obst & Gemüse ────────────────────────────────────────────────────────
  { wort: 'kartoffel', preis: { proKg: 1.19, proStueck: 0.20, packung: 2500, label: 'kg' } },
  { wort: 'süßkartoffel', preis: { proKg: 2.79, proStueck: 0.90, packung: 1000, label: 'kg' } },
  { wort: 'zwiebel', preis: { proKg: 1.79, proStueck: 0.25, packung: 1000, label: 'kg' } },
  { wort: 'frühlingszwiebel', preis: { proKg: 3.99, label: 'Bund' } },
  { wort: 'knoblauch', preis: { proKg: 7.99, label: 'kg' } },
  { wort: 'tomate', preis: { proKg: 3.49, proStueck: 0.40, packung: 500, label: 'kg' } },
  { wort: 'passierte tomate', preis: { proKg: 1.58, packung: 500, label: 'Packung' } },
  { wort: 'dosentomate', preis: { proKg: 1.78, label: 'Dose' } },
  { wort: 'gurke', preis: { proStueck: 1.29, label: 'Stück' } },
  { wort: 'paprika', preis: { proKg: 4.99, proStueck: 0.89, label: 'Stück' } },
  { wort: 'zucchini', preis: { proKg: 2.99, proStueck: 0.99, label: 'Stück' } },
  { wort: 'aubergine', preis: { proKg: 2.99, label: 'kg' } },
  { wort: 'karotte', preis: { proKg: 1.29, proStueck: 0.15, packung: 1000, label: 'kg' } },
  { wort: 'möhre', preis: { proKg: 1.29, proStueck: 0.15, packung: 1000, label: 'kg' } },
  { wort: 'lauch', preis: { proStueck: 1.29, label: 'Stange' } },
  { wort: 'sellerie', preis: { proKg: 2.99, label: 'kg' } },
  { wort: 'spinat', preis: { proKg: 8.9, label: 'Beutel' } },
  { wort: 'brokkoli', preis: { proKg: 3.99, proStueck: 1.49, label: 'Stück' } },
  { wort: 'blumenkohl', preis: { proStueck: 2.19, label: 'Stück' } },
  { wort: 'rosenkohl', preis: { proKg: 3.99, label: 'kg' } },
  { wort: 'kohl', preis: { proKg: 1.79, label: 'kg' } },
  { wort: 'kürbis', preis: { proKg: 2.29, label: 'kg' } },
  { wort: 'champignon', preis: { proKg: 6.49, packung: 250, label: 'Schale' } },
  { wort: 'pilz', preis: { proKg: 6.49, packung: 250, label: 'Schale' } },
  { wort: 'ingwer', preis: { proKg: 8.9, packung: 100, label: 'Stück' } },
  { wort: 'salat', preis: { proStueck: 1.49, label: 'Kopf' } },
  { wort: 'rucola', preis: { proKg: 12.9, label: 'Beutel' } },
  { wort: 'petersilie', preis: { proStueck: 1.09, label: 'Bund' } },
  { wort: 'koriander', preis: { proStueck: 1.19, label: 'Bund' } },
  { wort: 'minze', preis: { proStueck: 1.19, label: 'Bund' } },
  { wort: 'dill', preis: { proStueck: 1.09, label: 'Bund' } },
  { wort: 'apfel', preis: { proKg: 2.79, proStueck: 0.55, label: 'kg' } },
  { wort: 'banane', preis: { proKg: 1.79, proStueck: 0.29, label: 'kg' } },
  { wort: 'beere', preis: { proKg: 13.9, packung: 300, label: 'Schale' } },
  { wort: 'erdbeere', preis: { proKg: 9.9, label: 'Schale' } },
  { wort: 'himbeere', preis: { proKg: 15.9, label: 'Schale' } },
  { wort: 'heidelbeere', preis: { proKg: 13.9, label: 'Schale' } },
  { wort: 'birne', preis: { proKg: 2.79, label: 'kg' } },
  { wort: 'zitrone', preis: { proStueck: 0.45, label: 'Stück' } },
  { wort: 'limette', preis: { proStueck: 0.45, label: 'Stück' } },
  { wort: 'orange', preis: { proKg: 2.29, label: 'kg' } },
  { wort: 'pfirsich', preis: { proKg: 3.49, label: 'kg' } },
  { wort: 'traube', preis: { proKg: 3.49, label: 'kg' } },
  { wort: 'melone', preis: { proKg: 2.49, label: 'kg' } },
  { wort: 'mango', preis: { proKg: 4.49, label: 'kg' } },
  { wort: 'avocado', preis: { proStueck: 1.29, label: 'Stück' } },
  { wort: 'bohne', preis: { proKg: 3.49, label: 'kg' } },
  { wort: 'erbse', preis: { proKg: 4.99, label: 'kg' } },
  { wort: 'mais', preis: { proKg: 4.29, packung: 300, label: 'Dose' } },
  { wort: 'olive', preis: { proKg: 9.9, packung: 150, label: 'Glas' } },
  { wort: 'kapern', preis: { proKg: 15.9, label: 'Glas' } },

  // ── Milchprodukte & Eier ─────────────────────────────────────────────────
  { wort: 'milch', preis: { proL: 1.19, packung: 1000, label: 'l' } },
  { wort: 'kokosmilch', preis: { proL: 4.99, packung: 400, label: 'Dose' } },
  { wort: 'butter', preis: { proKg: 9.96, packung: 250, label: 'kg' } },
  { wort: 'sahne', preis: { proL: 7.45, packung: 200, label: 'Becher' } },
  { wort: 'schmand', preis: { proKg: 6.5, label: 'Becher' } },
  { wort: 'crème fraîche', preis: { proKg: 7.5, label: 'Becher' } },
  { wort: 'creme fraiche', preis: { proKg: 7.5, label: 'Becher' } },
  { wort: 'joghurt', preis: { proKg: 2.49, packung: 500, label: 'kg' } },
  { wort: 'jogurt', preis: { proKg: 2.49, packung: 500, label: 'kg' } },
  { wort: 'skyr', preis: { proKg: 3.79, label: 'kg' } },
  { wort: 'quark', preis: { proKg: 3.79, packung: 500, label: 'kg' } },
  { wort: 'hüttenkäse', preis: { proKg: 6.5, label: 'Becher' } },
  { wort: 'frischkäse', preis: { proKg: 8.9, label: 'Becher' } },
  { wort: 'mascarpone', preis: { proKg: 11.9, label: 'Becher' } },
  { wort: 'feta', preis: { proKg: 12.9, packung: 200, label: 'kg' } },
  { wort: 'parmesan', preis: { proKg: 26.9, packung: 100, label: 'kg' } },
  { wort: 'mozzarella', preis: { proKg: 8.9, packung: 125, label: 'Kugel' } },
  { wort: 'gouda', preis: { proKg: 8.9, packung: 400, label: 'kg' } },
  { wort: 'emmentaler', preis: { proKg: 11.9, label: 'kg' } },
  { wort: 'bergkäse', preis: { proKg: 16.9, label: 'kg' } },
  { wort: 'frischkäse', preis: { proKg: 8.9, label: 'Becher' } },
  { wort: 'käse', preis: { proKg: 10.9, packung: 400, label: 'kg' } },
  { wort: 'ei', preis: { proStueck: 0.36, packung: 10, label: '10er-Pack' } },
  { wort: 'eier', preis: { proStueck: 0.36, packung: 10, label: '10er-Pack' } },

  // ── Fleisch & Fisch ──────────────────────────────────────────────────────
  { wort: 'hackfleisch', preis: { proKg: 12.98, packung: 500, label: 'kg' } },
  { wort: 'hack', preis: { proKg: 12.98, packung: 500, label: 'kg' } },
  { wort: 'hähnchen', preis: { proKg: 13.9, packung: 400, label: 'kg' } },
  { wort: 'hühnchen', preis: { proKg: 13.9, packung: 400, label: 'kg' } },
  { wort: 'huhn', preis: { proKg: 13.9, packung: 400, label: 'kg' } },
  { wort: 'pute', preis: { proKg: 12.9, packung: 400, label: 'kg' } },
  { wort: 'rind', preis: { proKg: 21.9, packung: 400, label: 'kg' } },
  { wort: 'schwein', preis: { proKg: 9.9, label: 'kg' } },
  { wort: 'fleisch', preis: { proKg: 13.9, packung: 500, label: 'kg' } },
  { wort: 'steak', preis: { proKg: 29.9, label: 'kg' } },
  { wort: 'filet', preis: { proKg: 22.9, label: 'kg' } },
  { wort: 'schnitzel', preis: { proKg: 13.9, label: 'kg' } },
  { wort: 'wurst', preis: { proKg: 9.9, label: 'kg' } },
  { wort: 'schinken', preis: { proKg: 12.9, label: 'kg' } },
  { wort: 'salami', preis: { proKg: 13.9, label: 'kg' } },
  { wort: 'speck', preis: { proKg: 13.9, packung: 100, label: 'kg' } },
  { wort: 'lachs', preis: { proKg: 26.9, packung: 250, label: 'kg' } },
  { wort: 'thunfisch', preis: { proKg: 12.9, packung: 150, label: 'Dose' } },
  { wort: 'garnele', preis: { proKg: 19.9, label: 'kg' } },
  { wort: 'garnelen', preis: { proKg: 19.9, label: 'kg' } },
  { wort: 'forelle', preis: { proKg: 17.9, label: 'kg' } },
  { wort: 'kabeljau', preis: { proKg: 21.9, label: 'kg' } },
  { wort: 'fisch', preis: { proKg: 19.9, label: 'kg' } },
  { wort: 'tofu', preis: { proKg: 8.9, label: 'kg' } },
  { wort: 'tempeh', preis: { proKg: 12.9, label: 'kg' } },

  // ── Brot & Backwaren ─────────────────────────────────────────────────────
  { wort: 'brot', preis: { proKg: 3.79, packung: 500, label: 'kg' } },
  { wort: 'brötchen', preis: { proStueck: 0.45, label: 'Stück' } },
  { wort: 'baguette', preis: { proStueck: 1.19, label: 'Stück' } },
  { wort: 'toast', preis: { proKg: 3.29, packung: 500, label: 'Packung' } },
  { wort: 'ciabatta', preis: { proStueck: 1.49, label: 'Stück' } },
  { wort: 'croissant', preis: { proStueck: 0.79, label: 'Stück' } },
  { wort: 'brezel', preis: { proStueck: 0.85, label: 'Stück' } },
  { wort: 'wrap', preis: { proKg: 6.9, label: 'Packung' } },
  { wort: 'tortilla', preis: { proKg: 6.9, label: 'Packung' } },
  { wort: 'kuchen', preis: { proKg: 8.9, label: 'kg' } },

  // ── Nudeln, Reis & Vorrat ────────────────────────────────────────────────
  { wort: 'nudel', preis: { proKg: 1.79, packung: 500, label: 'kg' } },
  { wort: 'pasta', preis: { proKg: 1.79, packung: 500, label: 'kg' } },
  { wort: 'spaghetti', preis: { proKg: 1.79, packung: 500, label: 'kg' } },
  { wort: 'penne', preis: { proKg: 1.79, packung: 500, label: 'kg' } },
  { wort: 'reis', preis: { proKg: 2.29, packung: 500, label: 'kg' } },
  { wort: 'couscous', preis: { proKg: 4.49, label: 'kg' } },
  { wort: 'bulgur', preis: { proKg: 3.49, label: 'kg' } },
  { wort: 'quinoa', preis: { proKg: 8.9, label: 'kg' } },
  { wort: 'polenta', preis: { proKg: 3.49, label: 'kg' } },
  { wort: 'mehl', preis: { proKg: 1.19, packung: 1000, label: 'kg' } },
  { wort: 'haferflocken', preis: { proKg: 1.79, packung: 500, label: 'kg' } },
  { wort: 'müsli', preis: { proKg: 4.99, label: 'kg' } },
  { wort: 'linsen', preis: { proKg: 3.99, packung: 500, label: 'kg' } },
  { wort: 'kichererbsen', preis: { proKg: 3.29, packung: 400, label: 'Dose' } },
  { wort: 'hummus', preis: { proKg: 7.9, label: 'kg' } },
  { wort: 'mandel', preis: { proKg: 14.9, packung: 200, label: 'kg' } },
  { wort: 'walnuss', preis: { proKg: 16.9, packung: 200, label: 'kg' } },
  { wort: 'erdnuss', preis: { proKg: 8.9, label: 'kg' } },
  { wort: 'nuss', preis: { proKg: 15.9, packung: 200, label: 'kg' } },
  { wort: 'nüsse', preis: { proKg: 15.9, packung: 200, label: 'kg' } },
  { wort: 'sesam', preis: { proKg: 9.9, label: 'kg' } },
  { wort: 'samen', preis: { proKg: 9.9, label: 'kg' } },

  // ── Tiefkühl ─────────────────────────────────────────────────────────────
  { wort: 'tiefkühl', preis: { proKg: 5.49, packung: 450, label: 'kg' } },
  { wort: 'gefroren', preis: { proKg: 5.49, packung: 450, label: 'kg' } },
  { wort: 'eiscreme', preis: { proL: 4.99, label: 'l' } },

  // ── Getränke ─────────────────────────────────────────────────────────────
  { wort: 'wasser', preis: { proL: 0.35, label: 'l' } },
  { wort: 'saft', preis: { proL: 1.49, label: 'l' } },
  { wort: 'bier', preis: { proL: 2.49, label: 'l' } },
  { wort: 'wein', preis: { proL: 6.9, label: 'l' } },
  { wort: 'limonade', preis: { proL: 1.19, label: 'l' } },
  { wort: 'cola', preis: { proL: 1.29, label: 'l' } },
  { wort: 'schorle', preis: { proL: 1.19, label: 'l' } },
  { wort: 'tee', preis: { label: 'Grundausstattung' } },

  // ── Haushalt & Drogerie ──────────────────────────────────────────────────
  { wort: 'spülmittel', preis: { proStueck: 1.95, label: 'Flasche' } },
  { wort: 'toilettenpapier', preis: { proStueck: 3.49, label: 'Packung' } },
  { wort: 'klopapier', preis: { proStueck: 3.49, label: 'Packung' } },
  { wort: 'küchenrolle', preis: { proStueck: 2.49, label: 'Packung' } },
  { wort: 'alufolie', preis: { proStueck: 1.99, label: 'Rolle' } },
  { wort: 'frischhaltefolie', preis: { proStueck: 1.79, label: 'Rolle' } },
  { wort: 'backpapier', preis: { proStueck: 1.79, label: 'Rolle' } },
  { wort: 'müllbeutel', preis: { proStueck: 2.49, label: 'Packung' } },
  { wort: 'seife', preis: { proStueck: 1.29, label: 'Stück' } },
  { wort: 'waschmittel', preis: { proStueck: 7.99, label: 'Packung' } },
  { wort: 'schwamm', preis: { proStueck: 1.49, label: 'Packung' } },
];

/** Umrechnung von Haushaltsmaßen in Gramm/Milliliter. */
const HAUSHALTSMASS: Record<string, { menge: number; art: 'g' | 'ml' | 'stueck' }> = {
  el: { menge: 15, art: 'ml' },
  tl: { menge: 5, art: 'ml' },
  prise: { menge: 1, art: 'g' },
  handvoll: { menge: 30, art: 'g' },
  zehe: { menge: 5, art: 'g' },
  zehen: { menge: 5, art: 'g' },
  bund: { menge: 80, art: 'g' },
  scheibe: { menge: 25, art: 'g' },
  scheiben: { menge: 25, art: 'g' },
  stange: { menge: 200, art: 'g' },
  dose: { menge: 400, art: 'g' },
  dosen: { menge: 400, art: 'g' },
  becher: { menge: 200, art: 'ml' },
  packung: { menge: 250, art: 'g' },
  stueck: { menge: 1, art: 'stueck' },
  'stück': { menge: 1, art: 'stueck' },
};

export type PreisSchaetzung = {
  /** Geschätzter Preis in Euro, oder null bei Gewürzen/Grundausstattung. */
  euro: number | null;
  /** Warum kein Preis: 'Gewürz', 'Grundausstattung' … sonst null. */
  grund: string | null;
  /** Kurzer Beleg für die Anzeige, z. B. „≈ 8,73 €/kg“. */
  basis: string | null;
};

/**
 * Preis für eine Zutat schätzen.
 *
 * Unbekannte Lebensmittel werden mit einem mittleren Kilopreis angesetzt, damit die
 * Summe nicht untertrieben wird; Gewürze bleiben bei null.
 */
export function schaetzePreis(name: string, amount: number | null, unit: string): PreisSchaetzung {
  const n = name.toLowerCase().trim();
  const treffer = PREISE.find((p) => n.includes(p.wort));

  // Gewürze und Grundausstattung: bewusst kein Preis.
  if (treffer && treffer.preis.proKg == null && treffer.preis.proL == null && treffer.preis.proStueck == null) {
    return { euro: null, grund: treffer.preis.label, basis: null };
  }

  const preis = treffer?.preis;
  const menge = amount == null ? null : Number(amount);
  const u = unit.toLowerCase().trim();

  // Ohne Menge nur den Bezugspreis nennen, keinen Eurobetrag erfinden.
  if (menge == null || !Number.isFinite(menge) || menge <= 0) {
    if (preis?.proKg != null) return { euro: null, grund: null, basis: `≈ ${preis.proKg.toFixed(2)} €/kg` };
    if (preis?.proL != null) return { euro: null, grund: null, basis: `≈ ${preis.proL.toFixed(2)} €/l` };
    if (preis?.proStueck != null) return { euro: null, grund: null, basis: `≈ ${preis.proStueck.toFixed(2)} €/Stück` };
    return { euro: null, grund: null, basis: null };
  }

  /**
   * Auf handelsübliche Packungen aufrunden.
   *
   * Das ist der Kern der Preiskorrektur: Man kauft keine 173 g Gouda, sondern die
   * 400-g-Packung. Vorher wurde nur der Verbrauch gerechnet — deshalb lag die
   * Summe deutlich unter dem, was an der Kasse steht (35 € geschätzt, 43 € bezahlt).
   * `verbraucht` ist die Menge in der Einheit der Packung (g, ml oder Stück).
   */
  const mitPackung = (verbraucht: number, basisWert: number): number => {
    const packung = preis?.packung;
    if (!packung || packung <= 0) return rund(verbraucht * basisWert);
    const packs = Math.max(1, Math.ceil(verbraucht / packung));
    return rund(packs * packung * basisWert);
  };

  /*
   * Stückpreis. Ist kein Stückpreis hinterlegt, wird aus dem Kilopreis und einem
   * typischen Stückgewicht abgeleitet — nie der Kilopreis direkt, sonst kostet
   * eine Zwiebel 268 €.
   */
  if (u === 'stück' || u === 'stueck' || u === 'stk') {
    const proStueck = preis?.proStueck ?? (preis?.proKg != null ? (preis.proKg * 0.1) : 1.5);
    return { euro: rund(menge * proStueck), grund: null, basis: null };
  }

  // Gramm / Kilogramm
  if (u === 'g' || u === 'gramm') {
    const proKg = preis?.proKg ?? 9.9;
    return { euro: mitPackung(menge, proKg / 1000), grund: null, basis: `≈ ${proKg.toFixed(2)} €/kg` };
  }
  if (u === 'kg') {
    const proKg = preis?.proKg ?? 9.9;
    return { euro: mitPackung(menge * 1000, proKg / 1000), grund: null, basis: `≈ ${proKg.toFixed(2)} €/kg` };
  }

  // Milliliter / Liter
  if (u === 'ml') {
    const proL = preis?.proL ?? 3.5;
    return { euro: mitPackung(menge, proL / 1000), grund: null, basis: `≈ ${proL.toFixed(2)} €/l` };
  }
  if (u === 'l' || u === 'liter') {
    const proL = preis?.proL ?? 3.5;
    return { euro: mitPackung(menge * 1000, proL / 1000), grund: null, basis: `≈ ${proL.toFixed(2)} €/l` };
  }

  // Haushaltsmaße
  const mass = HAUSHALTSMASS[u];
  if (mass) {
    if (mass.art === 'stueck') {
      const proStueck = preis?.proStueck ?? 1.5;
      return { euro: rund(menge * mass.menge * proStueck), grund: null, basis: null };
    }
    if (mass.art === 'ml') {
      const proL = preis?.proL ?? (preis?.proKg != null ? preis.proKg * 0.9 : 4);
      return { euro: rund(((menge * mass.menge) / 1000) * proL), grund: null, basis: null };
    }
    const proKg = preis?.proKg ?? 9.9;
    return { euro: rund(((menge * mass.menge) / 1000) * proKg), grund: null, basis: null };
  }

  // Einheit unbekannt („Prise", „nach Bedarf"): nur Bezugspreis.
  if (preis?.proKg != null) return { euro: null, grund: null, basis: `≈ ${preis.proKg.toFixed(2)} €/kg` };
  if (preis?.proStueck != null) return { euro: null, grund: null, basis: `≈ ${preis.proStueck.toFixed(2)} €/Stück` };
  return { euro: null, grund: null, basis: null };
}

function rund(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Ob eine Zutat in die Kategorie „Gewürze & Saucen" gehört (kein Preis). */
export function istGewuerzOderSauce(name: string): boolean {
  const n = name.toLowerCase();
  return PREISE.some(
    (p) =>
      n.includes(p.wort) &&
      p.preis.proKg == null &&
      p.preis.proL == null &&
      p.preis.proStueck == null,
  );
}
