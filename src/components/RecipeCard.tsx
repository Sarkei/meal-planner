import { ChefHat, Clock, Heart, Sparkles, Star, Users } from 'lucide-react';
import type { Recipe } from '../lib/types';

export function RecipeCard({
  recipe,
  onOpen,
  onToggleFavorite,
}: {
  recipe: Recipe;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <button className="text-left" onClick={onOpen}>
          <h3 className="font-display text-base leading-snug font-bold group-hover:text-leaf">{recipe.title}</h3>
          {recipe.description && <p className="mt-1 line-clamp-2 text-xs text-ink/55">{recipe.description}</p>}
        </button>
        <button
          onClick={onToggleFavorite}
          className={`shrink-0 rounded-lg p-1.5 transition ${recipe.favorite ? 'text-clay' : 'text-ink/25 hover:text-clay'}`}
          aria-label={recipe.favorite ? 'Favorit entfernen' : 'Als Favorit speichern'}
          title={recipe.favorite ? 'Favorit entfernen' : 'Als Favorit speichern'}
        >
          <Heart className={`h-4 w-4 ${recipe.favorite ? 'fill-current' : ''}`} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-ink/55">
        {recipe.rating != null && (
          <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
            <Star className="h-3.5 w-3.5 fill-current" /> {recipe.rating.toFixed(1)}
            <span className="font-normal text-ink/40">({recipe.ratingCount})</span>
          </span>
        )}
        {(recipe.totalMinutes ?? recipe.prepMinutes) != null && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {recipe.totalMinutes ?? recipe.prepMinutes} min
          </span>
        )}
        {recipe.difficulty && <span className="capitalize">{recipe.difficulty}</span>}
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" /> {recipe.servings} Port.
        </span>
        {recipe.nutrition?.kcal != null && <span>{Math.round(recipe.nutrition.kcal)} kcal</span>}
        {recipe.source === 'ai' && (
          <span className="inline-flex items-center gap-1 text-leaf">
            <Sparkles className="h-3.5 w-3.5" /> KI
          </span>
        )}
        {recipe.favoriteCount > 0 && <span>{recipe.favoriteCount}× gemerkt</span>}
      </div>

      <div className="mt-auto flex items-end justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {recipe.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
        {recipe.authorName && <span className="shrink-0 text-[10px] text-ink/40">von {recipe.authorName.split(' ')[0]}</span>}
      </div>
      </div>
    </div>
  );
}
