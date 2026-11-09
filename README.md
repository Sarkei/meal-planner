# Meal Planner

Eigenständige Web-App für gemeinsame Essensplanung: Konten, Haushalte, Wochenpläne und eine
**gemeinsame Rezeptsammlung aller Nutzer** — durchsuchbar, bewertbar, mit Favoriten und einem
KI-Assistenten, der einzelne Rezepte oder eine ganze Woche plant.
Läuft self-hosted als Docker-Stack (Postgres + Node), KI über DeepSeek.

Zwei Grundsätze: **jede Person sieht jedes Rezept**, und **Rezepte werden nie gelöscht** —
„Löschen" archiviert nur, die Datenbank wächst also immer weiter.

## Funktionen

**Konten**
- Registrierung mit E-Mail und Passwort (bcrypt, Kostenfaktor 12), Login per JWT (30 Tage).
- Beim Registrieren entsteht automatisch ein eigener Haushalt „Küche von …".
- Profilseite: Anzeigename ändern, KI-Status sehen, abmelden.

**Haushalte / Gruppen**
- Nach der Registrierung gibt es **keinen automatischen Haushalt**: Der Tab „Haushalt" zeigt
  „Haushalt erstellen" (eigener Name) und „Haushalt beitreten" (Einladungscode).
- Beliebig viele Haushalte pro Konto; aktiver Haushalt wird oben umgeschaltet. Rezepte lassen sich
  auch ohne Haushalt anlegen — nur Wochenpläne hängen daran.
- Beitritt über 6-stelligen Einladungscode (ohne 0/O/1/I, damit man ihn vorlesen kann).
- Besitzer kann Code neu erzeugen, Mitglieder entfernen, Haushalt umbenennen oder löschen.
- Mitglieder sehen alle Rezepte und Wochenpläne des Haushalts.

**Rezeptsammlung (wie ein Kochbuch für alle)**
- Alle Rezepte aller Nutzer sind sichtbar — unabhängig vom Haushalt.
- Drei Ansichten: **Alle**, **Favoriten**, **Meine**; Sortierung nach neu, Bewertung, Beliebtheit,
  Zubereitungszeit oder A–Z.
- Suche über Titel, Beschreibung, **Zutaten** und **Autor**.
- Filter: Tags (mit Anzahl), maximale Zeit, maximale Kalorien pro Portion, Mindest-Protein, Quelle
  (KI / selbst geschrieben / kopiert) — kombinierbar, auch auf Favoriten.
- Favoriten pro Nutzer; Herz auf jeder Karte, Zähler „× gemerkt".
- **Bewertung** mit 1–5 Sternen pro Nutzer, Durchschnitt und Anzahl; **Kommentare/Notizen** unter
  jedem Rezept (eigene wieder löschbar).
- Fremde Rezepte lassen sich mit einem Klick **kopieren und anpassen** (Kopie gehört dir).
- **Archivieren statt löschen**: Das Rezept verschwindet aus der Sammlung, bleibt aber mit
  Bewertungen und Kommentaren in der Datenbank erhalten.
- Portions-Schieber im Detail rechnet Zutatenmengen live um.
- Anlegen per Hand oder per KI-Idee; Editor für Titel, Beschreibung, Portionen, Vorbereitungs- und
  Gesamtzeit, Aufwand (leicht/mittel/schwer), Bild, Tags, Zutaten, Schritte und Nährwerte.
- **Bild oben:** Rezeptfoto per URL oder Upload (im Browser auf 1200 px verkleinert und als
  Data-URL gespeichert); ohne Bild erscheint ein ruhiger Farbverlauf mit Küchensymbol.
- Detailseite in fester Reihenfolge: Bild → Überblick (Vorbereitung, Gesamtzeit, Aufwand, Basis-
  Portionen) → Zutaten mit **+/−-Portionsschalter** (Mengen rechnen live um) → nummerierte Anleitung.

**Wochenplan**
- Sieben Tageskarten untereinander (keine Mahlzeiten-Slots): pro Tag ein „+", das Rezepte aus der
  Sammlung, Freitext oder ein frisches KI-Rezept hinzufügt.
- Die Rezepte eines Tages stehen als Karten untereinander und lassen sich **per Drag & Drop**
  sortieren — auch in einen anderen Tag hinein. Auf dem Handy übernehmen Pfeile das Verschieben.
- Reihenfolge liegt als `position` in der Datenbank (`PUT …/reorder` schreibt sie in einer Transaktion).
- Tageskalorien werden aus den Nährwerten der geplanten Rezepte summiert.
- Einkaufsliste aus der Woche: Zutaten werden über alle Rezepte aggregiert, auf die im Slot
  geplante Portionszahl umgerechnet und abhakbar dargestellt; Kopieren als Text.

