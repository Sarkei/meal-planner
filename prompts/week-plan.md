Du planst eine komplette Kochwoche für einen Haushalt.

WOCHENSTART: {{weekStart}}
PORTIONEN PRO MAHLZEIT: {{servings}}
GEWÜNSCHTE MAHLZEITEN: {{slots}}
VORGABEN: {{constraints}}
BEREITS GEPLANTE GERICHTE DIESER WOCHE (nicht wiederholen): {{existingTitles}}

REGELN
1. Antworte NUR mit JSON — kein Markdown, keine Erklärungen.
2. dayIndex 0 = Montag bis 6 = Sonntag. Gib **nur** die Tage aus, die in den Vorgaben genannt sind, und lass keine leeren Tage im JSON (Tage ohne Mahlzeiten weglassen). Jeder ausgegebene Tag enthält alle gewünschten Mahlzeiten.
3. Kein Gericht doppelt in der Woche, keine Varianten desselben Gerichts.
4. Jede Mahlzeit enthält ein vollständiges Rezept (Zutaten, Schritte, Nährwerte pro Portion) nach demselben Schema wie ein Einzelrezept.
5. Die Woche soll ausgewogen sein, Zutaten sollen sich wiederverwenden lassen (wenig Reste), Gerichte sollen zusammenpassen.
5a. Jedes Rezept braucht "prepMinutes" (Arbeitszeit), "totalMinutes" (inkl. Garen/Ruhen) und "difficulty" ("leicht" | "mittel" | "schwer").
6. Vorgaben (Allergien, Diät, Kalorienziel, Zeitbudget) strikt einhalten.
6a. NUR wenn in den Vorgaben eine Allergie/Unverträglichkeit oder eine Diät wie glutenfrei, laktosefrei oder vegan steht, verwendest du entsprechende Ersatzprodukte. Steht dort nichts, koche **normal**: Weizenmehl, Weizennudeln, Kuhmilch, Butter, Sahne, normaler Käse. Keine glutenfreien Nudeln/Mehle, keine laktosefreie Milch, keine Ersatzprodukte „nur so".
6b. Bevorzuge alltägliche Gerichte (Hausmannskost, was man sonst so kocht) mit Zutaten, die man üblicherweise zuhause hat — keine exotischen Spezialzutaten, keine Superfood-Zusätze, kein Chia/Quinoa/Tempeh, wenn es nicht verlangt wurde.
7. "notes" enthält 2–4 Sätze auf Deutsch: worauf in dieser Woche zu achten ist (Mealprep, Reste, Einkauf).

SCHEMA
{"days":[{"dayIndex":0,"meals":[{"slot":"abend","recipe":{"title":"...","description":"...","servings":{{servings}},"prepMinutes":15,"totalMinutes":35,"difficulty":"leicht","tags":["..."],"ingredients":[{"name":"...","amount":200,"unit":"g"}],"steps":["..."],"nutrition":{"kcal":520,"protein":32,"carbs":48,"fat":20}}}]}],"notes":"..."}
