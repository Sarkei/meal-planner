
import { deriveMeta } from '../server/recipeMeta.js';
let pass = 0, fail = 0;
const check = (l, c, e = '') => { if (c) pass++; else { fail++; console.log('FAIL', l, e); } };
const ing = (names: string[]) => names.map((name) => ({ name }));

const curry = deriveMeta({ title: 'Tofu-Curry', ingredients: ing(['Tofu', 'Kokosmilch', 'Ingwer']), nutrition: { kcal: 420, protein: 22, carbs: 18 } });
check('Curry vegan (Kokosmilch ist keine Laktose)', curry.diets.includes('vegan'), JSON.stringify(curry));
check('Curry Asiatisch', curry.cuisines.includes('Asiatisch'), JSON.stringify(curry.cuisines));
check('Curry ohne Laktose-Allergen', !curry.allergens.includes('Laktose'), JSON.stringify(curry.allergens));

const bolo = deriveMeta({ title: 'Spaghetti Bolognese', ingredients: ing(['Spaghetti', 'Rinderhack', 'Parmesan']), nutrition: { kcal: 650, protein: 32, carbs: 70 } });
check('Bolognese mit Gluten', bolo.allergens.includes('Gluten'), JSON.stringify(bolo.allergens));
check('Bolognese mit Laktose', bolo.allergens.includes('Laktose'), JSON.stringify(bolo.allergens));
check('Bolognese nicht vegetarisch', !bolo.diets.includes('vegetarisch'), JSON.stringify(bolo.diets));
check('Bolognese high protein', bolo.diets.includes('high protein'), JSON.stringify(bolo.diets));
check('Bolognese Italienisch', bolo.cuisines.includes('Italienisch'), JSON.stringify(bolo.cuisines));

const salat = deriveMeta({ title: 'Kartoffelsalat', ingredients: ing(['Kartoffeln', 'Essig', 'Senf']), nutrition: { kcal: 300, protein: 6, carbs: 45 } });
check('Kartoffelsalat vegan', salat.diets.includes('vegan'), JSON.stringify(salat.diets));
check('Kartoffelsalat kalorienbewusst', salat.diets.includes('kalorienbewusst'), JSON.stringify(salat.diets));
check('Kartoffelsalat Deutsch', salat.cuisines.includes('Deutsch'), JSON.stringify(salat.cuisines));

const lachs = deriveMeta({ title: 'Lachs mit Reis', ingredients: ing(['Lachsfilet', 'Reis', 'Zitrone']) });
check('Lachs pescetarisch', lachs.diets.includes('pescetarisch'), JSON.stringify(lachs.diets));
check('Lachs mit Fisch-Allergen', lachs.allergens.includes('Fisch'), JSON.stringify(lachs.allergens));

console.log(`${pass} grün, ${fail} rot`);
