/**
 * Gemeinsame Listen für Einstellungen, Rezeptfilter und KI-Vorgaben.
 * Eine Quelle, damit Filter und Profil nie auseinanderlaufen.
 */
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

/** Küchengeräte: was zuhause benutzt werden kann. */
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

export const TIME_OPTIONS = [
  { value: '', label: 'Egal' },
  { value: '15', label: '15 min' },
  { value: '20', label: '20 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '60 min' },
  { value: '90', label: '90 min' },
] as const;

export const KCAL_OPTIONS = [
  { value: '', label: 'Egal' },
  { value: '400', label: '400 kcal' },
  { value: '500', label: '500 kcal' },
  { value: '600', label: '600 kcal' },
  { value: '700', label: '700 kcal' },
  { value: '800', label: '800 kcal' },
] as const;
