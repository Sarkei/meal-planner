// server/index.ts
import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { join as join2 } from "node:path";

// server/db.ts
import pg from "pg";
var { Pool } = pg;
function buildPool() {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return new Pool({ connectionString: url });
  return new Pool({
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "mealplanner",
    user: process.env.POSTGRES_USER || "mealplanner",
    password: process.env.POSTGRES_PASSWORD || "mealplanner",
    max: 10
  });
}
var pool = buildPool();
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            serial PRIMARY KEY,
      email         text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      display_name  text NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS households (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL,
      invite_code text NOT NULL UNIQUE,
      created_by  integer REFERENCES users(id) ON DELETE SET NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE households ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS household_members (
      household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role         text NOT NULL DEFAULT 'member',
      joined_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (household_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id uuid REFERENCES households(id) ON DELETE CASCADE,
      owner_id     integer REFERENCES users(id) ON DELETE SET NULL,
      title        text NOT NULL,
      description  text NOT NULL DEFAULT '',
      servings     integer NOT NULL DEFAULT 2,
      prep_minutes integer,
      tags         text[] NOT NULL DEFAULT '{}',
      source       text NOT NULL DEFAULT 'manual',
      ingredients  jsonb NOT NULL DEFAULT '[]'::jsonb,
      steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
      nutrition    jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE recipes ADD COLUMN IF NOT EXISTS diets text[] NOT NULL DEFAULT '{}';
    ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cuisines text[] NOT NULL DEFAULT '{}';
    ALTER TABLE recipes ADD COLUMN IF NOT EXISTS allergens text[] NOT NULL DEFAULT '{}';
    CREATE INDEX IF NOT EXISTS recipes_diets_idx ON recipes USING gin (diets);
    CREATE INDEX IF NOT EXISTS recipes_cuisines_idx ON recipes USING gin (cuisines);
    CREATE INDEX IF NOT EXISTS recipes_allergens_idx ON recipes USING gin (allergens);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id           bigserial PRIMARY KEY,
      user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role         text NOT NULL,
      content      text NOT NULL,
      actions      jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS chat_messages_user_idx ON chat_messages (user_id, id DESC);

    CREATE TABLE IF NOT EXISTS image_jobs (
      id           serial PRIMARY KEY,
      recipe_id    uuid NOT NULL UNIQUE REFERENCES recipes(id) ON DELETE CASCADE,
      status       text NOT NULL DEFAULT 'pending',
      attempts     integer NOT NULL DEFAULT 0,
      error        text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipe_id  uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, recipe_id)
    );

    CREATE TABLE IF NOT EXISTS meal_plans (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      week_start   date NOT NULL,
      created_by   integer REFERENCES users(id) ON DELETE SET NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (household_id, week_start)
    );

    CREATE TABLE IF NOT EXISTS plan_entries (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      plan_id      uuid NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
      day_index    integer NOT NULL CHECK (day_index BETWEEN 0 AND 6),
      slot         text NOT NULL,
      recipe_id    uuid REFERENCES recipes(id) ON DELETE SET NULL,
      custom_title text,
      servings     integer,
      created_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (plan_id, day_index, slot)
    );

    CREATE TABLE IF NOT EXISTS ai_runs (
      id         serial PRIMARY KEY,
      user_id    integer REFERENCES users(id) ON DELETE SET NULL,
      kind       text NOT NULL,
      provider   text,
      model      text,
      ok         boolean NOT NULL DEFAULT true,
      latency_ms integer,
      error      text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS recipes_household_idx ON recipes (household_id);
    CREATE INDEX IF NOT EXISTS plan_entries_plan_idx ON plan_entries (plan_id);

    -- \u2500\u2500 Nachtr\xE4glich erg\xE4nzt: globale Rezeptsammlung, Bewertungen, Einstellungen, Reset-Tokens \u2500\u2500
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_lower text;
    UPDATE users SET email_lower = lower(email) WHERE email_lower IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (email_lower);

    ALTER TABLE recipes ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
    ALTER TABLE recipes ADD COLUMN IF NOT EXISTS image_url text;
    ALTER TABLE recipes ADD COLUMN IF NOT EXISTS total_minutes integer;
    ALTER TABLE recipes ADD COLUMN IF NOT EXISTS difficulty text;
    ALTER TABLE recipes ADD COLUMN IF NOT EXISTS archived_at timestamptz;

    CREATE TABLE IF NOT EXISTS recipe_ratings (
      user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipe_id  uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      stars      integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, recipe_id)
    );

    CREATE TABLE IF NOT EXISTS recipe_comments (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recipe_id  uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      user_id    integer REFERENCES users(id) ON DELETE SET NULL,
      body       text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id    integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data       jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         serial PRIMARY KEY,
      user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      used_at    timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- Freie Reihenfolge pro Tag: mehrere Mahlzeiten pro Tag, sortierbar per Drag & Drop.
    ALTER TABLE plan_entries ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
    ALTER TABLE plan_entries DROP CONSTRAINT IF EXISTS plan_entries_plan_id_day_index_slot_key;
    WITH dupes AS (
      SELECT plan_id, day_index
        FROM plan_entries
       GROUP BY plan_id, day_index
      HAVING count(*) > 1 AND count(*) FILTER (WHERE position <> 0) = 0
    )
    UPDATE plan_entries e
       SET position = sub.rn
      FROM (
        SELECT e2.id, row_number() OVER (PARTITION BY e2.plan_id, e2.day_index ORDER BY e2.slot, e2.created_at) - 1 AS rn
          FROM plan_entries e2
          JOIN dupes d ON d.plan_id = e2.plan_id AND d.day_index = e2.day_index
      ) sub
     WHERE e.id = sub.id;
    CREATE INDEX IF NOT EXISTS plan_entries_order_idx ON plan_entries (plan_id, day_index, position);
    ALTER TABLE plan_entries ALTER COLUMN slot SET DEFAULT 'mahlzeit';

    -- Einkaufsliste pro Haushalt und Woche (automatisch aus dem Plan + manuelle Artikel)
    CREATE TABLE IF NOT EXISTS shopping_items (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      week_start   date NOT NULL,
      key          text NOT NULL,
      name         text NOT NULL,
      amount       numeric(10,2),
      unit         text NOT NULL DEFAULT '',
      category     text NOT NULL DEFAULT 'sonstiges',
      checked      boolean NOT NULL DEFAULT false,
      source       text NOT NULL DEFAULT 'manual',
      created_by   integer REFERENCES users(id) ON DELETE SET NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (household_id, week_start, key)
    );
    CREATE INDEX IF NOT EXISTS shopping_items_lookup_idx ON shopping_items (household_id, week_start);

    CREATE INDEX IF NOT EXISTS recipes_status_idx ON recipes (status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS recipe_ratings_recipe_idx ON recipe_ratings (recipe_id);
    CREATE INDEX IF NOT EXISTS recipe_comments_recipe_idx ON recipe_comments (recipe_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS password_reset_hash_idx ON password_reset_tokens (token_hash);
  `);
}

// server/recipeMeta.ts
var ALLERGEN_RULES = [
  { allergen: "N\xFCsse", words: ["nuss", "n\xFCsse", "mandel", "walnuss", "haselnuss", "cashew", "pistazie", "pekan"] },
  { allergen: "Erdn\xFCsse", words: ["erdnuss", "erdn\xFCsse", "peanut"] },
  {
    allergen: "Gluten",
    words: ["mehl", "weizen", "brot", "br\xF6tchen", "nudel", "pasta", "spaghetti", "penne", "semmel", "bulgur", "couscous", "dinkel", "gerste", "roggen", "panko", "paniermehl", "kuchen", "teig"]
  },
  {
    allergen: "Laktose",
    words: ["milch", "sahne", "butter", "quark", "joghurt", "jogurt", "k\xE4se", "parmesan", "mozzarella", "schmand", "frischk\xE4se", "creme fraiche", "buttermilch"]
  },
  { allergen: "Ei", words: ["ei", "eier", "eigelb", "eiwei\xDF", "eiweiss", "mayonnaise"] },
  { allergen: "Soja", words: ["soja", "tofu", "edamame", "tempeh", "teriyaki", "sojasauce"] },
  { allergen: "Fisch", words: ["fisch", "lachs", "thunfisch", "kabeljau", "sardine", "forelle", "hering", "anchovis"] },
  { allergen: "Meeresfr\xFCchte", words: ["garnele", "garnelen", "shrimp", "muschel", "kalmar", "scampi", "meeresfr\xFCchte", "oktopus"] },
  { allergen: "Schweinefleisch", words: ["schwein", "speck", "schinken", "bacon", "salami", "chorizo", "bratwurst"] },
  { allergen: "Pilze", words: ["pilz", "pilze", "champignon", "shiitake", "pfifferling", "steinpilz", "austernpilz"] },
  { allergen: "Sellerie", words: ["sellerie"] },
  { allergen: "Sesam", words: ["sesam", "tahin", "tahini", "halva"] }
];
var MEAT_WORDS = ["fleisch", "huhn", "h\xE4hnchen", "haehnchen", "pute", "rind", "schwein", "lamm", "hackfleisch", "hack", "wurst", "speck", "schinken", "bacon", "salami", "chorizo", "ente", "gulasch", "steak"];
var FISH_WORDS = ["fisch", "lachs", "thunfisch", "kabeljau", "forelle", "hering", "garnele", "garnelen", "shrimp", "muschel", "scampi"];
var CUISINE_RULES = [
  { cuisine: "Italienisch", words: ["pasta", "spaghetti", "penne", "risotto", "pizza", "lasagne", "italien", "pesto", "tiramisu", "carpaccio"] },
  { cuisine: "Asiatisch", words: ["curry", "kokosmilch", "sojasauce", "wok", "asia", "asia", "sushi", "ramen", "teriyaki", "ingwer", "limette", "sesam\xF6l", "nudeln mit gem\xFCse"] },
  { cuisine: "Mexikanisch", words: ["taco", "burrito", "quesadilla", "salsa", "jalape\xF1o", "mexiko", "guacamole", "fajita"] },
  { cuisine: "Indisch", words: ["indisch", "masala", "tikka", "dal", "naan", "kichererbse", "garam masala", "paneer"] },
  { cuisine: "Griechisch", words: ["griech", "feta", "tzatziki", "gyros", "souvlaki", "oliven"] },
  { cuisine: "T\xFCrkisch", words: ["t\xFCrk", "turk", "kebab", "falafel", "hummus", "bulgur", "lahmacun"] },
  { cuisine: "Franz\xF6sisch", words: ["franz", "ratatouille", "quiche", "creme brulee", "baguette", "dijon"] },
  { cuisine: "Spanisch", words: ["spanisch", "paella", "tapas", "chorizo", "gazpacho", "manchego"] },
  { cuisine: "Amerikanisch", words: ["burger", "barbecue", "bbq", "pancake", "muffin", "mac and cheese", "cornbread"] },
  { cuisine: "Deutsch", words: ["deutsch", "schnitzel", "sp\xE4tzle", "spaetzle", "bratkartoffel", "sauerkraut", "kartoffelsalat", "rouladen", "kassler"] },
  { cuisine: "Orientalisch", words: ["oriental", "falafel", "hummus", "tabouleh", "harissa", "sumach", "gew\xFCrzmischung"] }
];
function haystack(title, tags, ingredients, description = "") {
  return [title, description, ...tags, ...ingredients.map((i) => i.name ?? "")].join(" ").toLowerCase();
}
function deriveMeta(input) {
  const text = haystack(input.title, input.tags ?? [], input.ingredients ?? [], input.description ?? "");
  const withoutPlantMilk = text.replace(/kokosmilch|mandelmilch|hafermilch|sojamilch|reismilch|pflanzenmilch|cashewmilch/g, " ");
  const allergens = ALLERGEN_RULES.filter((rule) => {
    const hay = rule.allergen === "Laktose" ? withoutPlantMilk : text;
    return rule.words.some((w) => hay.includes(w));
  }).map((r) => r.allergen);
  const hasMeat = MEAT_WORDS.some((w) => text.includes(w));
  const hasFish = FISH_WORDS.some((w) => text.includes(w));
  const diets = /* @__PURE__ */ new Set();
  if (!hasMeat && !hasFish) diets.add("vegetarisch");
  if (!hasMeat && !hasFish && !allergens.some((a) => ["Laktose", "Ei"].includes(a))) diets.add("vegan");
  if (!hasMeat && hasFish) diets.add("pescetarisch");
  if (!allergens.includes("Gluten")) diets.add("glutenfrei");
  if (!allergens.includes("Laktose")) diets.add("laktosefrei");
  const nutrition = input.nutrition ?? {};
  const carbs = typeof nutrition.carbs === "number" ? nutrition.carbs : null;
  const protein = typeof nutrition.protein === "number" ? nutrition.protein : null;
  const kcal = typeof nutrition.kcal === "number" ? nutrition.kcal : null;
  if (carbs != null && carbs <= 25) diets.add("low carb");
  if (protein != null && protein >= 25) diets.add("high protein");
  if (kcal != null && kcal <= 500) diets.add("kalorienbewusst");
  for (const tag of input.tags ?? []) {
    const lower = tag.toLowerCase();
    if (["vegetarisch", "vegan", "pescetarisch", "glutenfrei", "laktosefrei", "low carb", "high protein", "kalorienbewusst"].includes(lower)) {
      diets.add(lower);
    }
  }
  const cuisines = CUISINE_RULES.filter((rule) => rule.words.some((w) => text.includes(w))).map((r) => r.cuisine);
  return { diets: [...diets].sort(), cuisines: [...cuisines].sort(), allergens: [...allergens].sort() };
}
async function backfillRecipeMeta() {
  const rows = await pool.query(
    `select id, title, description, tags, ingredients, nutrition from recipes
      where coalesce(array_length(diets, 1), 0) = 0
        and coalesce(array_length(allergens, 1), 0) = 0
        and coalesce(array_length(cuisines, 1), 0) = 0
      limit 500`
  );
  for (const row of rows.rows) {
    const meta = deriveMeta({
      title: row.title,
      description: row.description ?? "",
      tags: row.tags ?? [],
      ingredients: row.ingredients ?? [],
      nutrition: row.nutrition
    });
    await pool.query("update recipes set diets = $2, cuisines = $3, allergens = $4 where id = $1", [
      row.id,
      meta.diets,
      meta.cuisines,
      meta.allergens
    ]);
  }
  return rows.rowCount ?? 0;
}

// server/chat.ts
import { Router as Router7 } from "express";

// server/guards.ts
import { randomBytes } from "node:crypto";
function generateInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
function requireAuth(req, res, next) {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthorized", message: "Bitte einloggen." });
    return;
  }
  next();
}
async function membershipRole(householdId, userId) {
  const r = await pool.query(
    "SELECT role FROM household_members WHERE household_id = $1 AND user_id = $2",
    [householdId, userId]
  );
  return r.rows[0]?.role ?? null;
}
async function requireHousehold(householdId, userId) {
  if (!householdId || !/^[0-9a-f-]{36}$/i.test(householdId)) {
    return { ok: false, status: 400, error: "household-required", message: "Haushalt fehlt." };
  }
  const role = await membershipRole(householdId, userId);
  if (!role) {
    return { ok: false, status: 403, error: "not-a-member", message: "Kein Zugriff auf diesen Haushalt." };
  }
  return { ok: true, role };
}
function fail(res, status, error, message) {
  res.status(status).json({ error, message });
}

// server/auth.ts
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes as randomBytes2 } from "node:crypto";
import { z } from "zod";

// server/householdPrefs.ts
var DIET_OPTIONS = [
  "vegetarisch",
  "vegan",
  "pescetarisch",
  "low carb",
  "high protein",
  "glutenfrei",
  "laktosefrei",
  "kalorienbewusst"
];
var CUISINE_OPTIONS = [
  "Deutsch",
  "Italienisch",
  "Spanisch",
  "Franz\xF6sisch",
  "Griechisch",
  "T\xFCrkisch",
  "Asiatisch",
  "Indisch",
  "Mexikanisch",
  "Amerikanisch",
  "Orientalisch"
];
var ALLERGY_OPTIONS = [
  "N\xFCsse",
  "Erdn\xFCsse",
  "Gluten",
  "Laktose",
  "Ei",
  "Soja",
  "Fisch",
  "Meeresfr\xFCchte",
  "Schweinefleisch",
  "Pilze",
  "Sellerie",
  "Sesam"
];
var APPLIANCE_OPTIONS = [
  "Ofen",
  "Herd",
  "Mikrowelle",
  "Thermomix",
  "Reiskocher",
  "Hei\xDFluftfritteuse",
  "Slow Cooker",
  "Grill",
  "Kontaktgrill",
  "K\xFCchenmaschine",
  "P\xFCrierstab",
  "Dampfgarer"
];
function list(value, max, allowed) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const cleaned = raw.map((v) => String(v).trim()).filter((v) => v.length > 0 && v.length <= 40).filter((v) => allowed ? allowed.includes(v) : true);
  return [...new Set(cleaned)].slice(0, max);
}
function numberOrNull(value, min, max) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}
function normalizeHouseholdPreferences(raw) {
  const value = raw ?? {};
  return {
    diets: list(value.diets, 8, DIET_OPTIONS),
    cuisines: list(value.cuisines, 10, CUISINE_OPTIONS),
    allergies: list(value.allergies, 12, ALLERGY_OPTIONS),
    // Geräte nur aus der festen Liste — Tippfehler sollen den KI-Prompt nicht verfälschen
    appliances: list(value.appliances, 12, APPLIANCE_OPTIONS),
    // Freie Liste: hier sind neue Lebensmittel ausdrücklich erlaubt
    dislikes: list(value.dislikes, 40),
    maxMinutes: numberOrNull(value.maxMinutes, 5, 240),
    kcalTarget: numberOrNull(value.kcalTarget, 200, 2e3),
    note: String(value.note ?? "").slice(0, 400),
    planDays: (() => {
      const days = Array.isArray(value.planDays) ? [...new Set(value.planDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
      return days.length ? days : [0, 1, 2, 3, 4];
    })(),
    planSlots: (() => {
      const slots = list(value.planSlots, 4, ["fruehstueck", "mittag", "abend", "snack"]);
      return slots.length ? slots : ["abend"];
    })(),
    planServings: Math.min(12, Math.max(1, Number(value.planServings) || 2)),
    autoPlan: value.autoPlan !== false
  };
}
async function loadHouseholdPreferences(householdId) {
  const row = await pool.query("SELECT preferences FROM households WHERE id = $1", [householdId]);
  return normalizeHouseholdPreferences(row.rows[0]?.preferences);
}

// server/auth.ts
var JWT_SECRET = process.env.JWT_SECRET?.trim() || "dev-secret-change-me";
var TOKEN_TTL = process.env.JWT_TTL?.trim() || "30d";
var APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
var DEV_RESET_LINK = process.env.ALLOW_DEV_RESET_LINK !== "0";
var RESET_TTL_MINUTES = Number(process.env.RESET_TTL_MINUTES ?? 60) || 60;
function signToken(userId, email, tokenVersion) {
  return jwt.sign({ sub: String(userId), email, tv: tokenVersion }, JWT_SECRET, {
    expiresIn: TOKEN_TTL
  });
}
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const id = Number(payload.sub);
    if (!Number.isFinite(id) || id <= 0) return null;
    return { userId: id, tokenVersion: Number(payload.tv ?? 0) };
  } catch {
    return null;
  }
}
var tokenVersionCache = /* @__PURE__ */ new Map();
function invalidateTokenCache(userId) {
  tokenVersionCache.delete(userId);
}
async function attachUserFromToken(req, _res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const id = Number(payload.sub);
      if (Number.isFinite(id) && id > 0) {
        const cached2 = tokenVersionCache.get(id);
        let version = null;
        if (cached2 && Date.now() - cached2.checkedAt < 6e4) {
          version = cached2.version;
        } else {
          const row = await pool.query("SELECT token_version FROM users WHERE id = $1", [id]);
          if (row.rowCount) {
            version = row.rows[0].token_version;
            tokenVersionCache.set(id, { version, checkedAt: Date.now() });
          }
        }
        if (version != null && Number(payload.tv ?? 0) === version) req.userId = id;
      }
    } catch {
    }
  }
  next();
}
var registerSchema = z.object({
  email: z.string().trim().email("Ung\xFCltige E-Mail-Adresse").max(200),
  password: z.string().min(8, "Mindestens 8 Zeichen").max(200),
  displayName: z.string().trim().min(2, "Bitte einen Namen angeben").max(80)
});
var loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});
async function createHouseholdWithOwner(name, userId) {
  let code = generateInviteCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await pool.query("SELECT 1 FROM households WHERE invite_code = $1", [code]);
    if (exists.rowCount === 0) break;
    code = generateInviteCode();
  }
  const created = await pool.query(
    "INSERT INTO households (name, invite_code, created_by) VALUES ($1,$2,$3) RETURNING id, name, invite_code",
    [name, code, userId]
  );
  const household = created.rows[0];
  await pool.query(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING",
    [household.id, userId]
  );
  return { id: household.id, name: household.name, inviteCode: household.invite_code };
}
var DEFAULT_SETTINGS = {
  theme: "system",
  defaultServings: 2,
  diets: [],
  allergies: [],
  cuisines: [],
  appliances: [],
  dislikes: [],
  maxMinutes: null,
  kcalTarget: null,
  aiAutoFavorite: true,
  defaultSlots: ["abend"],
  specialWishes: ""
};
function toStringList(value, max) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return raw.map((v) => String(v).trim()).filter((v) => v.length > 0 && v.toLowerCase() !== "keine" && v.toLowerCase() !== "keine vorgabe" && v.toLowerCase() !== "egal").slice(0, max);
}
function mergeSettings(raw) {
  const value = raw ?? {};
  const slots = Array.isArray(value.defaultSlots) ? value.defaultSlots.filter((s) => ["fruehstueck", "mittag", "abend", "snack"].includes(String(s))) : null;
  return {
    theme: value.theme === "light" || value.theme === "dark" || value.theme === "system" ? value.theme : DEFAULT_SETTINGS.theme,
    defaultServings: Math.min(12, Math.max(1, Number(value.defaultServings ?? DEFAULT_SETTINGS.defaultServings) || 2)),
    diets: toStringList(value.diets ?? value.diet, 8),
    allergies: toStringList(value.allergies, 12),
    cuisines: toStringList(value.cuisines, 10),
    appliances: toStringList(value.appliances, 12),
    dislikes: toStringList(value.dislikes, 40),
    maxMinutes: value.maxMinutes != null && Number.isFinite(Number(value.maxMinutes)) ? Number(value.maxMinutes) : null,
    kcalTarget: value.kcalTarget != null && Number.isFinite(Number(value.kcalTarget)) ? Number(value.kcalTarget) : null,
    aiAutoFavorite: value.aiAutoFavorite !== false,
    defaultSlots: slots?.length ? slots : DEFAULT_SETTINGS.defaultSlots,
    specialWishes: String(value.specialWishes ?? "").slice(0, 400)
  };
}
async function loadSettings(userId) {
  const row = await pool.query("SELECT data FROM user_settings WHERE user_id = $1", [userId]);
  return mergeSettings(row.rows[0]?.data);
}
async function loadHouseholdPreferencesRow(householdId) {
  const row = await pool.query("SELECT preferences FROM households WHERE id = $1", [householdId]);
  if (!row.rowCount) return null;
  return normalizeHouseholdPreferences(row.rows[0].preferences);
}
async function loadHouseholdPreferences2(householdId) {
  const rows = await pool.query(
    `SELECT coalesce(s.data, '{}'::jsonb) AS data, u.display_name
       FROM household_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_settings s ON s.user_id = m.user_id
      WHERE m.household_id = $1
      ORDER BY m.joined_at ASC`,
    [householdId]
  );
  const merged = {
    diets: /* @__PURE__ */ new Set(),
    allergies: /* @__PURE__ */ new Set(),
    cuisines: /* @__PURE__ */ new Set(),
    appliances: /* @__PURE__ */ new Set(),
    dislikes: /* @__PURE__ */ new Set(),
    wishes: []
  };
  let maxMinutes = null;
  let kcalSum = 0;
  let kcalCount = 0;
  const household = await loadHouseholdPreferencesRow(householdId);
  if (household) {
    household.diets.forEach((d) => merged.diets.add(d));
    household.allergies.forEach((a) => merged.allergies.add(a));
    household.cuisines.forEach((c) => merged.cuisines.add(c));
    household.appliances.forEach((a) => merged.appliances.add(a));
    household.dislikes.forEach((d) => merged.dislikes.add(d));
    if (household.maxMinutes != null) maxMinutes = household.maxMinutes;
    if (household.kcalTarget != null) {
      kcalSum += household.kcalTarget;
      kcalCount += 1;
    }
    if (household.note) merged.wishes.push(`Haushalt: ${household.note}`);
  }
  for (const row of rows.rows) {
    const s = mergeSettings(row.data);
    s.diets.forEach((d) => merged.diets.add(d));
    s.allergies.forEach((a) => merged.allergies.add(a));
    s.cuisines.forEach((c) => merged.cuisines.add(c));
    (s.appliances ?? []).forEach((a) => merged.appliances.add(a));
    (s.dislikes ?? []).forEach((d) => merged.dislikes.add(d));
    if (s.specialWishes) merged.wishes.push(`${row.display_name}: ${s.specialWishes}`);
    if (s.maxMinutes != null) maxMinutes = maxMinutes == null ? s.maxMinutes : Math.min(maxMinutes, s.maxMinutes);
    if (s.kcalTarget != null) {
      kcalSum += s.kcalTarget;
      kcalCount += 1;
    }
  }
  return {
    diets: [...merged.diets],
    allergies: [...merged.allergies],
    cuisines: [...merged.cuisines],
    appliances: [...merged.appliances],
    dislikes: [...merged.dislikes],
    maxMinutes,
    kcalTarget: kcalCount ? Math.round(kcalSum / kcalCount) : null,
    specialWishes: merged.wishes,
    members: rows.rowCount ?? 0
  };
}
async function saveSettings(userId, patch) {
  const current = await loadSettings(userId);
  const next = mergeSettings({ ...current, ...patch });
  await pool.query(
    `INSERT INTO user_settings (user_id, data, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [userId, JSON.stringify(next)]
  );
  return next;
}
async function sendResetMail(email, link) {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return false;
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.default.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "1",
      auth: process.env.SMTP_USER?.trim() ? { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS ?? "" } : void 0
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM?.trim() || "noreply@mealplanner.local",
      to: email,
      subject: "Meal Planner \u2014 Passwort zur\xFCcksetzen",
      text: `Moin,

hier ist dein Link zum Zur\xFCcksetzen des Passworts (${RESET_TTL_MINUTES} Minuten g\xFCltig):
${link}

Wenn du das nicht warst, ignoriere diese Mail.`,
      html: `<p>Moin,</p><p>hier ist dein Link zum Zur\xFCcksetzen des Passworts (${RESET_TTL_MINUTES} Minuten g\xFCltig):</p><p><a href="${link}">${link}</a></p><p>Wenn du das nicht warst, ignoriere diese Mail.</p>`
    });
    return true;
  } catch (e) {
    console.warn("[auth] Reset-Mail konnte nicht gesendet werden:", e);
    return false;
  }
}
var authRouter = Router();
authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0]?.message ?? "Eingaben pr\xFCfen.");
    return;
  }
  const { email, password, displayName } = parsed.data;
  try {
    const existing = await pool.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [email]);
    if (existing.rowCount) {
      fail(res, 409, "email-in-use", "F\xFCr diese E-Mail existiert schon ein Konto.");
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    const created = await pool.query(
      `INSERT INTO users (email, email_lower, password_hash, display_name) VALUES ($1,$2,$3,$4)
       RETURNING id, email, display_name`,
      [email.toLowerCase(), email.toLowerCase(), hash, displayName]
    );
    const user = created.rows[0];
    res.status(201).json({
      token: signToken(user.id, user.email, 0),
      user: { id: user.id, email: user.email, displayName: user.display_name },
      household: null
    });
  } catch (e) {
    console.error("[auth/register]", e);
    fail(res, 500, "register-failed", "Registrierung fehlgeschlagen.");
  }
});
authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", "E-Mail und Passwort angeben.");
    return;
  }
  const { email, password } = parsed.data;
  try {
    const found = await pool.query("SELECT id, email, password_hash, display_name, token_version FROM users WHERE lower(email) = lower($1)", [email]);
    const user = found.rows[0];
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      fail(res, 401, "invalid-credentials", "E-Mail oder Passwort ist falsch.");
      return;
    }
    res.json({
      token: signToken(user.id, user.email, user.token_version),
      user: { id: user.id, email: user.email, displayName: user.display_name }
    });
  } catch (e) {
    console.error("[auth/login]", e);
    fail(res, 500, "login-failed", "Login fehlgeschlagen.");
  }
});
var DEMO_EMAIL = process.env.DEMO_EMAIL?.trim() || "demo@example.com";
async function handleDemo(_req, res) {
  try {
    const found = await pool.query(
      "SELECT id, email, display_name, token_version FROM users WHERE lower(email) = lower($1) LIMIT 1",
      [DEMO_EMAIL]
    );
    const user = found.rows[0];
    if (!user) {
      fail(res, 404, "demo-missing", "Demo ist nicht eingerichtet.");
      return;
    }
    res.json({
      token: signToken(user.id, user.email, user.token_version),
      user: { id: user.id, email: user.email, displayName: user.display_name }
    });
  } catch (e) {
    console.error("[auth/demo]", e);
    fail(res, 500, "demo-failed", "Demo konnte nicht geladen werden.");
  }
}
authRouter.get("/demo", handleDemo);
authRouter.post("/demo", handleDemo);
authRouter.get("/me", async (req, res) => {
  if (!req.userId) {
    fail(res, 401, "unauthorized", "Bitte einloggen.");
    return;
  }
  const user = await pool.query(
    "SELECT id, email, display_name, created_at FROM users WHERE id = $1",
    [req.userId]
  );
  if (!user.rowCount) {
    fail(res, 401, "unauthorized", "Konto nicht gefunden.");
    return;
  }
  const households = await pool.query(
    `SELECT h.id, h.name, m.role, h.invite_code,
            (SELECT count(*) FROM household_members hm WHERE hm.household_id = h.id)::text AS members,
            (SELECT count(*) FROM recipes rc WHERE rc.household_id = h.id AND rc.status = 'active')::text AS recipes
       FROM households h
       JOIN household_members m ON m.household_id = h.id
      WHERE m.user_id = $1
      ORDER BY m.joined_at ASC`,
    [req.userId]
  );
  res.json({
    user: {
      id: user.rows[0].id,
      email: user.rows[0].email,
      displayName: user.rows[0].display_name,
      createdAt: user.rows[0].created_at
    },
    households: households.rows.map((h) => ({
      id: h.id,
      name: h.name,
      role: h.role,
      inviteCode: h.invite_code,
      memberCount: Number(h.members),
      recipeCount: Number(h.recipes)
    })),
    settings: await loadSettings(req.userId)
  });
});
authRouter.patch("/me", async (req, res) => {
  if (!req.userId) {
    fail(res, 401, "unauthorized", "Bitte einloggen.");
    return;
  }
  const parsed = z.object({ displayName: z.string().trim().min(2).max(80) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", "Name zu kurz.");
    return;
  }
  const updated = await pool.query(
    "UPDATE users SET display_name = $1 WHERE id = $2 RETURNING id, email, display_name",
    [parsed.data.displayName, req.userId]
  );
  res.json({
    user: { id: updated.rows[0].id, email: updated.rows[0].email, displayName: updated.rows[0].display_name }
  });
});
authRouter.get("/settings", async (req, res) => {
  if (!req.userId) {
    fail(res, 401, "unauthorized", "Bitte einloggen.");
    return;
  }
  res.json({ settings: await loadSettings(req.userId) });
});
authRouter.put("/settings", async (req, res) => {
  if (!req.userId) {
    fail(res, 401, "unauthorized", "Bitte einloggen.");
    return;
  }
  try {
    res.json({ settings: await saveSettings(req.userId, req.body) });
  } catch (e) {
    console.error("[auth/settings]", e);
    fail(res, 500, "settings-failed", "Einstellungen konnten nicht gespeichert werden.");
  }
});
authRouter.post("/change-password", async (req, res) => {
  if (!req.userId) {
    fail(res, 401, "unauthorized", "Bitte einloggen.");
    return;
  }
  const parsed = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", "Neues Passwort braucht mindestens 8 Zeichen.");
    return;
  }
  const found = await pool.query(
    "SELECT email, password_hash, token_version FROM users WHERE id = $1",
    [req.userId]
  );
  if (!found.rowCount || !await bcrypt.compare(parsed.data.currentPassword, found.rows[0].password_hash)) {
    fail(res, 403, "invalid-credentials", "Aktuelles Passwort stimmt nicht.");
    return;
  }
  const hash = await bcrypt.hash(parsed.data.newPassword, 12);
  const version = found.rows[0].token_version + 1;
  await pool.query("UPDATE users SET password_hash = $1, token_version = $2 WHERE id = $3", [hash, version, req.userId]);
  invalidateTokenCache(req.userId);
  res.json({ ok: true, token: signToken(req.userId, found.rows[0].email, version) });
});
authRouter.post("/forgot-password", async (req, res) => {
  const parsed = z.object({ email: z.string().trim().email() }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", "Bitte eine E-Mail-Adresse angeben.");
    return;
  }
  const email = parsed.data.email.toLowerCase();
  const user = await pool.query("SELECT id, email FROM users WHERE lower(email) = $1", [
    email
  ]);
  const generic = { ok: true, devLink: null };
  if (!user.rowCount) {
    res.json(generic);
    return;
  }
  const token = randomBytes2(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1,$2, now() + ($3 || ' minutes')::interval)`,
    [user.rows[0].id, tokenHash, String(RESET_TTL_MINUTES)]
  );
  const link = `${APP_PUBLIC_URL}/#/reset?token=${token}`;
  const mailed = await sendResetMail(user.rows[0].email, link);
  res.json({
    ok: true,
    mailed,
    devLink: !mailed && DEV_RESET_LINK ? link : null
  });
});
authRouter.post("/reset-password", async (req, res) => {
  const parsed = z.object({ token: z.string().min(20), newPassword: z.string().min(8).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", "Token fehlt oder Passwort zu kurz (min. 8 Zeichen).");
    return;
  }
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const found = await pool.query(
    `SELECT t.id, t.user_id, u.email FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()`,
    [tokenHash]
  );
  if (!found.rowCount) {
    fail(res, 400, "invalid-token", "Der Link ist abgelaufen oder wurde schon benutzt.");
    return;
  }
  const row = found.rows[0];
  const hash = await bcrypt.hash(parsed.data.newPassword, 12);
  const bumped = await pool.query(
    "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING token_version",
    [hash, row.user_id]
  );
  await pool.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [row.id]);
  invalidateTokenCache(row.user_id);
  res.json({ ok: true, token: signToken(row.user_id, row.email, bumped.rows[0].token_version) });
});
authRouter.post("/logout-all", async (req, res) => {
  if (!req.userId) {
    fail(res, 401, "unauthorized", "Bitte einloggen.");
    return;
  }
  const bumped = await pool.query(
    "UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version",
    [req.userId]
  );
  invalidateTokenCache(req.userId);
  res.json({ ok: true, tokenVersion: bumped.rows[0].token_version });
});
authRouter.delete("/me", async (req, res) => {
  if (!req.userId) {
    fail(res, 401, "unauthorized", "Bitte einloggen.");
    return;
  }
  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", "Zur Best\xE4tigung das Passwort angeben.");
    return;
  }
  const found = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.userId]);
  if (!found.rowCount || !await bcrypt.compare(parsed.data.password, found.rows[0].password_hash)) {
    fail(res, 403, "invalid-credentials", "Passwort stimmt nicht.");
    return;
  }
  const shared = await pool.query(
    `SELECT h.id, h.name FROM households h
       JOIN household_members m ON m.household_id = h.id AND m.user_id = $1 AND m.role = 'owner'
      WHERE (SELECT count(*) FROM household_members x WHERE x.household_id = h.id) > 1`,
    [req.userId]
  );
  if (shared.rowCount) {
    fail(res, 409, "household-handover-required", `Du bist noch Besitzer von \u201E${shared.rows[0].name}" mit weiteren Mitgliedern.`);
    return;
  }
  await pool.query(
    `DELETE FROM households h
      WHERE NOT EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = h.id AND m.user_id <> $1)
        AND EXISTS (SELECT 1 FROM household_members m2 WHERE m2.household_id = h.id AND m2.user_id = $1)`,
    [req.userId]
  );
  await pool.query("UPDATE recipes SET owner_id = NULL WHERE owner_id = $1", [req.userId]);
  await pool.query("DELETE FROM users WHERE id = $1", [req.userId]);
  invalidateTokenCache(req.userId);
  res.json({ ok: true });
});

