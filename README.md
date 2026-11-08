# Meal Planner

Eigenständige Web-App für gemeinsame Essensplanung: Konten, Haushalte, Wochenpläne, Rezepte mit
Favoriten und ein KI-Assistent, der einzelne Rezepte oder eine ganze Woche plant.
Läuft self-hosted als Docker-Stack (Postgres + Node), KI über DeepSeek.

## Funktionen

**Konten**
- Registrierung mit E-Mail und Passwort (bcrypt, Kostenfaktor 12), Login per JWT (30 Tage).
- Beim Registrieren entsteht automatisch ein eigener Haushalt „Küche von …".
- Profilseite: Anzeigename ändern, KI-Status sehen, abmelden.

**Haushalte / Gruppen**
- Beliebig viele Haushalte pro Konto; aktiver Haushalt wird oben umgeschaltet.
- Beitritt über 6-stelligen Einladungscode (ohne 0/O/1/I, damit man ihn vorlesen kann).
- Besitzer kann Code neu erzeugen, Mitglieder entfernen, Haushalt umbenennen oder löschen.
- Mitglieder sehen alle Rezepte und Wochenpläne des Haushalts.

**Rezepte**
- Anlegen per Hand oder per KI-Idee; Editor für Titel, Beschreibung, Portionen, Zeit, Tags,
  Zutaten (Menge + Einheit), Schritten und Nährwerten pro Portion.
- Favoriten pro Nutzer (nicht pro Haushalt), Filter in der Rezeptliste.
- Suche über Titel, Beschreibung und Zutaten.
- Detailansicht mit Zutatenliste, nummerierten Schritten und Nährwertkarten.

**Wochenplan**
- 7 Tage × vier Slots (Frühstück, Mittag, Abend, Snack), Wochenwechsel per Pfeil oder „Heute".
- Slots füllen aus vorhandenen Rezepten, mit Freitext („Pizza vom Italiener") oder per
  KI-Rezept direkt in den Slot.
- Tageskalorien werden aus den Nährwerten der geplanten Rezepte summiert.
- Einkaufsliste aus der Woche: Zutaten werden über alle Rezepte aggregiert, auf die im Slot
  geplante Portionszahl umgerechnet und abhakbar dargestellt; Kopieren als Text.

**KI-Assistent**
- `POST /api/ai/recipe` — Rezept aus einer Idee (Titel, Zutaten, Schritte, Nährwerte).
- `POST /api/ai/recipe/refine` — bestehendes Rezept nach Wunsch überarbeiten (minimaler Diff).
- `POST /api/ai/week` — komplette Woche planen; Modus `replace` ersetzt nur KI-Einträge,
  `fill` füllt ausschließlich leere Slots.
- Provider: DeepSeek (Standard), Mistral, Gemini als Fallback — jeweils OpenAI-kompatibel bzw.
  eigene API; Prompts liegen als Markdown in `prompts/` mit `{{platzhaltern}}`.

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
| Datenbank | PostgreSQL 16, Zugriff über `pg` |
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
  pages/           Auth, Woche, Rezepte, Rezept-Detail, Haushalt, Profil
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
| `GET/POST /api/recipes`, `GET/PATCH/DELETE /api/recipes/:id` | Rezepte |
| `POST /api/recipes/:id/favorite`, `GET /api/recipes/favorites` | Favoriten |
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

Ohne API-Key startet die App normal; nur die KI-Endpunkte antworten dann mit 503/502.

## Hinweise

- Der Wochenstart ist immer Montag (`YYYY-MM-DD`), die Woche läuft Montag–Sonntag.
- Portionen im Slot können von den Rezeptportionen abweichen; die Einkaufsliste rechnet mit dem
  Faktor `Slot-Portionen / Rezept-Portionen`.
- Zutaten ohne Menge erscheinen in der Einkaufsliste mit `~` („nach Bedarf").
- Der KI-Modus `replace` löscht nur Einträge, deren Rezept `source = 'ai'` ist — manuell
  eingetragene Mahlzeiten bleiben erhalten.
