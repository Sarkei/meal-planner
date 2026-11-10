import { pool } from './db';

/** Küchengeräte, die ein Haushalt haben kann (Auswahl in Profil und Haushalt). */
export const DIET_OPTIONS = [
  'vegetarisch',
  'vegan',
  'pescetarisch',
  'low carb',
  'high protein',
  'glutenfrei',
  'laktosefrei',
  'kalorienbewusst',
] as const;

export const CUISINE_OPTIONS = [
  'Deutsch',
  'Italienisch',
  'Spanisch',
  'Französisch',
  'Griechisch',
  'Türkisch',
  'Asiatisch',
  'Indisch',
  'Mexikanisch',
  'Amerikanisch',
  'Orientalisch',
] as const;

export const ALLERGY_OPTIONS = [
  'Nüsse',
  'Erdnüsse',
  'Gluten',
  'Laktose',
  'Ei',
  'Soja',
  'Fisch',
  'Meeresfrüchte',
  'Schweinefleisch',
  'Pilze',
  'Sellerie',
  'Sesam',
] as const;

export const APPLIANCE_OPTIONS = [
  'Ofen',
  'Herd',
  'Mikrowelle',
  'Thermomix',
  'Reiskocher',
  'Heißluftfritteuse',
  'Slow Cooker',
  'Grill',
  'Kontaktgrill',
  'Küchenmaschine',
  'Pürierstab',
  'Dampfgarer',
] as const;

export interface HouseholdPreferences {
  diets: string[];
  cuisines: string[];
  allergies: string[];
  appliances: string[];
  /** Lebensmittel, die im Haushalt niemand mag — freie Liste. */
  dislikes: string[];
  maxMinutes: number | null;
  kcalTarget: number | null;
  note: string;
}

export const EMPTY_HOUSEHOLD_PREFERENCES: HouseholdPreferences = {
  diets: [],
  cuisines: [],
  allergies: [],
  appliances: [],
  dislikes: [],
  maxMinutes: null,
  kcalTarget: null,
  note: '',
};

function list(value: unknown, max: number, allowed?: readonly string[]): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const cleaned = raw
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0 && v.length <= 40)
    .filter((v) => (allowed ? allowed.includes(v) : true));
  return [...new Set(cleaned)].slice(0, max);
}

function numberOrNull(value: unknown, min: number, max: number): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}

export function normalizeHouseholdPreferences(raw: unknown): HouseholdPreferences {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    diets: list(value.diets, 8, DIET_OPTIONS),
    cuisines: list(value.cuisines, 10, CUISINE_OPTIONS),
    allergies: list(value.allergies, 12, ALLERGY_OPTIONS),
    // Geräte nur aus der festen Liste — Tippfehler sollen den KI-Prompt nicht verfälschen
    appliances: list(value.appliances, 12, APPLIANCE_OPTIONS),
    // Freie Liste: hier sind neue Lebensmittel ausdrücklich erlaubt
    dislikes: list(value.dislikes, 40),
    maxMinutes: numberOrNull(value.maxMinutes, 5, 240),
    kcalTarget: numberOrNull(value.kcalTarget, 200, 2000),
    note: String(value.note ?? '').slice(0, 400),
  };
}

export async function loadHouseholdPreferences(householdId: string): Promise<HouseholdPreferences> {
  const row = await pool.query<{ preferences: unknown }>('SELECT preferences FROM households WHERE id = $1', [householdId]);
  return normalizeHouseholdPreferences(row.rows[0]?.preferences);
}