// server/plans.ts
import { Router as Router3 } from "express";

// server/events.ts
import { Router as Router2 } from "express";
var clients = /* @__PURE__ */ new Map();
var nextId = 1;
function subscribe(householdId, res) {
  const id = nextId++;
  if (!clients.has(householdId)) clients.set(householdId, /* @__PURE__ */ new Map());
  clients.get(householdId).set(id, { id, res });
  return () => {
    clients.get(householdId)?.delete(id);
    if (clients.get(householdId)?.size === 0) clients.delete(householdId);
  };
}
function broadcast(householdId, type) {
  const group = clients.get(householdId);
  if (!group) return;
  const payload = `data: ${JSON.stringify({ type, at: Date.now() })}

`;
  for (const client of group.values()) {
    try {
      client.res.write(payload);
    } catch {
      group.delete(client.id);
    }
  }
}
var eventsRouter = Router2();
eventsRouter.get("/", async (req, res) => {
  const token = String(req.query.token ?? "");
  const householdId = String(req.query.householdId ?? "");
  const auth = verifyToken(token);
  if (!auth || !/^[0-9a-f-]{36}$/i.test(householdId)) {
    res.status(401).end();
    return;
  }
  const member = await pool.query("SELECT 1 FROM household_members WHERE household_id = $1 AND user_id = $2", [
    householdId,
    auth.userId
  ]);
  if (!member.rowCount) {
    res.status(403).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(`retry: 5000

`);
  res.write(`data: ${JSON.stringify({ type: "hello", at: Date.now() })}

`);
  const unsubscribe = subscribe(householdId, res);
  const keepAlive = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(keepAlive);
    }
  }, 25e3);
  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

