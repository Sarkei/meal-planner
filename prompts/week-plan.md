Du planst eine komplette Kochwoche für einen Haushalt.

WOCHENSTART: {{weekStart}}
PORTIONEN PRO MAHLZEIT: {{servings}}
GEWÜNSCHTE MAHLZEITEN: {{slots}}
VORGABEN: {{constraints}}
BEREITS GEPLANTE GERICHTE DIESER WOCHE (nicht wiederholen): {{existingTitles}}

REGELN
1. Antworte NUR mit JSON — kein Markdown, keine Erklärungen.
2. Genau 7 Tage: dayIndex 0 = Montag bis 6 = Sonntag. Jeder Tag enthält alle gewünschten Mahlzeiten.
3. Kein Gericht doppelt in der Woche, keine Varianten desselben Gerichts.
4. Jede Mahlzeit enthält ein vollständiges Rezept (Zutaten, Schritte, Nährwerte pro Portion) nach demselben Schema wie ein Einzelrezept.
5. Die Woche soll ausgewogen sein, Zutaten sollen sich wiederverwenden lassen (wenig Reste), Gerichte sollen zusammenpassen.
5a. Jedes Rezept braucht "prepMinutes" (Arbeitszeit), "totalMinutes" (inkl. Garen/Ruhen) und "difficulty" ("leicht" | "mittel" | "schwer").
6. Vorgaben (Allergien, Diät, Kalorienziel, Zeitbudget) strikt einhalten.
7. "notes" enthält 2–4 Sätze auf Deutsch: worauf in dieser Woche zu achten ist (Mealprep, Reste, Einkauf).

SCHEMA
{"days":[{"dayIndex":0,"meals":[{"slot":"abend","recipe":{"title":"...","description":"...","servings":{{servings}},"prepMinutes":15,"totalMinutes":35,"difficulty":"leicht","tags":["..."],"ingredients":[{"name":"...","amount":200,"unit":"g"}],"steps":["..."],"nutrition":{"kcal":520,"protein":32,"carbs":48,"fat":20}}}]}],"notes":"..."}
