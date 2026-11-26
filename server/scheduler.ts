import { pool } from './db';
import { loadHouseholdPreferences } from './householdPrefs';
import { loadPlan } from './plans';
import { planWeekForUser } from './ai';
import { broadcast } from './events';
import { benachrichtige } from './benachrichtigungen';
import { sendePushAnNutzer } from './push-route';

/** Versand an einen Nutzer in der Form, die `benachrichtige` erwartet. */
const sendeAn =
  (nutzerId: number) =>
  (n: { titel: string; text: string; url?: string; tag?: string; dringend?: boolean }) =>
    sendePushAnNutzer(pool, nutzerId, n);

/** Einstiegsseite der App — alle Meldungen verlinken dorthin. */
const APP_URL = 'https://meal-planner.nas-timgreen.com/';

/**
 * Freitags-Vorbau: Am Freitagmorgen bekommt jeder Haushalt die Folgewoche geplant,
 * damit am Wochenende für die ganze Woche eingekauft werden kann.
 * Läuft im Serverprozess; ein Eintrag in auto_plan_runs verhindert Doppelarbeit.
 */

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const TARGET_WEEKDAY = 5; // Freitag
const START_HOUR = 5; // ab 05:00 Europe/Berlin

function berlinNow(): { day: number; hour: number; minute: number; ymd: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const map: Record<string, number> = { Mo: 0, Di: 1, Mi: 2, Do: 3, Fr: 4, Sa: 5, So: 6 };
  const day = map[parts.weekday] ?? 0;
  return {
    // 0 = Montag, damit es zu planDays passt; Freitag ist 4
    day: day + 1 === 7 ? 6 : day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function mondayOfYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auto_plan_runs (
      household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      week_start   date NOT NULL,
      ok           boolean NOT NULL DEFAULT true,
      message      text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (household_id, week_start)
    );
  `);
}

/** Nächste Woche auf Zuruf vorbauen (gleiche Logik wie der Freitags-Lauf). */
export async function prebuildNextWeek(
  householdId: string,
  userId: number,
): Promise<{ weekStart: string; created: number; reused: number }> {
  const { ymd } = berlinNow();
  const nextWeek = addDays(mondayOfYmd(ymd), 7);
  const prefs = await loadHouseholdPreferences(householdId);
  const result = await planWeekForUser(userId, {
    householdId,
    weekStart: nextWeek,
    mode: 'replace',
    mergeMembers: true,
    days: prefs.planDays,
    slots: prefs.planSlots,
    servings: prefs.planServings,
  });
  await pool.query(
    `INSERT INTO auto_plan_runs (household_id, week_start, ok, message) VALUES ($1,$2,true,'auf Zuruf')
     ON CONFLICT (household_id, week_start) DO UPDATE SET ok = true, message = 'auf Zuruf', created_at = now()`,
    [householdId, nextWeek],
  );
  broadcast(householdId, 'plan');
  return { weekStart: nextWeek, created: result.created, reused: result.reused };
}

async function runFridayPlanning(): Promise<number> {
  const { day, hour, ymd } = berlinNow();
  if (day !== 4 || hour < START_HOUR) return 0; // 4 = Freitag in planDays-Zählung
  const nextWeek = addDays(mondayOfYmd(ymd), 7);

  const households = await pool.query<{ id: string; owner_id: number }>(
    `SELECT h.id, min(m.user_id) AS owner_id
       FROM households h JOIN household_members m ON m.household_id = h.id
      GROUP BY h.id`,
  );

  let planned = 0;
  for (const hh of households.rows) {
    try {
      const prefs = await loadHouseholdPreferences(hh.id);
      if (!prefs.autoPlan) continue;

      const done = await pool.query('SELECT 1 FROM auto_plan_runs WHERE household_id = $1 AND week_start = $2', [
        hh.id,
        nextWeek,
      ]);
      if (done.rowCount) continue;

      const existing = await loadPlan(hh.id, nextWeek);
      if ((existing.entries as unknown[]).length > 0) {
        await pool.query(
          `INSERT INTO auto_plan_runs (household_id, week_start, ok, message) VALUES ($1,$2,true,'bereits geplant')
           ON CONFLICT DO NOTHING`,
          [hh.id, nextWeek],
        );
        continue;
      }

      await planWeekForUser(hh.owner_id, {
        householdId: hh.id,
        weekStart: nextWeek,
        mode: 'replace',
        mergeMembers: true,
        days: prefs.planDays,
        slots: prefs.planSlots,
        servings: prefs.planServings,
      });
      await pool.query(
        `INSERT INTO auto_plan_runs (household_id, week_start, ok, message) VALUES ($1,$2,true,'vorgebaut')
         ON CONFLICT (household_id, week_start) DO UPDATE SET ok = true, message = 'vorgebaut', created_at = now()`,
        [hh.id, nextWeek],
      );
      broadcast(hh.id, 'plan');
      planned += 1;
      console.log(`📅 Woche ${nextWeek} für Haushalt ${hh.id} vorgebaut`);

      /*
       * Meldung an alle im Haushalt: „die nächste Woche steht".
       * Das ist der Moment, in dem eingekauft werden will — bisher erfuhr es
       * nur, wer zufällig in die App schaute.
       */
      try {
        const mitglieder = await pool.query<{ user_id: number }>(
          'SELECT user_id FROM household_members WHERE household_id = $1',
          [hh.id],
        );
        const eintraege = await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM plan_entries pe
             JOIN meal_plans p ON p.id = pe.plan_id
            WHERE p.household_id = $1 AND p.week_start = $2::date`,
          [hh.id, nextWeek],
        );
        const anzahl = Number(eintraege.rows[0]?.n ?? 0);
        const woche = new Date(`${nextWeek}T00:00:00Z`).toLocaleDateString('de-DE', {
          day: 'numeric', month: 'long', timeZone: 'UTC',
        });
        for (const m of mitglieder.rows) {
          await benachrichtige(pool, sendeAn(m.user_id), m.user_id, {
            kategorie: 'plan',
            ereignis: 'wochenplan-fertig',
            schluessel: nextWeek,
            titel: 'Nächste Woche ist geplant',
            text: `${anzahl} Mahlzeiten ab ${woche}. Die Einkaufsliste ist vollständig.`,
            url: `${APP_URL}#/week`,
            tag: 'plan-fertig',
            rhythmus: 'morgen',
          });
        }
      } catch (e) {
        console.error('[push] Meldung zum Wochenplan:', (e as Error).message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : 'unbekannt';
      console.error(`Vorbau für ${hh.id} fehlgeschlagen:`, message);
      await pool.query(
        `INSERT INTO auto_plan_runs (household_id, week_start, ok, message) VALUES ($1,$2,false,$3)
         ON CONFLICT (household_id, week_start) DO UPDATE SET ok = false, message = $3, created_at = now()`,
        [hh.id, nextWeek, message],
      ).catch(() => undefined);
    }
  }
  return planned;
}

