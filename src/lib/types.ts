export type User = { id: number; email: string; displayName: string; createdAt?: string };

export type Household = {
  id: string;
  name: string;
  role: 'owner' | 'member';
  inviteCode: string;
  memberCount: number;
  recipeCount: number;
};

export type HouseholdMember = {
  userId: number;
  displayName: string;
  email: string;
  role: string;
  joinedAt: string;
};

export type Ingredient = { name: string; amount: number | null; unit: string };

export type Nutrition = { kcal?: number; protein?: number; carbs?: number; fat?: number };

export type Recipe = {
  id: string;
  householdId: string;
  ownerId: number | null;
  ownerName: string | null;
  title: string;
  description: string;
  servings: number;
  prepMinutes: number | null;
  tags: string[];
  source: 'manual' | 'ai' | string;
  ingredients: Ingredient[];
  steps: string[];
  nutrition: Nutrition;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RecipeDraft = {
  title: string;
  description: string;
  servings: number;
  prepMinutes: number | null;
  tags: string[];
  ingredients: Ingredient[];
  steps: string[];
  nutrition: Nutrition;
};

export type Slot = 'fruehstueck' | 'mittag' | 'abend' | 'snack';

export const SLOTS: { id: Slot; label: string }[] = [
  { id: 'fruehstueck', label: 'Frühstück' },
  { id: 'mittag', label: 'Mittag' },
  { id: 'abend', label: 'Abend' },
  { id: 'snack', label: 'Snack' },
];

export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export type PlanEntry = {
  id: string;
  dayIndex: number;
  slot: Slot;
  recipeId: string | null;
  title: string;
  customTitle: string | null;
  servings: number | null;
  prepMinutes: number | null;
  tags: string[];
  nutrition: Nutrition;
};

export type WeekPlan = { weekStart: string; planId: string | null; entries: PlanEntry[] };

export type ShoppingItem = { name: string; unit: string; amount: number; approximated: boolean; usedIn: string[] };
