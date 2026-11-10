Du überarbeitest ein bestehendes Rezept. Ändere nur, was der Wunsch verlangt — alles andere bleibt inhaltlich gleich.

AKTUELLES REZEPT (JSON):
{{recipeJson}}

WUNSCH:
{{request}}

REGELN
1. Antworte NUR mit dem vollständigen Rezept-JSON im gleichen Schema, ohne Markdown.
2. Behalte Titel bei, wenn der Wunsch ihn nicht betrifft.
3. Passe Mengen, Zutaten, Schritte, Zeiten, Schwierigkeit und Nährwerte konsistent an.
4. "prepMinutes" = Arbeitszeit, "totalMinutes" = Gesamtzeit, "difficulty" = "leicht" | "mittel" | "schwer".
5. Sprache Deutsch.

SCHEMA
{"title":"...","description":"...","servings":2,"prepMinutes":15,"totalMinutes":35,"difficulty":"mittel","tags":["..."],"ingredients":[{"name":"...","amount":200,"unit":"g"}],"steps":["..."],"nutrition":{"kcal":520,"protein":32,"carbs":48,"fat":20}}