// server/plans.ts
var plansRouter = Router3();
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}
async function ensurePlan(householdId, weekStart, userId) {
  const existing = await pool.query(
    "SELECT id FROM meal_plans WHERE household_id = $1 AND week_start = $2",
    [householdId, weekStart]
  );
  if (existing.rowCount) return existing.rows[0].id;
  const created = await pool.query(
    `INSERT INTO meal_plans (household_id, week_start, created_by) VALUES ($1,$2,$3)
     ON CONFLICT (household_id, week_start) DO UPDATE SET household_id = EXCLUDED.household_id
     RETURNING id`,
    [householdId, weekStart, userId]
  );
  return created.rows[0].id;
}
async function loadPlan(householdId, weekStart) {
  const plan = await pool.query(
    "SELECT id, week_start, created_at FROM meal_plans WHERE household_id = $1 AND week_start = $2",
    [householdId, weekStart]
  );
  if (!plan.rowCount) return { weekStart, planId: null, entries: [] };
  const entries = await pool.query(
    `SELECT e.id, e.day_index, e.position, e.slot, e.recipe_id, e.custom_title, e.servings,
            r.title, r.servings AS recipe_servings, r.prep_minutes, r.tags, r.nutrition
       FROM plan_entries e
       LEFT JOIN recipes r ON r.id = e.recipe_id
      WHERE e.plan_id = $1
      ORDER BY e.day_index ASC, e.position ASC, e.created_at ASC`,
    [plan.rows[0].id]
  );
  return {
    weekStart,
    planId: plan.rows[0].id,
    entries: entries.rows.map((e) => ({
      id: e.id,
      dayIndex: e.day_index,
      position: e.position,
      slot: e.slot,
      recipeId: e.recipe_id,
      title: e.title ?? e.custom_title ?? "Ohne Titel",
      customTitle: e.custom_title,
      servings: e.servings ?? e.recipe_servings ?? null,
      prepMinutes: e.prep_minutes,
      tags: e.tags ?? [],
      nutrition: e.nutrition ?? {}
    }))
  };
}
plansRouter.get("/:householdId/:weekStart", async (req, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (!isValidDate(req.params.weekStart)) {
    fail(res, 400, "invalid-date", "Datum im Format YYYY-MM-DD angeben.");
    return;
  }
  res.json(await loadPlan(req.params.householdId, req.params.weekStart));
});
plansRouter.post("/:householdId/:weekStart/entries", async (req, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (!isValidDate(req.params.weekStart)) {
    fail(res, 400, "invalid-date", "Datum im Format YYYY-MM-DD angeben.");
    return;
  }
  const { dayIndex, recipeId, customTitle, servings } = req.body;
  if (typeof dayIndex !== "number" || dayIndex < 0 || dayIndex > 6) {
    fail(res, 400, "invalid-input", "Tag zwischen 0 (Montag) und 6 (Sonntag) angeben.");
    return;
  }
  if (!recipeId && !customTitle?.trim()) {
    fail(res, 400, "invalid-input", "Rezept oder eigener Titel n\xF6tig.");
    return;
  }
  if (recipeId) {
    const exists = await pool.query("SELECT 1 FROM recipes WHERE id = $1", [recipeId]);
    if (!exists.rowCount) {
      fail(res, 400, "invalid-recipe", "Rezept nicht gefunden.");
      return;
    }
  }
  const planId = await ensurePlan(req.params.householdId, req.params.weekStart, req.userId);
  const next = await pool.query(
    "SELECT coalesce(max(position) + 1, 0)::int AS pos FROM plan_entries WHERE plan_id = $1 AND day_index = $2",
    [planId, dayIndex]
  );
  await pool.query(
    `INSERT INTO plan_entries (plan_id, day_index, slot, position, recipe_id, custom_title, servings)
     VALUES ($1,$2,'mahlzeit',$3,$4,$5,$6)`,
    [planId, dayIndex, next.rows[0].pos, recipeId ?? null, customTitle?.trim() || null, servings ?? null]
  );
  broadcast(req.params.householdId, "plan");
  res.json(await loadPlan(req.params.householdId, req.params.weekStart));
});
plansRouter.patch("/:householdId/:weekStart/entries/:entryId", async (req, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const servings = req.body.servings;
  if (servings != null && (!Number.isFinite(Number(servings)) || Number(servings) < 1 || Number(servings) > 50)) {
    fail(res, 400, "invalid-input", "Portionen zwischen 1 und 50.");
    return;
  }
  await pool.query(
    `UPDATE plan_entries e SET servings = $1
       FROM meal_plans p
      WHERE e.id = $2 AND e.plan_id = p.id AND p.household_id = $3 AND p.week_start = $4`,
    [servings ?? null, req.params.entryId, req.params.householdId, req.params.weekStart]
  );
  broadcast(req.params.householdId, "plan");
  res.json(await loadPlan(req.params.householdId, req.params.weekStart));
});
plansRouter.put("/:householdId/:weekStart/reorder", async (req, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    fail(res, 400, "invalid-input", "Keine Reihenfolge \xFCbergeben.");
    return;
  }
  const plan = await pool.query(
    "SELECT id FROM meal_plans WHERE household_id = $1 AND week_start = $2",
    [req.params.householdId, req.params.weekStart]
  );
  if (!plan.rowCount) {
    fail(res, 404, "not-found", "F\xFCr diese Woche existiert kein Plan.");
    return;
  }
  const planId = plan.rows[0].id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of items.slice(0, 200)) {
      if (typeof item.id !== "string" || typeof item.dayIndex !== "number" || typeof item.position !== "number") continue;
      if (item.dayIndex < 0 || item.dayIndex > 6) continue;
      await client.query("UPDATE plan_entries SET day_index = $1, position = $2 WHERE id = $3 AND plan_id = $4", [
        item.dayIndex,
        Math.max(0, Math.round(item.position)),
        item.id,
        planId
      ]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[plans/reorder]", e);
    fail(res, 500, "reorder-failed", "Reihenfolge konnte nicht gespeichert werden.");
    return;
  } finally {
    client.release();
  }
  broadcast(req.params.householdId, "plan");
  res.json(await loadPlan(req.params.householdId, req.params.weekStart));
});
plansRouter.delete("/:householdId/:weekStart", async (req, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const removed = await pool.query(
    `DELETE FROM plan_entries e USING meal_plans p
      WHERE e.plan_id = p.id AND p.household_id = $1 AND p.week_start = $2`,
    [req.params.householdId, req.params.weekStart]
  );
  broadcast(req.params.householdId, "plan");
  res.json({ ...await loadPlan(req.params.householdId, req.params.weekStart), removed: removed.rowCount ?? 0 });
});
plansRouter.delete("/:householdId/:weekStart/entry/:entryId", async (req, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  await pool.query(
    `DELETE FROM plan_entries e USING meal_plans p
      WHERE e.id = $1 AND e.plan_id = p.id AND p.household_id = $2 AND p.week_start = $3`,
    [req.params.entryId, req.params.householdId, req.params.weekStart]
  );
  broadcast(req.params.householdId, "plan");
  res.json(await loadPlan(req.params.householdId, req.params.weekStart));
});

// server/recipes.ts
import { Router as Router4 } from "express";

// server/recipeSchema.ts
import { z as z2 } from "zod";
var SLOTS = ["fruehstueck", "mittag", "abend", "snack"];
var slotSchema = z2.enum(SLOTS);
var ingredientSchema = z2.object({
  name: z2.string().trim().min(1).max(120),
  amount: z2.number().nonnegative().max(1e5).nullable().optional(),
  unit: z2.string().trim().max(24).optional()
});
var stepFromAi = z2.union([z2.string(), z2.object({ text: z2.string() }).transform((v) => v.text)]);
var nutritionSchema = z2.object({
  kcal: z2.number().nonnegative().max(2e4).optional(),
  protein: z2.number().nonnegative().max(1e3).optional(),
  carbs: z2.number().nonnegative().max(2e3).optional(),
  fat: z2.number().nonnegative().max(1e3).optional()
});
var difficultySchema = z2.enum(["leicht", "mittel", "schwer"]);
var recipeInputSchema = z2.object({
  title: z2.string().trim().min(2, "Titel zu kurz").max(160),
  description: z2.string().trim().max(2e3).optional().default(""),
  servings: z2.number().int().min(1).max(50).optional().default(2),
  prepMinutes: z2.number().int().min(0).max(1440).nullable().optional(),
  totalMinutes: z2.number().int().min(0).max(2880).nullable().optional(),
  difficulty: difficultySchema.nullable().optional(),
  imageUrl: z2.string().trim().max(2e6).refine((v) => v === "" || /^https?:\/\//.test(v) || /^data:image\/(png|jpe?g|webp);base64,/.test(v), "Ung\xFCltige Bildquelle").nullable().optional(),
  tags: z2.array(z2.string().trim().min(1).max(40)).max(12).optional().default([]),
  ingredients: z2.array(ingredientSchema).min(1, "Mindestens eine Zutat").max(60),
  steps: z2.array(stepFromAi).min(1, "Mindestens ein Schritt").max(40),
  nutrition: nutritionSchema.optional().default({})
});
var aiRecipeSchema = z2.object({
  title: z2.string().trim().min(2).max(160),
  description: z2.string().trim().max(2e3).optional().default(""),
  servings: z2.number().min(1).max(50).optional().default(2),
  prepMinutes: z2.number().min(0).max(1440).nullable().optional(),
  totalMinutes: z2.number().min(0).max(2880).nullable().optional(),
  difficulty: z2.enum(["leicht", "mittel", "schwer"]).optional().default("mittel"),
  tags: z2.array(z2.string()).max(12).optional().default([]),
  ingredients: z2.array(
    z2.object({
      name: z2.string().trim().min(1),
      amount: z2.number().nonnegative().nullable().optional(),
      unit: z2.string().trim().max(24).optional()
    })
  ).min(1).max(60),
  steps: z2.array(stepFromAi).min(1).max(40),
  nutrition: nutritionSchema.optional().default({})
});
var weekPlanSchema = z2.object({
  days: z2.array(
    z2.object({
      dayIndex: z2.number().int().min(0).max(6),
      meals: z2.array(
        z2.object({
          slot: slotSchema,
          recipe: aiRecipeSchema
        })
      ).max(6).default([])
    })
  ).min(1).max(7),
  notes: z2.string().max(2e3).optional().default("")
});
function normalizeRecipe(input) {
  return {
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    servings: Math.max(1, Math.round(input.servings ?? 2)),
    prepMinutes: input.prepMinutes != null ? Math.round(input.prepMinutes) : null,
    totalMinutes: input.totalMinutes != null ? Math.round(input.totalMinutes) : null,
    difficulty: input.difficulty ?? "mittel",
    imageUrl: input.imageUrl?.trim() || null,
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 12),
    ingredients: input.ingredients.map((i) => ({
      name: i.name.trim(),
      amount: i.amount ?? null,
      unit: (i.unit ?? "").trim()
    })),
    steps: input.steps.map((s) => typeof s === "string" ? s : s.text).map((s) => s.trim()).filter(Boolean),
    nutrition: input.nutrition ?? {}
  };
}