**KI-Assistent**
- `POST /api/ai/recipe` — Rezept aus einer Idee, speichert es direkt und legt es (Standard) in die
  Favoriten; Vorgaben aus dem Profil (Ernährungsform, Allergien, Zeit, Kalorien) fließen automatisch ein.
- Eigene Vorgaben und Standard-Portionen wirken auch auf die Wochenplanung.
- `POST /api/ai/recipe/refine` — bestehendes Rezept nach Wunsch überarbeiten (minimaler Diff).
- `POST /api/ai/week` — komplette Woche planen; Modus `replace` ersetzt nur KI-Einträge,
  `fill` füllt ausschließlich leere Slots.
- Provider: DeepSeek (Standard), Mistral, Gemini als Fallback — jeweils OpenAI-kompatibel bzw.
  eigene API; Prompts liegen als Markdown in `prompts/` mit `{{platzhaltern}}`.

**Konten & Sicherheit**
- **Passwort vergessen**: Reset-Link per Mail (SMTP) oder — wenn kein SMTP konfiguriert ist — direkt
  in der App (`ALLOW_DEV_RESET_LINK=1`). Link gilt 60 Minuten, ist einmalig.
- Passwort ändern im Profil; dabei werden alle anderen Sitzungen ungültig (`token_version` im JWT).
- „Auf allen Geräten abmelden", Datenexport als JSON, Konto löschen (Rezepte bleiben anonymisiert).
- Einstellungen: Anzeigename; KI-Vorgaben als **feste Klick-Optionen** (Portionen, Ernährungsform,
  Allergien als Mehrfachauswahl, max. Zeit, Kalorienziel, Auto-Favorit) plus **ein** Freitextfeld
  „Sonderwünsche"; Design (System/Hell/Dunkel); Passwort, Datenexport, Konto löschen.

**Betrieb**
- `/api/health` liefert DB-Status, KI-Provider und Uptime; Docker-Healthcheck nutzt diesen Endpunkt.
- Schema wird beim Start angelegt (`CREATE TABLE IF NOT EXISTS` in `server/db.ts`), keine
  separaten Migrationsdateien.
- KI-Aufrufe werden in `ai_runs` protokolliert (Art, Provider, Modell, Dauer, Fehler).

## Technik

| Baustein | Version / Rolle |
|---|---|
| Frontend | React 19, Vite 6, Tailwind 4 (SPA, ausgeliefert vom Express-Server) |
| Backend | Express 4, ein Prozess (`server/`), gebündelt per esbuild nach `server.js` |
| **Datenbank** | PostgreSQL 16, Zugriff über `pg`; Tabellen u. a. `users`, `households`, `recipes`, `favorites`, `recipe_ratings`, `recipe_comments`, `meal_plans`, `plan_entries`, `user_settings`, `password_reset_tokens` |
| Auth | JWT (`jsonwebtoken`), Passwörter mit `bcryptjs` |
| Validierung | `zod` serverseitig für alle Schreib-Endpunkte |

## Projektstruktur

```
server/
  index.ts         Express-App, /api/health, Static-Serving der SPA
  db.ts            Pool + Schema
  auth.ts          Registrierung, Login, /api/auth/me
  households.ts    Haushalte, Einladungscodes, Mitglieder
  recipes.ts       Rezepte + Favoriten
  plans.ts         Wochenpläne, Einträge, Einkaufsliste
  ai.ts            Provider-Auswahl, Prompts, Rezept-/Wochen-Generierung
  recipeSchema.ts  Zod-Schemas für Rezept und Wochenplan
  guards.ts        Auth-Middleware, Haushalts-Zugriffsprüfung
src/
  App.tsx          Hash-Router, Navigation, Layout
  lib/             API-Client, Auth-Kontext, Typen
  pages/           Auth, Passwort-Reset, Woche, Rezepte, Rezept-Detail, Haushalt, Einstellungen
  components/      Modal, Rezeptkarte, Rezept-Editor
prompts/
  recipe-draft.md  Rezept aus Idee
  recipe-refine.md Rezept überarbeiten
  week-plan.md     Wochenplan
```

## API-Überblick

