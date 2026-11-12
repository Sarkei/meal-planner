Du überarbeitest ein bestehendes Rezept. Ändere nur, was der Wunsch verlangt — alles andere bleibt inhaltlich gleich.

AKTUELLES REZEPT (JSON):
{{recipeJson}}

WUNSCH:
{{request}}

REGELN
1. Antworte NUR mit dem vollständigen Rezept-JSON im gleichen Schema, ohne Markdown.
2. Behalte Titel bei, wenn der Wunsch ihn nicht betrifft.
3. Passe Mengen, Zutaten, Schritte, Zeiten, Schwierigkeit und Nährwerte konsistent an.
4. „prepMinutes“ = Arbeitszeit, „totalMinutes“ = Gesamtzeit, „difficulty“ = „leicht“ | „mittel“ | „schwer“.
5. Sprache Deutsch.
6. Führe keine Ersatzprodukte ein (glutenfrei, laktosefrei, vegan), wenn der Wunsch sie nicht verlangt; normale Zutaten bleiben normal.
7. Falls du Schritte überarbeitest: Jeder Schritt nennt Menge der Zutat, Gefäß, Hitze-/Temperaturangabe, Dauer und ein sichtbares Fertig-Merkmal („bis die Zwiebeln glasig sind“). Verboten sind „zubereiten“, „nach Belieben“, „etwas“, „bis es fertig ist“.
8. Jedes Gewürz steht mit konkreter Menge in der Zutatenliste (z. B. „Paprika edelsüß 1 TL“), Salz getrennt nach Koch- und Abschmeckmenge.

SCHEMA
{"title":"...","description":"...","servings":2,"prepMinutes":15,"totalMinutes":35,"difficulty":"mittel","tags":["..."],"ingredients":[{"name":"Zwiebel","amount":1,"unit":"Stück"},{"name":"Salz","amount":1,"unit":"TL"}],"steps":["Zwiebel schälen und in feine Würfel schneiden.","Rapsöl 2 EL in einer großen Pfanne bei mittlerer Hitze erhitzen, Zwiebeln 4 Minuten anschwitzen, bis sie glasig sind."],"nutrition":{"kcal":520,"protein":32,"carbs":48,"fat":20}}
