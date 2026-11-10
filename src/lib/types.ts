export type User = { id: number; email: string; displayName: string; createdAt?: string };

export type Household = {
  id: string;
  name: string;
  role: 'owner' | 'member';
  inviteCode: string;
  memberCount: number;
  recipeCount: number;
  preferences?: HouseholdPreferences;
};

export type HouseholdPreferences = {
  diets: string[];
  cuisines: string[];
  allergies: string[];
  appliances: string[];
  dislikes: string[];
  maxMinutes: number | null;
  kcalTarget: number | null;
  note: string;
};

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
  householdId: string | null;
  authorId: number | null;
  authorName: string | null;
  title: string;
  description: string;
  servings: number;
  prepMinutes: number | null;
  totalMinutes: number | null;
  difficulty: 'leicht' | 'mittel' | 'schwer' | null;
  imageUrl: string | null;
  tags: string[];
  diets: string[];
  cuisines: string[];
  allergens: string[];
  source: 'manual' | 'ai' | 'copied' | string;
  status: 'active' | 'archived' | string;
  ingredients: Ingredient[];
  steps: string[];
  nutrition: Nutrition;
  favorite: boolean;
  favoriteCount: number;
  rating: number | null;
  ratingCount: number;
  myRating: number | null;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RecipeDraft = {
  title: string;
  description: string;
  servings: number;
  prepMinutes: number | null;
  totalMinutes: number | null;
  difficulty: 'leicht' | 'mittel' | 'schwer' | null;
  imageUrl: string | null;
  tags: string[];
  ingredients: Ingredient[];
  steps: string[];
  nutrition: Nutrition;
};

export type RecipeComment = {
  id: string;
  body: string;
  author: string;
  userId: number | null;
  createdAt: string;
  mine: boolean;
};

export type Slots = 'fruehstueck' | 'mittag' | 'abend' | 'snack';
export type Slot = Slots;

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
  position: number;
  slot?: Slot | string;
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

export type FacetValue = { value: string; count: number };

export type Facets = {
  tags: { tag: string; count: number }[];
  authors: { id: number; name: string; count: number }[];
  totals: { recipes: number; favorites: number; ratings: number };
  diets?: FacetValue[];
  cuisines?: FacetValue[];
  allergens?: FacetValue[];
};

export type RecipeQuery = {
  q?: string;
  tags?: string[];
  diets?: string[];
  cuisines?: string[];
  excludeAllergens?: string[];
  source?: 'ai' | 'manual' | 'copied' | '';
  maxMinutes?: number | null;
  maxKcal?: number | null;
  minProtein?: number | null;
  sort?: 'newest' | 'rating' | 'popular' | 'quickest' | 'title';
  favorites?: boolean;
  mine?: boolean;
  authorId?: number | null;
  archived?: boolean;
  limit?: number;
  offset?: number;
};

export type UserSettings = {
  theme: 'system' | 'light' | 'dark';
  defaultServings: number;
  diets: string[];
  allergies: string[];
  cuisines: string[];
  appliances: string[];
  /** Lebensmittel, die nicht gemocht werden (freie Liste). */
  dislikes: string[];
  maxMinutes: number | null;
  kcalTarget: number | null;
  aiAutoFavorite: boolean;
  defaultSlots: Slot[];
  specialWishes: string;
};

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  defaultServings: 2,
  diets: [],
  allergies: [],
  cuisines: [],
  appliances: [],
  dislikes: [],
  maxMinutes: null,
  kcalTarget: null,
  aiAutoFavorite: true,
  defaultSlots: ['abend'],
  specialWishes: '',
};

export function buildRecipeQuery(base: RecipeQuery): string {
  const params = new URLSearchParams();
  if (base.q) params.set('q', base.q);
  if (base.tags?.length) params.set('tags', base.tags.join(','));
  if (base.diets?.length) params.set('diets', base.diets.join(','));
  if (base.cuisines?.length) params.set('cuisines', base.cuisines.join(','));
  if (base.excludeAllergens?.length) params.set('excludeAllergens', base.excludeAllergens.join(','));
  if (base.source) params.set('source', base.source);
  if (base.maxMinutes) params.set('maxMinutes', String(base.maxMinutes));
  if (base.maxKcal) params.set('maxKcal', String(base.maxKcal));
  if (base.minProtein) params.set('minProtein', String(base.minProtein));
  if (base.sort) params.set('sort', base.sort);
  if (base.favorites) params.set('favorites', '1');
  if (base.mine) params.set('mine', '1');
  if (base.authorId) params.set('authorId', String(base.authorId));
  if (base.archived) params.set('archived', '1');
  if (base.limit) params.set('limit', String(base.limit));
  if (base.offset) params.set('offset', String(base.offset));
  return params.toString();
}
