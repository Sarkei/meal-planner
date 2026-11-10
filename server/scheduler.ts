import { pool } from './db';
import { loadHouseholdPreferences } from './householdPrefs';
import { loadPlan } from './plans';
import { planWeekForUser } from './ai';
import { broadcast } from './events';

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

export function startScheduler() {
  void ensureTable().catch((e) => console.error('Scheduler-Tabelle', e));
  const tick = async () => {
    try {
      await runFridayPlanning();
    } catch (error) {
      console.error('Scheduler', error);
    }
  };
  const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
  void tick();
  return timer;
}
