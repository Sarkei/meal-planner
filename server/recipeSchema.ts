import { z } from 'zod';

export const SLOTS = ['fruehstueck', 'mittag', 'abend', 'snack'] as const;
export type Slot = (typeof SLOTS)[number];

export const slotSchema = z.enum(SLOTS);

export const ingredientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  amount: z.number().nonnegative().max(100000).nullable().optional(),
  unit: z.string().trim().max(24).optional(),
});

export type Ingredient = z.infer<typeof ingredientSchema>;

const stepFromAi = z.union([z.string(), z.object({ text: z.string() }).transform((v) => v.text)]);

export const nutritionSchema = z.object({
  kcal: z.number().nonnegative().max(20000).optional(),
  protein: z.number().nonnegative().max(1000).optional(),
  carbs: z.number().nonnegative().max(2000).optional(),
  fat: z.number().nonnegative().max(1000).optional(),
});

export type Nutrition = z.infer<typeof nutritionSchema>;

const difficultySchema = z.enum(['leicht', 'mittel', 'schwer']);

export const recipeInputSchema = z.object({
  title: z.string().trim().min(2, 'Titel zu kurz').max(160),
  description: z.string().trim().max(2000).optional().default(''),
  servings: z.number().int().min(1).max(50).optional().default(2),
  prepMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  totalMinutes: z.number().int().min(0).max(2880).nullable().optional(),
  difficulty: difficultySchema.nullable().optional(),
  imageUrl: z
    .string()
    .trim()
    .max(2_000_000)
    .refine((v) => v === '' || /^https?:\/\//.test(v) || /^data:image\/(png|jpe?g|webp);base64,/.test(v), 'Ungültige Bildquelle')
    .nullable()
    .optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional().default([]),
  ingredients: z.array(ingredientSchema).min(1, 'Mindestens eine Zutat').max(60),
  steps: z.array(stepFromAi).min(1, 'Mindestens ein Schritt').max(40),
  nutrition: nutritionSchema.optional().default({}),
});

export type RecipeInput = z.infer<typeof recipeInputSchema>;

/** Was das Modell liefern soll: dieselbe Struktur, aber ohne harte Untergrenzen. */
export const aiRecipeSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional().default(''),
  servings: z.number().min(1).max(50).optional().default(2),
  prepMinutes: z.number().min(0).max(1440).nullable().optional(),
  totalMinutes: z.number().min(0).max(2880).nullable().optional(),
  difficulty: z.enum(['leicht', 'mittel', 'schwer']).optional().default('mittel'),
  tags: z.array(z.string()).max(12).optional().default([]),
  ingredients: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        amount: z.number().nonnegative().nullable().optional(),
        unit: z.string().trim().max(24).optional(),
      }),
    )
    .min(1)
    .max(60),
  steps: z.array(stepFromAi).min(1).max(40),
  nutrition: nutritionSchema.optional().default({}),
});

export type AiRecipe = z.infer<typeof aiRecipeSchema>;

export const weekPlanSchema = z.object({
  days: z
    .array(
      z.object({
        dayIndex: z.number().int().min(0).max(6),
        meals: z
          .array(
            z.object({
              slot: slotSchema,
              recipe: aiRecipeSchema,
            }),
          )
          .max(6)
          .default([]),
      }),
    )
    .min(1)
    .max(7),
  notes: z.string().max(2000).optional().default(''),
});

export type WeekPlanAi = z.infer<typeof weekPlanSchema>;

type LooseRecipe = {
  title: string;
  description?: string;
  servings?: number;
  prepMinutes?: number | null;
  totalMinutes?: number | null;
  difficulty?: 'leicht' | 'mittel' | 'schwer' | null;
  imageUrl?: string | null;
  tags?: string[];
  ingredients: Array<{ name: string; amount?: number | null; unit?: string }>;
  steps: Array<string | { text: string }>;
  nutrition?: Nutrition;
};

export function normalizeRecipe(input: LooseRecipe): RecipeInput {
  return {
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    servings: Math.max(1, Math.round(input.servings ?? 2)),
    prepMinutes: input.prepMinutes != null ? Math.round(input.prepMinutes) : null,
    totalMinutes: input.totalMinutes != null ? Math.round(input.totalMinutes) : null,
    difficulty: input.difficulty ?? 'mittel',
    imageUrl: input.imageUrl?.trim() || null,
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 12),
    ingredients: input.ingredients.map((i) => ({
      name: i.name.trim(),
      amount: i.amount ?? null,
      unit: (i.unit ?? '').trim(),
    })),
    steps: input.steps
      .map((s) => (typeof s === 'string' ? s : s.text))
      .map((s) => s.trim())
      .filter(Boolean),
    nutrition: input.nutrition ?? {},
  };
}