// server/recipes.ts
var recipesRouter = Router4();
async function applyMeta(recipeId, recipe) {
  const meta = deriveMeta({
    title: recipe.title,
    description: recipe.description ?? "",
    tags: recipe.tags ?? [],
    ingredients: recipe.ingredients ?? [],
    nutrition: recipe.nutrition ?? null
  });
  await pool.query("UPDATE recipes SET diets = $2, cuisines = $3, allergens = $4 WHERE id = $1", [
    recipeId,
    meta.diets,
    meta.cuisines,
    meta.allergens
  ]);
}
function mapRecipe(row) {
  return {
    id: row.id,
    householdId: row.household_id,
    authorId: row.owner_id,
    authorName: row.author_name,
    title: row.title,
    description: row.description,
    servings: row.servings,
    prepMinutes: row.prep_minutes,
    totalMinutes: row.total_minutes,
    difficulty: row.difficulty,
    imageUrl: null,
    // Bilder sind abgeschafft: Rezepte zeigen nur Titel und Text
    tags: row.tags ?? [],
    diets: row.diets ?? [],
    cuisines: row.cuisines ?? [],
    allergens: row.allergens ?? [],
    source: row.source,
    status: row.status,
    ingredients: row.ingredients ?? [],
    steps: row.steps ?? [],
    nutrition: row.nutrition ?? {},
    favorite: Boolean(row.favorite),
    favoriteCount: Number(row.favorite_count ?? 0),
    rating: row.rating_avg != null ? Math.round(Number(row.rating_avg) * 10) / 10 : null,
    ratingCount: Number(row.rating_count ?? 0),
    myRating: row.my_rating != null ? Number(row.my_rating) : null,
    commentCount: Number(row.comment_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
var SELECT_BASE = `
  SELECT r.*, u.display_name AS author_name,
         EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id = r.id AND f.user_id = $1) AS favorite,
         (SELECT count(*) FROM favorites f2 WHERE f2.recipe_id = r.id)::int AS favorite_count,
         (SELECT avg(stars)::numeric(4,2) FROM recipe_ratings rt WHERE rt.recipe_id = r.id) AS rating_avg,
         (SELECT count(*) FROM recipe_ratings rt2 WHERE rt2.recipe_id = r.id)::int AS rating_count,
         (SELECT stars FROM recipe_ratings rt3 WHERE rt3.recipe_id = r.id AND rt3.user_id = $1) AS my_rating,
         (SELECT count(*) FROM recipe_comments c WHERE c.recipe_id = r.id)::int AS comment_count,
         count(*) OVER ()::int AS full_count
    FROM recipes r
    LEFT JOIN users u ON u.id = r.owner_id
`;
function parseFilters(query) {
  const num2 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    q: String(query.q ?? "").trim(),
    tags: String(query.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8),
    diets: String(query.diets ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10),
    cuisines: String(query.cuisines ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10),
    excludeAllergens: String(query.excludeAllergens ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 14),
    source: ["ai", "manual", "copied"].includes(String(query.source)) ? String(query.source) : "",
    maxMinutes: num2(query.maxMinutes),
    maxKcal: num2(query.maxKcal),
    minProtein: num2(query.minProtein),
    sort: ["newest", "rating", "popular", "quickest", "title"].includes(String(query.sort)) ? String(query.sort) : "newest",
    favoritesOnly: query.favorites === "1",
    mineOnly: query.mine === "1",
    authorId: num2(query.authorId),
    includeArchived: query.archived === "1"
  };
}
function buildWhere(filters, userId, params) {
  const clauses = [];
  if (filters.includeArchived) {
    clauses.push(`(r.status <> 'archived' OR r.owner_id = $${params.push(userId)})`);
  } else {
    clauses.push(`r.status = 'active'`);
  }
  if (filters.favoritesOnly) {
    clauses.push(`EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id = r.id AND f.user_id = $${params.push(userId)})`);
  }
  if (filters.mineOnly) clauses.push(`r.owner_id = $${params.push(userId)}`);
  if (filters.authorId) clauses.push(`r.owner_id = $${params.push(filters.authorId)}`);
  if (filters.source) clauses.push(`r.source = $${params.push(filters.source)}`);
  if (filters.q) {
    const like = `%${filters.q}%`;
    const p = params.push(like);
    clauses.push(
      `(r.title ILIKE $${p} OR r.description ILIKE $${p} OR u.display_name ILIKE $${p} OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(r.ingredients) ing WHERE ing->>'name' ILIKE $${p}))`
    );
  }
  if (filters.tags.length) {
    clauses.push(`r.tags && $${params.push(filters.tags)}::text[]`);
  }
  if (filters.diets.length) {
    clauses.push(`r.diets && $${params.push(filters.diets)}::text[]`);
  }
  if (filters.cuisines.length) {
    clauses.push(`r.cuisines && $${params.push(filters.cuisines)}::text[]`);
  }
  if (filters.excludeAllergens.length) {
    clauses.push(`NOT (r.allergens && $${params.push(filters.excludeAllergens)}::text[])`);
  }
  if (filters.maxMinutes != null) {
    clauses.push(`r.prep_minutes IS NOT NULL AND r.prep_minutes <= $${params.push(filters.maxMinutes)}`);
  }
  if (filters.maxKcal != null) {
    clauses.push(
      `(r.nutrition->>'kcal') ~ '^[0-9]+(\\.[0-9]+)?$' AND (r.nutrition->>'kcal')::numeric <= $${params.push(filters.maxKcal)}`
    );
  }
  if (filters.minProtein != null) {
    clauses.push(
      `(r.nutrition->>'protein') ~ '^[0-9]+(\\.[0-9]+)?$' AND (r.nutrition->>'protein')::numeric >= $${params.push(filters.minProtein)}`
    );
  }
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}
function buildOrder(sort) {
  switch (sort) {
    case "rating":
      return "ORDER BY rating_avg DESC NULLS LAST, rating_count DESC, r.created_at DESC";
    case "popular":
      return "ORDER BY favorite_count DESC, r.created_at DESC";
    case "quickest":
      return "ORDER BY r.prep_minutes ASC NULLS LAST, r.created_at DESC";
    case "title":
      return "ORDER BY lower(r.title) ASC";
    default:
      return "ORDER BY r.created_at DESC";
  }
}
async function resolveHousehold(requested, userId) {
  if (requested && /^[0-9a-f-]{36}$/i.test(requested)) {
    const member = await pool.query("SELECT 1 FROM household_members WHERE household_id = $1 AND user_id = $2", [
      requested,
      userId
    ]);
    if (member.rowCount) return requested;
  }
  const first = await pool.query(
    "SELECT household_id AS id FROM household_members WHERE user_id = $1 ORDER BY joined_at ASC LIMIT 1",
    [userId]
  );
  return first.rows[0]?.id ?? null;
}
recipesRouter.get("/", async (req, res) => {
  const filters = parseFilters(req.query);
  const limit = Math.min(60, Math.max(1, Number(req.query.limit ?? 24) || 24));
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  const params = [req.userId];
  try {
    const where = buildWhere(filters, req.userId, params);
    const rows = await pool.query(
      `${SELECT_BASE} ${where} ${buildOrder(filters.sort)} LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const total = rows.rows[0]?.full_count ?? (offset > 0 ? offset + rows.rows.length : 0);
    res.json({ recipes: rows.rows.map(mapRecipe), total, limit, offset });
  } catch (e) {
    console.error("[recipes/list]", e);
    fail(res, 500, "list-failed", "Rezepte konnten nicht geladen werden.");
  }
});
recipesRouter.get("/facets", async (_req, res) => {
  const tags = await pool.query(
    `SELECT tag, count(*)::int AS count FROM recipes r, unnest(r.tags) AS tag
      WHERE r.status = 'active' GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 40`
  );
  const authors = await pool.query(
    `SELECT u.id, u.display_name AS name, count(*)::int AS count
       FROM recipes r JOIN users u ON u.id = r.owner_id
      WHERE r.status = 'active' GROUP BY u.id, u.display_name ORDER BY count DESC LIMIT 50`
  );
  const totals = await pool.query(
    `SELECT (SELECT count(*) FROM recipes WHERE status = 'active')::int AS recipes,
            (SELECT count(*) FROM favorites f JOIN recipes rf ON rf.id = f.recipe_id WHERE rf.status = 'active')::int AS favorites,
            (SELECT count(*) FROM recipe_ratings rt JOIN recipes rr ON rr.id = rt.recipe_id WHERE rr.status = 'active')::int AS ratings`
  );
  const valueFacet = async (column) => {
    const { rows } = await pool.query(
      `SELECT value, count(*)::int AS count FROM recipes r, unnest(r.${column}) AS value
        WHERE r.status = 'active' GROUP BY value ORDER BY count DESC, value ASC`
    );
    return rows;
  };
  const [diets, cuisines, allergens] = await Promise.all([
    valueFacet("diets"),
    valueFacet("cuisines"),
    valueFacet("allergens")
  ]);
  res.json({ tags: tags.rows, authors: authors.rows, totals: totals.rows[0], diets, cuisines, allergens });
});
recipesRouter.get("/favorites", async (req, res) => {
  const rows = await pool.query(
    `${SELECT_BASE}
      JOIN favorites fav ON fav.recipe_id = r.id AND fav.user_id = $1
     WHERE r.status = 'active'
     ORDER BY fav.created_at DESC LIMIT 200`,
    [req.userId]
  );
  res.json({ recipes: rows.rows.map(mapRecipe) });
});
recipesRouter.get("/:id", async (req, res) => {
  const r = await pool.query(`${SELECT_BASE} WHERE r.id = $2`, [req.userId, req.params.id]);
  if (!r.rowCount) {
    fail(res, 404, "not-found", "Rezept nicht gefunden.");
    return;
  }
  res.json({ recipe: mapRecipe(r.rows[0]) });
});
recipesRouter.post("/", async (req, res) => {
  const body = req.body;
  const parsed = recipeInputSchema.safeParse(body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0]?.message ?? "Rezept pr\xFCfen.");
    return;
  }
  const householdId = await resolveHousehold(String(body.householdId ?? ""), req.userId);
  const recipe = normalizeRecipe(parsed.data);
  const source = ["manual", "ai", "copied"].includes(String(body.source)) ? String(body.source) : "manual";
  const created = await pool.query(
    `INSERT INTO recipes (household_id, owner_id, title, description, servings, prep_minutes, total_minutes, difficulty, image_url, tags, source, ingredients, steps, nutrition)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb)
     RETURNING id`,
    [
      householdId,
      req.userId,
      recipe.title,
      recipe.description,
      recipe.servings,
      recipe.prepMinutes,
      recipe.totalMinutes,
      recipe.difficulty,
      recipe.imageUrl,
      recipe.tags,
      source,
      JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.steps),
      JSON.stringify(recipe.nutrition)
    ]
  );
  const recipeId = created.rows[0].id;
  if (body.favorite === true) {
    await pool.query("INSERT INTO favorites (user_id, recipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
      req.userId,
      recipeId
    ]);
  }
  await applyMeta(recipeId, recipe);
  const fresh = await pool.query(`${SELECT_BASE} WHERE r.id = $2`, [req.userId, recipeId]);
  res.status(201).json({ recipe: mapRecipe(fresh.rows[0]) });
});
recipesRouter.patch("/:id", async (req, res) => {
  const existing = await pool.query("SELECT owner_id FROM recipes WHERE id = $1", [
    req.params.id
  ]);
  if (!existing.rowCount) {
    fail(res, 404, "not-found", "Rezept nicht gefunden.");
    return;
  }
  if (existing.rows[0].owner_id !== req.userId) {
    fail(res, 403, "not-author", "Nur der Ersteller kann das Rezept \xE4ndern.");
    return;
  }
  const parsed = recipeInputSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0]?.message ?? "Rezept pr\xFCfen.");
    return;
  }
  const recipe = normalizeRecipe(parsed.data);
  await pool.query(
    `UPDATE recipes SET title=$1, description=$2, servings=$3, prep_minutes=$4, tags=$5,
            ingredients=$6::jsonb, steps=$7::jsonb, nutrition=$8::jsonb,
            total_minutes=$9, difficulty=$10, image_url=$11, updated_at=now()
      WHERE id=$12`,
    [
      recipe.title,
      recipe.description,
      recipe.servings,
      recipe.prepMinutes,
      recipe.tags,
      JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.steps),
      JSON.stringify(recipe.nutrition),
      recipe.totalMinutes,
      recipe.difficulty,
      recipe.imageUrl,
      req.params.id
    ]
  );
  await applyMeta(req.params.id, recipe);
  const fresh = await pool.query(`${SELECT_BASE} WHERE r.id = $2`, [req.userId, req.params.id]);
  res.json({ recipe: mapRecipe(fresh.rows[0]) });
});
recipesRouter.delete("/:id", async (req, res) => {
  const existing = await pool.query("SELECT owner_id FROM recipes WHERE id = $1", [
    req.params.id
  ]);
  if (!existing.rowCount) {
    fail(res, 404, "not-found", "Rezept nicht gefunden.");
    return;
  }
  if (existing.rows[0].owner_id !== req.userId) {
    fail(res, 403, "not-author", "Nur der Ersteller kann das Rezept archivieren.");
    return;
  }
  await pool.query("UPDATE recipes SET status = 'archived', archived_at = now() WHERE id = $1", [req.params.id]);
  res.json({ ok: true, archived: true });
});
recipesRouter.post("/:id/restore", async (req, res) => {
  const r = await pool.query(
    "UPDATE recipes SET status = 'active', archived_at = NULL WHERE id = $1 AND owner_id = $2 RETURNING id",
    [req.params.id, req.userId]
  );
  if (!r.rowCount) {
    fail(res, 404, "not-found", "Nicht gefunden oder kein Zugriff.");
    return;
  }
  res.json({ ok: true });
});
recipesRouter.post("/:id/copy", async (req, res) => {
  const source = await pool.query("SELECT * FROM recipes WHERE id = $1", [req.params.id]);
  if (!source.rowCount) {
    fail(res, 404, "not-found", "Rezept nicht gefunden.");
    return;
  }
  const householdId = await resolveHousehold(
    String(req.body.householdId ?? ""),
    req.userId
  );
  const row = source.rows[0];
  const created = await pool.query(
    `INSERT INTO recipes (household_id, owner_id, title, description, servings, prep_minutes, total_minutes, difficulty, image_url, tags, source, ingredients, steps, nutrition)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'copied',$11::jsonb,$12::jsonb,$13::jsonb)
     RETURNING id`,
    [
      householdId,
      req.userId,
      row.title,
      row.description,
      row.servings,
      row.prep_minutes,
      row.total_minutes,
      row.difficulty,
      row.image_url,
      row.tags,
      JSON.stringify(row.ingredients),
      JSON.stringify(row.steps),
      JSON.stringify(row.nutrition)
    ]
  );
  await pool.query("INSERT INTO favorites (user_id, recipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
    req.userId,
    created.rows[0].id
  ]);
  await applyMeta(created.rows[0].id, {
    title: row.title,
    description: row.description,
    tags: row.tags,
    ingredients: row.ingredients,
    nutrition: row.nutrition
  });
  const fresh = await pool.query(`${SELECT_BASE} WHERE r.id = $2`, [req.userId, created.rows[0].id]);
  res.status(201).json({ recipe: mapRecipe(fresh.rows[0]) });
});
recipesRouter.post("/:id/favorite", async (req, res) => {
  const exists = await pool.query("SELECT 1 FROM recipes WHERE id = $1", [req.params.id]);
  if (!exists.rowCount) {
    fail(res, 404, "not-found", "Rezept nicht gefunden.");
    return;
  }
  const removed = await pool.query("DELETE FROM favorites WHERE user_id = $1 AND recipe_id = $2", [
    req.userId,
    req.params.id
  ]);
  if (removed.rowCount) {
    res.json({ favorite: false });
    return;
  }
  await pool.query("INSERT INTO favorites (user_id, recipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
    req.userId,
    req.params.id
  ]);
  res.json({ favorite: true });
});
recipesRouter.post("/:id/rating", async (req, res) => {
  const stars = Number(req.body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    fail(res, 400, "invalid-input", "Bewertung zwischen 1 und 5 Sternen.");
    return;
  }
  const exists = await pool.query("SELECT 1 FROM recipes WHERE id = $1", [req.params.id]);
  if (!exists.rowCount) {
    fail(res, 404, "not-found", "Rezept nicht gefunden.");
    return;
  }
  await pool.query(
    `INSERT INTO recipe_ratings (user_id, recipe_id, stars) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, recipe_id) DO UPDATE SET stars = EXCLUDED.stars, updated_at = now()`,
    [req.userId, req.params.id, stars]
  );
  const agg = await pool.query(
    "SELECT avg(stars)::numeric(4,2) AS avg, count(*)::int AS count FROM recipe_ratings WHERE recipe_id = $1",
    [req.params.id]
  );
  res.json({
    myRating: stars,
    rating: agg.rows[0].avg != null ? Number(agg.rows[0].avg) : null,
    ratingCount: agg.rows[0].count
  });
});
recipesRouter.delete("/:id/rating", async (req, res) => {
  await pool.query("DELETE FROM recipe_ratings WHERE user_id = $1 AND recipe_id = $2", [req.userId, req.params.id]);
  res.json({ ok: true });
});
recipesRouter.get("/:id/comments", async (req, res) => {
  const rows = await pool.query(
    `SELECT c.id, c.body, u.display_name AS author, c.user_id, c.created_at
       FROM recipe_comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.recipe_id = $1 ORDER BY c.created_at DESC LIMIT 200`,
    [req.params.id]
  );
  res.json({
    comments: rows.rows.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.author ?? "Unbekannt",
      userId: c.user_id,
      createdAt: c.created_at,
      mine: c.user_id === req.userId
    }))
  });
});
recipesRouter.post("/:id/comments", async (req, res) => {
  const body = String(req.body.body ?? "").trim();
  if (body.length < 2 || body.length > 2e3) {
    fail(res, 400, "invalid-input", "Kommentar muss zwischen 2 und 2000 Zeichen haben.");
    return;
  }
  const exists = await pool.query("SELECT 1 FROM recipes WHERE id = $1", [req.params.id]);
  if (!exists.rowCount) {
    fail(res, 404, "not-found", "Rezept nicht gefunden.");
    return;
  }
  const created = await pool.query(
    "INSERT INTO recipe_comments (recipe_id, user_id, body) VALUES ($1,$2,$3) RETURNING id",
    [req.params.id, req.userId, body]
  );
  res.status(201).json({ id: created.rows[0].id });
});
recipesRouter.delete("/:id/comments/:commentId", async (req, res) => {
  const deleted = await pool.query("DELETE FROM recipe_comments WHERE id = $1 AND user_id = $2 RETURNING id", [
    req.params.commentId,
    req.userId
  ]);
  if (!deleted.rowCount) {
    fail(res, 403, "not-allowed", "Nur der eigene Kommentar kann gel\xF6scht werden.");
    return;
  }
  res.json({ ok: true });
});

// server/shopping.ts
import { Router as Router6 } from "express";

// server/ai.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Router as Router5 } from "express";
import { z as z3 } from "zod";

// server/scheduler.ts
var CHECK_INTERVAL_MS = 10 * 60 * 1e3;
var START_HOUR = 5;
function berlinNow() {
  const now = /* @__PURE__ */ new Date();
  const fmt = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const map = { Mo: 0, Di: 1, Mi: 2, Do: 3, Fr: 4, Sa: 5, So: 6 };
  const day = map[parts.weekday] ?? 0;
  return {
    // 0 = Montag, damit es zu planDays passt; Freitag ist 4
    day: day + 1 === 7 ? 6 : day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    ymd: `${parts.year}-${parts.month}-${parts.day}`
  };
}
function mondayOfYmd(ymd) {
  const d = /* @__PURE__ */ new Date(`${ymd}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}
function addDays(ymd, days) {
  const d = /* @__PURE__ */ new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auto_plan_runs (
      household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      week_start   date NOT NULL,
      ok           boolean NOT NULL DEFAULT true,
      message      text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (household_id, week_start)
    );
  `);
}
async function prebuildNextWeek(householdId, userId) {
  const { ymd } = berlinNow();
  const nextWeek = addDays(mondayOfYmd(ymd), 7);
  const prefs = await loadHouseholdPreferences(householdId);
  const result = await planWeekForUser(userId, {
    householdId,
    weekStart: nextWeek,
    mode: "replace",
    mergeMembers: true,
    days: prefs.planDays,
    slots: prefs.planSlots,
    servings: prefs.planServings
  });
  await pool.query(
    `INSERT INTO auto_plan_runs (household_id, week_start, ok, message) VALUES ($1,$2,true,'auf Zuruf')
     ON CONFLICT (household_id, week_start) DO UPDATE SET ok = true, message = 'auf Zuruf', created_at = now()`,
    [householdId, nextWeek]
  );
  broadcast(householdId, "plan");
  return { weekStart: nextWeek, created: result.created, reused: result.reused };
}
async function runFridayPlanning() {
  const { day, hour, ymd } = berlinNow();
  if (day !== 4 || hour < START_HOUR) return 0;
  const nextWeek = addDays(mondayOfYmd(ymd), 7);
  const households = await pool.query(
    `SELECT h.id, min(m.user_id) AS owner_id
       FROM households h JOIN household_members m ON m.household_id = h.id
      GROUP BY h.id`
  );
  let planned = 0;
  for (const hh of households.rows) {
    try {
      const prefs = await loadHouseholdPreferences(hh.id);
      if (!prefs.autoPlan) continue;
      const done = await pool.query("SELECT 1 FROM auto_plan_runs WHERE household_id = $1 AND week_start = $2", [
        hh.id,
        nextWeek
      ]);
      if (done.rowCount) continue;
      const existing = await loadPlan(hh.id, nextWeek);
      if (existing.entries.length > 0) {
        await pool.query(
          `INSERT INTO auto_plan_runs (household_id, week_start, ok, message) VALUES ($1,$2,true,'bereits geplant')
           ON CONFLICT DO NOTHING`,
          [hh.id, nextWeek]
        );
        continue;
      }
      await planWeekForUser(hh.owner_id, {
        householdId: hh.id,
        weekStart: nextWeek,
        mode: "replace",
        mergeMembers: true,
        days: prefs.planDays,
        slots: prefs.planSlots,
        servings: prefs.planServings
      });
      await pool.query(
        `INSERT INTO auto_plan_runs (household_id, week_start, ok, message) VALUES ($1,$2,true,'vorgebaut')
         ON CONFLICT (household_id, week_start) DO UPDATE SET ok = true, message = 'vorgebaut', created_at = now()`,
        [hh.id, nextWeek]
      );
      broadcast(hh.id, "plan");
      planned += 1;
      console.log(`\u{1F4C5} Woche ${nextWeek} f\xFCr Haushalt ${hh.id} vorgebaut`);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "unbekannt";
      console.error(`Vorbau f\xFCr ${hh.id} fehlgeschlagen:`, message);
      await pool.query(
        `INSERT INTO auto_plan_runs (household_id, week_start, ok, message) VALUES ($1,$2,false,$3)
         ON CONFLICT (household_id, week_start) DO UPDATE SET ok = false, message = $3, created_at = now()`,
        [hh.id, nextWeek, message]
      ).catch(() => void 0);
    }
  }
  return planned;
}
function startScheduler() {
  void ensureTable().catch((e) => console.error("Scheduler-Tabelle", e));
  const tick = async () => {
    try {
      await runFridayPlanning();
    } catch (error) {
      console.error("Scheduler", error);
    }
  };
  const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
  void tick();
  return timer;
}

// server/ai.ts
var WEEK_MOTTOS = [
  "Hausmannskost, wie bei Oma",
  "mediterran (italienisch, griechisch, spanisch)",
  "deftig mit Ofengem\xFCse",
  "asiatisch angehaucht, aber mit Zutaten aus dem Supermarkt",
  "schnelle Pfannengerichte unter 30 Minuten",
  "Eint\xF6pfe und Aufl\xE4ufe",
  "Familiengerichte mit Hackfleisch oder Gefl\xFCgel",
  "Fisch und vegetarische Ofengerichte",
  "Restek\xFCche: wenige Zutaten, die sich wiederverwenden lassen"
];
var PROMPT_DIR = process.env.PROMPT_DIR?.trim() || join(process.cwd(), "prompts");
var promptCache = /* @__PURE__ */ new Map();
function loadPrompt(name, fallback) {
  const cached2 = promptCache.get(name);
  if (cached2) return cached2;
  try {
    const raw = readFileSync(join(PROMPT_DIR, `${name}.md`), "utf8");
    promptCache.set(name, raw);
    return raw;
  } catch {
    promptCache.set(name, fallback);
    return fallback;
  }
}
function fillTemplate(template, vars) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => vars[key] ?? "");
}
function isUsableKey(key) {
  const t = key?.trim();
  if (!t || t.length < 16) return false;
  return !/your[_-]/i.test(t);
}
function resolveProvider() {
  const preferred = (process.env.AI_ACTIVE_PROVIDER || "deepseek").trim().toLowerCase();
  const candidates = [
    {
      name: "deepseek",
      apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? "",
      baseUrl: (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1").replace(/\/+$/, ""),
      model: process.env.AI_DEEPSEEK_MODEL?.trim() || "deepseek-chat"
    },
    {
      name: "mistral",
      apiKey: process.env.MISTRAL_API_KEY?.trim() ?? "",
      baseUrl: (process.env.MISTRAL_BASE_URL?.trim() || "https://api.mistral.ai/v1").replace(/\/+$/, ""),
      model: process.env.AI_MISTRAL_MODEL?.trim() || "mistral-large-latest"
    },
    {
      name: "gemini",
      apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
      baseUrl: (process.env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, ""),
      model: process.env.AI_GEMINI_MODEL?.trim() || "gemini-2.5-flash"
    }
  ];
  const usable = candidates.filter((c) => isUsableKey(c.apiKey));
  if (!usable.length) return null;
  return usable.find((c) => c.name === preferred) ?? usable[0];
}
async function callOpenAiCompatible(cfg, prompt, timeoutMs, temperature = 0.5) {
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: "Du antwortest ausschlie\xDFlich mit g\xFCltigem JSON. Kein Markdown, keine Kommentare." },
        { role: "user", content: prompt }
      ],
      temperature,
      max_tokens: 8e3,
      response_format: { type: "json_object" }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!resp.ok) throw new Error(`${cfg.name} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error(`${cfg.name}: leere Antwort`);
  return content;
}
async function callGemini(cfg, prompt, timeoutMs, temperature = 0.5) {
  const resp = await fetch(`${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature, responseMimeType: "application/json", maxOutputTokens: 8192 }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!resp.ok) throw new Error(`gemini HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("gemini: leere Antwort");
  return text;
}
async function completeAiJson(prompt, timeoutMs = 12e4, temperature = 0.5) {
  const cfg = resolveProvider();
  if (!cfg) throw new Error("Kein KI-Provider konfiguriert (DEEPSEEK_API_KEY fehlt).");
  return cfg.name === "gemini" ? callGemini(cfg, prompt, timeoutMs, temperature) : callOpenAiCompatible(cfg, prompt, timeoutMs, temperature);
}
function parseJsonLoose(raw) {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "");
  }
  const start2 = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const slice = start2 >= 0 && end > start2 ? text.slice(start2, end + 1) : text;
  return JSON.parse(slice);
}
async function logRun(userId, kind, ok, startedAt, error) {
  try {
    const cfg = resolveProvider();
    await pool.query(
      "INSERT INTO ai_runs (user_id, kind, provider, model, ok, latency_ms, error) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [userId, kind, cfg?.name ?? null, cfg?.model ?? null, ok, Date.now() - startedAt, error?.slice(0, 500) ?? null]
    );
  } catch {
  }
}
async function generateValidated(prompt, schema, attempts = 2, timeoutMs = 12e4, temperature = 0.5) {
  let lastError = "unbekannt";
  let currentPrompt = prompt;
  for (let i = 0; i < attempts; i++) {
    const raw = await completeAiJson(currentPrompt, timeoutMs, i === 0 ? temperature : Math.min(temperature, 0.4));
    try {
      const parsed = schema.parse(parseJsonLoose(raw));
      return parsed;
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400);
      lastError = `${msg} || Anfang: ${raw.slice(0, 240)} || Ende: ${raw.slice(-160)}`;
      currentPrompt = `${prompt}

DEINE LETZTE ANTWORT WAR UNG\xDCLTIG:
${lastError}
Antworte erneut, diesmal exakt im verlangten JSON-Schema.`;
    }
  }
  throw new Error(`KI-Antwort passte nicht zum Schema: ${lastError}`);
}
var aiRouter = Router5();
aiRouter.get("/status", (_req, res) => {
  const cfg = resolveProvider();
  res.json({
    enabled: Boolean(cfg),
    provider: cfg?.name ?? "none",
    model: cfg?.model ?? null
  });
});
async function callChatText(messages, temperature = 0.4, maxTokens = 700, timeoutMs = 45e3) {
  const cfg = resolveProvider();
  if (!cfg) throw new Error("Kein KI-Provider konfiguriert (DEEPSEEK_API_KEY fehlt).");
  if (cfg.name === "gemini") {
    const transcript = messages.map((m) => `${m.role === "system" ? "ANWEISUNG" : m.role === "user" ? "FRAGE" : "ANTWORT"}: ${m.content}`).join("\n\n");
    return callGemini(cfg, transcript, timeoutMs, temperature);
  }
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!resp.ok) throw new Error(`${cfg.name} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error(`${cfg.name}: leere Antwort`);
  return content.trim();
}
var CHAT_SYSTEM_PROMPT = `Du bist Koch-Assistent in einer Rezept-App und beantwortest Fragen zu genau einem Rezept.

REGELN
1. Antworte auf Deutsch, in der du-Form, kurz und konkret: 2 bis 5 S\xE4tze, mit Mengen und Einheiten.
2. Beziehe dich nur auf das Rezept und das Kochen dazu. Bei Fragen zu anderen Themen antworte in einem Satz, dass du nur zu diesem Rezept hilfst.
3. Fragt jemand nach einem Ersatz: nenne konkret das Ersatzprodukt mit Menge und was sich dadurch \xE4ndert (Geschmack, Konsistenz, Garzeit, grob die N\xE4hrwerte).
4. Bei Umrechnungen (Br\xFChe-Pulver auf Wasser, Gew\xFCrz-Ersatz, Portionsgr\xF6\xDFen) nenne das Verh\xE4ltnis und die konkrete Menge f\xFCr dieses Rezept.
5. Erfinde nichts: was nicht in der Zutatenliste steht, ist nicht drin. Bei Allergiefragen verweise auf die Zutatenliste, statt eine Garantie zu geben.
6. Kein Markdown, keine Tabellen, keine Aufz\xE4hlungszeichen, kein JSON \u2014 nur Flie\xDFtext.`;
aiRouter.post("/recipe-chat", async (req, res) => {
  const body = req.body;
  const question = String(body.question ?? "").trim().slice(0, 600);
  if (question.length < 2) {
    fail(res, 400, "invalid-input", "Bitte eine Frage eingeben.");
    return;
  }
  const r = body.recipe ?? {};
  const ingredients = (r.ingredients ?? []).map((i) => `${i.amount != null ? `${i.amount} ${String(i.unit ?? "").trim()}` : ""} ${String(i.name ?? "").trim()}`.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40);
  if (!ingredients.length) {
    fail(res, 400, "invalid-input", "Zu diesem Rezept fehlen die Zutaten.");
    return;
  }
  const steps = (Array.isArray(r.steps) ? r.steps : []).map((s, i) => `${i + 1}. ${typeof s === "string" ? s : String(s?.text ?? "")}`).slice(0, 20).join("\n");
  const nutrition = r.nutrition ? `pro Portion: ${r.nutrition.kcal ?? "?"} kcal, ${r.nutrition.protein ?? "?"} g Protein, ${r.nutrition.carbs ?? "?"} g Kohlenhydrate, ${r.nutrition.fat ?? "?"} g Fett` : "unbekannt";
  const recipeText = [
    `REZEPT: ${String(r.title ?? "ohne Titel")}`,
    r.description ? `Beschreibung: ${String(r.description)}` : "",
    `Portionen: ${Number(r.servings ?? 2)}`,
    `N\xE4hrwerte ${nutrition}`,
    "ZUTATEN:",
    ...ingredients.map((line) => `- ${line}`),
    "ZUBEREITUNG:",
    steps
  ].filter(Boolean).join("\n");
  const history = (Array.isArray(body.history) ? body.history : []).filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string").slice(-8).map((m) => ({ role: m.role, content: String(m.content).slice(0, 1500) }));
  const started = Date.now();
  try {
    const answer = await callChatText(
      [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        { role: "user", content: recipeText },
        ...history,
        { role: "user", content: question }
      ],
      0.4,
      700,
      45e3
    );
    await logRun(req.userId, "recipe-chat", true, started);
    res.json({ answer });
  } catch (e) {
    await logRun(req.userId, "recipe-chat", false, started, e instanceof Error ? e.message : String(e));
    fail(res, 502, "ai-failed", e instanceof Error ? e.message : "Antwort fehlgeschlagen.");
  }
});
var nutritionEstimateSchema = z3.object({
  kcal: z3.number().nonnegative().max(2e4),
  protein: z3.number().nonnegative().max(2e3),
  carbs: z3.number().nonnegative().max(3e3),
  fat: z3.number().nonnegative().max(2e3)
});
aiRouter.post("/nutrition", async (req, res) => {
  const started = Date.now();
  const body = req.body;
  const ingredients = (body.ingredients ?? []).map((i) => ({
    name: String(i.name ?? "").trim(),
    amount: typeof i.amount === "number" && Number.isFinite(i.amount) ? i.amount : null,
    unit: String(i.unit ?? "").trim()
  })).filter((i) => i.name.length >= 2).slice(0, 40);
  if (!ingredients.length) {
    fail(res, 400, "invalid-input", "Noch keine Zutaten zum Sch\xE4tzen.");
    return;
  }
  const servings = Math.min(50, Math.max(1, Math.round(body.servings ?? 2)));
  const list2 = ingredients.map((i) => `- ${i.amount ?? "nach Bedarf"} ${i.unit} ${i.name}`.replace(/\s+/g, " ").trim()).join("\n");
  try {
    const prompt = fillTemplate(loadPrompt("nutrition-estimate", "Sch\xE4tze die N\xE4hrwerte."), {
      servings: String(servings),
      ingredients: list2
    });
    const estimate = await generateValidated(prompt, nutritionEstimateSchema, 2, 45e3);
    await logRun(req.userId, "nutrition-estimate", true, started);
    res.json({ nutrition: estimate, servings });
  } catch (e) {
    await logRun(req.userId, "nutrition-estimate", false, started, e instanceof Error ? e.message : String(e));
    fail(res, 502, "ai-failed", e instanceof Error ? e.message : "Sch\xE4tzung fehlgeschlagen.");
  }
});
aiRouter.post("/recipe", async (req, res) => {
  const started = Date.now();
  const body = req.body;
  const idea = (body.idea ?? "").trim();
  if (idea.length < 3) {
    fail(res, 400, "invalid-input", "Beschreib kurz, was gekocht werden soll.");
    return;
  }
  const settings = await loadSettings(req.userId);
  const householdPrefsForRecipe = body.householdId ? await loadHouseholdPreferences2(body.householdId) : null;
  const appliances = [.../* @__PURE__ */ new Set([...settings.appliances, ...householdPrefsForRecipe?.appliances ?? []])];
  const dislikes = [.../* @__PURE__ */ new Set([...settings.dislikes, ...householdPrefsForRecipe?.dislikes ?? []])];
  const servings = Math.min(12, Math.max(1, Math.round(body.servings ?? settings.defaultServings ?? 2)));
  const needsSubstitutes = [...settings.diets, ...settings.allergies].some(
    (v) => /gluten|laktose|vegan|vegetarisch|pescetarisch|nuss|ei|soja|fisch|meeresfr|schwein|pilz|sellerie|sesam/i.test(v)
  );
  const constraintParts = [
    (body.constraints ?? "").trim(),
    needsSubstitutes ? "" : "Keine Allergien oder Unvertr\xE4glichkeiten angegeben: KEINE Ersatzprodukte (nicht glutenfrei, nicht laktosefrei, nicht vegan) \u2014 normale Zutaten wie Weizenmehl, Weizennudeln, Kuhmilch, Butter, Sahne verwenden.",
    settings.diets.length ? `Ern\xE4hrungsform: ${settings.diets.join(", ")}` : "",
    settings.allergies.length ? `Unvertr\xE4glichkeiten/Allergien: ${settings.allergies.join(", ")}` : "",
    settings.cuisines.length ? `Bevorzugte K\xFCche: ${settings.cuisines.join(", ")}` : "",
    appliances.length ? `Nur mit diesen K\xFCchenger\xE4ten zubereitbar: ${appliances.join(", ")}` : "",
    dislikes.length ? `Diese Lebensmittel werden nicht gemocht, nicht verwenden: ${dislikes.join(", ")}` : "",
    settings.maxMinutes ? `maximal ${settings.maxMinutes} Minuten Zubereitungszeit` : "",
    settings.kcalTarget ? `grob ${settings.kcalTarget} kcal pro Portion` : "",
    settings.specialWishes ? `Sonderw\xFCnsche: ${settings.specialWishes}` : ""
  ].filter(Boolean);
  try {
    const prompt = fillTemplate(loadPrompt("recipe-draft", "Erstelle ein Rezept als JSON."), {
      idea,
      servings: String(servings),
      constraints: constraintParts.join("; ") || "keine besonderen Vorgaben"
    });
    const draft = normalizeRecipe(await generateValidated(prompt, aiRecipeSchema, 2, 9e4));
    const mode = body.save ?? "favorite";
    if (mode === "none") {
      await logRun(req.userId, "recipe-draft", true, started);
      res.json({ recipe: draft, saved: false });
      return;
    }
    const householdId = await resolveHousehold(String(body.householdId ?? ""), req.userId);
    const created = await pool.query(
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
        JSON.stringify(draft.nutrition)
      ]
    );
    const recipeId = created.rows[0].id;
    const makeFavorite = body.favorite === true || mode === "favorite" || settings.aiAutoFavorite;
    if (makeFavorite) {
      await pool.query("INSERT INTO favorites (user_id, recipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
        req.userId,
        recipeId
      ]);
    }
    await logRun(req.userId, "recipe-draft", true, started);
    res.json({ recipe: { ...draft, id: recipeId }, saved: true, favorite: makeFavorite });
  } catch (e) {
    await logRun(req.userId, "recipe-draft", false, started, e instanceof Error ? e.message : String(e));
    fail(res, 502, "ai-failed", e instanceof Error ? e.message : "KI-Antwort fehlgeschlagen.");
  }
});
aiRouter.post("/recipe/refine", async (req, res) => {
  const started = Date.now();
  const body = req.body;
  const access = await requireHousehold(body.householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const parsed = recipeInputSchema.safeParse(body.recipe);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", "Basisrezept fehlt oder ist unvollst\xE4ndig.");
    return;
  }
  const request = (body.request ?? "").trim();
  if (request.length < 2) {
    fail(res, 400, "invalid-input", "Was soll ge\xE4ndert werden?");
    return;
  }
  try {
    const prompt = fillTemplate(loadPrompt("recipe-refine", "\xDCberarbeite das Rezept als JSON."), {
      recipeJson: JSON.stringify(parsed.data),
      request
    });
    const recipe = await generateValidated(prompt, aiRecipeSchema, 2, 9e4);
    await logRun(req.userId, "recipe-refine", true, started);
    res.json({ recipe: normalizeRecipe(recipe) });
  } catch (e) {
    await logRun(req.userId, "recipe-refine", false, started, e instanceof Error ? e.message : String(e));
    fail(res, 502, "ai-failed", e instanceof Error ? e.message : "KI-Antwort fehlgeschlagen.");
  }
});
var WEEK_DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
var WeekPlanError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
async function planWeekForUser(userId, body) {
  const started = Date.now();
  const access = await requireHousehold(body.householdId, userId);
  if (!access.ok) throw new WeekPlanError(access.status, access.error, access.message);
  const weekStart = String(body.weekStart ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new WeekPlanError(400, "invalid-input", "Wochenstart (YYYY-MM-DD) fehlt.");
  }
  const settings = await loadSettings(userId);
  const householdPrefs2 = body.mergeMembers ? await loadHouseholdPreferences2(body.householdId) : null;
  const householdPlan = await loadHouseholdPreferences(body.householdId);
  const servings = Math.min(
    12,
    Math.max(1, Math.round(body.servings ?? householdPlan.planServings ?? settings.defaultServings ?? 2))
  );
  const requestedSlots = (body.slots ?? householdPlan.planSlots ?? settings.defaultSlots ?? ["abend"]).filter(
    (s) => slotSchema.safeParse(s).success
  );
  const slots = requestedSlots.length ? requestedSlots : ["abend"];
  const allowedDays = Array.isArray(body.days) && body.days.length ? body.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : householdPlan.planDays.length ? householdPlan.planDays : [0, 1, 2, 3, 4, 5, 6];
  const diets = [.../* @__PURE__ */ new Set([...householdPrefs2?.diets ?? [], ...settings.diets])];
  const allergies = [.../* @__PURE__ */ new Set([...householdPrefs2?.allergies ?? [], ...settings.allergies])];
  const cuisines = [.../* @__PURE__ */ new Set([...householdPrefs2?.cuisines ?? [], ...settings.cuisines])];
  const appliances = [.../* @__PURE__ */ new Set([...householdPrefs2?.appliances ?? [], ...settings.appliances])];
  const dislikes = [.../* @__PURE__ */ new Set([...householdPrefs2?.dislikes ?? [], ...settings.dislikes])];
  const maxMinutes = [householdPrefs2?.maxMinutes, settings.maxMinutes].filter((v) => v != null);
  const kcalTarget = householdPrefs2?.kcalTarget ?? settings.kcalTarget;
  const wishes = [settings.specialWishes, ...householdPrefs2?.specialWishes ?? []].filter(Boolean);
  const needsSubstitutes = [...diets, ...allergies].some(
    (v) => /gluten|laktose|vegan|vegetarisch|pescetarisch|nuss|ei|soja|fisch|meeresfr|schwein|pilz|sellerie|sesam/i.test(v)
  );
  const constraintParts = [
    (body.constraints ?? "").trim(),
    needsSubstitutes ? "" : "Keine Allergien oder Unvertr\xE4glichkeiten angegeben: KEINE Ersatzprodukte (nicht glutenfrei, nicht laktosefrei, nicht vegan) \u2014 normale Zutaten verwenden, allt\xE4gliche Hausmannskost.",
    diets.length ? `Ern\xE4hrungsform (f\xFCr ALLE Personen einhalten): ${diets.join(", ")}` : "",
    allergies.length ? `Unvertr\xE4glichkeiten/Allergien (streng meiden): ${allergies.join(", ")}` : "",
    cuisines.length ? `Bevorzugte K\xFCche: ${cuisines.join(", ")}` : "",
    appliances.length ? `Nur mit diesen K\xFCchenger\xE4ten zubereiten (keine anderen voraussetzen): ${appliances.join(", ")}` : "",
    dislikes.length ? `Diese Lebensmittel werden nicht gemocht, nicht verwenden: ${dislikes.join(", ")}` : "",
    maxMinutes.length ? `jede Mahlzeit in maximal ${Math.min(...maxMinutes)} Minuten` : "",
    kcalTarget ? `Tagesziel etwa ${kcalTarget} kcal` : "",
    wishes.length ? `Sonderw\xFCnsche: ${wishes.join(" | ")}` : "",
    allowedDays.length < 7 ? `Nur diese Wochentage planen: ${allowedDays.map((d) => WEEK_DAYS[d]).join(", ")}` : ""
  ].filter(Boolean);
  const recent = await pool.query(
    `SELECT title FROM recipes
      WHERE household_id = $1 AND created_at > now() - interval '21 days'
      ORDER BY created_at DESC LIMIT 40`,
    [body.householdId]
  );
  const recentTitles = [...new Set(recent.rows.map((r) => r.title.trim()).filter(Boolean))].slice(0, 20);
  const motto = WEEK_MOTTOS[Math.floor(Math.random() * WEEK_MOTTOS.length)];
  const existing = await loadPlan(body.householdId, weekStart);
  const existingEntries = existing.entries ?? [];
  const busyDays = body.mode === "fill" ? new Set(existingEntries.map((e) => e.dayIndex)) : /* @__PURE__ */ new Set();
  try {
    const prompt = fillTemplate(loadPrompt("week-plan", "Plane eine Woche als JSON."), {
      weekStart,
      servings: String(servings),
      slots: slots.map((s) => `${s} (${SLOTS.includes(s) ? s : ""})`).join(", "),
      constraints: constraintParts.join("; ") || "keine besonderen Vorgaben",
      existingTitles: existingEntries.map((e) => e.title).join(", ") || "keine",
      recentTitles: recentTitles.join(" | ") || "keine",
      motto
    });
    const plan = await generateValidated(prompt, weekPlanSchema, 3, 24e4, 0.9);
    if (body.mode !== "fill") {
      await pool.query(
        `DELETE FROM plan_entries e USING meal_plans p
          WHERE e.plan_id = p.id AND p.household_id = $1 AND p.week_start = $2`,
        [body.householdId, weekStart]
      );
    }
    const planRow = await pool.query(
      `INSERT INTO meal_plans (household_id, week_start, created_by) VALUES ($1,$2,$3)
       ON CONFLICT (household_id, week_start) DO UPDATE SET household_id = EXCLUDED.household_id
       RETURNING id`,
      [body.householdId, weekStart, userId]
    );
    const planId = planRow.rows[0].id;
    const slotsToFill = [];
    for (const day of plan.days) {
      if (!allowedDays.includes(day.dayIndex) || busyDays.has(day.dayIndex)) continue;
      for (const meal of day.meals ?? []) slotsToFill.push({ dayIndex: day.dayIndex, slot: meal.slot });
    }
    const reuseCount = Math.max(1, Math.min(slotsToFill.length - 1, Math.round(slotsToFill.length * 0.4)));
    const reuseSlots = /* @__PURE__ */ new Set();
    const reuseRecipes = [];
    if (body.mode !== "fill" && reuseCount > 0) {
      const pool2 = await pool.query(
        `SELECT id, title FROM recipes
          WHERE status = 'active' AND title <> ALL($1::text[])
            AND NOT (allergens && $2::text[])
            AND ($3::text[] = '{}' OR diets && $3::text[])
          ORDER BY random() LIMIT $4`,
        [recentTitles.length ? recentTitles : [""], allergies, diets, reuseCount]
      );
      reuseRecipes.push(...pool2.rows);
      const shuffledSlots = [...slotsToFill].sort(() => Math.random() - 0.5);
      for (let i = 0; i < reuseRecipes.length; i++) reuseSlots.add(`${shuffledSlots[i].dayIndex}|${shuffledSlots[i].slot}`);
    }
    let created = 0;
    let reused = 0;
    let reuseIndex = 0;
    const positions = /* @__PURE__ */ new Map();
    for (const day of plan.days) {
      if (!allowedDays.includes(day.dayIndex)) continue;
      const dayMeals = day.meals ?? [];
      if (!dayMeals.length) continue;
      for (const meal of dayMeals) {
        if (busyDays.has(day.dayIndex)) continue;
        if (reuseSlots.has(`${day.dayIndex}|${meal.slot}`) && reuseRecipes[reuseIndex]) {
          const pick = reuseRecipes[reuseIndex++];
          const nextPos2 = positions.get(day.dayIndex) ?? 0;
          positions.set(day.dayIndex, nextPos2 + 1);
          await pool.query(
            `INSERT INTO plan_entries (plan_id, day_index, slot, position, recipe_id, servings)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [planId, day.dayIndex, meal.slot, nextPos2, pick.id, servings]
          );
          reused += 1;
          continue;
        }
        const recipe = normalizeRecipe({ ...meal.recipe, servings: meal.recipe.servings ?? servings });
        const inserted = await pool.query(
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
            JSON.stringify(recipe.nutrition)
          ]
        );
        const nextPos = positions.get(day.dayIndex) ?? 0;
        positions.set(day.dayIndex, nextPos + 1);
        await pool.query(
          `INSERT INTO plan_entries (plan_id, day_index, slot, position, recipe_id, servings)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [planId, day.dayIndex, meal.slot, nextPos, inserted.rows[0].id, servings]
        );
        created += 1;
      }
    }
    await logRun(userId, "week-plan", true, started);
    broadcast(body.householdId, "plan");
    return {
      plan: await loadPlan(body.householdId, weekStart),
      created,
      reused,
      notes: plan.notes ?? "",
      days: [...WEEK_DAYS]
    };
  } catch (e) {
    await logRun(userId, "week-plan", false, started, e instanceof Error ? e.message : String(e));
    throw new WeekPlanError(502, "ai-failed", e instanceof Error ? e.message : "KI-Antwort fehlgeschlagen.");
  }
}
aiRouter.post("/prebuild", async (req, res) => {
  const householdId = String(req.body?.householdId ?? "");
  const access = await requireHousehold(householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  try {
    const result = await prebuildNextWeek(householdId, req.userId);
    res.json(result);
  } catch (e) {
    fail(res, 502, "ai-failed", e instanceof Error ? e.message : "Vorbau fehlgeschlagen.");
  }
});
aiRouter.post("/week", async (req, res) => {
  try {
    res.json(await planWeekForUser(req.userId, req.body));
  } catch (e) {
    if (e instanceof WeekPlanError) {
      fail(res, e.status, e.code, e.message);
      return;
    }
    fail(res, 500, "internal", "Die Woche konnte nicht geplant werden.");
  }
});

// server/shopping.ts
var CATEGORIES = [
  { id: "obst-gemuese", label: "Obst & Gem\xFCse" },
  { id: "milchprodukte", label: "Milchprodukte & Eier" },
  { id: "fleisch-fisch", label: "Fleisch & Fisch" },
  { id: "brot-backwaren", label: "Brot & Backwaren" },
  { id: "vorrat", label: "Nudeln, Reis & Vorrat" },
  { id: "tiefkuehl", label: "Tiefk\xFChl" },
  { id: "getraenke", label: "Getr\xE4nke" },
  { id: "gewuerze", label: "Gew\xFCrze & Saucen" },
  { id: "haushalt", label: "Haushalt & Drogerie" },
  { id: "sonstiges", label: "Sonstiges" }
];
var CATEGORY_IDS = CATEGORIES.map((c) => c.id);
var UNIT_LABELS = {
  g: "g",
  kg: "kg",
  ml: "ml",
  l: "l",
  el: "EL",
  tl: "TL",
  stueck: "St\xFCck",
  "st\xFCck": "St\xFCck",
  prise: "Prise",
  bund: "Bund",
  zehe: "Zehe",
  zehen: "Zehen",
  scheibe: "Scheibe",
  scheiben: "Scheiben",
  dose: "Dose",
  dosen: "Dosen",
  becher: "Becher",
  packung: "Packung",
  stange: "Stange",
  handvoll: "Handvoll"
};
var KEYWORDS = [
  {
    category: "obst-gemuese",
    words: [
      "apfel",
      "\xE4pfel",
      "banane",
      "beere",
      "birne",
      "erdbeere",
      "himbeere",
      "heidelbeere",
      "zitrone",
      "limette",
      "orange",
      "pfirsich",
      "traube",
      "melone",
      "mango",
      "avocado",
      "tomate",
      "gurke",
      "salat",
      "zwiebel",
      "knoblauch",
      "kartoffel",
      "s\xFC\xDFkartoffel",
      "paprika",
      "zucchini",
      "aubergine",
      "karotte",
      "m\xF6hre",
      "lauch",
      "sellerie",
      "spinat",
      "brokkoli",
      "blumenkohl",
      "kohl",
      "rosenkohl",
      "k\xFCrbis",
      "pilz",
      "champignon",
      "ingwer",
      "kraut",
      "petersilie",
      "basilikum",
      "koriander",
      "minze",
      "dill",
      "gem\xFCse",
      "obst",
      "fr\xFChlingszwiebel",
      "bohne",
      "erbse",
      "mais"
    ]
  },
  {
    category: "gewuerze",
    words: [
      // Gewürze zuerst, damit sie nicht in „Sonstiges“ landen. Längere Wörter vor kürzeren:
      // „paprikapulver“ vor „paprika“ (das ist Gemüse und steht in obst-gemuese).
      "paprikapulver",
      "paprika edels\xFC\xDF",
      "paprika rosenscharf",
      "chilipulver",
      "chiliflocken",
      "currypulver",
      "knoblauchpulver",
      "zwiebelpulver",
      "k\xFCmmel",
      "oregano",
      "thymian",
      "rosmarin",
      "zimt",
      "muskat",
      "kurkuma",
      "lorbeer",
      "koriandersamen",
      "senfk\xF6rner",
      "vanillezucker",
      "backpulver",
      "natron",
      "hefe",
      "gew\xFCrz",
      "suppenw\xFCrze",
      "br\xFChpulver",
      "salz",
      "pfeffer",
      "curry",
      "chili",
      "senf",
      "essig",
      "zucker",
      "honig",
      "salbei",
      "br\xFChe",
      "bouillon",
      "sojasauce",
      "fischsauce",
      "worcestersauce"
    ]
  },
  {
    category: "milchprodukte",
    words: [
      "milch",
      "quark",
      "joghurt",
      "jogurt",
      "skyr",
      "k\xE4se",
      "feta",
      "parmesan",
      "mozzarella",
      "butter",
      "sahne",
      "schmand",
      "cr\xE8me",
      "creme fraiche",
      "frischk\xE4se",
      "ei",
      "eier",
      "h\xFCttenk\xE4se",
      "mascarpone"
    ]
  },
  {
    category: "fleisch-fisch",
    words: [
      "hack",
      "h\xE4hnchen",
      "h\xFChnchen",
      "huhn",
      "pute",
      "rind",
      "schwein",
      "fleisch",
      "steak",
      "filet",
      "schnitzel",
      "wurst",
      "schinken",
      "salami",
      "speck",
      "lachs",
      "fisch",
      "thunfisch",
      "garnele",
      "garnelen",
      "forelle",
      "kabeljau"
    ]
  },
  {
    category: "brot-backwaren",
    words: ["brot", "br\xF6tchen", "baguette", "toast", "ciabatta", "croissant", "kuchen", "geb\xE4ck", "brezel", "wrap", "tortilla"]
  },
  {
    category: "tiefkuehl",
    words: ["tiefk\xFChl", "tk-", "gefroren", "eiscreme", "eis "]
  },
  {
    category: "getraenke",
    words: ["wasser", "saft", "bier", "wein", "sekt", "limonade", "cola", "schorle", "getr\xE4nk", "tee "]
  },
  {
    category: "gewuerze",
    words: [
      "salz",
      "pfeffer",
      "paprikapulver",
      "curry",
      "oregano",
      "thymian",
      "rosmarin",
      "zimt",
      "muskat",
      "chili",
      "kreuzk\xFCmmel",
      "k\xFCmmel",
      "gew\xFCrz",
      "sauce",
      "so\xDFe",
      "senf",
      "ketchup",
      "mayonnaise",
      "mayo",
      "essig",
      "sojasauce",
      "br\xFChe",
      "bouillon",
      "hefe",
      "vanille",
      "kurkuma",
      "ingwerpulver"
    ]
  },
  {
    category: "vorrat",
    words: [
      "reis",
      "pasta",
      "nudel",
      "spaghetti",
      "penne",
      "couscous",
      "bulgur",
      "quinoa",
      "polenta",
      "mehl",
      "zucker",
      "haferflocken",
      "m\xFCsli",
      "linsen",
      "kichererbsen",
      "bohnen",
      "kokosmilch",
      "passierte tomate",
      "dosentomate",
      "konserve",
      "dose",
      "\xF6l",
      "oliven\xF6l",
      "raps\xF6l",
      "kokos\xF6l",
      "nuss",
      "n\xFCsse",
      "mandel",
      "walnuss",
      "erdnuss",
      "sesam",
      "samen",
      "tofu",
      "tempeh",
      "hummus",
      "pesto",
      "olive",
      "kapern",
      "getrocknete"
    ]
  },
  {
    category: "haushalt",
    words: [
      "sp\xFClmittel",
      "klopapier",
      "toilettenpapier",
      "k\xFCchenrolle",
      "alufolie",
      "frischhaltefolie",
      "backpapier",
      "m\xFCllbeutel",
      "seife",
      "waschmittel",
      "schwamm",
      "putz",
      "batterie",
      "kerze",
      "serviette"
    ]
  }
];
var CATEGORY_ORDER = [
  "gewuerze",
  "haushalt",
  "tiefkuehl",
  "getraenke",
  "fleisch-fisch",
  "milchprodukte",
  "brot-backwaren",
  "vorrat",
  "obst-gemuese"
];
var WORD_BOUNDARY = /[a-zäöüß]/;
function guessCategory(name) {
  const n = name.toLowerCase();
  for (const category of CATEGORY_ORDER) {
    const entry = KEYWORDS.find((k) => k.category === category);
    for (const word of entry.words) {
      if (word.length <= 3) {
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
  return "sonstiges";
}
async function categorize(name) {
  const guessed = guessCategory(name);
  if (guessed !== "sonstiges") return guessed;
  try {
    const raw = await completeAiJson(
      `Ordne diesen Einkaufsartikel genau einer Kategorie zu: "${name}".
Kategorien: ${CATEGORIES.map((c) => `${c.id} (${c.label})`).join(", ")}.
Antworte NUR mit JSON: {"category":"<id>"}`,
      2e4
    );
    const parsed = JSON.parse(raw);
    if (parsed.category && CATEGORY_IDS.includes(parsed.category)) return parsed.category;
  } catch {
  }
  return guessed;
}
var QUALIFIER_WORDS = /* @__PURE__ */ new Set([
  "edels\xFC\xDF",
  "edelsuess",
  "rosenscharf",
  "gemahlen",
  "gemahlene",
  "gemahlener",
  "getrocknet",
  "getrocknete",
  "getrockneter",
  "frisch",
  "frische",
  "frischer",
  "gehackt",
  "gehackte",
  "gehackter",
  "fein",
  "feine",
  "feiner",
  "grob",
  "grobe",
  "grober",
  "gerieben",
  "geriebene",
  "geriebener",
  "klein",
  "kleine",
  "kleiner",
  "schwarz",
  "schwarze",
  "schwarzer",
  "wei\xDF",
  "wei\xDFe",
  "wei\xDFer",
  "rot",
  "rote",
  "roter",
  "reif",
  "reife",
  "reifer",
  "altbacken",
  "altbackene",
  "altbackener",
  "tiefgek\xFChlt",
  "tk",
  "natur",
  "pur",
  "frischgerieben"
]);
var SYNONYMS = {
  knoblauchzehe: "knoblauch",
  knoblauchzehen: "knoblauch",
  zwiebeln: "zwiebel",
  karotten: "karotte",
  m\u00F6hren: "m\xF6hre",
  eier: "ei"
};
function shoppingName(name) {
  const withoutBrackets = String(name ?? "").replace(/\([^)]*\)/g, " ");
  const words = withoutBrackets.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
  const meaningful = words.filter((w) => !QUALIFIER_WORDS.has(w.toLowerCase()));
  const kept = meaningful.length ? meaningful : words;
  const joined = kept.join(" ").replace(/\s+/g, " ").trim();
  if (!joined) return String(name ?? "").trim();
  const canonical = SYNONYMS[joined.toLowerCase()];
  if (canonical) return canonical.charAt(0).toUpperCase() + canonical.slice(1);
  return joined;
}
var UNIT_FAMILIES = {
  g: { family: "gewicht", factor: 1 },
  kg: { family: "gewicht", factor: 1e3 },
  ml: { family: "fluessig", factor: 1 },
  l: { family: "fluessig", factor: 1e3 },
  tl: { family: "loeffel", factor: 1 },
  el: { family: "loeffel", factor: 3 },
  prise: { family: "loeffel", factor: 0.1 },
  pris: { family: "loeffel", factor: 0.1 },
  messerspitze: { family: "loeffel", factor: 0.05 },
  stueck: { family: "stueck:st\xFCck", factor: 1 },
  "st\xFCck": { family: "stueck:st\xFCck", factor: 1 },
  zehe: { family: "stueck:zehe", factor: 1 },
  zehen: { family: "stueck:zehe", factor: 1 },
  scheibe: { family: "stueck:scheibe", factor: 1 },
  scheiben: { family: "stueck:scheibe", factor: 1 },
  bund: { family: "stueck:bund", factor: 1 },
  dose: { family: "stueck:dose", factor: 1 },
  dosen: { family: "stueck:dose", factor: 1 },
  becher: { family: "stueck:becher", factor: 1 },
  packung: { family: "stueck:packung", factor: 1 },
  stange: { family: "stueck:stange", factor: 1 },
  handvoll: { family: "stueck:handvoll", factor: 1 }
};
function roundNice(value) {
  const step = value < 1 ? 0.25 : 0.5;
  return Math.max(step, Math.round(value / step) * step);
}
function displayAmount(family, total, fallbackUnit) {
  if (family === "gewicht") {
    return total >= 1e3 ? { amount: Math.round(total / 1e3 * 10) / 10, unit: "kg" } : { amount: Math.round(total), unit: "g" };
  }
  if (family === "fluessig") {
    return total >= 1e3 ? { amount: Math.round(total / 1e3 * 10) / 10, unit: "l" } : { amount: Math.round(total), unit: "ml" };
  }
  if (family === "loeffel") {
    return total >= 3 ? { amount: roundNice(total / 3), unit: "EL" } : { amount: roundNice(total), unit: "TL" };
  }
  return { amount: roundNice(total), unit: fallbackUnit };
}
async function rebuildAutoItems(householdId, weekStart) {
  const rows = await pool.query(
    `SELECT r.servings, e.servings AS entry_servings, r.ingredients
       FROM plan_entries e
       JOIN meal_plans p ON p.id = e.plan_id
       JOIN recipes r ON r.id = e.recipe_id
      WHERE p.household_id = $1 AND p.week_start = $2`,
    [householdId, weekStart]
  );
  const items = /* @__PURE__ */ new Map();
  for (const row of rows.rows) {
    const factor = row.entry_servings && row.servings ? row.entry_servings / row.servings : 1;
    for (const ing of row.ingredients ?? []) {
      const rawName = String(ing.name ?? "").trim();
      if (!rawName) continue;
      const name = shoppingName(rawName);
      const unitKey = String(ing.unit ?? "").trim().toLowerCase();
      const unitInfo = UNIT_FAMILIES[unitKey];
      const family = unitInfo?.family ?? `eigen:${unitKey}`;
      const key = `${name.toLowerCase()}|${family}`;
      const unitLabel = UNIT_LABELS[unitKey] ?? String(ing.unit ?? "").trim();
      const current = items.get(key) ?? { name, family, unit: unitLabel, base: 0, unknown: false };
      if (typeof ing.amount === "number" && Number.isFinite(ing.amount)) {
        current.base += ing.amount * factor * (unitInfo?.factor ?? 1);
      } else {
        current.unknown = true;
      }
      items.set(key, current);
    }
  }
  const prepared = /* @__PURE__ */ new Map();
  for (const [key, bucket] of items) {
    const shown = bucket.unknown ? { amount: null, unit: bucket.unit } : displayAmount(bucket.family, bucket.base, bucket.unit);
    prepared.set(key, { name: bucket.name, unit: shown.unit, amount: shown.amount });
  }
  const existing = await pool.query(
    "SELECT key FROM shopping_items WHERE household_id = $1 AND week_start = $2 AND source = 'auto'",
    [householdId, weekStart]
  );
  const existingKeys = new Set(existing.rows.map((r) => r.key));
  for (const [key, item] of prepared) {
    await pool.query(
      `INSERT INTO shopping_items (household_id, week_start, key, name, amount, unit, category, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'auto')
       ON CONFLICT (household_id, week_start, key)
       DO UPDATE SET name = EXCLUDED.name, amount = EXCLUDED.amount, unit = EXCLUDED.unit,
                     category = EXCLUDED.category, updated_at = now()`,
      [householdId, weekStart, key, item.name, item.amount, item.unit, guessCategory(item.name)]
    );
    existingKeys.delete(key);
  }
  for (const staleKey of existingKeys) {
    await pool.query("DELETE FROM shopping_items WHERE household_id = $1 AND week_start = $2 AND key = $3 AND source = 'auto'", [
      householdId,
      weekStart,
      staleKey
    ]);
  }
}
async function loadList(householdId, weekStart) {
  const rows = await pool.query(
    `SELECT id, name, amount, unit, category, checked, source, created_by
       FROM shopping_items WHERE household_id = $1 AND week_start = $2
      ORDER BY category ASC, lower(name) ASC`,
    [householdId, weekStart]
  );
  const items = rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    amount: r.amount != null ? Number(r.amount) : null,
    unit: r.unit,
    category: r.category,
    checked: r.checked,
    source: r.source,
    createdBy: r.created_by
  }));
  return {
    weekStart,
    categories: CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      items: items.filter((i) => i.category === c.id)
    })).filter((c) => c.items.length > 0),
    items,
    openCount: items.filter((i) => !i.checked).length,
    totalCount: items.length
  };
}
var shoppingRouter = Router6();
shoppingRouter.get("/:householdId/:weekStart", async (req, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.weekStart)) {
    fail(res, 400, "invalid-date", "Datum im Format YYYY-MM-DD angeben.");
    return;
  }
  await rebuildAutoItems(req.params.householdId, req.params.weekStart);
  res.json(await loadList(req.params.householdId, req.params.weekStart));
});
shoppingRouter.post("/:householdId/:weekStart/items", async (req, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const body = req.body;
  const name = String(body.name ?? "").trim();
  if (name.length < 2 || name.length > 120) {
    fail(res, 400, "invalid-input", "Artikelname zwischen 2 und 120 Zeichen.");
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
      String(body.unit ?? "").trim(),
      category,
      req.userId
    ]
  );
  broadcast(req.params.householdId, "shopping");
  res.status(201).json(await loadList(req.params.householdId, req.params.weekStart));
});
shoppingRouter.patch("/:householdId/:weekStart/items/:itemId", async (req, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const checked = Boolean(req.body.checked);
  const updated = await pool.query(
    `UPDATE shopping_items SET checked = $1, updated_at = now()
      WHERE id = $2 AND household_id = $3 AND week_start = $4 RETURNING id`,
    [checked, req.params.itemId, req.params.householdId, req.params.weekStart]
  );
  if (!updated.rowCount) {
    fail(res, 404, "not-found", "Artikel nicht gefunden.");
    return;
  }
  broadcast(req.params.householdId, "shopping");
  res.json(await loadList(req.params.householdId, req.params.weekStart));
});
shoppingRouter.delete("/:householdId/:weekStart/items/:itemId", async (req, res) => {
  const access = await requireHousehold(req.params.householdId, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  await pool.query(
    `DELETE FROM shopping_items WHERE id = $1 AND household_id = $2 AND week_start = $3 AND source = 'manual'`,
    [req.params.itemId, req.params.householdId, req.params.weekStart]
  );
  broadcast(req.params.householdId, "shopping");
  res.json(await loadList(req.params.householdId, req.params.weekStart));
});

// server/chat.ts
var MAX_STEPS = 6;
var WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
function mondayOf(date = /* @__PURE__ */ new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
var TOOLS = [
  {
    type: "function",
    function: {
      name: "rezepte_suchen",
      description: "Sucht Rezepte in der Sammlung. Alle Filter sind optional und werden UND-verkn\xFCpft; Listen innerhalb eines Filters sind ODER-verkn\xFCpft.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Suchtext \xFCber Titel, Zutaten, Beschreibung" },
          tags: { type: "array", items: { type: "string" } },
          diaeten: { type: "array", items: { type: "string" }, description: "z. B. vegan, vegetarisch, glutenfrei, low carb" },
          kuechen: { type: "array", items: { type: "string" }, description: "z. B. Italienisch, Asiatisch" },
          ohne_allergene: { type: "array", items: { type: "string" } },
          max_minuten: { type: "integer" },
          max_kcal: { type: "integer", description: "kcal pro Portion" },
          limit: { type: "integer", description: "1-20, Standard 8" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "rezept_details",
      description: "Liefert ein Rezept vollst\xE4ndig (Zutaten, Schritte, N\xE4hrwerte).",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
    }
  },
  {
    type: "function",
    function: {
      name: "wochenplan_lesen",
      description: "Zeigt den Wochenplan. Ohne Angabe die aktuelle Woche.",
      parameters: {
        type: "object",
        properties: { woche: { type: "string", description: "Montag als YYYY-MM-DD" } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "einstellungen_lesen",
      description: "Pers\xF6nliche Vorgaben: Ern\xE4hrungsform, K\xFCche, Allergien, Abneigungen, Ger\xE4te, Zeit, Kalorien.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "einstellungen_aendern",
      description: "\xC4ndert pers\xF6nliche Vorgaben. Listen ersetzen den bisherigen Inhalt. Nicht \xFCbergebene Felder bleiben.",
      parameters: {
        type: "object",
        properties: {
          diaeten: { type: "array", items: { type: "string" } },
          kuechen: { type: "array", items: { type: "string" } },
          allergien: { type: "array", items: { type: "string" } },
          geraete: { type: "array", items: { type: "string" } },
          max_minuten: { type: "integer" },
          kalorienziel: { type: "integer" },
          portionen: { type: "integer" },
          sonderwuensche: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "abneigung_hinzufuegen",
      description: 'Tr\xE4gt ein Lebensmittel in die Liste \u201Emag ich nicht" ein (pers\xF6nlich oder f\xFCr den Haushalt).',
      parameters: {
        type: "object",
        properties: {
          lebensmittel: { type: "string" },
          ziel: { type: "string", enum: ["profil", "haushalt"], description: "Standard: profil" }
        },
        required: ["lebensmittel"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "abneigung_entfernen",
      description: 'Entfernt ein Lebensmittel aus der Liste \u201Emag ich nicht".',
      parameters: {
        type: "object",
        properties: {
          lebensmittel: { type: "string" },
          ziel: { type: "string", enum: ["profil", "haushalt"] }
        },
        required: ["lebensmittel"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "haushalt_vorgaben_aendern",
      description: "\xC4ndert die Vorgaben des Haushalts (gelten f\xFCr alle Mitglieder). Listen ersetzen den Inhalt.",
      parameters: {
        type: "object",
        properties: {
          diaeten: { type: "array", items: { type: "string" } },
          kuechen: { type: "array", items: { type: "string" } },
          allergien: { type: "array", items: { type: "string" } },
          geraete: { type: "array", items: { type: "string" } },
          max_minuten: { type: "integer" },
          kalorienziel: { type: "integer" },
          notiz: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "woche_planen",
      description: 'L\xE4sst die KI einen Wochenplan erzeugen und speichert ihn. Dauert 10-60 Sekunden. \u201Eersetzen" l\xF6scht vorher die KI-Mahlzeiten der Woche, \u201Efuellen" l\xE4sst belegte Tage unangetastet.',
      parameters: {
        type: "object",
        properties: {
          woche: { type: "string", description: "Montag als YYYY-MM-DD, Standard: aktuelle Woche" },
          tage: { type: "array", items: { type: "integer" }, description: "0=Montag \u2026 6=Sonntag" },
          mahlzeiten: { type: "array", items: { type: "string" }, enum: void 0 },
          portionen: { type: "integer" },
          vorgaben: { type: "string", description: 'Freitext, z. B. \u201Enichts Scharfes, wenig Kohlenhydrate"' },
          modus: { type: "string", enum: ["ersetzen", "fuellen"] }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mahlzeit_hinzufuegen",
      description: "Tr\xE4gt eine Mahlzeit in einen Tag des Wochenplans ein (Rezept aus der Sammlung oder freier Titel).",
      parameters: {
        type: "object",
        properties: {
          woche: { type: "string" },
          tag: { type: "integer", description: "0=Montag \u2026 6=Sonntag" },
          mahlzeit: { type: "string", enum: ["fruehstueck", "mittag", "abend", "snack"] },
          rezept_id: { type: "string" },
          titel: { type: "string", description: "Freier Titel, wenn kein Rezept" },
          portionen: { type: "integer" }
        },
        required: ["tag"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mahlzeit_entfernen",
      description: "Entfernt einen Eintrag aus dem Wochenplan \u2014 per Eintrags-ID oder \xFCber Tag + Titel.",
      parameters: {
        type: "object",
        properties: {
          woche: { type: "string" },
          eintrag_id: { type: "string" },
          tag: { type: "integer" },
          titel: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "woche_leeren",
      description: "Entfernt alle Eintr\xE4ge einer Woche (Rezepte bleiben in der Sammlung).",
      parameters: { type: "object", properties: { woche: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "favorit_setzen",
      description: "Merkt ein Rezept als Favorit oder entfernt es aus den Favoriten.",
      parameters: {
        type: "object",
        properties: { rezept_id: { type: "string" }, favorit: { type: "boolean" } },
        required: ["rezept_id", "favorit"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "einkaufsliste_lesen",
      description: "Zeigt die Einkaufsliste des Haushalts (aus Wochenplan plus manuell).",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "einkauf_hinzufuegen",
      description: "Setzt einen Artikel auf die Einkaufsliste.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, menge: { type: "number" }, einheit: { type: "string" } },
        required: ["name"]
      }
    }
  }
];
async function toolRecipes(ctx, a) {
  const limit = Math.min(20, Math.max(1, Number(a.limit ?? 8)));
  const params = [];
  const where = ["r.status = 'active'"];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (typeof a.text === "string" && a.text.trim()) {
    const p = push(`%${a.text.trim()}%`);
    where.push(`(r.title ILIKE ${p} OR coalesce(r.description,'') ILIKE ${p})`);
  }
  const list2 = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  if (list2(a.diaeten).length) where.push(`r.diets && ${push(list2(a.diaeten))}::text[]`);
  if (list2(a.kuechen).length) where.push(`r.cuisines && ${push(list2(a.kuechen))}::text[]`);
  if (list2(a.ohne_allergene).length) where.push(`NOT (r.allergens && ${push(list2(a.ohne_allergene))}::text[])`);
  if (list2(a.tags).length) where.push(`r.tags && ${push(list2(a.tags))}::text[]`);
  if (Number(a.max_minuten)) where.push(`coalesce(r.total_minutes, r.prep_minutes, 999) <= ${push(Number(a.max_minuten))}`);
  if (Number(a.max_kcal)) where.push(`coalesce((r.nutrition->>'kcal')::numeric, 0) <= ${push(Number(a.max_kcal))}`);
  params.push(limit);
  const rows = await pool.query(
    `SELECT r.id, r.title, r.prep_minutes, r.total_minutes, r.diets, r.cuisines, r.tags,
            r.nutrition->>'kcal' AS kcal, u.display_name AS author
       FROM recipes r LEFT JOIN users u ON u.id = r.owner_id
      WHERE ${where.join(" AND ")}
      ORDER BY r.created_at DESC LIMIT $${params.length}`,
    params
  );
  return { anzahl: rows.rowCount, rezepte: rows.rows };
}
async function toolRecipeDetail(ctx, a) {
  const rows = await pool.query(
    `SELECT r.id, r.title, r.description, r.servings, r.prep_minutes, r.total_minutes, r.difficulty,
            r.tags, r.diets, r.cuisines, r.allergens, r.ingredients, r.steps, r.nutrition
       FROM recipes r WHERE r.id = $1 AND r.status = 'active'`,
    [String(a.id ?? "")]
  );
  if (!rows.rowCount) return { fehler: "Rezept nicht gefunden" };
  return rows.rows[0];
}
async function toolWeekPlan(ctx, a) {
  if (!ctx.householdId) return { fehler: "Du bist in keinem Haushalt." };
  const week = typeof a.woche === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.woche) ? a.woche : mondayOf();
  const plan = await loadPlan(ctx.householdId, week);
  const entries = plan.entries.map((e) => ({
    eintrag_id: e.id,
    tag: WEEKDAYS[Number(e.dayIndex)],
    tag_index: e.dayIndex,
    mahlzeit: e.slot,
    titel: e.title,
    portionen: e.servings,
    kcal: e.nutrition?.kcal ?? null
  }));
  return { woche: week, anzahl: entries.length, eintraege: entries };
}
async function toolSettingsRead(ctx) {
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
    sonderwuensche: s.specialWishes
  };
}
async function toolSettingsChange(ctx, a) {
  const patchBody = {};
  if (Array.isArray(a.diaeten)) patchBody.diets = a.diaeten;
  if (Array.isArray(a.kuechen)) patchBody.cuisines = a.kuechen;
  if (Array.isArray(a.allergien)) patchBody.allergies = a.allergien;
  if (Array.isArray(a.geraete)) patchBody.appliances = a.geraete;
  if (a.max_minuten !== void 0) patchBody.maxMinutes = a.max_minuten;
  if (a.kalorienziel !== void 0) patchBody.kcalTarget = a.kalorienziel;
  if (a.portionen !== void 0) patchBody.defaultServings = a.portionen;
  if (typeof a.sonderwuensche === "string") patchBody.specialWishes = a.sonderwuensche;
  if (!Object.keys(patchBody).length) return { fehler: "Keine \xC4nderung \xFCbergeben" };
  const next = await saveSettings(ctx.userId, patchBody);
  return { ok: true, neu: { diaeten: next.diets, kuechen: next.cuisines, allergien: next.allergies, max_minuten: next.maxMinutes } };
}
async function householdPrefs(ctx, patch) {
  if (!ctx.householdId) throw new Error("Du bist in keinem Haushalt.");
  const current = await loadHouseholdPreferences(ctx.householdId);
  const next = normalizeHouseholdPreferences(patch(current));
  await pool.query("UPDATE households SET preferences = $2::jsonb WHERE id = $1", [
    ctx.householdId,
    JSON.stringify(next)
  ]);
  broadcast(ctx.householdId, "household");
  return next;
}
async function toolDislike(ctx, a, remove) {
  const item = String(a.lebensmittel ?? "").trim().slice(0, 60);
  if (!item) return { fehler: "Kein Lebensmittel angegeben" };
  const household = a.ziel === "haushalt";
  if (household) {
    const next = await householdPrefs(ctx, (p) => ({
      ...p,
      dislikes: remove ? p.dislikes.filter((d) => d.toLowerCase() !== item.toLowerCase()) : [...p.dislikes.filter((d) => d.toLowerCase() !== item.toLowerCase()), item].slice(0, 40)
    }));
    return { ok: true, ziel: "haushalt", liste: next.dislikes };
  }
  const settings = await loadSettings(ctx.userId);
  const dislikes = remove ? settings.dislikes.filter((d) => d.toLowerCase() !== item.toLowerCase()) : [...settings.dislikes.filter((d) => d.toLowerCase() !== item.toLowerCase()), item].slice(0, 40);
  await saveSettings(ctx.userId, { dislikes });
  return { ok: true, ziel: "profil", liste: dislikes };
}
async function toolHouseholdChange(ctx, a) {
  const next = await householdPrefs(ctx, (p) => ({
    ...p,
    diets: Array.isArray(a.diaeten) ? a.diaeten : p.diets,
    cuisines: Array.isArray(a.kuechen) ? a.kuechen : p.cuisines,
    allergies: Array.isArray(a.allergien) ? a.allergien : p.allergies,
    appliances: Array.isArray(a.geraete) ? a.geraete : p.appliances,
    maxMinutes: a.max_minuten !== void 0 ? Number(a.max_minuten) : p.maxMinutes,
    kcalTarget: a.kalorienziel !== void 0 ? Number(a.kalorienziel) : p.kcalTarget,
    note: typeof a.notiz === "string" ? a.notiz : p.note
  }));
  return { ok: true, neu: next };
}
async function toolPlanWeek(ctx, a) {
  if (!ctx.householdId) return { fehler: "Du bist in keinem Haushalt." };
  const week = typeof a.woche === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.woche) ? a.woche : mondayOf();
  const body = {
    householdId: ctx.householdId,
    weekStart: week,
    days: Array.isArray(a.tage) ? a.tage.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : void 0,
    slots: Array.isArray(a.mahlzeiten) ? a.mahlzeiten : void 0,
    servings: Number(a.portionen) || void 0,
    constraints: typeof a.vorgaben === "string" ? a.vorgaben : "",
    mode: a.modus === "fuellen" ? "fill" : "replace",
    mergeMembers: true
  };
  const result = await planWeekForUser(ctx.userId, body);
  const entries = result.plan.entries ?? [];
  return {
    ok: true,
    erstellt: result.created,
    woche: week,
    hinweis: result.notes,
    plan: entries.map((e) => `${WEEKDAYS[e.dayIndex]}: ${e.title}`)
  };
}
async function toolAddMeal(ctx, a) {
  if (!ctx.householdId) return { fehler: "Du bist in keinem Haushalt." };
  const week = typeof a.woche === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.woche) ? a.woche : mondayOf();
  const day = Number(a.tag);
  if (!Number.isInteger(day) || day < 0 || day > 6) return { fehler: "Tag muss 0-6 sein" };
  const slot = ["fruehstueck", "mittag", "abend", "snack"].includes(String(a.mahlzeit)) ? String(a.mahlzeit) : "abend";
  const recipeId = typeof a.rezept_id === "string" && /^[0-9a-f-]{36}$/i.test(a.rezept_id) ? a.rezept_id : null;
  if (!recipeId && !String(a.titel ?? "").trim()) {
    return { fehler: "Entweder rezept_id oder titel angeben" };
  }
  const planRow = await pool.query(
    `INSERT INTO meal_plans (household_id, week_start, created_by) VALUES ($1,$2,$3)
     ON CONFLICT (household_id, week_start) DO UPDATE SET household_id = EXCLUDED.household_id
     RETURNING id`,
    [ctx.householdId, week, ctx.userId]
  );
  const next = await pool.query(
    "SELECT coalesce(max(position) + 1, 0) AS pos FROM plan_entries WHERE plan_id = $1 AND day_index = $2",
    [planRow.rows[0].id, day]
  );
  await pool.query(
    `INSERT INTO plan_entries (plan_id, day_index, slot, position, recipe_id, custom_title, servings)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [planRow.rows[0].id, day, slot, next.rows[0].pos, recipeId, recipeId ? null : String(a.titel).slice(0, 200), Number(a.portionen) || null]
  );
  broadcast(ctx.householdId, "plan");
  return { ok: true, tag: WEEKDAYS[day], woche: week };
}
async function toolRemoveMeal(ctx, a) {
  if (!ctx.householdId) return { fehler: "Du bist in keinem Haushalt." };
  const week = typeof a.woche === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.woche) ? a.woche : mondayOf();
  const id = typeof a.eintrag_id === "string" ? a.eintrag_id : null;
  const title = typeof a.titel === "string" ? a.titel.trim() : "";
  const day = Number.isInteger(Number(a.tag)) ? Number(a.tag) : null;
  if (id) {
    const del2 = await pool.query(
      `DELETE FROM plan_entries e USING meal_plans p
        WHERE e.id = $1 AND e.plan_id = p.id AND p.household_id = $2 AND p.week_start = $3`,
      [id, ctx.householdId, week]
    );
    if (!del2.rowCount) return { fehler: "Eintrag nicht gefunden" };
    broadcast(ctx.householdId, "plan");
    return { ok: true, entfernt: 1 };
  }
  if (!title) return { fehler: "eintrag_id oder titel angeben" };
  const del = await pool.query(
    `DELETE FROM plan_entries e USING meal_plans p, recipes r
      WHERE e.plan_id = p.id AND e.recipe_id = r.id AND p.household_id = $1 AND p.week_start = $2
        AND r.title ILIKE $3 ${day != null ? "AND e.day_index = $4" : ""}`,
    day != null ? [ctx.householdId, week, `%${title}%`, day] : [ctx.householdId, week, `%${title}%`]
  );
  if (!del.rowCount) return { fehler: "Kein Eintrag mit diesem Titel gefunden" };
  broadcast(ctx.householdId, "plan");
  return { ok: true, entfernt: del.rowCount };
}
async function toolClearWeek(ctx, a) {
  if (!ctx.householdId) return { fehler: "Du bist in keinem Haushalt." };
  const week = typeof a.woche === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.woche) ? a.woche : mondayOf();
  const del = await pool.query(
    `DELETE FROM plan_entries e USING meal_plans p
      WHERE e.plan_id = p.id AND p.household_id = $1 AND p.week_start = $2`,
    [ctx.householdId, week]
  );
  broadcast(ctx.householdId, "plan");
  return { ok: true, entfernt: del.rowCount ?? 0, woche: week };
}
async function toolFavorite(ctx, a) {
  const id = String(a.rezept_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { fehler: "Ung\xFCltige Rezept-ID" };
  if (a.favorit) {
    await pool.query("INSERT INTO favorites (user_id, recipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [ctx.userId, id]);
  } else {
    await pool.query("DELETE FROM favorites WHERE user_id = $1 AND recipe_id = $2", [ctx.userId, id]);
  }
  return { ok: true, favorit: Boolean(a.favorit) };
}
async function toolShoppingRead(ctx) {
  if (!ctx.householdId) return { fehler: "Du bist in keinem Haushalt." };
  const rows = await pool.query(
    `SELECT name, amount, unit, checked FROM shopping_items
      WHERE household_id = $1 AND week_start = $2 ORDER BY name`,
    [ctx.householdId, mondayOf()]
  );
  return { anzahl: rows.rowCount, artikel: rows.rows };
}
async function toolShoppingAdd(ctx, a) {
  if (!ctx.householdId) return { fehler: "Du bist in keinem Haushalt." };
  const name = String(a.name ?? "").trim().slice(0, 120);
  if (!name) return { fehler: "Kein Name angegeben" };
  const week = mondayOf();
  const key = name.toLowerCase();
  const exists = await pool.query(
    "SELECT id FROM shopping_items WHERE household_id = $1 AND week_start = $2 AND key = $3",
    [ctx.householdId, week, key]
  );
  if (exists.rowCount) return { ok: true, hinweis: "steht schon auf der Liste", name };
  await pool.query(
    `INSERT INTO shopping_items (household_id, week_start, key, name, amount, unit, category, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8)`,
    [
      ctx.householdId,
      week,
      key,
      name,
      Number(a.menge) || 1,
      String(a.einheit ?? "St\xFCck").slice(0, 20),
      guessCategory(name),
      ctx.userId
    ]
  );
  broadcast(ctx.householdId, "shopping");
  return { ok: true, name };
}
var HANDLERS = {
  rezepte_suchen: { run: toolRecipes, summary: (r) => `${r.anzahl ?? 0} Rezepte gefunden` },
  rezept_details: { run: toolRecipeDetail, summary: (r, a) => `Rezept ${String(a.id).slice(0, 8)} gelesen` },
  wochenplan_lesen: { run: toolWeekPlan, summary: (r) => `Wochenplan gelesen (${r.anzahl ?? 0} Eintr\xE4ge)` },
  einstellungen_lesen: { run: toolSettingsRead, summary: () => "Einstellungen gelesen" },
  einstellungen_aendern: { run: toolSettingsChange, summary: () => "Einstellungen ge\xE4ndert" },
  abneigung_hinzufuegen: { run: (c, a) => toolDislike(c, a, false), summary: (r, a) => `\u201E${a.lebensmittel}" gemerkt` },
  abneigung_entfernen: { run: (c, a) => toolDislike(c, a, true), summary: (r, a) => `\u201E${a.lebensmittel}" entfernt` },
  haushalt_vorgaben_aendern: { run: toolHouseholdChange, summary: () => "Haushalts-Vorgaben ge\xE4ndert" },
  woche_planen: { run: toolPlanWeek, summary: (r) => `Woche geplant (${r.erstellt ?? 0} Mahlzeiten)` },
  mahlzeit_hinzufuegen: { run: toolAddMeal, summary: (r) => `Mahlzeit f\xFCr ${r.tag ?? "Tag"} eingetragen` },
  mahlzeit_entfernen: { run: toolRemoveMeal, summary: (r) => `${r.entfernt ?? 0} Eintrag entfernt` },
  woche_leeren: { run: toolClearWeek, summary: (r) => `Woche geleert (${r.entfernt ?? 0} Eintr\xE4ge)` },
  favorit_setzen: { run: toolFavorite, summary: (r, a) => a.favorit ? "als Favorit gemerkt" : "aus Favoriten entfernt" },
  einkaufsliste_lesen: { run: toolShoppingRead, summary: (r) => `Einkaufsliste gelesen (${r.anzahl ?? 0})` },
  einkauf_hinzufuegen: { run: toolShoppingAdd, summary: (r, a) => `\u201E${a.name}" auf die Einkaufsliste` }
};
async function callModel(messages, tools) {
  const cfg = resolveProvider();
  if (!cfg) throw new Error("Keine KI konfiguriert.");
  if (cfg.name === "gemini") throw new Error("Der Chat ben\xF6tigt DeepSeek oder Mistral.");
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
    body: JSON.stringify({ model: cfg.model, messages, tools, tool_choice: "auto", temperature: 0.3, max_tokens: 2e3 }),
    signal: AbortSignal.timeout(12e4)
  });
  if (!resp.ok) throw new Error(`${cfg.name} HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data.choices?.[0]?.message ?? {};
}
var chatRouter = Router7();
chatRouter.get("/messages", async (req, res) => {
  const rows = await pool.query(
    `SELECT id, role, content, actions, created_at FROM chat_messages
      WHERE user_id = $1 ORDER BY id DESC LIMIT 60`,
    [req.userId]
  );
  res.json({ messages: rows.rows.reverse() });
});
chatRouter.delete("/messages", async (req, res) => {
  await pool.query("DELETE FROM chat_messages WHERE user_id = $1", [req.userId]);
  res.json({ ok: true });
});
chatRouter.post("/", async (req, res) => {
  const text = String(req.body?.message ?? "").trim();
  if (!text) {
    fail(res, 400, "invalid-input", "Nachricht fehlt.");
    return;
  }
  if (text.length > 2e3) {
    fail(res, 400, "too-long", "Bitte k\xFCrzer fassen (max. 2000 Zeichen).");
    return;
  }
  const householdId = await resolveHousehold(String(req.body?.householdId ?? ""), req.userId);
  if (householdId) {
    const access = await requireHousehold(householdId, req.userId);
    if (!access.ok) {
      fail(res, access.status, access.error, access.message);
      return;
    }
  }
  const settings = await loadSettings(req.userId);
  const household = householdId ? await loadHouseholdPreferences2(householdId) : null;
  const householdNote = householdId ? (await loadHouseholdPreferences(householdId)).note : "";
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const system = [
    "Du bist der Assistent der Meal-Planner-App. Du sprichst Deutsch, duzt die Person, antwortest knapp und konkret.",
    `Heute ist ${today}, Montag dieser Woche ist der ${mondayOf()}.`,
    `Person: ${settings.defaultServings} Standardportionen; Vorgaben: ${settings.diets.join(", ") || "keine"};`,
    `Allergien: ${settings.allergies.join(", ") || "keine"}; Abneigungen: ${settings.dislikes.join(", ") || "keine"};`,
    `Ger\xE4te: ${settings.appliances.join(", ") || "keine Angabe"}.`,
    household ? `Haushalt-Vorgaben: ${household.diets.join(", ") || "keine"} \xB7 Allergien ${household.allergies.join(", ") || "keine"} \xB7 Abneigungen ${household.dislikes.join(", ") || "keine"} \xB7 Ger\xE4te ${household.appliances.join(", ") || "keine"}${householdNote ? ` \xB7 Notiz: ${householdNote}` : ""}.` : "Die Person ist in keinem Haushalt \u2014 Wochenplan und Einkauf sind nicht verf\xFCgbar.",
    "",
    "Regeln:",
    "- Nutze die Werkzeuge, statt zu raten. Vor \xC4nderungen am Wochenplan liest du ihn, wenn du Eintr\xE4ge entfernen willst.",
    '- Bei \u201Edas gef\xE4llt mir nicht" handle selbst: entferne die betroffenen Eintr\xE4ge bzw. plane passend neu, statt nur zu erkl\xE4ren.',
    "- Rezept-IDs nur aus Werkzeug-Ergebnissen verwenden, niemals erfinden.",
    "- Nach den Aktionen: ein bis drei S\xE4tze, was du ge\xE4ndert hast. Keine Aufz\xE4hlung der Werkzeugnamen.",
    "- Wenn etwas unklar ist, frage einmal kurz nach, statt zu raten.",
    "- Ohne eingestellte Allergien/Unvertr\xE4glichkeiten keine Ersatzprodukte vorschlagen (nicht glutenfrei, nicht laktosefrei, nicht vegan) \u2014 normale Zutaten, allt\xE4gliche Gerichte."
  ].join("\n");
  try {
    const history = await pool.query(
      "SELECT role, content FROM chat_messages WHERE user_id = $1 ORDER BY id DESC LIMIT 12",
      [req.userId]
    );
    const messages = [
      { role: "system", content: system },
      ...history.rows.reverse().map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: text }
    ];
    await pool.query("INSERT INTO chat_messages (user_id, role, content) VALUES ($1,$2,$3)", [req.userId, "user", text]);
    const actions = [];
    let reply = "";
    for (let step = 0; step < MAX_STEPS; step++) {
      const answer = await callModel(messages, TOOLS);
      const calls = answer.tool_calls ?? [];
      if (!calls.length) {
        reply = (answer.content ?? "").trim();
        break;
      }
      messages.push({ role: "assistant", content: answer.content ?? "", tool_calls: calls });
      for (const call of calls) {
        const handler = HANDLERS[call.function.name];
        let result;
        try {
          const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          result = handler ? await handler.run({ userId: req.userId, householdId }, args) : { fehler: `Unbekanntes Werkzeug: ${call.function.name}` };
          actions.push({
            tool: call.function.name,
            summary: handler ? handler.summary(result, args) : "unbekannt",
            ok: !result.fehler
          });
        } catch (error) {
          const message = error instanceof WeekPlanError ? error.message : error instanceof Error ? error.message : "Fehler";
          result = { fehler: message };
          actions.push({ tool: call.function.name, summary: `fehlgeschlagen: ${message}`.slice(0, 160), ok: false });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6e3) });
      }
    }
    if (!reply) reply = "Erledigt.";
    await pool.query("INSERT INTO chat_messages (user_id, role, content, actions) VALUES ($1,$2,$3,$4::jsonb)", [
      req.userId,
      "assistant",
      reply,
      JSON.stringify(actions)
    ]);
    res.json({ reply, actions });
  } catch (error) {
    fail(res, 502, "ai-failed", error instanceof Error ? error.message.slice(0, 300) : "Der Assistent konnte nicht antworten.");
  }
});

// server/households.ts
import { Router as Router8 } from "express";
import { z as z4 } from "zod";
var householdsRouter = Router8();
householdsRouter.get("/", async (req, res) => {
  const r = await pool.query(
    `SELECT h.id, h.name, h.invite_code, m.role, h.created_at,
            (SELECT count(*) FROM household_members hm WHERE hm.household_id = h.id)::int AS member_count,
            (SELECT count(*) FROM recipes rc WHERE rc.household_id = h.id)::int AS recipe_count
       FROM households h
       JOIN household_members m ON m.household_id = h.id
      WHERE m.user_id = $1
      ORDER BY h.created_at ASC`,
    [req.userId]
  );
  res.json({
    households: r.rows.map((h) => ({
      id: h.id,
      name: h.name,
      inviteCode: h.invite_code,
      role: h.role,
      memberCount: h.member_count,
      recipeCount: h.recipe_count,
      createdAt: h.created_at
    }))
  });
});
householdsRouter.post("/", async (req, res) => {
  const parsed = z4.object({ name: z4.string().trim().min(2).max(80) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", "Bitte einen Namen f\xFCr den Haushalt angeben.");
    return;
  }
  const already = await pool.query("SELECT household_id FROM household_members WHERE user_id = $1", [req.userId]);
  if (already.rowCount) {
    fail(res, 409, "one-household-only", "Du hast schon einen Haushalt. Verlasse ihn zuerst.");
    return;
  }
  const household = await createHouseholdWithOwner(parsed.data.name, req.userId);
  res.status(201).json({ household: { ...household, role: "owner", memberCount: 1, recipeCount: 0 } });
});
householdsRouter.post("/join", async (req, res) => {
  const parsed = z4.object({ code: z4.string().trim().min(4).max(16) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", "Einladungscode angeben.");
    return;
  }
  const already = await pool.query("SELECT household_id FROM household_members WHERE user_id = $1", [req.userId]);
  if (already.rowCount) {
    fail(res, 409, "one-household-only", "Du bist schon in einem Haushalt. Verlasse ihn zuerst.");
    return;
  }
  const code = parsed.data.code.toUpperCase();
  const hh = await pool.query("SELECT id, name FROM households WHERE invite_code = $1", [code]);
  if (!hh.rowCount) {
    fail(res, 404, "invalid-code", "Dieser Einladungscode existiert nicht.");
    return;
  }
  const household = hh.rows[0];
  const inserted = await pool.query(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING RETURNING role",
    [household.id, req.userId]
  );
  res.json({
    household: { id: household.id, name: household.name, role: inserted.rowCount ? "member" : "member" },
    alreadyMember: inserted.rowCount === 0
  });
});
householdsRouter.get("/:id", async (req, res) => {
  const access = await requireHousehold(req.params.id, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const household = await pool.query(
    "SELECT id, name, invite_code, created_at, preferences FROM households WHERE id = $1",
    [req.params.id]
  );
  if (!household.rowCount) {
    fail(res, 404, "not-found", "Haushalt nicht gefunden.");
    return;
  }
  const members = await pool.query(
    `SELECT m.user_id, u.display_name, u.email, m.role, m.joined_at
       FROM household_members m JOIN users u ON u.id = m.user_id
      WHERE m.household_id = $1
      ORDER BY m.joined_at ASC`,
    [req.params.id]
  );
  res.json({
    household: {
      id: household.rows[0].id,
      name: household.rows[0].name,
      inviteCode: household.rows[0].invite_code,
      createdAt: household.rows[0].created_at,
      role: access.role
    },
    members: members.rows.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name,
      email: m.email,
      role: m.role,
      joinedAt: m.joined_at
    })),
    preferences: normalizeHouseholdPreferences(household.rows[0].preferences)
  });
});
householdsRouter.put("/:id/preferences", async (req, res) => {
  const access = await requireHousehold(req.params.id, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const prefs = normalizeHouseholdPreferences(req.body);
  await pool.query("UPDATE households SET preferences = $2::jsonb WHERE id = $1", [
    req.params.id,
    JSON.stringify(prefs)
  ]);
  res.json({ preferences: prefs });
});
householdsRouter.get("/:id/preferences", async (req, res) => {
  const access = await requireHousehold(req.params.id, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  res.json({ preferences: await loadHouseholdPreferences(req.params.id) });
});
householdsRouter.patch("/:id", async (req, res) => {
  const access = await requireHousehold(req.params.id, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (access.role !== "owner") {
    fail(res, 403, "owner-only", "Nur der Besitzer kann den Haushalt umbenennen.");
    return;
  }
  const parsed = z4.object({ name: z4.string().trim().min(2).max(80) }).safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", "Name zu kurz.");
    return;
  }
  const updated = await pool.query(
    "UPDATE households SET name = $1 WHERE id = $2 RETURNING id, name, invite_code",
    [parsed.data.name, req.params.id]
  );
  res.json({ household: { id: updated.rows[0].id, name: updated.rows[0].name, inviteCode: updated.rows[0].invite_code } });
});
householdsRouter.post("/:id/invite-code", async (req, res) => {
  const access = await requireHousehold(req.params.id, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (access.role !== "owner") {
    fail(res, 403, "owner-only", "Nur der Besitzer kann den Code neu erzeugen.");
    return;
  }
  const code = generateInviteCode();
  const updated = await pool.query(
    "UPDATE households SET invite_code = $1 WHERE id = $2 RETURNING invite_code",
    [code, req.params.id]
  );
  res.json({ inviteCode: updated.rows[0].invite_code });
});
householdsRouter.delete("/:id/members/:userId", async (req, res) => {
  const access = await requireHousehold(req.params.id, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  const targetId = Number(req.params.userId);
  const isSelf = targetId === req.userId;
  if (!isSelf && access.role !== "owner") {
    fail(res, 403, "owner-only", "Nur der Besitzer kann Mitglieder entfernen.");
    return;
  }
  if (!isSelf) {
    const targetRole = await membershipRole(req.params.id, targetId);
    if (targetRole === "owner") {
      fail(res, 400, "owner-cannot-be-removed", "Der Besitzer kann nicht entfernt werden.");
      return;
    }
  }
  await pool.query("DELETE FROM household_members WHERE household_id = $1 AND user_id = $2", [req.params.id, targetId]);
  res.json({ ok: true });
});
householdsRouter.delete("/:id", async (req, res) => {
  const access = await requireHousehold(req.params.id, req.userId);
  if (!access.ok) {
    fail(res, access.status, access.error, access.message);
    return;
  }
  if (access.role !== "owner") {
    fail(res, 403, "owner-only", "Nur der Besitzer kann den Haushalt l\xF6schen.");
    return;
  }
  const others = await pool.query(
    "SELECT count(*)::int AS c FROM household_members WHERE household_id = $1",
    [req.params.id]
  );
  if ((others.rows[0]?.c ?? 0) > 1 && req.query.force !== "1") {
    fail(res, 409, "household-not-empty", "Es sind noch andere Mitglieder im Haushalt.");
    return;
  }
  await pool.query("DELETE FROM households WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// server/food.ts
import { Router as Router9 } from "express";
var foodRouter = Router9();
var cache = /* @__PURE__ */ new Map();
var TTL = 1e3 * 60 * 60 * 12;
function cached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  return null;
}
function put(key, data) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), data });
}
var UA = "HermesMealPlanner/1.0 (private household app)";
function num(n, keys) {
  if (!n) return null;
  for (const k of keys) {
    const v = n[k];
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
    if (typeof v === "string") {
      const parsed = Number(v.replace(",", "."));
      if (Number.isFinite(parsed)) return Math.round(parsed);
    }
  }
  return null;
}
function mapProduct(p) {
  const n = p.nutriments || {};
  const kcal = num(n, ["energy-kcal_100g", "energy-kcal", "energy-kcal_value"]);
  const brand = String(p.brands || "").split(",")[0].trim();
  return {
    barcode: String(p.code || p._id || ""),
    name: String(p.product_name_de || p.product_name || "").trim(),
    brand: brand || String(p.brands || "").trim(),
    quantity: String(p.quantity || ""),
    imageUrl: p.image_front_small_url || p.image_small_url || null,
    kcal,
    protein: num(n, ["proteins_100g", "proteins"]),
    carbs: num(n, ["carbohydrates_100g", "carbohydrates"]),
    fat: num(n, ["fat_100g", "fat"]),
    perQuantity: "100 g",
    countries: String(p.countries || "")
  };
}
async function fetchJson(url, timeoutMs = 12e3) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
foodRouter.get("/barcode/:code", async (req, res) => {
  const code = String(req.params.code || "").replace(/[^0-9]/g, "");
  if (code.length < 6 || code.length > 14) {
    res.status(400).json({ error: "Ung\xFCltiger Barcode" });
    return;
  }
  const key = "b:" + code;
  const hit = cached(key);
  if (hit) {
    res.json(hit);
    return;
  }
  const data = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,product_name_de,brands,quantity,image_front_small_url,image_small_url,nutriments,countries`);
  if (!data || Number(data.status) === 0 || !data.product) {
    res.status(404).json({ error: "Produkt nicht gefunden" });
    return;
  }
  const out = mapProduct(data.product);
  put(key, out);
  res.json(out);
});
foodRouter.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }
  const key = "s:" + q.toLowerCase();
  const hit = cached(key);
  if (hit) {
    res.json(hit);
    return;
  }
  const mkUrl = (host) => `https://${host}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=code,product_name,product_name_de,brands,quantity,image_front_small_url,image_small_url,nutriments,countries`;
  let products = [];
  for (const host of ["de.openfoodfacts.org", "world.openfoodfacts.org"]) {
    const data = await fetchJson(mkUrl(host));
    if (data && Array.isArray(data.products)) {
      products = products.concat(data.products);
    }
    if (products.length >= 12) break;
  }
  const seen = /* @__PURE__ */ new Set();
  const results = [];
  for (const p of products) {
    const mapped = mapProduct(p);
    if (!mapped.name) continue;
    const dedupeKey = (mapped.barcode || mapped.name) + "|" + mapped.brand;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    results.push(mapped);
    if (results.length >= 25) break;
  }
  const out = { results };
  put(key, out);
  res.json(out);
});