| Methode + Pfad | Zweck |
|---|---|
| `POST /api/auth/register`, `POST /api/auth/login` | Konto anlegen / anmelden (liefert JWT) |
| `GET/PATCH /api/auth/me` | Profil und Haushalte lesen / Namen ändern |
| `GET/POST /api/households`, `POST /api/households/join` | Haushalte listen, anlegen, beitreten |
| `GET/PATCH/DELETE /api/households/:id` | Haushalt lesen (inkl. Mitglieder) / umbenennen / löschen |
| `POST /api/households/:id/invite-code` | Code neu erzeugen |
| `DELETE /api/households/:id/members/:userId` | Mitglied entfernen oder selbst verlassen |
| `GET /api/recipes?q=&tags=&maxMinutes=&maxKcal=&minProtein=&source=&sort=&favorites=1&mine=1` | Sammlung mit Filtern (`limit`/`offset`) |
| `GET /api/recipes/facets` | Tags, Autoren, Zähler für die Filterleiste |
| `GET/POST /api/recipes`, `GET/PATCH/DELETE /api/recipes/:id` | Rezept lesen/anlegen/ändern/archivieren |
| `POST /api/recipes/:id/favorite`, `GET /api/recipes/favorites` | Favoriten |
| `POST /api/recipes/:id/rating`, `DELETE /api/recipes/:id/rating` | Bewertung 1–5 |
| `GET/POST /api/recipes/:id/comments`, `DELETE /api/recipes/:id/comments/:commentId` | Kommentare |
| `POST /api/recipes/:id/copy` | Rezept in den eigenen Haushalt kopieren |
| `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` | Passwort-Reset |
| `POST /api/auth/change-password`, `POST /api/auth/logout-all` | Passwort ändern, Sitzungen beenden |
| `GET/PUT /api/auth/settings` | Benutzereinstellungen |
| `GET /api/plans/:householdId/:weekStart` | Woche lesen |
| `PUT /api/plans/:householdId/:weekStart/entry` | Slot besetzen |
| `DELETE /api/plans/:householdId/:weekStart/entry/:entryId` | Slot leeren |
| `GET /api/plans/:householdId/:weekStart/shopping-list` | Einkaufsliste |
| `POST /api/ai/recipe`, `POST /api/ai/recipe/refine`, `POST /api/ai/week` | KI-Funktionen |
| `GET /api/ai/status` | aktiver Provider und Modell |

Alle Endpunkte außer Auth und Health erwarten `Authorization: Bearer <token>`.

## Start

### Docker (empfohlen)

```bash
cp .env.example .env      # POSTGRES_PASSWORD, JWT_SECRET, DEEPSEEK_API_KEY eintragen
docker compose up -d --build
curl -fsS http://127.0.0.1:22226/api/health
```

Die App hört auf Port `22226` (intern 3000). Postgres läuft im Compose-Netz ohne Port nach außen.
Neben `default` hängt der Container im externen Netz `cloudflare-tunnel-net`; ohne Cloudflare-Tunnel
muss das Netz existieren oder die Zeile im Compose entfernt werden
(`docker network create cloudflare-tunnel-net`).

### Lokal entwickeln

```bash
npm install
cp .env.example .env      # POSTGRES_* auf eine lokale Datenbank zeigen lassen
npm run dev               # tsx watch, Vite proxyt /api auf :3000
npm run lint              # tsc --noEmit
npm run build && npm run build:server
```

## Konfiguration

| Variable | Bedeutung |
|---|---|
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Datenbank |
| `DATABASE_URL` | alternativ eine vollständige Verbindungs-URL |
| `JWT_SECRET` | Signatur der Auth-Tokens (Pflicht) |
| `AI_ACTIVE_PROVIDER` | `deepseek` (Default), `mistral` oder `gemini` |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `AI_DEEPSEEK_MODEL` | DeepSeek (Default-Modell `deepseek-chat`) |
| `MISTRAL_API_KEY`, `MISTRAL_BASE_URL`, `AI_MISTRAL_MODEL` | Mistral als Fallback |
| `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `AI_GEMINI_MODEL` | Gemini als Fallback |
| `PORT` | Server-Port (Default 3000) |
| `PROMPT_DIR` | Ordner der Prompt-Dateien (Default `./prompts`) |
| `APP_PUBLIC_URL` | Basis-URL für Links (Passwort-Reset), z. B. `https://meal-planner.nas-timgreen.com` |
| `ALLOW_DEV_RESET_LINK` | `1` (Default): Reset-Link in der App anzeigen, wenn kein SMTP konfiguriert ist |
| `RESET_TTL_MINUTES` | Gültigkeit des Reset-Links (Default 60) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | optionaler Mailversand |

Ohne API-Key startet die App normal; nur die KI-Endpunkte antworten dann mit 503/502.

## Hinweise

- Der Wochenstart ist immer Montag (`YYYY-MM-DD`), die Woche läuft Montag–Sonntag.
- Portionen im Slot können von den Rezeptportionen abweichen; die Einkaufsliste rechnet mit dem
  Faktor `Slot-Portionen / Rezept-Portionen`.
- Zutaten ohne Menge erscheinen in der Einkaufsliste mit `~` („nach Bedarf").
- Der KI-Modus `replace` löscht nur Einträge, deren Rezept `source = 'ai'` ist — manuell
  eingetragene Mahlzeiten bleiben erhalten.