/**
 * Täglicher Takt: Abendessen, Einkauf, Wochenstart.
 *
 * Der Mealplanner meldete bis 26.11. nur, wenn *jemand anders* etwas geändert
 * hatte. Wer allein plant, hörte nie etwas. Diese drei Meldungen schließen das:
 *
 *  - **Abendessen** (17–20 Uhr): was heute auf dem Plan steht.
 *  - **Einkauf** (Sa 9–12 Uhr): wie viel für die nächste Woche offen ist.
 *  - **Wochenstart** (So 17–20 Uhr): was geplant ist, plus offene Einkäufe.
 */
async function runDailyMessages(): Promise<number> {
  const { hour, ymd } = berlinNow();
  const wochentag = new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 = Sonntag
  let gesendet = 0;

  const haushalte = await pool.query<{ id: string; user_id: number }>(
    'SELECT household_id AS id, user_id FROM household_members',
  );
  if (!haushalte.rowCount) return 0;

  // Montag dieser Woche (day_index 0) und Montag der kommenden.
  const montag = new Date(`${ymd}T00:00:00Z`);
  montag.setUTCDate(montag.getUTCDate() - ((montag.getUTCDay() + 6) % 7));
  const dieserMontag = montag.toISOString().slice(0, 10);
  const naechsterMontag = new Date(montag.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const heuteIndex = Math.round(
    (new Date(`${ymd}T00:00:00Z`).getTime() - montag.getTime()) / 86_400_000,
  );

  for (const m of haushalte.rows) {
    try {
      /* ---- a) Abendessen heute ---- */
      if (hour >= 17 && hour <= 20) {
        const heute = await pool.query<{ slot: string; titel: string | null; eigen: string | null }>(
          `SELECT pe.slot, r.title AS titel, pe.custom_title AS eigen
             FROM plan_entries pe
             JOIN meal_plans p ON p.id = pe.plan_id
             LEFT JOIN recipes r ON r.id = pe.recipe_id
            WHERE p.household_id = $1 AND p.week_start = $2::date AND pe.day_index = $3
            ORDER BY pe.position`,
          [m.id, dieserMontag, heuteIndex],
        );
        const abend = heute.rows.filter((x) => /abend|dinner/i.test(x.slot));
        const gerichte = abend.map((x) => x.titel ?? x.eigen).filter(Boolean) as string[];
        if (gerichte.length) {
          const geschickt = await benachrichtige(pool, sendeAn(m.user_id), m.user_id, {
            kategorie: 'ernaehrung',
            ereignis: 'abendessen',
            schluessel: ymd,
            titel: 'Heute Abend',
            text: `${gerichte.join(' · ')}. Zutaten stehen in der Einkaufsliste.`,
            url: APP_URL,
            tag: 'abendessen',
            rhythmus: 'abend',
          });
          if (geschickt) gesendet += 1;
        }
      }

      /* ---- b) Einkauf am Samstag ---- */
      if (wochentag === 6 && hour >= 9 && hour <= 12) {
        const liste = await pool.query<{ offen: string }>(
          `SELECT COUNT(*) FILTER (WHERE checked IS NOT TRUE)::text AS offen
             FROM shopping_items WHERE household_id = $1 AND week_start = $2::date`,
          [m.id, naechsterMontag],
        );
        const offen = Number(liste.rows[0]?.offen ?? 0);
        if (offen > 0) {
          const geschickt = await benachrichtige(pool, sendeAn(m.user_id), m.user_id, {
            kategorie: 'plan',
            ereignis: 'einkauf-samstag',
            schluessel: ymd,
            titel: 'Einkauf steht an',
            text: `${offen} ${offen === 1 ? 'Sache' : 'Sachen'} für die nächste Woche offen.`,
            url: `${APP_URL}#/shopping`,
            tag: 'einkauf',
            rhythmus: 'morgen',
          });
          if (geschickt) gesendet += 1;
        }
      }

      /* ---- c) Wochenstart am Sonntag ---- */
      if (wochentag === 0 && hour >= 17 && hour <= 20) {
        const plan = await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM plan_entries pe
             JOIN meal_plans p ON p.id = pe.plan_id
            WHERE p.household_id = $1 AND p.week_start = $2::date`,
          [m.id, naechsterMontag],
        );
        const anzahl = Number(plan.rows[0]?.n ?? 0);
        if (anzahl > 0) {
          const liste = await pool.query<{ offen: string }>(
            `SELECT COUNT(*) FILTER (WHERE checked IS NOT TRUE)::text AS offen
               FROM shopping_items WHERE household_id = $1 AND week_start = $2::date`,
            [m.id, naechsterMontag],
          );
          const offen = Number(liste.rows[0]?.offen ?? 0);
          const geschickt = await benachrichtige(pool, sendeAn(m.user_id), m.user_id, {
            kategorie: 'plan',
            ereignis: 'wochenstart',
            schluessel: naechsterMontag,
            titel: 'Nächste Woche beginnt',
            text: `${anzahl} Mahlzeiten geplant${offen > 0 ? `, ${offen} auf der Einkaufsliste offen` : ', Einkauf ist durch'}.`,
            url: `${APP_URL}#/week`,
            tag: 'wochenstart',
            rhythmus: 'abend',
          });
          if (geschickt) gesendet += 1;
        }
      }
    } catch (e) {
      // Ein Haushalt darf den Lauf nicht abbrechen, aber nicht stumm scheitern.
      console.error('[push] Tagesmeldungen:', (e as Error).message);
    }
  }
  return gesendet;
}

export function startScheduler() {
  void ensureTable().catch((e) => console.error('Scheduler-Tabelle', e));
  const tick = async () => {
    try {
      await runFridayPlanning();
    } catch (error) {
      console.error('Scheduler', error);
    }
    try {
      await runDailyMessages();
    } catch (error) {
      console.error('Scheduler Tagesmeldungen', error);
    }
  };
  const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
  void tick();
  return timer;
}
