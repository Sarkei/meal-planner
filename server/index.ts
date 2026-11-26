import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { initDb, pool } from './db';
import { backfillRecipeMeta } from './recipeMeta';
import { chatRouter } from './chat';
import { connectRouter } from './connect';
import { startScheduler } from './scheduler';
import { attachUserFromToken, authRouter } from './auth';
import { requireAuth } from './guards';
import { householdsRouter } from './households';
import { recipesRouter } from './recipes';
import { plansRouter } from './plans';
import { aiRouter, resolveProvider } from './ai';
import { shoppingRouter } from './shopping';
import { foodRouter } from './food';
import { eventsRouter } from './events';
import { pushoverRouter } from './pushover-route';
import { pushRouter } from './push-route';
import { benachrichtigungsRouter } from './benachrichtigungen';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(attachUserFromToken);

app.get('/api/health', async (_req, res) => {
  const started = Date.now();
  let db = 'ok';
  try {
    await pool.query('SELECT 1');
  } catch {
    db = 'error';
  }
  const ai = resolveProvider();
  res.status(db === 'ok' ? 200 : 503).json({
    status: db === 'ok' ? 'ok' : 'degraded',
    db,
    dbLatencyMs: Date.now() - started,
    ai: { enabled: Boolean(ai), provider: ai?.name ?? 'none', model: ai?.model ?? null },
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.use('/api/auth', authRouter);
// Kopplung mit anderen Apps: Code-basiert, ohne Login der Gegenstelle.
app.use('/api/connect', connectRouter);
// SSE: Token kommt als Query-Parameter, weil EventSource keine Header setzen kann.
app.use('/api/events', eventsRouter);
// Alles ab hier nur mit gültigem Token — die Routen selbst prüfen zusätzlich Haushaltsrechte.
/*
 * Pushover: Zugang hinterlegen, testen, trennen.
 * Werte bleiben serverseitig — GET liefert nur „verbunden".
 */
app.use(
  '/api/integrations/pushover',
  attachUserFromToken,
  pushoverRouter(pool as never, (req) => (req as { userId?: number }).userId ?? null, {
    titel: 'Meal Planner',
    text: 'Wenn du das siehst, funktionieren deine Benachrichtigungen.',
  }),
);

/*
 * Web Push: Gerät anmelden, abmelden, testen.
 * Läuft parallel zu Pushover.
 */
app.use(
  '/api/push',
  attachUserFromToken,
  pushRouter(pool as never, (req) => (req as { userId?: number }).userId ?? null, 'Meal Planner'),
);

/* Kategorien, Ruhezeit und Verlauf der Benachrichtigungen. */
app.use(
  '/api/benachrichtigungen',
  attachUserFromToken,
  benachrichtigungsRouter(pool as never, (req) => (req as { userId?: number }).userId ?? null),
);

app.use('/api/households', requireAuth, householdsRouter);
app.use('/api/recipes', requireAuth, recipesRouter);
app.use('/api/plans', requireAuth, plansRouter);
app.use('/api/ai', requireAuth, aiRouter);
app.use('/api/chat', requireAuth, chatRouter);
app.use('/api/shopping', requireAuth, shoppingRouter);
app.use('/api/food', requireAuth, foodRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not-found', message: 'Unbekannter Endpunkt.' });
});

const distDir = join(process.cwd(), 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.sendFile(join(distDir, 'index.html'));
  });
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number }).status;
  if (status === 400) {
    // Ungültiger oder doppelt kodierter Request-Body — das ist ein Client-Fehler
    res.status(400).json({ error: 'invalid-json', message: 'Anfrage konnte nicht gelesen werden.' });
    return;
  }
  console.error('[server] unhandled', err);
  res.status(500).json({ error: 'internal', message: 'Interner Fehler.' });
});

async function start(): Promise<void> {
  await initDb();
  const filled = await backfillRecipeMeta();
  if (filled) console.log(`📋 ${filled} Rezepte mit Diät/Küche/Allergenen nachgerüstet`);
  // Altbestand: früher gab es ein einzelnes Feld `diet`; in `diets` überführen, damit die Oberfläche es zeigt
  await pool.query(
    `UPDATE user_settings
        SET data = jsonb_set(data - 'diet', '{diets}', jsonb_build_array(data->>'diet'))
      WHERE data ? 'diet' AND NOT data ? 'diets'`,
  );
  startScheduler();
  const ai = resolveProvider();
  app.listen(PORT, () => {
    console.log(`🍲 Meal Planner läuft auf http://localhost:${PORT}`);
    console.log(`   KI: ${ai ? `${ai.name} (${ai.model})` : 'nicht konfiguriert — DEEPSEEK_API_KEY fehlt'}`);
  });
}

start().catch((e) => {
  console.error('Start fehlgeschlagen:', e);
  process.exit(1);
});
