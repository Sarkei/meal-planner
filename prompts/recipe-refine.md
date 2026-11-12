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

SCHRITTE — SO SCHREIBST DU SIE IMMER
7. Mengen stehen in runden Klammern direkt hinter der Zutat: „Die Zwiebel (1 Stück) und den Knoblauch (2 Zehen) schälen und fein würfeln.“ Niemals „Zwiebel 1 Stück“ ohne Klammern.
8. 8 bis 16 Schritte, jeder mit genau einer Handlung oder zwei unmittelbar zusammengehörenden Handlungen. Zwei Arbeitsschritte, die nacheinander passieren, gehören in zwei eigene Punkte.
9. Schritte mit Bindewörtern verknüpfen: „In der Zwischenzeit …“ für Arbeiten, die nebenher laufen, „Danach …“ / „Anschließend …“ für das Folgende. Ohne solches Bindewort steht kein zweiter Arbeitsgang im selben Punkt.
10. Gar-, Back- und Brat­schritte nennen Gefäß, Hitze/Temperatur, Dauer und ein sichtbares Fertig-Merkmal („bis die Zwiebeln glasig sind“, „bis der Käse goldbraun ist“). Bei reinen Vorbereitungsschritten genügen Menge und Schnittform.
11. Jeder Schritt ist ein vollständiger, grammatisch korrekter deutscher Satz im einheitlichen Infinitiv-Stil — richtige Fälle, Endungen und Artikel, kein Telegrammstil, keine Verbketten.
12. Verboten: „zubereiten“, „nach Belieben“, „etwas“, „bis es fertig ist“, „entsprechend würzen“. Formuliere konkret.
13. Der letzte Schritt ist das Abschmecken mit konkreten Mengen; das Anrichten darf ein eigener Punkt sein.
14. Jedes Gewürz steht mit konkreter Menge in der Zutatenliste (z. B. „Paprika edelsüß 1 TL“), Salz getrennt nach Koch- und Abschmeckmenge.

SCHEMA
{"title":"...","description":"...","servings":2,"prepMinutes":15,"totalMinutes":35,"difficulty":"mittel","tags":["..."],"ingredients":[{"name":"Zwiebel","amount":1,"unit":"Stück"},{"name":"Salz","amount":1,"unit":"TL"}],"steps":["Die Zwiebel (1 Stück) schälen und in feine Würfel schneiden.","Das Rapsöl (2 EL) in einer großen Pfanne bei mittlerer Hitze erhitzen.","In der Zwischenzeit die Zwiebeln in die Pfanne geben und 4 Minuten anschwitzen, bis sie glasig sind und duften."],"nutrition":{"kcal":520,"protein":32,"carbs":48,"fat":20}}
