import { Router } from 'express';

/**
 * Open-Food-Facts-Proxy: Produktsuche und Barcode-Lookup für Zutaten.
 * Deutsche Produkte zuerst (de.openfoodfacts.org), danach weltweit.
 */
export const foodRouter = Router();

type Nutriments = Record<string, number | string | undefined>;

export type FoodHit = {
  barcode: string;
  name: string;
  brand: string;
  quantity: string;
  imageUrl: string | null;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  perQuantity: string;
  countries: string;
};

const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 1000 * 60 * 60 * 12;

function cached(key: string): unknown | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  return null;
}

function put(key: string, data: unknown) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), data });
}

const UA = 'HermesMealPlanner/1.0 (private household app)';

function num(n: Nutriments | undefined, keys: string[]): number | null {
  if (!n) return null;
  for (const k of keys) {
    const v = n[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
    if (typeof v === 'string') {
      const parsed = Number(v.replace(',', '.'));
      if (Number.isFinite(parsed)) return Math.round(parsed);
    }
  }
  return null;
}

function mapProduct(p: Record<string, unknown>): FoodHit {
  const n = (p.nutriments || {}) as Nutriments;
  const kcal = num(n, ['energy-kcal_100g', 'energy-kcal', 'energy-kcal_value']);
  const brand = String(p.brands || '').split(',')[0].trim();
  return {
    barcode: String(p.code || p._id || ''),
    name: String(p.product_name_de || p.product_name || '').trim(),
    brand: brand || String(p.brands || '').trim(),
    quantity: String(p.quantity || ''),
    imageUrl: (p.image_front_small_url as string) || (p.image_small_url as string) || null,
    kcal,
    protein: num(n, ['proteins_100g', 'proteins']),
    carbs: num(n, ['carbohydrates_100g', 'carbohydrates']),
    fat: num(n, ['fat_100g', 'fat']),
    perQuantity: '100 g',
    countries: String(p.countries || ''),
  };
}

async function fetchJson(url: string, timeoutMs = 12_000): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Barcode-Lookup: liefert ein Produkt oder null. */
foodRouter.get('/barcode/:code', async (req, res) => {
  const code = String(req.params.code || '').replace(/[^0-9]/g, '');
  if (code.length < 6 || code.length > 14) {
    res.status(400).json({ error: 'Ungültiger Barcode' });
    return;
  }
  const key = 'b:' + code;
  const hit = cached(key);
  if (hit) {
    res.json(hit);
    return;
  }
  const data = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,product_name_de,brands,quantity,image_front_small_url,image_small_url,nutriments,countries`);
  if (!data || Number(data.status) === 0 || !data.product) {
    res.status(404).json({ error: 'Produkt nicht gefunden' });
    return;
  }
  const out = mapProduct(data.product as Record<string, unknown>);
  put(key, out);
  res.json(out);
});

/** Textsuche: erst deutsche Treffer, dann weltweit. */
foodRouter.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }
  const key = 's:' + q.toLowerCase();
  const hit = cached(key);
  if (hit) {
    res.json(hit);
    return;
  }
  const mkUrl = (host: string) =>
    `https://${host}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=code,product_name,product_name_de,brands,quantity,image_front_small_url,image_small_url,nutriments,countries`;

  let products: Record<string, unknown>[] = [];
  for (const host of ['de.openfoodfacts.org', 'world.openfoodfacts.org']) {
    const data = await fetchJson(mkUrl(host));
    if (data && Array.isArray(data.products)) {
      products = products.concat(data.products as Record<string, unknown>[]);
    }
    if (products.length >= 12) break;
  }
  const seen = new Set<string>();
  const results: FoodHit[] = [];
  for (const p of products) {
    const mapped = mapProduct(p);
    if (!mapped.name) continue;
    const dedupeKey = (mapped.barcode || mapped.name) + '|' + mapped.brand;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    results.push(mapped);
    if (results.length >= 25) break;
  }
  const out = { results };
  put(key, out);
  res.json(out);
});