// server/index.ts
var app = express();
var PORT = Number(process.env.PORT || 3e3);
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(attachUserFromToken);
app.get("/api/health", async (_req, res) => {
  const started = Date.now();
  let db = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    db = "error";
  }
  const ai = resolveProvider();
  res.status(db === "ok" ? 200 : 503).json({
    status: db === "ok" ? "ok" : "degraded",
    db,
    dbLatencyMs: Date.now() - started,
    ai: { enabled: Boolean(ai), provider: ai?.name ?? "none", model: ai?.model ?? null },
    uptimeSeconds: Math.round(process.uptime())
  });
});
app.use("/api/auth", authRouter);
app.use("/api/events", eventsRouter);
app.use("/api/households", requireAuth, householdsRouter);
app.use("/api/recipes", requireAuth, recipesRouter);
app.use("/api/plans", requireAuth, plansRouter);
app.use("/api/ai", requireAuth, aiRouter);
app.use("/api/chat", requireAuth, chatRouter);
app.use("/api/shopping", requireAuth, shoppingRouter);
app.use("/api/food", requireAuth, foodRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not-found", message: "Unbekannter Endpunkt." });
});
var distDir = join2(process.cwd(), "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => {
    res.sendFile(join2(distDir, "index.html"));
  });
}
app.use((err, _req, res, _next) => {
  const status = err.status;
  if (status === 400) {
    res.status(400).json({ error: "invalid-json", message: "Anfrage konnte nicht gelesen werden." });
    return;
  }
  console.error("[server] unhandled", err);
  res.status(500).json({ error: "internal", message: "Interner Fehler." });
});
async function start() {
  await initDb();
  const filled = await backfillRecipeMeta();
  if (filled) console.log(`\u{1F4CB} ${filled} Rezepte mit Di\xE4t/K\xFCche/Allergenen nachger\xFCstet`);
  await pool.query(
    `UPDATE user_settings
        SET data = jsonb_set(data - 'diet', '{diets}', jsonb_build_array(data->>'diet'))
      WHERE data ? 'diet' AND NOT data ? 'diets'`
  );
  startScheduler();
  const ai = resolveProvider();
  app.listen(PORT, () => {
    console.log(`\u{1F372} Meal Planner l\xE4uft auf http://localhost:${PORT}`);
    console.log(`   KI: ${ai ? `${ai.name} (${ai.model})` : "nicht konfiguriert \u2014 DEEPSEEK_API_KEY fehlt"}`);
  });
}
start().catch((e) => {
  console.error("Start fehlgeschlagen:", e);
  process.exit(1);
});
