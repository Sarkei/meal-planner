import pg from 'pg';

const { Pool } = pg;

function buildPool(): pg.Pool {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return new Pool({ connectionString: url });
  return new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'mealplanner',
    user: process.env.POSTGRES_USER || 'mealplanner',
    password: process.env.POSTGRES_PASSWORD || 'mealplanner',
    max: 10,
  });
}

export const pool = buildPool();

export async function initDb(): Promise<void> {
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

    -- ── Nachträglich ergänzt: globale Rezeptsammlung, Bewertungen, Einstellungen, Reset-Tokens ──
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_lower text;
    UPDATE users SET email_lower = lower(email) WHERE email_lower IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (email_lower);

    ALTER TABLE recipes ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
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

    CREATE INDEX IF NOT EXISTS recipes_status_idx ON recipes (status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS recipe_ratings_recipe_idx ON recipe_ratings (recipe_id);
    CREATE INDEX IF NOT EXISTS recipe_comments_recipe_idx ON recipe_comments (recipe_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS password_reset_hash_idx ON password_reset_tokens (token_hash);
  `);
}
